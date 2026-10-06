'use client';

/** @label "Marquee Ticker" */
/** @comment "Smooth continuous infinite horizontal marquee ticker" */
/** @controls {
  "text": { "type": "text", "label": "Ticker Text", "default": "СТВОРЮЮ ВІЗУАЛЬНИЙ ІМПАКТ /// ВЕБ ДИЗАЙН & РОЗРОБКА /// UI/UX ДИЗАЙН /// КРЕАТИВНИЙ КОД /// " },
  "speed": { "type": "number", "label": "Scroll Speed (seconds)", "min": 5, "max": 60, "default": 20 },
  "textColor": { "type": "color", "label": "Text Color", "default": "#09090b" },
  "fontSize": { "type": "number", "label": "Font Size (px)", "min": 18, "max": 96, "default": 48 },
  "bgColor": { "type": "color", "label": "Background Color", "default": "#ffffff" },
  "borderColor": { "type": "color", "label": "Border Color", "default": "rgba(0, 0, 0, 0.12)" }
} */

import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

interface MarqueeTickerProps {
  text?: string;
  speed?: number;
  textColor?: string;
  fontSize?: number;
  bgColor?: string;
  borderColor?: string;
  style?: React.CSSProperties;
}

function MarqueeTicker(props: MarqueeTickerProps) {
  const text = props.text || 'СТВОРЮЮ ВІЗУАЛЬНИЙ ІМПАКТ /// ВЕБ ДИЗАЙН & РОЗРОБКА /// UI/UX ДИЗАЙН /// КРЕАТИВНИЙ КОД /// ';
  const duration = props.speed || 20;
  const textColor = props.textColor || '#09090b';
  const fontSize = props.fontSize || 48;
  const bgColor = props.bgColor || '#ffffff';
  const borderColor = props.borderColor || 'rgba(0, 0, 0, 0.12)';

  return (
    <div
      data-id="marquee-ticker-container"
      style={{
        position: 'relative',
        width: '100%',
        overflow: 'hidden',
        backgroundColor: bgColor,
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        padding: '16px 0px',
        display: 'flex',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        boxSizing: 'border-box',
        ...props.style,
      }}
    >
      <style>{`
        @keyframes tickerMove {
          0% { transform: translate3d(0%, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .marquee-track-motion {
          display: flex;
          width: max-content;
          animation: tickerMove ${duration}s linear infinite;
        }
      `}</style>
      <div className="marquee-track-motion">
        <span
          style={{
            fontFamily: "'Unbounded', 'Impact', sans-serif",
            fontWeight: 800,
            fontSize: `${fontSize}px`,
            color: textColor,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            paddingRight: '32px',
          }}
        >
          {text} {text}
        </span>
        <span
          style={{
            fontFamily: "'Unbounded', 'Impact', sans-serif",
            fontWeight: 800,
            fontSize: `${fontSize}px`,
            color: textColor,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            paddingRight: '32px',
          }}
        >
          {text} {text}
        </span>
      </div>
    </div>
  );
}

export default withResponsiveProps(MarqueeTicker);
