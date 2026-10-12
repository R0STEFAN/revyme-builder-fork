// CarouselTriggerHandle.tsx — Visual canvas handles for EmblaCarousel trigger binding.
//
// When an EmblaCarousel instance is selected on the canvas, displays two circular
// handle markers (◀ Prev and ▶ Next) at the bottom-left and bottom-right corners of the carousel.
// Dragging from a handle draws a connection line, snaps to any canvas element on hover,
// and on drop modifies the project source file to bind the trigger via `setCarouselTriggerInCode`.

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { createPortal } from 'react-dom';
import { selectedNodeAtom, nodesAtom, canvasInteractingAtom } from '@/code/stores/store';
import { suppressSelectionOverlayAtom } from '@/code/stores/editor-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { getNodeHitsAtPoint, patchNodeStyles, getContentRoot } from '@/canvas/node-ops';
import { getScreenCornersById } from '@/canvas/resize/geometry-utils';
import { usePolledValue } from '@/canvas/hooks/usePolledValue';
import { modifyProjectFile } from '@/code/project/modify-file';
import { setCarouselTriggerInCode } from '@/code/generation/carousel-trigger-ops';
import { setForceRender } from '@/code/mutation/mutation-queue';
import { trace } from '@/shared/debug-trace';
import type { CanvasNode } from '@/code/parsing/parser';

const HANDLE_SIZE = 24;
const ACCENT_COLOR = '#8b5cf6';

interface HandlePositions {
  prev: { x: number; y: number };
  next: { x: number; y: number };
}

function positionsEqual(a: HandlePositions | null, b: HandlePositions | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.prev.x === b.prev.x &&
    a.prev.y === b.prev.y &&
    a.next.x === b.next.x &&
    a.next.y === b.next.y
  );
}

function isSelfOrDescendant(
  targetId: string,
  ancestorId: string,
  nodes: Map<string, CanvasNode>,
): boolean {
  if (targetId === ancestorId) return true;
  let curr = nodes.get(targetId);
  while (curr && curr.parentId) {
    if (curr.parentId === ancestorId) return true;
    curr = nodes.get(curr.parentId);
  }
  return false;
}

function isValidDropTarget(
  targetId: string,
  carouselId: string,
  nodes: Map<string, CanvasNode>,
): boolean {
  if (!targetId || targetId === carouselId) return false;
  if (nodes.size > 0 && !nodes.has(targetId)) return false;
  const node = nodes.get(targetId);
  if (node && node.type === 'style') return false;
  return !isSelfOrDescendant(targetId, carouselId, nodes);
}

export default function CarouselTriggerHandle() {
  const selectedId = useAtomValue(selectedNodeAtom);
  const nodes = useAtomValue(nodesAtom);
  const selectedNode = selectedId ? nodes.get(selectedId) : null;
  const isInteracting = useAtomValue(canvasInteractingAtom);
  const suppressOverlay = useAtomValue(suppressSelectionOverlayAtom);
  const activeFilePath = useAtomValue(activeFilePathAtom);
  const vpId = useAtomValue(interactingViewportIdAtom);

  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState<'prev' | 'next' | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Clean up drag listeners if component unmounts mid-drag
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const isEmblaCarousel =
    !!selectedNode?.isCodeComponent &&
    (selectedNode.componentFile?.includes('EmblaCarousel') ||
      selectedNode.name?.includes('EmblaCarousel'));

  const shouldShow = isEmblaCarousel && !!selectedId && !isInteracting && !suppressOverlay;

  const handlePositions = usePolledValue<HandlePositions>(
    shouldShow && !!selectedId,
    (prev) => {
      const corners = getScreenCornersById(selectedId!, vpId);
      if (corners) {
        const next: HandlePositions = {
          prev: { x: corners.BL.x, y: corners.BL.y },
          next: { x: corners.BR.x, y: corners.BR.y },
        };
        return positionsEqual(prev, next) ? prev : next;
      }
      return prev;
    },
    [selectedId, vpId],
    { resetKey: activeFilePath, immediate: true },
  );


  const handlePointerDown = useCallback(
    (action: 'prev' | 'next') => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!selectedId) return;

      trace.action('carousel-trigger-handle:start-drag', { carouselId: selectedId, action });
      setIsDragging(true);
      setDragAction(action);
      setCursorPos({ x: e.clientX, y: e.clientY });

      const contentEl = getContentRoot();
      let prevTarget: { id: string; prefix: string } | null = null;

      const clearOutline = () => {
        if (prevTarget && contentEl) {
          patchNodeStyles(contentEl, prevTarget.id, prevTarget.prefix, {
            outline: '',
            outlineOffset: '',
          });
        }
        prevTarget = null;
      };

      const getDropTarget = (x: number, y: number): { id: string; prefix: string } | null => {
        const hits = getNodeHitsAtPoint(x, y);
        for (const hit of hits) {
          if (isValidDropTarget(hit.id, selectedId, nodes)) {
            return { id: hit.id, prefix: hit.vpPrefix || '' };
          }
        }
        return null;
      };

      const move = (me: PointerEvent) => {
        setCursorPos({ x: me.clientX, y: me.clientY });
        const target = getDropTarget(me.clientX, me.clientY);
        if (target) {
          if (!prevTarget || prevTarget.id !== target.id || prevTarget.prefix !== target.prefix) {
            clearOutline();
            if (contentEl) {
              patchNodeStyles(contentEl, target.id, target.prefix, {
                outline: `2px solid ${ACCENT_COLOR}`,
                outlineOffset: '0px',
              });
            }
            prevTarget = target;
          }
        } else {
          clearOutline();
        }
      };

      const up = (me: PointerEvent) => {
        const target = getDropTarget(me.clientX, me.clientY);
        clearOutline();

        if (target && activeFilePath) {
          trace.action('carousel-trigger-handle:connect', {
            carouselId: selectedId,
            targetId: target.id,
            action,
          });
          modifyProjectFile(activeFilePath, (code) =>
            setCarouselTriggerInCode(code, target.id, selectedId, action),
          );
          setForceRender();
        } else {
          trace.action('carousel-trigger-handle:drop-empty', { carouselId: selectedId });
        }

        setIsDragging(false);
        setDragAction(null);
        setCursorPos(null);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        dragCleanupRef.current = null;
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      dragCleanupRef.current = () => {
        clearOutline();
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
    },
    [selectedId, activeFilePath, nodes],
  );

  if (!shouldShow || !handlePositions) return null;

  const activeStartPos = dragAction === 'prev' ? handlePositions.prev : handlePositions.next;

  return createPortal(
    <>
      {/* Prev handle */}
      <div
        onPointerDown={handlePointerDown('prev')}
        data-canvas-wheel=""
        title="Drag to connect Prev button"
        data-action="prev"
        style={{
          position: 'fixed',
          left: handlePositions.prev.x - HANDLE_SIZE / 2,
          top: handlePositions.prev.y - HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: '50%',
          backgroundColor: ACCENT_COLOR,
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          pointerEvents: 'auto',
          zIndex: 3000,
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          fontSize: 10,
          userSelect: 'none',
        }}
      >
        ◀
      </div>

      {/* Next handle */}
      <div
        onPointerDown={handlePointerDown('next')}
        data-canvas-wheel=""
        title="Drag to connect Next button"
        data-action="next"
        style={{
          position: 'fixed',
          left: handlePositions.next.x - HANDLE_SIZE / 2,
          top: handlePositions.next.y - HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: '50%',
          backgroundColor: ACCENT_COLOR,
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          pointerEvents: 'auto',
          zIndex: 3000,
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          fontSize: 10,
          userSelect: 'none',
        }}
      >
        ▶
      </div>

      {/* Dragging connection line */}
      {isDragging && cursorPos && activeStartPos && (
        <svg
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 2999,
          }}
        >
          <line
            x1={activeStartPos.x}
            y1={activeStartPos.y}
            x2={cursorPos.x}
            y2={cursorPos.y}
            stroke={ACCENT_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </>,
    document.body,
  );
}
