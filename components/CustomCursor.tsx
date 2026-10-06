'use client';

/** @label "Interactive Cursor" */
/** @comment "Magnetic interactive mouse cursor with hover state scaling" */
/** @controls {
  "color": { "type": "color", "label": "Cursor Color", "default": "#ff3300" },
  "size": { "type": "number", "label": "Normal Size (px)", "min": 6, "max": 40, "default": 14 },
  "hoverScale": { "type": "number", "label": "Hover Scale Multiplier", "min": 1, "max": 6, "default": 3.2 }
} */

import React, { useEffect, useState } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

interface CustomCursorProps {
  color?: string;
  size?: number;
  hoverScale?: number;
  style?: React.CSSProperties;
}

function CustomCursor(props: CustomCursorProps) {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [isHovering, setIsHovering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const onMouseMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
      setIsVisible(true);
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-hover-target="true"], a, button, [role="button"], input, textarea');
      if (target) setIsHovering(true);
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-hover-target="true"], a, button, [role="button"], input, textarea');
      if (target) setIsHovering(false);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
    };
  }, []);

  if (!isVisible) return null;

  const baseSize = props.size || 14;
  const scale = isHovering ? (props.hoverScale || 3.2) : 1;
  const cursorColor = props.color || '#ff3300';

  return (
    <div
      data-id="custom-cursor-follower"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0) translate3d(-50%, -50%, 0)`,
        width: `${baseSize}px`,
        height: `${baseSize}px`,
        borderRadius: '50%',
        backgroundColor: cursorColor,
        opacity: isHovering ? 0.35 : 0.85,
        transformOrigin: 'center center',
        scale: scale,
        pointerEvents: 'none',
        zIndex: 99999,
        transition: 'transform 0.08s ease-out, scale 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 0.2s ease',
        willChange: 'transform, scale',
        ...props.style,
      }}
    />
  );
}

export default withResponsiveProps(CustomCursor);
