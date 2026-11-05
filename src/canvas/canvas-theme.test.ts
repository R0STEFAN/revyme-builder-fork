import { describe, test, expect } from 'vitest';
import { extractCanvasGlobals } from './canvas-theme';

const GLOBALS = `@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');
*, *::before, *::after { margin: 0; }
body { min-height: 100vh; }
:root {
  --color-text: #303030;
  --color-surface: #fff;
}
@font-face { font-family: 'Antonio'; src: url('a.woff2') format('woff2'); }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
:root.dark {
  --color-text: #fff;
  --color-surface: #303030;
}
`;

describe('extractCanvasGlobals', () => {
  test('light mode lifts :root only, scoped to the content root', () => {
    const { tokensCSS } = extractCanvasGlobals(GLOBALS, 'light');
    expect(tokensCSS).toContain('[data-content-root] {\n  --color-text: #303030;');
    expect(tokensCSS).not.toContain('#fff;\n  --color-surface: #303030');
    expect(tokensCSS).not.toContain(':root');
    // Never the resets or body styles.
    expect(tokensCSS).not.toContain('min-height');
    expect(tokensCSS).not.toContain('margin: 0');
  });

  test('dark mode appends the dark block after the light one, so it wins by order', () => {
    const { tokensCSS } = extractCanvasGlobals(GLOBALS, 'dark');
    const light = tokensCSS.indexOf('--color-text: #303030');
    const dark = tokensCSS.indexOf('--color-text: #fff');
    expect(light).toBeGreaterThan(-1);
    expect(dark).toBeGreaterThan(light);
    expect(tokensCSS.match(/\[data-content-root\] \{/g)).toHaveLength(2);
  });

  test('keeps keyframes with their nested braces, in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const { tokensCSS } = extractCanvasGlobals(GLOBALS, mode);
      expect(tokensCSS).toContain('@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }');
    }
  });

  test('fonts go to their own sheet, imports first', () => {
    const { fontsCSS, tokensCSS } = extractCanvasGlobals(GLOBALS, 'light');
    expect(fontsCSS.startsWith('@import url(')).toBe(true);
    expect(fontsCSS).toContain("@font-face { font-family: 'Antonio'");
    expect(tokensCSS).not.toContain('@font-face');
    expect(tokensCSS).not.toContain('@import');
  });

  test('a legacy [data-theme="dark"] block is dark-only; other theme blocks lift as before', () => {
    const css = ':root { --a: 1; }\n[data-theme="dark"] { --a: 2; }\n[data-theme="brand"] { --b: 3; }';
    expect(extractCanvasGlobals(css, 'light').tokensCSS).toBe('[data-content-root] { --a: 1; }\n[data-content-root] { --b: 3; }');
    expect(extractCanvasGlobals(css, 'dark').tokensCSS).toBe('[data-content-root] { --a: 1; }\n[data-content-root] { --b: 3; }\n[data-content-root] { --a: 2; }');
  });

  test(':root.dark is never mistaken for :root', () => {
    const css = ':root.dark { --a: dark; }\n:root { --a: light; }';
    expect(extractCanvasGlobals(css, 'light').tokensCSS).toBe('[data-content-root] { --a: light; }');
  });

  test('does not lift :root inside @media into unconditional globals', () => {
    const css = ':root { --typo-size: 64px; }\n@media (max-width: 809px) {\n  :root { --typo-size: 32px; }\n}';
    const { tokensCSS } = extractCanvasGlobals(css, 'light');
    expect(tokensCSS).toContain('[data-content-root] { --typo-size: 64px; }');
    expect(tokensCSS).not.toContain('32px');
  });
});
