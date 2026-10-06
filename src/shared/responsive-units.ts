// responsive-units.ts — vw/vh → px resolution against a specific simulated
// viewport width.
//
// Why this exists: the canvas renders multiple simulated viewports
// (Desktop 1440, Tablet 768, Mobile 375) inside a single sandbox iframe.
// Native CSS `vw` resolves against the iframe window's width, so a value
// of `9vw` would paint at the SAME px size in every viewport. We want
// each viewport to scale `vw` against its own width (`data-viewport-width`)
// so the simulated breakpoints actually preview at proportional sizes.
//
// This module is the single source of truth for that conversion. It's
// used both by:
//   - Canvas Renderer (`canvas/Renderer.ts`) on every full patchElement,
//   - Sandbox bridge (`canvas-sandbox/bridge-sandbox.ts`) on live
//     `patchStyles` writes during slider drags / control edits.
//
// Without the bridge call, primary→replica fan-out during a live edit
// writes `el.style.fontSize = '9vw'` verbatim and CSS resolves them all
// against the iframe → every replica jumps to the same px size, snapping
// back to per-viewport-correct sizes only on the next full render.
// (User-reported: "when I increase font size on primary, replica px's
// are just having same px as primary".)
//
// vh has no real container in the canvas — fall back to a width-based
// height ratio per device class. Same heuristic the Renderer uses.

import { trace } from './debug-trace';
import { drawnTileRange } from './canvas-band-queries';

const VW_INNER_RE = /([\d.]+)(svw|dvw|lvw|vw|svi|dvi|lvi|vi)\b/gi;
const VH_INNER_RE = /([\d.]+)(svh|dvh|lvh|vh|svb|dvb|lvb|vb)\b/gi;
const VMIN_INNER_RE = /([\d.]+)(svmin|dvmin|lvmin|vmin)\b/gi;
const VMAX_INNER_RE = /([\d.]+)(svmax|dvmax|lvmax|vmax)\b/gi;
const ANY_VP_UNIT_RE = /[\d.](svw|dvw|lvw|vw|svi|dvi|lvi|vi|svh|dvh|lvh|vh|svb|dvb|lvb|vb|svmin|dvmin|lvmin|vmin|svmax|dvmax|lvmax|vmax)\b/i;

/** Simulated viewport height for a given width — the canvas has no real
 *  viewport, so vh resolves via a per-device-class ratio:
 *  Desktop (>= 1024): landscape 16:10 → height = width × 0.625
 *  Tablet  (< 1024):  portrait  3:4   → height = width × 1.33
 *  Phone   (< 500):   portrait  9:19.5 → height = width × 2.16
 *  (Same heuristic as `editor/tools/size-helpers.estimatedVpHeight`.) */
export function simulatedVpHeight(vpWidthPx: number): number {
  const heightRatio = vpWidthPx >= 1024 ? 0.625 : vpWidthPx >= 500 ? 1.33 : 2.16;
  return vpWidthPx * heightRatio;
}

/**
 * Canvas anchoring for a `position: fixed` node.
 *
 * The canvas turns `fixed` into `absolute` (a transformed ancestor breaks
 * fixed positioning), which leaves `bottom: 50px` measured from the bottom of
 * the WHOLE PAGE — a dock meant to float over the hero ends up 10,000px down,
 * past the footer. On a real screen a fixed element only ever lives inside one
 * viewport height, so the canvas has to show it there: measure from the top of
 * the tile — the same place a real screen would put it.
 *
 * `bottom: B` becomes `top: <vh − B>` plus a `translateY(-100%)` so the
 * element's BOTTOM edge lands on the `vh − B` line. A top-anchored fixed node
 * already measures from the top of the tile and is left alone.
 *
 * Returns null when there is nothing to re-anchor.
 */
export function canvasFixedAnchor(
  styles: Record<string, string>,
  vpWidthPx: number,
): Record<string, string> | null {
  if (styles.position !== 'fixed') return null;
  const top = styles.top;
  if (top != null && top !== '' && top !== 'auto') return null;   // already top-anchored
  const raw = styles.bottom;
  if (raw == null || raw === '' || raw === 'auto') return null;
  const bottom = parseFloat(resolveResponsiveUnits(raw, vpWidthPx));
  if (!isFinite(bottom)) return null;
  const existing = styles.transform && styles.transform !== 'none' ? ` ${styles.transform}` : '';
  return {
    top: `${Math.round(simulatedVpHeight(vpWidthPx) - bottom)}px`,
    bottom: 'auto',
    // Pure translations commute, so a centring `translate(-50%)` still applies.
    transform: `translateY(-100%)${existing}`,
  };
}

/** Default viewport width used when an element isn't inside a
 *  `[data-viewport]` container (canvas-hoisted nodes, off-canvas
 *  rendering, etc.). Mirrors the Renderer's fallback so both paths
 *  agree on what `vw` means in the absence of a viewport. */
export const FALLBACK_VP_WIDTH = 1440;

/** Resolve a single CSS value's `vw` / `vh` / `svh` / `svw` / `dvh` / `dvw` / `lvh` / `lvw`
 *  units to absolute `px` against `vpWidthPx`. Pass-through for non-string values, empty
 *  strings, and values that don't contain viewport units.
 *
 *  Handles three cases:
 *   - `9vw` / `9svw` / `9dvw` → `${9/100 * vpWidthPx}px`
 *   - `clamp(16px, 4svw, 48px)` → inner regex replace of every viewport unit
 *   - `9vh` / `9svh` / `9dvh` → width-based height ratio (no real vh container) */
export function resolveResponsiveUnits(value: string, vpWidthPx: number): string {
  if (typeof value !== 'string' || value === '') return value;
  if (!ANY_VP_UNIT_RE.test(value)) return value;
  let v = value;
  const vpHeightPx = simulatedVpHeight(vpWidthPx);
  const minDim = Math.min(vpWidthPx, vpHeightPx);
  const maxDim = Math.max(vpWidthPx, vpHeightPx);

  const exactMatch = v.trim().match(/^(-?[\d.]+)(svw|dvw|lvw|vw|svi|dvi|lvi|vi|svh|dvh|lvh|vh|svb|dvb|lvb|vb|svmin|dvmin|lvmin|vmin|svmax|dvmax|lvmax|vmax)$/i);
  if (exactMatch) {
    const num = parseFloat(exactMatch[1]);
    const unit = exactMatch[2].toLowerCase();
    if (!isNaN(num)) {
      if (['svw', 'dvw', 'lvw', 'vw', 'svi', 'dvi', 'lvi', 'vi'].includes(unit)) {
        v = `${(num / 100) * vpWidthPx}px`;
      } else if (['svh', 'dvh', 'lvh', 'vh', 'svb', 'dvb', 'lvb', 'vb'].includes(unit)) {
        v = `${(num / 100) * vpHeightPx}px`;
      } else if (['svmin', 'dvmin', 'lvmin', 'vmin'].includes(unit)) {
        v = `${(num / 100) * minDim}px`;
      } else if (['svmax', 'dvmax', 'lvmax', 'vmax'].includes(unit)) {
        v = `${(num / 100) * maxDim}px`;
      }
    }
  } else {
    v = v
      .replace(VW_INNER_RE, (_, n) => `${(parseFloat(n) / 100) * vpWidthPx}px`)
      .replace(VH_INNER_RE, (_, n) => `${(parseFloat(n) / 100) * vpHeightPx}px`)
      .replace(VMIN_INNER_RE, (_, n) => `${(parseFloat(n) / 100) * minDim}px`)
      .replace(VMAX_INNER_RE, (_, n) => `${(parseFloat(n) / 100) * maxDim}px`);
  }

  if (v !== value) {
    trace.action('responsive-units:resolved', { from: value, to: v, vpWidthPx });
  }
  return v;
}

/** Resolve the viewport width that responsive units should resolve
 *  against for a given canvas element. Reads `data-viewport-width`
 *  from the closest `[data-viewport]` ancestor; falls back to
 *  `FALLBACK_VP_WIDTH` when the element is canvas-hoisted or
 *  outside a viewport. */
export function getResponsiveVpWidth(el: Element | null): number {
  if (!el) return FALLBACK_VP_WIDTH;
  const vp = el.closest('[data-viewport]') as HTMLElement | null;
  const w = parseFloat(vp?.getAttribute('data-viewport-width') || '');
  return Number.isFinite(w) && w > 0 ? w : FALLBACK_VP_WIDTH;
}

const QUERY_BOUND_RE = /\(\s*(min|max)-width:\s*([\d.]+)px\s*\)/g;

/** Resolve viewport units INSIDE `@container (…) { … }` blocks of canvas-
 *  injected CSS to per-tile px.
 *
 *  Why: the canvas transforms source `@media` overrides to `@container` so
 *  each side-by-side tile responds to its own width — but any viewport VALUE
 *  inside the block is still resolved by native CSS against the IFRAME
 *  window. A per-viewport `font-size: clamp(40px, 11.6vw, 163px) !important`
 *  override therefore painted at the clamp MAX on every tile (11.6vw of the
 *  whole canvas ≫ 163px) — and, being `!important`, it beat the correctly
 *  per-tile-resolved inline merge from patchElement (live find 2026-07-13:
 *  template footer wordmark giant on the mobile tile, correct on live).
 *
 *  A block can match MORE THAN ONE configured tile (e.g. `max-width: 1199px`
 *  matches 768 AND 375), and each tile needs a different px — so a viewport-
 *  carrying block is emitted once per matching width, scoped to exactly that
 *  width (`(min-width: W) and (max-width: W)`), with units resolved against
 *  W. Blocks without viewport units (and non-block text) pass through untouched.
 *  Runs at canvas-injection time only — the source keeps real viewport units. */
export function resolveContainerQueryUnits(css: string, viewportWidthsAsc: number[], opts?: { drawnLadder?: boolean }): string {
  if (!css || viewportWidthsAsc.length === 0) return css;
  if (!ANY_VP_UNIT_RE.test(css)) return css;
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@container', i);
    if (at === -1) { out += css.slice(i); break; }
    const braceOpen = css.indexOf('{', at);
    if (braceOpen === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    let depth = 1;
    let j = braceOpen + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const query = css.slice(at, braceOpen);
    const body = css.slice(braceOpen + 1, j - 1);
    if (!ANY_VP_UNIT_RE.test(body)) { out += css.slice(at, j); i = j; continue; }
    let min = -Infinity;
    let max = Infinity;
    for (const m of query.matchAll(QUERY_BOUND_RE)) {
      if (m[1] === 'min') min = Math.max(min, parseFloat(m[2]));
      else max = Math.min(max, parseFloat(m[2]));
    }
    const matching = viewportWidthsAsc.filter(w => w >= min && w <= max);
    if (matching.length === 0) { out += css.slice(at, j); i = j; continue; }
    const toPx = (px: number): string => `${Math.round(px * 100) / 100}px`;
    // With `drawnLadder` (tiles drawn at their range's START — see canvas-band-queries) each copy
    // is scoped to the tile's own drawn-ladder range, not its exact width: the container measures
    // inside the root's padding, so an exact `(min-width: W) and (max-width: W)` missed a padded tile.
    const desc = opts?.drawnLadder ? [...new Set(viewportWidthsAsc)].sort((a, b) => b - a) : null;
    for (const w of matching) {
      const vhH = simulatedVpHeight(w);
      const minD = Math.min(w, vhH);
      const maxD = Math.max(w, vhH);
      const resolvedBody = body
        .replace(VW_INNER_RE, (_, n) => toPx((parseFloat(n) / 100) * w))
        .replace(VH_INNER_RE, (_, n) => toPx((parseFloat(n) / 100) * vhH))
        .replace(VMIN_INNER_RE, (_, n) => toPx((parseFloat(n) / 100) * minD))
        .replace(VMAX_INNER_RE, (_, n) => toPx((parseFloat(n) / 100) * maxD));
      out += `@container ${desc ? drawnTileRange(w, desc) : `(min-width: ${w}px) and (max-width: ${w}px)`} {${resolvedBody}}\n`;
    }
    trace.action('responsive-units:container-block-resolved', { query: query.trim(), widths: matching });
    i = j;
  }
  return out;
}

/** Resolve every value in a styles map for a given viewport width.
 *  Used by the sandbox bridge so a single `applyTwoPass` call can
 *  resolve all entries before writing to `el.style`. Empty strings
 *  and non-vw/vh values pass through untouched. */
export function resolveResponsiveStyles(
  styles: Record<string, string>,
  vpWidthPx: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    out[key] = resolveResponsiveUnits(value, vpWidthPx);
  }
  return out;
}
