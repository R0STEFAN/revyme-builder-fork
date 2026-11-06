export const UNIVERSAL_SEED_RESET = `*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}`;

export const LINK_SEED_RESET = `a {
  color: inherit;
  text-decoration: inherit;
}`;

/**
 * Ensures that global CSS includes a reset for link underline and color
 * (a { color: inherit; text-decoration: inherit; }), matching the builder canvas,
 * preview sandbox, and ServerPreview.
 *
 * If the CSS already has an explicit `a { ... text-decoration: ... }` rule, it is left untouched.
 */
export function ensureLinkResetInCss(css: string): string {
  if (/\ba\s*\{[^}]*\btext-decoration\s*:/.test(css)) {
    return css;
  }

  const linkBlock = `\n${LINK_SEED_RESET}`;

  // If html { ... } exists, place right after it.
  if (/\bhtml\s*\{[^}]*\}/.test(css)) {
    return css.replace(/(\bhtml\s*\{[^}]*\})/, `$1${linkBlock}`);
  }

  // Otherwise if universal reset exists, place right after it.
  if (css.includes(UNIVERSAL_SEED_RESET)) {
    return css.replace(UNIVERSAL_SEED_RESET, `${UNIVERSAL_SEED_RESET}${linkBlock}`);
  }

  // Otherwise, place after leading @imports (or at the top if no @imports).
  const importsHead = css.match(/^(\s*(?:@import[^\n]*\n)*)/)?.[1] ?? '';
  const rest = css.slice(importsHead.length);
  return `${importsHead}${LINK_SEED_RESET}\n\n${rest}`;
}
