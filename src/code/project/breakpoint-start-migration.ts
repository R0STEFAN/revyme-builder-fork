// breakpoint-start-migration.ts — move a file to "a breakpoint's number is where it STARTS"
// (Framer's model) WITHOUT changing the engine.
//
// Every per-breakpoint mechanism (the @media bands, component-instance
// `data-responsive`, useResponsiveText, the useMediaQuery gates, the runtime)
// reads a viewport's `width` as the END of its range: `(previous end, width]`.
// So instead of rewriting all of them, each non-primary breakpoint gets TWO
// numbers:
//   - `designWidth` = where it STARTS — the width its tile is drawn at and the
//     number the user sees and edits (its old `width`, so every tile looks the
//     same as before);
//   - `width` = where it ENDS = the next-larger breakpoint's start − 1.
// 1440 / 768 / 375 becomes Tablet 768–1439 and Mobile < 768 (Framer), with
// Desktop 1440+. Framer-imported files already carry this shape
// (`width 1199, designWidth 810`) and are left alone.
//
// Any number of breakpoints, on either side of the primary. A breakpoint WIDER than the primary
// (Add Viewport's 1920 / 2560) starts where its number says and runs up from there — the primary
// then ends one pixel below it (1440 → 1440–1919, 1920 → 1920+). The widest breakpoint, when it is
// a replica, ends at OPEN_END: a plain band the editor reads like any other, just never reached.
// Breakpoints at the SAME width share one range (they already share their bands and keys).
//
// The width-keyed data is RELABELED, losslessly (breakpoint-relabel.ts): width queries are
// re-expressed by which tiles they match (rule bodies untouched), width keys are renamed old end →
// new end. Not the editor's resize rewrite — that one normalizes and re-serializes, which the
// production rehearsal showed is lossy on hand-written files.

import { parseCanvasConfig, updateCanvasConfigInCode } from './canvas-config';
import { relabelWidthQueries, renameWidthKey } from './breakpoint-relabel';
import { trace } from '@/shared/debug-trace';
import type { ViewportConfig } from '@/shared/types';

export interface LadderEntry {
  id: string;
  /** Where the breakpoint's range starts — the number shown to the user. */
  start: number;
  /** Where it ends — the stored `width` every mechanism reads. The primary at the top has none. */
  end: number | null;
}

/** The end of a range that has none — the widest breakpoint when it is not the primary. */
export const OPEN_END = 100000;

/**
 * The rule, in one place: given each breakpoint's START, its END is the next-larger distinct start
 * − 1. The widest range is open: no end when it is the primary's (the base design), OPEN_END when
 * it belongs to replicas. Breakpoints at the same start share a range. Pure. Sorted widest first.
 */
export function ladderFromStarts(starts: Array<{ id: string; start: number; isPrimary?: boolean }>): LadderEntry[] {
  const sorted = [...starts].sort((a, b) => b.start - a.start);
  const distinct = [...new Set(sorted.map((v) => v.start))];
  const primaryOnTop = sorted.some((v) => v.isPrimary && v.start === distinct[0]);
  return sorted.map((vp) => {
    const i = distinct.indexOf(vp.start);
    const end = i > 0 ? distinct[i - 1] - 1 : primaryOnTop ? null : OPEN_END;
    return { id: vp.id, start: vp.start, end };
  });
}

export interface MigrationStep { id: string; start: number; oldEnd: number; newEnd: number }

/** Does this file already follow the start model (a Framer import, or already migrated)? */
function alreadyStartModel(viewports: ViewportConfig[]): boolean {
  return viewports.some((v) => typeof v.designWidth === 'number' && v.designWidth > 0);
}

/**
 * Migrate ONE file. Returns the new code and the steps taken (empty = nothing to do: no
 * `@canvas`, a single breakpoint, or the file is already in the start model).
 */
export function migrateFileToStartBreakpoints(code: string): { code: string; steps: MigrationStep[] } {
  const config = parseCanvasConfig(code);
  if (!config || config.viewports.length < 2 || alreadyStartModel(config.viewports)) return { code, steps: [] };

  const primary = config.viewports.find((v) => v.isPrimary)
    ?? config.viewports.reduce((a, b) => (b.width > a.width ? b : a));
  const ladder = ladderFromStarts(config.viewports.map((v) => ({ id: v.id, start: v.width, isPrimary: v === primary })));

  const steps: MigrationStep[] = [];
  for (const entry of ladder) {
    if (entry.end === null) continue;                        // the primary's open range: nothing moves
    const vp = config.viewports.find((v) => v.id === entry.id)!;
    if (entry.end <= vp.width) continue;                      // breakpoints 1px apart: nothing to widen
    steps.push({ id: vp.id, start: entry.start, oldEnd: vp.width, newEnd: entry.end });
  }
  if (steps.length === 0) return { code, steps };
  const endOf = (v: ViewportConfig) => steps.find((s) => s.id === v.id)?.newEnd ?? v.width;
  const openTop = ladder.filter((e) => e.end === null).map((e) => e.id);
  // 1. Queries — every tile keeps its truth, the primary's range keeps its queries.
  //    When the primary is on top, its open range keeps its queries as they were.
  let out = relabelWidthQueries(code, {
    preserveAbove: openTop.length > 0,
    tiles: config.viewports.filter((v) => !openTop.includes(v.id)).map((v) => ({ drawn: v.width, newEnd: endOf(v) })),
  });
  // 2. Keys — widest first: a new end never collides with a narrower breakpoint's old end.
  //    Breakpoints sharing a width share their keys: rename each width once.
  for (const st of steps.filter((s, i) => steps.findIndex((o) => o.oldEnd === s.oldEnd) === i)) {
    out = renameWidthKey(out, st.oldEnd, st.newEnd);
  }
  // 3. Declare it: start = designWidth (the tile keeps its width), end = width.
  for (const st of steps) {
    const vp = config.viewports.find((v) => v.id === st.id)!;
    vp.designWidth = st.start;
    vp.width = st.newEnd;
  }
  out = updateCanvasConfigInCode(out, config);
  if (steps.length > 0) trace.action('breakpoint-migration:file', { steps });
  return { code: out, steps };
}
