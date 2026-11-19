// packages/automation-core/src/operations/text.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { parseVariantConfig } from '@/code/variants/variant-config';
import { ensureInitialVariantParam } from '@/code/generation/generator-styles';
import { replaceNodeTextContent, updateVariantTextInCode } from '@/code/generation/generator-crud';
import { resolveTargetNode } from './styles';

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

// 1. text.get
export const textGetOperation: Operation<
  { filePath?: string; nodeId: string; variantName?: string },
  {
    nodeId: string;
    textContent: string;
    variantTexts?: Record<string, string>;
    textVariable?: string;
  }
> = {
  name: 'text.get',
  description: 'Get parsed text content (and optional per-variant texts) of a JSX element',
  category: 'text',
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
    const variantTexts = node.conditionalText || undefined;
    const resolvedText =
      input.variantName && variantTexts && input.variantName in variantTexts
        ? variantTexts[input.variantName]
        : (node.textContent || '');
    return {
      nodeId: effectiveNodeId,
      textContent: resolvedText,
      ...(variantTexts ? { variantTexts } : {}),
      ...(node.textVariable ? { textVariable: node.textVariable } : {}),
    };
  },
};

// 2. text.set
export const textSetOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    textContent: string;
    variantName?: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'text.set',
  description: 'Update text content of a node or specific component variant in JSX source',
  category: 'text',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    textContent: z.string(),
    variantName: z.string().min(1).optional(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const { node, effectiveNodeId } = resolveTargetNode(nodes, input.nodeId);
    const variants = parseVariantConfig(code);
    const primaryName = (variants.find((v) => v.isPrimary) ?? variants[0])?.name ?? 'default';

    let nextCode: string;
    if (input.variantName || (node?.conditionalText && Object.keys(node.conditionalText).length > 0)) {
      const targetVariant = input.variantName
        ? (input.variantName === primaryName ? 'default' : input.variantName)
        : 'default';
      nextCode = ensureInitialVariantParam(
        updateVariantTextInCode(code, effectiveNodeId, targetVariant, input.textContent),
      );
    } else {
      nextCode = replaceNodeTextContent(code, effectiveNodeId, input.textContent);
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

// Register text operations
defaultRegistry.register(textGetOperation);
defaultRegistry.register(textSetOperation);
