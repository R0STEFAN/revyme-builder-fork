// canvas-band-queries.ts — source `@media` width queries → canvas `@container` queries keyed to
// the tiles' DRAWN widths.
//
// On the published site a band is evaluated against the WINDOW width. On the canvas each tile's
// root is the query container, and a container query measures the root's CONTENT box: the root's
// own horizontal padding + border come off. A breakpoint drawn at the TOP of its range (its
// `width` = the range's end — the classic ladder) shrugs that off: padding only moves the
// container down inside its own range. A breakpoint drawn at its START (`designWidth`: Framer
// imports and the start-model migration) sits at the BOTTOM of its range, so 1px of root padding
// or border dropped the tile into the next band down — a tablet tile painting the mobile styles
// (verified in Chromium: a 768px tile with `padding: 0 20px` measures 728px).
//
// So on such a page each query is re-expressed by WHICH TILES it matches at their drawn widths —
// what a window at that width shows — in a ladder where every tile's own range TOPS OUT at its
// drawn width (`(max-width: 768px) and (min-width: 375.02px)` for a 768 tile above a 375 one).
// The same tiles match; root padding is harmless again. Canvas-only: the source keeps its queries.

import { trace } from '@/shared/debug-trace';

const WIDTH_COND_RE = /^\(\s*(min|max)-width:\s*([\d.]+)px\s*\)$/;

export type WidthClause = Array<{ kind: 'min' | 'max'; px: number }>;

/** A pure width query (`(max-width: Npx) and (min-width: Mpx)`, comma lists) → its clauses, or
 *  null for anything else (orientation, hover, `screen and …`) — those pass through unchanged. */
export function parseWidthQuery(query: string): Array<Array<{ kind: 'min' | 'max'; px: number }>> | null {
  const clauses = query.split(',').map((c) => c.trim());
  const out: Array<Array<{ kind: 'min' | 'max'; px: number }>> = [];
  for (const clause of clauses) {
    const conds = clause.split(/\s+and\s+/i).map((c) => c.trim());
    const parsed: Array<{ kind: 'min' | 'max'; px: number }> = [];
    for (const c of conds) {
      const m = WIDTH_COND_RE.exec(c);
      if (!m) return null;
      parsed.push({ kind: m[1] as 'min' | 'max', px: parseFloat(m[2]) });
    }
    if (parsed.length === 0) return null;
    out.push(parsed);
  }
  return out;
}

export const matchesAt = (clauses: WidthClause[], w: number): boolean =>
  clauses.some((conds) => conds.every((c) => (c.kind === 'min' ? w >= c.px : w <= c.px)));

/** The range a tile owns in the drawn-width ladder: tops out at its drawn width (none for the
 *  widest), floors just above the next-smaller tile (none for the smallest). */
export function drawnTileRange(width: number, drawnDesc: number[]): string {
  const idx = drawnDesc.indexOf(width);
  const conds: string[] = [];
  if (idx > 0) conds.push(`(max-width: ${width}px)`);
  if (idx >= 0 && idx < drawnDesc.length - 1) conds.push(`(min-width: ${drawnDesc[idx + 1] + 0.02}px)`);
  return conds.join(' and ') || '(min-width: 0px)';
}

/** A set of tiles (drawn widths) → one container query: contiguous runs of the ladder collapse to
 *  one range, separate runs comma-join. An empty set never matches. */
function drawnSetToQuery(set: Set<number>, drawnDesc: number[]): string {
  if (set.size === 0) return 'not (min-width: 0px)';
  const parts: string[] = [];
  let i = 0;
  while (i < drawnDesc.length) {
    if (!set.has(drawnDesc[i])) { i++; continue; }
    let j = i;
    while (j + 1 < drawnDesc.length && set.has(drawnDesc[j + 1])) j++;
    const conds: string[] = [];
    if (i > 0) conds.push(`(max-width: ${drawnDesc[i]}px)`);
    if (j < drawnDesc.length - 1) conds.push(`(min-width: ${drawnDesc[j + 1] + 0.02}px)`);
    parts.push(conds.join(' and ') || '(min-width: 0px)');
    i = j + 1;
  }
  return parts.join(', ');
}

/**
 * Canvas CSS for a page: `@media (…)` → `@container (…)`. With `drawnWidths` (every tile's drawn
 * width) each pure width query is re-expressed in the drawn-width ladder (see the header); without
 * them — or for a non-width query — it is the plain rename the canvas has always done.
 */
export function mediaToCanvasContainer(css: string, drawnWidths?: number[] | null): string {
  if (!css) return css;
  const drawnDesc = [...new Set((drawnWidths ?? []).filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => b - a);
  if (drawnDesc.length === 0) return css.replace(/@media\s*\(/g, '@container (');
  let remapped = 0;
  const out = css.replace(/@media\s*(\([^{]*?)\s*\{/g, (full, query: string) => {
    const clauses = parseWidthQuery(query);
    if (!clauses) return `@container ${query} {`;
    remapped++;
    const set = new Set(drawnDesc.filter((w) => matchesAt(clauses, w)));
    return `@container ${drawnSetToQuery(set, drawnDesc)} {`;
  });
  if (remapped > 0) trace.fn('canvas-band-queries:remap', { remapped, drawn: drawnDesc });
  return out;
}
