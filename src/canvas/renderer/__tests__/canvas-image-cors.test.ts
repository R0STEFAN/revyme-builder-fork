// Permanent regression suite for canvas image preview URL parsing and CORS degradation.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldPreviewUrl,
  edgeResizeUrl,
  isPreviewAppliedSrc,
  initCanvasImagePreview,
  unreadableOrigins,
  clearPreviewCache,
  ensurePreview,
  buildPreview,
} from '../canvas-image-preview';

describe('canvas image preview: URL filtering and edge routing', () => {
  it('excludes external headless CMS image URLs from client downscale previewing', () => {
    const url = 'https://api.tattoozp.com/assets/436f6e77-e4d1-451d-9a71-0b2a9e4c2588?width=500&quality=80';
    expect(shouldPreviewUrl(url)).toBe(false);
    expect(edgeResizeUrl(url)).toBeNull();
  });

  it('rejects data, blob, cdn-cgi, svg, and gif URLs from preview candidate filtering', () => {
    expect(shouldPreviewUrl('')).toBe(false);
    expect(shouldPreviewUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(shouldPreviewUrl('blob:http://localhost:5173/uuid-test')).toBe(false);
    expect(shouldPreviewUrl('https://revyme.app/cdn-cgi/image/width=100/test.png')).toBe(false);
    expect(shouldPreviewUrl('https://api.example.com/vector.svg')).toBe(false);
    expect(shouldPreviewUrl('https://api.example.com/vector.svg?v=1')).toBe(false);
    expect(shouldPreviewUrl('https://api.example.com/animation.gif')).toBe(false);
    expect(shouldPreviewUrl('https://api.example.com/animation.gif#frame')).toBe(false);
  });

  it('routes revyme.app images through the zone edge resizer', () => {
    const url = 'https://assets.revyme.app/uploads/hero.jpg';
    expect(shouldPreviewUrl(url)).toBe(true);
    const edge = edgeResizeUrl(url);
    expect(edge).not.toBeNull();
    expect(edge).toContain('/cdn-cgi/image/');
    expect(edge).toContain('assets.revyme.app');
  });

  it('allows relative and same-origin media library assets into preview candidate filtering', () => {
    expect(shouldPreviewUrl('/api/uploads/photo.jpg')).toBe(true);
    expect(shouldPreviewUrl('./local-asset.png')).toBe(true);
    expect(shouldPreviewUrl(`${window.location.origin}/uploads/banner.jpg`)).toBe(true);
  });
});

describe('canvas image preview: CORS degradation and external API bypass', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearPreviewCache();
    // Simulate browser CORS failure when fetching cross-origin assets without ACAO
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (CORS header missing)'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('preserves the original image src and does not attempt fetch for external API assets', async () => {
    const container = document.createElement('div');
    const img = document.createElement('img');
    const directusUrl = 'https://api.tattoozp.com/assets/436f6e77-e4d1-451d-9a71-0b2a9e4c2588?width=500&quality=80';
    img.src = directusUrl;
    img.style.width = '300px';
    img.style.height = '200px';
    container.appendChild(img);

    expect(() => initCanvasImagePreview(container)).not.toThrow();
    // Allow any pending microtasks/promises to resolve
    await new Promise(r => setTimeout(r, 10));

    expect(img.getAttribute('src')).toBe(directusUrl);
    expect(img.dataset.cipSrcset).toBeUndefined();
    expect(isPreviewAppliedSrc(img, directusUrl)).toBe(false);
    // Verified: external API asset is NOT fetched by client-side previewer, eliminating CORS console errors!
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('records failing zone origin in negative cache and avoids subsequent fetches for that origin', async () => {
    const url1 = 'https://assets.revyme.app/assets/img-1.jpg';
    const res1 = await buildPreview(url1);
    expect(res1).toBeNull();
    expect(unreadableOrigins.has('https://assets.revyme.app')).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Second image from the same unreadable origin
    const url2 = 'https://assets.revyme.app/assets/img-2.jpg';
    const res2 = await buildPreview(url2);
    expect(res2).toBeNull();
    // Fetch should still have been called only once because url2 was skipped by unreadableOrigins
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not negative-cache window.location.origin even if a fetch error occurs', async () => {
    const appUrl = `${window.location.origin}/test-image.jpg`;
    const res = await ensurePreview(appUrl);
    expect(res).toBeNull();
    expect(unreadableOrigins.has(window.location.origin)).toBe(false);
  });
});
