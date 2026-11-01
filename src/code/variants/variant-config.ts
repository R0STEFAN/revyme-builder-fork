// variant-config.ts — Parse/serialize variant metadata from component files.
//
// Variants are framer-motion visual states. Each variant has a name and a canvas
// position (where it's rendered on the master page). NO width — variants are not
// width-based. Each block renders at the component's root element width.
//
// Stored as `const variantConfig = [...]` at the top of the component file.

import { trace } from '@/shared/debug-trace';
import { parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import { findBalancedDelimiterEnd, quoteStyleValue } from '../generation/generator-utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VariantConfig {
  name: string;        // unique internal ID: 'default', 'variant-1', 'variant-2'
  label: string;       // user-facing display name: 'Desktop', 'Hover', 'Open' (renameable, duplicates OK)
  x: number;           // canvas position on master page
  y: number;
  isPrimary?: boolean; // first variant = primary (source of truth styles)
  // Interaction-state metadata. When set, this variant is a special
  // hover/pressed state cascading from `parentVariant`. The runtime
  // treats it as a normal variant (it has its own entry in every
  // `xxxVariants` object and can be a `connections` endpoint), but the
  // canvas UI uses this flag to position the Hover/Pressed buttons,
  // suppress duplicate creation, and resolve "selected interaction
  // state" → "source variant" when wiring further connections.
  interactionType?: 'hover' | 'pressed';
  parentVariant?: string;
}

// ─── Default Config ─────────────────────────────────────────────────────────

export function createDefaultVariantConfig(): VariantConfig[] {
  return [{ name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true }];
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse variant config from a component file's code.
 * Looks for: const variantConfig = [...];
 * Falls back to a single default variant if not found.
 */
export function parseVariantConfig(code: string): VariantConfig[] {
  // Match: const variantConfig = [...];
  const match = /const\s+variantConfig\s*=\s*(?=\[)/.exec(code);
  if (!match) {
    return createDefaultVariantConfig();
  }

  try {
    const start = match.index + match[0].length;
    const end = findBalancedDelimiterEnd(code, start, '[', ']');
    if (end < 0) return createDefaultVariantConfig();
    const expression = parseExpression(code.slice(start, end));
    if (!t.isArrayExpression(expression)) return createDefaultVariantConfig();
    const parsed = expression.elements.map(element => {
      if (!t.isObjectExpression(element)) throw new Error('Variant metadata must be literal objects');
      return Object.fromEntries(element.properties.map(property => {
        if (!t.isObjectProperty(property) || property.computed || !(t.isIdentifier(property.key) || t.isStringLiteral(property.key))) throw new Error('Variant metadata keys must be literal');
        const value = property.value;
        if (t.isUnaryExpression(value) && (value.operator === '-' || value.operator === '+') && t.isNumericLiteral(value.argument)) {
          return [t.isIdentifier(property.key) ? property.key.name : property.key.value, value.operator === '-' ? -value.argument.value : value.argument.value];
        }
        if (!(t.isStringLiteral(value) || t.isNumericLiteral(value) || t.isBooleanLiteral(value))) throw new Error('Variant metadata values must be literal');
        return [t.isIdentifier(property.key) ? property.key.name : property.key.value, value.value];
      }));
    }) as Array<{
      name: string;
      label?: string;
      x?: number;
      y?: number;
      isPrimary?: boolean;
      interactionType?: 'hover' | 'pressed';
      parentVariant?: string;
    }>;

    return parsed.map((v, i) => {
      const out: VariantConfig = {
        name: v.name,
        label: v.label ?? v.name,
        x: v.x ?? 0,
        y: v.y ?? (i * 400),
        isPrimary: v.isPrimary ?? i === 0,
      };
      if (v.interactionType) out.interactionType = v.interactionType;
      if (v.parentVariant) out.parentVariant = v.parentVariant;
      return out;
    });
  } catch (e) {
    trace.error('variant-config:parse-failed', { error: String(e) });
    return createDefaultVariantConfig();
  }
}

/**
 * Serialize variant config back into code.
 */
export function serializeVariantConfig(variants: VariantConfig[]): string {
  const entries = variants.map(v => {
    const parts = [
      `name: ${quoteStyleValue(v.name)}`,
      `label: ${quoteStyleValue(v.label)}`,
      `x: ${Math.round(v.x)}`,
      `y: ${Math.round(v.y)}`,
    ];
    if (v.isPrimary) parts.push('isPrimary: true');
    if (v.interactionType) parts.push(`interactionType: '${v.interactionType}'`);
    if (v.parentVariant) parts.push(`parentVariant: '${v.parentVariant}'`);
    return `  { ${parts.join(', ')} }`;
  });
  return `const variantConfig = [\n${entries.join(',\n')},\n];`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** True iff `parentVariant` already has the given interaction state. */
export function hasInteractionState(
  configs: VariantConfig[],
  parentVariant: string,
  type: 'hover' | 'pressed',
): boolean {
  return configs.some(v => v.parentVariant === parentVariant && v.interactionType === type);
}

/** All interaction-state entries that cascade from `parentVariant`. */
export function getInteractionStatesForVariant(
  configs: VariantConfig[],
  parentVariant: string,
): VariantConfig[] {
  return configs.filter(v => v.parentVariant === parentVariant && !!v.interactionType);
}

/**
 * The variants a user can SELECT on an instance — REAL/base variants only (Desktop/Tablet/Phone/…),
 * EXCLUDING interaction states (hover/pressed). design-tool parity: the instance "Variant" dropdown never
 * lists "· Hover" / "· Pressed" — those are applied on interaction, not chosen as a base variant. Use
 * this for EVERY variant SELECT (instance tool, variable modal Default, Template tool), never for the
 * variant-EDITING UI (which needs the interaction states).
 */
export function selectableVariants<T extends { interactionType?: 'hover' | 'pressed' }>(configs: T[]): T[] {
  return configs.filter(v => !v.interactionType);
}
