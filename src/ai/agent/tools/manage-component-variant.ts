// src/ai/agent/tools/manage-component-variant.ts
//
// High-level declarative tool for managing Design Component variants and interaction states.
// 100% GUI-Parity: sets up native `variantConfig` and auto-wires `variantConnections`
// (e.g. mouseEnter / mouseLeave for hover) instead of raw non-inspectable CSS styles.

import { z } from 'zod';
import { getDefaultStore } from 'jotai';
import type { AgentTool, AgentToolResult, ToolContext } from '@/ai/agent';
import { projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { modifyProjectFile } from '@/code/project/modify-file';
import { buildComponentRegistry } from '@/code/components/component-registry';
import { hasComponentControls } from '@/code/components/controls-parser';
import { parseVariantConfig, hasInteractionState } from '@/code/variants/variant-config';
import { addVariant, addInteractionState } from '@/code/variants/variant-ops';
import { updateVariantStyleInCode } from '@/code/generation/generator-styles';
import { findVariantRootId } from '@/shared/variant-root';
import { coerceRecord } from './coerce';
import { trace } from '@/shared/debug-trace';

const recordSchema = z.preprocess(coerceRecord, z.record(z.string(), z.string()));
const store = getDefaultStore();

const VARIANT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function ok(data: unknown): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

export const manageComponentVariantTool: AgentTool = {
  name: 'manage_component_variant',
  description:
    'Create and manage Design Component variants and interactive states (hover/pressed) with 100% GUI-Parity. ' +
    'Actions: "add_interaction" (creates hover/pressed variant with auto-wired mouseEnter/mouseLeave connections and styles), ' +
    '"create" (creates new custom variant), "set_styles" (updates styles on an existing variant), "list" (lists all variants).',
  inputSchema: {
    component: z.string().describe('PascalCase component name, e.g. "Button" or "Card"'),
    action: z.enum(['add_interaction', 'create', 'set_styles', 'list']).describe('Action to perform'),
    variant: z.string().optional().describe('Variant name (required for create and set_styles)'),
    interaction: z.enum(['hover', 'pressed']).optional().describe('Interaction type for add_interaction ("hover" or "pressed", default "hover")'),
    parent_variant: z.string().optional().describe('Source variant name to cascade from (default "default")'),
    styles: recordSchema.optional().describe('Optional camelCase CSS styles to apply to the variant'),
    element: z.string().optional().describe('data-id of element inside component to style (default: component root)'),
  },
  category: 'semantic',
  async execute(args, ctx) {
    ctx.ensureCheckpoint();
    const componentName = String(args.component).trim();
    if (!componentName) return fail('Component name is required.');

    const registry = buildComponentRegistry(projectFS, store.get(projectVersionAtom));
    const info = registry.get(componentName);
    if (!info) {
      return fail(`Component "${componentName}" not found. Call list_components to see available components.`);
    }

    const masterCode = projectFS.readFile(info.filePath);
    if (!masterCode) {
      return fail(`Master file for "${componentName}" (${info.filePath}) is missing or empty.`);
    }

    if (hasComponentControls(masterCode)) {
      return fail(`"${componentName}" is a CODE component (@controls) — its variants are managed in code.`);
    }

    const action = args.action;

    if (action === 'list') {
      const configs = parseVariantConfig(masterCode);
      return ok({
        component: componentName,
        variants: configs.map((v) => ({
          name: v.name,
          label: v.label,
          isPrimary: !!v.isPrimary,
          interactionType: v.interactionType,
          parentVariant: v.parentVariant,
        })),
      });
    }

    const parentVariant: string = typeof args.parent_variant === 'string' && args.parent_variant.trim() ? args.parent_variant.trim() : 'default';

    if (action === 'add_interaction') {
      const interaction: 'hover' | 'pressed' = args.interaction === 'pressed' ? 'pressed' : 'hover';
      const variantName = `${parentVariant}-${interaction}`;

      const existingConfigs = parseVariantConfig(masterCode);
      const alreadyHas = hasInteractionState(existingConfigs, parentVariant, interaction);

      if (!alreadyHas) {
        const added = addInteractionState(info.filePath, parentVariant, interaction);
        if (!added) {
          return fail(`Failed to add ${interaction} interaction state to component "${componentName}".`);
        }
      }

      // Apply styles if provided
      const styles = args.styles as Record<string, string> | undefined;
      if (styles && Object.keys(styles).length > 0) {
        modifyProjectFile(info.filePath, (code) => {
          const targetNodeId = (typeof args.element === 'string' && args.element.trim()) ? args.element.trim() : findVariantRootId(code);
          if (!targetNodeId) return code;
          return updateVariantStyleInCode(code, targetNodeId, variantName, styles);
        });
      }

      store.set(projectVersionAtom, (v) => v + 1);

      trace.action('agent-tool:manage_component_variant:add_interaction', {
        component: componentName,
        variant: variantName,
        interaction,
      });

      return ok({
        component: componentName,
        variant: variantName,
        interaction,
        parent_variant: parentVariant,
        connections: interaction === 'hover' ? ['mouseEnter', 'mouseLeave'] : ['clickStart', 'click'],
        styles_applied: styles ?? {},
      });
    }

    if (action === 'create') {
      const variantName: string = typeof args.variant === 'string' ? args.variant.trim() : '';
      if (!variantName) return fail('Variant name is required for action "create".');
      if (!VARIANT_NAME_RE.test(variantName)) {
        return fail(`Invalid variant name "${variantName}" — use letters, digits, '_' or '-'.`);
      }

      const existingConfigs = parseVariantConfig(masterCode);
      if (existingConfigs.some((v) => v.name === variantName)) {
        return fail(`Variant "${variantName}" already exists on component "${componentName}".`);
      }

      const added = addVariant(info.filePath, variantName, undefined, undefined, parentVariant);
      if (!added) {
        return fail(`Failed to create variant "${variantName}" on component "${componentName}".`);
      }

      const styles = args.styles as Record<string, string> | undefined;
      if (styles && Object.keys(styles).length > 0) {
        modifyProjectFile(info.filePath, (code) => {
          const targetNodeId = (typeof args.element === 'string' && args.element.trim()) ? args.element.trim() : findVariantRootId(code);
          if (!targetNodeId) return code;
          return updateVariantStyleInCode(code, targetNodeId, variantName, styles);
        });
      }

      store.set(projectVersionAtom, (v) => v + 1);

      trace.action('agent-tool:manage_component_variant:create', {
        component: componentName,
        variant: variantName,
      });

      return ok({
        component: componentName,
        variant: variantName,
        parent_variant: parentVariant,
        styles_applied: styles ?? {},
      });
    }

    if (action === 'set_styles') {
      const variantName: string = typeof args.variant === 'string' ? args.variant.trim() : '';
      if (!variantName) return fail('Variant name is required for action "set_styles".');

      const styles = args.styles as Record<string, string> | undefined;
      if (!styles || Object.keys(styles).length === 0) {
        return fail('Styles record is required for action "set_styles".');
      }

      modifyProjectFile(info.filePath, (code) => {
        const targetNodeId = (typeof args.element === 'string' && args.element.trim()) ? args.element.trim() : findVariantRootId(code);
        if (!targetNodeId) return code;
        return updateVariantStyleInCode(code, targetNodeId, variantName, styles);
      });

      store.set(projectVersionAtom, (v) => v + 1);

      trace.action('agent-tool:manage_component_variant:set_styles', {
        component: componentName,
        variant: variantName,
      });

      return ok({
        component: componentName,
        variant: variantName,
        styles_applied: styles,
      });
    }

    return fail(`Unknown action "${action}".`);
  },
};
