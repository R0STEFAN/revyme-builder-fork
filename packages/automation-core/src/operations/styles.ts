// packages/automation-core/src/operations/styles.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import {
  updateHoverStyleInCode,
  updatePseudoStyleInCode,
  updateContainerQueryStyle,
  updateVariantStyleInCode,
  type PseudoRuleKind,
} from '@/code/generation/generator-styles';

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

// 1. styles.get
export const stylesGetOperation: Operation<
  { filePath?: string; nodeId: string },
  { nodeId: string; styles: Record<string, string> }
> = {
  name: 'styles.get',
  description: 'Get parsed inline CSS styles for a node',
  category: 'styles',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const { code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const node = nodes.get(input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found in source`);
    }
    return {
      nodeId: input.nodeId,
      styles: node.styles || {},
    };
  },
};

// 2. styles.set
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
    const { path, code } = getTargetFile(snapshot, input.filePath);
    let nextCode = code;

    if (input.variantName) {
      nextCode = updateVariantStyleInCode(nextCode, input.nodeId, input.variantName, input.styles);
    } else if (input.pseudo) {
      const cleanPseudo = input.pseudo.replace(/^:+/, '');
      if (cleanPseudo === 'hover') {
        nextCode = updateHoverStyleInCode(nextCode, input.nodeId, input.styles);
      } else {
        nextCode = updatePseudoStyleInCode(
          nextCode,
          input.nodeId,
          cleanPseudo as PseudoRuleKind,
          input.styles
        );
      }
    } else if (input.breakpoint) {
      const width = resolveBreakpointWidth(input.breakpoint);
      nextCode = updateContainerQueryStyle(nextCode, input.nodeId, width, input.styles);
    } else {
      nextCode = updateNodeInCode(nextCode, input.nodeId, input.styles);
    }

    return {
      nodeId: input.nodeId,
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
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'styles.remove',
  description: 'Remove specific style properties from a node by passing empty string values',
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
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    let nextCode = code;

    // Invariant 3: empty string deletes property
    const removalStyles: Record<string, string> = {};
    for (const prop of input.properties) {
      removalStyles[prop] = '';
    }

    if (input.pseudo) {
      const cleanPseudo = input.pseudo.replace(/^:+/, '');
      if (cleanPseudo === 'hover') {
        nextCode = updateHoverStyleInCode(nextCode, input.nodeId, removalStyles);
      } else {
        nextCode = updatePseudoStyleInCode(
          nextCode,
          input.nodeId,
          cleanPseudo as PseudoRuleKind,
          removalStyles
        );
      }
    } else if (input.breakpoint) {
      const width = resolveBreakpointWidth(input.breakpoint);
      nextCode = updateContainerQueryStyle(nextCode, input.nodeId, width, removalStyles);
    } else {
      nextCode = updateNodeInCode(nextCode, input.nodeId, removalStyles);
    }

    return {
      nodeId: input.nodeId,
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
