import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import CarouselTriggerConnectors, {
  findCarouselTriggerConnections,
  computeConnectorPath,
} from './CarouselTriggerConnectors';
import {
  codeAtom,
  nodesAtom,
  selectedNodeAtom,
  selectedIdsAtom,
  canvasInteractingAtom,
} from '@/code/stores/store';
import { suppressSelectionOverlayAtom } from '@/code/stores/editor-store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import type { CanvasNode } from '@/code/parsing/parser';

// Mocks for node-ops
const mockFindNodeRect = vi.fn();
vi.mock('@/canvas/node-ops', () => ({
  findNodeRect: (nodeId: string, vpId?: string) => mockFindNodeRect(nodeId, vpId),
}));

function createNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    name: 'Box',
    type: 'div',
    parentId: null,
    children: [],
    styles: {},
    attrs: {},
    ...overrides,
  } as unknown as CanvasNode;
}

function makeDomRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('CarouselTriggerConnectors', () => {
  let store: ReturnType<typeof createStore>;

  const sampleCode = `
    <div>
      <EmblaCarousel data-id="carousel-1" />
      <button data-id="btn-prev" data-carousel-target="carousel-1" data-carousel-action="prev">Prev</button>
      <button data-id="btn-next" data-carousel-target="carousel-1" data-carousel-action="next">Next</button>
    </div>
  `;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore();
    store.set(activeFilePathAtom, 'app/page.tsx');
    store.set(interactingViewportIdAtom, 'desktop');
    store.set(canvasInteractingAtom, false);
    store.set(suppressSelectionOverlayAtom, false);
    store.set(selectedIdsAtom, []);
    store.set(codeAtom, sampleCode);

    const carouselNode = createNode({
      id: 'carousel-1',
      isCodeComponent: true,
      name: 'EmblaCarousel',
      componentFile: 'components/EmblaCarousel.tsx',
    });
    const btnPrev = createNode({ id: 'btn-prev', name: 'Button' });
    const btnNext = createNode({ id: 'btn-next', name: 'Button' });

    store.set(
      nodesAtom,
      new Map([
        ['carousel-1', carouselNode],
        ['btn-prev', btnPrev],
        ['btn-next', btnNext],
      ]),
    );

    mockFindNodeRect.mockImplementation((nodeId: string) => {
      if (nodeId === 'carousel-1') return makeDomRect(100, 100, 400, 200);
      if (nodeId === 'btn-prev') return makeDomRect(50, 400, 80, 40);
      if (nodeId === 'btn-next') return makeDomRect(450, 400, 80, 40);
      return null;
    });
  });

  describe('unit helpers', () => {
    it('findCarouselTriggerConnections extracts connections from code and nodes', () => {
      const nodes = new Map<string, CanvasNode>([
        [
          'carousel-1',
          createNode({
            id: 'carousel-1',
            isCodeComponent: true,
            name: 'EmblaCarousel',
          }),
        ],
      ]);

      const conns = findCarouselTriggerConnections(sampleCode, nodes);
      expect(conns).toHaveLength(2);

      const prevConn = conns.find((c) => c.action === 'prev');
      expect(prevConn).toEqual({
        carouselId: 'carousel-1',
        targetId: 'btn-prev',
        action: 'prev',
      });

      const nextConn = conns.find((c) => c.action === 'next');
      expect(nextConn).toEqual({
        carouselId: 'carousel-1',
        targetId: 'btn-next',
        action: 'next',
      });
    });

    it('findCarouselTriggerConnections returns empty list if no connections or code', () => {
      expect(findCarouselTriggerConnections('', new Map())).toEqual([]);
      expect(findCarouselTriggerConnections('<div>Hello</div>', new Map())).toEqual([]);
    });

    it('computeConnectorPath calculates path string and badge position when rects exist', () => {
      const result = computeConnectorPath('carousel-1', 'btn-prev', 'prev', 'desktop');
      expect(result).not.toBeNull();
      expect(result?.carouselId).toBe('carousel-1');
      expect(result?.targetId).toBe('btn-prev');
      expect(result?.action).toBe('prev');
      expect(typeof result?.d).toBe('string');
      expect(result?.d.startsWith('M ')).toBe(true);
      expect(result?.badgePos).toHaveProperty('x');
      expect(result?.badgePos).toHaveProperty('y');
    });

    it('computeConnectorPath returns null if any rect is missing', () => {
      mockFindNodeRect.mockReturnValue(null);
      const result = computeConnectorPath('carousel-1', 'missing-node', 'prev', 'desktop');
      expect(result).toBeNull();
    });
  });

  describe('component rendering', () => {
    it('is exported and defined', () => {
      expect(CarouselTriggerConnectors).toBeDefined();
      expect(typeof CarouselTriggerConnectors).toBe('function');
    });

    it('renders SVG connector paths and action badges when triggers exist', () => {
      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const svg = container.querySelector('[data-carousel-trigger-connectors]');
      expect(svg).toBeDefined();
      expect(svg).not.toBeNull();

      const paths = container.querySelectorAll('[data-carousel-trigger-path]');
      expect(paths.length).toBe(2);

      const badges = container.querySelectorAll('[data-carousel-trigger-badge]');
      expect(badges.length).toBe(2);

      const texts = Array.from(badges).map((b) => b.textContent?.trim());
      expect(texts.some((t) => t?.includes('◀ Prev'))).toBe(true);
      expect(texts.some((t) => t?.includes('▶ Next'))).toBe(true);
    });

    it('does not render if there are no trigger connections', () => {
      store.set(codeAtom, '<div><EmblaCarousel data-id="carousel-1" /></div>');

      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const svg = container.querySelector('[data-carousel-trigger-connectors]');
      expect(svg).toBeNull();
    });

    it('does not render when canvas is interacting', () => {
      store.set(canvasInteractingAtom, true);

      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const svg = container.querySelector('[data-carousel-trigger-connectors]');
      expect(svg).toBeNull();
    });

    it('does not render when selection overlay is suppressed', () => {
      store.set(suppressSelectionOverlayAtom, true);

      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const svg = container.querySelector('[data-carousel-trigger-connectors]');
      expect(svg).toBeNull();
    });

    it('highlights line with active purple accent when carousel is selected', () => {
      store.set(selectedIdsAtom, ['carousel-1']);

      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const paths = container.querySelectorAll('[data-carousel-trigger-path]');
      expect(paths.length).toBe(2);

      // Both prev and next target carousel-1, so both are active
      for (const p of paths) {
        expect(p.getAttribute('stroke')).toBe('#8b5cf6');
      }
    });

    it('highlights line when target trigger button is selected and greys unselected line', () => {
      store.set(selectedIdsAtom, ['btn-prev']);

      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const prevPath = container.querySelector('[data-target-id="btn-prev"]');
      const nextPath = container.querySelector('[data-target-id="btn-next"]');

      expect(prevPath?.getAttribute('stroke')).toBe('#8b5cf6');
      expect(nextPath?.getAttribute('stroke')).toBe('rgba(255,255,255,0.08)');
    });

    it('renders subtle greyed lines when nothing or an unrelated node is selected', () => {
      store.set(selectedIdsAtom, ['unrelated-node']);

      const { container } = render(
        <Provider store={store}>
          <CarouselTriggerConnectors />
        </Provider>,
      );

      const paths = container.querySelectorAll('[data-carousel-trigger-path]');
      for (const p of paths) {
        expect(p.getAttribute('stroke')).toBe('rgba(255,255,255,0.08)');
      }
    });
  });
});
