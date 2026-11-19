// packages/automation-core/src/ingestion/styles.ts
import type { IngestionReporter } from './report';
import { lowerUnits, type UnitContext } from './units';

export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function toKebabCase(str: string): string {
  return str.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

const PIN_OFFSET_KEYS = new Set(['top', 'right', 'bottom', 'left']);

const SHORTHAND_ORDER_RANK: Record<string, number> = {
  border: 0,
  borderWidth: 1,
  borderColor: 1,
  borderStyle: 1,
  padding: 0,
  margin: 0,
  borderRadius: 0,
  gap: 0,
  overflow: 0,
};

const TWO_SIDED_LOGICAL_MAP: Record<string, { sides: [string, string]; isPin?: boolean }> = {
  paddingInline: { sides: ['paddingLeft', 'paddingRight'] },
  paddingBlock: { sides: ['paddingTop', 'paddingBottom'] },
  marginInline: { sides: ['marginLeft', 'marginRight'] },
  marginBlock: { sides: ['marginTop', 'marginBottom'] },
  insetInline: { sides: ['left', 'right'], isPin: true },
  insetBlock: { sides: ['top', 'bottom'], isPin: true },
};

const SINGLE_SIDE_LOGICAL_MAP: Record<string, { target: string; isPin?: boolean }> = {
  paddingInlineStart: { target: 'paddingLeft' },
  paddingInlineEnd: { target: 'paddingRight' },
  paddingBlockStart: { target: 'paddingTop' },
  paddingBlockEnd: { target: 'paddingBottom' },
  marginInlineStart: { target: 'marginLeft' },
  marginInlineEnd: { target: 'marginRight' },
  marginBlockStart: { target: 'marginTop' },
  marginBlockEnd: { target: 'marginBottom' },
  insetInlineStart: { target: 'left', isPin: true },
  insetInlineEnd: { target: 'right', isPin: true },
  insetBlockStart: { target: 'top', isPin: true },
  insetBlockEnd: { target: 'bottom', isPin: true },
};

function splitTopLevelWhitespace(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0 && /\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

function hasTopLevelCommaOrWhitespace(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ',' || /\s/.test(ch))) return true;
  }
  return false;
}

function isSolidBackgroundColor(value: string): boolean {
  if (!value) return false;
  if (/(gradient|url|image-set)\s*\(/i.test(value)) return false;
  if (/^(none|auto|inherit|initial|unset|revert)$/i.test(value)) return false;
  return !hasTopLevelCommaOrWhitespace(value);
}

function formatPinValue(value: string): string {
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    return `${value}px`;
  }
  return value;
}

export function normalizeStyles(
  styles: Record<string, string | number>,
  context: UnitContext = {},
  reporter?: IngestionReporter,
  target = 'style'
): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};
  const explicitKeys = new Set(Object.keys(styles).map((k) => toCamelCase(k)));

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

    // Strip CSS transition* properties (Revyme uses Framer Motion / motion props)
    if (/^transition(Property|Duration|Delay|TimingFunction)?$/.test(camelKey)) {
      reporter?.recordNormalization(
        'STRIP_CSS_TRANSITION',
        `${target}.${camelKey}`,
        String(rawValue),
        ''
      );
      continue;
    }

    // Expand inset shorthand into top/right/bottom/left for explicit edges
    if (camelKey === 'inset') {
      const rawStr = typeof rawValue === 'number' ? `${rawValue}px` : String(rawValue).trim();
      const parts = splitTopLevelWhitespace(rawStr);
      if (parts.length >= 1 && parts.length <= 4) {
        const [p0, p1 = p0, p2 = p0, p3 = p1] = parts;
        const expanded: Array<[string, string]> = [
          ['top', p0],
          ['right', p1],
          ['bottom', p2],
          ['left', p3],
        ];
        for (const [side, sideRaw] of expanded) {
          if (explicitKeys.has(side) && normalized[side] !== undefined) continue;
          if (explicitKeys.has(side) && (styles[side] !== undefined && styles[side] !== '')) continue;
          const formatted = formatPinValue(sideRaw);
          normalized[side] = lowerUnits(formatted, context, reporter, `${target}.${side}`);
        }
        reporter?.recordNormalization('EXPAND_INSET_SHORTHAND', `${target}.inset`, String(rawValue), rawStr);
        continue;
      }
    }

    // Expand 2-sided logical spacing/inset properties (paddingInline, marginBlock, insetInline, etc.)
    const twoSidedLogical = TWO_SIDED_LOGICAL_MAP[camelKey];
    if (twoSidedLogical) {
      const rawStr = typeof rawValue === 'number' ? `${rawValue}px` : String(rawValue).trim();
      const parts = splitTopLevelWhitespace(rawStr);
      if (parts.length >= 1 && parts.length <= 2) {
        const [startRaw, endRaw = startRaw] = parts;
        const [startSide, endSide] = twoSidedLogical.sides;
        const expanded: Array<[string, string]> = [
          [startSide, startRaw],
          [endSide, endRaw],
        ];
        for (const [side, sideRaw] of expanded) {
          if (explicitKeys.has(side) && (normalized[side] !== undefined || (styles[side] !== undefined && styles[side] !== ''))) {
            continue;
          }
          const formatted = twoSidedLogical.isPin ? formatPinValue(sideRaw) : sideRaw;
          const finalVal = formatted.toLowerCase() === 'transparent' ? 'rgba(0, 0, 0, 0)' : formatted;
          normalized[side] = lowerUnits(finalVal, context, reporter, `${target}.${side}`);
        }
        reporter?.recordNormalization('EXPAND_LOGICAL_PROPERTY', `${target}.${camelKey}`, String(rawValue), twoSidedLogical.sides.join(','));
        continue;
      }
    }

    // Expand single-side logical spacing/inset properties (paddingInlineStart -> paddingLeft, etc.)
    const singleSideLogical = SINGLE_SIDE_LOGICAL_MAP[camelKey];
    if (singleSideLogical) {
      const side = singleSideLogical.target;
      if (!(explicitKeys.has(side) && (normalized[side] !== undefined || (styles[side] !== undefined && styles[side] !== '')))) {
        const rawStr = typeof rawValue === 'number' ? `${rawValue}px` : String(rawValue).trim();
        const formatted = singleSideLogical.isPin ? formatPinValue(rawStr) : rawStr;
        const finalVal = formatted.toLowerCase() === 'transparent' ? 'rgba(0, 0, 0, 0)' : formatted;
        normalized[side] = lowerUnits(finalVal, context, reporter, `${target}.${side}`);
        reporter?.recordNormalization('EXPAND_LOGICAL_PROPERTY', `${target}.${camelKey}`, String(rawValue), side);
      }
      continue;
    }

    if (typeof rawValue === 'number') {
      if (PIN_OFFSET_KEYS.has(camelKey)) {
        const px = `${rawValue}px`;
        reporter?.recordNormalization('FORMAT_PIN_OFFSET', `${target}.${camelKey}`, String(rawValue), px);
        normalized[camelKey] = px;
        continue;
      }
      if (camelKey === 'order') {
        const asString = String(rawValue);
        reporter?.recordNormalization('STRINGIFY_FLEX_ORDER', `${target}.order`, String(rawValue), asString);
        normalized[camelKey] = asString;
        continue;
      }
      normalized[camelKey] = rawValue;
      continue;
    }

    let trimmed = String(rawValue).trim();
    if (trimmed === '') {
      continue;
    }

    if (camelKey === 'lineHeight' && trimmed.includes('/*')) {
      const stripped = trimmed.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (stripped !== trimmed) {
        reporter?.recordNormalization('STRIP_LINE_HEIGHT_COMMENT', `${target}.lineHeight`, trimmed, stripped);
        trimmed = stripped;
      }
      if (trimmed === '') {
        continue;
      }
    }

    if ((camelKey === 'height' || camelKey === 'minHeight') && trimmed === 'min-content') {
      reporter?.recordNormalization('NORMALIZE_MIN_CONTENT_HEIGHT', `${target}.${camelKey}`, trimmed, 'auto');
      trimmed = 'auto';
    }

    if (trimmed.toLowerCase() === 'transparent') {
      reporter?.recordNormalization('NORMALIZE_TRANSPARENT_COLOR', `${target}.${camelKey}`, trimmed, 'rgba(0, 0, 0, 0)');
      trimmed = 'rgba(0, 0, 0, 0)';
    }

    if (PIN_OFFSET_KEYS.has(camelKey) && trimmed === '0') {
      reporter?.recordNormalization('FORMAT_PIN_OFFSET', `${target}.${camelKey}`, trimmed, '0px');
      trimmed = '0px';
    }

    const lowered = lowerUnits(trimmed, context, reporter, `${target}.${camelKey}`);

    if (
      camelKey === 'background' &&
      isSolidBackgroundColor(trimmed) &&
      (!explicitKeys.has('backgroundColor') || styles.backgroundColor === '' || styles['background-color'] === '') &&
      normalized.backgroundColor === undefined
    ) {
      reporter?.recordNormalization('NORMALIZE_SOLID_BACKGROUND', `${target}.background`, trimmed, String(lowered));
      normalized.backgroundColor = lowered;
      continue;
    }

    normalized[camelKey] = lowered;
  }

  // Auto-fold backgroundColor + backgroundImage into a bottom linear-gradient layer (BG_COLOR_WITH_IMAGE)
  const bgc = normalized.backgroundColor;
  const bgi = normalized.backgroundImage;
  if (
    typeof bgc === 'string' &&
    bgc.length > 0 &&
    typeof bgi === 'string' &&
    bgi.length > 0 &&
    bgi.toLowerCase() !== 'none'
  ) {
    normalized.backgroundImage = `${bgi}, linear-gradient(${bgc}, ${bgc})`;
    delete normalized.backgroundColor;
    reporter?.recordNormalization('FOLD_BG_COLOR_INTO_IMAGE', `${target}.backgroundImage`, bgc, String(normalized.backgroundImage));
  }

  // Ensure shorthand properties precede longhand properties in key iteration order (STYLE_SHORTHAND_LONGHAND_MIX)
  const entries = Object.entries(normalized);
  if (entries.length > 1) {
    const sorted = entries.sort(([keyA], [keyB]) => {
      const rankA = SHORTHAND_ORDER_RANK[keyA] ?? 10;
      const rankB = SHORTHAND_ORDER_RANK[keyB] ?? 10;
      return rankA - rankB;
    });
    const reordered: Record<string, string | number> = {};
    for (const [k, v] of sorted) {
      reordered[k] = v;
    }
    return reordered;
  }

  return normalized;
}

/**
 * Normalize an MCP style update patch while preserving empty string ('') deletion entries.
 */
export function normalizeStylePatch(
  styles: Record<string, string>,
  context: UnitContext = {},
  reporter?: IngestionReporter,
  target = 'style'
): Record<string, string> {
  const nonEmpty: Record<string, string | number> = {};
  const deletions: string[] = [];

  for (const [key, value] of Object.entries(styles)) {
    const camelKey = toCamelCase(key);
    if (value === '') {
      deletions.push(camelKey);
    } else {
      nonEmpty[camelKey] = value;
    }
  }

  const normalized = normalizeStyles(nonEmpty, context, reporter, target);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(normalized)) {
    out[key] = String(value);
  }
  for (const key of deletions) {
    out[key] = '';
  }
  return out;
}
