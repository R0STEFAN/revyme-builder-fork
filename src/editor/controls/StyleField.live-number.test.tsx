import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

// Dragging the Gap slider moved the canvas live, but the number beside it only
// updated on mouseup (user report 2026-09-29): the drag patches the canvas
// without writing code, and the input rendered the committed source value.

const ctl = {
  styles: { gap: '10px' } as Record<string, string>,
  updateStyle: vi.fn(),
  updateStyleLive: vi.fn(),
  getValueSource: () => ({ source: 'inline', ref: null }),
  removeVariable: vi.fn(),
  cmsBinding: null,
};
vi.mock('./ControlProvider', () => ({ useControl: () => ctl }));
vi.mock('./ControlLabel', () => ({ default: () => null }));
vi.mock('./LocaleBoundPill', () => ({ default: () => null, useLocaleStyleOverrides: () => [] }));
// Radix's pointer drag doesn't run in jsdom — drive the slider's two callbacks directly.
vi.mock('./ToolSlider', () => ({
  default: (p: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) => (
    <>
      <span data-thumb={p.value} />
      <button data-tick onClick={() => p.onChange(42)} />
      <button data-release onClick={() => p.onCommit(42)} />
    </>
  ),
}));
vi.mock('./ToolInput', () => ({ default: (p: { value: string }) => <input data-num value={p.value} readOnly /> }));

import StyleField from './StyleField';

afterEach(() => { cleanup(); ctl.styles = { gap: '10px' }; vi.clearAllMocks(); });

const num = (c: HTMLElement) => (c.querySelector('[data-num]') as HTMLInputElement).value;

describe('StyleField numeric — the number tracks the slider while dragging', () => {
  it('mirrors every drag tick, commits on release, and follows later external changes', () => {
    const { container, rerender } = render(<StyleField property="gap" label="Gap" />);
    expect(num(container)).toBe('10');

    act(() => { fireEvent.click(container.querySelector('[data-tick]')!); });
    expect(num(container)).toBe('42');                                   // live, before mouseup
    expect(container.querySelector('[data-thumb]')!.getAttribute('data-thumb')).toBe('42');
    expect(ctl.updateStyleLive).toHaveBeenCalledWith('gap', '42px');
    expect(ctl.updateStyle).not.toHaveBeenCalled();                     // no code write mid-drag

    act(() => { fireEvent.click(container.querySelector('[data-release]')!); });
    expect(ctl.updateStyle).toHaveBeenCalledWith('gap', '42px');
    expect(num(container)).toBe('42');                                   // no snap back before the re-parse

    ctl.styles = { gap: '42px' };                                        // commit lands
    rerender(<StyleField property="gap" label="Gap" />);
    expect(num(container)).toBe('42');
    ctl.styles = { gap: '5px' };                                         // later undo / preset
    rerender(<StyleField property="gap" label="Gap" />);
    expect(num(container)).toBe('5');
  });
});
