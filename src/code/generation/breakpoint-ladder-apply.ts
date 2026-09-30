// breakpoint-ladder-apply.ts — apply a START-model breakpoint edit (breakpoint-ladder.ts) to a
// file's code: resize a breakpoint's start, add one, remove one. Every surface that edits
// breakpoints — the Size panel's Width field, the tile drag, the "+" menu, Delete on a replica,
// the agent's viewport tools — goes through these, so they cannot drift apart.
//
// Each width MOVE runs the editor's resize rewrite (rewriteWidthKeyedArtifacts) in the single
// resize's load-bearing order: declare the ladder the move produces in the breakpoint store (the
// rewrite reads it), rewrite, then declare it in the file's @canvas block (the next move's band
// clean-up converges bands onto the FILE's keys). The final @canvas carries every breakpoint's
// start (`designWidth`) and end (`width`).
//
// These functions touch the global breakpoint store (syncViewportWidths) and leave it holding the
// FINAL ladder — the caller mirrors it into the widths atom.

import type { ViewportConfig } from '@/shared/types';
import { parseCanvasConfig, updateCanvasConfigInCode } from '@/code/project/canvas-config';
import { syncViewportWidths } from '@/code/stores/viewport-store';
import { planAdd, planRemove, planResize, type LadderPlan, type WidthMove } from '@/code/project/breakpoint-ladder';
import { copyWidthKey, dropWidthKey } from '@/code/project/breakpoint-relabel';
import { rewriteWidthKeyedArtifacts } from './viewport-width-rewrite';
import {
  addResponsiveBreakpoint,
  clearContainerStylesForWidth,
  copyContainerRulesToNewWidth,
  normalizeResponsiveBandKeys,
  removeResponsiveBreakpoint,
} from './generator-styles';
import { trace } from '@/shared/debug-trace';

const widthsOf = (vps: ViewportConfig[]): Record<string, number> => Object.fromEntries(vps.map((v) => [v.id, v.width]));

/** Write `viewports` (and optionally positions) into the @canvas block, keeping everything else. */
function declareLadder(
  code: string,
  viewports: ViewportConfig[],
  positions?: (prev: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>,
): string {
  const cfg = parseCanvasConfig(code);
  if (!cfg) return code;
  return updateCanvasConfigInCode(code, {
    ...cfg,
    viewports: viewports.map((v) => ({ ...(cfg.viewports.find((c) => c.id === v.id) ?? {}), ...v })),
    positions: positions ? positions(cfg.positions) : cfg.positions,
  });
}

/** The plan's width moves, one resize rewrite each, each step's ladder declared (see header). */
export function applyWidthMoves(code: string, prev: ViewportConfig[], moves: WidthMove[]): string {
  let widths = widthsOf(prev);
  let out = code;
  for (const m of moves) {
    widths = Object.fromEntries(Object.entries(widths).map(([id, w]) => [id, w === m.from ? m.to : w]));
    syncViewportWidths({ ...widths });
    out = rewriteWidthKeyedArtifacts(out, m.from, m.to);
    const cfg = parseCanvasConfig(out);
    if (cfg) out = updateCanvasConfigInCode(out, { ...cfg, viewports: cfg.viewports.map((v) => ({ ...v, width: widths[v.id] ?? v.width })) });
  }
  return out;
}

function finish(code: string, plan: LadderPlan, positions?: Parameters<typeof declareLadder>[2]): string {
  syncViewportWidths(widthsOf(plan.viewports));
  return declareLadder(code, plan.viewports, positions);
}

/** Move one breakpoint's START. Returns the new code and viewports. */
export function resizeBreakpointInCode(code: string, prev: ViewportConfig[], vpId: string, newStart: number): { code: string; viewports: ViewportConfig[] } {
  const plan = planResize(prev, vpId, newStart);
  const out = finish(applyWidthMoves(code, prev, plan.moves), plan);
  trace.action('breakpoint-ladder:resize', { vpId, newStart, moves: plan.moves });
  return { code: out, viewports: plan.viewports };
}

/** Add a breakpoint starting at `newVp.width`, drawn at `position`. It opens looking like what
 *  its start width showed before (seeded from the breakpoint that owned it). */
export function addBreakpointToCode(
  code: string, prev: ViewportConfig[], newVp: ViewportConfig, position: { x: number; y: number },
): { code: string; viewports: ViewportConfig[] } {
  const plan = planAdd(prev, newVp);
  let out = applyWidthMoves(code, prev, plan.moves);
  syncViewportWidths(widthsOf(plan.viewports));
  const added = plan.viewports.find((v) => v.id === newVp.id)!;
  if (plan.seedFrom !== null) {
    out = copyContainerRulesToNewWidth(out, plan.seedFrom, added.width);
    out = copyWidthKey(out, plan.seedFrom, added.width);
  }
  out = addResponsiveBreakpoint(out, added.width, plan.seedFrom ?? added.width, plan.viewports.map((v) => v.width));
  out = finish(out, plan, (prevPos) => ({ ...prevPos, [newVp.id]: position }));
  // Band floors follow the final ladder even where nothing was copied or moved.
  out = normalizeResponsiveBandKeys(out, { force: true });
  trace.action('breakpoint-ladder:add', { vpId: newVp.id, start: newVp.width, end: added.width, seedFrom: plan.seedFrom, moves: plan.moves });
  return { code: out, viewports: plan.viewports };
}

/** Remove a (non-primary) breakpoint: its overrides go first, then the next narrower breakpoint
 *  takes over its range. */
export function removeBreakpointFromCode(code: string, prev: ViewportConfig[], vpId: string): { code: string; viewports: ViewportConfig[] } {
  const gone = prev.find((v) => v.id === vpId);
  if (!gone || gone.isPrimary) return { code, viewports: prev };
  const rest = prev.filter((v) => v.id !== vpId);
  syncViewportWidths(widthsOf(rest));
  let out = clearContainerStylesForWidth(code, gone.width);
  out = removeResponsiveBreakpoint(out, gone.width, rest.map((v) => v.width));
  out = dropWidthKey(out, gone.width);
  out = declareLadder(out, rest, (prevPos) => Object.fromEntries(Object.entries(prevPos).filter(([id]) => id !== vpId)));
  const plan = planRemove(prev, vpId);
  out = finish(applyWidthMoves(out, rest, plan.moves), plan);
  out = normalizeResponsiveBandKeys(out, { force: true });
  trace.action('breakpoint-ladder:remove', { vpId, width: gone.width, moves: plan.moves });
  return { code: out, viewports: plan.viewports };
}
