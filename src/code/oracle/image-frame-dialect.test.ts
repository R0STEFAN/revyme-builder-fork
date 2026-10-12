import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn() } }));
import { checkFile } from './check-file';

const PAGE = (body: string) => `'use client';

/** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1440, "height": "auto", "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */

import React from 'react';

export default function Page() {
  return (
<div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%' }}>
${body}
</div>
  );
}`;

const im = (body: string) => checkFile(PAGE(body), { kind: 'page' }).filter((x) => x.code === 'IMAGE_USE_BACKGROUND_FRAME').length;

describe('images = backgroundImage frames or sized <img> elements', () => {
  it('a static-src <img> with data-id and valid sizing passes', () => {
    expect(im(`<img data-id="pic" data-name="Image" src="https://x.com/y.jpg" alt="" style={{ width: '100%', height: '200px', objectFit: 'cover' }} />`)).toBe(0);
  });
  it('<motion.img> with data-id and valid sizing passes', () => {
    expect(im(`<motion.img data-id="pic" data-name="Image" src="https://x.com/y.jpg" style={{ width: '100%', height: '200px' }} />`)).toBe(0);
  });
  it('a static-src <img> without data-id bounces', () => {
    expect(im(`<img src="https://x.com/y.jpg" alt="" style={{ width: '100%', height: '200px', objectFit: 'cover' }} />`)).toBe(1);
  });
  it('a static-src <img> with data-id but without sizing styles bounces', () => {
    expect(im(`<img data-id="pic" data-name="Image" src="https://x.com/y.jpg" alt="" />`)).toBe(1);
  });
  it('an expression src (CMS / dynamic) is EXEMPT', () => {
    expect(im(`<img data-id="pic" data-name="Image" src={item.image} alt="" style={{ width: '100%', height: '200px' }} />`)).toBe(0);
  });
  it('a backgroundImage Frame div passes', () => {
    expect(im(`<div data-id="pic" data-name="Image" style={{ width: '100%', height: '200px', backgroundImage: 'url(https://x.com/y.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />`)).toBe(0);
  });
  it('no image at all → not flagged', () => {
    expect(im(`<p data-id="t" data-name="Text" style={{ position: 'relative' }}>Hi</p>`)).toBe(0);
  });
});
