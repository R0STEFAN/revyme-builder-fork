// template-route-gen.ts — NATIVE per-page resolution of a template's variables.
//
// A template (route-group `LayoutClient.tsx`) is a design-component master; its
// variables are function params with defaults. To let each PAGE under the
// template override them, the LayoutClient resolves a route→props map at RUNTIME
// via `usePathname()` and reassigns the params. This is REAL code in the
// ProjectFS — no build transform, no comment — so it resolves identically in:
//   • the deployed Next.js site (native usePathname),
//   • the pure-React preview (next-shims.tsx shims usePathname → location.pathname),
//   • the canvas (store.ts reads the SAME map and bakes values onto the merged
//     layout nodes, since the canvas Renderer doesn't run Next.js).
//
// Generated shape inside LayoutClient.tsx:
//   import { usePathname } from 'next/navigation';
//   const __templateProps = {"/":{"content":"hhhiu","joijoijoi":"#39CB2B"}};
//   export default function LayoutClient({ children, content = "Ready to change", joijoijoi = "#1e3c1b" }) {
//     const __tp = __templateProps[usePathname()] ?? {};
//     content = __tp.content ?? content;       // ← per-route override, else the param default
//     joijoijoi = __tp.joijoijoi ?? joijoijoi;
//     return ( … {content} … backgroundColor: joijoijoi … );
//   }
// The JSX usage of `content`/`joijoijoi` is UNCHANGED — only their value is
// route-resolved. Params stay params so @propMeta + the Template-tool reader
// (parseComponentInfoFromSource) keep working.

import { trace } from '@/shared/debug-trace';
import { ensureMediaGate, ensureMediaQueryHook, sweepOrphanMediaGates } from './scoped-expr';
import { parse } from '@babel/parser';
import * as t from '@babel/types';

import {
  MAP_RE,
  findTemplatePropsSpan,
  parseTemplateRouteMap,
  getTemplateRouteValues,
  substituteTemplateVarAttrsForCanvas,
  type RouteMap,
} from './template-route-parse';
export { parseTemplateRouteMap, getTemplateRouteValues, substituteTemplateVarAttrsForCanvas };

// Per-viewport template variables are stored in the SAME route map with a
// `@<width>` suffix on the key: `headerVariant` is the BASE (primary/desktop)
// value, `headerVariant@768` / `headerVariant@375` are per-breakpoint overrides
// (keyed by the replica viewport width, exactly like the responsive-attrs system
// keys per breakpoint). The deploy LayoutClient resolves them per-viewport via
// the shared `__mq` media-query gates (smallest-width-first, max-width cascade),
// the SAME mechanism responsive-attrs-gen uses. Splits a key into its base name
// and override width (or null width for a base key).
const VP_KEY_RE = /^(.+)@(\d+)$/;
export function splitViewportKey(key: string): { base: string; width: number | null } {
  const m = key.match(VP_KEY_RE);
  return m ? { base: m[1], width: parseInt(m[2], 10) } : { base: key, width: null };
}
/** Build a route-map key for a variable at a viewport: base key for the primary,
 *  `name@<width>` for a replica. */
export function viewportVarKey(varName: string, vpWidth: number | null): string {
  return vpWidth == null ? varName : `${varName}@${vpWidth}`;
}

// The resolve block's first line accepts BOTH the legacy exact-lookup form and the
// dynamic-aware matcher form, so regenerating an older LayoutClient UPGRADES it in place.
// The reassignment lines match BOTH the plain form (`v = __tp.v ?? v;`) AND the
// per-viewport `__mq`-gated form (`v = (__mq1 ? __tp['v@375'] : … : undefined) ?? __tp.v ?? v;`)
// — any single line that assigns an identifier and references `__tp` — so toggling a
// variable's responsiveness regenerates the whole block in place without leaving a stale line.
const RESOLVE_BLOCK_RE = /(?:[ \t]*const __mq\d+ = useMediaQuery\('[^']*'\);[ \t]*\r?\n)*[ \t]*const __tp = (?:__templateProps\[usePathname\(\)\] \?\? \{\}|__matchTemplateRoute\(usePathname\(\)\));(?:[ \t]*\r?\n[ \t]*[A-Za-z_$][\w$]* = [^\n]*__tp[^\n]*;)*[ \t]*\r?\n?/;

// Runtime route matcher supporting static routes, catch-all ([...slug]), optional catch-all,
// dynamic segments ([slug]), trailing slash normalization, and locale prefixes (e.g. /fr/about -> /about).
const MATCHER_SRC =
`const __matchTemplateRoute = (__p) => {
  if (!__p) return {};
  const __norm = (__path) => {
    const p = __path.replace(/\\/+$/, '');
    return p ? p : '/';
  };
  const __test = (__target) => {
    if (__templateProps[__target]) return __templateProps[__target];
    for (const __k in __templateProps) {
      if (__k.indexOf('[') === -1) {
        if (__norm(__k) === __norm(__target)) return __templateProps[__k];
        continue;
      }
      const __pat = '^' + __k
        .replace(/\\[\\.\\.\\.[^\\]]+\\]/g, '.+')
        .replace(/\\[[^\\]]+\\]/g, '[^/]+') + '/?$';
      if (new RegExp(__pat).test(__target)) return __templateProps[__k];
    }
    return null;
  };
  const __res = __test(__p);
  if (__res) return __res;
  const __locMatch = __p.match(/^\\/([a-z]{2,3}(?:-[A-Za-z0-9]+)?)(?:\\/(.*))?$/);
  if (__locMatch) {
    const __stripped = '/' + (__locMatch[2] || '');
    const __locRes = __test(__stripped);
    if (__locRes) return __locRes;
  }
  return {};
};
`;

const MATCHER_RE = /const __matchTemplateRoute = \(?__p\)?\s*=>\s*\{[\s\S]*?\n\};\n?/;

function ensureUsePathnameImport(code: string): string {
  if (/import\s*\{[^}]*\busePathname\b[^}]*\}\s*from\s*['"]next\/navigation['"]/.test(code)) return code;
  const line = `import { usePathname } from 'next/navigation';\n`;
  // Add after the next/link import if present, else after 'use client', else top.
  const nextLink = code.match(/import\s+\w+\s+from\s+['"]next\/link['"];?\n/);
  if (nextLink && nextLink.index !== undefined) {
    const at = nextLink.index + nextLink[0].length;
    return code.slice(0, at) + line + code.slice(at);
  }
  const uc = code.match(/^['"]use client['"];?\s*\n/m);
  if (uc && uc.index !== undefined) {
    const at = uc.index + uc[0].length;
    return code.slice(0, at) + '\n' + line + code.slice(at);
  }
  return line + code;
}

function ensureMapConst(code: string, map: RouteMap): string {
  const decl = `const __templateProps = ${JSON.stringify(map)};\n`;
  const span = findTemplatePropsSpan(code);
  if (span) {
    return code.slice(0, span.start) + decl + code.slice(span.end);
  }
  if (MAP_RE.test(code)) return code.replace(MAP_RE, decl);
  // Insert just before `export default function` (module scope).
  const exp = code.match(/\n(export default function )/);
  if (exp && exp.index !== undefined) {
    const at = exp.index + 1;
    return code.slice(0, at) + decl + code.slice(at);
  }
  return code + '\n' + decl;
}

function ensureMatcher(code: string): string {
  const count = (code.match(new RegExp(MATCHER_RE.source, 'g')) || []).length;
  if (count === 1) return code;
  const stripped = count >= 2 ? code.replace(new RegExp(MATCHER_RE.source, 'g'), '') : code;
  const span = findTemplatePropsSpan(stripped);
  if (span) {
    const at = span.end;
    return stripped.slice(0, at) + MATCHER_SRC + stripped.slice(at);
  }
  const m = stripped.match(MAP_RE);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return stripped.slice(0, at) + MATCHER_SRC + stripped.slice(at);
  }
  return stripped;
}

function findBodyOpenIndex(code: string): number {
  const fn = code.match(/export default function\s+\w+\s*\(/);
  if (!fn || fn.index === undefined) return -1;
  let i = fn.index + fn[0].length - 1; // at the '('
  let depth = 0, inStr = '';
  for (; i < code.length; i++) {
    const ch = code[i];
    if (inStr) { if (ch === inStr) inStr = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  // i = just after params ')'. The next '{' is the body open.
  const bodyOpen = code.indexOf('{', i);
  return bodyOpen === -1 ? -1 : bodyOpen + 1;
}

/** Insert/replace the runtime resolution block (the `__tp` lookup + one
 *  reassignment per template var) at the TOP of the LayoutClient body.
 *  TOP — not before `return` — because section vars are read inside scroll
 *  `getElementById(sectionVar)` useEffects that live EARLIER in the body; a
 *  before-return reassignment would run too late (they'd read the param
 *  default). usePathname() must also be the first hook anyway. */
function ensureResolveBlock(code: string, varNames: string[], map: RouteMap): string {
  const widthsByVar = new Map<string, number[]>();
  for (const route of Object.keys(map)) {
    for (const key of Object.keys(map[route])) {
      const { base, width } = splitViewportKey(key);
      if (width == null) continue;
      const arr = widthsByVar.get(base) ?? [];
      if (!arr.includes(width)) arr.push(width);
      widthsByVar.set(base, arr);
    }
  }

  const allWidths = [...new Set([...widthsByVar.values()].flat())].sort((a, b) => a - b);
  const anyResponsive = allWidths.length > 0;

  let out = code;
  if (anyResponsive) out = ensureMediaQueryHook(out);

  // Strip any old gates from the function body so they don't get placed after consumers or duplicate
  out = out.replace(/\n[ \t]*const __mq\d+ = useMediaQuery\([^\n]*\);/g, '');

  const gateVarByWidth = new Map<number, string>();
  const gateLines: string[] = [];
  allWidths.forEach((w, idx) => {
    const gateVar = `__mq${idx}`;
    gateVarByWidth.set(w, gateVar);
    gateLines.push(`  const ${gateVar} = useMediaQuery('(max-width: ${w}px)');`);
  });

  const reassign: string[] = [];
  for (const v of varNames) {
    const widths = (widthsByVar.get(v) ?? []).slice().sort((a, b) => a - b);
    if (widths.length === 0) {
      reassign.push(`  ${v} = __tp.${v} ?? ${v};`);
      continue;
    }
    const parts = widths.map(w => `(${gateVarByWidth.get(w)} ? __tp['${v}@${w}'] : undefined)`);
    if (parts.length === 1) {
      reassign.push(`  ${v} = ${parts[0]} ?? __tp.${v} ?? ${v};`);
    } else {
      reassign.push(`  ${v} = (${parts.join(' ?? ')}) ?? __tp.${v} ?? ${v};`);
    }
  }

  const lines = '\n' + [
    ...gateLines,
    `  const __tp = __matchTemplateRoute(usePathname());`,
    ...reassign,
  ].join('\n') + '\n';

  if (RESOLVE_BLOCK_RE.test(out)) {
    out = out.replace(RESOLVE_BLOCK_RE, varNames.length ? lines.replace(/^\n/, '') : '');
  } else if (varNames.length) {
    const insertAt = findBodyOpenIndex(out);
    if (insertAt !== -1) {
      out = out.slice(0, insertAt) + lines + out.slice(insertAt);
    }
  }

  return sweepOrphanMediaGates(out);
}

// Numeric transition fields — framer-motion needs these as NUMBERS, not strings.
const TRANSITION_NUM_KEYS = new Set(['duration', 'delay', 'stiffness', 'damping', 'mass', 'bounce']);

function getParamDefaultKinds(code: string): Map<string, 'boolean' | 'number' | 'string' | 'object'> {
  const kinds = new Map<string, 'boolean' | 'number' | 'string' | 'object'>();
  try {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    for (const stmt of ast.program.body) {
      let fn: t.FunctionDeclaration | null = null;
      if (t.isExportDefaultDeclaration(stmt)) {
        if (t.isFunctionDeclaration(stmt.declaration)) fn = stmt.declaration;
      }
      if (fn && fn.params.length > 0) {
        const first = fn.params[0];
        if (t.isObjectPattern(first)) {
          for (const prop of first.properties) {
            if (t.isObjectProperty(prop) && t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
              const name = prop.value.left.name;
              const right = prop.value.right;
              if (t.isBooleanLiteral(right)) kinds.set(name, 'boolean');
              else if (t.isNumericLiteral(right)) kinds.set(name, 'number');
              else if (t.isStringLiteral(right)) kinds.set(name, 'string');
              else if (t.isObjectExpression(right)) kinds.set(name, 'object');
            }
          }
        }
      }
    }
  } catch {}
  return kinds;
}

function coerceRouteValue(value: any, expectedKind?: 'boolean' | 'number' | 'string' | 'object'): any {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (value == null) return value;
  const str = String(value).trim();

  if (expectedKind === 'boolean') {
    if (str === 'false') return false;
    if (str === 'true') return true;
  }
  if (expectedKind === 'number') {
    if (str !== '' && !Number.isNaN(Number(str))) {
      if (/^-?\d+(\.\d+)?$/.test(str) && (!str.startsWith('0') || str === '0' || str.startsWith('0.'))) {
        return Number(str);
      }
    }
  }

  if (str[0] !== '{') return value;
  try {
    const obj = JSON.parse(str);
    if (!obj || typeof obj !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = (TRANSITION_NUM_KEYS.has(k) && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) ? Number(v) : v;
    }
    return out;
  } catch {
    return value;
  }
}

export function setTemplateRouteValueInCode(
  code: string, route: string, varName: string, value: any, varNames: string[],
): string {
  const map = parseTemplateRouteMap(code);
  const paramKinds = getParamDefaultKinds(code);
  const { base } = splitViewportKey(varName);
  const kind = paramKinds.get(base);

  if (value === '' || value == null) {
    if (map[route]) { delete map[route][varName]; if (Object.keys(map[route]).length === 0) delete map[route]; }
  } else {
    map[route] = { ...(map[route] ?? {}), [varName]: coerceRouteValue(value, kind) };
  }
  let out = ensureUsePathnameImport(code);
  out = ensureMapConst(out, map);
  out = ensureMatcher(out);
  out = ensureResolveBlock(out, varNames, map);
  trace.action('template-route:set', { route, varName, hasValue: value !== '' && value != null });
  return out;
}

/** Resolve the EFFECTIVE value of a template variable for a viewport: the
 *  per-viewport override (`name@<width>`) if present, else the base value, else
 *  ''. `vpWidth` null = the primary/base value. Mirrors the deploy ternary's
 *  fall-through so the Template tool's input shows what the page will render. */
export function getTemplateRouteValueForViewport(
  code: string, route: string, varName: string, vpWidth: number | null,
): any {
  const entry = parseTemplateRouteMap(code)[route] ?? {};
  if (vpWidth != null) {
    const override = entry[`${varName}@${vpWidth}`];
    if (override !== undefined) return override;
  }
  return entry[varName] ?? '';
}

/** Whether a template variable has an explicit per-viewport override for
 *  `vpWidth` on this route (drives the blue "overridden" label + reset action,
 *  exactly like a responsive style override). False for the primary (no width). */
export function hasViewportOverride(
  code: string, route: string, varName: string, vpWidth: number | null,
): boolean {
  if (vpWidth == null) return false;
  const entry = parseTemplateRouteMap(code)[route] ?? {};
  return entry[`${varName}@${vpWidth}`] !== undefined;
}

/**
 * Drop a template variable from EVERY route in the `__templateProps` map (used
 * when the variable is deleted). JSON-based so it's robust to value type
 * (string/number/bool). Empties become removed routes; an empty map collapses to
 * `{}`. The variable's reassignment line in the resolve block is removed
 * separately by `deleteComponentVariableInCode`. No-op when there's no map
 * (non-template files / nothing to clean).
 */
export function removeTemplateVarFromCode(code: string, varName: string): string {
  const map = parseTemplateRouteMap(code);
  const routes = Object.keys(map);
  if (!routes.length) return code;
  let touched = false;
  for (const route of routes) {
    // Drop the base key AND every per-viewport override (`varName@<width>`) so a
    // deleted variable leaves no orphan responsive entry behind.
    for (const key of Object.keys(map[route])) {
      if (splitViewportKey(key).base === varName) {
        delete map[route][key];
        touched = true;
      }
    }
    if (Object.keys(map[route]).length === 0) delete map[route];
  }
  if (!touched) return code;
  trace.action('template-route:remove-var', { varName });
  // The deleted var's reassignment line went with `deleteComponentVariableInCode`;
  // sweep any `__mq` gate it was the last consumer of.
  return sweepOrphanMediaGates(ensureMapConst(code, map));
}

/**
 * Re-key a route in `__templateProps` (e.g. when a page slug / URL changes).
 * Preserves all variables and responsive overrides.
 */
export function renameTemplateRouteInCode(code: string, oldRoute: string, newRoute: string): string {
  const map = parseTemplateRouteMap(code);
  if (!map[oldRoute]) return code;
  const oldVals = map[oldRoute];
  delete map[oldRoute];
  map[newRoute] = { ...oldVals, ...(map[newRoute] ?? {}) };
  trace.action('template-route:rename-route', { oldRoute, newRoute });
  return ensureMapConst(code, map);
}
