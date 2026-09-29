import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import React, { useRef, useState } from 'react';
import ToolPopup from './ToolPopup';

// A NESTED popup (the rich editor's Link popup, opened over the Formatted
// Content popup) must not close its parent through the one-popup singleton, and
// Escape must close the topmost popup only.

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

afterEach(() => cleanup());

function Harness({ onParentClose, onChildClose }: { onParentClose: () => void; onChildClose: () => void }) {
  const [parentOpen, setParentOpen] = useState(true);
  const [childOpen, setChildOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <ToolPopup isOpen={parentOpen} onClose={() => { onParentClose(); setParentOpen(false); }} title="Formatted" anchorRef={anchor}>
      <button ref={anchor} data-open-child onClick={() => setChildOpen(true)}>link</button>
      <ToolPopup isOpen={childOpen} onClose={() => { onChildClose(); setChildOpen(false); }} title="Link" anchorRef={anchor} nested>
        <div data-child-body>child</div>
      </ToolPopup>
    </ToolPopup>
  );
}

describe('ToolPopup nested', () => {
  it('opens over its parent without closing it; Escape closes the top one first', () => {
    const onParentClose = vi.fn();
    const onChildClose = vi.fn();
    render(<Harness onParentClose={onParentClose} onChildClose={onChildClose} />);
    act(() => { fireEvent.click(document.querySelector('[data-open-child]')!); });

    expect(document.querySelectorAll('[data-tool-popup]')).toHaveLength(2);
    expect(onParentClose).not.toHaveBeenCalled();
    const [parent, child] = [...document.querySelectorAll<HTMLElement>('[data-tool-popup]')];
    expect(child.querySelector('[data-child-body]')).toBeTruthy();
    expect(Number(child.style.zIndex)).toBeGreaterThan(Number(parent.style.zIndex));

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(onChildClose).toHaveBeenCalledTimes(1);
    expect(onParentClose).not.toHaveBeenCalled();

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(onParentClose).toHaveBeenCalledTimes(1);
  });
});
