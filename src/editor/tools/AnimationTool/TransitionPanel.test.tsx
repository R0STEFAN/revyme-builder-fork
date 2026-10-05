import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import TransitionPanel from './TransitionPanel';
import { easeToString } from './CurvePreview';

afterEach(() => cleanup());
// jsdom has no ResizeObserver; the segmented control measures its tabs with one.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

// A cubic-bezier is legitimately a NUMBER ARRAY: framer-motion takes
// `ease: [0.22, 1, 0.36, 1]`, the Framer importer writes it, and the runtime
// accepts it. The panel standardised on the bracket string, so an imported
// bezier hit `t.ease.replace(...)` and threw — taking the whole properties
// panel down through its error boundary, which read to the user as "the
// Transition popup closes the instant I click it" (live find 2026-10-05).
describe('TransitionPanel with an imported cubic-bezier', () => {
  const ARRAY_EASE = { type: 'tween', duration: '1.1', ease: [0.22, 1, 0.36, 1] } as unknown as Record<string, string>;

  it('renders instead of throwing', () => {
    expect(() => render(<TransitionPanel initialTransition={ARRAY_EASE} onWrite={vi.fn()} />)).not.toThrow();
  });

  it('shows the bezier numbers and reads as a Custom ease', () => {
    const { container, getByText } = render(<TransitionPanel initialTransition={ARRAY_EASE} onWrite={vi.fn()} />);
    expect(getByText('0.22, 1, 0.36, 1')).toBeTruthy();
    const select = [...container.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'custom'));
    expect(select?.value).toBe('custom');
  });

  it('still renders a named ease the ordinary way', () => {
    const { container } = render(
      <TransitionPanel initialTransition={{ type: 'tween', duration: '0.3', ease: 'easeOut' }} onWrite={vi.fn()} />,
    );
    const select = [...container.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'custom'));
    expect(select?.value).toBe('easeOut');
  });

  it('survives a malformed ease without throwing', () => {
    // Nothing validates `data-text-anim` on read, so the panel must not be
    // the thing that falls over on odd data.
    for (const ease of [null, 42, {}, []] as unknown[]) {
      expect(() => render(
        <TransitionPanel initialTransition={{ type: 'tween', ease } as unknown as Record<string, string>} onWrite={vi.fn()} />,
      )).not.toThrow();
      cleanup();
    }
  });
});

describe('easeToString', () => {
  it('serializes an array to the bracket form the controls parse', () => {
    expect(easeToString([0.22, 1, 0.36, 1])).toBe('[0.22, 1, 0.36, 1]');
  });

  it('passes a named ease through and drops anything else', () => {
    expect(easeToString('easeOut')).toBe('easeOut');
    expect(easeToString(undefined)).toBe('');
    expect(easeToString(42)).toBe('');
  });
});
