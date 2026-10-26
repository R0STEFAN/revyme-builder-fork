import { describe, it, expect } from 'vitest';
import { buildMcpReference, formatMcpReference } from './mcp-reference';
import type { CanvasNode } from '@/code/parsing/parser';

function createMockNode(id: string, partial: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: 'div',
    name: 'Box',
    parentId: null,
    children: [],
    styles: {},
    attrs: {},
    ...partial,
  } as CanvasNode;
}

describe('buildMcpReference', () => {
  it('builds reference for a normal element on a page file', () => {
    const nodes = new Map<string, CanvasNode>([
      ['hero-1', createMockNode('hero-1', { name: 'Hero Title', type: 'h1', textContent: 'Welcome to Revyme' })],
    ]);

    const ref = buildMcpReference({
      activeFilePath: 'app/page.client.tsx',
      targetNodeId: 'hero-1',
      nodes,
      interactingViewportId: 'desktop',
    });

    expect(ref).toEqual({
      filePath: 'app/page.client.tsx',
      nodeId: 'hero-1',
      name: 'Hero Title',
      type: 'h1',
      viewport: 'desktop',
      textContent: 'Welcome to Revyme',
    });
  });

  it('builds reference for a component instance with componentFile and variant', () => {
    const nodes = new Map<string, CanvasNode>([
      ['card-inst', createMockNode('card-inst', {
        name: 'Pricing Card',
        type: 'PricingCard',
        componentFile: 'components/PricingCard.tsx',
        attrs: { initialVariant: 'pro' },
      })],
    ]);

    const ref = buildMcpReference({
      activeFilePath: 'app/pricing/page.client.tsx',
      targetNodeId: 'card-inst',
      nodes,
      interactingViewportId: 'mobile',
    });

    expect(ref).toEqual({
      filePath: 'app/pricing/page.client.tsx',
      nodeId: 'card-inst',
      name: 'Pricing Card',
      type: 'PricingCard',
      componentFile: 'components/PricingCard.tsx',
      variant: 'pro',
      viewport: 'mobile',
    });
  });

  it('builds reference for an element inside a component file with active variant', () => {
    const nodes = new Map<string, CanvasNode>([
      ['btn-label', createMockNode('btn-label', {
        name: 'Button Label',
        type: 'span',
        textContent: 'Click me',
      })],
    ]);

    const ref = buildMcpReference({
      activeFilePath: 'components/Button.tsx',
      targetNodeId: 'btn-label',
      nodes,
      activeVariant: 'hover',
    });

    expect(ref).toEqual({
      filePath: 'components/Button.tsx',
      nodeId: 'btn-label',
      name: 'Button Label',
      type: 'span',
      variant: 'hover',
      textContent: 'Click me',
    });
  });

  it('builds reference for a viewport header on a page', () => {
    const nodes = new Map<string, CanvasNode>([
      ['root', createMockNode('root', { name: 'Landing Page' })],
    ]);

    const ref = buildMcpReference({
      activeFilePath: 'app/page.client.tsx',
      viewportHeader: true,
      viewportId: 'tablet',
      nodes,
    });

    expect(ref).toEqual({
      filePath: 'app/page.client.tsx',
      nodeId: 'root',
      name: 'Landing Page',
      type: 'div',
      viewport: 'tablet',
    });
  });

  it('builds reference for a variant artboard header on a component file', () => {
    const nodes = new Map<string, CanvasNode>([
      ['root', createMockNode('root', { name: 'Button Master' })],
    ]);

    const ref = buildMcpReference({
      activeFilePath: 'components/Button.tsx',
      viewportHeader: true,
      viewportId: 'active-state',
      nodes,
    });

    expect(ref).toEqual({
      filePath: 'components/Button.tsx',
      nodeId: 'root',
      name: 'Button Master',
      type: 'div',
      variant: 'active-state',
    });
  });

  it('handles multi-selection cleanly', () => {
    const nodes = new Map<string, CanvasNode>([
      ['item-1', createMockNode('item-1', { name: 'Item 1', type: 'div' })],
      ['item-2', createMockNode('item-2', { name: 'Item 2', type: 'div' })],
    ]);

    const ref = buildMcpReference({
      activeFilePath: 'app/page.client.tsx',
      selectedIds: ['item-1', 'item-2'],
      nodes,
      interactingViewportId: 'desktop',
    });

    expect(ref).toEqual({
      filePath: 'app/page.client.tsx',
      selectedNodeIds: ['item-1', 'item-2'],
      count: 2,
      viewport: 'desktop',
      nodes: [
        { nodeId: 'item-1', name: 'Item 1', type: 'div' },
        { nodeId: 'item-2', name: 'Item 2', type: 'div' },
      ],
    });
  });

  it('falls back to root when nothing is selected', () => {
    const ref = buildMcpReference({
      activeFilePath: 'app/page.client.tsx',
      interactingViewportId: 'desktop',
    });

    expect(ref).toEqual({
      filePath: 'app/page.client.tsx',
      nodeId: 'root',
      viewport: 'desktop',
    });
  });

  it('formats reference to valid JSON string', () => {
    const ref = {
      filePath: 'app/page.client.tsx',
      nodeId: 'hero-1',
    };
    const json = formatMcpReference(ref);
    expect(JSON.parse(json)).toEqual(ref);
  });
});
