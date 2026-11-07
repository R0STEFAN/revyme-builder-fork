/** Use CSS's captured fallback when a Framer color token was not included in the source scope. */
export function resolveMissingSourceTokenFallbacks(value: string): string {
  const start = /var\(\s*--token-[a-zA-Z0-9-]+\s*,/g;
  let result = '', cursor = 0, match: RegExpExecArray | null;
  while ((match = start.exec(value))) {
    const open = match.index + match[0].indexOf('(');
    let depth = 1, quote = '', escaped = false, close = -1;
    for (let index = open + 1; index < value.length; index++) {
      const char = value[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) { close = index; break; }
    }
    if (close < 0) continue;
    const fallback = value.slice(match.index + match[0].length, close).trim();
    if (!fallback) continue;
    result += value.slice(cursor, match.index) + fallback;
    cursor = close + 1;
    start.lastIndex = cursor;
  }
  const resolved = result + value.slice(cursor);
  return resolved.replace(/var\(\s*--token-[a-zA-Z0-9-]+\s*\)/g, 'inherit');
}
