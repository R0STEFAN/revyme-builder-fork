// image-utils.ts — Helpers for responsive image srcSet and sizes generation across editor and exported runtime.

export const RESPONSIVE_IMAGE_WIDTHS = [320, 640, 768, 1024, 1280, 1920] as const;

export interface InferImageSizesOptions {
  width?: string | number | null;
  maxWidth?: string | number | null;
}

/**
 * Calculate the optimal `sizes` attribute based on element width or maxWidth.
 *
 * Rules:
 * - If width <= 320px (e.g. 145px thumbnail): returns `${width}px` (e.g. "145px").
 * - If width > 320px (e.g. 600px): returns `(max-width: ${width}px) 100vw, ${width}px`.
 * - If maxWidth is specified and <= 320px: returns `${maxWidth}px`.
 * - If maxWidth is specified and > 320px: returns `(max-width: ${maxWidth}px) 100vw, ${maxWidth}px`.
 * - If width is a percentage < 100% (e.g. 50%): returns `(max-width: 768px) 100vw, 50vw`.
 * - Fallback / full width: returns "100vw".
 */
export function inferImageSizes(options?: InferImageSizesOptions | null): string {
  if (!options) return '100vw';

  const parsePx = (val: string | number | null | undefined): number | null => {
    if (typeof val === 'number') return val > 0 ? val : null;
    if (typeof val === 'string') {
      const match = val.trim().match(/^(\d+(?:\.\d+)?)\s*px$/i);
      if (match) {
        const n = parseFloat(match[1]);
        return n > 0 ? Math.round(n) : null;
      }
      if (/^\d+(?:\.\d+)?$/.test(val.trim())) {
        const n = parseFloat(val.trim());
        return n > 0 ? Math.round(n) : null;
      }
    }
    return null;
  };

  const widthPx = parsePx(options.width);
  const maxWidthPx = parsePx(options.maxWidth);

  if (widthPx !== null) {
    if (widthPx <= 320) return `${widthPx}px`;
    return `(max-width: ${widthPx}px) 100vw, ${widthPx}px`;
  }

  if (maxWidthPx !== null) {
    if (maxWidthPx <= 320) return `${maxWidthPx}px`;
    return `(max-width: ${maxWidthPx}px) 100vw, ${maxWidthPx}px`;
  }

  if (typeof options.width === 'string') {
    const trimmed = options.width.trim();
    const percentMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (percentMatch) {
      const pct = parseFloat(percentMatch[1]);
      if (pct > 0 && pct < 100) {
        const vwVal = Math.round(pct);
        return `(max-width: 768px) 100vw, ${vwVal}vw`;
      }
    }
    const vwMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*vw$/i);
    if (vwMatch) {
      const vw = parseFloat(vwMatch[1]);
      if (vw > 0 && vw < 100) {
        const vwVal = Math.round(vw);
        return `(max-width: 768px) 100vw, ${vwVal}vw`;
      }
    }
  }

  return '100vw';
}

/**
 * Generate responsive srcSet for image URLs hosted in uploads (/uploads/ or /api/uploads/).
 * Returns undefined for non-upload or non-string sources.
 */
export function getUploadSrcSet(src: string | undefined | null): string | undefined {
  if (!src || typeof src !== 'string') return undefined;
  if (!src.startsWith('/uploads/') && !src.startsWith('/api/uploads/')) return undefined;
  const clean = src.split('?')[0].split('#')[0];
  const lastDot = clean.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  const basePath = clean.slice(0, lastDot);
  return RESPONSIVE_IMAGE_WIDTHS.map((w) => `${basePath}-${w}w.webp ${w}w`).join(', ');
}
