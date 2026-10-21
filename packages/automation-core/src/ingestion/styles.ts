// packages/automation-core/src/ingestion/styles.ts
import type { IngestionReporter } from './report';
import { lowerUnits, type UnitContext } from './units';

export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function toKebabCase(str: string): string {
  return str.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

export function normalizeStyles(
  styles: Record<string, string | number>,
  context: UnitContext = {},
  reporter?: IngestionReporter,
  target = 'style'
): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};

  for (const [key, rawValue] of Object.entries(styles)) {
    const camelKey = toCamelCase(key);

    // Empty string means delete property (Revyme invariant 3)
    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      reporter?.recordNormalization(
        'DELETE_STYLE_PROPERTY',
        `${target}.${camelKey}`,
        String(rawValue),
        ''
      );
      continue;
    }

    if (typeof rawValue === 'number') {
      normalized[camelKey] = rawValue;
      continue;
    }

    const trimmed = String(rawValue).trim();
    if (trimmed === '') {
      continue;
    }

    const lowered = lowerUnits(trimmed, context, reporter, `${target}.${camelKey}`);
    normalized[camelKey] = lowered;
  }

  return normalized;
}
