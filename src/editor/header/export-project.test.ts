import { describe, it, expect } from 'vitest';
import { extractUploadFilenames } from './export-project';

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
