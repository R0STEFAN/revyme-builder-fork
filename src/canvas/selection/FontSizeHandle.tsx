// FontSizeHandle.tsx — Interactive handle at bottom-right corner of text elements
// with fit-content / auto width and height (Framer parity).
// Dragging scales the font-size dynamically in realtime and expands/contracts the text container.
// Shift snaps to 4px increments; Escape cancels.

import { useCallback } from 'react';
import { SELECTION_COLOR, isTextTag, isFitSize } from '@/shared/constants';
import type { ScreenCorners } from '@/canvas/resize/geometry-utils';
import { findNodeComputedStyle, updateNodeStyles, getContentRoot, getViewportPrefix } from '@/canvas/node-ops';
import { transformManager } from '@/canvas/transform';
import { styleHelperOps } from './style-helper-store';
import { trace } from '@/shared/debug-trace';
import { getNodeFromCache, getNodesSnapshot } from '@/code/stores/store';
import { getResizeCursor } from '@/canvas/resize/cursor-utils';

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 400;
export const FONT_SIZE_HANDLE_SENSITIVITY = 0.4;
export const BASE_HANDLE_SIZE = 10;
const MIN_SCALE = 0.2;

export interface FontSizeHandleEligibilityParams {
  tag: string;
  width?: string | null;
  height?: string | null;
  hasHInset?: boolean;
  hasVInset?: boolean;
  hasTypographyPreset?: boolean;
}

/**
 * Check if the element has an active typography preset or font-size variable applied.
 * In that case, font size is governed by the preset/variable and the drag handle must be hidden.
 */
export function hasTypographyPresetOrVar(styles?: Record<string, string> | null): boolean {
  if (!styles) return false;
  const ff = styles.fontFamily || '';
  const fs = styles.fontSize || '';
  if (ff.includes('var(--typo-') || fs.includes('var(--typo-')) return true;
  if (fs.startsWith('var(')) return true;
  return false;
}

/**
 * Eligible when:
 * 1. Element is a text tag (p, h1-h6, span, etc.)
 * 2. Width is fit/auto/max-content (and not 100% or pinned inset)
 * 3. Height is fit/auto/max-content (and not pinned inset)
 * 4. No typography preset or font-size variable is applied
 */
export function isFontSizeHandleEligible(params: FontSizeHandleEligibilityParams): boolean {
  if (!isTextTag(params.tag)) return false;
  if (params.hasHInset || params.hasVInset) return false;
  if (params.hasTypographyPreset) return false;
  const fitWidth = !params.width || isFitSize(params.width);
  const fitHeight = !params.height || isFitSize(params.height);
  return fitWidth && fitHeight;
}

export interface ComputeNewFontSizeParams {
  initialFontSize: number;
  dx: number;
  dy: number;
  rotation?: number;
  shiftKey?: boolean;
  minFontSize?: number;
  maxFontSize?: number;
  sensitivity?: number;
}

export function computeNewFontSize({
  initialFontSize,
  dx,
  dy,
  rotation = 0,
  shiftKey = false,
  minFontSize = MIN_FONT_SIZE,
  maxFontSize = MAX_FONT_SIZE,
  sensitivity = FONT_SIZE_HANDLE_SENSITIVITY,
}: ComputeNewFontSizeParams): number {
  let delta: number;
  if (!rotation || Math.abs(rotation) < 0.1) {
    delta = (dx + dy) / 2;
  } else {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localDx = dx * cos + dy * sin;
    const localDy = -dx * sin + dy * cos;
    delta = (localDx + localDy) / 2;
  }

  let calculated = Math.round(initialFontSize + delta * sensitivity);

  if (shiftKey) {
    calculated = Math.round(calculated / 4) * 4;
  }

  return Math.max(minFontSize, Math.min(maxFontSize, calculated));
}

interface Props {
  corners: ScreenCorners;
  rotation: number;
  nodeId: string;
  vpId: string;
  color?: string;
  onInteracting: (v: boolean) => void;
}

export default function FontSizeHandle({
  corners,
  rotation,
  nodeId,
  vpId,
  color = SELECTION_COLOR,
  onInteracting,
}: Props) {
  const scale = transformManager.getTransform().scale || 1;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const contentEl = getContentRoot();
    if (!contentEl) return;

    const computedFontSize = findNodeComputedStyle(nodeId, vpId, 'fontSize')
      || findNodeComputedStyle(nodeId, vpId, 'font-size');
    const node = getNodeFromCache(nodeId) ?? getNodesSnapshot().get(nodeId);
    const authoredFontSize = node?.styles?.fontSize;
    const initialFontSize = parseFloat(computedFontSize) || parseFloat(authoredFontSize || '') || 16;

    const startX = e.clientX;
    const startY = e.clientY;
    const currentScale = transformManager.getTransform().scale || 1;
    const vpPrefix = getViewportPrefix(vpId);

    trace.action('font-size-handle:start', { nodeId, initialFontSize, scale: currentScale });
    onInteracting(true);

    let lastFontSize = initialFontSize;
    let didMove = false;

    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / currentScale;
      const dy = (me.clientY - startY) / currentScale;

      if (!didMove && (Math.abs(me.clientX - startX) > 1 || Math.abs(me.clientY - startY) > 1)) {
        didMove = true;
      }

      const newFontSize = computeNewFontSize({
        initialFontSize,
        dx,
        dy,
        rotation,
        shiftKey: me.shiftKey,
      });

      lastFontSize = newFontSize;

      // Realtime DOM-only preview
      updateNodeStyles({
        id: nodeId,
        styles: { fontSize: `${newFontSize}px` },
        contentEl,
        domOnly: true,
        viewportPrefix: vpPrefix,
      });

      // Show tooltip
      styleHelperOps.show({
        type: 'fontSize',
        position: { x: me.clientX + 16, y: me.clientY + 16 },
        value: newFontSize,
        unit: 'px',
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      styleHelperOps.hide();
      onInteracting(false);
    };

    const onKeyDown = (ke: KeyboardEvent) => {
      if (ke.key === 'Escape') {
        cleanup();
        updateNodeStyles({
          id: nodeId,
          styles: { fontSize: `${initialFontSize}px` },
          contentEl,
          domOnly: true,
          viewportPrefix: vpPrefix,
        });
        trace.action('font-size-handle:cancel-escape', { nodeId, initialFontSize });
      }
    };

    const onUp = () => {
      cleanup();

      if (didMove && lastFontSize !== initialFontSize) {
        updateNodeStyles({
          id: nodeId,
          styles: { fontSize: `${lastFontSize}px` },
          contentEl,
          viewportPrefix: vpPrefix,
        });
        trace.action('font-size-handle:end', { nodeId, fontSize: lastFontSize });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKeyDown);
  }, [nodeId, vpId, rotation, onInteracting]);

  if (scale < MIN_SCALE) return null;
  if (!corners || !corners.BR) return null;

  const handleSize = BASE_HANDLE_SIZE;
  const r = handleSize / 2;
  const cx = corners.BR.x - r;
  const cy = corners.BR.y - r;

  return (
    <svg
      data-font-size-handle=""
      data-node-id={nodeId}
      onPointerDown={handlePointerDown}
      style={{
        position: 'fixed',
        left: cx,
        top: cy,
        width: handleSize,
        height: handleSize,
        pointerEvents: 'all',
        cursor: getResizeCursor('bottomRight', rotation),
        zIndex: 4,
        overflow: 'visible',
      }}
    >
      {/* Invisible expanded hit area */}
      <circle cx={r} cy={r} r={r + 5} fill="transparent" pointerEvents="all" />
      {/* Outer selection-colored ring */}
      <circle cx={r} cy={r} r={r} fill={color} />
      {/* Inner white circle */}
      <circle cx={r} cy={r} r={r * 0.72} fill="#ffffff" />
      {/* Center dot indicating font-size handle */}
      <circle cx={r} cy={r} r={r * 0.32} fill={color} />
    </svg>
  );
}
