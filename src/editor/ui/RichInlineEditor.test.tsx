import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import RichInlineEditor from './RichInlineEditor';

// jsdom has no ResizeObserver — the Link popup (ToolPopup) measures its height with one.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

// The Edit Content popup's formatting never reached the canvas or the preview
// (2026-09-29): the panel echoed each edit back through `html` (optimistic
// state), the editor took the echo for an EXTERNAL change, reloaded itself and
// forgot it had been edited — so closing the popup committed nothing.

type EditorEl = HTMLElement & { editor: { commands: { selectAll: () => boolean; toggleBold: () => boolean; toggleItalic: () => boolean } } };
const editorOf = (container: HTMLElement) => container.querySelector('[data-test-field]') as EditorEl;

/** A parent that echoes every edit straight back into `html`, like ComponentPropsTool does. */
function EchoingParent({ initial, onCommit, delay }: { initial: string; onCommit: (h: string) => void; delay?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <RichInlineEditor
      label="t"
      html={value}
      fieldAttributes={{ 'data-test-field': '' }}
      commitDelayMs={delay}
      onInput={setValue}
      onCommit={(h) => { setValue(h); onCommit(h); }}
    />
  );
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RichInlineEditor', () => {
  it('an echoed edit is not a reload: formatting still commits when the popup closes', () => {
    const onCommit = vi.fn();
    const { container, unmount } = render(<EchoingParent initial="hello world" onCommit={onCommit} />);
    const el = editorOf(container);
    act(() => { el.editor.commands.selectAll(); el.editor.commands.toggleItalic(); });
    expect(el.innerHTML).toContain('<em>');           // not reloaded back to plain text
    unmount();                                         // Escape / outside click — no blur
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBe('<em>hello world</em>');
  });

  it('commitDelayMs writes while typing, without waiting for close', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { container } = render(<EchoingParent initial="hello" onCommit={onCommit} delay={250} />);
    const el = editorOf(container);
    act(() => { el.editor.commands.selectAll(); el.editor.commands.toggleBold(); });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(260); });
    expect(onCommit).toHaveBeenCalledWith('<strong>hello</strong>');
  });

  it('an untouched field commits nothing (no normalisation rewrite)', () => {
    const onCommit = vi.fn();
    const { unmount } = render(<EchoingParent initial="<b>x</b>" onCommit={onCommit} />);
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a genuinely external value reloads the editor', () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(<RichInlineEditor label="t" html="one" fieldAttributes={{ 'data-test-field': '' }} onCommit={onCommit} />);
    rerender(<RichInlineEditor label="t" html="<strong>two</strong>" fieldAttributes={{ 'data-test-field': '' }} onCommit={onCommit} />);
    expect(editorOf(container).innerHTML).toContain('<strong>two</strong>');
  });

  it('the link button opens a separate Link popup (no prompt) and links the selection', () => {
    const prompt = vi.spyOn(window, 'prompt');
    const onCommit = vi.fn();
    const { container } = render(<EchoingParent initial="see this" onCommit={onCommit} />);
    const el = editorOf(container);
    act(() => { el.editor.commands.selectAll(); });
    act(() => { fireEvent.click(container.querySelector('[data-rich-link-toggle]')!); });
    expect(prompt).not.toHaveBeenCalled();
    // Its own popup, portaled next to the editor — not inside it.
    expect(container.querySelector('[data-rich-link-panel]')).toBeNull();
    const popup = document.querySelector('[data-tool-popup] [data-rich-link-panel]')!.closest('[data-tool-popup]')!;
    expect(popup.textContent).toContain('Link');
    const input = popup.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'https://x.com' } });
      fireEvent.blur(input);
    });
    expect(onCommit).toHaveBeenLastCalledWith('<a href="https://x.com">see this</a>');
    // New Tab → target + the sanitizer's rel.
    act(() => { el.editor.commands.selectAll(); });
    const yes = [...popup.querySelectorAll('[data-rich-link-panel] button')].find((b) => b.textContent === 'Yes')!;
    act(() => { fireEvent.click(yes); });
    expect(onCommit).toHaveBeenLastCalledWith('<a target="_blank" href="https://x.com" rel="noopener noreferrer">see this</a>');
  });
});
