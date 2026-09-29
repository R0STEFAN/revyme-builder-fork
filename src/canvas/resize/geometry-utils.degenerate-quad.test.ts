import { describe, it, expect } from 'vitest';
import { isDegenerateQuad, cornersFromRect } from './geometry-utils';

// Multi-selecting a HIDDEN node from Layers stretched the group selection box off to the canvas
// corner: a display:none node measures as a zero box pinned at the viewport origin, and the union
// took that point in. Such quads are now left out of the group box / resize / rotate.

const quad = (left: number, top: number, width: number, height: number) =>
  cornersFromRect({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect);

describe('isDegenerateQuad', () => {
  it('a hidden node (zero box) is degenerate — wherever it is pinned', () => {
    expect(isDegenerateQuad(quad(0, 0, 0, 0))).toBe(true);
    expect(isDegenerateQuad(quad(435, 543, 0, 0))).toBe(true);
  });

  it('a painted box is not', () => {
    expect(isDegenerateQuad(quad(700, 510, 850, 40))).toBe(false);
  });

  it('a thin line (zero height, real width) still paints — not degenerate', () => {
    expect(isDegenerateQuad(quad(100, 200, 300, 0))).toBe(false);
    expect(isDegenerateQuad(quad(100, 200, 0, 300))).toBe(false);
  });
});
