/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const queued: any[] = [];
vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: (m: any) => queued.push(m),
  flushNow: vi.fn(),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

const mockBridge = {
  setAttribute: vi.fn(),
};
vi.mock('@/canvas/canvas-bridge', () => ({
  getCanvasBridge: () => mockBridge,
}));

let mockControl: any = {};

vi.mock('../controls/ControlProvider', () => ({
  useControl: () => mockControl,
}));

vi.mock('../controls/CmsBoundPill', () => ({
  CmsBoundPill: ({ property, fallbackValue }: any) => (
    <div data-testid={`cms-bound-pill-${property}`}>CMS Bound: {property} ({fallbackValue})</div>
  ),
}));

vi.mock('../controls/VariableBoundPill', () => ({
  LegacyVariableBoundPill: ({ property, variableRef }: any) => (
    <div data-testid={`var-bound-pill-${property}`}>Var Bound: {property} ({variableRef})</div>
  ),
}));

import ImageTool from './ImageTool';

describe('ImageTool CMS and Expression bindings', () => {
  beforeEach(() => {
    queued.length = 0;
    mockBridge.setAttribute.mockClear();
    mockControl = {
      nodeId: 'img-1',
      node: {
        id: 'img-1',
        type: 'img',
        attrs: {
          'data-id': 'img-1',
          src: '/static.jpg',
          alt: 'Static Alt',
        },
      },
      styles: {
        objectFit: 'cover',
        objectPosition: 'center',
      },
      vpId: 'desktop',
      isReplica: false,
      vpWidth: 1440,
      parentLayout: 'none',
      parentFlexDirection: 'row',
      updateStyle: vi.fn(),
      updateMultipleStyles: vi.fn(),
      updateStyleLive: vi.fn(),
      hasOverride: () => false,
      getOverrides: () => [],
      getValueSource: (prop: string) => ({ source: 'inline', ref: null }),
      createVariable: vi.fn(),
      removeVariable: vi.fn(),
      cmsBinding: null,
    };
  });

  it('renders fx button next to source row', () => {
    render(<ImageTool />);
    const fxBtn = screen.getByTitle('Dynamic Expression (Formula)');
    expect(fxBtn).toBeDefined();
    expect(fxBtn.textContent).toBe('fx');
  });

  it('opens ExpressionEditorPopup with targetProperty="src" when fx button is clicked', () => {
    render(<ImageTool />);
    const fxBtn = screen.getByTitle('Dynamic Expression (Formula)');
    fireEvent.click(fxBtn);

    // Modal title should indicate Image Expression
    expect(screen.getByText('Image Expression (Formula)')).toBeDefined();
  });

  it('renders ExpressionBoundPill when node has srcExpression', () => {
    mockControl.node.srcExpression = '`https://directus.example.com/assets/${item.image}`';
    render(<ImageTool />);

    // ExpressionBoundPill renders the formula text
    expect(screen.getByText('`https://directus.example.com/assets/${item.image}`')).toBeDefined();

    // Clicking the pill's clear button triggers unbindSrcExpression
    const clearBtn = screen.getByText('×');
    fireEvent.click(clearBtn);

    expect(queued).toContainEqual({
      type: 'unbindSrcExpression',
      nodeId: 'img-1',
    });
    expect(mockBridge.setAttribute).toHaveBeenCalledWith('img-1', '', 'src', null);
  });

  it('renders CmsBoundPill and fx button when src is bound to a CMS field', () => {
    mockControl.cmsBinding = {
      slug: 'posts',
      itemVar: 'item',
      fields: [{ id: 'photo', name: 'Photo', type: 'image' }],
      getBindingForProperty: (prop: string) => (prop === 'src' ? 'photo' : undefined),
      unbindField: vi.fn(),
      hasVariantOverride: () => false,
      resetVariantOverride: vi.fn(),
    };

    render(<ImageTool />);
    expect(screen.getByTestId('cms-bound-pill-src')).toBeDefined();

    // fx button should also be available next to CmsBoundPill
    const fxBtn = screen.getByTitle('Dynamic Expression (Formula)');
    expect(fxBtn).toBeDefined();
  });

  it('renders CmsBoundPill when alt text is bound to a CMS field', () => {
    mockControl.cmsBinding = {
      slug: 'posts',
      itemVar: 'item',
      fields: [{ id: 'caption', name: 'Caption', type: 'text' }],
      getBindingForProperty: (prop: string) => (prop === 'alt' ? 'caption' : undefined),
      unbindField: vi.fn(),
      hasVariantOverride: () => false,
      resetVariantOverride: vi.fn(),
    };

    render(<ImageTool />);
    expect(screen.getByTestId('cms-bound-pill-alt')).toBeDefined();
  });

  it('renders LegacyVariableBoundPill when alt text is bound to a variable prop', () => {
    mockControl.getValueSource = (prop: string) => (
      prop === 'alt' ? { source: 'prop', ref: 'altText' } : { source: 'inline', ref: null }
    );

    render(<ImageTool />);
    expect(screen.getByTestId('var-bound-pill-alt')).toBeDefined();
  });
});
