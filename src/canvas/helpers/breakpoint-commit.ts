// breakpoint-commit.ts — the editor's one way to COMMIT a start-model breakpoint edit (see
// code/project/breakpoint-ladder.ts): resize a breakpoint's start, add one, remove one. Shared by
// the Size panel's Width field, the tile drag, the "+" menu, Delete on a replica root and the
// agent's viewport tools.
//
// Each commit plans from the FRESH file (never a render closure — rapid consecutive commits run
// before React re-renders), rewrites it in one modifyProjectFile transaction, then mirrors the
// final ladder into the breakpoint store + widths atom and writes the viewport config through its
// atom (idempotent with the file, and the atom's setter adopts the write into a running gesture's
// stash so a drag commit is not reverted at gesture end).

import { getDefaultStore } from 'jotai';
import type { ViewportConfig } from '@/shared/types';
import { modifyProjectFile } from '@/code/project/modify-file';
import { parseCanvasConfig } from '@/code/project/canvas-config';
import { viewportsConfigAtom, viewportWidthsAtom, syncViewportWidths, getViewportWidths } from '@/code/stores/viewport-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { isStartModelLadder } from '@/code/project/breakpoint-ladder';
import { resizeBreakpointInCode, addBreakpointToCode, removeBreakpointFromCode } from '@/code/generation/breakpoint-ladder-apply';
import { trace } from '@/shared/debug-trace';

const store = getDefaultStore();

/** Does the active file edit its breakpoints in the start model? */
export function activeLadderIsStartModel(): boolean {
  return isStartModelLadder(store.get(viewportsConfigAtom));
}

function adopt(viewports: ViewportConfig[]): void {
  const widths = Object.fromEntries(viewports.map((v) => [v.id, v.width]));
  syncViewportWidths(widths);
  store.set(viewportWidthsAtom, widths);
  store.set(viewportsConfigAtom, viewports);
}

function commit(filePath: string, edit: (code: string, prev: ViewportConfig[]) => { code: string; viewports: ViewportConfig[] }): ViewportConfig[] | null {
  const box: { next: ViewportConfig[] | null } = { next: null };
  // The stores mirror the ACTIVE file's ladder; editing another file (the agent can) borrows the
  // breakpoint store for the rewrite and hands it back untouched.
  const isActive = store.get(activeFilePathAtom) === filePath;
  const borrowed = isActive ? null : getViewportWidths();
  modifyProjectFile(filePath, (code) => {
    const cfg = parseCanvasConfig(code);
    const result = edit(code, cfg?.viewports?.length ? cfg.viewports : isActive ? store.get(viewportsConfigAtom) : []);
    box.next = result.viewports;
    return result.code;
  });
  if (borrowed) syncViewportWidths(borrowed);
  else if (box.next) adopt(box.next);
  return box.next;
}

/** Move a breakpoint's START (its tile width). */
export function commitBreakpointStart(filePath: string, vpId: string, newStart: number): ViewportConfig[] | null {
  trace.action('breakpoint-commit:start', { vpId, newStart });
  return commit(filePath, (code, prev) => resizeBreakpointInCode(code, prev, vpId, newStart));
}

/** Add a breakpoint starting at `newVp.width`, its tile placed at `position`. */
export function commitBreakpointAdd(filePath: string, newVp: ViewportConfig, position: { x: number; y: number }): ViewportConfig[] | null {
  trace.action('breakpoint-commit:add', { vpId: newVp.id, start: newVp.width });
  return commit(filePath, (code, prev) => addBreakpointToCode(code, prev, newVp, position));
}

/** Remove a (non-primary) breakpoint; the next narrower one takes its range. */
export function commitBreakpointRemove(filePath: string, vpId: string): ViewportConfig[] | null {
  trace.action('breakpoint-commit:remove', { vpId });
  return commit(filePath, (code, prev) => removeBreakpointFromCode(code, prev, vpId));
}
