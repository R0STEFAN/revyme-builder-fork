import { beforeEach, describe, expect, it } from 'vitest';
import {
  getResponsiveOverridesForNode,
  parseResponsiveBreakpoints,
  setIsComponentMaster,
  setResponsiveBreakpoints,
} from './responsive';

const rule = (query: string, fontSize: string) =>
  `@media ${query} { [data-id="title"] { font-size: ${fontSize}; } }`;

beforeEach(() => {
  setIsComponentMaster(false);
  setResponsiveBreakpoints([]);
});

describe('responsive override cascade', () => {
  it('uses source order when overlapping selectors have equal specificity', () => {
    const tabletThenMobile = rule('(max-width: 768px)', '24px') + rule('(max-width: 375px)', '12px');
    setResponsiveBreakpoints(parseResponsiveBreakpoints(tabletThenMobile));
    expect(getResponsiveOverridesForNode('title', 375).fontSize).toBe('12px');

    const mobileThenTablet = rule('(max-width: 375px)', '12px') + rule('(max-width: 768px)', '24px');
    setResponsiveBreakpoints(parseResponsiveBreakpoints(mobileThenTablet));
    expect(getResponsiveOverridesForNode('title', 375).fontSize).toBe('24px');
  });

  it('uses the last rule when matching rules have equal bounds', () => {
    const css = rule('(max-width: 600px)', '18px') + rule('(max-width: 600px)', '20px');
    setResponsiveBreakpoints(parseResponsiveBreakpoints(css));
    expect(getResponsiveOverridesForNode('title', 600).fontSize).toBe('20px');
  });

  it('parses fractional bounds and preserves non-overlapping bands', () => {
    const css = rule('(max-width: 768.5px) and (min-width: 500.25px)', '24px')
      + rule('(max-width: 500.25px)', '12px');
    setResponsiveBreakpoints(parseResponsiveBreakpoints(css));
    expect(getResponsiveOverridesForNode('title', 500.5).fontSize).toBe('24px');
    expect(getResponsiveOverridesForNode('title', 500.25).fontSize).toBe('12px');
    expect(getResponsiveOverridesForNode('title', 500.1).fontSize).toBe('12px');
  });

  it('keeps component masters on base styles', () => {
    setResponsiveBreakpoints(parseResponsiveBreakpoints(rule('(max-width: 768px)', '12px')));
    setIsComponentMaster(true);
    expect(getResponsiveOverridesForNode('title', 375)).toEqual({});
  });
});
