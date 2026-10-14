import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import {
  viewportsConfigAtom,
  visibleViewportsAtom,
  interactingViewportIdAtom,
  toggleViewportHidden,
} from '../viewport-store';
import { computeActiveViewports } from '@/canvas/hooks/useActiveViewports';
import { parseCanvasConfig, serializeCanvasConfig } from '@/code/project/canvas-config';
import type { ViewportConfig } from '@/shared/types';
import type { CanvasNode } from '@/code/parsing/parser';

describe('Viewport Visibility (Hide/Show on Canvas)', () => {
  const store = getDefaultStore();

  const mockViewports: ViewportConfig[] = [
    { id: 'desktop', label: 'Desktop', width: 1200, isPrimary: true, order: 0, x: 0, y: 0, hidden: false },
    { id: 'tablet', label: 'Tablet', width: 810, isPrimary: false, order: 1, x: 1240, y: 0, hidden: false },
    { id: 'mobile', label: 'Mobile', width: 390, isPrimary: false, order: 2, x: 2090, y: 0, hidden: false },
  ];

  beforeEach(() => {
    store.set(viewportsConfigAtom, mockViewports);
    store.set(interactingViewportIdAtom, 'desktop');
  });

  describe('canvas-config serialization and parsing', () => {
    it('serializes hidden: true to @canvas block and parses it back', () => {
      const vpsWithHidden: ViewportConfig[] = [
        { id: 'desktop', label: 'Desktop', width: 1200, isPrimary: true, order: 0, x: 0, y: 0 },
        { id: 'mobile', label: 'Mobile', width: 390, isPrimary: false, order: 1, x: 1240, y: 0, hidden: true },
      ];
      const serialized = serializeCanvasConfig({
        viewports: vpsWithHidden,
        positions: { desktop: { x: 0, y: 0 }, mobile: { x: 1240, y: 0 } },
      });

      expect(serialized).toContain('"hidden": true');

      const parsed = parseCanvasConfig(serialized);
      expect(parsed).not.toBeNull();
      expect(parsed!.viewports.find((v) => v.id === 'mobile')?.hidden).toBe(true);
      expect(parsed!.viewports.find((v) => v.id === 'desktop')?.hidden).toBe(false);
    });
  });

  describe('toggleViewportHidden', () => {
    it('toggles hidden state on a replica viewport', () => {
      const res = toggleViewportHidden('tablet');
      expect(res.success).toBe(true);

      const configs = store.get(viewportsConfigAtom);
      expect(configs.find((v) => v.id === 'tablet')?.hidden).toBe(true);
      expect(configs.find((v) => v.id === 'desktop')?.hidden).toBe(false);

      // Toggle back to visible
      const res2 = toggleViewportHidden('tablet');
      expect(res2.success).toBe(true);
      const configs2 = store.get(viewportsConfigAtom);
      expect(configs2.find((v) => v.id === 'tablet')?.hidden).toBe(false);
    });

    it('prevents hiding the last visible viewport', () => {
      // Hide tablet
      toggleViewportHidden('tablet');
      // Hide mobile
      toggleViewportHidden('mobile');

      // Now only desktop is visible. Attempting to hide desktop must fail.
      const res = toggleViewportHidden('desktop');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('last_visible');

      const configs = store.get(viewportsConfigAtom);
      expect(configs.find((v) => v.id === 'desktop')?.hidden).toBe(false);
    });

    it('falls back interactingViewportId if the active viewport is hidden', () => {
      store.set(interactingViewportIdAtom, 'mobile');
      expect(store.get(interactingViewportIdAtom)).toBe('mobile');

      toggleViewportHidden('mobile');

      // Should automatically clamp away from hidden 'mobile' to a visible one ('desktop')
      expect(store.get(interactingViewportIdAtom)).toBe('desktop');
    });
  });

  describe('computeActiveViewports', () => {
    it('filters out hidden viewports so canvas only renders visible viewports', () => {
      const vps: ViewportConfig[] = [
        { id: 'desktop', label: 'Desktop', width: 1200, isPrimary: true, order: 0, x: 0, y: 0, hidden: false },
        { id: 'tablet', label: 'Tablet', width: 810, isPrimary: false, order: 1, x: 1240, y: 0, hidden: true },
        { id: 'mobile', label: 'Mobile', width: 390, isPrimary: false, order: 2, x: 2090, y: 0, hidden: false },
      ];
      const widths = { desktop: 1200, tablet: 810, mobile: 390 };
      const nodes = new Map<string, CanvasNode>();

      const active = computeActiveViewports('app/page.tsx', '', nodes, vps, widths);
      expect(active.map((v) => v.id)).toEqual(['desktop', 'mobile']);
    });
  });
});
