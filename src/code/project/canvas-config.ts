import type { ViewportConfig } from '@/shared/types';
import { DEFAULT_BREAKPOINT_STARTS, VIEWPORT_GAP } from '@/shared/constants';
import { trace } from '@/shared/debug-trace';

export interface CanvasConfig {
  viewports: ViewportConfig[];
  positions: Record<string, { x: number; y: number }>;
}

const CANVAS_BLOCK_REGEX = /\/\*\*\s*@canvas\s*(\{[\s\S]*?\})\s*\*\/\s*\n?/;

/** Parse /** @canvas { ... } *​/ from code string. Returns null if not found. */
export function parseCanvasConfig(code: string): CanvasConfig | null {
  const match = code.match(CANVAS_BLOCK_REGEX);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    trace.fn('canvas-config:parse', { viewportCount: parsed.viewports?.length });
    return {
      viewports: parsed.viewports || [],
      positions: parsed.positions || {},
    };
  } catch {
    trace.error('canvas-config:parse-failed', { raw: match[1].slice(0, 100) });
    return null;
  }
}

/** Serialize a CanvasConfig to the comment block string. */
export function serializeCanvasConfig(config: CanvasConfig): string {
  const json = JSON.stringify({
    viewports: config.viewports.map(v => {
      // `height` is optional but persisted EXPLICITLY when set — including
      // the string `'auto'` (e.g. user picked Auto on the viewport-frame
      // Height row). Skipping `'auto'` here would erase the user's
      // intent from the @canvas block; the SizeTool relies on the
      // explicit string to know whether to write `height: 'auto'` back
      // onto the root div. `undefined`/`0`/`null` still get filtered —
      // those mean "field never set" and would only clutter the JSON.
      const out: Record<string, unknown> = {
        id: v.id, label: v.label, width: v.width,
        isPrimary: v.isPrimary || false, order: v.order ?? 0,
      };
      // The width the tile RENDERS at, when it differs from the band's top.
      // Same rule as `height`: written only when set, because this is an
      // allow-list — a field missing here is silently dropped on the next
      // write, and the tile would snap back to its band width.
      if (typeof v.designWidth === 'number' && v.designWidth > 0 && v.designWidth !== v.width) {
        out.designWidth = v.designWidth;
      }
      if (v.height === 'auto') {
        out.height = 'auto';
      } else if (typeof v.height === 'number' && v.height > 0) {
        out.height = v.height;
      }
      return out;
    }),
    positions: config.positions,
  }, null, 2);
  trace.fn('canvas-config:serialize', { viewportCount: config.viewports.length, positionKeys: Object.keys(config.positions) });
  return `/** @canvas ${json} */\n`;
}

/** Update or insert the @canvas block in code. */
export function updateCanvasConfigInCode(code: string, config: CanvasConfig): string {
  const block = serializeCanvasConfig(config);
  const match = code.match(CANVAS_BLOCK_REGEX);
  if (match) {
    trace.action('canvas-config:update', 'replace-existing');
    return code.replace(CANVAS_BLOCK_REGEX, block);
  }
  // Insert: after 'use client' line, or at top
  const useClientMatch = code.match(/^['"]use client['"];?\s*\n/m);
  if (useClientMatch) {
    const insertIdx = useClientMatch.index! + useClientMatch[0].length;
    trace.action('canvas-config:update', 'insert-after-use-client');
    return code.slice(0, insertIdx) + '\n' + block + code.slice(insertIdx);
  }
  trace.action('canvas-config:update', 'insert-at-top');
  return block + code;
}

/** Strip the @canvas comment block (for preview/publish). */
export function stripCanvasConfig(code: string): string {
  const had = CANVAS_BLOCK_REGEX.test(code);
  if (had) trace.action('canvas-config:strip', 'removed');
  return code.replace(CANVAS_BLOCK_REGEX, '');
}

/**
 * The viewports a NEW page starts with — DEFAULT_BREAKPOINT_STARTS in the START model (see
 * code/project/breakpoint-ladder.ts): each breakpoint's `designWidth` is its start (its tile
 * width) and its `width` the end of its range (the next wider start − 1). `single` = the desktop
 * tile only (its breakpoints get added later with "+").
 */
export function defaultViewports(opts: { single?: boolean; height?: number | 'auto' } = {}): ViewportConfig[] {
  const { desktop, tablet, mobile } = DEFAULT_BREAKPOINT_STARTS;
  const h = opts.height !== undefined ? { height: opts.height } : {};
  const all: ViewportConfig[] = [
    { id: 'desktop', label: 'Desktop', width: desktop, isPrimary: true, order: 0, x: 0, y: 0, ...h },
    { id: 'tablet', label: 'Tablet', width: desktop - 1, designWidth: tablet, isPrimary: false, order: 1, x: 0, y: 0, ...h },
    { id: 'mobile', label: 'Mobile', width: tablet - 1, designWidth: mobile, isPrimary: false, order: 2, x: 0, y: 0, ...h },
  ];
  return opts.single ? all.slice(0, 1) : all;
}

/** Tiles side by side at their DRAWN widths (a start-model tile is drawn at its start). */
export function defaultPositions(viewports: ViewportConfig[]): Record<string, { x: number; y: number }> {
  let x = 0;
  const out: Record<string, { x: number; y: number }> = {};
  for (const v of viewports) {
    out[v.id] = { x, y: 0 };
    x += (v.designWidth && v.designWidth > 0 ? v.designWidth : v.width) + VIEWPORT_GAP;
  }
  return out;
}

/** The `/** @canvas … *\/` block a new page is scaffolded with (no trailing newline). */
export function defaultCanvasBlock(opts: { single?: boolean; height?: number | 'auto' } = {}): string {
  const viewports = defaultViewports(opts);
  return serializeCanvasConfig({ viewports, positions: defaultPositions(viewports) }).trimEnd();
}
