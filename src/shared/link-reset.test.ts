import { describe, it, expect } from 'vitest';
import { ensureLinkResetInCss, UNIVERSAL_SEED_RESET, LINK_SEED_RESET } from './link-reset';

describe('ensureLinkResetInCss', () => {
  it('leaves CSS untouched if a { text-decoration: inherit } already exists', () => {
    const css = `${UNIVERSAL_SEED_RESET}\na {\n  color: inherit;\n  text-decoration: inherit;\n}\n:root { --c: #fff; }`;
    expect(ensureLinkResetInCss(css)).toBe(css);
  });

  it('leaves CSS untouched if custom a { text-decoration: underline } exists', () => {
    const css = `a { text-decoration: underline; color: blue; }`;
    expect(ensureLinkResetInCss(css)).toBe(css);
  });

  it('inserts link reset after html block when html exists', () => {
    const css = `@import url('https://fonts.googleapis.com');\n${UNIVERSAL_SEED_RESET}\nhtml {\n  position: relative;\n}\n\n:root {\n  --color: #000;\n}`;
    const result = ensureLinkResetInCss(css);
    expect(result).toContain(LINK_SEED_RESET);
    expect(result.indexOf('html {')).toBeLessThan(result.indexOf(LINK_SEED_RESET));
    expect(result.indexOf(LINK_SEED_RESET)).toBeLessThan(result.indexOf(':root'));
  });

  it('inserts link reset after UNIVERSAL_SEED_RESET if html block does not exist', () => {
    const css = `${UNIVERSAL_SEED_RESET}\n\n:root {\n  --color: #000;\n}`;
    const result = ensureLinkResetInCss(css);
    expect(result).toContain(LINK_SEED_RESET);
    expect(result.indexOf(UNIVERSAL_SEED_RESET)).toBeLessThan(result.indexOf(LINK_SEED_RESET));
    expect(result.indexOf(LINK_SEED_RESET)).toBeLessThan(result.indexOf(':root'));
  });

  it('inserts link reset after leading @imports if no reset blocks exist', () => {
    const css = `@import url('https://fonts.googleapis.com');\n:root {\n  --color: #000;\n}`;
    const result = ensureLinkResetInCss(css);
    expect(result.indexOf('@import')).toBe(0);
    expect(result.indexOf('@import')).toBeLessThan(result.indexOf(LINK_SEED_RESET));
    expect(result.indexOf(LINK_SEED_RESET)).toBeLessThan(result.indexOf(':root'));
  });
});
