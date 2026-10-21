// packages/automation-core/src/operations/layout.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import { parseJSXToNodes } from '@/code/parsing/parser';

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

// 1. layout.set
export const layoutSetOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    display?: string;
    flexDirection?: string;
    alignItems?: string;
    justifyContent?: string;
    gap?: string;
    flexWrap?: string;
    gridTemplateColumns?: string;
    gridTemplateRows?: string;
    gridArea?: string;
    gridColumn?: string;
    gridRow?: string;
    width?: string;
    height?: string;
    minWidth?: string;
    maxWidth?: string;
    minHeight?: string;
    maxHeight?: string;
    position?: string;
    top?: string;
    left?: string;
    right?: string;
    bottom?: string;
    zIndex?: number | string;
    overflow?: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'layout.set',
  description: 'Set layout, sizing, flex/grid properties, and pin/inset coordinates',
  category: 'layout',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    display: z.string().optional(),
    flexDirection: z.string().optional(),
    alignItems: z.string().optional(),
    justifyContent: z.string().optional(),
    gap: z.string().optional(),
    flexWrap: z.string().optional(),
    gridTemplateColumns: z.string().optional(),
    gridTemplateRows: z.string().optional(),
    gridArea: z.string().optional(),
    gridColumn: z.string().optional(),
    gridRow: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    minWidth: z.string().optional(),
    maxWidth: z.string().optional(),
    minHeight: z.string().optional(),
    maxHeight: z.string().optional(),
    position: z.string().optional(),
    top: z.string().optional(),
    left: z.string().optional(),
    right: z.string().optional(),
    bottom: z.string().optional(),
    zIndex: z.union([z.number(), z.string()]).optional(),
    overflow: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);

    const styleUpdates: Record<string, string> = {};
    if (input.display !== undefined) styleUpdates.display = input.display;
    if (input.flexDirection !== undefined) styleUpdates.flexDirection = input.flexDirection;
    if (input.alignItems !== undefined) styleUpdates.alignItems = input.alignItems;
    if (input.justifyContent !== undefined) styleUpdates.justifyContent = input.justifyContent;
    if (input.gap !== undefined) styleUpdates.gap = input.gap;
    if (input.flexWrap !== undefined) styleUpdates.flexWrap = input.flexWrap;
    if (input.gridTemplateColumns !== undefined) styleUpdates.gridTemplateColumns = input.gridTemplateColumns;
    if (input.gridTemplateRows !== undefined) styleUpdates.gridTemplateRows = input.gridTemplateRows;
    if (input.gridArea !== undefined) styleUpdates.gridArea = input.gridArea;
    if (input.gridColumn !== undefined) styleUpdates.gridColumn = input.gridColumn;
    if (input.gridRow !== undefined) styleUpdates.gridRow = input.gridRow;
    if (input.width !== undefined) styleUpdates.width = input.width;
    if (input.height !== undefined) styleUpdates.height = input.height;
    if (input.minWidth !== undefined) styleUpdates.minWidth = input.minWidth;
    if (input.maxWidth !== undefined) styleUpdates.maxWidth = input.maxWidth;
    if (input.minHeight !== undefined) styleUpdates.minHeight = input.minHeight;
    if (input.maxHeight !== undefined) styleUpdates.maxHeight = input.maxHeight;
    if (input.position !== undefined) styleUpdates.position = input.position;
    if (input.top !== undefined) styleUpdates.top = input.top;
    if (input.left !== undefined) styleUpdates.left = input.left;
    if (input.right !== undefined) styleUpdates.right = input.right;
    if (input.bottom !== undefined) styleUpdates.bottom = input.bottom;
    if (input.zIndex !== undefined) styleUpdates.zIndex = String(input.zIndex);
    if (input.overflow !== undefined) styleUpdates.overflow = input.overflow;

    const nextCode = updateNodeInCode(code, input.nodeId, styleUpdates);

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

// Register layout operations
defaultRegistry.register(layoutSetOperation);
