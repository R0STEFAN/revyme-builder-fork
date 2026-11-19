import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn() } }));
import { checkFile } from './check-file';

// HARD user rule (2026-07-21): lineHeight is NEVER px (or any length unit) —
// only a unitless ratio ('1.2') or 'normal'. A px line-height freezes the
// leading; when the font size changes (responsive tier / user edit) the text
// overlaps or gaps out. Tightened from the old LINE_HEIGHT_FORMAT which
// still allowed px.

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

const sel = (code: string) => checkFile(code, { kind: 'page' }).filter((x) => x.code === 'LINE_HEIGHT_FORMAT');
const node = (style: string) => PAGE(`  <p data-id="a" data-name="A" style={{ position: 'relative', width: '100%', height: 'auto', margin: '0px', ${style} }}>x</p>`);

describe('line-height format dialect', () => {
  it('unitless ratios, normal, var(), px, em, rem, and percent pass', () => {
    expect(sel(node("lineHeight: '1.2'"))).toEqual([]);
    expect(sel(node("lineHeight: '1.495'"))).toEqual([]);
    expect(sel(node("lineHeight: 'normal'"))).toEqual([]);
    expect(sel(node("lineHeight: 'var(--typo-body-line-height)'"))).toEqual([]);
    expect(sel(node("fontSize: '40px', lineHeight: '48px'"))).toEqual([]);
    expect(sel(node("lineHeight: '1.2em'"))).toEqual([]);
    expect(sel(node("lineHeight: '1.5rem'"))).toEqual([]);
    expect(sel(node("lineHeight: '110%'"))).toEqual([]);
  });

  it('Figma comment debris or invalid strings bounce', () => {
    const out = sel(node("lineHeight: '110% /* 79.2px */'"));
    expect(out.length).toBe(1);
    expect(sel(node("lineHeight: 'abc'")).length).toBe(1);
  });
});
