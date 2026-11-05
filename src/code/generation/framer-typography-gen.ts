import { addPresetTokenToCSS } from './preset-gen';
import { trace } from '../../shared/debug-trace';

export interface FramerTypographyToken { name: string; value: string }
const suffix = '(?:line-height|stroke-width|stroke-color|decoration|transform|shadow|weight|color|font|size|spacing|tag)';
const namePattern = new RegExp(`^typo-framer-[a-z0-9-]+-${suffix}$`);

/** Exact additive recipe shared by compiler and import receiver. */
export function applyFramerTypographyTokens(css: string, tokens: readonly FramerTypographyToken[]): string {
  trace.fn('framer-native.applyTypographyTokens', { count: tokens.length });
  const seen = new Set<string>();
  let result = css;
  for (const token of tokens) {
    if (!namePattern.test(token.name) || seen.has(token.name) || !token.value || /[;{}<>\\\r\n@]/.test(token.value) || /url\s*\(/i.test(token.value)) throw new Error('FRAMER_TYPOGRAPHY_PATCH_INVALID');
    if (new RegExp(`--${token.name}(?![\w-])`).test(css)) throw new Error('FRAMER_TYPOGRAPHY_PATCH_COLLISION');
    seen.add(token.name);
    result = addPresetTokenToCSS(result, { name: token.name, value: token.value, category: 'typography' });
  }
  return result;
}
