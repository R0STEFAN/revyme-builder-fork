// RollingText — Code component template (staggered letter roll-up animation on hover).
//
// Each character is split into a double-row container (primary and incoming duplicate).
// On hover (either directly on the component or on an enclosing button/link/container),
// characters animate vertically upwards (-100%) with a progressive stagger delay.
// Features customizable typography, animation speed, duration, and easing curves.

export const ROLLING_TEXT_COMPONENT = `'use client';

/** @label "Rolling Text" */
/** @comment "Staggered letter roll-up animation on hover with configurable easing, speed, and typography." */
/** @defaultWidth 180 */
/** @defaultHeight 40 */
/** @controls {
  "text": { "type": "text", "label": "Text", "default": "Rolling Text" },
  "color": { "type": "color", "label": "Text Color", "default": "#f2f2f2" },
  "fontSize": { "type": "number", "label": "Font Size", "min": 10, "max": 160, "step": 1, "default": 16, "unit": "px" },
  "fontWeight": { "type": "select", "label": "Weight", "default": "500", "options": [{"label":"Regular (400)","value":"400"},{"label":"Medium (500)","value":"500"},{"label":"Semi Bold (600)","value":"600"},{"label":"Bold (700)","value":"700"},{"label":"Black (900)","value":"900"}] },
  "fontFamily": { "type": "select", "label": "Font Family", "default": "inherit", "options": [{"label":"Inherit (Parent)","value":"inherit"},{"label":"Inter","value":"Inter, sans-serif"},{"label":"Geist Sans","value":"var(--font-geist-sans), sans-serif"},{"label":"System Sans","value":"system-ui, -apple-system, sans-serif"},{"label":"Playfair (Serif)","value":"'Playfair Display', Georgia, serif"},{"label":"Space Grotesk","value":"'Space Grotesk', sans-serif"},{"label":"Monospace","value":"ui-monospace, monospace"}] },
  "duration": { "type": "number", "label": "Duration", "min": 0.1, "max": 2, "step": 0.05, "default": 0.35, "unit": "s" },
  "stagger": { "type": "number", "label": "Stagger Delay", "min": 0.005, "max": 0.15, "step": 0.005, "default": 0.025, "unit": "s" },
  "easing": { "type": "select", "label": "Easing", "default": "cubic", "options": [{"label":"Smooth (Cubic)","value":"cubic"},{"label":"Overshoot (Back Out)","value":"backOut"},{"label":"Anticipate","value":"anticipate"},{"label":"Ease Out","value":"easeOut"},{"label":"Ease In-Out","value":"easeInOut"},{"label":"Spring (Bouncy)","value":"spring"}] }
} */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

const EASING_MAP: Record<string, any> = {
  cubic: [0.33, 1, 0.68, 1],
  backOut: [0.34, 1.56, 0.64, 1],
  anticipate: 'anticipate',
  easeOut: 'easeOut',
  easeInOut: 'easeInOut',
};

function RollingText({
  text = 'Rolling Text',
  color = '#f2f2f2',
  fontSize = 16,
  fontWeight = '500',
  fontFamily = 'inherit',
  duration = 0.35,
  stagger = 0.025,
  easing = 'cubic',
  style,
  ...props
}: {
  text?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  duration?: number;
  stagger?: number;
  easing?: string;
  style?: React.CSSProperties;
  [key: string]: any;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const trigger = el.closest('[data-hover-trigger], button, a') || el;
    const onEnter = () => setIsHovered(true);
    const onLeave = () => setIsHovered(false);
    trigger.addEventListener('mouseenter', onEnter);
    trigger.addEventListener('mouseleave', onLeave);
    return () => {
      trigger.removeEventListener('mouseenter', onEnter);
      trigger.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const chars = String(text ?? '').split('');

  const transitionConfig = easing === 'spring'
    ? (i: number) => ({ type: 'spring', stiffness: 380, damping: 24, delay: i * stagger })
    : (i: number) => ({ duration, ease: EASING_MAP[easing] ?? [0.33, 1, 0.68, 1], delay: i * stagger });

  return (
    <div
      ref={containerRef}
      data-id={props['data-id'] ?? 'rolling-text-root'}
      data-name={props['data-name'] ?? 'Rolling Text'}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        lineHeight: 1.1,
        fontSize: \`\${fontSize}px\`,
        fontWeight,
        fontFamily,
        color,
        cursor: 'pointer',
        ...style,
      }}
    >
      {chars.map((char, i) => (
        <span
          key={i}
          data-id={\`rolling-char-\${i}\`}
          style={{
            position: 'relative',
            display: 'inline-flex',
            flexDirection: 'column',
            overflow: 'hidden',
            whiteSpace: 'pre',
          }}
        >
          <motion.span
            animate={{ y: isHovered ? '-100%' : '0%' }}
            transition={transitionConfig(i)}
            style={{ display: 'inline-block' }}
          >
            {char}
          </motion.span>
          <motion.span
            animate={{ y: isHovered ? '-100%' : '0%' }}
            transition={transitionConfig(i)}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              display: 'inline-block',
            }}
          >
            {char}
          </motion.span>
        </span>
      ))}
    </div>
  );
}

export default withResponsiveProps(RollingText);
`;
