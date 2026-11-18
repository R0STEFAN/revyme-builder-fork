import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GroupFillControl } from './GroupFillControl';

const state = vi.hoisted(() => ({
  variant: 'default-hover',
  variantViewport: true,
  mutations: vi.fn(),
  patch: vi.fn(),
  nodes: new Map<string, any>(),
}));

vi.mock('jotai', async (importOriginal) => ({
  ...await importOriginal<typeof import('jotai')>(),
  useAtomValue: (atom: unknown) => atom === 'variant-viewport' ? state.variantViewport : state.variant,
}));
vi.mock('@/code/stores/viewport-store', () => ({
  isComponentVariantViewportAtom: 'variant-viewport',
  activeComponentVariantAtom: 'active-variant',
}));
vi.mock('../../../controls/ControlProvider', () => ({
  useControl: () => ({ node: state.nodes.get('group'), vpId: state.variantViewport ? 'default-hover' : 'desktop' }),
}));
vi.mock('@/code/stores/node-family', () => ({ useNodesComputed: (get: (nodes: Map<string, any>) => unknown) => get(state.nodes) }));
vi.mock('@/code/mutation/mutation-queue', () => ({ queueMutation: state.mutations }));
vi.mock('@/canvas/canvas-bridge', () => ({ getCanvasBridge: () => ({ setChildShapeAttribute: state.patch }) }));
vi.mock('../../../controls', () => ({
  ControlLabel: () => null,
  ColorInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <button onClick={() => onChange('#000000')}>{value}</button>,
}));

describe('SVG group fill in component variants', () => {
  beforeEach(() => {
    state.variant = 'default-hover';
    state.variantViewport = true;
    state.mutations.mockClear();
    state.patch.mockClear();
    state.nodes = new Map([
      ['group', { id: 'group', type: 'svg', children: ['svg-1'] }],
      ['svg-1', { id: 'svg-1', type: 'svg', children: ['path-1'] }],
      ['path-1', { id: 'path-1', type: 'path', children: [], attrs: { fill: '#ffffff' }, motionVariants: null }],
    ]);
  });

  it('writes the hover fill to the path variant and reads it back', () => {
    const view = render(<GroupFillControl />);
    fireEvent.click(screen.getByRole('button'));
    expect(state.mutations).toHaveBeenCalledWith({
      type: 'updateVariantStyle', nodeId: 'path-1', variantName: 'default-hover', styles: { fill: '#000000' },
    });
    expect(state.mutations).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'updateSvgAttrs' }));

    state.nodes.set('path-1', { ...state.nodes.get('path-1'), motionVariants: { default: { fill: '#ffffff' }, 'default-hover': { fill: '#000000' } } });
    view.rerender(<GroupFillControl />);
    expect(screen.getByRole('button').textContent).toBe('#000000');
  });

  it('keeps the plain SVG attribute write on the default tile', () => {
    state.variant = 'default';
    state.variantViewport = false;
    render(<GroupFillControl />);
    fireEvent.click(screen.getByRole('button'));
    expect(state.mutations).toHaveBeenCalledWith({
      type: 'updateSvgAttrs', nodeId: 'svg-1', attrs: { fill: '#000000' }, childIndex: 0,
    });
  });

  it('updates the default motion fill after a hover fill has been created', () => {
    state.variant = 'default';
    state.variantViewport = false;
    state.nodes.set('path-1', {
      ...state.nodes.get('path-1'),
      motionVariants: { default: { fill: '#ffffff' }, 'default-hover': { fill: '#000000' } },
    });
    render(<GroupFillControl />);
    fireEvent.click(screen.getByRole('button'));
    expect(state.mutations).toHaveBeenCalledWith({
      type: 'updateVariantStyle', nodeId: 'path-1', variantName: 'default', styles: { fill: '#000000' },
    });
  });
});
