'use client';

/** @label "Brutalist Radar Matrix" */
/** @comment "Real-time enterprise cognition telemetry radar with coordinate tracking and signal waves" */
/** @defaultWidth 500 */
/** @defaultHeight 360 */
/** @controls {
  "gridDensity": { "type": "number", "label": "Grid Density", "min": 4, "max": 16, "default": 8 },
  "accentColor": { "type": "color", "label": "Accent Color", "default": "#d1ffca" },
  "speed": { "type": "number", "label": "Scan Speed", "min": 0.5, "max": 3, "default": 1 },
  "showMetrics": { "type": "toggle", "label": "Show Metrics", "default": true }
} */

import React, { useEffect, useRef, useState } from 'react';
import { withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

interface RadarProps {
  gridDensity?: number;
  accentColor?: string;
  speed?: number;
  showMetrics?: boolean;
  style?: React.CSSProperties;
}

function BrutalistRadarMatrix({
  gridDensity = 8,
  accentColor = '#d1ffca',
  speed = 1,
  showMetrics = true,
  style,
}: RadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [coords, setCoords] = useState({ x: 240, y: 180 });
  const isStatic = useStaticCanvas();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let angle = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) {
        if (!isStatic) animId = requestAnimationFrame(render);
        return;
      }

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 1;
      const step = Math.max(20, width / gridDensity);
      for (let x = 0; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.min(width, height) * 0.44;

      ctx.strokeStyle = '#333333';
      for (let r = step; r <= maxR; r += step) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      angle += 0.02 * speed;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, angle, angle + 0.5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(209, 255, 202, 0.12)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle + 0.5) * maxR, cy + Math.sin(angle + 0.5) * maxR);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      const blips = [
        { r: maxR * 0.35, a: 1.2, label: 'ERP.SYNC // 0.4ms' },
        { r: maxR * 0.65, a: 3.4, label: 'LEDGER // 0.9ms' },
        { r: maxR * 0.85, a: 5.1, label: 'ORACLE.DB // 1.2ms' },
      ];

      blips.forEach((b) => {
        const bx = cx + Math.cos(b.a) * b.r;
        const by = cy + Math.sin(b.a) * b.r;
        ctx.fillStyle = '#fff100';
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff100';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.stroke();

        if (showMetrics) {
          ctx.fillStyle = '#979797';
          ctx.font = '10px monospace';
          ctx.fillText(b.label, bx + 12, by + 4);
        }
      });

      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 15, cy);
      ctx.lineTo(cx + 15, cy);
      ctx.moveTo(cx, cy - 15);
      ctx.lineTo(cx, cy + 15);
      ctx.stroke();

      if (!isStatic) {
        animId = requestAnimationFrame(render);
      }
    };

    if (isStatic) {
      render();
      return;
    }

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [gridDensity, accentColor, speed, showMetrics, isStatic]);

  return (
    <div
      data-id="radar-matrix-root"
      style={{
        position: 'relative',
        width: '100%',
        height: '360px',
        backgroundColor: '#000000',
        borderRadius: '24px',
        overflow: 'hidden',
        border: '1px solid #2f2f2f',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setCoords({
          x: Math.round(e.clientX - rect.left),
          y: Math.round(e.clientY - rect.top),
        });
      }}
    >
      <div
        data-id="radar-matrix-header"
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderBottom: '1px solid #1a1a1a',
          backgroundColor: '#050505',
          order: '0',
          flex: '0 0 auto',
        }}
      >
        <span
          data-id="radar-matrix-title"
          style={{
            position: 'relative',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            color: '#d1ffca',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          ● COGNITION FABRIC TELEMETRY
        </span>
        <span
          data-id="radar-matrix-coords"
          style={{
            position: 'relative',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            color: '#979797',
          }}
        >
          CURSOR [X:{coords.x} Y:{coords.y}] LATENCY: 0.8ms
        </span>
      </div>
      <div
        data-id="radar-canvas-container"
        style={{
          position: 'relative',
          flex: '1 1 auto',
          width: '100%',
          height: '100%',
          order: '1',
        }}
      >
        <canvas
          data-id="radar-canvas-el"
          ref={canvasRef}
          width={600}
          height={300}
          style={{
            position: 'absolute',
            top: '0px',
            left: '0px',
            width: '100%',
            height: '100%',
          }}
        />
      </div>
    </div>
  );
}

export default withResponsiveProps(BrutalistRadarMatrix);