import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import CarouselTriggerHandle from './CarouselTriggerHandle';
import {
  selectedIdsAtom,
  nodesAtom,
  canvasInteractingAtom,
} from '@/code/stores/store';
import { suppressSelectionOverlayAtom } from '@/code/stores/editor-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import type { CanvasNode } from '@/code/parsing/parser';

// Mocks
const mockGetScreenCornersById = vi.fn();
vi.mock('@/canvas/resize/geometry-utils', () => ({
  getScreenCornersById: (...args: unknown[]) => mockGetScreenCornersById(...args),
}));

const mockGetNodeHitsAtPoint = vi.fn();
const mockPatchNodeStyles = vi.fn();
const mockGetContentRoot = vi.fn();
vi.mock('@/canvas/node-ops', () => ({
  getNodeHitsAtPoint: (...args: unknown[]) => mockGetNodeHitsAtPoint(...args),
  patchNodeStyles: (...args: unknown[]) => mockPatchNodeStyles(...args),
  getContentRoot: () => mockGetContentRoot(),
}));

const mockModifyProjectFile = vi.fn();
vi.mock('@/code/project/modify-file', () => ({
  modifyProjectFile: (...args: unknown[]) => mockModifyProjectFile(...args),
}));

const mockSetForceRender = vi.fn();
vi.mock('@/code/mutation/mutation-queue', () => ({
  setForceRender: () => mockSetForceRender(),
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

describe('CarouselTriggerHandle', () => {
  let store: ReturnType<typeof createStore>;
  const dummyCorners = {
    TL: { x: 100, y: 100 },
    TR: { x: 300, y: 100 },
    BR: { x: 300, y: 250 },
    BL: { x: 100, y: 250 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore();
    store.set(activeFilePathAtom, 'app/page.tsx');
    store.set(interactingViewportIdAtom, 'desktop');
    store.set(canvasInteractingAtom, false);
    store.set(suppressSelectionOverlayAtom, false);
    mockGetScreenCornersById.mockReturnValue(dummyCorners);
    mockGetContentRoot.mockReturnValue(document.createElement('div'));
    mockGetNodeHitsAtPoint.mockReturnValue([]);
  });

  it('exports CarouselTriggerHandle as default', () => {
    expect(CarouselTriggerHandle).toBeDefined();
    expect(typeof CarouselTriggerHandle).toBe('function');
  });

  it('does not render when no node is selected', () => {
    store.set(selectedIdsAtom, []);
    store.set(nodesAtom, new Map());

    const { queryByTitle } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );

    expect(queryByTitle('Drag to connect Prev button')).toBeNull();
    expect(queryByTitle('Drag to connect Next button')).toBeNull();
  });

  it('does not render when selected node is not a code component', () => {
    const regularNode = createNode({ id: 'box-1', isCodeComponent: false, name: 'Box' });
    store.set(selectedIdsAtom, ['box-1']);
    store.set(nodesAtom, new Map([['box-1', regularNode]]));

    const { queryByTitle } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );

    expect(queryByTitle('Drag to connect Prev button')).toBeNull();
    expect(queryByTitle('Drag to connect Next button')).toBeNull();
  });

  it('does not render when selected node is a code component but not EmblaCarousel', () => {
    const otherCodeComponent = createNode({
      id: 'lens-1',
      isCodeComponent: true,
      name: 'LensBox',
      componentFile: 'components/LensBox.tsx',
    });
    store.set(selectedIdsAtom, ['lens-1']);
    store.set(nodesAtom, new Map([['lens-1', otherCodeComponent]]));

    const { queryByTitle } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );

    expect(queryByTitle('Drag to connect Prev button')).toBeNull();
    expect(queryByTitle('Drag to connect Next button')).toBeNull();
  });

  it('renders handles when selected node has componentFile including EmblaCarousel', () => {
    const carouselNode = createNode({
      id: 'carousel-1',
      isCodeComponent: true,
      name: 'CustomCarousel',
      componentFile: 'components/EmblaCarousel.tsx',
    });
    store.set(selectedIdsAtom, ['carousel-1']);
    store.set(nodesAtom, new Map([['carousel-1', carouselNode]]));

    const { getByTitle } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );

    const prevHandle = getByTitle('Drag to connect Prev button');
    const nextHandle = getByTitle('Drag to connect Next button');

    expect(prevHandle).toBeDefined();
    expect(nextHandle).toBeDefined();
    expect(prevHandle.textContent).toContain('◀');
    expect(nextHandle.textContent).toContain('▶');
  });

  it('renders handles when selected node has name including EmblaCarousel', () => {
    const carouselNode = createNode({
      id: 'carousel-2',
      isCodeComponent: true,
      name: 'EmblaCarousel',
      componentFile: 'components/Carousel.tsx',
    });
    store.set(selectedIdsAtom, ['carousel-2']);
    store.set(nodesAtom, new Map([['carousel-2', carouselNode]]));

    const { getByTitle } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );

    expect(getByTitle('Drag to connect Prev button')).toBeDefined();
    expect(getByTitle('Drag to connect Next button')).toBeDefined();
  });

  it('does not render when canvas is interacting or overlay is suppressed', () => {
    const carouselNode = createNode({
      id: 'carousel-1',
      isCodeComponent: true,
      name: 'EmblaCarousel',
      componentFile: 'components/EmblaCarousel.tsx',
    });
    store.set(selectedIdsAtom, ['carousel-1']);
    store.set(nodesAtom, new Map([['carousel-1', carouselNode]]));

    // When interacting is true
    store.set(canvasInteractingAtom, true);
    const { queryByTitle, rerender } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );
    expect(queryByTitle('Drag to connect Prev button')).toBeNull();

    // When suppressOverlay is true
    act(() => {
      store.set(canvasInteractingAtom, false);
      store.set(suppressSelectionOverlayAtom, true);
    });
    rerender(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );
    expect(queryByTitle('Drag to connect Prev button')).toBeNull();
  });

  it('positions Prev handle at bottom-left corner and Next handle at bottom-right corner', () => {
    const carouselNode = createNode({
      id: 'carousel-1',
      isCodeComponent: true,
      name: 'EmblaCarousel',
      componentFile: 'components/EmblaCarousel.tsx',
    });
    store.set(selectedIdsAtom, ['carousel-1']);
    store.set(nodesAtom, new Map([['carousel-1', carouselNode]]));

    const { getByTitle } = render(
      <Provider store={store}>
        <CarouselTriggerHandle />
      </Provider>,
    );

    const prevHandle = getByTitle('Drag to connect Prev button');
    const nextHandle = getByTitle('Drag to connect Next button');

    // Prev handle at BL (x: 100, y: 250), with center-anchored HANDLE_SIZE = 24 => left: 88, top: 238
    expect(prevHandle.style.left).toBe('88px');
    expect(prevHandle.style.top).toBe('238px');

    // Next handle at BR (x: 300, y: 250), with center-anchored HANDLE_SIZE = 24 => left: 288, top: 238
    expect(nextHandle.style.left).toBe('288px');
    expect(nextHandle.style.top).toBe('238px');

    // Accent theme color #8b5cf6
    expect(prevHandle.style.backgroundColor).toBe('rgb(139, 92, 246)');
    expect(nextHandle.style.backgroundColor).toBe('rgb(139, 92, 246)');
  });

  describe('drag & drop connection', () => {
    const carouselNode = createNode({
      id: 'carousel-1',
      isCodeComponent: true,
      name: 'EmblaCarousel',
      componentFile: 'components/EmblaCarousel.tsx',
    });
    const carouselChild = createNode({
      id: 'child-1',
      parentId: 'carousel-1',
      name: 'Slide',
    });
    const buttonTarget = createNode({
      id: 'btn-prev',
      parentId: null,
      name: 'Button',
    });

    beforeEach(() => {
      store.set(selectedIdsAtom, ['carousel-1']);
      store.set(
        nodesAtom,
        new Map([
          ['carousel-1', carouselNode],
          ['child-1', carouselChild],
          ['btn-prev', buttonTarget],
        ]),
      );
    });

    it('highlights valid target canvas element on pointermove during drag', () => {
      const { getByTitle } = render(
        <Provider store={store}>
          <CarouselTriggerHandle />
        </Provider>,
      );

      const prevHandle = getByTitle('Drag to connect Prev button');
      fireEvent.pointerDown(prevHandle, { clientX: 100, clientY: 250 });

      // Moving over the buttonTarget
      mockGetNodeHitsAtPoint.mockReturnValue([{ id: 'btn-prev', vpPrefix: '' }]);
      fireEvent(
        window,
        new PointerEvent('pointermove', { clientX: 50, clientY: 50 }),
      );

      expect(mockPatchNodeStyles).toHaveBeenCalledWith(
        expect.anything(),
        'btn-prev',
        '',
        { outline: '2px solid #8b5cf6', outlineOffset: '0px' },
      );
    });

    it('filters out the carousel itself and its children from drop targets', () => {
      const { getByTitle } = render(
        <Provider store={store}>
          <CarouselTriggerHandle />
        </Provider>,
      );

      const prevHandle = getByTitle('Drag to connect Prev button');
      fireEvent.pointerDown(prevHandle, { clientX: 100, clientY: 250 });

      // Hovering carousel itself
      mockGetNodeHitsAtPoint.mockReturnValue([{ id: 'carousel-1', vpPrefix: '' }]);
      fireEvent(
        window,
        new PointerEvent('pointermove', { clientX: 150, clientY: 150 }),
      );
      expect(mockPatchNodeStyles).not.toHaveBeenCalled();

      // Hovering child of carousel
      mockGetNodeHitsAtPoint.mockReturnValue([{ id: 'child-1', vpPrefix: '' }]);
      fireEvent(
        window,
        new PointerEvent('pointermove', { clientX: 160, clientY: 160 }),
      );
      expect(mockPatchNodeStyles).not.toHaveBeenCalled();
    });

    it('connects Prev trigger and refreshes canvas on pointerup over valid target', () => {
      const { getByTitle } = render(
        <Provider store={store}>
          <CarouselTriggerHandle />
        </Provider>,
      );

      const prevHandle = getByTitle('Drag to connect Prev button');
      fireEvent.pointerDown(prevHandle, { clientX: 100, clientY: 250 });

      mockGetNodeHitsAtPoint.mockReturnValue([{ id: 'btn-prev', vpPrefix: '' }]);
      fireEvent(
        window,
        new PointerEvent('pointerup', { clientX: 50, clientY: 50 }),
      );

      expect(mockModifyProjectFile).toHaveBeenCalledTimes(1);
      expect(mockModifyProjectFile).toHaveBeenCalledWith('app/page.tsx', expect.any(Function));

      // Test the transform passed to modifyProjectFile
      const transformFn = mockModifyProjectFile.mock.calls[0][1];
      const initialCode = '<div data-id="btn-prev">Prev</div>';
      const transformed = transformFn(initialCode);
      expect(transformed).toContain('data-carousel-target="carousel-1"');
      expect(transformed).toContain('data-carousel-action="prev"');

      // Calls setForceRender
      expect(mockSetForceRender).toHaveBeenCalledTimes(1);
    });

    it('connects Next trigger on drop from Next handle', () => {
      const nextTarget = createNode({
        id: 'btn-next',
        parentId: null,
        name: 'Button',
      });
      store.set(
        nodesAtom,
        new Map([
          ['carousel-1', carouselNode],
          ['btn-next', nextTarget],
        ]),
      );

      const { getByTitle } = render(
        <Provider store={store}>
          <CarouselTriggerHandle />
        </Provider>,
      );

      const nextHandle = getByTitle('Drag to connect Next button');
      fireEvent.pointerDown(nextHandle, { clientX: 300, clientY: 250 });

      mockGetNodeHitsAtPoint.mockReturnValue([{ id: 'btn-next', vpPrefix: '' }]);
      fireEvent(
        window,
        new PointerEvent('pointerup', { clientX: 350, clientY: 350 }),
      );

      expect(mockModifyProjectFile).toHaveBeenCalledTimes(1);
      const transformFn = mockModifyProjectFile.mock.calls[0][1];
      const initialCode = '<div data-id="btn-next">Next</div>';
      const transformed = transformFn(initialCode);
      expect(transformed).toContain('data-carousel-target="carousel-1"');
      expect(transformed).toContain('data-carousel-action="next"');

      expect(mockSetForceRender).toHaveBeenCalledTimes(1);
    });

    it('clears outline and does not modify file if dropped on empty canvas', () => {
      const { getByTitle } = render(
        <Provider store={store}>
          <CarouselTriggerHandle />
        </Provider>,
      );

      const prevHandle = getByTitle('Drag to connect Prev button');
      fireEvent.pointerDown(prevHandle, { clientX: 100, clientY: 250 });

      // First hover over button
      mockGetNodeHitsAtPoint.mockReturnValue([{ id: 'btn-prev', vpPrefix: '' }]);
      fireEvent(
        window,
        new PointerEvent('pointermove', { clientX: 50, clientY: 50 }),
      );
      expect(mockPatchNodeStyles).toHaveBeenCalledWith(
        expect.anything(),
        'btn-prev',
        '',
        { outline: '2px solid #8b5cf6', outlineOffset: '0px' },
      );

      // Now drop on empty space (hits = [])
      mockGetNodeHitsAtPoint.mockReturnValue([]);
      fireEvent(
        window,
        new PointerEvent('pointerup', { clientX: 500, clientY: 500 }),
      );

      // Clears outline
      expect(mockPatchNodeStyles).toHaveBeenCalledWith(
        expect.anything(),
        'btn-prev',
        '',
        { outline: '', outlineOffset: '' },
      );
      expect(mockModifyProjectFile).not.toHaveBeenCalled();
      expect(mockSetForceRender).not.toHaveBeenCalled();
    });
  });
});
