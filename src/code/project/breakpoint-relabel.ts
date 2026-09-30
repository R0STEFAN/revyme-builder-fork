// breakpoint-relabel.ts — the LOSSLESS rewrite behind the breakpoint start-model migration.
//
// The editor's resize rewrite (rewriteWidthKeyedArtifacts) is built for EDITING: it normalizes
// bands, re-serializes the whole <style> block, adopts orphan keys and refreshes `_bp` from the
// ladder. On hand- and AI-written files that is lossy — the production rehearsal (2026-09-30)
// showed `!important`-less declarations gaining `!important`, `html [data-id]` selectors losing
// their prefix, bands keyed at the PRIMARY width dropped, stale text keys re-adopted. A migration
// must change nothing a tile shows, so it relabels instead:
//
//   · WIDTH QUERIES (@media headers in <style> blocks, `useMediaQuery('…')` gates, spec `query`
//     strings) are re-expressed by WHICH TILES they match at their drawn widths — the rule bodies
//     stay byte-identical. Below the primary each width now follows the tile whose new range holds
//     it; at and above the primary (whose start does not move) the query is left as it was.
//   · WIDTH KEYS (instance `data-responsive` keys + `_bp`, useResponsiveText, CMS list config,
//     overlay config, the open-variant chain, template route keys) are renamed old end → new end,
//     nothing else: no orphan adoption, no list refresh.
//
// Pure — reads nothing but the code; the migration proves the result (breakpoint-proof.ts).

import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { parseJSX } from '@/code/parsing/ast-utils';
import { parseWidthQuery, type WidthClause } from '@/shared/canvas-band-queries';
import { rewriteListConfigBreakpoints, transformResponsiveListCalls } from '@/code/generation/cms-responsive-gen';
import { rewriteOverlayBreakpoints, rewriteRouteKeyBreakpoints } from '@/code/generation/viewport-width-rewrite';

const traverseAst = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

/** A non-primary breakpoint: the width its tile is drawn at, and where its range ends now. */
export interface RelabelTile { drawn: number; newEnd: number }

export interface RelabelLadder {
  /** Every breakpoint with a range end, any order. Their new ranges partition the widths below
   *  the open top (or all widths, when the widest ends at OPEN_END). */
  tiles: RelabelTile[];
  /** The primary sits on top with an open range: widths from the widest tile's end up keep their
   *  queries exactly as they were (the primary's start does not move). */
  preserveAbove: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clauseTruth = (c: WidthClause, w: number) => c.every((x) => (x.kind === 'min' ? w >= x.px : w <= x.px));

function formatClause(max: number | null, min: number | null): string {
  const parts: string[] = [];
  if (max !== null) parts.push(`(max-width: ${round2(max)}px)`);
  if (min !== null && min > 0) parts.push(`(min-width: ${round2(min)}px)`);
  return parts.join(' and ') || '(min-width: 0px)';
}

/**
 * Re-express a width query for the new ladder. Returns null to leave it untouched: not a pure
 * width query, or one no tile and no width at/above the primary matches (nothing to follow).
 */
export function remapWidthQuery(query: string, ladder: RelabelLadder): string | null {
  const clauses = parseWidthQuery(query);
  if (!clauses) return null;
  const tiles = [...ladder.tiles].sort((a, b) => b.newEnd - a.newEnd);
  if (tiles.length === 0) return null;
  const seam = round2(tiles[0].newEnd + 0.02);           // where the primary's range begins
  const truth = tiles.map((tile) => clauses.some((c) => clauseTruth(c, tile.drawn)));

  // Below the primary: runs of consecutive matching tiles → one range each.
  const lower: Array<{ max: number | null; min: number | null; top: boolean }> = [];
  for (let i = 0; i < tiles.length; i++) {
    if (!truth[i]) continue;
    let j = i;
    while (j + 1 < tiles.length && truth[j + 1]) j++;
    lower.push({ max: tiles[i].newEnd, min: j < tiles.length - 1 ? round2(tiles[j + 1].newEnd + 0.02) : null, top: i === 0 });
    i = j;
  }
  // At and above the primary: the original clauses, floored at the seam.
  const upper: Array<{ max: number | null; min: number }> = [];
  for (const c of ladder.preserveAbove ? clauses : []) {
    const min = Math.max(seam, ...c.filter((x) => x.kind === 'min').map((x) => x.px));
    const maxes = c.filter((x) => x.kind === 'max').map((x) => x.px);
    const max = maxes.length ? Math.min(...maxes) : null;
    if (max !== null && max < min) continue;
    if (!upper.some((u) => u.max === max && u.min === min)) upper.push({ max, min });
  }
  if (lower.length === 0 && upper.length === 0) return null;

  // A top run and an upper clause starting at the seam are one contiguous range.
  const out: string[] = [];
  const topRun = lower.find((r) => r.top);
  const atSeam = upper.filter((u) => u.min === seam).sort((a, b) => (b.max ?? Infinity) - (a.max ?? Infinity))[0];
  for (const r of lower) {
    if (r === topRun && atSeam) out.push(formatClause(atSeam.max, r.min));
    else out.push(formatClause(r.max, r.min));
  }
  for (const u of upper) if (!(topRun && u === atSeam)) out.push(formatClause(u.max, u.min));
  return out.join(', ');
}

/** Width queries → the new ladder: @media headers inside <style> blocks, `useMediaQuery` gates,
 *  JSON `"query":"…"` and JS-literal `query: "…"` spec strings. Rule bodies are untouched. */
export function relabelWidthQueries(code: string, ladder: RelabelLadder): string {
  const remap = (q: string) => remapWidthQuery(q, ladder);
  let out = code.replace(/(<style>\s*\{\s*)(`[\s\S]*?`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(\s*\}\s*<\/style>)/g, (_full, open: string, css: string, close: string) => {
    const next = css.replace(/@media\s*(\([^{]*?)\s*\{/g, (head: string, q: string) => {
      const nq = remap(q);
      return nq === null ? head : `@media ${nq} {`;
    });
    return open + next + close;
  });
  out = out.replace(/useMediaQuery\(\s*(['"])([^'"]*)\1\s*\)/g, (full, quote: string, q: string) => {
    const nq = remap(q);
    return nq === null ? full : `useMediaQuery(${quote}${nq}${quote})`;
  });
  out = out.replace(/"query":"((?:[^"\\]|\\.)*)"/g, (full, q: string) => {
    const nq = remap(q);
    return nq === null ? full : `"query":"${nq}"`;
  });
  out = out.replace(/(?<!")\bquery:\s*"((?:[^"\\]|\\.)*)"/g, (full, q: string) => {
    const nq = remap(q);
    return nq === null ? full : `query: "${nq}"`;
  });
  return out;
}

/** Rename one breakpoint key in every `data-responsive` — static JSON (key order kept) and the
 *  computed `={JSON.stringify({…})}` form (text edit inside the attribute). `_bp` entries follow. */
function renameResponsiveAttrKeys(code: string, from: number, to: number): string {
  let out = code.replace(/data-responsive='(\{[^']*\})'/g, (full, json: string) => {
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(json); } catch { return full; }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === String(from)) { next[String(to)] = v; changed = true; continue; }
      if (k === '_bp' && Array.isArray(v) && v.includes(from)) { next._bp = v.map((w) => (w === from ? to : w)); changed = true; continue; }
      next[k] = v;
    }
    return changed ? `data-responsive='${JSON.stringify(next)}'` : full;
  });
  const marker = 'data-responsive={';
  let at = out.indexOf(marker);
  while (at !== -1) {
    const open = at + marker.length - 1;
    let depth = 0, i = open, quote: string | null = null;
    for (; i < out.length; i++) {
      const c = out[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const attr = out.slice(open, i + 1);
    const renamed = attr
      .replace(new RegExp(`(["'])${from}\\1(\\s*:)`, 'g'), `$1${to}$1$2`)
      .replace(/(["']?_bp["']?\s*:\s*\[)([^\]]*)\]/, (_m, head: string, list: string) =>
        `${head}${list.split(',').map((x) => (x.trim() === String(from) ? x.replace(String(from), String(to)) : x)).join(',')}]`);
    out = out.slice(0, open) + renamed + out.slice(i + 1);
    at = out.indexOf(marker, open + renamed.length);
  }
  return out;
}

/** Rename one breakpoint in every `useResponsiveText(primary, { W: … }, [widths])` call — the
 *  override key and the width list entry, nothing else (AST-located splices). */
function renameResponsiveTextKeys(code: string, from: number, to: number): string {
  if (!code.includes('useResponsiveText(')) return code;
  const ast = parseJSX(code);
  if (!ast) return code;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const keyOf = (k: t.ObjectProperty['key']): number => (
    t.isNumericLiteral(k) ? k.value : t.isStringLiteral(k) ? Number(k.value) : t.isIdentifier(k) ? Number(k.name) : NaN
  );
  traverseAst(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee, { name: 'useResponsiveText' })) return;
      const [, overrides, widths] = path.node.arguments;
      if (overrides && t.isObjectExpression(overrides)) {
        for (const p of overrides.properties) {
          if (!t.isObjectProperty(p) || keyOf(p.key) !== from || p.key.start == null || p.key.end == null) continue;
          const text = t.isStringLiteral(p.key) ? JSON.stringify(String(to)) : String(to);
          edits.push({ start: p.key.start, end: p.key.end, text });
        }
      }
      if (widths && t.isArrayExpression(widths)) {
        for (const el of widths.elements) {
          if (el && t.isNumericLiteral(el) && el.value === from && el.start != null && el.end != null) {
            edits.push({ start: el.start, end: el.end, text: String(to) });
          }
        }
      }
    },
  });
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Rename one breakpoint's width key everywhere a width is a KEY (not a query). */
export function renameWidthKey(code: string, from: number, to: number): string {
  if (from === to) return code;
  let out = renameResponsiveAttrKeys(code, from, to);
  out = renameResponsiveTextKeys(out, from, to);
  out = rewriteListConfigBreakpoints(out, from, to);
  out = rewriteOverlayBreakpoints(out, from, to);
  out = rewriteRouteKeyBreakpoints(out, from, to);
  return out;
}

/** Drop one breakpoint's KEYED values — per-breakpoint text (`useResponsiveText` override + width
 *  list entry) and overlay config (`responsive` entry + `responsiveBp`). Removing a breakpoint in
 *  the start model hands its END to the next narrower one, so its own keys must go first or they
 *  would merge into that breakpoint's. (`data-responsive` and CMS list configs: removeResponsiveBreakpoint.) */
export function dropWidthKey(code: string, width: number): string {
  let out = code;
  if (out.includes('useResponsiveText(')) {
    const ast = parseJSX(out);
    if (ast) {
      const cuts: Array<{ start: number; end: number }> = [];
      const cutListItem = (items: Array<t.Node | null>, i: number) => {
        const node = items[i]!;
        const next = items[i + 1], prev = items[i - 1];
        if (next && next.start != null) cuts.push({ start: node.start!, end: next.start });
        else if (prev && prev.end != null) cuts.push({ start: prev.end, end: node.end! });
        else cuts.push({ start: node.start!, end: node.end! });
      };
      const keyOf = (k: t.ObjectProperty['key']): number => (
        t.isNumericLiteral(k) ? k.value : t.isStringLiteral(k) ? Number(k.value) : t.isIdentifier(k) ? Number(k.name) : NaN
      );
      traverseAst(ast, {
        CallExpression(path) {
          if (!t.isIdentifier(path.node.callee, { name: 'useResponsiveText' })) return;
          const [, overrides, widths] = path.node.arguments;
          if (overrides && t.isObjectExpression(overrides)) {
            const props = overrides.properties;
            props.forEach((p, i) => { if (t.isObjectProperty(p) && keyOf(p.key) === width) cutListItem(props, i); });
          }
          if (widths && t.isArrayExpression(widths)) {
            const els = widths.elements;
            els.forEach((el, i) => { if (el && t.isNumericLiteral(el) && el.value === width) cutListItem(els, i); });
          }
        },
      });
      for (const c of cuts.sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + out.slice(c.end);
    }
  }
  out = out.replace(/data-overlay='(\{[^']*\})'/g, (full, json: string) => {
    let cfg: { responsive?: Record<string, unknown>; responsiveBp?: number[] };
    try { cfg = JSON.parse(json); } catch { return full; }
    const had = !!cfg.responsive && cfg.responsive[String(width)] !== undefined;
    const inBp = Array.isArray(cfg.responsiveBp) && cfg.responsiveBp.includes(width);
    if (!had && !inBp) return full;
    if (had) delete cfg.responsive![String(width)];
    if (inBp) cfg.responsiveBp = cfg.responsiveBp!.filter((w) => w !== width);
    if (cfg.responsive && Object.keys(cfg.responsive).length === 0) { delete cfg.responsive; delete cfg.responsiveBp; }
    return `data-overlay='${JSON.stringify(cfg)}'`;
  });
  return out;
}

/** Copy one breakpoint's KEYED values to a new breakpoint width — per-breakpoint text, overlay
 *  config and CMS list config — so a breakpoint added inside another's range opens looking like
 *  that range did. (Bands: copyContainerRulesToNewWidth; `data-responsive`: addResponsiveBreakpoint.) */
export function copyWidthKey(code: string, from: number, to: number): string {
  if (from === to) return code;
  let out = code;
  if (out.includes('useResponsiveText(')) {
    const ast = parseJSX(out);
    if (ast) {
      const edits: Array<{ at: number; text: string }> = [];
      const keyOf = (k: t.ObjectProperty['key']): number => (
        t.isNumericLiteral(k) ? k.value : t.isStringLiteral(k) ? Number(k.value) : t.isIdentifier(k) ? Number(k.name) : NaN
      );
      traverseAst(ast, {
        CallExpression(path) {
          if (!t.isIdentifier(path.node.callee, { name: 'useResponsiveText' })) return;
          const [, overrides, widths] = path.node.arguments;
          if (!overrides || !t.isObjectExpression(overrides)) return;
          const src = overrides.properties.find((p): p is t.ObjectProperty => t.isObjectProperty(p) && keyOf(p.key) === from);
          if (!src || overrides.properties.some((p) => t.isObjectProperty(p) && keyOf(p.key) === to)) return;
          edits.push({ at: src.end!, text: `, ${to}: ${out.slice(src.value.start!, src.value.end!)}` });
          if (widths && t.isArrayExpression(widths) && !widths.elements.some((e) => t.isNumericLiteral(e) && e.value === to)) {
            const last = widths.elements[widths.elements.length - 1];
            if (last && last.end != null) edits.push({ at: last.end, text: `, ${to}` });
          }
        },
      });
      for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at);
    }
  }
  out = out.replace(/data-overlay='(\{[^']*\})'/g, (full, json: string) => {
    let cfg: { responsive?: Record<string, unknown>; responsiveBp?: number[] };
    try { cfg = JSON.parse(json); } catch { return full; }
    if (!cfg.responsive || cfg.responsive[String(from)] === undefined || cfg.responsive[String(to)] !== undefined) return full;
    cfg.responsive[String(to)] = JSON.parse(JSON.stringify(cfg.responsive[String(from)]));
    if (Array.isArray(cfg.responsiveBp) && !cfg.responsiveBp.includes(to)) cfg.responsiveBp = [...cfg.responsiveBp, to].sort((a, b) => a - b);
    return `data-overlay='${JSON.stringify(cfg)}'`;
  });
  return transformResponsiveListCalls(out, (p) => {
    if (p.vpOverrides[String(from)] !== undefined && p.vpOverrides[String(to)] === undefined) p.vpOverrides[String(to)] = p.vpOverrides[String(from)];
    if (p.vpWidths.includes(from) && !p.vpWidths.includes(to)) { p.vpWidths.push(to); p.vpWidths.sort((a, b) => a - b); }
  });
}
