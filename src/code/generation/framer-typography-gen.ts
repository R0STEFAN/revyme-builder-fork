import { addPresetTokenToCSS } from './preset-gen';
import { trace } from '../../shared/debug-trace';

export interface FramerTypographyToken { name: string; value: string }
const suffix = '(?:line-height(?:-(?:md|sm))?|stroke-width|stroke-color|decoration|transform|shadow|weight|color|font|size(?:-(?:md|sm))?|spacing(?:-(?:md|sm))?|tag|min-default|min-md)';
const namePattern = new RegExp(`^typo-(?:framer-)?[a-z0-9-]+-${suffix}$`);

/** Exact additive recipe shared by compiler and import receiver. */
export function applyFramerTypographyTokens(css: string, tokens: readonly FramerTypographyToken[]): string {
  trace.fn('framer-native.applyTypographyTokens', { count: tokens.length });
  const seen = new Set<string>();
  let result = css;
  for (const token of tokens) {
    if (!namePattern.test(token.name) || seen.has(token.name) || !token.value || /[;{}<>\\\r\n@]/.test(token.value) || /url\s*\(/i.test(token.value)) throw new Error('FRAMER_TYPOGRAPHY_PATCH_INVALID');
    if (new RegExp(`--${token.name}(?![\\w-])`).test(css)) throw new Error('FRAMER_TYPOGRAPHY_PATCH_COLLISION');
    seen.add(token.name);
    result = addPresetTokenToCSS(result, { name: token.name, value: token.value, category: 'typography' });
  }

  // Generate responsive @media queries for groups that define responsive variants
  const groups = new Map<string, Map<string, string>>();
  for (const token of tokens) {
    const match = /^typo-((?:framer-)?[a-z0-9-]+)-(min-default|min-md|size-md|size-sm|line-height-md|line-height-sm|spacing-md|spacing-sm)$/.exec(token.name);
    if (match) {
      const [, group, prop] = match;
      let map = groups.get(group);
      if (!map) { map = new Map(); groups.set(group, map); }
      map.set(prop, token.value);
    }
  }

  const mediaBlocks = new Map<number, string[]>();
  for (const [group, map] of groups.entries()) {
    const minDefault = parseInt(map.get('min-default') || '1200', 10);
    const minMd = parseInt(map.get('min-md') || '810', 10);
    const mdDecls: string[] = [];
    if (map.has('size-md')) mdDecls.push(`    --typo-${group}-size: var(--typo-${group}-size-md);`);
    if (map.has('line-height-md')) mdDecls.push(`    --typo-${group}-line-height: var(--typo-${group}-line-height-md);`);
    if (map.has('spacing-md')) mdDecls.push(`    --typo-${group}-spacing: var(--typo-${group}-spacing-md);`);
    if (mdDecls.length > 0 && minDefault > 1) {
      const mw = minDefault - 1;
      const list = mediaBlocks.get(mw) || [];
      list.push(...mdDecls);
      mediaBlocks.set(mw, list);
    }

    const smDecls: string[] = [];
    if (map.has('size-sm')) smDecls.push(`    --typo-${group}-size: var(--typo-${group}-size-sm);`);
    if (map.has('line-height-sm')) smDecls.push(`    --typo-${group}-line-height: var(--typo-${group}-line-height-sm);`);
    if (map.has('spacing-sm')) smDecls.push(`    --typo-${group}-spacing: var(--typo-${group}-spacing-sm);`);
    if (smDecls.length > 0 && minMd > 1) {
      const mw = minMd - 1;
      const list = mediaBlocks.get(mw) || [];
      list.push(...smDecls);
      mediaBlocks.set(mw, list);
    }
  }

  const sortedWidths = [...mediaBlocks.keys()].sort((a, b) => b - a);
  for (const mw of sortedWidths) {
    const decls = mediaBlocks.get(mw)!;
    const pattern = new RegExp(`@media\\s*\\(\\s*max-width\\s*:\\s*${mw}px\\s*\\)\\s*\\{\\s*:root\\s*\\{([\\s\\S]*?)\\}`, 'i');
    const existing = pattern.exec(result);
    if (existing) {
      const insertion = decls.filter(d => !existing[1].includes(d.trim())).join('\n');
      if (insertion) {
        result = result.replace(pattern, (match, body) => match.replace(body, `${body.trimEnd()}\n${insertion}\n  `));
      }
    } else {
      result += `\n@media (max-width: ${mw}px) {\n  :root {\n${decls.join('\n')}\n  }\n}\n`;
    }
  }

  return result;
}
