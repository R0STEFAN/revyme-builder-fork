// packages/automation-core/src/operations/text.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { replaceNodeTextContent } from '@/code/generation/generator-crud';

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
  { filePath?: string; nodeId: string },
  { nodeId: string; textContent: string }
> = {
  name: 'text.get',
  description: 'Get parsed text content of a JSX element',
  category: 'text',
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
      textContent: node.textContent || '',
    };
  },
};

// 2. text.set
export const textSetOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    textContent: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'text.set',
  description: 'Update text content of a node in JSX source',
  category: 'text',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    textContent: z.string(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nextCode = replaceNodeTextContent(code, input.nodeId, input.textContent);

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

// Register text operations
defaultRegistry.register(textGetOperation);
defaultRegistry.register(textSetOperation);
