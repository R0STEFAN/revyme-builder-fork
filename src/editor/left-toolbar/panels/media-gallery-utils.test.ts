// media-gallery-utils.test.ts — pure logic behind the Media panel's delete +
// shift-sweep multi-select: key derivation, marquee hit-testing, edge
// auto-scroll velocity, and the confirm copy.

import { describe, it, expect } from 'vitest';
import {
  deriveUploadKey,
  keysInSweep,
  sweepAutoScrollStep,
  deleteConfirmMessage,
  rangeSelectKeys,
  toggleSelectAllKeys,
  getSelectionState,
  computeGridTileRects,
  type TileRect,
} from './media-gallery-utils';

describe('deriveUploadKey', () => {
  it('prefers the explicit R2 key when present', () => {
    expect(deriveUploadKey({ url: 'https://cdn.example.com/u1/site/images/uploaded/a.webp', key: 'u1/site/images/uploaded/a.webp' }))
      .toBe('u1/site/images/uploaded/a.webp');
  });

  it('falls back to the URL pathname (fresh uploads carry only the url)', () => {
    expect(deriveUploadKey({ url: 'https://cdn.example.com/u1/site/images/uploaded/b.webp' }))
      .toBe('u1/site/images/uploaded/b.webp');
  });

  it('extracts filename key from local /api/uploads/ URLs', () => {
    expect(deriveUploadKey({ url: '/api/uploads/photo1.webp' }))
      .toBe('photo1.webp');
    expect(deriveUploadKey({ url: '/api/uploads/photo2.jpg?v=123' }))
      .toBe('photo2.jpg');
  });

  it('returns null for standalone data:/blob: rows (nothing to delete)', () => {
    expect(deriveUploadKey({ url: 'data:image/png;base64,AAAA' })).toBeNull();
    expect(deriveUploadKey({ url: 'blob:http://localhost/xyz' })).toBeNull();
    expect(deriveUploadKey({ url: 'not a url' })).toBeNull();
  });
});

describe('keysInSweep', () => {
  // 2-column grid, 100×100 tiles with a 10px gap (content coords).
  const tiles: TileRect[] = [
    { key: 'a', left: 0,   top: 0,   right: 100, bottom: 100 },
    { key: 'b', left: 110, top: 0,   right: 210, bottom: 100 },
    { key: 'c', left: 0,   top: 110, right: 100, bottom: 210 },
    { key: 'd', left: 110, top: 110, right: 210, bottom: 210 },
  ];

  it('selects only tiles intersecting the marquee rect', () => {
    // Sweep down the LEFT column only.
    expect(keysInSweep(tiles, { x: 10, y: 10 }, { x: 60, y: 200 })).toEqual(['a', 'c']);
  });

  it('handles any drag direction (b above/left of a)', () => {
    expect(keysInSweep(tiles, { x: 200, y: 200 }, { x: 10, y: 10 }).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a sweep past the visible rows still hits tiles by content coords (auto-scroll case)', () => {
    // Anchor at the top, pointer effectively at y=1000 after scrolling.
    expect(keysInSweep(tiles, { x: 10, y: 0 }, { x: 20, y: 1000 })).toEqual(['a', 'c']);
  });

  it('empty when the rect touches nothing', () => {
    expect(keysInSweep(tiles, { x: 300, y: 300 }, { x: 400, y: 400 })).toEqual([]);
  });
});

describe('sweepAutoScrollStep', () => {
  const TOP = 100, BOTTOM = 500;

  it('zero in the middle of the container', () => {
    expect(sweepAutoScrollStep(300, TOP, BOTTOM)).toBe(0);
  });

  it('scrolls up near the top edge, faster the closer/past it', () => {
    const near = sweepAutoScrollStep(TOP + 20, TOP, BOTTOM);
    const at = sweepAutoScrollStep(TOP, TOP, BOTTOM);
    const past = sweepAutoScrollStep(TOP - 50, TOP, BOTTOM);
    expect(near).toBeLessThan(0);
    expect(at).toBeLessThanOrEqual(near);
    expect(past).toBe(-18); // capped at maxStep
  });

  it('scrolls down near the bottom edge, capped', () => {
    expect(sweepAutoScrollStep(BOTTOM - 10, TOP, BOTTOM)).toBeGreaterThan(0);
    expect(sweepAutoScrollStep(BOTTOM + 100, TOP, BOTTOM)).toBe(18);
  });
});

describe('deleteConfirmMessage', () => {
  it('single asset copy', () => {
    expect(deleteConfirmMessage(1, 'image')).toBe('This will delete this asset from the website. Continue?');
  });
  it('bulk copy with count + noun', () => {
    expect(deleteConfirmMessage(7, 'image')).toBe('This will delete 7 images from the website. Continue?');
    expect(deleteConfirmMessage(2, 'video')).toBe('This will delete 2 videos from the website. Continue?');
  });
});

describe('rangeSelectKeys', () => {
  const allKeys = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];

  it('selects all items in range from 1st to 10th (Shift+click forward)', () => {
    const initialSelection = new Set(['k0']);
    const next = rangeSelectKeys(allKeys, initialSelection, 'k9', 'k0');
    expect(Array.from(next)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9']);
  });

  it('selects all items in reverse range (e.g. from 8th to 3rd)', () => {
    const initialSelection = new Set(['k8']);
    const next = rangeSelectKeys(allKeys, initialSelection, 'k3', 'k8');
    expect(Array.from(next).sort()).toEqual(['k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  });

  it('defaults to starting from index 0 if anchorKey is null or not found', () => {
    const initialSelection = new Set<string>();
    const next = rangeSelectKeys(allKeys, initialSelection, 'k4', null);
    expect(Array.from(next)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('preserves existing selections outside the range while selecting range', () => {
    const initialSelection = new Set(['special_key']);
    const next = rangeSelectKeys(allKeys, initialSelection, 'k2', 'k0');
    expect(next.has('special_key')).toBe(true);
    expect(next.has('k0')).toBe(true);
    expect(next.has('k1')).toBe(true);
    expect(next.has('k2')).toBe(true);
  });

  it('returns unchanged set if targetKey is not in allKeys', () => {
    const initialSelection = new Set(['k1']);
    const next = rangeSelectKeys(allKeys, initialSelection, 'unknown_key', 'k1');
    expect(Array.from(next)).toEqual(['k1']);
  });
});

describe('toggleSelectAllKeys', () => {
  const allKeys = ['k0', 'k1', 'k2', 'k3'];

  it('selects all keys when current selection is empty', () => {
    const next = toggleSelectAllKeys(allKeys, new Set());
    expect(Array.from(next)).toEqual(['k0', 'k1', 'k2', 'k3']);
  });

  it('selects all keys when only some are selected', () => {
    const next = toggleSelectAllKeys(allKeys, new Set(['k1']));
    expect(Array.from(next)).toEqual(['k0', 'k1', 'k2', 'k3']);
  });

  it('clears selection when all keys are already selected', () => {
    const next = toggleSelectAllKeys(allKeys, new Set(['k0', 'k1', 'k2', 'k3']));
    expect(Array.from(next)).toEqual([]);
  });

  it('handles empty allKeys gracefully', () => {
    const next = toggleSelectAllKeys([], new Set());
    expect(Array.from(next)).toEqual([]);
  });
});

describe('getSelectionState', () => {
  const allKeys = ['a', 'b', 'c'];

  it('detects none selected', () => {
    expect(getSelectionState(allKeys, new Set())).toEqual({
      allSelected: false,
      someSelected: false,
      count: 0,
    });
  });

  it('detects partial selection (indeterminate state)', () => {
    expect(getSelectionState(allKeys, new Set(['b']))).toEqual({
      allSelected: false,
      someSelected: true,
      count: 1,
    });
  });

  it('detects all selected', () => {
    expect(getSelectionState(allKeys, new Set(['a', 'b', 'c']))).toEqual({
      allSelected: true,
      someSelected: false,
      count: 3,
    });
  });

  it('handles empty allKeys', () => {
    expect(getSelectionState([], new Set())).toEqual({
      allSelected: false,
      someSelected: false,
      count: 0,
    });
  });
});

describe('computeGridTileRects', () => {
  it('returns empty array when keys are empty or container width is invalid', () => {
    expect(computeGridTileRects([], 256)).toEqual([]);
    expect(computeGridTileRects(['a', 'b'], 0)).toEqual([]);
    expect(computeGridTileRects(['a', 'b'], -10)).toEqual([]);
  });

  it('correctly calculates 2-column square tiles with padding and gap', () => {
    // container: 256, padding: 12 on each side -> 232 available
    // gap: 8 -> tileWidth = (232 - 8) / 2 = 112
    const keys = ['k0', 'k1', 'k2', 'k3'];
    const rects = computeGridTileRects(keys, 256, 8, 2, 12);

    expect(rects).toHaveLength(4);

    // Row 0, Col 0: left = 12, top = 12, width = 112, height = 112
    expect(rects[0]).toEqual({
      key: 'k0',
      left: 12,
      top: 12,
      right: 124,
      bottom: 124,
    });

    // Row 0, Col 1: left = 12 + 112 + 8 = 132, top = 12
    expect(rects[1]).toEqual({
      key: 'k1',
      left: 132,
      top: 12,
      right: 244,
      bottom: 124,
    });

    // Row 1, Col 0: left = 12, top = 12 + 112 + 8 = 132
    expect(rects[2]).toEqual({
      key: 'k2',
      left: 12,
      top: 132,
      right: 124,
      bottom: 244,
    });

    // Row 1, Col 1: left = 132, top = 132
    expect(rects[3]).toEqual({
      key: 'k3',
      left: 132,
      top: 132,
      right: 244,
      bottom: 244,
    });
  });

  it('integrates seamlessly with keysInSweep without DOM access', () => {
    const keys = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const rects = computeGridTileRects(keys, 256, 8, 2, 12);

    // Sweep marquee over column 0 (left: 0 to 125, top: 0 to 300)
    // Should select items in col 0 of rows 0, 1, 2 -> item-0, item-2, item-4
    const hit = keysInSweep(rects, { x: 0, y: 0 }, { x: 125, y: 300 });
    expect(hit).toEqual(['item-0', 'item-2', 'item-4']);
  });
});
