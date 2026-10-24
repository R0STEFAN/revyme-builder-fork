// packages/automation-core/src/operations/viewports.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { updateContainerQueryStyle } from '@/code/generation/generator-styles';
import { parseCanvasConfig, updateCanvasConfigInCode } from '@/code/project/canvas-config';
import { DEFAULT_BREAKPOINT_STARTS, VIEWPORT_GAP } from '@/shared/constants';

export interface ViewportDefinition {
  id: string;
  name: string;
  width: number;
  isPrimary?: boolean;
}

export const DEFAULT_VIEWPORTS: ViewportDefinition[] = [
  { id: 'desktop', name: 'Desktop', width: 1200, isPrimary: true },
  { id: 'tablet', name: 'Tablet', width: DEFAULT_BREAKPOINT_STARTS.tablet },
  { id: 'mobile', name: 'Mobile', width: DEFAULT_BREAKPOINT_STARTS.mobile },
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
    } else {
      const requestedName = input.viewport.trim().toLowerCase();
      const configured = parseCanvasConfig(code)?.viewports.find(
        (viewport) => viewport.id.toLowerCase() === requestedName || viewport.label.toLowerCase() === requestedName,
      );
      if (configured) {
        width = configured.width;
      } else {
        const normalized = DEFAULT_VIEWPORTS.find((viewport) =>
          viewport.id === requestedName || viewport.name.toLowerCase() === requestedName,
        );
        const parsed = parseInt(input.viewport, 10);
        width = normalized?.width ?? (Number.isFinite(parsed) ? parsed : DEFAULT_BREAKPOINT_STARTS.tablet);
      }
    }

    let nextCode = updateContainerQueryStyle(code, input.nodeId, width, input.styles);
    const canvas = parseCanvasConfig(code);
    if (canvas) {
      const requestedName = typeof input.viewport === 'string' ? input.viewport.trim().toLowerCase() : '';
      const hasViewport = canvas.viewports.some((viewport) =>
        viewport.id.toLowerCase() === requestedName ||
        viewport.label.toLowerCase() === requestedName ||
        viewport.width === width ||
        viewport.designWidth === width,
      );

      if (!hasViewport) {
        let viewports = canvas.viewports;
        let positions = { ...canvas.positions };
        if (viewports.length === 0) {
          const desktop = DEFAULT_VIEWPORTS[0];
          viewports = [{
            id: desktop.id,
            label: desktop.name,
            width: desktop.width,
            isPrimary: true,
            order: 0,
            x: 0,
            y: 0,
          }];
          positions[desktop.id] = { x: 0, y: 0 };
        }

        const preset = typeof input.viewport === 'string'
          ? DEFAULT_VIEWPORTS.find((viewport) =>
            viewport.id === requestedName || viewport.name.toLowerCase() === requestedName,
          )
          : DEFAULT_VIEWPORTS.find((viewport) => viewport.width === width);
        let id = preset?.id ?? `bp-${width}`;
        for (let suffix = 2; viewports.some((viewport) => viewport.id === id); suffix++) {
          id = `${preset?.id ?? `bp-${width}`}-${suffix}`;
        }
        const label = preset?.name ?? `${width}px`;
        const rightmost = viewports.reduce((right, viewport) => {
          const position = positions[viewport.id] ?? { x: 0, y: 0 };
          const renderedWidth = viewport.designWidth ?? viewport.width;
          return Math.max(right, position.x + renderedWidth);
        }, 0);
        const addedViewport = {
          id,
          label,
          width,
          isPrimary: false,
          order: Math.max(-1, ...viewports.map((viewport) => viewport.order ?? 0)) + 1,
          x: rightmost + VIEWPORT_GAP,
          y: 0,
        };
        viewports = [...viewports, addedViewport];
        positions = { ...positions, [id]: { x: addedViewport.x, y: addedViewport.y } };
        nextCode = updateCanvasConfigInCode(nextCode, { viewports, positions });
      }
    }

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
