// ImageSequence — Code component template (scroll-driven frame-by-frame animation).

export const IMAGE_SEQUENCE_COMPONENT = `'use client';

/** @label "Image Sequence" */
/** @comment "Scroll-driven frame-by-frame animation from uploaded image sequence" */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "folder": { "type": "upload", "label": "Frames", "default": "", "accept": "image/*", "multiple": true, "uploadSource": "sequence" },
  "totalFrames": { "type": "number", "label": "Total Frames", "min": 1, "max": 9999, "default": 60, "step": 1 },
  "frame": { "type": "number", "label": "Current Frame", "min": 0, "max": 299, "default": 0, "step": 1 },
  "fit": { "type": "select", "label": "Fit", "default": "contain", "options": [{"label":"Contain","value":"contain"},{"label":"Cover","value":"cover"},{"label":"Fill","value":"fill"}] },
  "scrollDriven": { "type": "toggle", "label": "Scroll Drive", "default": false }
} */

import { useState, useEffect, useRef } from 'react';
import { withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

function ImageSequence({ folder = '/frames', totalFrames = 60, frame = 0, fit = 'contain', scrollDriven = false, ...props }) {
  const canvasRef = useRef(null);
  const imagesRef = useRef([]);
  const revisionRef = useRef(0);
  const currentFrameRef = useRef(frame);
  const drawRef = useRef(null);
  const scrollSelectRef = useRef(null);
  const isStatic = useStaticCanvas();
  const [status, setStatus] = useState(folder ? 'loading' : 'empty');

  // An explicit data-frame wins over scroll, which wins over the frame prop.
  function dataFrameIndex() {
    const value = canvasRef.current?.parentElement?.getAttribute('data-frame');
    if (value == null) return null;
    const index = parseInt(value, 10);
    return isNaN(index) ? null : index;
  }

  // Every input path, including resize and scroll, paints through this function.
  drawRef.current = (requestedIndex = currentFrameRef.current) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = Math.max(0, Math.round(canvas.offsetWidth * (window.devicePixelRatio || 1)));
    const height = Math.max(0, Math.round(canvas.offsetHeight * (window.devicePixelRatio || 1)));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    const images = imagesRef.current;
    const index = Math.max(0, Math.min(Math.round(requestedIndex) || 0, images.length - 1));
    // Missing frames fall back to the nearest available frame.
    let image = images[index];
    if (!image?.complete || !image.naturalWidth) {
      image = images.find((candidate) => candidate.complete && candidate.naturalWidth > 0);
    }
    if (!image) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    let dx = 0, dy = 0, dw = width, dh = height;
    if (fit === 'contain' || fit === 'cover') {
      if ((fit === 'contain' && ratio > width / height) || (fit === 'cover' && ratio < width / height)) {
        dh = width / ratio;
        dy = (height - dh) / 2;
      } else {
        dw = height * ratio;
        dx = (width - dw) / 2;
      }
    }
    ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, dx, dy, dw, dh);
  };

  useEffect(() => {
    const revision = ++revisionRef.current;
    const input = typeof folder === 'string' ? folder.trim() : folder;
    const explicit = Array.isArray(input) ? input.filter(Boolean)
      : typeof input === 'string' && input.includes('|') ? input.split('|').map((url) => url.trim()).filter(Boolean)
      : typeof input === 'string' && (/^(https?:|data:|blob:)/i.test(input) || /[.](png|jpe?g|webp|gif|avif|svg)([?#].*)?$/i.test(input)) ? [input]
      : null;
    const urls = explicit || (input ? Array.from({ length: Math.max(0, Math.floor(totalFrames)) }, (_, i) =>
      (input.endsWith('/') ? input.slice(0, -1) : input) + '/frame-' + String(i + 1).padStart(3, '0') + '.webp') : []);
    const images = urls.map(() => new Image());
    imagesRef.current = images;
    currentFrameRef.current = dataFrameIndex() ?? frame;
    setStatus(urls.length ? 'loading' : 'empty');
    drawRef.current?.();
    if (!urls.length) return () => { revisionRef.current++; };
    let completed = 0;
    let successful = 0;
    let staticPainted = false;
    images.forEach((image, index) => {
      const finish = (ok) => {
        if (revisionRef.current !== revision) return;
        completed++;
        if (ok) successful++;
        if (isStatic) {
          if (ok && !staticPainted) {
            staticPainted = true;
            drawRef.current?.(index);
          }
        } else drawRef.current?.();
        if (completed === images.length) setStatus(successful ? 'ready' : 'error');
      };
      // Cached images may fire during src assignment.
      image.onload = () => finish(image.naturalWidth > 0);
      image.onerror = () => finish(false);
      image.src = urls[index];
    });
    return () => {
      revisionRef.current++;
      images.forEach((image) => { image.onload = null; image.onerror = null; });
    };
  }, [folder, totalFrames, isStatic]);

  useEffect(() => {
    const explicitFrame = dataFrameIndex();
    if (explicitFrame != null) currentFrameRef.current = explicitFrame;
    else if (scrollDriven && !isStatic && scrollSelectRef.current) { scrollSelectRef.current(); return; }
    else if (!scrollDriven || isStatic) currentFrameRef.current = frame;
    drawRef.current?.();
  }, [frame, scrollDriven, isStatic]);

  useEffect(() => { drawRef.current?.(); }, [fit]);

  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => drawRef.current?.());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const observer = new MutationObserver(() => {
      const explicitFrame = dataFrameIndex();
      if (explicitFrame != null) currentFrameRef.current = explicitFrame;
      else if (scrollDriven && !isStatic && scrollSelectRef.current) { scrollSelectRef.current(); return; }
      else currentFrameRef.current = frame;
      drawRef.current?.();
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-frame'] });
    return () => observer.disconnect();
  }, [frame, scrollDriven, isStatic]);

  useEffect(() => {
    if (!scrollDriven || isStatic || status !== 'ready' || imagesRef.current.length === 0) return;
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const explicitFrame = dataFrameIndex();
      if (explicitFrame != null) {
        currentFrameRef.current = explicitFrame;
        drawRef.current?.();
        return;
      }
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const total = rect.height + vh;
      const progress = Math.min(1, Math.max(0, (vh - rect.top) / total));
      const idx = Math.round(progress * (imagesRef.current.length - 1));
      currentFrameRef.current = idx;
      drawRef.current?.();
    };
    scrollSelectRef.current = draw;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(draw); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (scrollSelectRef.current === draw) scrollSelectRef.current = null;
    };
  }, [scrollDriven, status, isStatic]);

  return (
    <div data-id={props['data-id']} data-name={props['data-name']} style={{ position: 'relative', overflow: 'hidden', ...props.style }}>
      <canvas ref={canvasRef} style={{position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', display: 'block'}} />
      {(status === 'loading' || status === 'error') && (
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12}}>
          {status === 'error' ? 'Failed to load frames' : 'Loading frames...'}
        </div>
      )}
    </div>
  );
}

export default withResponsiveProps(ImageSequence);
`;
