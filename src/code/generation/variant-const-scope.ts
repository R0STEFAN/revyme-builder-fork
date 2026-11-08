// variant-const-scope.ts — keep a variants object that READS a component
// variable inside the component function.
//
// Variant objects are written at module scope (`const frameVariants = { … }`).
// The moment an entry references a prop — `default: { backgroundColor: color }`
// seeded from a variable-bound base, or `'variant-1': { backgroundColor: color1 }`
// — the identifier only exists inside the component, and a module-scope const
// is a ReferenceError on deploy. variable-ops moves the const in when it binds
// a variable (setInlineVariableForVariant); this is the same move for every
// other writer, string-based so the rest of the file keeps its formatting.

import { trace } from '@/shared/debug-trace';

/** Index just past the `)` matching the `(` at `open`, string-aware. -1 if unbalanced. */
function matchParen(code: string, open: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (str) { if (ch === '\\') { i++; continue; } if (ch === str) str = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Index of the `}` matching the `{` at `open`, string-aware. -1 if unbalanced. */
function matchBrace(code: string, open: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (str) { if (ch === '\\') { i++; continue; } if (ch === str) str = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The component function: its destructured param names and the index just past its body's `{`. */
function componentFunction(code: string): { params: Set<string>; bodyStart: number; start: number } | null {
  const regex = /(?:export\s+default\s+)?function\s+([A-Z]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(code)) !== null) {
    if (m[1] === 'MotionLinkBase') continue;
    const parenOpen = m.index + m[0].length - 1;
    const parenEnd = matchParen(code, parenOpen);
    if (parenEnd < 0) continue;
    const bodyOpen = code.indexOf('{', parenEnd);
    if (bodyOpen < 0) continue;
    const sig = code.slice(parenOpen + 1, parenEnd - 1);
    const patternOpen = sig.indexOf('{');
    const patternEnd = patternOpen >= 0 ? matchBrace(sig, patternOpen) : -1;
    const pattern = patternEnd > 0 ? sig.slice(patternOpen + 1, patternEnd) : '';
    const params = new Set<string>();
    let depth = 0;
    let token = '';
    for (const ch of pattern + ',') {
      if ('{[('.includes(ch)) depth++;
      else if ('}])'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) {
        const name = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(token)?.[1];
        if (name && !token.trim().startsWith('...')) params.add(name);
        token = '';
      } else token += ch;
    }
    return { params, bodyStart: bodyOpen + 1, start: m.index };
  }
  return null;
}

/**
 * Move every module-scope `const <name>Variants = { … }` whose entries read a
 * component prop into the top of the component function. No-op when nothing
 * references a prop, or when the const is already inside.
 */
export function scopeVariantConstsReadingProps(code: string): string {
  const fn = componentFunction(code);
  if (!fn || fn.params.size === 0) return code;
  let out = code;
  const moved: string[] = [];
  for (const m of [...code.matchAll(/^const\s+(\w+Variants)\s*=\s*\{/gm)]) {
    const start = out.indexOf(m[0]);
    const current = componentFunction(out);
    if (start < 0 || !current || start > current.start) continue; // already inside the function
    const open = start + m[0].length - 1;
    const close = matchBrace(out, open);
    if (close < 0) continue;
    const body = out.slice(open, close + 1);
    const reads = [...body.matchAll(/:\s*([A-Za-z_$][\w$]*)\s*(?=[,}\n])/g)]
      .some((r) => fn.params.has(r[1]) && !['true', 'false', 'null', 'undefined'].includes(r[1]));
    if (!reads) continue;
    let end = close + 1;
    if (out[end] === ';') end++;
    if (out[end] === '\n') end++;
    const decl = out.slice(start, end).replace(/\n?$/, '\n');
    out = out.slice(0, start) + out.slice(end);
    const inside = componentFunction(out);
    if (!inside) return code;
    out = out.slice(0, inside.bodyStart) + '\n  ' + decl.trimEnd() + out.slice(inside.bodyStart);
    moved.push(m[1]);
  }
  if (moved.length) trace.action('variant-const-scope:moved', { consts: moved });
  return out;
}
