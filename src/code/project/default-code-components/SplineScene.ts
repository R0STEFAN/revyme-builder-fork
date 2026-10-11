// SplineScene — Code component template (Spline runtime 3D scene viewer).

export const SPLINE_SCENE_COMPONENT = `'use client';

/** @label "Spline Scene" */
/** @comment "Embed an interactive Spline 3D scene" */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "sceneUrl": { "type": "text", "label": "Scene URL", "default": "" }
} */

import { useState, useEffect, useRef } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function SplineScene({ sceneUrl = '', ...props }) {
  const canvasRef = useRef(null);
  const appRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!sceneUrl || !canvasRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadScene() {
      try {
        const { Application } = await import('@splinetool/runtime');
        if (cancelled) return;
        const app = new Application(canvasRef.current);
        await app.load(sceneUrl);
        if (cancelled) {
          try { app.dispose(); } catch {}
          return;
        }
        appRef.current = app;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load Spline scene');
          setLoading(false);
        }
      }
    }

    loadScene();
    return () => {
      cancelled = true;
      if (appRef.current) {
        try { appRef.current.dispose(); } catch {}
      }
      appRef.current = null;
    };
  }, [sceneUrl, retryNonce]);

  return (
    <div data-id={props['data-id']} data-name={props['data-name']}
         style={{ position: 'relative', overflow: 'hidden', ...props.style }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', display: 'block' }} />
      {loading && (
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12}}>
          Loading scene...
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#f87171',
          fontSize: 12,
          gap: 8,
          backgroundColor: 'rgba(0, 0, 0, 0.4)'
        }}>
          <span>{error}</span>
          <button
            onClick={() => setRetryNonce(n => n + 1)}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              borderRadius: 4,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export default withResponsiveProps(SplineScene);
`;
