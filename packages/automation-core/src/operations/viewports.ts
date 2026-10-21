// packages/automation-core/src/operations/viewports.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { updateContainerQueryStyle } from '@/code/generation/generator-styles';

export interface ViewportDefinition {
  id: string;
  name: string;
  width: number;
  isPrimary?: boolean;
}

export const DEFAULT_VIEWPORTS: ViewportDefinition[] = [
  { id: 'desktop', name: 'Desktop', width: 1200, isPrimary: true },
  { id: 'tablet', name: 'Tablet', width: 768 },
  { id: 'mobile', name: 'Mobile', width: 375 },
];

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

// 1. viewports.list
export const viewportsListOperation: Operation<
  Record<string, never>,
  { viewports: ViewportDefinition[] }
> = {
  name: 'viewports.list',
  description: 'List supported responsive viewports and breakpoints',
  category: 'viewports',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({}),
  async execute() {
    return {
      viewports: DEFAULT_VIEWPORTS,
    };
  },
};

// 2. viewports.setOverride
export const viewportsSetOverrideOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    viewport: string | number;
    styles: Record<string, string>;
  },
  {
    nodeId: string;
    viewport: string | number;
    changes: FileChange[];
  }
> = {
  name: 'viewports.setOverride',
  description: 'Apply responsive container query style overrides for a specific breakpoint width',
  category: 'viewports',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    viewport: z.union([z.string(), z.number()]),
    styles: z.record(z.string(), z.string()),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    let width: number;

    if (typeof input.viewport === 'number') {
      width = input.viewport;
    } else if (input.viewport === 'mobile') {
      width = 375;
    } else if (input.viewport === 'tablet') {
      width = 768;
    } else if (input.viewport === 'desktop') {
      width = 1200;
    } else {
      const parsed = parseInt(input.viewport, 10);
      width = isNaN(parsed) ? 768 : parsed;
    }

    const nextCode = updateContainerQueryStyle(code, input.nodeId, width, input.styles);

    return {
      nodeId: input.nodeId,
      viewport: input.viewport,
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

// Register viewports operations
defaultRegistry.register(viewportsListOperation);
defaultRegistry.register(viewportsSetOverrideOperation);
