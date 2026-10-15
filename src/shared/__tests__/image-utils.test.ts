import { describe, it, expect } from 'vitest';
import { getCmsImageSrcSet, isSignedImageUrl } from '../image-utils';
import type { CmsImageOptimizationConfig } from '@/code/project/cms-api-config';

describe('getCmsImageSrcSet', () => {
  const directusConfig: CmsImageOptimizationConfig = {
    enabled: true,
    engine: 'directus',
    quality: 80,
    format: 'webp',
    widths: [320, 640, 1024],
  };

  it('transforms Directus asset URL into responsive srcSet while preserving existing query params', () => {
    const src = 'https://api.example.com/assets/abc-123?access_token=secret123';
    const srcSet = getCmsImageSrcSet(src, directusConfig);
    expect(srcSet).toBe(
      'https://api.example.com/assets/abc-123?access_token=secret123&width=320&quality=80&format=webp 320w, ' +
      'https://api.example.com/assets/abc-123?access_token=secret123&width=640&quality=80&format=webp 640w, ' +
      'https://api.example.com/assets/abc-123?access_token=secret123&width=1024&quality=80&format=webp 1024w'
    );
  });

  it('bypasses transformation and returns undefined for cryptographically signed URLs', () => {
    const signedS3 = 'https://s3.amazonaws.com/bucket/image.png?X-Amz-Signature=abcd1234efgh';
    const signedCloudinary = 'https://res.cloudinary.com/demo/image/upload/s--abc123--/v1/sample.jpg';
    const signedGeneric = 'https://cdn.example.com/image.jpg?sig=xyz789';

    expect(isSignedImageUrl(signedS3)).toBe(true);
    expect(isSignedImageUrl(signedCloudinary)).toBe(true);
    expect(isSignedImageUrl(signedGeneric)).toBe(true);

    expect(getCmsImageSrcSet(signedS3, directusConfig)).toBeUndefined();
    expect(getCmsImageSrcSet(signedGeneric, directusConfig)).toBeUndefined();
  });

  it('returns undefined if optimization is disabled or src is empty', () => {
    expect(getCmsImageSrcSet('https://api.example.com/assets/abc-123', { ...directusConfig, enabled: false })).toBeUndefined();
    expect(getCmsImageSrcSet('', directusConfig)).toBeUndefined();
  });
});
