import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { atom, getDefaultStore, type WritableAtom } from 'jotai';
import type { PresetToken } from '@/shared/types';
import { selectedIdsAtom, isComponentFileAtom } from '@/code/stores/store';
import { presetTokensAtom } from '@/code/stores/preset-store';
import { syncViewportWidths } from '@/code/stores/viewport-store';
import { queueMutation } from '@/code/mutation/mutation-queue';
import ControlLabel from './ControlLabel';

const controlLabelTestMocks = vi.hoisted(() => ({ menuContext: null as any }));

const mockControl = {
  nodeId: 'test-node',
  node: {
    id: 'test-node',
    type: 'div',
    name: 'Test',
    parentId: null,
    children: [],
    styles: {} as Record<string, string>,
    conditionalStyles: null,
    attrs: {},
    textContent: '',
    hasMixedContent: false,
    order: 0,
    isCanvasNode: false,
    componentFile: null,
  } as any,
  styles: {} as Record<string, string>,
  vpId: 'desktop',
  isReplica: false,
  vpWidth: 1440,
  hasOverride: () => false,
  getValueSource: () => ({ source: 'inline' as const, ref: null }),
  createVariable: vi.fn(),
  removeVariable: vi.fn(),
  updateStyle: vi.fn(),
  updateStyleLive: vi.fn(),
  updateMultipleStyles: vi.fn(),
  cmsBinding: null,
};

vi.mock('./ControlProvider', () => ({
  useControl: () => mockControl,
}));

vi.mock('@/code/stores/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/code/stores/store')>();
  return {
    ...actual,
    isComponentFileAtom: atom(false),
    variableModalRequestAtom: atom(null),
    canvasInteractingAtom: atom(false),
    copiedStyleAtom: atom(null),
  };
});

vi.mock('./LocaleBoundPill', () => ({
  useLocaleStyleState: () => ({ hasBandRules: false }),
  localeScopeOf: () => 'page',
}));

vi.mock('@/code/stores/locale-store', () => ({
  activeLocaleAtom: atom('en'),
  isDefaultLocaleAtom: atom(true),
  localeOverridesAtom: atom(new Map()),
  i18nConfigAtom: atom({ locales: ['en'] }),
}));

vi.mock('@/code/project/active-file-store', () => ({
  activeFilePathAtom: atom('app/page.tsx'),
  isTemplateFilePath: () => false,
}));

vi.mock('@/code/stores/preset-store', () => ({
  presetTokensAtom: atom([]),
}));

vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: vi.fn(),
  flushNow: vi.fn(),
}));

vi.mock('@/code/stores/page-variables-store', () => ({
  pageVariablesAtom: atom([]),
}));

vi.mock('@/code/project/project-fs', () => ({
  projectFS: { readFile: () => '', listFiles: () => [] },
  projectVersionAtom: atom(1),
}));

vi.mock('./control-menu-items', () => ({
  getAllMenuItems: (ctx: unknown) => { controlLabelTestMocks.menuContext = ctx; return []; },
}));

describe('ControlLabel — style modified visual indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controlLabelTestMocks.menuContext = null;
    const store = getDefaultStore();
    store.set(selectedIdsAtom, ['test-node', 'second-node']);
    store.set(isComponentFileAtom as unknown as WritableAtom<boolean, [boolean], unknown>, false);
    store.set(presetTokensAtom as unknown as WritableAtom<PresetToken[], [PresetToken[]], unknown>, []);
    syncViewportWidths({ desktop: 1440, tablet: 920, mobile: 420 });
    mockControl.styles = {};
    mockControl.node.styles = {};
  });

  it('renders with secondary gray text when style is default or unset', () => {
    render(<ControlLabel label="Padding" property="padding" />);
    const labelSpan = screen.getByText('Padding');
    expect(labelSpan.className).toContain('text-[var(--text-secondary)]');
    expect(labelSpan.className).not.toContain('text-[var(--accent-modified');
  });

  it('renders with builder accent color text when style is modified', () => {
    mockControl.styles = { padding: '16px' };
    mockControl.node.styles = { padding: '16px' };

    render(<ControlLabel label="Padding" property="padding" />);
    const labelSpan = screen.getByText('Padding');
    expect(labelSpan.className).toContain('text-[var(--accent-modified,var(--accent-text))]');
  });

  it('renders with builder accent color when individual longhand is set (e.g. marginTop)', () => {
    mockControl.styles = { marginTop: '20px' };
    mockControl.node.styles = { marginTop: '20px' };

    render(<ControlLabel label="Margin" property="margin" />);
    const labelSpan = screen.getByText('Margin');
    expect(labelSpan.className).toContain('text-[var(--accent-modified,var(--accent-text))]');
  });

  it('renders with builder accent color in plain mode when modified', () => {
    mockControl.styles = { borderRadius: '8px' };
    mockControl.node.styles = { borderRadius: '8px' };

    render(<ControlLabel label="Radius" property="borderRadius" plain />);
    const labelSpan = screen.getByText('Radius');
    expect(labelSpan.className).toContain('text-[var(--accent-modified,var(--accent-text))]');
  });

  it('keeps secondary gray in plain mode when style is default (0px)', () => {
    mockControl.styles = { borderRadius: '0px' };
    mockControl.node.styles = { borderRadius: '0px' };

    render(<ControlLabel label="Radius" property="borderRadius" plain />);
    const labelSpan = screen.getByText('Radius');
    expect(labelSpan.className).toContain('text-[var(--text-secondary)]');
    expect(labelSpan.className).not.toContain('text-[var(--accent-modified');
  });

  it('renders Fill with accent color when a custom background color is set', () => {
    mockControl.styles = { backgroundColor: '#3b82f6' };
    mockControl.node.styles = { backgroundColor: '#3b82f6' };

    render(<ControlLabel label="Fill" property="backgroundColor" />);
    const labelSpan = screen.getByText('Fill');
    expect(labelSpan.className).toContain('text-[var(--accent-modified,var(--accent-text))]');
  });

  it('renders Fill with secondary gray when background is transparent or unset', () => {
    mockControl.styles = { backgroundColor: 'transparent' };
    mockControl.node.styles = { backgroundColor: 'transparent' };

    render(<ControlLabel label="Fill" property="backgroundColor" />);
    const labelSpan = screen.getByText('Fill');
    expect(labelSpan.className).toContain('text-[var(--text-secondary)]');
  });

  it('applies responsive dimension values only to the selected property on every selected page node', () => {
    const tokens = [
      { name: 'space-card', value: '16px', category: 'spacing' as const },
      { name: 'space-card-md', value: '12px', category: 'spacing' as const },
      { name: 'space-card-sm', value: '8px', category: 'spacing' as const },
    ];
    getDefaultStore().set(presetTokensAtom as unknown as WritableAtom<PresetToken[], [PresetToken[]], unknown>, tokens);
    mockControl.styles = { padding: '16px', color: '#000', marginTop: '24px' };
    mockControl.node.styles = mockControl.styles;

    render(<ControlLabel label="Padding" property="padding" />);
    const ctx = controlLabelTestMocks.menuContext;
    ctx.applyDimensionPreset({
      name: 'card', label: 'Card', category: 'spacing', tokens,
      base: tokens[0], md: tokens[1], sm: tokens[2],
    }, 'padding');

    const mutations = vi.mocked(queueMutation).mock.calls.map(([mutation]) => mutation);
    expect(mutations).toHaveLength(6);
    expect(mutations.filter((mutation) => mutation.type === 'updateStyles')).toEqual([
      { type: 'updateStyles', nodeId: 'test-node', styles: { padding: 'var(--space-card)' } },
      { type: 'updateStyles', nodeId: 'second-node', styles: { padding: 'var(--space-card)' } },
    ]);
    expect(mutations.filter((mutation) => mutation.type === 'updateContainerStyle')).toEqual([
      { type: 'updateContainerStyle', nodeId: 'test-node', maxWidth: 920, styles: { padding: 'var(--space-card-md, var(--space-card))' } },
      { type: 'updateContainerStyle', nodeId: 'second-node', maxWidth: 920, styles: { padding: 'var(--space-card-md, var(--space-card))' } },
      { type: 'updateContainerStyle', nodeId: 'test-node', maxWidth: 420, styles: { padding: 'var(--space-card-sm, var(--space-card))' } },
      { type: 'updateContainerStyle', nodeId: 'second-node', maxWidth: 420, styles: { padding: 'var(--space-card-sm, var(--space-card))' } },
    ]);
  });

  it('removes dimension token refs by resolving only the selected property at each configured band', () => {
    const tokens = [
      { name: 'space-card', value: '16px', category: 'spacing' as const },
      { name: 'space-card-md', value: '12px', category: 'spacing' as const },
      { name: 'space-card-sm', value: '8px', category: 'spacing' as const },
    ];
    getDefaultStore().set(presetTokensAtom as unknown as WritableAtom<PresetToken[], [PresetToken[]], unknown>, tokens);
    mockControl.styles = { padding: 'var(--space-card)', color: '#000' };
    mockControl.node.styles = mockControl.styles;

    render(<ControlLabel label="Padding" property="padding" />);
    controlLabelTestMocks.menuContext.removeDimensionPreset('padding');

    const mutations = vi.mocked(queueMutation).mock.calls.map(([mutation]) => mutation);
    expect(mutations).toEqual([
      { type: 'updateStyles', nodeId: 'test-node', styles: { padding: '16px' } },
      { type: 'updateStyles', nodeId: 'second-node', styles: { padding: '16px' } },
      { type: 'updateContainerStyle', nodeId: 'test-node', maxWidth: 920, styles: { padding: '12px' } },
      { type: 'updateContainerStyle', nodeId: 'second-node', maxWidth: 920, styles: { padding: '12px' } },
      { type: 'updateContainerStyle', nodeId: 'test-node', maxWidth: 420, styles: { padding: '8px' } },
      { type: 'updateContainerStyle', nodeId: 'second-node', maxWidth: 420, styles: { padding: '8px' } },
    ]);
  });

  it('keeps component-file preset application on the existing component-aware style route', () => {
    const tokens = [{ name: 'space-card', value: '16px', category: 'spacing' as const }];
    getDefaultStore().set(presetTokensAtom as unknown as WritableAtom<PresetToken[], [PresetToken[]], unknown>, tokens);
    getDefaultStore().set(isComponentFileAtom as unknown as WritableAtom<boolean, [boolean], unknown>, true);
    render(<ControlLabel label="Padding" property="padding" />);

    controlLabelTestMocks.menuContext.applyDimensionPreset({
      name: 'card', label: 'Card', category: 'spacing', tokens, base: tokens[0],
    }, 'padding');

    expect(mockControl.updateStyle).toHaveBeenCalledWith('padding', 'var(--space-card)');
    expect(queueMutation).not.toHaveBeenCalled();
  });
});
