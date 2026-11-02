import { expect, it } from 'vitest';
import { addGoogleFontImportsToCss, type GoogleFontRequest } from './google-font-import';
it('adds canonical Google imports with exact weights and axes before existing CSS', () => {
  const css = addGoogleFontImportsToCss('body { margin: 0; }', [
    { family: 'Zalando Sans', axes: { wght: 450, wdth: 100 } },
    { family: 'Zalando Sans', axes: { wght: 800 } },
    { family: 'Zalando Sans', axes: { wght: 900 } },
  ]);
  expect(css).toContain('family=Zalando+Sans:wdth,wght@100,450&display=swap');
  expect(css).toContain('family=Zalando+Sans:wght@800;900&display=swap');
  expect(css.endsWith('body { margin: 0; }')).toBe(true);
  expect(addGoogleFontImportsToCss(css, [{ family: 'Zalando Sans', axes: { wdth: 100, wght: 450 } }])).toBe(css);
});
it('refuses CSS injection and nonfinite or malformed axis requests', () => {
  const invalid: GoogleFontRequest[] = [{ family: "Font');body{}", axes: {} }, { family: 'Inter', axes: { weight: 400 } }, { family: 'Inter', axes: { wght: NaN } }];
  for (const request of invalid) expect(() => addGoogleFontImportsToCss('', [request])).toThrow(/GOOGLE_FONT_REQUEST/);
});
