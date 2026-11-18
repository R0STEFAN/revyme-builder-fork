import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewport: 'variant-1',
  clipboard: null as any,
  code: `const wrapperVariants = {
    default: {},
    'variant-1': { transition: { type: 'spring', duration: '0.8' } },
    'variant-2': {},
  };`,
  updateVariant: vi.fn((code: string, _id: string, _variant: string, _transition: Record<string, string>) => code),
}));

vi.mock('jotai', async (importOriginal) => ({
  ...await importOriginal<typeof import('jotai')>(),
  useAtomValue: (atom: string) => ({
    component: true, selected: 'wrapper', code: state.code, file: 'components/Projects.tsx',
    viewport: state.viewport, clipboard: state.clipboard,
  } as Record<string, unknown>)[atom],
  useSetAtom: (atom: string) => atom === 'clipboard'
    ? (value: unknown) => { state.clipboard = value; }
    : vi.fn(),
}));
vi.mock('@/code/stores/store', () => ({ isComponentFileAtom: 'component', selectedNodeAtom: 'selected', codeAtom: 'code' }));
vi.mock('@/code/stores/node-family', () => ({ useNode: () => ({
  parentId: 'root', motionVariantsRef: 'wrapperVariants',
  motionProps: { transition: { ease: 'easeInOut', duration: '0.8' } },
}) }));
vi.mock('@/code/project/active-file-store', () => ({ activeFilePathAtom: 'file', isLayoutFile: () => false }));
vi.mock('@/code/stores/viewport-store', () => ({ interactingViewportIdAtom: 'viewport' }));
vi.mock('@/code/project/project-fs', () => ({ projectVersionAtom: 'version', projectFS: { readFile: () => state.code } }));
vi.mock('@/code/project/modify-file', () => ({ modifyProjectFile: (_path: string, edit: (code: string) => string) => {
  state.code = edit(state.code);
} }));
vi.mock('@/code/generation/generator-motion', () => ({
  updateMotionPropInCode: vi.fn(), removeMotionPropFromCode: vi.fn(), updateMotionConfigTransition: vi.fn(),
  updateVariantEntryTransition: (code: string, id: string, variant: string, transition: Record<string, string>) =>
    state.updateVariant(code, id, variant, transition),
  syncRootVariantTransition: vi.fn(), readTransitionVarRef: () => null,
  revertVariantTransition: vi.fn(), setMotionConfigBaseVar: vi.fn(),
}));
vi.mock('@/code/generation/component-var-detach-gen', () => ({ readTransitionOrphanVar: () => null }));
vi.mock('@/code/mutation/mutation-queue', () => ({ queueMutation: vi.fn() }));
vi.mock('@/canvas/node-ops', () => ({ isPrimaryViewport: (id: string) => id === 'default' }));
vi.mock('../../../ui/ToolPopup', () => ({ default: () => null }));
vi.mock('../../../controls', () => ({
  ControlLabel: ({ extraMenuItems }: { extraMenuItems: Array<{ label: string; show: boolean; onClick: () => void }> }) =>
    <div>{extraMenuItems?.filter(item => item.show).map(item =>
      <button key={item.label} onClick={item.onClick}>{item.label}</button>)}</div>,
  ControlActionRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../controls/VariableBoundPill', () => ({ LegacyVariableBoundPill: () => null }));
vi.mock('../../../controls/ControlProvider', () => ({ useControlOptional: () => null }));
vi.mock('../../AnimationTool/CurvePreview', () => ({ summarizeTransition: () => 'Spring', TransitionCurveIcon: () => null }));
vi.mock('../../AnimationTool/TransitionPanel', () => ({ default: () => null }));
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn() } }));
vi.mock('@/editor/controls/style-clipboard', () => ({ copiedStyleAtom: 'clipboard' }));

import VariantTransitionControl from './VariantTransitionControl';

beforeEach(() => {
  state.viewport = 'variant-1';
  state.clipboard = null;
  state.code = `const wrapperVariants = {
    default: {},
    'variant-1': { transition: { type: 'spring', duration: '0.8' } },
    'variant-2': {},
  };`;
  state.updateVariant.mockClear();
});

it('pastes the copied motion transition into another component variant', () => {
  const view = render(<VariantTransitionControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy Style' }));
  expect(state.clipboard.transitionConfig).toEqual({ type: 'spring', duration: '0.8' });

  state.viewport = 'variant-2';
  view.rerender(<VariantTransitionControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Paste Style' }));
  expect(state.updateVariant).toHaveBeenCalledWith(
    state.code, 'wrapper', 'variant-2', { type: 'spring', duration: '0.8' },
  );
});

it('copies a child element transition from the default variant into a later variant', () => {
  state.viewport = 'default';
  const view = render(<VariantTransitionControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy Style' }));
  expect(state.clipboard.transitionConfig).toEqual({ ease: 'easeInOut', duration: '0.8' });

  state.viewport = 'variant-2';
  view.rerender(<VariantTransitionControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Paste Style' }));
  expect(state.updateVariant).toHaveBeenCalledWith(
    state.code, 'wrapper', 'variant-2', { ease: 'easeInOut', duration: '0.8' },
  );
});

it('copies an inherited transition even when a later variant has its own', () => {
  state.code = `const wrapperVariants = {
    default: {},
    'variant-1': { x: '-20%' },
    'variant-2': { x: '-40%', transition: { duration: '2' } },
  };`;
  const view = render(<VariantTransitionControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy Style' }));
  expect(state.clipboard.transitionConfig).toEqual({ ease: 'easeInOut', duration: '0.8' });

  state.viewport = 'variant-2';
  view.rerender(<VariantTransitionControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Paste Style' }));
  expect(state.updateVariant).toHaveBeenCalledWith(
    state.code, 'wrapper', 'variant-2', { ease: 'easeInOut', duration: '0.8' },
  );
});
