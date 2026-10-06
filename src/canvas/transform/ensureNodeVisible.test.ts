// ensureNodeVisible.test.ts — Unit tests for ensureNodeVisible camera command.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';

const rectCache = new Map<string, DOMRect>();
const rects = new Map<string, DOMRect>();

vi.mock('@/canvas/canvas-bridge', () => ({
  getCanvasBridge: () => ({
    rectCache,
    getRect: (dataId: string, vpPrefix: string) => rects.get(`${vpPrefix}|${dataId}`) ?? null,
  }),
}));

let currentTransform = { x: 0, y: 0, scale: 1 };
vi.mock('./TransformManager', () => ({
  transformManager: {
    getTransform: () => currentTransform,
    setTransform: (t: { x: number; y: number; scale: number }) => { currentTransform = t; },
  },
}));

vi.mock('@/canvas/drag/helpers/coords', () => ({
  getIframeOffset: () => ({ x: 0, y: 0 }),
  screenRectToCanvas: (r: { left: number; top: number; width: number; height: number }, t: { x: number; y: number; scale: number }) => ({
    left: (r.left - t.x) / t.scale,
    top: (r.top - t.y) / t.scale,
    width: r.width / t.scale,
    height: r.height / t.scale,
  }),
}));

const animCalls: Array<{ x: number; y: number; scale: number; duration: number }> = [];
const moveCalls: Array<{ x: number; y: number; scale: number }> = [];

vi.mock('./CameraAnimator', () => ({
  animateCanvasTo: (x: number, y: number, scale: number, duration: number) => {
    animCalls.push({ x, y, scale, duration });
  },
  moveCanvasTo: (x: number, y: number, scale: number) => {
    moveCalls.push({ x, y, scale });
  },
}));

import { ensureNodeVisible, setCanvasInsets } from './CameraCommands';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

function seedNode(prefix: string, nodeId: string, left: number, top: number, width: number, height: number) {
  const r = makeRect(left, top, width, height);
  rectCache.set(`${prefix}:${nodeId}`, r);
  rects.set(`${prefix}|${nodeId}`, r);
}

describe('ensureNodeVisible', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1920 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 1080 });
    rectCache.clear();
    rects.clear();
    animCalls.length = 0;
    moveCalls.length = 0;
    currentTransform = { x: 0, y: 0, scale: 1 };
    getDefaultStore().set(interactingViewportIdAtom, 'desktop');
    // Set standard insets: left toolbar 308px, top header 52px, right panel 260px, bottom 0
    setCanvasInsets({ left: 308, top: 52, right: 260, bottom: 0 });
    // Assume window is 1920x1080 (available area: width = 1352, height = 1028, centerX = 984, centerY = 566)
    // Visible rect: left: 308, right: 1660, top: 52, bottom: 1080
    // With padding 40: visible X range: [348, 1620], visible Y range: [92, 1040]
  });

  it('returns false when nodeId is empty or missing from cache', () => {
    expect(ensureNodeVisible('')).toBe(false);
    expect(ensureNodeVisible('nonexistent')).toBe(false);
    expect(animCalls.length).toBe(0);
  });

  it('returns false and does not animate when node is already comfortably in view', () => {
    // Center of visible area (e.g. left: 800, top: 400, width: 200, height: 100)
    seedNode('', 'card-1', 800, 400, 200, 100);
    const moved = ensureNodeVisible('card-1', 'desktop');
    expect(moved).toBe(false);
    expect(animCalls.length).toBe(0);
  });

  it('pans horizontally when node is off-screen to the left, keeping Y intact if Y was in view', () => {
    // Node is at left: 50 (off-screen, behind left panel 308), top: 400 (vertically in view)
    seedNode('', 'sidebar-elem', 50, 400, 100, 50);
    const moved = ensureNodeVisible('sidebar-elem', 'desktop');
    expect(moved).toBe(true);
    expect(animCalls.length).toBe(1);
    // Target X should center element at centerX (984): centerX - (c.left + c.width/2) = 984 - (50 + 50) = 884
    expect(animCalls[0].x).toBe(884);
    // Y should remain unchanged (0) because it was already vertically in view
    expect(animCalls[0].y).toBe(0);
  });

  it('pans horizontally when node is off-screen to the right', () => {
    // Node is at left: 1800 (off-screen, beyond right panel 1660), top: 400
    seedNode('', 'right-elem', 1800, 400, 100, 50);
    const moved = ensureNodeVisible('right-elem', 'desktop');
    expect(moved).toBe(true);
    expect(animCalls.length).toBe(1);
    // Target X: 984 - (1800 + 50) = -866
    expect(animCalls[0].x).toBe(-866);
    expect(animCalls[0].y).toBe(0);
  });

  it('pans vertically when node is scrolled below the visible area, keeping X intact', () => {
    // Node is at left: 800 (horizontally in view), top: 1500 (below bottom 1080)
    seedNode('', 'footer-btn', 800, 1500, 200, 80);
    const moved = ensureNodeVisible('footer-btn', 'desktop');
    expect(moved).toBe(true);
    expect(animCalls.length).toBe(1);
    // X remains unchanged (0)
    expect(animCalls[0].x).toBe(0);
    // Y centers at centerY (566): 566 - (1500 + 40) = -974
    expect(animCalls[0].y).toBe(-974);
  });

  it('aligns top edge with margin for tall elements instead of centering them off-screen', () => {
    // Tall element: height 2000px, top 1200 (below screen)
    seedNode('', 'tall-section', 800, 1200, 600, 2000);
    const moved = ensureNodeVisible('tall-section', 'desktop');
    expect(moved).toBe(true);
    expect(animCalls.length).toBe(1);
    // Top should align to visibleTop (52) + padding (40) = 92: targetY = 92 - c.top = 92 - 1200 = -1108
    expect(animCalls[0].y).toBe(-1108);
  });

  it('resolves viewport-specific prefix for mobile/tablet', () => {
    // Seed mobile node with 'mobile-' prefix
    seedNode('mobile-', 'hero-heading', 2000, 300, 300, 100);
    const moved = ensureNodeVisible('hero-heading', 'mobile');
    expect(moved).toBe(true);
    expect(animCalls.length).toBe(1);
    // Centers at 984: 984 - (2000 + 150) = -1166
    expect(animCalls[0].x).toBe(-1166);
  });

  it('uses moveCanvasTo when instant option is true', () => {
    seedNode('', 'offscreen-card', 2000, 400, 100, 50);
    const moved = ensureNodeVisible('offscreen-card', 'desktop', { instant: true });
    expect(moved).toBe(true);
    expect(animCalls.length).toBe(0);
    expect(moveCalls.length).toBe(1);
    expect(moveCalls[0].x).toBe(984 - 2050);
  });
});
