// CarouselTriggerConnectors.tsx — Persistent connector lines on canvas for EmblaCarousel external triggers.
//
// When buttons on the canvas are wired to an EmblaCarousel via `data-carousel-target` and
// `data-carousel-action`, this component renders persistent stepped connector lines and action
// badges between the carousel and the buttons.

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import {
  codeAtom,
  selectedNodeAtom,
  nodesAtom,
  canvasInteractingAtom,
} from '@/code/stores/store';
import { suppressSelectionOverlayAtom } from '@/code/stores/editor-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { findNodeRect } from '@/canvas/node-ops';
import { cornersFromRect } from '@/canvas/resize/geometry-utils';
import {
  quadCenter,
  getClosestEdgeCenterFromQuad,
  generateSteppedPath,
} from '@/canvas/ui/arrow-path';
import { ARROW_COLOR_GREYED } from '@/canvas/ui/arrow-color';
import { getCarouselTriggers } from '@/code/generation/carousel-trigger-ops';
import { trace } from '@/shared/debug-trace';
import type { CanvasNode } from '@/code/parsing/parser';

const ACTIVE_COLOR = '#8b5cf6';

export interface CarouselTriggerConnection {
  carouselId: string;
  targetId: string;
  action: 'prev' | 'next';
}

export interface CarouselConnectorPath {
  carouselId: string;
  targetId: string;
  action: 'prev' | 'next';
  d: string;
  badgePos: { x: number; y: number };
}

/**
 * Scan nodes and code to find all wired external trigger connections.
 */
export function findCarouselTriggerConnections(
  code: string,
  nodes: Map<string, CanvasNode>,
): CarouselTriggerConnection[] {
  if (!code) return [];

  const carouselIds = new Set<string>();

  // 1. Identify from nodes map: any EmblaCarousel code component
  for (const [id, node] of nodes.entries()) {
    if (
      node.isCodeComponent &&
      (node.componentFile?.includes('EmblaCarousel') ||
        node.name?.includes('EmblaCarousel'))
    ) {
      carouselIds.add(id);
    }
  }

  // 2. Identify from code: any element with data-carousel-target="..."
  const targetAttrRegex = /data-carousel-target=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = targetAttrRegex.exec(code)) !== null) {
    if (match[1]) {
      carouselIds.add(match[1]);
    }
  }

  const connections: CarouselTriggerConnection[] = [];

  for (const carouselId of carouselIds) {
    const { prevIds, nextIds } = getCarouselTriggers(code, carouselId);
    for (const targetId of prevIds) {
      connections.push({ carouselId, targetId, action: 'prev' });
    }
    for (const targetId of nextIds) {
      connections.push({ carouselId, targetId, action: 'next' });
    }
  }

  return connections;
}

/**
 * Compute the stepped connector path and badge position between a trigger button and carousel.
 */
export function computeConnectorPath(
  carouselId: string,
  targetId: string,
  action: 'prev' | 'next',
  vpId: string = 'desktop',
): CarouselConnectorPath | null {
  const targetRect = findNodeRect(targetId, vpId) ?? findNodeRect(targetId, 'desktop');
  const carouselRect = findNodeRect(carouselId, vpId) ?? findNodeRect(carouselId, 'desktop');
  if (!targetRect || !carouselRect) return null;

  const targetQuad = cornersFromRect(targetRect);
  const carouselQuad = cornersFromRect(carouselRect);
  const targetCenter = quadCenter(targetQuad);
  const carouselCenter = quadCenter(carouselQuad);

  const source = getClosestEdgeCenterFromQuad(targetQuad, carouselCenter);
  const target = getClosestEdgeCenterFromQuad(carouselQuad, targetCenter);

  const d = generateSteppedPath(source.point, target.point, source.dir, target.dir);
  if (!d) return null;

  const badgePos = {
    x: (source.point.x + target.point.x) / 2,
    y: (source.point.y + target.point.y) / 2,
  };

  return {
    carouselId,
    targetId,
    action,
    d,
    badgePos,
  };
}

export default function CarouselTriggerConnectors() {
  const code = useAtomValue(codeAtom);
  const nodes = useAtomValue(nodesAtom);
  const selectedId = useAtomValue(selectedNodeAtom);
  const vpId = useAtomValue(interactingViewportIdAtom);
  const isInteracting = useAtomValue(canvasInteractingAtom);
  const suppressOverlay = useAtomValue(suppressSelectionOverlayAtom);
  const activeFilePath = useAtomValue(activeFilePathAtom);

  const interactingRef = useRef(isInteracting);
  interactingRef.current = isInteracting;

  const [paths, setPaths] = useState<CarouselConnectorPath[]>([]);

  // Clear paths on active file switch to prevent painting against stale rects
  useEffect(() => {
    setPaths([]);
  }, [activeFilePath]);

  const connections = useMemo(() => {
    return findCarouselTriggerConnections(code, nodes);
  }, [code, nodes]);

  useEffect(() => {
    if (connections.length === 0) {
      setPaths([]);
      return;
    }

    trace.fn('CarouselTriggerConnectors:track', { count: connections.length });

    const computeAll = (): CarouselConnectorPath[] => {
      const next: CarouselConnectorPath[] = [];
      for (const conn of connections) {
        const p = computeConnectorPath(
          conn.carouselId,
          conn.targetId,
          conn.action,
          vpId || 'desktop',
        );
        if (p) next.push(p);
      }
      return next;
    };

    // Immediate calculation on change
    setPaths(computeAll());

    let rafId: number;
    const poll = () => {
      if (interactingRef.current) {
        rafId = requestAnimationFrame(poll);
        return;
      }
      const next = computeAll();
      setPaths((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [connections, vpId]);

  if (isInteracting || suppressOverlay || paths.length === 0) {
    return null;
  }

  return (
    <svg
      data-carousel-trigger-connectors=""
      data-connector-count={paths.length}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 2998,
      }}
    >
      <defs>
        {/* Active tip */}
        <marker
          id="carousel-trigger-arrow-tip"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill={ACTIVE_COLOR} />
        </marker>

        {/* Greyed-out tip */}
        <marker
          id="carousel-trigger-arrow-tip-greyed"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill={ARROW_COLOR_GREYED} />
        </marker>
      </defs>

      {paths.map((p, i) => {
        const isHighlighted =
          !!selectedId && (selectedId === p.carouselId || selectedId === p.targetId);
        const stroke = isHighlighted ? ACTIVE_COLOR : ARROW_COLOR_GREYED;

        return (
          <g key={`${p.carouselId}-${p.targetId}-${p.action}-${i}`}>
            <path
              data-carousel-trigger-path=""
              data-carousel-id={p.carouselId}
              data-target-id={p.targetId}
              data-action={p.action}
              d={p.d}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={
                isHighlighted
                  ? 'url(#carousel-trigger-arrow-tip)'
                  : 'url(#carousel-trigger-arrow-tip-greyed)'
              }
            />

            {/* Direction and action indicator badge */}
            <g
              data-carousel-trigger-badge=""
              data-action={p.action}
              transform={`translate(${p.badgePos.x}, ${p.badgePos.y})`}
            >
              <rect
                x={-28}
                y={-10}
                width={56}
                height={20}
                rx={10}
                ry={10}
                fill={isHighlighted ? ACTIVE_COLOR : 'rgba(30, 30, 40, 0.85)'}
                stroke={isHighlighted ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'}
                strokeWidth={1}
              />
              <text
                x={0}
                y={0}
                textAnchor="middle"
                dominantBaseline="central"
                fill={isHighlighted ? '#ffffff' : 'rgba(255, 255, 255, 0.7)'}
                fontSize={10}
                fontWeight={600}
                fontFamily="sans-serif"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {p.action === 'prev' ? '◀ Prev' : '▶ Next'}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
