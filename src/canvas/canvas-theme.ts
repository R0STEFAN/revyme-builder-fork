// canvas-theme.ts — the canvas shows the website in the EDITOR's colour mode.
//
// A website's tokens live in app/globals.css twice: `:root { … }` for light
// and `:root.dark { … }` for dark (the class next-themes puts on <html> on
// the live site). The canvas iframe never carries that class — its <html> is
// the sandbox's — so the dark block never applied and the canvas could only
// ever paint the light scheme, whatever the editor was set to.
//
// The lifter now reads the editor's own mode (the `.dark` class the bottom
// toolbar toggles on the editor's <html>) and, in dark mode, appends the dark
// block AFTER the light one, scoped to [data-content-root] like every lifted
// token block; last rule wins, so the canvas paints the dark values. The
// toolbar re-lifts on toggle, and the preview is pinned to the same mode, so
// canvas, preview and the editor chrome agree.
//
// One extractor for both lifters (Renderer at render time, node-ops on token
// edits) — they used to keep two copies of this scan, and a rule one knew
// about and the other did not was exactly the kind of drift a live token
// edit would expose.

export type CanvasThemeMode = 'light' | 'dark';

/** The mode the editor chrome is in: the `.dark` class on its <html>. */
export function canvasThemeMode(): CanvasThemeMode {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark' : 'light';
}

/** Every `@<name> … { … }` block, nested braces included. A regex breaks on
 *  the nested `from { } to { }` of a keyframes rule. */
function atRuleBlocks(css: string, name: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf(name, i);
    if (start === -1) break;
    let j = start + name.length;
    while (j < css.length && css[j] !== '{') j++;
    if (j >= css.length) break;
    let depth = 1; j++;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    out.push(css.slice(start, j));
    i = j;
  }
  return out;
}

function stripAtRuleBlocks(css: string, name: string): string {
  let result = '';
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf(name, i);
    if (start === -1) {
      result += css.slice(i);
      break;
    }
    result += css.slice(i, start);
    let j = start + name.length;
    while (j < css.length && css[j] !== '{') j++;
    if (j >= css.length) break;
    let depth = 1; j++;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    i = j;
  }
  return result;
}

/**
 * What the canvas lifts out of app/globals.css, and nothing else: the token
 * blocks for `mode`, `@keyframes`, and — separately, for the stable fonts
 * sheet — `@import` and `@font-face`. Never the resets, `body`, `a`, `img`:
 * those would leak into the builder UI.
 *
 * `:root` is scoped to `[data-content-root]` for the same reason. A dark
 * block (`:root.dark`, or the legacy `[data-theme="dark"]`) is lifted only
 * in dark mode, after the light blocks, so its values win by order; any
 * other `[data-theme=…]` block is lifted as before.
 */
export function extractCanvasGlobals(
  rawCSS: string,
  mode: CanvasThemeMode,
): { tokensCSS: string; fontsCSS: string } {
  const imports: string[] = [];
  // @import MUST be the first rule in its sheet (CSS spec) — collected up
  // front and emitted first in the fonts sheet.
  const css = rawCSS.replace(/@import\s+url\([^)]*\)[^;]*;/g, (match) => {
    imports.push(match);
    return '';
  });
  const light: string[] = [];
  const dark: string[] = [];
  let m: RegExpExecArray | null;
  // Strip @media blocks so responsive typography/overrides are not lifted as unconditional globals.
  // Viewport-specific token assignments are resolved per-tile by buildViewportTokensCSS.
  const baseCss = stripAtRuleBlocks(css, '@media');
  const rootRx = /:root\s*\{([^}]*)\}/g;
  while ((m = rootRx.exec(baseCss)) !== null) light.push(`[data-content-root] {${m[1]}}`);
  const darkRx = /:root\.dark\s*\{([^}]*)\}/g;
  while ((m = darkRx.exec(baseCss)) !== null) dark.push(`[data-content-root] {${m[1]}}`);
  const themeRx = /\[data-theme([^\]]*)\]\s*\{([^}]*)\}/g;
  while ((m = themeRx.exec(baseCss)) !== null) {
    (/dark/.test(m[1]) ? dark : light).push(`[data-content-root] {${m[2]}}`);
  }
  const tokens = [...light, ...(mode === 'dark' ? dark : []), ...atRuleBlocks(css, '@keyframes')];
  return {
    tokensCSS: tokens.join('\n'),
    fontsCSS: [...imports, ...atRuleBlocks(css, '@font-face')].join('\n'),
  };
}
