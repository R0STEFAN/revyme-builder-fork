// breakpoint-proof.ts — a model of what every width-keyed mechanism resolves at a given window /
// tile width, and the breakpoint start-model migration's per-file PROOF built on it: resolve a file
// before and after the migration at each breakpoint's drawn width — equal results = the tile looks
// exactly the same — and check nothing is left keyed at a breakpoint's old width. Used by the
// project migration (refuses to write a file whose proof fails) and by its tests / rehearsals.
//
// Each evaluator mirrors its runtime's OWN rule (quoted next to it), not the generator's intent.

import { parseCanvasConfig } from './canvas-config';
import { renderWidth } from '@/shared/types';

/** `(min-width|max-width: Npx)`, `and`, comma lists. */
export function matches(query: string, w: number): boolean {
  return query.split(',').some((part) => {
    const conds = [...part.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)];
    if (conds.length === 0) return false;
    return conds.every(([, kind, n]) => (kind === 'min' ? w >= Number(n) : w <= Number(n)));
  });
}

/** CSS: every @media block of the page <style>, in source order, applied at `w` (later wins).
 *  `lang` keeps `:lang(x)` rules (they are compared like any other selector). */
export function cssAt(code: string, w: number): Record<string, string> {
  const style = /<style>\s*\{[`']([\s\S]*?)[`']\}\s*<\/style>/.exec(code)?.[1] ?? '';
  return cssTextAt(style, w);
}

export function cssTextAt(style: string, w: number): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /@media\s*([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(style))) {
    let depth = 1, i = re.lastIndex;
    for (; i < style.length && depth > 0; i++) { if (style[i] === '{') depth++; else if (style[i] === '}') depth--; }
    const body = style.slice(re.lastIndex, i - 1);
    if (matches(m[1], w)) {
      for (const r of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        // A grouped rule (`[data-id="a"], [data-id="b"] {…}`) applies to each selector alone —
        // compare per selector, so re-serializing a group as separate rules is not a difference.
        for (const sel of r[1].split(/,(?![^[]*\])/).map((x) => x.trim()).filter(Boolean)) {
          for (const decl of r[2].split(';')) {
            const k = decl.slice(0, decl.indexOf(':')).trim();
            if (k) out[`${sel} :: ${k}`] = decl.slice(decl.indexOf(':') + 1).trim();
          }
        }
      }
    }
    re.lastIndex = i;
  }
  return out;
}

/** useMediaQuery gates: name → true/false at `w`. */
export function gatesAt(code: string, w: number): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of code.matchAll(/const\s+(__mq\d+)\s*=\s*useMediaQuery\(\s*['"]([^'"]+)['"]\s*\)/g)) out[g[1]] = matches(g[2], w);
  return out;
}

/** Spec `query` strings — JSON (`"query":"…"`, scroll / instance-fx / glide) and JS literal
 *  (`query: "…"`, SplitText) — in document order. */
export function queriesAt(code: string, w: number): boolean[] {
  return [...code.matchAll(/(?:"query"|\bquery)\s*:\s*\\?"([^"\\]+)\\?"/g)].map((q) => matches(q[1], w));
}

/** data-responsive — the runtime's rule: (prev, bp], wider than all = base. */
export function responsiveAt(code: string, w: number): unknown[] {
  return [...code.matchAll(/data-responsive='(\{[^']*\})'/g)].map((m) => {
    const obj = JSON.parse(m[1]);
    const bps = (Array.isArray(obj._bp) ? obj._bp : Object.keys(obj).filter((k) => k !== '_bp').map(Number))
      .filter((n: number) => Number.isFinite(n) && n > 0).sort((a: number, b: number) => a - b);
    for (let i = 0; i < bps.length; i++) {
      const lower = i > 0 ? bps[i - 1] : 0;
      if (w > lower && w <= bps[i]) return obj[String(bps[i])] ?? {};
    }
    return {};
  });
}

/** useResponsiveText — the hook's rule: smallest listed width ≥ w, else the primary text. */
export function responsiveTextAt(code: string, w: number): string[] {
  return [...code.matchAll(/useResponsiveText\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),\s*(\{[^}]*\}),\s*\[([^\]]*)\]\s*\)/g)].map((m) => {
    const overrides: Record<string, string> = {};
    for (const kv of m[2].matchAll(/(\d+)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) overrides[kv[1]] = kv[2];
    const widths = m[3].split(',').map((s) => Number(s.trim())).filter((n) => n > 0).sort((a, b) => a - b);
    const bucket = widths.find((b) => w <= b);
    return bucket !== undefined && overrides[String(bucket)] !== undefined ? overrides[String(bucket)] : m[1];
  });
}

/** Split a call's argument list on top-level commas. */
function topLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0, quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out;
}

/** The argument list of every `name(…)` call (not its `function name(` declaration). */
function callArgs(code: string, name: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`(?<!function\\s)\\b${name}\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1, i = re.lastIndex, quote: string | null = null;
    for (; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push(topLevelArgs(code.slice(re.lastIndex, i - 1)));
  }
  return out;
}

/** useResponsiveListConfig — the hook's rule: smallest listed width ≥ w, merged over the base. */
export function listConfigAt(code: string, w: number): unknown[] {
  return callArgs(code, 'useResponsiveListConfig').map((args) => {
    let base: Record<string, unknown> = {}, vp: Record<string, unknown> = {}, widths: number[] = [];
    try { base = JSON.parse(args[0]); } catch { /* keep {} */ }
    try { vp = JSON.parse(args[1]); } catch { /* keep {} */ }
    try { widths = JSON.parse(args[2]); } catch { /* keep [] */ }
    const bucket = [...widths].filter((n) => n > 0).sort((a, b) => a - b).find((b) => w <= b);
    return bucket !== undefined && vp[String(bucket)] ? { ...base, ...(vp[String(bucket)] as object) } : base;
  });
}

/** data-overlay — the runtime's rule: owning = smallest `responsiveBp` ≥ w (or smallest
 *  `responsive` key ≥ w without a list), its override merged over the base. */
export function overlayAt(code: string, w: number): unknown[] {
  return [...code.matchAll(/data-overlay='([^']+)'/g)].map((m) => {
    const raw = JSON.parse(m[1]);
    if (!raw.responsive) return raw;
    const bps: number[] = raw.responsiveBp && raw.responsiveBp.length ? raw.responsiveBp : Object.keys(raw.responsive).map(Number);
    const owning = bps.filter((b) => w <= b).sort((a, b) => a - b)[0];
    const cfg = owning !== undefined && raw.responsive[owning] ? { ...raw, ...raw.responsive[owning] } : raw;
    const { responsive: _r, responsiveBp: _b, ...rest } = cfg;
    return rest;
  });
}

/** Overlay open-variant chains: `(window.innerWidth <= 767 ? 'a' : window.innerWidth <= 1199 ? 'b' : 'base')`. */
export function openVariantAt(code: string, w: number): string[] {
  return [...code.matchAll(/\(((?:window\.innerWidth\s*<=\s*\d+\s*\?\s*'[^']*'\s*:\s*)+)'([^']*)'\)/g)].map((m) => {
    for (const b of m[1].matchAll(/window\.innerWidth\s*<=\s*(\d+)\s*\?\s*'([^']*)'/g)) if (w <= Number(b[1])) return b[2];
    return m[2];
  });
}

/** Template route values (LayoutClient): each `v = (__mqA ? __tp['v@W'] : … : undefined) ?? __tp.v ?? v;`
 *  line, resolved for every route of the `__templateProps` map with the gates at `w`. */
export function templateRouteAt(code: string, w: number): Record<string, unknown> {
  const map = /const __templateProps = (\{[\s\S]*?\});\n/.exec(code);
  if (!map) return {};
  let routes: Record<string, Record<string, unknown>>;
  try { routes = JSON.parse(map[1]); } catch { return {}; }
  const gates = gatesAt(code, w);
  const out: Record<string, unknown> = {};
  for (const line of code.matchAll(/\n[ \t]*([A-Za-z_$][\w$]*) = \(([^\n]*?) : undefined\) \?\? __tp\.\1 \?\? \1;/g)) {
    const pairs = [...line[2].matchAll(/(__mq\d+) \? __tp\['([^']+)'\]/g)];
    for (const [route, vals] of Object.entries(routes)) {
      const hit = pairs.find(([, g]) => gates[g]);
      const key = hit?.[2];
      out[`${route} :: ${line[1]}`] = (key !== undefined ? vals[key] : undefined) ?? vals[line[1]];
    }
  }
  return out;
}

export function resolveAll(code: string, w: number) {
  return {
    css: cssAt(code, w), gates: gatesAt(code, w), queries: queriesAt(code, w),
    responsive: responsiveAt(code, w), text: responsiveTextAt(code, w), list: listConfigAt(code, w),
    overlay: overlayAt(code, w), openVariant: openVariantAt(code, w), route: templateRouteAt(code, w),
  };
}

/** Stable JSON: object keys sorted, so two resolutions compare by VALUE, not by rule order. */
export function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
}

/** Human-readable differences between two `resolveAll` results (empty = identical). */
export function diffResolutions(a: ReturnType<typeof resolveAll>, b: ReturnType<typeof resolveAll>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(a) as Array<keyof typeof a>) {
    const av = a[k] as unknown, bv = b[k] as unknown;
    if (JSON.stringify(canon(av)) === JSON.stringify(canon(bv))) continue;
    if (av && typeof av === 'object' && !Array.isArray(av)) {
      const ao = av as Record<string, unknown>, bo = bv as Record<string, unknown>;
      for (const kk of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
        if (JSON.stringify(canon(ao[kk])) !== JSON.stringify(canon(bo[kk]))) out.push(`${k} ${kk}: ${JSON.stringify(ao[kk])} → ${JSON.stringify(bo[kk])}`);
      }
    } else out.push(`${k} ${JSON.stringify(av)} → ${JSON.stringify(bv)}`);
  }
  return out;
}

/** Width-keyed carriers still keyed at `w` (the migration moved every breakpoint off its old
 *  end — a hit is a carrier the rewrite missed). The `@canvas` block is ignored: `designWidth`
 *  carries the old number on purpose. */
export function staleKeyHits(code: string, w: number): string[] {
  const body = code.replace(/\/\*\*\s*@canvas[\s\S]*?\*\//, '');
  const carriers: Array<[string, RegExp]> = [
    ['@media band', new RegExp(`@media[^{]*max-width:\\s*${w}px`)],
    ['query', new RegExp(`(?:useMediaQuery\\(\\s*['"]|query"?\\s*:\\s*\\\\?")[^'"]*max-width:\\s*${w}px`)],
    ['object key', new RegExp(`["'{,\\s]${w}["']?\\s*:`)],
    ['width array', new RegExp(`\\[[^\\]]*\\b${w}\\b[^\\]]*\\]`)],
    ['route key', new RegExp(`@${w}['"]`)],
    ['innerWidth', new RegExp(`innerWidth\\s*<=\\s*${w}\\b`)],
  ];
  const out: string[] = [];
  for (const [label, re] of carriers) {
    const hit = re.exec(body);
    if (hit) out.push(`${label} still keyed at old ${w}: …${body.slice(Math.max(0, hit.index - 60), hit.index + 60).replace(/\s+/g, ' ')}…`);
  }
  return out;
}

/** The migration's proof for one file: every breakpoint's tile drawn at the same width and
 *  resolving exactly the same, and nothing keyed at an old end. Empty = proven. */
export function proveFileMigration(before: string, after: string, oldEnds: number[]): string[] {
  const problems: string[] = [];
  const oldCfg = parseCanvasConfig(before);
  const newCfg = parseCanvasConfig(after);
  if (!oldCfg || !newCfg) return ['@canvas unreadable after migration'];
  for (const vp of oldCfg.viewports) {
    const nv = newCfg.viewports.find((v) => v.id === vp.id);
    if (!nv) { problems.push(`${vp.id}: viewport lost`); continue; }
    if (renderWidth(nv) !== renderWidth(vp)) problems.push(`${vp.id}: tile drawn at ${renderWidth(vp)} → ${renderWidth(nv)}`);
    for (const d of diffResolutions(resolveAll(before, renderWidth(vp)), resolveAll(after, renderWidth(nv)))) problems.push(`${vp.id} @${renderWidth(vp)}px: ${d}`);
  }
  for (const w of oldEnds) problems.push(...staleKeyHits(after, w));
  return problems;
}
