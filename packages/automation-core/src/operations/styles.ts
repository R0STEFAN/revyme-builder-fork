// packages/automation-core/src/operations/styles.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes, extractStyleCSS, type CanvasNode } from '@/code/parsing/parser';
import { normalizePseudoKind, parsePseudoRules, type PseudoStyles } from '@/code/parsing/pseudo-parser';
import { parseVariantConfig } from '@/code/variants/variant-config';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import {
  updatePseudoStyleInCode,
  updateContainerQueryStyle,
  applyVariantStyleUpdateInCode,
  type PseudoRuleKind,
} from '@/code/generation/generator-styles';
import { normalizeStylePatch } from '../ingestion/styles';

export function resolveTargetNode(
  nodes: Map<string, CanvasNode>,
  nodeId: string,
): { node: CanvasNode | undefined; effectiveNodeId: string } {
  const direct = nodes.get(nodeId);
  if (direct) return { node: direct, effectiveNodeId: nodeId };
  if (nodeId === 'root') {
    const rootNode = Array.from(nodes.values()).find((n) => n.parentId === null && !n.isCanvasNode);
    if (rootNode) return { node: rootNode, effectiveNodeId: rootNode.id };
  }
  return { node: undefined, effectiveNodeId: nodeId };
}

export function mergeNodeVariantStyles(node: CanvasNode): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {};
  if (node.motionVariants) {
    for (const [variantName, props] of Object.entries(node.motionVariants)) {
      if (!props || typeof props !== 'object') continue;
      merged[variantName] = { ...(merged[variantName] ?? {}), ...props };
    }
  }
  if (node.conditionalStyles) {
    for (const [prop, branches] of Object.entries(node.conditionalStyles)) {
      if (!branches || typeof branches !== 'object') continue;
      for (const [variantName, val] of Object.entries(branches)) {
        if (!merged[variantName]) merged[variantName] = {};
        merged[variantName][prop] = val;
      }
    }
  }
  return merged;
}

export function applyVariantAwareStylesToCode(
  code: string,
  nodeId: string,
  styles: Record<string, string>,
  variantName?: string,
): string {
  const nodes = parseJSXToNodes(code);
  const { node, effectiveNodeId } = resolveTargetNode(nodes, nodeId);
  const variants = parseVariantConfig(code);
  const primaryName = (variants.find((v) => v.isPrimary) ?? variants[0])?.name ?? 'default';
  const isVariantComponent = variants.length > 0;

  if (!variantName && !isVariantComponent && !node?.motionVariants && !node?.conditionalStyles) {
    return updateNodeInCode(code, effectiveNodeId, styles);
  }

  return applyVariantStyleUpdateInCode(
    code,
    effectiveNodeId,
    variantName ?? primaryName,
    styles,
    { explicitVariant: Boolean(variantName) },
  );
}

function getTargetFile(snapshot: Snapshot, filePath?: string): { path: string; code: string } {
  let target = filePath;
  if (!target) {
    for (const key of snapshot.files.keys()) {
      if (key.endsWith('page.client.tsx')) {
        target = key;
        break;
      }
    }
  }
  if (!target || !snapshot.files.has(target)) {
    throw new Error(`FILE_NOT_FOUND: Target file "${target || 'default page'}" not found in snapshot`);
  }
  return { path: target, code: snapshot.files.get(target)! };
}

function resolveBreakpointWidth(bp: string | number): number {
  if (typeof bp === 'number') return bp;
  if (bp === 'mobile') return 375;
  if (bp === 'tablet') return 768;
  if (bp === 'desktop') return 1200;
  const parsed = parseInt(bp, 10);
  return isNaN(parsed) ? 768 : parsed;
}

function resolveValidatedPseudo(rawPseudo: string): PseudoRuleKind {
  const normalized = normalizePseudoKind(rawPseudo);
  if (!normalized) {
    throw new Error(
      `INVALID_PSEUDO_SELECTOR: Unsafe or invalid pseudo state "${rawPseudo}". Use a built-in state (:hover, :active, :focus, :focus-visible, :focus-within, :disabled, :checked, ::before, ::after, ::placeholder) or a single-node pseudo/attribute suffix (e.g. [aria-expanded="true"], :nth-child(2n)).`
    );
  }
  return normalized as PseudoRuleKind;
}

// 1. styles.get
export const stylesGetOperation: Operation<
  { filePath?: string; nodeId: string; variantName?: string },
  {
    nodeId: string;
    styles: Record<string, string>;
    baseStyles?: Record<string, string>;
    variantStyles?: Record<string, Record<string, string>>;
    pseudoStyles?: PseudoStyles;
  }
> = {
  name: 'styles.get',
  description: 'Get parsed inline, variant, and pseudo CSS styles for a node',
  category: 'styles',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    variantName: z.string().min(1).optional(),
  }),
  async execute(snapshot, input) {
    const { code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const { node, effectiveNodeId } = resolveTargetNode(nodes, input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found in source`);
    }
    const baseStyles = node.styles || {};
    const variantStyles = mergeNodeVariantStyles(node);
    const hasVariantStyles = Object.keys(variantStyles).length > 0;
    const pseudoStyles = parsePseudoRules(extractStyleCSS(code)).get(effectiveNodeId);
    const hasPseudoStyles = Boolean(pseudoStyles && Object.keys(pseudoStyles).length > 0);

    if (input.variantName) {
      return {
        nodeId: effectiveNodeId,
        styles: {
          ...baseStyles,
          ...(variantStyles.default || {}),
          ...(variantStyles[input.variantName] || {}),
        },
        baseStyles,
        ...(hasVariantStyles ? { variantStyles } : {}),
        ...(hasPseudoStyles ? { pseudoStyles } : {}),
      };
    }

    return {
      nodeId: effectiveNodeId,
      styles: baseStyles,
      ...(hasVariantStyles ? { variantStyles } : {}),
      ...(hasPseudoStyles ? { pseudoStyles } : {}),
    };
  },
};

// 2. styles.set
export const FORBIDDEN_AUTO_STYLE_PROPS = new Set([
  // Padding controls: numeric/multi-unit lengths (padding cannot be 'auto' in CSS)
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  // Gap controls: explicit lengths
  'gap',
  'rowGap',
  'columnGap',
  // Radius controls: explicit lengths
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  // Border width controls: explicit lengths
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  // Opacity: numeric 0..1
  'opacity',
  // Typography controls: explicit lengths/values
  'fontSize',
  'lineHeight',
  'letterSpacing',
  // Color controls
  'color',
  'backgroundColor',
  'borderColor',
  // Enum layouts without auto option
  'display',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'position',
]);

export function validateStylesNotForbiddenAuto(styles: Record<string, string>): void {
  for (const [key, value] of Object.entries(styles)) {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'auto' && FORBIDDEN_AUTO_STYLE_PROPS.has(key)) {
      throw new Error(
        `DISALLOWED_STYLE_VALUE: Style property "${key}" cannot be set to "auto" because it cannot be visually edited in the builder controls.`
      );
    }
  }
}

export const stylesSetOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    styles: Record<string, string>;
    breakpoint?: string | number;
    pseudo?: string;
    variantName?: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'styles.set',
  description: 'Set inline, hover, pseudo, or responsive breakpoint styles on a node',
  category: 'styles',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    styles: z.record(z.string(), z.string()),
    breakpoint: z.union([z.string(), z.number()]).optional(),
    pseudo: z.string().optional(),
    variantName: z.string().min(1).optional(),
  }),
  async execute(snapshot, input) {
    validateStylesNotForbiddenAuto(input.styles);
    const normalizedStyles = normalizeStylePatch(input.styles, {}, undefined, 'style', {
      preserveTransitions: Boolean(input.pseudo),
    });
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const { effectiveNodeId } = resolveTargetNode(parseJSXToNodes(code), input.nodeId);
    let nextCode = code;

    if (input.variantName) {
      nextCode = applyVariantAwareStylesToCode(nextCode, effectiveNodeId, normalizedStyles, input.variantName);
    } else if (input.pseudo) {
      const pseudoKind = resolveValidatedPseudo(input.pseudo);
      nextCode = updatePseudoStyleInCode(nextCode, effectiveNodeId, pseudoKind, normalizedStyles);
    } else if (input.breakpoint) {
      const width = resolveBreakpointWidth(input.breakpoint);
      nextCode = updateContainerQueryStyle(nextCode, effectiveNodeId, width, normalizedStyles);
    } else {
      nextCode = applyVariantAwareStylesToCode(nextCode, effectiveNodeId, normalizedStyles);
    }

    return {
      nodeId: effectiveNodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 3. styles.remove
export const stylesRemoveOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    properties: string[];
    breakpoint?: string | number;
    pseudo?: string;
    variantName?: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'styles.remove',
  description: 'Remove specific style properties from a node or variant by passing empty string values',
  category: 'styles',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    properties: z.array(z.string()).min(1),
    breakpoint: z.union([z.string(), z.number()]).optional(),
    pseudo: z.string().optional(),
    variantName: z.string().min(1).optional(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const { effectiveNodeId } = resolveTargetNode(parseJSXToNodes(code), input.nodeId);
    let nextCode = code;

    // Invariant 3: empty string deletes property
    const removalStyles: Record<string, string> = {};
    for (const prop of input.properties) {
      removalStyles[prop] = '';
    }

    if (input.variantName) {
      nextCode = applyVariantAwareStylesToCode(nextCode, effectiveNodeId, removalStyles, input.variantName);
    } else if (input.pseudo) {
      const pseudoKind = resolveValidatedPseudo(input.pseudo);
      nextCode = updatePseudoStyleInCode(nextCode, effectiveNodeId, pseudoKind, removalStyles);
    } else if (input.breakpoint) {
      const width = resolveBreakpointWidth(input.breakpoint);
      nextCode = updateContainerQueryStyle(nextCode, effectiveNodeId, width, removalStyles);
    } else {
      nextCode = applyVariantAwareStylesToCode(nextCode, effectiveNodeId, removalStyles);
    }

    return {
      nodeId: effectiveNodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// Register styles operations
defaultRegistry.register(stylesGetOperation);
defaultRegistry.register(stylesSetOperation);
defaultRegistry.register(stylesRemoveOperation);
