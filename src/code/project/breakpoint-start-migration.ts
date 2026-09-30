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
import { planLadder, startOf } from './breakpoint-ladder';
import { trace } from '@/shared/debug-trace';

// The rule (ladderFromStarts, OPEN_END) lives with the edit planner; re-exported for callers.
export { ladderFromStarts, OPEN_END, type LadderEntry } from './breakpoint-ladder';

export interface MigrationStep { id: string; start: number; oldEnd: number; newEnd: number }

/**
 * Migrate ONE file. Returns the new code and the steps taken (empty = nothing to do: no
 * `@canvas`, a single breakpoint, or the file is already in the start model).
 */
export function migrateFileToStartBreakpoints(code: string): { code: string; steps: MigrationStep[] } {
  const config = parseCanvasConfig(code);
  if (!config || config.viewports.length < 2) return { code, steps: [] };

  // Each breakpoint's START is its designWidth, or its width when it has none (a classic file,
  // or a breakpoint appended in the classic shape to a start-model page). The planner turns the
  // starts into ends and orders the key moves so none lands on a width still held.
  const plan = planLadder(config.viewports);
  const steps: MigrationStep[] = [];
  config.viewports.forEach((vp, i) => {
    const next = plan.viewports[i];
    if (next.width !== vp.width) steps.push({ id: vp.id, start: startOf(next), oldEnd: vp.width, newEnd: next.width });
  });
  if (steps.length === 0) return { code, steps };

  // 1. Queries — every tile keeps its truth; when the primary is on top, its open range keeps
  //    its queries as they were.
  const primary = config.viewports.find((v) => v.isPrimary)
    ?? config.viewports.reduce((a, b) => (startOf(b) > startOf(a) ? b : a));
  const topStart = Math.max(...config.viewports.map(startOf));
  const openTop = startOf(primary) === topStart
    ? config.viewports.filter((v) => startOf(v) === topStart).map((v) => v.id)
    : [];
  let out = relabelWidthQueries(code, {
    preserveAbove: openTop.length > 0,
    tiles: config.viewports
      .map((v, i) => ({ id: v.id, drawn: startOf(v), newEnd: plan.viewports[i].width }))
      .filter((t) => !openTop.includes(t.id))
      .map(({ drawn, newEnd }) => ({ drawn, newEnd })),
  });
  // 2. Keys — in the planner's collision-free order.
  for (const m of plan.moves) out = renameWidthKey(out, m.from, m.to);
  // 3. Declare it: start = designWidth (the tile keeps its width), end = width.
  config.viewports = plan.viewports;
  out = updateCanvasConfigInCode(out, config);
  if (steps.length > 0) trace.action('breakpoint-migration:file', { steps });
  return { code: out, steps };
}
