import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { LayerRow, type FlatLayer } from '../rows';
import type { CanvasNode } from '@/code/parsing/parser';

describe('LayerRow for Viewport Header', () => {
  const dummyNode = {
    id: '__vp_desktop',
    type: 'viewport',
    name: 'Desktop',
    parentId: null,
    children: [],
    styles: {},
    attrs: {},
    textContent: '',
    isCanvasNode: false,
  } as unknown as CanvasNode;

  const createVpLayer = (opts?: Partial<FlatLayer>): FlatLayer => ({
    id: '__vp_desktop',
    nodeId: null,
    node: dummyNode,
    depth: 0,
    hasChildren: false,
    isExpanded: true,
    viewportId: 'desktop',
    viewportLabel: 'Desktop',
    viewportWidth: 1200,
    isVpHidden: false,
    ...opts,
  });

  const defaultProps = {
    isSelected: false,
    isComponentMode: false,
    isChildOfSelected: false,
    hasHighlightedChildren: false,
    isLastHighlightedChild: false,
    isDragOver: false,
    dropPosition: null as any,
    dropDepth: 0,
    isDragging: false,
    effectiveHidden: false,
    onSelect: vi.fn(),
    onToggleExpand: vi.fn(),
    onDragStart: vi.fn(),
    onContextMenu: vi.fn(),
    onToggleLock: vi.fn(),
    onToggleVisibility: vi.fn(),
    isRenaming: false,
    onRenameCommit: vi.fn(),
    onVariantRenameCommit: vi.fn(),
    onDoubleClickLayout: vi.fn(),
    nodes: new Map(),
    presetTokens: [],
  };

  it('renders visibility toggle button for viewport header and handles click', () => {
    const onToggleVisibility = vi.fn();
    const layer = createVpLayer({ isVpHidden: false });

    const { getByTitle, queryByTitle } = render(
      <LayerRow
        {...defaultProps}
        layer={layer}
        onToggleVisibility={onToggleVisibility}
      />
    );

    // Lock button should NOT be rendered for viewport header
    expect(queryByTitle('Lock layer')).toBeNull();

    // Eye button should be rendered
    const eyeBtn = getByTitle('Hide breakpoint from canvas');
    expect(eyeBtn).toBeDefined();

    fireEvent.click(eyeBtn);
    expect(onToggleVisibility).toHaveBeenCalledWith('', 'desktop');
  });

  it('renders crossed-out eye and correct title when viewport is hidden', () => {
    const onToggleVisibility = vi.fn();
    const layer = createVpLayer({
      id: '__vp_tablet',
      viewportId: 'tablet',
      viewportLabel: 'Tablet',
      viewportWidth: 810,
      isVpHidden: true,
    });

    const { getByTitle } = render(
      <LayerRow
        {...defaultProps}
        layer={layer}
        onToggleVisibility={onToggleVisibility}
      />
    );

    const eyeBtn = getByTitle('Show breakpoint on canvas');
    expect(eyeBtn).toBeDefined();
    expect(eyeBtn.getAttribute('data-hidden')).toBe('true');

    fireEvent.click(eyeBtn);
    expect(onToggleVisibility).toHaveBeenCalledWith('', 'tablet');
  });
});
