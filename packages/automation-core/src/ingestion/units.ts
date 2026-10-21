// packages/automation-core/src/ingestion/units.ts
import type { IngestionReporter } from './report';

export interface UnitContext {
  rootFontSize?: number;
  elementFontSize?: number;
  parentFontSize?: number;
}

export function lowerUnits(
  value: string,
  context: UnitContext = {},
  reporter?: IngestionReporter,
  target = 'style'
): string {
  if (!value || typeof value !== 'string') return value;

  // 1. Lower rem units: e.g. 1.5rem -> 24px (at 16px root)
  const remRegex = /(-?\d*\.?\d+)rem\b/g;
  let hasRem = false;
  let matches = [...value.matchAll(remRegex)];

  if (matches.length > 0) {
    if (context.rootFontSize === undefined) {
      reporter?.recordIssue(
        'MISSING_ROOT_FONT_CONTEXT',
        [target],
        `Cannot accurately lower rem unit in "${value}" without known root font size context.`
      );
      return value;
    }

    const root = context.rootFontSize;
    const lowered = value.replace(remRegex, (_match, numStr) => {
      const num = parseFloat(numStr);
      const px = Math.round(num * root * 1000) / 1000;
      return `${px}px`;
    });

    if (lowered !== value) {
      reporter?.recordNormalization('LOWER_REM_UNIT', target, value, lowered);
      value = lowered;
    }
  }

  // 2. Lower em units: e.g. 2em -> 36px (at 18px base)
  const emRegex = /(-?\d*\.?\d+)em\b/g;
  const emMatches = [...value.matchAll(emRegex)];

  if (emMatches.length > 0) {
    const baseFont = context.elementFontSize ?? context.parentFontSize;
    if (baseFont === undefined) {
      // em remains relative if no local font context is available
      return value;
    }

    const lowered = value.replace(emRegex, (_match, numStr) => {
      const num = parseFloat(numStr);
      const px = Math.round(num * baseFont * 1000) / 1000;
      return `${px}px`;
    });

    if (lowered !== value) {
      reporter?.recordNormalization('LOWER_EM_UNIT', target, value, lowered);
      value = lowered;
    }
  }

  return value;
}
