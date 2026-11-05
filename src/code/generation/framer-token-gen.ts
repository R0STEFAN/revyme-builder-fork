import { addPresetTokenToCSS } from './preset-gen';
import { addDarkTokenValueToCSS } from '../project/preset-ops';
import { trace } from '../../shared/debug-trace';

export interface FramerColorToken { name: string; value: string; dark?: string }
export function applyFramerColorTokens(css: string, tokens: readonly FramerColorToken[]): string {
  trace.fn('framer-native.applyColorTokens', { count: tokens.length });
  const seen = new Set<string>();
  const channel = '[-+]?(?:\\d*\\.)?\\d+%?';
  const three = `${channel}\\s*,\\s*${channel}\\s*,\\s*${channel}`;
  const colorPattern = new RegExp(`^(?:#(?:[\\da-f]{3}|[\\da-f]{4}|[\\da-f]{6}|[\\da-f]{8})|(?:rgb|hsl)\\(\\s*${three}\\s*\\)|(?:rgba|hsla)\\(\\s*${three}\\s*,\\s*${channel}\\s*\\)|transparent|currentColor|black|white|red|green|blue)$`, 'i');
  const color = (value: string) => colorPattern.test(value);
  let result = css;
  if (/--[\w-]*\\/.test(css)) throw new Error('FRAMER_TOKEN_PATCH_ESCAPED_PROPERTY');
  for (const token of tokens) {
    if (!/^color-[a-z0-9-]+$/.test(token.name) || seen.has(token.name) || !color(token.value) || token.dark !== undefined && !color(token.dark)) throw new Error('FRAMER_TOKEN_PATCH_INVALID');
    if (new RegExp(`--${token.name}(?![\\w-])`).test(css)) throw new Error('FRAMER_TOKEN_PATCH_COLLISION');
    seen.add(token.name);
    result = addPresetTokenToCSS(result, { name: token.name, value: token.value, category: 'color' });
    if (token.dark !== undefined) result = addDarkTokenValueToCSS(result, token.name, token.dark);
  }
  return result;
}
