// packages/automation-core/src/operations/framer-query.ts
import fs from 'node:fs';
import { z } from 'zod';
import type { Operation, Snapshot, OperationContext, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { syncCodeSnapshotToProjectFS } from './code-components';
import {
  inspectNativeTransfer,
  extractTransferTokens,
  extractTransferSlice,
  extractTransferCms,
  extractTransferComponent,
  type FramerProjectSummary,
  type FramerTransferTokens,
  type FramerSemanticSlice,
  type FramerTransferCms,
  type FramerComponentDetail,
} from '@/code/import/framer-native/agent-slice';
import {
  normalizeNativeTransfer,
  type RevymeTransferIR,
} from '@/code/import/framer-native/normalizer';
import { compileNativeTransfer } from '@/code/import/framer-native/compile';
import { applyRuntimeGuarantees } from '@/code/generation/runtime-guarantees';

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

// 5. framer.component
export const framerComponentInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
  componentId: z.string().min(1),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerComponentOperation: Operation<
  z.infer<typeof framerComponentInputSchema>,
  FramerComponentDetail
> = {
  name: 'framer.component',
  description: 'Inspect a Framer SmartComponent by ID or name to extract variables, variants, transitions, and interactions',
  category: 'framer',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerComponentInputSchema,
  async execute(snapshot, input) {
    const data = getCachedTransfer(input, snapshot);
    return extractTransferComponent(data, input.componentId);
  },
};

// 6. framer.normalize
export const framerNormalizeInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerNormalizeOperation: Operation<
  z.infer<typeof framerNormalizeInputSchema>,
  RevymeTransferIR
> = {
  name: 'framer.normalize',
  description: 'Normalize raw Framer native capture into clean Revyme Transfer IR with components, tokens, CMS, and pages',
  category: 'framer',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerNormalizeInputSchema,
  async execute(snapshot, input) {
    const data = getCachedTransfer(input, snapshot);
    return normalizeNativeTransfer(data);
  },
};

// 7. framer.compile
export const framerCompileInputSchema = z.object({
  filePath: z.string().optional(),
  rawJson: z.string().optional(),
  commit: z.boolean().optional(),
}).refine(data => data.filePath || data.rawJson, {
  message: 'Either filePath or rawJson must be provided',
});

export const framerCompileOperation: Operation<
  z.infer<typeof framerCompileInputSchema>,
  {
    success: boolean;
    filesCount: number;
    files: Array<{ path: string }>;
    diagnostics: Array<{ code: string; message: string; sourceId?: string; property?: string }>;
  }
> = {
  name: 'framer.compile',
  description: 'Compile Framer native transfer into 100% native Revyme Next.js components, CMS collections, and pages with automatic library folder organization',
  category: 'framer',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T-framer-mcp',
  inputSchema: framerCompileInputSchema,
  async execute(snapshot, input, context) {
    let raw = getCachedTransfer(input, snapshot) as any;

    if (raw && raw.format === 'revyme.ir.v1' && input.filePath) {
      const candidates = [
        input.filePath.replace('framer-clean-', 'framer-native-'),
        input.filePath.replace(/clean/i, 'native'),
        raw.metadata?.projectId ? `/home/rost/Завантажене/framer-native-${raw.metadata.projectId}.json` : '',
      ].filter(Boolean);
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try {
            raw = JSON.parse(fs.readFileSync(cand, 'utf8'));
            break;
          } catch {}
        }
      }
    }

    const sync = syncCodeSnapshotToProjectFS(snapshot);

    const uploadedAssets: Record<string, string> = {};
    if (Array.isArray(raw?.assets)) {
      for (const a of raw.assets) {
        if (a && typeof a.key === 'string' && typeof a.url === 'string') {
          uploadedAssets[a.key] = a.url;
        }
      }
    }

    const existingFiles = new Map<string, string>(snapshot.files);
    if (!existingFiles.has('app/layout.tsx')) {
      const fsLayout = projectFS.readFile('app/layout.tsx');
      existingFiles.set('app/layout.tsx', fsLayout || `import './globals.css';\nexport default function RootLayout({ children }: { children: React.ReactNode }) { return (<html lang="en"><body>{children}</body></html>); }\n`);
    }
    if (!existingFiles.has('app/globals.css')) {
      const fsCss = projectFS.readFile('app/globals.css');
      existingFiles.set('app/globals.css', fsCss || 'body { margin: 0; }\n');
    }

    const compileResult = compileNativeTransfer(raw, {
      mode: 'create',
      existingFiles,
      uploadedAssets,
      tolerant: true,
      replaceHomePage: true,
      overwrite: true,
    });

    const shouldCommit = input.commit !== false;
    if (compileResult.files.length > 0) {
      for (const file of compileResult.files) {
        if (/\.(tsx|jsx)$/.test(file.path)) {
          file.code = applyRuntimeGuarantees(file.code);
        }
        if (shouldCommit) {
          projectFS.writeFile(file.path, file.code);
        }
      }
    }

    const changes = shouldCommit ? sync.collectChanges() : [];

    return {
      success: compileResult.files.length > 0,
      filesCount: compileResult.files.length,
      files: compileResult.files.map(f => ({ path: f.path })),
      changes,
      createdIds: compileResult.createdIds,
      diagnostics: compileResult.diagnostics,
    };
  },
};

// Auto-register operations into defaultRegistry
defaultRegistry.register(framerInspectOperation);
defaultRegistry.register(framerTokensOperation);
defaultRegistry.register(framerSliceOperation);
defaultRegistry.register(framerCmsOperation);
defaultRegistry.register(framerComponentOperation);
defaultRegistry.register(framerNormalizeOperation);
defaultRegistry.register(framerCompileOperation);
