// packages/automation-core/src/operations/framer-query.ts
import fs from 'node:fs';
import { z } from 'zod';
import type { Operation, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  inspectNativeTransfer,
  extractTransferTokens,
  extractTransferSlice,
  extractTransferCms,
  type FramerProjectSummary,
  type FramerTransferTokens,
  type FramerSemanticSlice,
  type FramerTransferCms,
} from '@/code/import/framer-native/agent-slice';

const transferCache = new Map<string, unknown>();

function loadTransfer(input: { filePath?: string; rawJson?: string }, snapshot: Snapshot): unknown {
  if (input.rawJson) {
    try {
      return JSON.parse(input.rawJson);
    } catch (e) {
      throw new Error(`INVALID_JSON: Failed to parse rawJson: ${String(e)}`);
    }
  }
  if (!input.filePath) {
    throw new Error('MISSING_INPUT: Either filePath or rawJson must be provided.');
  }

  // 1. Check in-memory snapshot
  const fromSnapshot = snapshot.files.get(input.filePath);
  if (fromSnapshot) {
    return JSON.parse(fromSnapshot);
  }

  // 2. Check projectFS
  const fromProjectFS = projectFS.readFile(input.filePath);
  if (fromProjectFS) {
    return JSON.parse(fromProjectFS);
  }

  // 3. Check direct disk filesystem
  if (fs.existsSync(input.filePath)) {
    const content = fs.readFileSync(input.filePath, 'utf-8');
    return JSON.parse(content);
  }

  throw new Error(`FILE_NOT_FOUND: Could not find Framer capture file at "${input.filePath}".`);
}

function getCachedTransfer(input: { filePath?: string; rawJson?: string }, snapshot: Snapshot): unknown {
  const cacheKey = input.filePath ?? (input.rawJson ? `raw:${input.rawJson.length}:${input.rawJson.slice(0, 32)}` : '');
  if (cacheKey && transferCache.has(cacheKey)) {
    return transferCache.get(cacheKey);
  }
  const loaded = loadTransfer(input, snapshot);
  if (cacheKey) {
    if (transferCache.size > 20) transferCache.clear();
    transferCache.set(cacheKey, loaded);
  }
  return loaded;
}

// 1. framer.inspect
export const framerInspectInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerInspectOperation: Operation<
  z.infer<typeof framerInspectInputSchema>,
  FramerProjectSummary
> = {
  name: 'framer.inspect',
  description: 'Inspect a Framer native capture file and return project summary, components, tokens, pages, and CMS counts',
  category: 'framer',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerInspectInputSchema,
  async execute(snapshot, input) {
    const data = getCachedTransfer(input, snapshot);
    return inspectNativeTransfer(data);
  },
};

// 2. framer.tokens
export const framerTokensInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerTokensOperation: Operation<
  z.infer<typeof framerTokensInputSchema>,
  FramerTransferTokens
> = {
  name: 'framer.tokens',
  description: 'Extract design tokens (colors, typography presets, fonts) from a Framer capture for Revyme tokens.set',
  category: 'framer',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerTokensInputSchema,
  async execute(snapshot, input) {
    const data = getCachedTransfer(input, snapshot);
    return extractTransferTokens(data);
  },
};

// 3. framer.slice
export const framerSliceInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
  nodeId: z.string().min(1),
  maxDepth: z.number().int().positive().optional().default(10),
  viewport: z.enum(['desktop', 'tablet', 'phone']).optional().default('desktop'),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerSliceOperation: Operation<
  z.infer<typeof framerSliceInputSchema>,
  FramerSemanticSlice
> = {
  name: 'framer.slice',
  description: 'Extract a clean semantic slice of a specific section or component node with computed CSS styles',
  category: 'framer',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerSliceInputSchema,
  async execute(snapshot, input) {
    const data = getCachedTransfer(input, snapshot);
    return extractTransferSlice(data, input.nodeId, {
      maxDepth: input.maxDepth,
      viewport: input.viewport,
    });
  },
};

// 4. framer.cms
export const framerCmsInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
  collectionId: z.string().optional(),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerCmsOperation: Operation<
  z.infer<typeof framerCmsInputSchema>,
  FramerTransferCms
> = {
  name: 'framer.cms',
  description: 'Extract CMS collections with schema fields and item data from a Framer capture for Revyme cms.*',
  category: 'framer',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerCmsInputSchema,
  async execute(snapshot, input) {
    const data = getCachedTransfer(input, snapshot);
    return extractTransferCms(data, input.collectionId);
  },
};

// Auto-register operations into defaultRegistry
defaultRegistry.register(framerInspectOperation);
defaultRegistry.register(framerTokensOperation);
defaultRegistry.register(framerSliceOperation);
defaultRegistry.register(framerCmsOperation);
