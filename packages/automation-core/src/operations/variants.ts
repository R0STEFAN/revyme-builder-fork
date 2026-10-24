// packages/automation-core/src/operations/variants.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parseVariantConfig,
  type VariantConfig,
} from '@/code/variants/variant-config';
import {
  addVariantToCode,
  removeVariantFromCode,
  renameVariantInCode,
} from '@/code/variants/variant-ops';
import { addConnectionToCode, removeConnectionFromCode } from '@/code/variants/connection-config';
import { setVariantVisibilityInCode } from '@/code/generation/variant-visibility-gen';
import { parseJSXToNodes } from '@/code/parsing/parser';

// 1. variants.list
export const variantsListOperation: Operation<
  { componentFile: string },
  { variants: VariantConfig[] }
> = {
  name: 'variants.list',
  description: 'List all variants configured on a component master file',
  category: 'variants',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const configs = parseVariantConfig(code);
    return { variants: configs };
  },
};

// 2. variants.create
export const variantsCreateOperation: Operation<
  {
    componentFile: string;
    name: string;
    label?: string;
    position?: { x: number; y: number };
    sourceVariant?: string;
    interaction?: { type: 'hover' | 'pressed'; parent: string; sourceNode?: string };
  },
  {
    changes: FileChange[];
    configs: VariantConfig[];
  }
> = {
  name: 'variants.create',
  description: 'Create a new variant or interaction state on a component master',
  category: 'variants',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    name: z.string().min(1),
    label: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    sourceVariant: z.string().optional(),
    interaction: z
      .object({
        type: z.enum(['hover', 'pressed']),
        parent: z.string().min(1),
        sourceNode: z.string().min(1).optional(),
      })
      .optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    if (input.interaction?.sourceNode && !parseJSXToNodes(code).has(input.interaction.sourceNode)) {
      throw new Error(`NODE_NOT_FOUND: Variant interaction source node "${input.interaction.sourceNode}" does not exist in component`);
    }

    const { code: variantCode, configs } = addVariantToCode(code, {
      name: input.name,
      label: input.label,
      position: input.position,
      sourceVariant: input.sourceVariant,
      interaction: input.interaction,
    });

    let nextCode = variantCode;
    if (input.interaction) {
      const { type, parent, sourceNode } = input.interaction;
      if (!parseVariantConfig(code).some(v => v.name === parent)) {
        throw new Error(`VARIANT_NOT_FOUND: Interaction parent variant "${parent}" does not exist on component`);
      }
      const sibling = parseVariantConfig(code).find(v =>
        v.parentVariant === parent && v.interactionType && v.interactionType !== type,
      );
      const forwardTrigger = type === 'hover' ? 'mouseEnter' : 'clickStart';
      const reverseTrigger = type === 'hover' ? 'mouseLeave' : 'click';
      const add = (from: string, to: string, trigger: typeof forwardTrigger | typeof reverseTrigger) => {
        nextCode = addConnectionToCode(nextCode, from, to, trigger, undefined, sourceNode).code;
      };

      if (!sibling) {
        add(parent, input.name, forwardTrigger);
        add(input.name, parent, reverseTrigger);
      } else if (type === 'pressed') {
        add(sibling.name, input.name, 'clickStart');
        add(input.name, sibling.name, 'click');
      } else {
        nextCode = removeConnectionFromCode(nextCode, sibling.name, parent, { trigger: 'click' }).code;
        add(parent, input.name, 'mouseEnter');
        add(input.name, parent, 'mouseLeave');
        add(input.name, sibling.name, 'clickStart');
        add(sibling.name, input.name, 'click');
      }
    }

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      configs,
    };
  },
};

// 3. variants.rename
export const variantsRenameOperation: Operation<
  {
    componentFile: string;
    name: string;
    newLabel: string;
  },
  {
    changes: FileChange[];
    configs: VariantConfig[];
  }
> = {
  name: 'variants.rename',
  description: 'Rename the display label of a variant on a component master',
  category: 'variants',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    name: z.string().min(1),
    newLabel: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const { code: nextCode, configs } = renameVariantInCode(
      code,
      input.name,
      input.newLabel,
    );

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      configs,
    };
  },
};

// 4. variants.remove
export const variantsRemoveOperation: Operation<
  {
    componentFile: string;
    name: string;
  },
  {
    changes: FileChange[];
    configs: VariantConfig[];
  }
> = {
  name: 'variants.remove',
  description: 'Remove a variant from a component master (primary variant cannot be removed)',
  category: 'variants',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    name: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const configs = parseVariantConfig(code);
    const target = configs.find((v) => v.name === input.name);
    if (!target) {
      throw new Error(`VARIANT_NOT_FOUND: Variant "${input.name}" not found in "${input.componentFile}"`);
    }
    if (target.isPrimary) {
      throw new Error(`CANNOT_REMOVE_PRIMARY: Primary variant "${input.name}" cannot be removed`);
    }

    const { code: nextCode, configs: nextConfigs } = removeVariantFromCode(code, input.name);

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      configs: nextConfigs,
    };
  },
};

// 5. variants.visibility.set
export const variantsVisibilitySetOperation: Operation<
  {
    componentFile: string;
    nodeId: string;
    hiddenOnVariants: string[];
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'variants.visibility.set',
  description: 'Configure element visibility across variants using AnimatePresence',
  category: 'variants',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    nodeId: z.string().min(1),
    hiddenOnVariants: z.array(z.string()),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const configs = parseVariantConfig(code);
    const allVariantNames = configs.map((c) => c.name);

    const nextCode = setVariantVisibilityInCode(
      code,
      input.nodeId,
      input.hiddenOnVariants,
      allVariantNames,
    );

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

defaultRegistry.register(variantsListOperation);
defaultRegistry.register(variantsCreateOperation);
defaultRegistry.register(variantsRenameOperation);
defaultRegistry.register(variantsRemoveOperation);
defaultRegistry.register(variantsVisibilitySetOperation);
