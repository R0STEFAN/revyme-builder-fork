// breakpoint-ladder.ts — editing breakpoints in the START model (Framer's): a breakpoint's number
// is where its range STARTS. What the user sees and edits is the start (`designWidth`, the width
// its tile is drawn at); what every width-keyed mechanism reads is the END (`width` = the next
// wider start − 1). See breakpoint-start-migration.ts for the model and ladderFromStarts for the
// rule; this module plans the EDITS — resize a start, add a breakpoint, remove one — as:
//   · the next viewport list (width + designWidth for every breakpoint), and
//   · the width MOVES (old end → new end) that re-key the file's width-keyed data, ordered so a
//     move never lands on a width another breakpoint still holds.
// Moving tablet's start 768 → 810 moves MOBILE's end 767 → 809 (tablet's own end is untouched);
// adding 1024 between tablet and desktop splits tablet's range; removing tablet lets mobile absorb
// its range. Pure — the caller applies the moves with the resize rewrite and writes the config.
//
// A page is on the start model once any breakpoint carries a `designWidth` (migrated pages,
// Framer imports), or while it has a single breakpoint (the next one added starts it). Classic
// multi-breakpoint pages keep the classic edits until migrated.

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

/** Where a breakpoint's range starts — the number the user sees. */
export const startOf = (vp: Pick<ViewportConfig, 'width' | 'designWidth'>): number =>
  vp.designWidth && vp.designWidth > 0 ? vp.designWidth : vp.width;

/** Does this page edit its breakpoints in the start model? */
export function isStartModelLadder(viewports: ViewportConfig[]): boolean {
  return viewports.length <= 1 || viewports.some((v) => typeof v.designWidth === 'number' && v.designWidth > 0);
}

export interface WidthMove { from: number; to: number }

export interface LadderPlan {
  /** The viewports after the edit: `width` = end, `designWidth` = start (absent when equal). */
  viewports: ViewportConfig[];
  /** Ordered width moves — apply each with the resize rewrite, in this order. */
  moves: WidthMove[];
}

function primaryOf(viewports: ViewportConfig[]): ViewportConfig {
  return viewports.find((v) => v.isPrimary) ?? viewports.reduce((a, b) => (startOf(b) > startOf(a) ? b : a));
}

/** Order moves so every step keeps a valid ladder: a move never lands on a width another
 *  breakpoint still holds, and — where possible — never crosses one (the resize rewrite reads the
 *  intermediate ladder; a crossing would briefly make a replica wider than the primary). A true
 *  re-order (a start dragged past its neighbour) parks one move above OPEN_END for a step. */
function orderMoves(pairs: WidthMove[], held: number[]): WidthMove[] {
  const pending = pairs.filter((m) => m.from !== m.to).map((m) => ({ ...m }));
  const current = new Set(held);
  const out: WidthMove[] = [];
  let parking = OPEN_END + 1;
  const apply = (m: WidthMove) => { out.push(m); current.delete(m.from); current.add(m.to); };
  while (pending.length) {
    const free = pending.filter((m) => !current.has(m.to));
    const straight = free.find((m) => ![...current].some((w) => w !== m.from && w > Math.min(m.from, m.to) && w < Math.max(m.from, m.to)));
    const pick = straight ?? free[0];
    if (pick) { pending.splice(pending.indexOf(pick), 1); apply({ from: pick.from, to: pick.to }); continue; }
    const m = pending[0];
    apply({ from: m.from, to: parking });
    m.from = parking++;
  }
  return out;
}

/**
 * The whole ladder from each breakpoint's START. `starts` overrides some starts (the edit); the
 * rest keep their current one. Viewports not in `prev` can't be planned here — see planAdd.
 */
export function planLadder(prev: ViewportConfig[], starts: Record<string, number> = {}): LadderPlan {
  if (prev.length === 0) return { viewports: [], moves: [] };
  const primary = primaryOf(prev);
  const ladder = ladderFromStarts(prev.map((v) => ({ id: v.id, start: starts[v.id] ?? startOf(v), isPrimary: v === primary })));
  const viewports = prev.map((v) => {
    const entry = ladder.find((e) => e.id === v.id)!;
    const width = entry.end ?? entry.start;
    const next: ViewportConfig = { ...v, width };
    if (width !== entry.start) next.designWidth = entry.start;
    else delete next.designWidth;
    return next;
  });
  // One move per distinct old width (breakpoints sharing a width share its keys).
  const pairs: WidthMove[] = [];
  prev.forEach((v, i) => {
    if (v.width !== viewports[i].width && !pairs.some((p) => p.from === v.width)) pairs.push({ from: v.width, to: viewports[i].width });
  });
  return { viewports, moves: orderMoves(pairs, prev.map((v) => v.width)) };
}

/** Move one breakpoint's START (the Size panel's Width field, the tile drag, the agent). */
export function planResize(prev: ViewportConfig[], vpId: string, newStart: number): LadderPlan {
  return planLadder(prev, { [vpId]: Math.round(newStart) });
}

export interface AddPlan extends LadderPlan {
  /** Seed the new breakpoint's overrides from this END width — the breakpoint whose range held
   *  its start (what that width showed before), AFTER the moves — or null when the base design
   *  held it. Apply the moves first, then seed. */
  seedFrom: number | null;
}

/**
 * Add a breakpoint starting at `newVp.width`. It takes the part of the range that held its start:
 * the breakpoint that owned that width keeps the rest, and the new one opens looking exactly as
 * that width looked (its overrides are seeded from the owner's). The primary's range holds no
 * overrides (it is the base design), so a breakpoint carved out of it starts from the base.
 */
export function planAdd(prev: ViewportConfig[], newVp: ViewportConfig): AddPlan {
  const start = Math.round(newVp.width);
  if (prev.length === 0) return { viewports: [{ ...newVp, width: start, isPrimary: true }], moves: [], seedFrom: null };
  const primary = primaryOf(prev);
  // The owner of `start` today: the breakpoint with the largest start ≤ it (or the smallest one).
  const byStart = [...prev].sort((a, b) => startOf(b) - startOf(a));
  const owner = byStart.find((v) => startOf(v) <= start) ?? byStart[byStart.length - 1];
  const planned = planLadder([...prev, { ...newVp, width: start, designWidth: undefined, isPrimary: false }], {});
  // The new breakpoint was not in `prev`: its data is created (seeded), never moved.
  const moves = planned.moves.filter((m) => m.from !== start);
  const ownerAfter = owner && owner.id !== primary.id ? planned.viewports.find((v) => v.id === owner.id) : undefined;
  return { viewports: planned.viewports, moves, seedFrom: ownerAfter ? ownerAfter.width : null };
}

/**
 * Remove a (non-primary) breakpoint: its overrides go, and its range is absorbed by the next
 * narrower breakpoint (or, when it was the narrowest, by the next wider one's floor). The caller
 * deletes the removed breakpoint's data FIRST, then applies the moves.
 */
export function planRemove(prev: ViewportConfig[], vpId: string): LadderPlan {
  return planLadder(prev.filter((v) => v.id !== vpId), {});
}
