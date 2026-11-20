import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { extractNonShadowFilter } from '../../../ui/shadow-utils';

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
vi.mock('./RadiusControl', () => ({
  RadiusControl: (props: any) => (
    <div>
      <span>RadiusControl</span>
      <button
        type="button"
        onClick={() =>
          props.onStopChange?.({
            ...props.stopProps,
            borderRadius: '',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            borderBottomRightRadius: '4px',
            borderBottomLeftRadius: '4px',
          })
        }
      >
        Split Radius (mock)
      </button>
    </div>
  ),
}));
vi.mock('./ClipPathControl', () => ({
  ClipPathControl: (props: any) => (
    <div>
      <span>ClipPathControl</span>
      <button type="button" onClick={() => props.onStopChange?.({ ...props.stopProps, clipPath: '' })}>
        Clear Clip Path (mock)
      </button>
    </div>
  ),
}));
vi.mock('./FillControl', () => ({
  FillControl: (props: any) => (
    <div>
      <span>FillControl</span>
      <button
        type="button"
        onClick={() =>
          props.onStopChange?.({
            ...props.stopProps,
            backgroundColor: '',
            background: '',
            backgroundImage: '',
            backgroundSize: '',
            backgroundPosition: '',
            backgroundRepeat: '',
            backgroundAttachment: '',
            backgroundBlendMode: '',
          })
        }
      >
        Clear Fill (mock)
      </button>
    </div>
  ),
}));
vi.mock('./FilterControl', () => ({
  FilterControl: (props: any) => (
    <div>
      <span>FilterControl</span>
      <button type="button" onClick={() => props.onStopChange?.({ ...props.stopProps, filter: '' })}>
        Clear Filter (mock)
      </button>
    </div>
  ),
}));
vi.mock('./ShadowControl', () => ({
  ShadowControl: (props: any) => (
    <div>
      <span>ShadowControl</span>
      <button
        type="button"
        onClick={() =>
          props.onStopChange?.({
            ...props.stopProps,
            boxShadow: '',
            filter: extractNonShadowFilter(props.stopProps?.filter || ''),
          })
        }
      >
        Clear Shadow (mock)
      </button>
    </div>
  ),
}));
vi.mock('./BorderControl', () => ({
  BorderControl: (props: any) => (
    <div>
      <span>BorderControl</span>
      <button
        type="button"
        onClick={() =>
          props.onStopChange?.({
            ...props.stopProps,
            border: '',
            borderWidth: '',
            borderStyle: '',
            borderColor: '',
          })
        }
      >
        Clear Border (mock)
      </button>
    </div>
  ),
}));
vi.mock('./MaskControl', () => ({
  MaskControl: (props: any) => (
    <div>
      <span>MaskControl</span>
      <button
        type="button"
        onClick={() =>
          props.onStopChange?.({
            ...props.stopProps,
            maskImage: '',
            WebkitMaskImage: '',
            mask: '',
            WebkitMask: '',
            maskComposite: '',
            WebkitMaskComposite: '',
          })
        }
      >
        Clear Mask (mock)
      </button>
    </div>
  ),
}));
vi.mock('./TransformControl', () => ({
  TransformControl: (props: any) => (
    <div>
      <span>TransformControl</span>
      <button
        type="button"
        onClick={() => props.onStopChange?.({ ...props.stopProps, transform: '', transformStyle: '' })}
      >
        Clear Transform (mock)
      </button>
    </div>
  ),
}));
vi.mock('../../TextStyleTool/atoms/ShadowControl', () => ({
  ShadowControl: (props: any) => (
    <div>
      <span>TextShadowControl</span>
      <button type="button" onClick={() => props.onChange?.('none')}>
        Clear Text Shadow (mock)
      </button>
    </div>
  ),
}));

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
    expect(screen.getByText('Delay')).toBeTruthy();

    // Both Duration and Delay expose 's' chevron labels and numeric up/down chevron buttons
    expect(screen.getAllByText('s').length).toBeGreaterThanOrEqual(2);
    const chevronButtons = document.querySelectorAll('button.group\\/chevron');
    expect(chevronButtons.length).toBe(4);

    // Stepping Duration up via its up chevron updates CSS transition (0.3s -> 0.35s)
    state.injectCanvasCSS.mockClear();
    fireEvent.mouseDown(chevronButtons[0], { clientY: 100 });
    fireEvent.mouseUp(document);
    expect(state.injectCanvasCSS).toHaveBeenCalledWith(
      '[data-id="btn-1"]:hover',
      expect.stringContaining('transition: all 0.35s')
    );

    // Stepping Delay up via its up chevron updates CSS transition (delay 0s -> 0.05s)
    state.injectCanvasCSS.mockClear();
    fireEvent.mouseDown(chevronButtons[2], { clientY: 100 });
    fireEvent.mouseUp(document);
    expect(state.injectCanvasCSS).toHaveBeenCalledWith(
      '[data-id="btn-1"]:hover',
      expect.stringContaining('0.05s')
    );
  });

  it('removes Border Radius (both uniform and split 4-corner overrides) and restores it to + Add Property', () => {
    vi.useFakeTimers();
    state.pseudoMap = new Map([
      ['btn-1', { hover: { backgroundColor: '#111111' } }],
    ]);

    render(<PseudoElementControl openSignal={1} />);
    fireEvent.click(screen.getByRole('button', { name: /1 style/i }));

    // Add Border Radius via + Add Property
    fireEvent.click(screen.getByRole('button', { name: /\+ add property/i }));
    fireEvent.click(screen.getByRole('button', { name: /border radius/i }));

    expect(screen.getByText('RadiusControl')).toBeTruthy();

    // Split into 4 individual corner longhands (clears borderRadius shorthand to '')
    fireEvent.click(screen.getByRole('button', { name: /split radius \(mock\)/i }));
    expect(screen.getByText('RadiusControl')).toBeTruthy();

    // Remove Border Radius via outer Remove button
    const removeRadiusBtn = screen.getByTitle('Remove Border Radius');
    fireEvent.click(removeRadiusBtn);

    expect(screen.queryByText('RadiusControl')).toBeNull();
    act(() => { vi.advanceTimersByTime(450); });
    expect(state.queueMutation).toHaveBeenCalledWith({
      type: 'updatePseudoStyle',
      nodeId: 'btn-1',
      pseudo: 'hover',
      styles: { backgroundColor: '#111111' },
    });

    // Verify Border Radius is available again under + Add Property
    fireEvent.click(screen.getByRole('button', { name: /\+ add property/i }));
    expect(screen.getByRole('button', { name: /border radius/i })).toBeTruthy();
  });

  it('removes Opacity via Remove Opacity button and clears preview CSS when empty', () => {
    vi.useFakeTimers();
    state.pseudoMap = new Map([
      ['btn-1', { hover: { opacity: '0.85' } }],
    ]);

    render(<PseudoElementControl openSignal={1} />);
    fireEvent.click(screen.getByRole('button', { name: /1 style/i }));

    expect(screen.getByText('OpacityControl')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Remove Opacity'));

    expect(screen.queryByText('OpacityControl')).toBeNull();
    expect(state.removeCanvasCSS).toHaveBeenCalledWith('[data-id="btn-1"]:hover');
    act(() => { vi.advanceTimersByTime(450); });
    expect(state.queueMutation).toHaveBeenCalledWith({
      type: 'updatePseudoStyle',
      nodeId: 'btn-1',
      pseudo: 'hover',
      styles: {},
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ add property/i }));
    expect(screen.getByRole('button', { name: /opacity/i })).toBeTruthy();
  });

  it('removes freshly added neutral/empty atoms via outer Remove button and returns them to + Add Property', () => {
    state.pseudoMap = new Map([
      ['btn-1', { hover: { opacity: '0.85' } }],
    ]);

    render(<PseudoElementControl openSignal={1} />);
    fireEvent.click(screen.getByRole('button', { name: /1 style/i }));

    const neutralProperties = [
      { menu: /^Background$/i, text: 'FillControl', title: 'Remove Background' },
      { menu: /^Border$/i, text: 'BorderControl', title: 'Remove Border' },
      { menu: /^Shadow$/i, text: 'ShadowControl', title: 'Remove Shadow' },
      { menu: /^Filter$/i, text: 'FilterControl', title: 'Remove Filter' },
      { menu: /^Clip Path$/i, text: 'ClipPathControl', title: 'Remove Clip Path' },
      { menu: /^Mask$/i, text: 'MaskControl', title: 'Remove Mask' },
      { menu: /^Transform$/i, text: 'TransformControl', title: 'Remove Transform' },
      { menu: /Text Shadow$/i, text: 'TextShadowControl', title: 'Remove Text Shadow' },
    ];

    for (const item of neutralProperties) {
      fireEvent.click(screen.getByRole('button', { name: /\+ add property/i }));
      fireEvent.click(screen.getByRole('button', { name: item.menu }));
      expect(screen.getByText(item.text)).toBeTruthy();

      const removeBtn = screen.getByTitle(item.title);
      fireEvent.click(removeBtn);
      expect(screen.queryByText(item.text)).toBeNull();
    }
  });

  it('strips empty keys when active built-in atoms clear themselves and avoids duplicate outer Remove button', () => {
    state.pseudoMap = new Map([
      [
        'btn-1',
        {
          hover: {
            backgroundColor: '#ffffff',
            border: '1px solid #000000',
            boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.2)',
            filter: 'blur(4px)',
            clipPath: 'circle(50% at 50% 50%)',
            maskImage: 'linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 100%)',
            transform: 'translateY(-4px)',
            textShadow: '0px 2px 4px rgba(0, 0, 0, 0.4)',
          },
        },
      ],
    ]);

    render(<PseudoElementControl openSignal={1} />);
    fireEvent.click(screen.getByRole('button', { name: /8 styles/i }));

    // None of these active atoms should render a duplicate outer Remove button
    for (const label of ['Background', 'Border', 'Shadow', 'Filter', 'Clip Path', 'Mask', 'Transform', 'Text Shadow']) {
      expect(screen.queryByTitle(`Remove ${label}`)).toBeNull();
    }

    const activeClearCases = [
      { btn: 'Clear Fill (mock)', text: 'FillControl', menu: /^Background$/i },
      { btn: 'Clear Border (mock)', text: 'BorderControl', menu: /^Border$/i },
      { btn: 'Clear Shadow (mock)', text: 'ShadowControl', menu: /^Shadow$/i },
      { btn: 'Clear Filter (mock)', text: 'FilterControl', menu: /^Filter$/i },
      { btn: 'Clear Clip Path (mock)', text: 'ClipPathControl', menu: /^Clip Path$/i },
      { btn: 'Clear Mask (mock)', text: 'MaskControl', menu: /^Mask$/i },
      { btn: 'Clear Transform (mock)', text: 'TransformControl', menu: /^Transform$/i },
      { btn: 'Clear Text Shadow (mock)', text: 'TextShadowControl', menu: /Text Shadow$/i },
    ];

    for (const c of activeClearCases) {
      fireEvent.click(screen.getByRole('button', { name: c.btn }));
      expect(screen.queryByText(c.text)).toBeNull();
    }

    fireEvent.click(screen.getByRole('button', { name: /\+ add property/i }));
    for (const c of activeClearCases) {
      expect(screen.getByRole('button', { name: c.menu })).toBeTruthy();
    }
  });

  it('handles drop-shadow in filter without spawning a phantom Filter row', () => {
    state.pseudoMap = new Map([
      [
        'btn-1',
        {
          hover: {
            filter: 'drop-shadow(0px 4px 8px rgba(0, 0, 0, 0.25))',
          },
        },
      ],
    ]);

    render(<PseudoElementControl openSignal={1} />);
    fireEvent.click(screen.getByRole('button', { name: /1 style/i }));

    expect(screen.getByText('ShadowControl')).toBeTruthy();
    expect(screen.queryByText('FilterControl')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Shadow (mock)' }));
    expect(screen.queryByText('ShadowControl')).toBeNull();
    expect(screen.queryByText('FilterControl')).toBeNull();
  });

  it('keeps zIndex unitless on slider updates and removes it via Remove Z-Index', () => {
    state.pseudoMap = new Map([
      ['btn-1', { hover: { opacity: '0.9' } }],
    ]);

    render(<PseudoElementControl openSignal={1} />);
    fireEvent.click(screen.getByRole('button', { name: /1 style/i }));

    fireEvent.click(screen.getByRole('button', { name: /\+ add property/i }));
    fireEvent.click(screen.getByRole('button', { name: /z-index/i }));

    const slider = screen.getByRole('slider');
    state.injectCanvasCSS.mockClear();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(state.injectCanvasCSS).toHaveBeenCalledWith(
      '[data-id="btn-1"]:hover',
      expect.stringContaining('z-index: 2 !important')
    );
    expect(state.injectCanvasCSS).not.toHaveBeenCalledWith(
      '[data-id="btn-1"]:hover',
      expect.stringContaining('2px')
    );

    fireEvent.click(screen.getByTitle('Remove Z-Index'));
    expect(screen.queryByTitle('Remove Z-Index')).toBeNull();
  });
});
