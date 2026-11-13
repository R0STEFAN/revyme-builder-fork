import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransformControl } from './TransformControl';

const state = vi.hoisted(() => ({
  onChangeLive: vi.fn(),
  onChangeMultiple: vi.fn(),
  context: {
    value: 'translate(30px, 108px)',
    onChange: vi.fn(),
    onChangeLive: vi.fn(),
    onChangeMultiple: vi.fn(),
    node: { id: 'motion-page-node', type: 'section', isMotionElement: true },
    allProps: { x: '18', y: '18', rotate: '1', scaleX: '1', scaleY: '0.4', skewX: '-11', skewY: '-13' },
    mode: 'direct',
  } as any,
}));

vi.mock('jotai', async (importOriginal) => ({
  ...await importOriginal<typeof import('jotai')>(),
  useAtomValue: () => false,
}));
vi.mock('@/code/project/active-file-store', () => ({ activeFilePathAtom: {}, isComponentFilePath: () => false }));
vi.mock('@/code/stores/viewport-store', () => ({ isReplicaViewportAtom: {}, isComponentVariantViewportAtom: {} }));
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn() } }));
vi.mock('@/editor/hooks/useScrubInteracting', () => ({ useScrubInteracting: () => vi.fn() }));
vi.mock('@/code/stores/viewer-mode-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/code/stores/viewer-mode-store')>(),
  useIsViewer: () => false,
}));
vi.mock('@/design-system/PropertyIcons', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/design-system/PropertyIcons')>(),
  TransformIcon: () => null,
}));
vi.mock('@/editor/ui/ToolPopup', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div>{children}</div> : null,
}));
vi.mock('../../../controls/unified', () => ({
  UnifiedControlProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ControlRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useControlContext: () => state.context,
}));
vi.mock('../../../controls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../controls')>();
  return {
    ...actual,
    ControlActionRow: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
    ControlLabel: () => null,
    RemoveButton: () => null,
    ToolSlider: () => <div />,
    ToolSegmentedControl: () => <div />,
  };
});

describe('TransformControl input commits', () => {
  beforeEach(() => {
    state.onChangeLive.mockClear();
    state.onChangeMultiple.mockClear();
    state.context = {
      value: 'translate(30px, 108px)',
      onChange: vi.fn(),
      onChangeLive: state.onChangeLive,
      onChangeMultiple: state.onChangeMultiple,
      node: { id: 'motion-page-node', type: 'section', isMotionElement: true },
      allProps: { x: '18', y: '18', rotate: '1', scaleX: '1', scaleY: '0.4', skewX: '-11', skewY: '-13' },
      mode: 'direct',
    } as any;
  });

  it('previews a manually entered motion transform before committing it', () => {
    render(<TransformControl />);
    fireEvent.click(screen.getByRole('button'));

    const rotateInput = screen.getAllByRole('textbox')[2];
    fireEvent.focus(rotateInput);
    fireEvent.change(rotateInput, { target: { value: '45' } });
    fireEvent.keyDown(rotateInput, { key: 'Enter' });

    expect(state.onChangeLive).toHaveBeenCalledWith(expect.stringContaining('rotate(45deg)'));
    expect(state.onChangeMultiple).toHaveBeenCalledWith({ rotate: '45' });
  });

  it('disables Translate X when x is driven by a MotionValue', () => {
    state.context.allProps = { ...state.context.allProps, x: 'var:projectsSectionX' };
    render(<TransformControl />);
    fireEvent.click(screen.getByRole('button'));

    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).disabled).toBe(true);
    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).disabled).toBe(false);
  });

  it('disables only the translate axis owned by a motion animation', () => {
    state.context.node = {
      ...state.context.node,
      motionProps: { whileInView: { y: '-1443' } },
    };
    render(<TransformControl />);
    fireEvent.click(screen.getByRole('button'));

    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).disabled).toBe(false);
    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).disabled).toBe(true);
  });

  it('disables Rotate when a MotionValue already drives rotate', () => {
    state.context.allProps = { ...state.context.allProps, rotate: 'var:projectsSectionRotate' };
    render(<TransformControl />);
    fireEvent.click(screen.getByRole('button'));

    expect((screen.getAllByRole('textbox')[2] as HTMLInputElement).disabled).toBe(true);
  });
});
