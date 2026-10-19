import { describe, it, expect } from 'vitest';
import {
  isFontSizeHandleEligible,
  computeNewFontSize,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from './FontSizeHandle';

describe('isFontSizeHandleEligible', () => {
  it('allows text tags with fit-content / auto width and height', () => {
    expect(isFontSizeHandleEligible({ tag: 'p', width: 'auto', height: 'auto' })).toBe(true);
    expect(isFontSizeHandleEligible({ tag: 'h1', width: 'max-content', height: 'auto' })).toBe(true);
    expect(isFontSizeHandleEligible({ tag: 'h2', width: 'fit-content', height: 'fit-content' })).toBe(true);
    expect(isFontSizeHandleEligible({ tag: 'span', width: '', height: '' })).toBe(true);
    expect(isFontSizeHandleEligible({ tag: 'span', width: undefined, height: undefined })).toBe(true);
    expect(isFontSizeHandleEligible({ tag: 'a', width: 'min-content', height: 'auto' })).toBe(true);
  });

  it('rejects non-text tags even if they have fit dimensions', () => {
    expect(isFontSizeHandleEligible({ tag: 'div', width: 'auto', height: 'auto' })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'section', width: 'max-content', height: 'auto' })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'img', width: 'auto', height: 'auto' })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'svg', width: 'auto', height: 'auto' })).toBe(false);
  });

  it('rejects text tags when width is fixed or percentage fill', () => {
    expect(isFontSizeHandleEligible({ tag: 'p', width: '400px', height: 'auto' })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'h1', width: '100%', height: 'auto' })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'span', width: '50vw', height: 'auto' })).toBe(false);
  });

  it('rejects text tags when height is fixed', () => {
    expect(isFontSizeHandleEligible({ tag: 'p', width: 'auto', height: '200px' })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'h2', width: 'max-content', height: '100px' })).toBe(false);
  });

  it('rejects text tags with pinned horizontal or vertical insets', () => {
    expect(isFontSizeHandleEligible({ tag: 'p', width: 'auto', height: 'auto', hasHInset: true })).toBe(false);
    expect(isFontSizeHandleEligible({ tag: 'p', width: 'auto', height: 'auto', hasVInset: true })).toBe(false);
  });
});

describe('computeNewFontSize', () => {
  it('increases font size when dragging right and down', () => {
    const size = computeNewFontSize({
      initialFontSize: 16,
      dx: 40,
      dy: 40,
      sensitivity: 0.4,
    });
    // delta = (40 + 40) / 2 = 40. 16 + 40 * 0.4 = 32.
    expect(size).toBe(32);
  });

  it('decreases font size when dragging left and up', () => {
    const size = computeNewFontSize({
      initialFontSize: 24,
      dx: -20,
      dy: -20,
      sensitivity: 0.4,
    });
    // delta = (-20 + -20) / 2 = -20. 24 - 20 * 0.4 = 16.
    expect(size).toBe(16);
  });

  it('handles single-axis drag (horizontal or vertical)', () => {
    const sizeH = computeNewFontSize({
      initialFontSize: 16,
      dx: 40,
      dy: 0,
      sensitivity: 0.4,
    });
    // delta = 20. 16 + 20 * 0.4 = 24.
    expect(sizeH).toBe(24);

    const sizeV = computeNewFontSize({
      initialFontSize: 16,
      dx: 0,
      dy: 40,
      sensitivity: 0.4,
    });
    expect(sizeV).toBe(24);
  });

  it('snaps to multiples of 4px when shiftKey is active', () => {
    const sizeShift = computeNewFontSize({
      initialFontSize: 16,
      dx: 15,
      dy: 15,
      shiftKey: true,
      sensitivity: 0.4,
    });
    // delta = 15. calculated = 16 + 6 = 22. Snapped to nearest 4: 24.
    expect(sizeShift).toBe(24);
  });

  it('clamps to MIN_FONT_SIZE and MAX_FONT_SIZE', () => {
    const tooSmall = computeNewFontSize({
      initialFontSize: 12,
      dx: -500,
      dy: -500,
    });
    expect(tooSmall).toBe(MIN_FONT_SIZE);

    const tooBig = computeNewFontSize({
      initialFontSize: 300,
      dx: 500,
      dy: 500,
    });
    expect(tooBig).toBe(MAX_FONT_SIZE);
  });

  it('adjusts delta based on rotation', () => {
    // Rotated 90 degrees clockwise:
    // localDx = dy, localDy = -dx
    const sizeRot90 = computeNewFontSize({
      initialFontSize: 16,
      dx: 0,
      dy: 40,
      rotation: 90,
      sensitivity: 0.4,
    });
    // dy = 40 -> localDx = 40, localDy = 0 -> delta = 20 -> size = 24
    expect(sizeRot90).toBe(24);
  });
});
