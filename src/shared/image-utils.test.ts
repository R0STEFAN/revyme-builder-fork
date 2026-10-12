import { describe, it, expect } from 'vitest';
import { inferImageSizes, getUploadSrcSet } from './image-utils';

describe('inferImageSizes', () => {
  it('returns exact px for small fixed width (<= 320px)', () => {
    expect(inferImageSizes({ width: '145px' })).toBe('145px');
    expect(inferImageSizes({ width: 145 })).toBe('145px');
    expect(inferImageSizes({ width: '320px' })).toBe('320px');
    expect(inferImageSizes({ width: 48 })).toBe('48px');
  });

  it('returns responsive media query for larger fixed width (> 320px)', () => {
    expect(inferImageSizes({ width: '600px' })).toBe('(max-width: 600px) 100vw, 600px');
    expect(inferImageSizes({ width: 800 })).toBe('(max-width: 800px) 100vw, 800px');
    expect(inferImageSizes({ width: '1200px' })).toBe('(max-width: 1200px) 100vw, 1200px');
  });

  it('infers from maxWidth when width is not fixed px', () => {
    expect(inferImageSizes({ width: '100%', maxWidth: '300px' })).toBe('300px');
    expect(inferImageSizes({ width: '100%', maxWidth: '800px' })).toBe('(max-width: 800px) 100vw, 800px');
    expect(inferImageSizes({ maxWidth: 200 })).toBe('200px');
  });

  it('infers from percentage width', () => {
    expect(inferImageSizes({ width: '50%' })).toBe('(max-width: 768px) 100vw, 50vw');
    expect(inferImageSizes({ width: '33.3%' })).toBe('(max-width: 768px) 100vw, 33vw');
    expect(inferImageSizes({ width: '25%' })).toBe('(max-width: 768px) 100vw, 25vw');
  });

  it('falls back to 100vw for 100%, 100vw, or unprovided width', () => {
    expect(inferImageSizes({ width: '100%' })).toBe('100vw');
    expect(inferImageSizes({ width: '100vw' })).toBe('100vw');
    expect(inferImageSizes({})).toBe('100vw');
    expect(inferImageSizes(null)).toBe('100vw');
    expect(inferImageSizes()).toBe('100vw');
  });
});

describe('getUploadSrcSet', () => {
  it('returns full srcset for upload paths', () => {
    const srcset = getUploadSrcSet('/api/uploads/photo.webp');
    expect(srcset).toBeDefined();
    expect(srcset).toContain('/api/uploads/photo-320w.webp 320w');
    expect(srcset).toContain('/api/uploads/photo-1920w.webp 1920w');
  });

  it('returns undefined for non-upload paths', () => {
    expect(getUploadSrcSet('https://example.com/photo.jpg')).toBeUndefined();
    expect(getUploadSrcSet('')).toBeUndefined();
    expect(getUploadSrcSet(null)).toBeUndefined();
  });
});
