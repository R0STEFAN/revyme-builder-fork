import { expect, it } from 'vitest';
import { applyFramerFontFaces } from './framer-font-gen';
const face = { family: 'Framer framer-font 1 Zalando Sans', url: '/api/uploads/zalando.woff2', ext: 'woff2' as const, weight: 450, style: 'normal' as const, unicodeRange: 'U+0000-00FF, U+0131' };
it('registers uploaded original font subsets with their exact weight and preserves unrelated CSS', () => {
  const css = applyFramerFontFaces('body { margin: 0; }', [face]);
  expect(css).toContain('body { margin: 0; }');
  expect(css).toContain(`font-family: '${face.family}';`);
  expect(css).toContain('font-weight: 450;');
  expect(css).toContain('unicode-range: U+0000-00FF, U+0131;');
  expect(applyFramerFontFaces(css, [face])).toBe(css);
});
it('refuses CSS injection, unhosted URLs and invalid font metrics at the native import boundary', () => {
  for (const patch of [{ family: "x';}body{" }, { family: 'Arial' }, { url: 'data:font/woff2;base64,AAAA' }, { url: '/api/uploads/x.woff2\');}body{' }, { weight: NaN }, { weight: 0 }, { unicodeRange: 'U+0000; } body {' }, { weightRange: { min: 900, max: 100 } }]) {
    expect(() => applyFramerFontFaces('', [{ ...face, ...patch }])).toThrow(/FRAMER_FONT_PATCH/);
  }
});
it('does not override existing font declarations or imports for the same family', () => {
  expect(() => applyFramerFontFaces(`@font-face {font-family:'${face.family}'; src:url('/old.woff2');}`, [face])).toThrow(/COLLISION/);
  expect(() => applyFramerFontFaces(`@import url('https://fonts.googleapis.com/css2?family=${face.family.replace(/ /g, '+')}');`, [face])).toThrow(/COLLISION/);
});
