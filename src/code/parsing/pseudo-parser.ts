// pseudo-parser.ts — Parse CSS ::before/::after/::placeholder and interactive state rules from style blocks.

import { toCamel } from '@/shared/css-utils';
import { trace } from '@/shared/debug-trace';

export const BUILTIN_PSEUDO_ELEMENTS = ['before', 'after', 'placeholder'] as const;
export const BUILTIN_PSEUDO_STATES = [
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
  'disabled',
  'checked',
] as const;

export type BuiltinPseudoElement = typeof BUILTIN_PSEUDO_ELEMENTS[number];
export type BuiltinPseudoState = typeof BUILTIN_PSEUDO_STATES[number];
export type CustomPseudoKey = `custom:${string}`;

/** Pseudo selectors the editor owns (`::before`/`::after`/`::placeholder`, interactive states, or `custom:<suffix>`). */
export type PseudoKind = BuiltinPseudoElement | BuiltinPseudoState | CustomPseudoKey;

export type PseudoStyles = Partial<Record<PseudoKind, Record<string, string>>>;

const PSEUDO_ELEMENT_SET = new Set<string>(BUILTIN_PSEUDO_ELEMENTS);
const PSEUDO_STATE_SET = new Set<string>(BUILTIN_PSEUDO_STATES);

/**
 * Validate a node-scoped custom suffix attached directly to `[data-id="..."]`
 * (forbids descendant combinators, spaces, braces, or foreign selectors).
 */
export function isValidCustomPseudoSuffix(suffix: string): boolean {
  const trimmed = suffix.trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (/[\s{}$;,]/.test(trimmed)) return false;
  if (!trimmed.startsWith(':') && !trimmed.startsWith('[')) return false;
  return /^(?:::[a-z-]+|:[a-z-]+(?:\([^(){}]*\))?|\[[a-zA-Z0-9_-]+(?:[~|^$*]?=(?:"[^"{}]*"|'[^'{}]*'|[^\]{}\s]+))?\])+$/.test(trimmed);
}

/** Normalize raw pseudo selector / name (e.g. `:hover`, `::before`, `:nth-child(2n)`) into `PseudoKind`. */
export function normalizePseudoKind(raw: string): PseudoKind | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('custom:')) {
    const suffix = trimmed.slice('custom:'.length).trim();
    return isValidCustomPseudoSuffix(suffix) ? `custom:${suffix}` : null;
  }
  const stripped = trimmed.replace(/^:+/, '');
  if (PSEUDO_ELEMENT_SET.has(stripped) && !trimmed.startsWith('[')) {
    return stripped as BuiltinPseudoElement;
  }
  if (PSEUDO_STATE_SET.has(stripped) && !trimmed.startsWith('[')) {
    return stripped as BuiltinPseudoState;
  }
  const candidate = trimmed.startsWith(':') || trimmed.startsWith('[') ? trimmed : `:${trimmed}`;
  return isValidCustomPseudoSuffix(candidate) ? `custom:${candidate}` : null;
}

export function parsePseudoRules(css: string): Map<string, PseudoStyles> {
  const result = new Map<string, PseudoStyles>();
  if (!css) return result;

  const ruleRx = /\[data-id="([^"]+)"\]((?:::[a-z-]+|:[a-z-]+(?:\([^(){}]*\))?|\[[^\]{}\s]+\])+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = ruleRx.exec(css)) !== null) {
    const nodeId = match[1];
    const pseudo = normalizePseudoKind(match[2]);
    if (!pseudo) continue;
    const declBlock = match[3];
    const props: Record<string, string> = {};

    const decls = declBlock.split(';').map(d => d.trim()).filter(Boolean);
    for (const decl of decls) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = decl.slice(0, colonIdx).trim();
      let value = decl.slice(colonIdx + 1).trim();
      value = value.replace(/\s*!important\s*$/, '').trim();
      if (prop && value) {
        props[toCamel(prop)] = value;
      }
    }

    if (Object.keys(props).length > 0) {
      const existing = result.get(nodeId) || {};
      existing[pseudo] = props;
      result.set(nodeId, existing);
    }
  }

  trace.fn('pseudo-parser:parsePseudoRules', { ruleCount: result.size });
  return result;
}
