import { describe, it, expect } from 'vitest';
import { extractUploadFilenames, extractPublicAssetPaths, canExportFormat } from './export-project';

describe('canExportFormat', () => {
  it('allows source and source-ssg formats in standalone mode', () => {
    expect(canExportFormat('source')).toBe(true);
    expect(canExportFormat('source-ssg')).toBe(true);
  });
});

describe('extractPublicAssetPaths', () => {
  it('extracts fonts and images referenced in CSS or JSX', () => {
    const files = [
      "@font-face { src: url('/fonts/CompactaMobsters.woff2'); }",
      '<img src="/images/hero.webp" />',
      'const bg = "/images/pattern.png?v=2";',
      'plain text without assets',
    ];
    const result = extractPublicAssetPaths(files);
    expect(result.sort()).toEqual(['fonts/CompactaMobsters.woff2', 'images/hero.webp', 'images/pattern.png'].sort());
  });

  it('returns empty array when no fonts or images are referenced', () => {
    expect(extractPublicAssetPaths(['<div>Hello</div>'])).toEqual([]);
  });
});

describe('extractUploadFilenames', () => {
  it('extracts unique upload filenames from code strings', () => {
    const files = [
      '<div style="background-image:url(/api/uploads/photo1.webp); background:url(/uploads/photo2.png)"></div>',
      'const img = "/api/uploads/photo1.webp"; const banner = "/api/uploads/banner.jpg?v=1#hash";',
      '<img src="/uploads/avatar.svg" />',
      'plain text without uploads',
    ];

    const result = extractUploadFilenames(files);
    expect(result.sort()).toEqual(['avatar.svg', 'banner.jpg', 'photo1.webp', 'photo2.png'].sort());
  });

  it('returns empty array when no uploads are referenced', () => {
    const files = [
      '<div>Hello world</div>',
      'const x = 42;',
    ];
    expect(extractUploadFilenames(files)).toEqual([]);
  });
});
