import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn() } }));
import { checkFile } from './check-file';

// The Size tool's min/max secondary controls only offer a px/% unit toggle
// (unlike the primary width/height which also do Fit/Fill). So a committed
// minWidth/maxWidth/minHeight/maxHeight must be a plain px or % length — a
// viewport unit ('100vh'), em/rem/ch, calc() or a keyword reads as unset and is
// lost on the next edit (live find 2026-07-04: a full-height hero shipped
// minHeight: '100vh', which the panel could not represent).

const PAGE = (body: string) => `'use client';

/** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1440, "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */

import React from 'react';

export default function Page() {
  return (
<div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', height: '900px' }}>
${body}
</div>
  );
}`;

const sel = (code: string) => checkFile(code, { kind: 'page' }).filter((x) => x.code === 'MINMAX_SIZE_UNIT');

const node = (style: string) => PAGE(`  <div data-id="a" data-name="A" style={{ position: 'relative', width: 'auto', height: 'auto', ${style} }}>x</div>`);

describe('min/max size unit dialect', () => {
  it('px, %, vh, vw, dvh, svh, rem, em, ch, clamp() and none/auto pass on every min/max key', () => {
    expect(sel(node("minHeight: '800px'"))).toEqual([]);
    expect(sel(node("minHeight: '100vh'"))).toEqual([]);
    expect(sel(node("minHeight: '100dvh'"))).toEqual([]);
    expect(sel(node("maxHeight: '90%'"))).toEqual([]);
    expect(sel(node("minWidth: '320px'"))).toEqual([]);
    expect(sel(node("maxWidth: '100%'"))).toEqual([]);
    expect(sel(node("maxWidth: 'none'"))).toEqual([]);
    expect(sel(node("minWidth: 'auto'"))).toEqual([]);
    for (const ok of ['100vw', '20em', '4rem', '10ch', '80svh', 'clamp(300px, 50vw, 1200px)']) {
      expect(sel(node(`maxWidth: '${ok}'`)), ok).toEqual([]);
    }
  });

  it("bare '0' and a cleared '' pass", () => {
    expect(sel(node("minWidth: '0'"))).toEqual([]);
    expect(sel(node("maxWidth: ''"))).toEqual([]);
  });

  it('decimal px/% pass', () => {
    expect(sel(node("minHeight: '12.5px'"))).toEqual([]);
    expect(sel(node("maxWidth: '33.33%'"))).toEqual([]);
  });

  it('unsupported units/keywords (vmin, vmax, calc, min-content) bounce', () => {
    for (const bad of ['80vmin', '50vmax', 'calc(100vh - 80px)', 'min-content']) {
      const out = sel(node(`maxWidth: '${bad}'`));
      expect(out.length, bad).toBe(1);
      expect(out[0].message, bad).toContain(bad);
    }
  });

  it('all four keys are covered in one file', () => {
    const out = sel(PAGE(`  <div data-id="a" data-name="A" style={{ position: 'relative', width: 'auto', height: 'auto', minWidth: '10vmin', maxWidth: '10vmin', minHeight: '10vmin', maxHeight: '10vmin' }}>x</div>`));
    expect(out.length).toBe(4);
  });

  it('a ternary branch with a bad unit bounces (responsive/per-variant value)', () => {
    const out = sel(node("minHeight: variant === 'x' ? '80vmin' : '800px'"));
    expect(out.length).toBe(1);
    expect(out[0].message).toContain('80vmin');
  });

  it('a ternary with valid units in both branches passes', () => {
    expect(sel(node("minHeight: variant === 'x' ? '600px' : '100vh'"))).toEqual([]);
  });
});
