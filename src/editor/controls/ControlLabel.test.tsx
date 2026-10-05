import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { atom } from 'jotai';
import ControlLabel from './ControlLabel';

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

vi.mock('@/code/stores/page-variables-store', () => ({
  pageVariablesAtom: atom([]),
}));

vi.mock('@/code/project/project-fs', () => ({
  projectFS: { readFile: () => '' },
  projectVersionAtom: atom(1),
}));

vi.mock('./control-menu-items', () => ({
  getAllMenuItems: () => [],
}));

describe('ControlLabel — style modified visual indicator', () => {
  beforeEach(() => {
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
});
