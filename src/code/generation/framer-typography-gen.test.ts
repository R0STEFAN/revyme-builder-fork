import { describe, expect, it } from 'vitest';
import { applyFramerTypographyTokens } from './framer-typography-gen';

describe('applyFramerTypographyTokens', () => {
  it('applies basic typography tokens into :root', () => {
    const css = ':root {\n}\n';
    const tokens = [
      { name: 'typo-h1-size', value: '64px' },
      { name: 'typo-h1-font', value: 'Inter' },
    ];
    const result = applyFramerTypographyTokens(css, tokens);
    expect(result).toContain('--typo-h1-size: 64px;');
    expect(result).toContain('--typo-h1-font: Inter;');
  });

  it('generates responsive @media queries for md and sm tiers', () => {
    const css = ':root {\n}\n';
    const tokens = [
      { name: 'typo-h1-size', value: '64px' },
      { name: 'typo-h1-size-md', value: '32px' },
      { name: 'typo-h1-size-sm', value: '36px' },
      { name: 'typo-h1-min-default', value: '1200' },
      { name: 'typo-h1-min-md', value: '810' },
    ];
    const result = applyFramerTypographyTokens(css, tokens);
    expect(result).toContain('--typo-h1-size: 64px;');
    expect(result).toContain('--typo-h1-size-md: 32px;');
    expect(result).toContain('--typo-h1-size-sm: 36px;');

    // 1200 - 1 = 1199px
    expect(result).toContain('@media (max-width: 1199px) {');
    expect(result).toContain('--typo-h1-size: var(--typo-h1-size-md);');

    // 810 - 1 = 809px
    expect(result).toContain('@media (max-width: 809px) {');
    expect(result).toContain('--typo-h1-size: var(--typo-h1-size-sm);');
  });
});
