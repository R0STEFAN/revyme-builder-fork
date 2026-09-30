// viewport-arg.ts — what a tool's `viewport` argument MEANS. The agent names a breakpoint the way
// the user sees it: by where it STARTS (its tile width — 375 for Mobile), or by id / label. On a
// start-model page (code/project/breakpoint-ladder.ts) the width its overrides are KEYED by is the
// stored `width` — the range's END (767) — so every write resolves the argument through here;
// the stored end itself is accepted too. Layout reads measure at the DRAWN width.

import { getDefaultStore } from 'jotai';
import { viewportsConfigAtom, viewportWidthsAtom } from '@/code/stores/viewport-store';
import { startOf } from '@/code/project/breakpoint-ladder';
import { renderWidth, withLiveWidth, type ViewportConfig } from '@/shared/types';

const store = getDefaultStore();

function findViewportArg(raw: unknown, viewports: ViewportConfig[]): ViewportConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return viewports.find((v) => startOf(v) === n) ?? viewports.find((v) => v.width === n);
  }
  const lower = s.toLowerCase();
  return viewports.find((v) => v.id.toLowerCase() === lower || (v.label ?? '').toLowerCase() === lower);
}

/** The width a `viewport` argument's overrides are keyed by; an unknown number passes through
 *  (the tool reports it), undefined when the argument is absent. */
export function viewportKeyWidth(raw: unknown, viewports: ViewportConfig[] = store.get(viewportsConfigAtom)): number | undefined {
  const vp = findViewportArg(raw, viewports);
  if (vp) return vp.width;
  const n = Number(String(raw ?? '').trim());
  return raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isFinite(n) ? n : undefined;
}

/** The viewport a `viewport` argument names (by start, stored end, id or label). */
export function viewportForArg(raw: unknown, viewports: ViewportConfig[] = store.get(viewportsConfigAtom)): ViewportConfig | undefined {
  return findViewportArg(raw, viewports);
}

/** Every viewport's DRAWN width (live during a width drag) — the number the agent names it by and
 *  the width its layout is measured at. */
export function drawnViewportWidths(): Record<string, number> {
  const stored = store.get(viewportWidthsAtom);
  return Object.fromEntries(store.get(viewportsConfigAtom).map((v) => [v.id, renderWidth(withLiveWidth(v, stored[v.id]))]));
}
