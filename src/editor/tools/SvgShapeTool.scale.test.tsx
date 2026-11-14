import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import React from 'react';

const component = `'use client';
import { motion } from 'framer-motion';
const variantConfig = [{ name: 'default', isPrimary: true }, { name: 'open' }];
const dotVariants = { default: { scale: 1 }, open: { scale: 2 } };
export default function Dot() {
  return <motion.div data-id="root" data-name="Dot" style={{ position: 'relative' }}>
    <motion.svg data-id="dot" data-name="Pulse" variants={dotVariants} viewBox="0 0 20 20" style={{ width: '8px', height: '8px' }}>
      <motion.circle data-id="circle" cx="10" cy="10" r="9" fill="red" />
    </motion.svg>
  </motion.div>;
}`;

describe('component SVG shape styles', () => {
  afterEach(() => cleanup());

  it('offers Scale on an animated SVG child', async () => {
    if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    const { codeAtom, selectedIdsAtom } = await import('@/code/stores/store');
    const { activeFilePathAtom } = await import('@/code/project/active-file-store');
    const PropertiesPanel = (await import('../PropertiesPanel')).default;
    const store = getDefaultStore();
    store.set(activeFilePathAtom, 'components/Dot.tsx');
    store.set(codeAtom, component);
    store.set(selectedIdsAtom, ['dot']);
    const panel = render(<PropertiesPanel />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(panel.container.textContent).toContain('Scale');
    const scaleRow = Array.from(panel.container.querySelectorAll('div')).find(el =>
      el.textContent?.trim() === 'Scale' && el.parentElement?.querySelector('input'))?.parentElement;
    const scaleInput = scaleRow?.querySelector('input');
    expect(scaleInput).not.toBeNull();
    expect(scaleInput!.disabled).toBe(false);
    expect(scaleInput!.value).toBe('1');
  }, 30_000);
});
