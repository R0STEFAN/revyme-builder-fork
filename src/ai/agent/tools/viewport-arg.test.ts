import { describe, it, expect } from 'vitest';
import { viewportKeyWidth, viewportForArg } from './viewport-arg';
import type { ViewportConfig } from '@/shared/types';

const vp = (id: string, width: number, designWidth?: number, isPrimary = false) =>
  ({ id, label: id[0].toUpperCase() + id.slice(1), width, ...(designWidth ? { designWidth } : {}), isPrimary, order: 0 }) as ViewportConfig;
// Start model: Desktop 1440+, Tablet 768–1439, Mobile < 768.
const LADDER = [vp('desktop', 1440, undefined, true), vp('tablet', 1439, 768), vp('mobile', 767, 375)];

describe('viewport arguments', () => {
  it('a breakpoint named by its START writes to the width it is keyed by (its end)', () => {
    expect(viewportKeyWidth(375, LADDER)).toBe(767);
    expect(viewportKeyWidth('768', LADDER)).toBe(1439);
    expect(viewportKeyWidth(1440, LADDER)).toBe(1440);
  });
  it('the stored end, the id and the label name it too', () => {
    expect(viewportKeyWidth(767, LADDER)).toBe(767);
    expect(viewportKeyWidth('mobile', LADDER)).toBe(767);
    expect(viewportKeyWidth('Tablet', LADDER)).toBe(1439);
    expect(viewportForArg(375, LADDER)?.id).toBe('mobile');
  });
  it('absent → undefined; an unknown number passes through for the tool to report', () => {
    expect(viewportKeyWidth(undefined, LADDER)).toBeUndefined();
    expect(viewportKeyWidth(500, LADDER)).toBe(500);
  });
  it('a classic page keeps its widths as they are', () => {
    const classic = [vp('desktop', 1440, undefined, true), vp('tablet', 768), vp('mobile', 375)];
    expect(viewportKeyWidth(375, classic)).toBe(375);
  });
});
