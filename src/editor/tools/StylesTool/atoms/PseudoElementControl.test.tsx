import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';

const state = vi.hoisted(() => ({
  node: {
    id: 'btn-1',
    type: 'button',
    name: 'CTA',
    styles: { color: '#111111' },
    attrs: {},
    parentId: 'root',
    children: [],
  } as any,
  pseudoMap: new Map<string, Record<string, Record<string, string>>>(),
  queueMutation: vi.fn(),
  injectCanvasCSS: vi.fn(),
  removeCanvasCSS: vi.fn(),
}));

vi.mock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: (atom: string) => {
    if (atom === 'pseudoStylesAtom') return state.pseudoMap;
    if (atom === 'keyframeNamesAtom') return [];
    return undefined;
  },
}));

vi.mock('@/code/stores/pseudo-store', () => ({ pseudoStylesAtom: 'pseudoStylesAtom' }));
vi.mock('@/code/stores/animation-store', () => ({ keyframeNamesAtom: 'keyframeNamesAtom' }));
vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: (...args: any[]) => state.queueMutation(...args),
}));
vi.mock('@/canvas/node-ops', () => ({
  injectCanvasCSS: (...args: any[]) => state.injectCanvasCSS(...args),
  removeCanvasCSS: (...args: any[]) => state.removeCanvasCSS(...args),
}));
vi.mock('@/canvas/hooks/useStableAtomSync', () => ({
  expediteStableAtomSync: vi.fn(),
}));
vi.mock('../../../controls/ControlProvider', () => ({
  useControl: () => ({ node: state.node }),
}));
vi.mock('../../../controls/multi-select-targets', () => ({
  forSelectionTargets: (nodeId: string, fn: (id: string) => void) => fn(nodeId),
  selectionTargetIds: (nodeId: string) => [nodeId],
}));
vi.mock('./OpacityControl', () => ({ OpacityControl: () => <div>OpacityControl</div> }));
vi.mock('./RadiusControl', () => ({ RadiusControl: () => <div>RadiusControl</div> }));
vi.mock('./ClipPathControl', () => ({ ClipPathControl: () => <div>ClipPathControl</div> }));
vi.mock('./FillControl', () => ({ FillControl: () => <div>FillControl</div> }));
vi.mock('./FilterControl', () => ({ FilterControl: () => <div>FilterControl</div> }));
vi.mock('./ShadowControl', () => ({ ShadowControl: () => <div>ShadowControl</div> }));
vi.mock('./BorderControl', () => ({ BorderControl: () => <div>BorderControl</div> }));
vi.mock('./MaskControl', () => ({ MaskControl: () => <div>MaskControl</div> }));
vi.mock('./TransformControl', () => ({ TransformControl: () => <div>TransformControl</div> }));
vi.mock('../../TextStyleTool/atoms/ShadowControl', () => ({ ShadowControl: () => <div>TextShadowControl</div> }));

import { PseudoElementControl } from './PseudoElementControl';

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

describe('PseudoElementControl — visual CSS states & pseudo-elements', () => {
  beforeEach(() => {
    state.node = {
      id: 'btn-1',
      type: 'button',
      name: 'CTA',
      styles: { color: '#111111' },
      attrs: {},
      parentId: 'root',
      children: [],
    };
    state.pseudoMap = new Map();
    state.queueMutation.mockClear();
    state.injectCanvasCSS.mockClear();
    state.removeCanvasCSS.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('adds :hover state via quick-add and dispatches updatePseudoStyle for hover', () => {
    render(<PseudoElementControl openSignal={1} />);

    const addHoverBtn = screen.getByRole('button', { name: /\+?\s*:hover/i });
    fireEvent.click(addHoverBtn);

    expect(state.queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updatePseudoStyle',
        nodeId: 'btn-1',
        pseudo: 'hover',
      })
    );
  });

  it('validates custom states: accepts :nth-child(odd) and rejects .other > div without mutating', () => {
    render(<PseudoElementControl openSignal={1} />);

    const input = screen.getByPlaceholderText(/nth-child|aria-expanded|custom/i);
    const addBtn = screen.getByRole('button', { name: /add state/i });

    // Invalid unsafe descendant selector
    fireEvent.change(input, { target: { value: '.other > div' } });
    fireEvent.click(addBtn);

    expect(state.queueMutation).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();

    // Valid node-scoped pseudo selector
    fireEvent.change(input, { target: { value: ':nth-child(odd)' } });
    fireEvent.click(addBtn);

    expect(state.queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updatePseudoStyle',
        nodeId: 'btn-1',
        pseudo: 'custom::nth-child(odd)',
      })
    );
  });

  it('opens :hover editor with Transition row, Preview on canvas toggle, and cleans up preview CSS on toggle off / unmount', () => {
    state.pseudoMap = new Map([
      [
        'btn-1',
        {
          hover: {
            backgroundColor: '#111111',
            transition: 'all 0.25s ease',
          },
        },
      ],
    ]);

    const { unmount } = render(<PseudoElementControl openSignal={1} />);

    // Open the :hover editor via its entry row action button inside the popup
    const hoverOpenBtn = screen.getByRole('button', { name: /2 styles/i });
    fireEvent.click(hoverOpenBtn);

    // Transition row summary visible inside PseudoEditor
    expect(screen.getByText(/all 0\.25s ease/i)).toBeTruthy();

    // Preview on canvas is ON by default for interactive states -> injects doubled-id preview selector
    expect(state.injectCanvasCSS).toHaveBeenCalledWith(
      '[data-id="btn-1"][data-id="btn-1"]',
      expect.stringContaining('background-color: #111111')
    );

    // Toggle Preview on canvas OFF -> removes the doubled-id preview selector
    const previewToggle = screen.getByRole('button', { name: /preview on canvas/i });
    fireEvent.click(previewToggle);
    expect(state.removeCanvasCSS).toHaveBeenCalledWith('[data-id="btn-1"][data-id="btn-1"]');

    // Unmount cleans up real pseudo preview too
    unmount();
    expect(state.removeCanvasCSS).toHaveBeenCalledWith('[data-id="btn-1"]:hover');
  });

  it('deduplicates :focus and :checked on editable form controls (owned by FormStateControl)', () => {
    state.node = {
      id: 'chk-1',
      type: 'input',
      name: 'Agree',
      styles: {},
      attrs: { type: 'checkbox' },
      parentId: 'root',
      children: [],
    };
    state.pseudoMap = new Map([
      [
        'chk-1',
        {
          hover: { opacity: '0.9' },
          focus: { outline: '2px solid #000' },
          checked: { backgroundColor: '#111' },
        },
      ],
    ]);

    render(<PseudoElementControl openSignal={1} />);

    expect(screen.getAllByText(':hover').length).toBeGreaterThan(0);
    expect(screen.queryByText(':focus')).toBeNull();
    expect(screen.queryByText(':checked')).toBeNull();
    expect(screen.queryByRole('button', { name: /^\+?\s*:focus$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^\+?\s*:checked$/i })).toBeNull();
  });

  it('always shows a Transition row inside interactive state editors (even before transition is added)', () => {
    state.pseudoMap = new Map([
      [
        'btn-1',
        {
          hover: {
            backgroundColor: '#111111',
          },
        },
      ],
    ]);

    render(<PseudoElementControl openSignal={1} />);

    // Open :hover editor (currently has only 1 style, no transition yet)
    const hoverOpenBtn = screen.getByRole('button', { name: /1 style/i });
    fireEvent.click(hoverOpenBtn);

    // Transition row is immediately visible with an Add action button
    expect(screen.getByText('Transition')).toBeTruthy();
    const addTransitionBtn = screen.getByRole('button', { name: /^Add$/i });
    fireEvent.click(addTransitionBtn);

    // Clicking Add seeds a default transition in CSS preview and pushes the Transition panel
    expect(state.injectCanvasCSS).toHaveBeenCalledWith(
      '[data-id="btn-1"]:hover',
      expect.stringContaining('transition: all 0.3s')
    );
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getByText('Easing')).toBeTruthy();
  });
});
