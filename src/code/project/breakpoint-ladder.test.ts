import { describe, it, expect } from 'vitest';
import { planResize, planAdd, planRemove, planLadder, isStartModelLadder, startOf } from './breakpoint-ladder';
import type { ViewportConfig } from '@/shared/types';

const vp = (id: string, width: number, designWidth?: number, isPrimary = false): ViewportConfig =>
  ({ id, label: id, width, ...(designWidth ? { designWidth } : {}), isPrimary, order: 0 }) as ViewportConfig;
// Desktop 1440+, tablet 768–1439, mobile < 768.
const LADDER = [vp('d', 1440, undefined, true), vp('t', 1439, 768), vp('m', 767, 375)];
const summary = (vps: ViewportConfig[]) => Object.fromEntries(vps.map((v) => [v.id, `${startOf(v)}–${v.width}`]));

describe('start-model ladder edits', () => {
  it('knows which pages edit in the start model', () => {
    expect(isStartModelLadder(LADDER)).toBe(true);
    expect(isStartModelLadder([vp('d', 1440, undefined, true)])).toBe(true);
    expect(isStartModelLadder([vp('d', 1440, undefined, true), vp('t', 768)])).toBe(false);
  });

  it('moving a start moves the NARROWER neighbour\'s end, nothing else', () => {
    const p = planResize(LADDER, 't', 810);
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', t: '810–1439', m: '375–809' });
    expect(p.moves).toEqual([{ from: 767, to: 809 }]);
  });

  it('moving the narrowest start moves nothing but its tile', () => {
    const p = planResize(LADDER, 'm', 390);
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', t: '768–1439', m: '390–767' });
    expect(p.moves).toEqual([]);
  });

  it('moving the primary moves the next breakpoint\'s end with it, in a safe order', () => {
    expect(planResize(LADDER, 'd', 1600).moves).toEqual([{ from: 1440, to: 1600 }, { from: 1439, to: 1599 }]);
    expect(planResize(LADDER, 'd', 1200).moves).toEqual([{ from: 1439, to: 1199 }, { from: 1440, to: 1200 }]);
  });

  it('a start dragged past its neighbour re-orders the ladder through a parking width', () => {
    const p = planResize(LADDER, 't', 300);
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', t: '300–374', m: '375–1439' });
    // tablet's 1439 must leave before mobile can take it; no move lands on a held width.
    const held = new Set(LADDER.map((v) => v.width));
    for (const m of p.moves) { expect(held.has(m.to)).toBe(false); held.delete(m.from); held.add(m.to); }
  });

  it('adding a breakpoint splits the range that held its start and seeds from it', () => {
    const p = planAdd(LADDER, vp('l', 1024));
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', t: '768–1023', m: '375–767', l: '1024–1439' });
    expect(p.moves).toEqual([{ from: 1439, to: 1023 }]);
    expect(p.seedFrom).toBe(1023);
  });

  it('adding below the narrowest seeds from the narrowest; above the primary from the base', () => {
    const small = planAdd(LADDER, vp('xs', 320));
    expect(summary(small.viewports)).toMatchObject({ m: '375–767', xs: '320–374' });
    expect(small.moves).toEqual([]);
    expect(small.seedFrom).toBe(767);
    const wide = planAdd(LADDER, vp('hd', 1920));
    expect(summary(wide.viewports)).toMatchObject({ d: '1440–1919', hd: '1920–100000' });
    expect(wide.moves).toEqual([{ from: 1440, to: 1919 }]);
    expect(wide.seedFrom).toBeNull();
  });

  it('the first breakpoint added to a single-breakpoint page starts the model', () => {
    const p = planAdd([vp('d', 1440, undefined, true)], vp('m', 390));
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', m: '390–1439' });
    expect(p.viewports.find((v) => v.id === 'm')!.designWidth).toBe(390);
  });

  it('removing a breakpoint lets the narrower one absorb its range', () => {
    const p = planRemove(LADDER, 't');
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', m: '375–1439' });
    expect(p.moves).toEqual([{ from: 767, to: 1439 }]);
    expect(planRemove(LADDER, 'm').moves).toEqual([]);
  });

  it('removing the widest replica gives the primary its open range back', () => {
    const wide = [vp('hd', 100000, 1920), vp('d', 1919, 1440, true), vp('t', 1439, 768)];
    const p = planRemove(wide, 'hd');
    expect(summary(p.viewports)).toEqual({ d: '1440–1440', t: '768–1439' });
    expect(p.viewports.find((v) => v.id === 'd')!.designWidth).toBeUndefined();
    expect(p.moves).toEqual([{ from: 1919, to: 1440 }]);
  });

  it('an unchanged ladder plans nothing', () => {
    expect(planLadder(LADDER).moves).toEqual([]);
    expect(planLadder(LADDER).viewports).toEqual(LADDER);
  });
});
