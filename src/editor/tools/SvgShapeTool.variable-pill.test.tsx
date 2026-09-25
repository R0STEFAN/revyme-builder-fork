import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { getDefaultStore } from 'jotai';

// An icon-set vector whose stroke is bound to a variable (`iconColor`) showed
// the variable's name on the Stroke label but a plain `#000000` colour field
// beside it — the bound row read as unbound, with no pill (user report
// 2026-09-25). The value column now shows the same variable pill as every
// other bound row.
const icon = (strokeStyle: string) => `'use client';
export default function Arrow({ style, iconColor = '#000000' }: { style?: React.CSSProperties; iconColor?: string }) {
  return (
    <div data-id="root" data-name="Arrow" style={{ position: 'relative', ...style }}>
      <svg data-id="shape-1" data-name="Arrow" viewBox="0 0 24 24" style={{ position: 'absolute', left: '0px', top: '0px', width: '240px', height: '240px'${strokeStyle} }}>
        <path data-id="shape-1-g0" d="M5 12h14M12 5l7 7-7 7" fill="none" stroke="#000000" strokeWidth="2" />
      </svg>
    </div>
  );
}`;

async function renderPanel(code: string) {
  if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const { codeAtom, selectedIdsAtom } = await import('@/code/stores/store');
  const { activeFilePathAtom } = await import('@/code/project/active-file-store');
  const PropertiesPanel = (await import('../PropertiesPanel')).default;
  const store = getDefaultStore();
  store.set(activeFilePathAtom, 'icons/Arrow.tsx');
  store.set(codeAtom, code);
  store.set(selectedIdsAtom, ['shape-1']);
  const r = render(<PropertiesPanel />);
  await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
  return r.container;
}

describe('SvgShapeTool — a paint bound to a variable shows the variable pill', () => {
  afterEach(() => cleanup());

  it('bound stroke: the pill names the variable, no raw colour field', async () => {
    const el = await renderPanel(icon(', stroke: iconColor'));
    expect(el.textContent).toContain('Stroke');
    const pill = el.querySelector('button[title^="Variable: iconColor"]');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('iconColor');
    // The Stroke colour row no longer carries the fallback colour as an editable field.
    const strokeInputs = Array.from(el.querySelectorAll('input')).filter((i) => (i as HTMLInputElement).value.toUpperCase() === '#000000');
    expect(strokeInputs).toHaveLength(0);
  }, 30_000);

  it('unbound stroke: the colour field, no pill', async () => {
    const el = await renderPanel(icon(''));
    expect(el.textContent).toContain('Stroke');
    expect(el.querySelector('button[title^="Variable:"]')).toBeNull();
  }, 30_000);
});
