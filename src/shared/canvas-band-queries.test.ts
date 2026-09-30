import { describe, it, expect } from 'vitest';
import { mediaToCanvasContainer, drawnTileRange } from './canvas-band-queries';

const band = (q: string) => `@media ${q} {\n  [data-id="a"] { color: red !important; }\n}`;
const head = (css: string) => /@container ([^{]*?) \{/.exec(css)?.[1];

describe('mediaToCanvasContainer', () => {
  it('without drawn widths: the plain @media → @container rename', () => {
    expect(mediaToCanvasContainer(band('(max-width: 768px)'))).toBe(band('(max-width: 768px)').replace('@media', '@container'));
  });

  it('start-model page: each band tops out at its tile’s drawn width', () => {
    // 1440 / 768 / 375 drawn; stored ends 1439 / 767 (tablet 768–1439, mobile < 768).
    const drawn = [1440, 768, 375];
    expect(head(mediaToCanvasContainer(band('(max-width: 1439px) and (min-width: 767.02px)'), drawn))).toBe('(max-width: 768px) and (min-width: 375.02px)');
    expect(head(mediaToCanvasContainer(band('(max-width: 767px)'), drawn))).toBe('(max-width: 375px)');
  });

  it('a cascading band covering several tiles collapses to one contiguous range', () => {
    expect(head(mediaToCanvasContainer(band('(max-width: 1439px)'), [1440, 1200, 768, 375]))).toBe('(max-width: 1200px)');
  });

  it('non-contiguous tiles comma-join; the widest tile has no max, the smallest no min', () => {
    expect(head(mediaToCanvasContainer(band('(min-width: 1300px), (max-width: 400px)'), [1440, 768, 375]))).toBe('(min-width: 768.02px), (max-width: 375px)');
  });

  it('a band no tile paints never matches on the canvas', () => {
    expect(head(mediaToCanvasContainer(band('(max-width: 200px)'), [1440, 768, 375]))).toBe('not (min-width: 0px)');
  });

  it('a template band on a page with a different ladder follows the page tiles’ drawn widths', () => {
    // Template tablet 768–1439 on page tiles 1440 / 810 / 390 → the 810 tile.
    expect(head(mediaToCanvasContainer(band('(max-width: 1439px) and (min-width: 767.02px)'), [1440, 810, 390]))).toBe('(max-width: 810px) and (min-width: 390.02px)');
  });

  it('leaves non-width queries exactly as the plain rename does', () => {
    const css = `@media (orientation: portrait) { a { color: red; } }\n@media screen and (max-width: 500px) { b { color: red; } }`;
    expect(mediaToCanvasContainer(css, [1440, 768])).toBe(css.replace('@media (', '@container ('));
  });

  it('keeps every body byte-identical and in order', () => {
    const css = `${band('(max-width: 1439px) and (min-width: 767.02px)')}\n${band('(max-width: 767px)')}`;
    const out = mediaToCanvasContainer(css, [1440, 768, 375]);
    expect(out.replace(/@container [^{]*\{/g, '')).toBe(css.replace(/@media [^{]*\{/g, ''));
  });
});

describe('drawnTileRange', () => {
  it('tops out at the tile’s width and floors above the next-smaller tile', () => {
    expect(drawnTileRange(768, [1440, 768, 375])).toBe('(max-width: 768px) and (min-width: 375.02px)');
    expect(drawnTileRange(1440, [1440, 768, 375])).toBe('(min-width: 768.02px)');
    expect(drawnTileRange(375, [1440, 768, 375])).toBe('(max-width: 375px)');
    expect(drawnTileRange(1440, [1440])).toBe('(min-width: 0px)');
  });
});
