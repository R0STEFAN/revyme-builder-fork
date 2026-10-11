// template-route-parse.ts — READ side of the template per-page-values
// system (leaf module: imports only trace). Parses the `__templateProps`
// strict-JSON route map out of a LayoutClient and resolves per-route
// values. Extracted from template-route-gen.ts so code/stores/store.ts
// can read route values without pulling the WRITE side's generator-motion
// dependency into a stores↔generation cycle. template-route-gen re-exports
// everything here for its own callers.

import { trace } from '@/shared/debug-trace';

export type RouteMap = Record<string, Record<string, any>>;

// The map is stored as a strict-JSON object literal (valid JS) so values with
// commas/quotes (colors, gradients) round-trip safely via JSON.parse/stringify.
export const MAP_RE = /const __templateProps = (\{[\s\S]*?\});\n?/;

export interface TemplatePropsSpan {
  start: number;
  end: number;
  jsonStart: number;
  jsonEnd: number;
  jsonString: string;
}

/** Find the full extent of `const __templateProps = {...};` accounting for quotes and nested braces. */
export function findTemplatePropsSpan(code: string): TemplatePropsSpan | null {
  const match = code.match(/(?:^|\n)([ \t]*const __templateProps\s*=\s*)/);
  if (!match || match.index === undefined) return null;
  const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
  const jsonStart = start + match[1].length;
  if (code[jsonStart] !== '{') return null;

  let depth = 0;
  let inString: string | null = null;
  let escape = false;
  let jsonEnd = -1;

  for (let i = jsonStart; i < code.length; i++) {
    const ch = code[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (jsonEnd === -1) return null;

  let end = jsonEnd;
  while (end < code.length && (code[end] === ' ' || code[end] === '\t')) end++;
  if (end < code.length && code[end] === ';') end++;
  if (end < code.length && code[end] === '\r') end++;
  if (end < code.length && code[end] === '\n') end++;

  return {
    start,
    end,
    jsonStart,
    jsonEnd,
    jsonString: code.slice(jsonStart, jsonEnd),
  };
}

export function parseTemplateRouteMap(code: string): RouteMap {
  const span = findTemplatePropsSpan(code);
  if (!span) {
    const m = code.match(MAP_RE);
    if (!m) return {};
    try { return JSON.parse(m[1]) as RouteMap; }
    catch { return {}; }
  }
  try { return JSON.parse(span.jsonString) as RouteMap; }
  catch (e) { trace.error('template-route:parse-failed', { error: String(e) }); return {}; }
}

/** The per-page values for one route (e.g. '/' or '/about'). */
export function getTemplateRouteValues(code: string, route: string): Record<string, any> {
  return parseTemplateRouteMap(code)[route] ?? {};
}

/**
 * CANVAS-ONLY resolution: bake each template variable's per-page value into the
 * JSX ATTRIBUTE EXPRESSIONS that reference it (`prop={varName}` → `prop={"value"}`).
 *
 * The deploy + preview resolve template vars at RUNTIME (usePathname reassigns
 * the params), but the canvas Renderer doesn't run Next.js — so when a template
 * var is passed INTO a component instance (`<Frame color={myVar}/>`), the canvas
 * parser would expand the instance with the var's plain DEFAULT, never the
 * per-page route value. Substituting the attr expression with the resolved value
 * BEFORE the parser expands the instance makes `expandComponent` carry the
 * per-page value into the instance's internals.
 *
 * Scope is deliberately narrow — only `={varName}` (attribute expression
 * containers). Direct `style={{ cssProp: varName }}` and text `{varName}`
 * bindings on layout nodes are handled separately by `resolveInstancePropOverrides`,
 * and the param declaration / `__templateProps` map / `usePathname` reassignment
 * never use the `={var}` shape, so they're untouched. No-op when `routeValues` is
 * empty (untemplated pages stay byte-identical).
 */
export function substituteTemplateVarAttrsForCanvas(code: string, routeValues: Record<string, string>): string {
  let out = code;
  for (const [name, value] of Object.entries(routeValues)) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`=\\{\\s*${esc}\\s*\\}`, 'g'), `={${JSON.stringify(value)}}`);
  }
  return out;
}
