import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import React, { useRef } from 'react';
import ToolPopup from '../../../ui/ToolPopup';
import { TextStrokeRow } from './StrokeControl';

// In the typography preset editor (itself a ToolPopup) clicking Stroke CLOSED the editor: the row
// opened a second ToolPopup and the one-popup-at-a-time rule shut the first. Like Decoration /
// Shadow, it now slides its editor in as a panel of the popup it lives in.

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
afterEach(() => cleanup());

const row = (onSet = vi.fn()) => (
  <TextStrokeRow width={0} unit="em" color="#000000" onSet={onSet} onSetLive={vi.fn()} />
);

function InPopup({ onClose }: { onClose: () => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} />
      <ToolPopup isOpen onClose={onClose} title="Body" anchorRef={anchor}>{row()}</ToolPopup>
    </>
  );
}

const clickAdd = () => {
  const add = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Add')!;
  act(() => { fireEvent.click(add); });
};

describe('TextStrokeRow', () => {
  it('inside a popup: the editor slides in — the popup stays open', () => {
    const onClose = vi.fn();
    render(<InPopup onClose={onClose} />);
    clickAdd();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-tool-popup]')).toHaveLength(1);
    const popup = document.querySelector('[data-tool-popup]')!;
    expect(popup.textContent).toContain('Text Stroke');
    expect(popup.querySelector('[data-text-stroke-panel]')).toBeTruthy();
  });

  it('on its own (Text panel): opens its own popup', () => {
    render(row());
    expect(document.querySelector('[data-tool-popup]')).toBeNull();
    clickAdd();
    expect(document.querySelector('[data-tool-popup] [data-text-stroke-panel]')).toBeTruthy();
  });
});
