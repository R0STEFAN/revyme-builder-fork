// packages/automation-core/src/operations/observe.ts
import { z } from 'zod';
import type { Operation, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { DEFAULT_VIEWPORTS } from './viewports';
import { parseJSXToNodes, type CanvasNode } from '@/code/parsing/parser';
import { parseCanvasConfig } from '@/code/project/canvas-config';
import { getAllSlotConnections } from '@/code/generation/slot-ops';
import {
  findNodeRect,
  findNodeComputedStyles,
  getRectInViewportSpace,
} from '@/canvas/node-ops';
import { getScreenCornersById } from '@/canvas/resize/geometry-utils';
import {
  collectEpochSnapshot,
  observationStatusWithEpoch,
  type ObservationEpoch,
  type ObservationStatus,
} from '@/ai/agent/tools/observation-epoch';
import {
  collectLayoutSnapshot,
  runDesignAudit,
  buildViewportTile,
  contrastRatio,
  formatContrastRatio,
  type AuditNode,
} from '@/ai/agent/tools/design-audit';
import {
  detectRegions,
  balanceAnalysis,
  alignmentAnalysis,
  proportionAnalysis,
  typeHierarchy,
  gapAnalysis,
  formatCompositionReport,
} from '@/ai/agent/tools/composition';
import { getDefaultStore } from 'jotai';
import { selectedIdsAtom } from '@/code/stores/store';

// ─── Helpers: Target File & Viewport Resolution ──────────────────────────────

export function getTargetPageFile(snapshot: Snapshot, filePath?: string): { path: string; code: string } {
  let target = filePath;
  if (!target) {
    for (const key of snapshot.files.keys()) {
      if (key.endsWith('page.client.tsx') || key.endsWith('page.tsx')) {
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

export function resolveTargetViewport(code: string, raw?: unknown): { id: string; width: number | null } {
  const config = parseCanvasConfig(code);
  const widths: Record<string, number> = Object.fromEntries(
    DEFAULT_VIEWPORTS.map((viewport) => [viewport.id, viewport.width]),
  );
  if (config && config.viewports && config.viewports.length > 0) {
    for (const vp of config.viewports) {
      widths[vp.id] = vp.width;
    }
  } else {
    widths['desktop'] = 1200;
    widths['tablet'] = 768;
    widths['mobile'] = 375;
  }

  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))) {
    const px = Number(typeof raw === 'string' ? raw.trim() : raw);
    for (const [id, w] of Object.entries(widths)) {
      if (w === px) return { id, width: w };
    }
    return { id: String(raw), width: null };
  }

  if (typeof raw === 'string' && raw.trim() !== '') {
    const id = raw.trim();
    return { id, width: widths[id] ?? null };
  }

  return { id: 'desktop', width: widths['desktop'] ?? 1200 };
}

export const layoutRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type LayoutRect = z.infer<typeof layoutRectSchema>;

// ─── 1. observe.selection ───────────────────────────────────────────────────

export const observeSelectionInputSchema = z.object({
  filePath: z.string().optional().describe('Target page file path (defaults to active client page)'),
  viewport: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width in px'),
  vpId: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width in px (alias)'),
  nodeIds: z.array(z.string()).optional().describe('Explicit node IDs to inspect (overrides live selection store)'),
  includeBounds: z.boolean().optional().describe('Whether to calculate union bounding rect'),
  includeMetadata: z.boolean().optional().describe('Whether to resolve detailed node metadata'),
});

export const selectionNodeMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  isComponent: z.boolean(),
  componentFile: z.string().nullable(),
  rect: layoutRectSchema.nullable(),
  status: z.enum(['measured', 'unmeasured']),
});

export const observeSelectionOutputSchema = z.object({
  selectedIds: z.array(z.string()),
  primaryId: z.string().nullable(),
  count: z.number().int().nonnegative(),
  isMultiSelect: z.boolean(),
  viewport: z.object({
    id: z.string(),
    width: z.number().nullable(),
  }),
  bounds: layoutRectSchema.nullable(),
  nodeRects: z.record(z.string(), layoutRectSchema.nullable()),
  nodes: z.array(selectionNodeMetadataSchema),
  spread: z.record(z.string(), z.array(z.string())).optional().nullable(),
  status: z.enum(['ready', 'pending', 'unavailable', 'empty']),
  reason: z.string(),
  note: z.string().optional(),
});

export type ObserveSelectionInput = z.infer<typeof observeSelectionInputSchema>;
export type SelectionNodeMetadata = z.infer<typeof selectionNodeMetadataSchema>;
export type ObserveSelectionOutput = z.infer<typeof observeSelectionOutputSchema>;

export const observeSelectionOperation: Operation<
  ObserveSelectionInput,
  ObserveSelectionOutput
> = {
  name: 'observe.selection',
  description: 'Inspect active canvas node selection, individual rects, and composite multi-node bounding box',
  category: 'observation',
  kind: 'observation',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: observeSelectionInputSchema,
  outputSchema: observeSelectionOutputSchema,
  async execute(snapshot: Snapshot, input: ObserveSelectionInput, context: OperationContext) {
    const { code } = getTargetPageFile(snapshot, input.filePath);
    const vp = resolveTargetViewport(code, input.viewport ?? input.vpId);

    // Identify target selection IDs
    let selectedIds: string[] = [];
    if (input.nodeIds && input.nodeIds.length > 0) {
      selectedIds = [...input.nodeIds];
    } else if (context.adapters && typeof (context.adapters.selectionProvider as any)?.getSelectedIds === 'function') {
      selectedIds = (context.adapters.selectionProvider as any).getSelectedIds();
    } else {
      try {
        const store = getDefaultStore();
        selectedIds = store.get(selectedIdsAtom) ?? [];
      } catch {
        selectedIds = [];
      }
    }

    if (vp.width === null) {
      return {
        selectedIds,
        primaryId: selectedIds[0] ?? null,
        count: selectedIds.length,
        isMultiSelect: selectedIds.length > 1,
        viewport: vp,
        bounds: null,
        nodeRects: {},
        nodes: [],
        status: 'unavailable',
        reason: `Unknown viewport "${vp.id}" - no width match`,
      };
    }

    if (selectedIds.length === 0) {
      return {
        selectedIds: [],
        primaryId: null,
        count: 0,
        isMultiSelect: false,
        viewport: vp,
        bounds: null,
        nodeRects: {},
        nodes: [],
        status: 'empty',
        reason: 'No nodes currently selected',
        note: 'No nodes currently selected',
      };
    }

    let nodeMap = new Map<string, CanvasNode>();
    try {
      nodeMap = parseJSXToNodes(code);
    } catch {
      // Fallback if parse fails
    }

    const nodeRects: Record<string, LayoutRect | null> = {};
    const nodes: SelectionNodeMetadata[] = [];
    const validRects: LayoutRect[] = [];
    let hasUnmeasured = false;

    for (const id of selectedIds) {
      const node = nodeMap.get(id);
      const isComponent = Boolean(
        node?.isComponentInstance || node?.componentFile || (node?.type && /^[A-Z]/.test(node.type))
      );

      let rect: LayoutRect | null = null;
      try {
        const measured = getRectInViewportSpace(id, vp.id) ?? findNodeRect(id, vp.id);
        if (measured) {
          rect = {
            x: measured.x,
            y: measured.y,
            width: measured.width,
            height: measured.height,
          };
          validRects.push(rect);
        } else {
          hasUnmeasured = true;
        }
      } catch {
        hasUnmeasured = true;
      }

      nodeRects[id] = rect;
      nodes.push({
        id,
        name: node?.name ?? node?.type ?? id,
        type: node?.type ?? 'element',
        isComponent,
        componentFile: node?.componentFile ?? null,
        rect,
        status: rect ? 'measured' : 'unmeasured',
      });
    }

    let bounds: LayoutRect | null = null;
    let status: 'ready' | 'pending' | 'unavailable' = 'ready';
    let reason = 'Selection measured successfully';

    if (hasUnmeasured || validRects.length === 0) {
      bounds = null;
      status = 'pending';
      reason = 'Selected nodes are pending render measurement';
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const r of validRects) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }

      bounds = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    return {
      selectedIds,
      primaryId: selectedIds[0] ?? null,
      count: selectedIds.length,
      isMultiSelect: selectedIds.length > 1,
      viewport: vp,
      bounds,
      nodeRects,
      nodes,
      status,
      reason,
      note: reason,
    };
  },
};

// ─── 2. observe.layout ──────────────────────────────────────────────────────

export const boxSpacingSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});

export const layoutBoxModelSchema = z.object({
  margin: boxSpacingSchema,
  padding: boxSpacingSchema,
});

export const layoutStylePropertiesSchema = z.object({
  display: z.string(),
  flexDirection: z.string().optional(),
  flexWrap: z.string().optional(),
  justifyContent: z.string().optional(),
  alignItems: z.string().optional(),
  gap: z.string().optional(),
  gridTemplateColumns: z.string().optional(),
  gridTemplateRows: z.string().optional(),
  position: z.string().optional(),
  top: z.string().optional(),
  right: z.string().optional(),
  bottom: z.string().optional(),
  left: z.string().optional(),
  zIndex: z.string().optional(),
  overflow: z.string().optional(),
});

export const layoutIndicatorsSchema = z.object({
  visible: z.boolean(),
  overflowsParent: z.boolean(),
  parentOverflowProp: z.string().optional(),
  overflowsViewport: z.boolean(),
  textTruncated: z.boolean(),
});

export const nodeLayoutItemSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable().optional(),
  rect: layoutRectSchema.nullable(),
  boxModel: layoutBoxModelSchema.optional(),
  margin: boxSpacingSchema.optional(),
  padding: boxSpacingSchema.optional(),
  display: z.string(),
  position: z.string().optional(),
  flexDirection: z.string().optional(),
  justifyContent: z.string().optional(),
  alignItems: z.string().optional(),
  gap: z.string().optional(),
  styles: layoutStylePropertiesSchema.optional(),
  indicators: layoutIndicatorsSchema.optional(),
  status: z.enum(['visible', 'hidden', 'unmeasured']).optional(),
  childrenIds: z.array(z.string()).optional(),
});

export const observeLayoutInputSchema = z.object({
  filePath: z.string().optional().describe('Target page file path'),
  viewport: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width in px'),
  vpId: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width in px (alias)'),
  nodeId: z.string().optional().describe('Target node data-id (if omitted, queries all rendered nodes in viewport)'),
  depth: z.number().int().min(0).optional().describe('Maximum traversal depth for subtree layout queries'),
  includeComputedStyles: z.boolean().optional().describe('Include box model and flex/grid styles'),
  includeChildren: z.boolean().optional().describe('Include children nodes in query'),
});

export const observeLayoutOutputSchema = z.object({
  viewport: z.string(),
  viewportWidth: z.number().nullable(),
  targetNodeId: z.string().nullable(),
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  measured: z.number().int().nonnegative(),
  unmeasured: z.array(z.string()),
  unmeasuredTotal: z.number().int().nonnegative(),
  nodes: z.array(nodeLayoutItemSchema),
  status: z.enum(['ready', 'pending', 'unavailable', 'error']),
  reason: z.string(),
  epoch: z.object({
    renderSeq: z.number().nullable(),
    projectVersionAtFill: z.number().nullable(),
    projectVersionNow: z.number().nullable(),
    stale: z.boolean(),
  }).optional(),
  coverage: z.object({
    withRect: z.number(),
    total: z.number(),
  }).optional(),
});

export type ObserveLayoutInput = z.infer<typeof observeLayoutInputSchema>;
export type NodeLayoutItem = z.infer<typeof nodeLayoutItemSchema>;
export type ObserveLayoutOutput = z.infer<typeof observeLayoutOutputSchema>;

const LAYOUT_PROPS = [
  'display',
  'position',
  'margin',
  'padding',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'gap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'overflow',
  'visibility',
  'opacity',
];

function parseBoxSpacing(
  computed: Record<string, string>,
  nodeStyles: Record<string, string> = {},
  prefix: 'margin' | 'padding'
): { top: number; right: number; bottom: number; left: number } {
  const topKey = `${prefix}Top`;
  const rightKey = `${prefix}Right`;
  const bottomKey = `${prefix}Bottom`;
  const leftKey = `${prefix}Left`;

  let top = parseFloat(computed[topKey] || nodeStyles[topKey] || '');
  let right = parseFloat(computed[rightKey] || nodeStyles[rightKey] || '');
  let bottom = parseFloat(computed[bottomKey] || nodeStyles[bottomKey] || '');
  let left = parseFloat(computed[leftKey] || nodeStyles[leftKey] || '');

  const shorthand = computed[prefix] || nodeStyles[prefix];
  if (shorthand) {
    const parts = shorthand.trim().split(/\s+/).map((p) => parseFloat(p) || 0);
    if (parts.length === 1) {
      if (isNaN(top)) top = parts[0];
      if (isNaN(right)) right = parts[0];
      if (isNaN(bottom)) bottom = parts[0];
      if (isNaN(left)) left = parts[0];
    } else if (parts.length === 2) {
      if (isNaN(top)) top = parts[0];
      if (isNaN(bottom)) bottom = parts[0];
      if (isNaN(right)) right = parts[1];
      if (isNaN(left)) left = parts[1];
    } else if (parts.length === 3) {
      if (isNaN(top)) top = parts[0];
      if (isNaN(right)) right = parts[1];
      if (isNaN(left)) left = parts[1];
      if (isNaN(bottom)) bottom = parts[2];
    } else if (parts.length >= 4) {
      if (isNaN(top)) top = parts[0];
      if (isNaN(right)) right = parts[1];
      if (isNaN(bottom)) bottom = parts[2];
      if (isNaN(left)) left = parts[3];
    }
  }

  return {
    top: isNaN(top) ? 0 : top,
    right: isNaN(right) ? 0 : right,
    bottom: isNaN(bottom) ? 0 : bottom,
    left: isNaN(left) ? 0 : left,
  };
}

export const observeLayoutOperation: Operation<
  ObserveLayoutInput,
  ObserveLayoutOutput
> = {
  name: 'observe.layout',
  description: 'Measure rendered coordinates, box model (margins/padding), and flex/grid layout properties',
  category: 'observation',
  kind: 'observation',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: observeLayoutInputSchema,
  outputSchema: observeLayoutOutputSchema,
  async execute(snapshot: Snapshot, input: ObserveLayoutInput, _context: OperationContext) {
    const { code } = getTargetPageFile(snapshot, input.filePath);
    const vp = resolveTargetViewport(code, input.viewport ?? input.vpId);

    if (vp.width === null) {
      return {
        viewport: vp.id,
        viewportWidth: null,
        targetNodeId: input.nodeId ?? null,
        count: 0,
        total: 0,
        measured: 0,
        unmeasured: [],
        unmeasuredTotal: 0,
        nodes: [],
        status: 'unavailable',
        reason: `Unknown viewport "${vp.id}" - no width match`,
      };
    }

    const nodeMap = parseJSXToNodes(code);

    // Target node resolution
    let targetNodes: CanvasNode[] = [];
    if (input.nodeId) {
      const single = nodeMap.get(input.nodeId);
      if (!single) {
        return {
          viewport: vp.id,
          viewportWidth: vp.width,
          targetNodeId: input.nodeId,
          count: 0,
          total: 0,
          measured: 0,
          unmeasured: [input.nodeId],
          unmeasuredTotal: 1,
          nodes: [],
          status: 'unavailable',
          reason: `NODE_NOT_FOUND: Node "${input.nodeId}" not found in document tree`,
        };
      }

      if (input.depth !== undefined && input.depth > 0) {
        const collectSubtree = (node: CanvasNode, curDepth: number) => {
          targetNodes.push(node);
          if (curDepth < input.depth!) {
            for (const childId of node.children) {
              const child = nodeMap.get(childId);
              if (child) collectSubtree(child, curDepth + 1);
            }
          }
        };
        collectSubtree(single, 0);
      } else {
        targetNodes = [single];
      }
    } else {
      targetNodes = Array.from(nodeMap.values());
    }

    const resultNodes: NodeLayoutItem[] = [];
    const unmeasured: string[] = [];
    let measuredCount = 0;

    // Cache parent rects for overflow checking
    const rectCache = new Map<string, LayoutRect | null>();
    for (const n of targetNodes) {
      try {
        const r = getRectInViewportSpace(n.id, vp.id) ?? findNodeRect(n.id, vp.id);
        rectCache.set(n.id, r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null);
      } catch {
        rectCache.set(n.id, null);
      }
    }

    for (const node of targetNodes) {
      const rect = rectCache.get(node.id) ?? null;
      if (rect) {
        measuredCount++;
      } else {
        unmeasured.push(node.id);
      }

      let computed: Record<string, string> = {};
      try {
        computed = findNodeComputedStyles(node.id, vp.id, LAYOUT_PROPS);
      } catch {
        // Fallback
      }

      const margin = parseBoxSpacing(computed, node.styles, 'margin');
      const padding = parseBoxSpacing(computed, node.styles, 'padding');

      const visible = computed['display'] !== 'none' && computed['visibility'] !== 'hidden' && computed['opacity'] !== '0';

      // Overflow indicators
      let overflowsParent = false;
      if (rect && node.parentId) {
        const parentRect = rectCache.get(node.parentId) ?? (
          findNodeRect(node.parentId, vp.id) ? {
            x: findNodeRect(node.parentId, vp.id)!.x,
            y: findNodeRect(node.parentId, vp.id)!.y,
            width: findNodeRect(node.parentId, vp.id)!.width,
            height: findNodeRect(node.parentId, vp.id)!.height,
          } : null
        );
        if (parentRect) {
          const delta = Math.max(
            parentRect.x - rect.x,
            rect.x + rect.width - (parentRect.x + parentRect.width),
            parentRect.y - rect.y,
            rect.y + rect.height - (parentRect.y + parentRect.height)
          );
          overflowsParent = delta > 8;
        }
      }

      const overflowsViewport = rect ? (rect.x + rect.width > vp.width + 8) : false;
      const textLen = node.textContent?.trim().length ?? 0;
      const fontSizePx = parseFloat(computed['fontSize'] || '16') || 16;
      const textTruncated = Boolean(
        rect && computed['overflow'] === 'hidden' && textLen > 0 && textLen * fontSizePx * 0.6 > rect.width
      );

      resultNodes.push({
        id: node.id,
        parentId: node.parentId,
        rect,
        boxModel: { margin, padding },
        margin,
        padding,
        display: computed['display'] || 'block',
        position: computed['position'],
        flexDirection: computed['flexDirection'],
        justifyContent: computed['justifyContent'],
        alignItems: computed['alignItems'],
        gap: computed['gap'],
        styles: {
          display: computed['display'] || 'block',
          position: computed['position'],
          flexDirection: computed['flexDirection'],
          flexWrap: computed['flexWrap'],
          justifyContent: computed['justifyContent'],
          alignItems: computed['alignItems'],
          gap: computed['gap'],
          gridTemplateColumns: computed['gridTemplateColumns'],
          gridTemplateRows: computed['gridTemplateRows'],
          top: computed['top'],
          right: computed['right'],
          bottom: computed['bottom'],
          left: computed['left'],
          zIndex: computed['zIndex'],
          overflow: computed['overflow'],
        },
        indicators: {
          visible,
          overflowsParent,
          parentOverflowProp: computed['overflow'],
          overflowsViewport,
          textTruncated,
        },
        status: rect ? (visible ? 'visible' : 'hidden') : 'unmeasured',
        childrenIds: [...node.children],
      });
    }

    const total = targetNodes.length;
    const isReady = total > 0 && unmeasured.length === 0;
    const status = isReady ? 'ready' : (measuredCount === 0 ? 'pending' : 'pending');
    const reason = isReady
      ? 'Layout measured successfully'
      : `Canvas mid-render: ${unmeasured.length} nodes have not been measured yet`;

    return {
      viewport: vp.id,
      viewportWidth: vp.width,
      targetNodeId: input.nodeId ?? null,
      count: resultNodes.length,
      total,
      measured: measuredCount,
      unmeasured,
      unmeasuredTotal: unmeasured.length,
      nodes: resultNodes,
      status,
      reason,
      epoch: {
        renderSeq: null,
        projectVersionAtFill: null,
        projectVersionNow: null,
        stale: false,
      },
      coverage: {
        withRect: measuredCount,
        total,
      },
    };
  },
};

// ─── 3. observe.visuals ─────────────────────────────────────────────────────

export const visualsContrastSchema = z.object({
  ratio: z.number(),
  foreground: z.string(),
  background: z.string(),
  minimumAA: z.number(),
  minimumAAA: z.number(),
  meetsAA: z.boolean(),
  meetsAAA: z.boolean(),
});

export const visualsTypographySchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.string(),
  fontSizePx: z.number().nullable(),
  fontWeight: z.string(),
  lineHeight: z.string(),
  letterSpacing: z.string().optional(),
  textAlign: z.string(),
  textDecoration: z.string().optional(),
  textTransform: z.string().optional(),
});

export const visualsBordersSchema = z.object({
  borderWidth: z.string(),
  borderStyle: z.string().optional(),
  borderColor: z.string(),
  borderRadius: z.string(),
  radii: z.object({
    topLeft: z.string(),
    topRight: z.string(),
    bottomRight: z.string(),
    bottomLeft: z.string(),
  }).optional(),
});

export const visualsEffectsSchema = z.object({
  boxShadow: z.string(),
  opacity: z.string(),
  opacityNum: z.number(),
  zIndex: z.string(),
  transform: z.string(),
  backdropFilter: z.string().optional(),
  filter: z.string().optional(),
});

export const observeVisualsInputSchema = z.object({
  filePath: z.string().optional().describe('Target page file path'),
  nodeId: z.string().min(1).describe('Target element data-id'),
  viewport: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width in px'),
  vpId: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width in px (alias)'),
  props: z.array(z.string()).optional().describe('Additional computed CSS properties to request'),
  properties: z.array(z.string()).optional().describe('Additional computed CSS properties to request (alias)'),
});

export const observeVisualsOutputSchema = z.object({
  nodeId: z.string(),
  viewport: z.union([z.string(), z.object({ id: z.string(), width: z.number().nullable() })]),
  rect: layoutRectSchema.nullable(),
  computed: z.record(z.string(), z.string()),
  typography: visualsTypographySchema,
  colors: z.object({
    color: z.string(),
    backgroundColor: z.string(),
    contrastRatio: z.number().nullable().optional(),
    contrastPass: z.boolean().nullable().optional(),
  }),
  contrast: visualsContrastSchema.nullable(),
  borders: visualsBordersSchema,
  effects: visualsEffectsSchema.optional(),
  transform: z.string().optional(),
  opacity: z.string().optional(),
  custom: z.record(z.string(), z.string()).optional(),
  rawStyles: z.record(z.string(), z.string()).optional(),
  status: z.enum(['ready', 'pending', 'unavailable', 'error']),
  reason: z.string().optional(),
  epoch: z.object({
    renderSeq: z.number().nullable(),
    projectVersionAtFill: z.number().nullable(),
    projectVersionNow: z.number().nullable(),
    stale: z.boolean(),
  }).optional(),
});

export type ObserveVisualsInput = z.infer<typeof observeVisualsInputSchema>;
export type ObserveVisualsOutput = z.infer<typeof observeVisualsOutputSchema>;

const VISUAL_STYLE_PROPS = [
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'textTransform',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'boxShadow',
  'opacity',
  'zIndex',
  'transform',
  'filter',
  'backdropFilter',
];

export const observeVisualsOperation: Operation<
  ObserveVisualsInput,
  ObserveVisualsOutput
> = {
  name: 'observe.visuals',
  description: 'Inspect applied typography, colors, borders, transforms, and WCAG contrast ratio',
  category: 'observation',
  kind: 'observation',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: observeVisualsInputSchema,
  outputSchema: observeVisualsOutputSchema,
  async execute(snapshot: Snapshot, input: ObserveVisualsInput, _context: OperationContext) {
    const { code } = getTargetPageFile(snapshot, input.filePath);
    const vp = resolveTargetViewport(code, input.viewport ?? input.vpId);

    if (vp.width === null) {
      return {
        nodeId: input.nodeId,
        viewport: vp.id,
        rect: null,
        computed: {},
        typography: { fontSize: '16px', fontSizePx: 16, fontWeight: '400', lineHeight: 'normal', textAlign: 'left' },
        colors: { color: '', backgroundColor: '', contrastRatio: null, contrastPass: null },
        contrast: null,
        borders: { borderWidth: '0px', borderColor: '', borderRadius: '0px' },
        status: 'unavailable',
        reason: `Unknown viewport "${vp.id}" - no width match`,
      };
    }

    const nodeMap = parseJSXToNodes(code);
    if (!nodeMap.has(input.nodeId)) {
      return {
        nodeId: input.nodeId,
        viewport: vp.id,
        rect: null,
        computed: {},
        typography: { fontSize: '16px', fontSizePx: 16, fontWeight: '400', lineHeight: 'normal', textAlign: 'left' },
        colors: { color: '', backgroundColor: '', contrastRatio: null, contrastPass: null },
        contrast: null,
        borders: { borderWidth: '0px', borderColor: '', borderRadius: '0px' },
        status: 'unavailable',
        reason: `NODE_NOT_FOUND: Node "${input.nodeId}" not found in document tree`,
      };
    }

    let rect: LayoutRect | null = null;
    try {
      const measured = getRectInViewportSpace(input.nodeId, vp.id) ?? findNodeRect(input.nodeId, vp.id);
      if (measured) {
        rect = { x: measured.x, y: measured.y, width: measured.width, height: measured.height };
      }
    } catch {
      rect = null;
    }

    const extraProps = input.properties ?? input.props ?? [];
    const propsToQuery = Array.from(new Set([...VISUAL_STYLE_PROPS, ...extraProps]));

    let computed: Record<string, string> = {};
    try {
      computed = findNodeComputedStyles(input.nodeId, vp.id, propsToQuery);
    } catch {
      computed = {};
    }

    // Typography
    const fontSize = computed['fontSize'] || '16px';
    const fontSizePx = parseFloat(fontSize) || null;
    const fontWeight = computed['fontWeight'] || '400';
    const lineHeight = computed['lineHeight'] || 'normal';
    const textAlign = computed['textAlign'] || 'left';
    const fontFamily = computed['fontFamily'];

    // Colors & Contrast
    const color = computed['color'] || '';
    const backgroundColor = computed['backgroundColor'] || '';

    let contrastObj: z.infer<typeof visualsContrastSchema> | null = null;
    let contrastRatioVal: number | null = null;
    let contrastPass: boolean | null = null;

    if (color && backgroundColor) {
      try {
        const rawRatio = contrastRatio(color, backgroundColor);
        if (rawRatio !== null && !isNaN(rawRatio) && rawRatio > 0) {
          const ratio = formatContrastRatio(rawRatio);
          const meetsAA = ratio >= 4.5;
          const meetsAAA = ratio >= 7.0;
          contrastRatioVal = ratio;
          contrastPass = meetsAA;
          contrastObj = {
            ratio,
            foreground: color,
            background: backgroundColor,
            minimumAA: 4.5,
            minimumAAA: 7.0,
            meetsAA,
            meetsAAA,
          };
        }
      } catch {
        // Fallback
      }
    }

    // Borders
    const borderWidth = computed['borderWidth'] || '0px';
    const borderStyle = computed['borderStyle'] || 'none';
    const borderColor = computed['borderColor'] || '';
    const borderRadius = computed['borderRadius'] || '0px';

    const radii = {
      topLeft: computed['borderTopLeftRadius'] || borderRadius,
      topRight: computed['borderTopRightRadius'] || borderRadius,
      bottomRight: computed['borderBottomRightRadius'] || borderRadius,
      bottomLeft: computed['borderBottomLeftRadius'] || borderRadius,
    };

    // Effects
    const boxShadow = computed['boxShadow'] || 'none';
    const opacity = computed['opacity'] || '1';
    const opacityNum = parseFloat(opacity) || 1;
    const zIndex = computed['zIndex'] || 'auto';
    const transform = computed['transform'] || 'none';

    const custom: Record<string, string> = {};
    for (const p of extraProps) {
      if (computed[p]) custom[p] = computed[p];
    }

    const status = rect ? 'ready' : 'pending';
    const reason = rect ? 'Visual styles queried successfully' : 'Node rect is not cached yet - canvas mid-render';

    return {
      nodeId: input.nodeId,
      viewport: vp.id,
      rect,
      computed,
      typography: {
        fontFamily,
        fontSize,
        fontSizePx,
        fontWeight,
        lineHeight,
        letterSpacing: computed['letterSpacing'],
        textAlign,
        textDecoration: computed['textDecoration'],
        textTransform: computed['textTransform'],
      },
      colors: {
        color,
        backgroundColor,
        contrastRatio: contrastRatioVal,
        contrastPass,
      },
      contrast: contrastObj,
      borders: {
        borderWidth,
        borderStyle,
        borderColor,
        borderRadius,
        radii,
      },
      effects: {
        boxShadow,
        opacity,
        opacityNum,
        zIndex,
        transform,
        backdropFilter: computed['backdropFilter'],
        filter: computed['filter'],
      },
      transform,
      opacity,
      custom,
      rawStyles: computed,
      status,
      reason,
      epoch: {
        renderSeq: null,
        projectVersionAtFill: null,
        projectVersionNow: null,
        stale: false,
      },
    };
  },
};

// ─── 4. observe.composition ─────────────────────────────────────────────────

export const regionInfoSchema = z.object({
  id: z.string(),
  rect: layoutRectSchema,
  topPct: z.number(),
  bottomPct: z.number(),
  heightPct: z.number(),
});

export const compositionFindingSchema = z.object({
  kind: z.enum(['balance', 'alignment', 'proportion', 'type', 'gap', 'region']),
  regionId: z.string().optional(),
  message: z.string(),
});

export const compositionNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    kind: z.enum(['intrinsic', 'component_instance', 'component_root', 'slot_carrier', 'slot_item']),
    tag: z.string(),
    componentFile: z.string().nullable(),
    parentId: z.string().nullable(),
    siblingIndex: z.number(),
    siblingCount: z.number(),
    depth: z.number(),
    childrenCount: z.number(),
    hasMoreChildren: z.boolean(),
    slotDetails: z.object({
      isSlotCarrier: z.boolean(),
      isSlotItem: z.boolean(),
      carrierComponentId: z.string().nullable(),
      slotConnections: z.record(z.string(), z.array(z.string())),
    }).optional(),
    textSummary: z.string().optional(),
    children: z.array(compositionNodeSchema),
  })
);

export const flatHierarchyNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  children: z.array(z.string()),
  kind: z.enum(['intrinsic', 'component', 'slot']),
  tag: z.string(),
  name: z.string().optional(),
});

export const observeCompositionInputSchema = z.object({
  filePath: z.string().optional().describe('Target page file path'),
  nodeId: z.string().optional().describe('Root node ID to start tree from (defaults to page root)'),
  viewport: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width for rendered composition analysis'),
  vpId: z.union([z.string(), z.number()]).optional().describe('Viewport ID or width (alias)'),
  depth: z.number().int().min(0).optional().describe('Maximum recursion depth (defaults to 3)'),
  includeSlots: z.boolean().optional().describe('Include code-component slot connection inspection'),
  includeStructuralPerception: z.boolean().optional().describe('Include layout perception (regions, balance, proportions)'),
});

export const observeCompositionOutputSchema = z.object({
  rootNodeId: z.string(),
  viewport: z.string(),
  viewportWidth: z.number().nullable(),
  tree: compositionNodeSchema.optional(),
  hierarchy: z.array(flatHierarchyNodeSchema),
  regions: z.array(regionInfoSchema),
  findings: z.array(compositionFindingSchema),
  perception: z.array(compositionFindingSchema).optional(),
  lines: z.array(z.string()),
  summary: z.object({
    totalNodes: z.number(),
    componentInstancesCount: z.number(),
    intrinsicCount: z.number(),
    slotCarriersCount: z.number(),
    slotItemsCount: z.number(),
    maxDepth: z.number(),
    componentsUsed: z.array(z.string()),
  }),
  status: z.enum(['ready', 'pending', 'unavailable', 'error']),
  reason: z.string(),
});

export type ObserveCompositionInput = z.infer<typeof observeCompositionInputSchema>;
export type ObserveCompositionOutput = z.infer<typeof observeCompositionOutputSchema>;

export const observeCompositionOperation: Operation<
  ObserveCompositionInput,
  ObserveCompositionOutput
> = {
  name: 'observe.composition',
  description: 'Structural perception of regions, balance, alignment, proportions, type hierarchy, and slots',
  category: 'observation',
  kind: 'observation',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: observeCompositionInputSchema,
  outputSchema: observeCompositionOutputSchema,
  async execute(snapshot: Snapshot, input: ObserveCompositionInput, _context: OperationContext) {
    const { code } = getTargetPageFile(snapshot, input.filePath);
    const vp = resolveTargetViewport(code, input.viewport ?? input.vpId);

    const nodeMap = parseJSXToNodes(code);

    let rootNode: CanvasNode | undefined;
    if (input.nodeId) {
      rootNode = nodeMap.get(input.nodeId);
      if (!rootNode) {
        return {
          rootNodeId: input.nodeId,
          viewport: vp.id,
          viewportWidth: vp.width,
          hierarchy: [],
          regions: [],
          findings: [],
          lines: [],
          summary: { totalNodes: 0, componentInstancesCount: 0, intrinsicCount: 0, slotCarriersCount: 0, slotItemsCount: 0, maxDepth: 0, componentsUsed: [] },
          status: 'unavailable',
          reason: `NODE_NOT_FOUND: Root node "${input.nodeId}" not found in document`,
        };
      }
    } else {
      rootNode = nodeMap.get('root') ?? Array.from(nodeMap.values()).find((n) => n.parentId === null) ?? Array.from(nodeMap.values())[0];
    }

    if (!rootNode) {
      return {
        rootNodeId: 'root',
        viewport: vp.id,
        viewportWidth: vp.width,
        hierarchy: [],
        regions: [],
        findings: [],
        lines: [],
        summary: { totalNodes: 0, componentInstancesCount: 0, intrinsicCount: 0, slotCarriersCount: 0, slotItemsCount: 0, maxDepth: 0, componentsUsed: [] },
        status: 'unavailable',
        reason: 'Empty document tree',
      };
    }

    // Slot connections discovery
    let slotConnections = new Map<string, string[]>();
    const slotItemToCarrier = new Map<string, string>();
    try {
      slotConnections = getAllSlotConnections(code);
      for (const [carrierId, itemIds] of slotConnections) {
        for (const itemId of itemIds) {
          slotItemToCarrier.set(itemId, carrierId);
        }
      }
    } catch {
      // Slot-ops fallback
    }

    // Recursive tree construction
    const maxDepth = input.depth ?? 3;
    let totalNodes = 0;
    let componentInstancesCount = 0;
    let intrinsicCount = 0;
    let slotCarriersCount = 0;
    let slotItemsCount = 0;
    let observedMaxDepth = 0;
    const componentsUsed = new Set<string>();
    const flatHierarchy: z.infer<typeof flatHierarchyNodeSchema>[] = [];

    const buildTree = (node: CanvasNode, curDepth: number, sibIdx: number, sibCount: number): any => {
      totalNodes++;
      observedMaxDepth = Math.max(observedMaxDepth, curDepth);

      let kind: 'intrinsic' | 'component_instance' | 'component_root' | 'slot_carrier' | 'slot_item' = 'intrinsic';
      let flatKind: 'intrinsic' | 'component' | 'slot' = 'intrinsic';

      if (slotItemToCarrier.has(node.id)) {
        kind = 'slot_item';
        flatKind = 'slot';
        slotItemsCount++;
      } else if (slotConnections.has(node.id) && (slotConnections.get(node.id)?.length ?? 0) > 0) {
        kind = 'slot_carrier';
        flatKind = 'slot';
        slotCarriersCount++;
      } else if (node.isComponentRoot) {
        kind = 'component_root';
        flatKind = 'component';
      } else if (node.isComponentInstance || node.componentFile || /^[A-Z]/.test(node.type)) {
        kind = 'component_instance';
        flatKind = 'component';
        componentInstancesCount++;
        componentsUsed.add(node.type);
      } else {
        intrinsicCount++;
      }

      flatHierarchy.push({
        id: node.id,
        parentId: node.parentId,
        children: [...node.children],
        kind: flatKind,
        tag: node.type,
        name: node.name ?? node.type,
      });

      const childrenNodes: any[] = [];
      const hasMoreChildren = curDepth >= maxDepth && node.children.length > 0;

      if (curDepth < maxDepth) {
        const childList = node.children
          .map((cid) => nodeMap.get(cid))
          .filter((c): c is CanvasNode => Boolean(c));

        childList.forEach((child, idx) => {
          childrenNodes.push(buildTree(child, curDepth + 1, idx, childList.length));
        });
      }

      return {
        id: node.id,
        type: node.type,
        name: node.name ?? node.type,
        kind,
        tag: node.type,
        componentFile: node.componentFile ?? null,
        parentId: node.parentId,
        siblingIndex: sibIdx,
        siblingCount: sibCount,
        depth: curDepth,
        childrenCount: node.children.length,
        hasMoreChildren,
        slotDetails: {
          isSlotCarrier: slotConnections.has(node.id),
          isSlotItem: slotItemToCarrier.has(node.id),
          carrierComponentId: slotItemToCarrier.get(node.id) ?? null,
          slotConnections: slotConnections.has(node.id) ? { default: slotConnections.get(node.id)! } : {},
        },
        textSummary: node.textContent?.slice(0, 40),
        children: childrenNodes,
      };
    };

    const tree = buildTree(rootNode, 0, 0, 1);

    // Layout perception analysis
    let regions: z.infer<typeof regionInfoSchema>[] = [];
    let findings: z.infer<typeof compositionFindingSchema>[] = [];
    const lines: string[] = [];

    if (input.includeStructuralPerception !== false && vp.width !== null) {
      try {
        const auditNodes = collectLayoutSnapshot(nodeMap, vp.id);
        const rawRegions = detectRegions(auditNodes);
        regions = rawRegions.map((r) => ({
          id: r.id,
          rect: r.rect,
          topPct: r.topPct,
          bottomPct: r.bottomPct,
          heightPct: r.heightPct,
        }));

        const rawFindings = [
          ...balanceAnalysis(auditNodes, rawRegions),
          ...alignmentAnalysis(auditNodes, rawRegions),
          ...proportionAnalysis(auditNodes, rawRegions),
          ...typeHierarchy(auditNodes),
          ...gapAnalysis(auditNodes, rawRegions),
        ];
        findings = rawFindings.map((f) => ({
          kind: f.kind,
          regionId: f.regionId,
          message: f.message,
        }));

        for (const f of findings) {
          lines.push(`${f.kind}: ${f.message}`);
        }
      } catch {
        // Perception fallback
      }
    }

    return {
      rootNodeId: rootNode.id,
      viewport: vp.id,
      viewportWidth: vp.width,
      tree,
      hierarchy: flatHierarchy,
      regions,
      findings,
      perception: findings,
      lines,
      summary: {
        totalNodes,
        componentInstancesCount,
        intrinsicCount,
        slotCarriersCount,
        slotItemsCount,
        maxDepth: observedMaxDepth,
        componentsUsed: Array.from(componentsUsed),
      },
      status: 'ready',
      reason: 'Composition hierarchy and structural perception resolved successfully',
    };
  },
};

// ─── 5. observe.audit ───────────────────────────────────────────────────────

export const auditThresholdsSchema = z.object({
  minContrastRatio: z.number().default(4.5),
  minLargeTextContrastRatio: z.number().default(3.0),
  minTouchTargetPx: z.number().default(44),
  minFontSizePx: z.number().default(12),
  overlapTolerancePx: z.number().default(4),
  overflowTolerancePx: z.number().default(8),
});

export const observeAuditInputSchema = z.object({
  filePath: z.string().optional().describe('Target page file path'),
  targetFile: z.string().optional().describe('Target page file path (alias)'),
  viewport: z.union([z.string(), z.number()]).optional().describe('Target viewport ID or width in px'),
  vpId: z.union([z.string(), z.number()]).optional().describe('Target viewport ID or width in px (alias)'),
  categories: z.array(z.enum(['contrast', 'touch-targets', 'overflow', 'typography', 'empty-nodes'])).optional(),
  thresholds: auditThresholdsSchema.partial().optional(),
});

export const auditFindingSchema = z.object({
  rule: z.enum([
    'CONTRAST',
    'TOUCH_TARGET_TOO_SMALL',
    'SMALL_TOUCH_TARGET',
    'OVERLAP',
    'OVERFLOW',
    'SECTION_DEPASSE_VIEWPORT',
    'FONT_SIZE',
    'LINE_HEIGHT',
    'TRUNCATION',
    'EMPTY_NODE',
    'CANVAS_MID_RENDER',
  ]),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  nodeId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const observeAuditOutputSchema = z.object({
  clean: z.boolean(),
  passed: z.boolean(),
  viewport: z.string(),
  viewportWidth: z.number().nullable(),
  status: z.enum(['ready', 'pending', 'unavailable', 'error']),
  summary: z.string(),
  totalFindings: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  checked: z.number().int().nonnegative(),
  violations: z.array(z.string()),
  findings: z.array(auditFindingSchema),
  unmeasured: z.array(z.string()),
  stats: z.object({
    nodesAudited: z.number().int().nonnegative(),
    contrastChecked: z.number().int().nonnegative(),
    touchTargetsChecked: z.number().int().nonnegative(),
    overflowChecked: z.number().int().nonnegative(),
  }),
});

export type ObserveAuditInput = z.infer<typeof observeAuditInputSchema>;
export type AuditFinding = z.infer<typeof auditFindingSchema>;
export type ObserveAuditOutput = z.infer<typeof observeAuditOutputSchema>;

export const observeAuditOperation: Operation<
  ObserveAuditInput,
  ObserveAuditOutput
> = {
  name: 'observe.audit',
  description: 'Lint rendered layout for WCAG contrast (<4.5:1), touch targets (<44px), overflows, overlaps, and empty nodes',
  category: 'observation',
  kind: 'observation',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: observeAuditInputSchema,
  outputSchema: observeAuditOutputSchema,
  async execute(snapshot: Snapshot, input: ObserveAuditInput, _context: OperationContext) {
    const { path: filePath, code } = getTargetPageFile(snapshot, input.filePath ?? input.targetFile);
    const vp = resolveTargetViewport(code, input.viewport ?? input.vpId);

    if (vp.width === null) {
      return {
        clean: false,
        passed: false,
        viewport: vp.id,
        viewportWidth: null,
        status: 'unavailable',
        summary: `Unknown viewport "${vp.id}" - no width match`,
        totalFindings: 0,
        errors: 0,
        warnings: 0,
        checked: 0,
        violations: [],
        findings: [],
        unmeasured: [],
        stats: { nodesAudited: 0, contrastChecked: 0, touchTargetsChecked: 0, overflowChecked: 0 },
      };
    }

    const nodeMap = parseJSXToNodes(code);
    let epochSnap: ReturnType<typeof collectEpochSnapshot>;
    const auditSnapshotService = _context.adapters?.auditSnapshotService as {
      getSnapshot?: (args: {
        projectId: string;
        branchId: string;
        filePath: string;
        revision: number;
        viewport: string;
      }) => Promise<{
        status: ObservationStatus;
        reason?: string;
        nodes?: AuditNode[];
        epoch?: ObservationEpoch;
      }>;
    } | undefined;

    if (typeof auditSnapshotService?.getSnapshot === 'function') {
      let renderedSnapshot: Awaited<ReturnType<NonNullable<typeof auditSnapshotService.getSnapshot>>>;
      try {
        renderedSnapshot = await auditSnapshotService.getSnapshot({
          projectId: snapshot.scope.projectId,
          branchId: snapshot.scope.branchId,
          filePath,
          revision: snapshot.revision,
          viewport: vp.id,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          clean: false,
          passed: false,
          viewport: vp.id,
          viewportWidth: vp.width,
          status: 'unavailable' as const,
          summary: `Audit unavailable: ${reason}`,
          totalFindings: 0,
          errors: 0,
          warnings: 0,
          checked: 0,
          violations: [],
          findings: [],
          unmeasured: [],
          stats: { nodesAudited: 0, contrastChecked: 0, touchTargetsChecked: 0, overflowChecked: 0 },
        };
      }

      if (!renderedSnapshot.nodes || !renderedSnapshot.epoch) {
        renderedSnapshot.status = 'unavailable';
        renderedSnapshot.reason ||= 'The Builder audit bridge returned no measurement snapshot.';
      }

      if (renderedSnapshot.status !== 'ready' || !renderedSnapshot.nodes || !renderedSnapshot.epoch) {
        const status = renderedSnapshot.status === 'pending' ? 'pending' : 'unavailable';
        const reason = renderedSnapshot.reason || 'The Builder canvas has no fresh measurement for this viewport.';
        const pendingFinding: AuditFinding | null = status === 'pending'
          ? { rule: 'CANVAS_MID_RENDER', severity: 'warning', message: reason }
          : null;
        const findings = pendingFinding ? [pendingFinding] : [];
        return {
          clean: false,
          passed: false,
          viewport: vp.id,
          viewportWidth: vp.width,
          status,
          summary: status === 'pending' ? `Audit pending: ${reason}` : `Audit unavailable: ${reason}`,
          totalFindings: findings.length,
          errors: 0,
          warnings: findings.length,
          checked: renderedSnapshot.epoch?.total ?? 0,
          violations: findings.map((finding) => `${finding.rule}: ${finding.message}`),
          findings,
          unmeasured: renderedSnapshot.epoch?.unmeasured ?? [],
          stats: {
            nodesAudited: renderedSnapshot.epoch?.total ?? 0,
            contrastChecked: 0,
            touchTargetsChecked: 0,
            overflowChecked: 0,
          },
        };
      }

      const liveStatus = observationStatusWithEpoch(vp, renderedSnapshot.epoch);
      if (liveStatus.status !== 'ready') {
        const findings: AuditFinding[] = liveStatus.status === 'pending'
          ? [{ rule: 'CANVAS_MID_RENDER', severity: 'warning', message: liveStatus.reason }]
          : [];
        return {
          clean: false,
          passed: false,
          viewport: vp.id,
          viewportWidth: vp.width,
          status: liveStatus.status,
          summary: liveStatus.status === 'pending' ? `Audit pending: ${liveStatus.reason}` : `Audit unavailable: ${liveStatus.reason}`,
          totalFindings: findings.length,
          errors: 0,
          warnings: findings.length,
          checked: renderedSnapshot.epoch.total,
          violations: findings.map((finding) => `${finding.rule}: ${finding.message}`),
          findings,
          unmeasured: renderedSnapshot.epoch.unmeasured,
          stats: {
            nodesAudited: renderedSnapshot.epoch.total,
            contrastChecked: 0,
            touchTargetsChecked: 0,
            overflowChecked: 0,
          },
        };
      }

      epochSnap = { nodes: renderedSnapshot.nodes, epoch: renderedSnapshot.epoch };
    } else {
      epochSnap = collectEpochSnapshot(nodeMap, vp.id);
    }
    const auditNodes = epochSnap.nodes;

    // Check if snapshot is mid-render / has unmeasured nodes
    if (epochSnap.epoch.withRect === 0 && auditNodes.length > 0) {
      return {
        clean: false,
        passed: false,
        viewport: vp.id,
        viewportWidth: vp.width,
        status: 'pending',
        summary: 'Audit pending: canvas mid-render or unmeasured nodes present',
        totalFindings: 1,
        errors: 0,
        warnings: 1,
        checked: auditNodes.length,
        violations: ['CANVAS_MID_RENDER: Nodes pending render measurement'],
        findings: [
          {
            rule: 'CANVAS_MID_RENDER',
            severity: 'warning',
            message: 'Nodes pending render measurement',
          },
        ],
        unmeasured: epochSnap.epoch.unmeasured,
        stats: {
          nodesAudited: auditNodes.length,
          contrastChecked: 0,
          touchTargetsChecked: 0,
          overflowChecked: 0,
        },
      };
    }

    const tile = buildViewportTile(auditNodes, vp.width);
    const designFindings = runDesignAudit(auditNodes, tile);

    const findings: AuditFinding[] = [];
    let contrastChecked = 0;
    let touchTargetsChecked = 0;
    let overflowChecked = 0;

    for (const df of designFindings) {
      let severity: 'error' | 'warning' | 'info' = 'warning';
      let ruleName: AuditFinding['rule'] = 'CONTRAST';

      if (df.rule === 'CONTRAST') {
        ruleName = 'CONTRAST';
        severity = 'error';
        contrastChecked++;
      } else if (df.rule === 'OVERLAP') {
        ruleName = 'OVERLAP';
        // Geometric overlap alone cannot distinguish collisions from
        // deliberate layering (fixed headers, cursor overlays, negative-margin CTAs).
        severity = 'warning';
      } else if (df.rule === 'OVERFLOW') {
        ruleName = 'OVERFLOW';
        severity = 'error';
        overflowChecked++;
      } else if (df.rule === 'SECTION_DEPASSE_VIEWPORT') {
        ruleName = 'SECTION_DEPASSE_VIEWPORT';
        // Viewport overflow is explicitly heuristic: clipped marquees and
        // decorative art are valid, so surface it without failing the audit.
        severity = 'info';
        overflowChecked++;
      } else if (df.rule === 'FONT_SIZE') {
        ruleName = 'FONT_SIZE';
        severity = 'warning';
      } else if (df.rule === 'EMPTY_NODE') {
        ruleName = 'EMPTY_NODE';
        severity = 'warning';
      } else if (df.rule === 'TRUNCATION') {
        ruleName = 'TRUNCATION';
        severity = 'warning';
      }

      findings.push({
        rule: ruleName,
        severity,
        message: df.message,
      });
    }

    // Touch targets check (WCAG 2.5.5 / 2.5.8: min 44x44px for interactive elements)
    const minTouchPx = input.thresholds?.minTouchTargetPx ?? 44;
    for (const an of auditNodes) {
      if (!an.rect) continue;
      const node = nodeMap.get(an.id);
      if (!node) continue;

      const isInteractiveTag = ['button', 'a', 'input', 'select', 'textarea'].includes(node.type.toLowerCase());
      const hasInteractiveRole = Boolean(
        node.attrs?.role === 'button' ||
        node.attrs?.role === 'link' ||
        node.attrs?.['data-interactive'] === 'true'
      );

      if (isInteractiveTag || hasInteractiveRole) {
        touchTargetsChecked++;
        // Exemption: inline link with text wrapped inside paragraph/text block
        const isInlineTextLink = node.type.toLowerCase() === 'a' && Boolean(an.text && an.text.length > 0 && node.parentId && nodeMap.get(node.parentId)?.type === 'p');
        if (!isInlineTextLink) {
          if (an.rect.width < minTouchPx || an.rect.height < minTouchPx) {
            findings.push({
              rule: 'SMALL_TOUCH_TARGET',
              severity: 'error',
              message: `SMALL_TOUCH_TARGET: Node "${an.id}" is smaller than minimum ${minTouchPx}x${minTouchPx}px touch target (${Math.round(an.rect.width)}x${Math.round(an.rect.height)}px)`,
              nodeId: an.id,
              details: { width: an.rect.width, height: an.rect.height, minTouchPx },
            });
          }
        }
      }
    }

    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    const informational = findings.filter((f) => f.severity === 'info').length;
    const clean = errors === 0;
    const summary = findings.length === 0
      ? 'No violations detected.'
      : clean
        ? `No blocking violations; ${warnings} warning(s), ${informational} informational finding(s).`
        : `Found ${findings.length} design audit findings (${errors} errors, ${warnings} warnings, ${informational} informational).`;

    return {
      clean,
      passed: clean,
      viewport: vp.id,
      viewportWidth: vp.width,
      status: 'ready',
      summary,
      totalFindings: findings.length,
      errors,
      warnings,
      checked: auditNodes.length,
      violations: findings.filter((f) => f.severity !== 'info').map((f) => f.message),
      findings,
      unmeasured: epochSnap.epoch.unmeasured,
      stats: {
        nodesAudited: auditNodes.length,
        contrastChecked,
        touchTargetsChecked,
        overflowChecked,
      },
    };
  },
};

// ─── 6. observe.screenshot ──────────────────────────────────────────────────

export const observeScreenshotInputSchema = z.object({
  filePath: z.string().optional().describe('Target page file path'),
  targetFile: z.string().optional().describe('Target page file path (alias)'),
  viewport: z.string().optional().describe('Viewport ID to capture'),
  viewports: z.array(z.string()).optional().describe('Optional list of multiple viewport IDs to capture in batch'),
  nodeId: z.string().optional().describe('Node data-id to screenshot (defaults to "root")'),
  format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Raster image format'),
  pixelRatio: z.number().min(0.5).max(4).optional().describe('Device pixel ratio for capture resolution'),
  quality: z.number().min(1).max(100).optional().describe('Image quality for lossy formats'),
  backgroundColor: z.string().optional().describe('Background color override'),
});

export const screenshotResultItemSchema = z.object({
  viewport: z.string(),
  nodeId: z.string(),
  available: z.boolean(),
  status: z.enum(['ready', 'pending', 'unavailable']),
  dataUrl: z.string().optional().describe('Base64 data URL when capture is successful'),
  bytes: z.number().nonnegative().optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  dimensions: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }).optional(),
  waitedMs: z.number().nonnegative(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

export const observeScreenshotOutputSchema = z.object({
  available: z.boolean(),
  primary: screenshotResultItemSchema,
  results: z.array(screenshotResultItemSchema),
  captures: z.array(screenshotResultItemSchema).optional(),
});

export type ObserveScreenshotInput = z.infer<typeof observeScreenshotInputSchema>;
export type ScreenshotResultItem = z.infer<typeof screenshotResultItemSchema>;
export type ObserveScreenshotOutput = z.infer<typeof observeScreenshotOutputSchema>;

export const observeScreenshotOperation: Operation<
  ObserveScreenshotInput,
  ObserveScreenshotOutput
> = {
  name: 'observe.screenshot',
  description: 'Capture rendered viewport/node screenshots via bridge/headless adapter with honest status',
  category: 'observation',
  kind: 'observation',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: observeScreenshotInputSchema,
  outputSchema: observeScreenshotOutputSchema,
  async execute(snapshot: Snapshot, input: ObserveScreenshotInput, context: OperationContext) {
    const targetVps = input.viewports && input.viewports.length > 0
      ? input.viewports
      : [input.viewport ?? 'desktop'];

    const format = input.format ?? 'png';
    const pixelRatio = input.pixelRatio ?? 1;
    const nodeId = input.nodeId ?? 'root';
    const backgroundColor = input.backgroundColor ?? (format === 'jpeg' ? '#ffffff' : undefined);

    const screenshotService = context.adapters?.screenshotService as any;

    const results: ScreenshotResultItem[] = [];

    for (const vpId of targetVps) {
      if (screenshotService && typeof screenshotService.captureScreenshot === 'function') {
        try {
          const res = await screenshotService.captureScreenshot({
            snapshot,
            revision: snapshot.revision,
            viewport: vpId,
            nodeId,
            format,
            pixelRatio,
            backgroundColor,
          });

          results.push({
            viewport: vpId,
            nodeId,
            available: res.available ?? true,
            status: res.status ?? 'ready',
            dataUrl: res.dataUrl,
            bytes: res.bytes ?? (res.dataUrl ? res.dataUrl.length : 0),
            width: res.width ?? res.dimensions?.width ?? 1200,
            height: res.height ?? res.dimensions?.height ?? 800,
            dimensions: res.dimensions ?? (res.width && res.height ? { width: res.width, height: res.height } : undefined),
            waitedMs: res.waitedMs ?? 0,
            reason: res.reason,
            note: res.note,
          });
          continue;
        } catch (err) {
          results.push({
            viewport: vpId,
            nodeId,
            available: false,
            status: 'unavailable',
            waitedMs: 0,
            reason: 'SCREENSHOT_SERVICE_ERROR',
            note: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }

      // Honest headless non-mock degradation:
      results.push({
        viewport: vpId,
        nodeId,
        available: false,
        status: 'unavailable',
        width: 0,
        height: 0,
        waitedMs: 0,
        reason: 'HEADLESS_DISPLAY_UNAVAILABLE',
        note: 'Provide context.adapters.screenshotService or run within an active browser session with an attached canvas bridge.',
      });
    }

    const primary = results[0] ?? {
      viewport: 'desktop',
      nodeId: 'root',
      available: false,
      status: 'unavailable',
      waitedMs: 0,
      reason: 'HEADLESS_DISPLAY_UNAVAILABLE',
    };

    const anyAvailable = results.some((r) => r.available);

    return {
      available: anyAvailable,
      primary,
      results,
      captures: results,
    };
  },
};

// ─── Operation Registrations & Aliases ─────────────────────────────────────────

defaultRegistry.register(observeSelectionOperation);
defaultRegistry.register(observeLayoutOperation);
defaultRegistry.register(observeVisualsOperation);
defaultRegistry.register(observeCompositionOperation);
defaultRegistry.register(observeAuditOperation);
defaultRegistry.register(observeScreenshotOperation);

// Selection aliases
defaultRegistry.registerAlias('selection.get', 'observe.selection');
defaultRegistry.registerAlias('selection.inspect', 'observe.selection');
defaultRegistry.registerAlias('canvas.getSelection', 'observe.selection');
defaultRegistry.registerAlias('get_selection', 'observe.selection');
defaultRegistry.registerAlias('observe.selected', 'observe.selection');

// Layout aliases
defaultRegistry.registerAlias('layout.inspect', 'observe.layout');
defaultRegistry.registerAlias('layout.get', 'observe.layout');
defaultRegistry.registerAlias('get_layout', 'observe.layout');
defaultRegistry.registerAlias('observe.rects', 'observe.layout');
defaultRegistry.registerAlias('observe.dimensions', 'observe.layout');

// Visuals aliases
defaultRegistry.registerAlias('styles.inspect', 'observe.visuals');
defaultRegistry.registerAlias('visuals.get', 'observe.visuals');
defaultRegistry.registerAlias('get_visuals', 'observe.visuals');
defaultRegistry.registerAlias('computed.get', 'observe.visuals');
defaultRegistry.registerAlias('observe.styles', 'observe.visuals');
defaultRegistry.registerAlias('observe.computed', 'observe.visuals');

// Composition aliases
defaultRegistry.registerAlias('composition.get', 'observe.composition');
defaultRegistry.registerAlias('composition.inspect', 'observe.composition');
defaultRegistry.registerAlias('get_composition', 'observe.composition');
defaultRegistry.registerAlias('structure.get', 'observe.composition');
defaultRegistry.registerAlias('observe.hierarchy', 'observe.composition');
defaultRegistry.registerAlias('observe.structure', 'observe.composition');

// Audit aliases
defaultRegistry.registerAlias('audit.design', 'observe.audit');
defaultRegistry.registerAlias('audit_design', 'observe.audit');
defaultRegistry.registerAlias('design.audit', 'observe.audit');
defaultRegistry.registerAlias('observe.linter', 'observe.audit');
defaultRegistry.registerAlias('revyme_audit_design', 'observe.audit');

// Screenshot aliases
defaultRegistry.registerAlias('screenshot.capture', 'observe.screenshot');
defaultRegistry.registerAlias('get_screenshot', 'observe.screenshot');
defaultRegistry.registerAlias('capture.screenshot', 'observe.screenshot');
defaultRegistry.registerAlias('screenshot.get', 'observe.screenshot');
defaultRegistry.registerAlias('revyme_capture_screenshot', 'observe.screenshot');
