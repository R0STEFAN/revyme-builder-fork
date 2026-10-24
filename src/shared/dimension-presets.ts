import { trace } from '@/shared/debug-trace';
import type { PresetToken } from '@/shared/types';

export type DimensionPresetCategory = 'spacing' | 'margin' | 'radius';
export type DimensionPresetTier = 'base' | 'md' | 'sm';

export interface DimensionPresetTokenWriteValidation {
  category: DimensionPresetCategory | null;
  error: string | null;
}

export interface DimensionPresetGroup {
  /** Token slug without the category prefix or responsive tier suffix. */
  name: string;
  category: DimensionPresetCategory;
  label: string;
  tokens: PresetToken[];
  base: PresetToken;
  md?: PresetToken;
  sm?: PresetToken;
}

export interface DimensionPresetApplyPlan {
  baseStyles: Record<string, string>;
  responsive: Array<{ maxWidth: number; styles: Record<string, string> }>;
}

const CATEGORY_PREFIX: Record<DimensionPresetCategory, string> = {
  spacing: 'space',
  margin: 'margin',
  radius: 'radius',
};

const TIER_SUFFIXES = ['-md', '-sm'] as const;

function tokenSlug(tokenName: string, category: DimensionPresetCategory): string | null {
  const prefix = `${CATEGORY_PREFIX[category]}-`;
  return tokenName.startsWith(prefix) ? tokenName.slice(prefix.length) : null;
}

function displayName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeProperty(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase();
}

function maxValueCountForProperty(property: string): number {
  const normalized = normalizeProperty(property);
  if (normalized === 'gap') return 2;
  if (normalized === 'padding' || normalized === 'margin' || normalized === 'border-radius') return 4;
  return 1;
}

function validPropertyShape(property: string, value: string): boolean {
  return value.trim().split(/\s+/).length <= maxValueCountForProperty(property);
}

function findToken(tokens: PresetToken[], name: string): PresetToken | undefined {
  return tokens.find((token) => token.name === name);
}

function matchingTierBaseName(tokenName: string): string | null {
  for (const suffix of TIER_SUFFIXES) {
    if (tokenName.endsWith(suffix)) return tokenName.slice(0, -suffix.length);
  }
  return null;
}

export function dimensionPresetTokenName(
  category: DimensionPresetCategory,
  name: string,
  tier: DimensionPresetTier,
): string {
  const suffix = tier === 'base' ? '' : `-${tier}`;
  return `${CATEGORY_PREFIX[category]}-${name}${suffix}`;
}

export function dimensionCategoryFromToken(name: string): DimensionPresetCategory | null {
  if (name.startsWith('space-')) return 'spacing';
  if (name.startsWith('margin-')) return 'margin';
  if (name.startsWith('radius-')) return 'radius';
  return null;
}

/** Shared guard for MCP/agent preset writes. The category prefix is canonical;
 *  an existing or explicitly supplied dimensional category can also identify
 *  legacy token names, but may never contradict the prefix. */
export function validateDimensionPresetTokenWrite(
  name: string,
  value: string,
  suppliedCategory?: PresetToken['category'],
  existingTokens: PresetToken[] = [],
): DimensionPresetTokenWriteValidation {
  const prefixCategory = dimensionCategoryFromToken(name);
  const existingCategory = existingTokens.find((token) => token.name === name)?.category;
  const existingDimensionCategory = existingCategory === 'spacing' || existingCategory === 'margin' || existingCategory === 'radius'
    ? existingCategory
    : null;
  const suppliedDimensionCategory = suppliedCategory === 'spacing' || suppliedCategory === 'margin' || suppliedCategory === 'radius'
    ? suppliedCategory
    : null;
  const category = prefixCategory ?? existingDimensionCategory ?? suppliedDimensionCategory;
  if (!category) return { category: null, error: null };

  if (existingDimensionCategory && existingDimensionCategory !== category) {
    return { category, error: `Existing token category "${existingDimensionCategory}" conflicts with the "${category}" name prefix.` };
  }
  if (suppliedCategory && suppliedCategory !== category) {
    return { category, error: `Token name/category conflict: "${name}" belongs to "${category}", not "${suppliedCategory}".` };
  }
  const error = dimensionPresetValueError(category, value);
  return { category, error };
}

export function groupDimensionTokens(
  tokens: PresetToken[],
  category: DimensionPresetCategory,
): DimensionPresetGroup[] {
  const prefix = `${CATEGORY_PREFIX[category]}-`;
  const categoryTokens = tokens.filter((token) => token.category === category && token.name.startsWith(prefix));
  const tokenByName = new Map(categoryTokens.map((token) => [token.name, token]));
  const roots = new Map<string, PresetToken>();

  for (const token of categoryTokens) {
    const slug = tokenSlug(token.name, category)!;
    const suffix = matchingTierBaseName(token.name);
    if (suffix && tokenByName.has(suffix)) continue;
    roots.set(slug, token);
  }

  const groups = [...roots.entries()].map(([name, base]) => {
    const md = tokenByName.get(dimensionPresetTokenName(category, name, 'md'));
    const sm = tokenByName.get(dimensionPresetTokenName(category, name, 'sm'));
    const siblings = [base, md, sm].filter((item): item is PresetToken => item !== undefined);
    return {
      name,
      category,
      label: base.label?.trim() || displayName(name),
      tokens: siblings,
      base,
      ...(md ? { md } : {}),
      ...(sm ? { sm } : {}),
    };
  });

  trace.fn('dimension-presets:group', { category, count: groups.length });
  return groups.sort((left, right) => left.label.localeCompare(right.label));
}

export function findDimensionPresetGroupForToken(
  tokenName: string,
  category: DimensionPresetCategory,
  tokens: PresetToken[],
): DimensionPresetGroup | null {
  return groupDimensionTokens(tokens, category).find((group) => group.tokens.some((token) => token.name === tokenName)) ?? null;
}

export function dimensionPresetValueError(category: DimensionPresetCategory, value: string): string | null {
  const parts = value.trim().split(/\s+/);
  const validLength = (part: string) => part === '0' || part === '0px'
    || (category === 'margin'
      ? /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(part)
      : /^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(part));

  if (!value.trim() || parts.length > 4) return 'Use one to four pixel values.';
  if (parts.every((part) => validLength(part) || (category === 'margin' && part === 'auto'))) return null;
  return 'Dimension preset values must use pixels; only Margin also supports auto.';
}

export function dimensionCategoryForProperty(property: string): DimensionPresetCategory | null {
  const normalized = normalizeProperty(property);
  if (/^(?:padding|padding-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))$/.test(normalized)) return 'spacing';
  if (/^(?:margin|margin-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))$/.test(normalized)) return 'margin';
  if (/^(?:gap|row-gap|column-gap)$/.test(normalized)) return 'spacing';
  if (/^border-(?:top-left|top-right|bottom-right|bottom-left)-radius$/.test(normalized) || normalized === 'border-radius') return 'radius';
  return null;
}

interface ParsedDimensionVar {
  name: string;
  fallbackName?: string;
}

function parseDimensionVar(value: string): ParsedDimensionVar | null {
  const match = value.trim().match(/^var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,\s*var\(\s*--([a-zA-Z0-9_-]+)\s*\)\s*)?\)$/);
  if (!match) return null;
  return { name: match[1], ...(match[2] ? { fallbackName: match[2] } : {}) };
}

function compatibleToken(token: PresetToken | undefined, category: DimensionPresetCategory): token is PresetToken {
  if (!token || token.category !== category) return false;
  const prefixedCategory = dimensionCategoryFromToken(token.name);
  return prefixedCategory === null || prefixedCategory === category;
}

export function dimensionStyleValueError(
  property: string,
  value: string,
  tokens: PresetToken[],
): string | null {
  const category = dimensionCategoryForProperty(property);
  if (!category) return null;

  const trimmed = value.trim();
  if (trimmed.includes('var(')) {
    const parsed = parseDimensionVar(trimmed);
    if (!parsed) return 'Dimension styles must reference a compatible preset token.';
    const referencedToken = findToken(tokens, parsed.name);
    const baseName = matchingTierBaseName(parsed.name);

    if (parsed.fallbackName) {
      if (!baseName || parsed.fallbackName !== baseName) return 'Responsive dimension tokens must fall back to their matching base token.';
      const baseToken = findToken(tokens, baseName);
      if (!compatibleToken(baseToken, category)) return 'Responsive dimension tokens must fall back to an existing compatible base token.';
      if (referencedToken && !compatibleToken(referencedToken, category)) return 'Dimension token category does not match this property.';
      if (!dimensionCategoryFromToken(parsed.name) || dimensionCategoryFromToken(parsed.name) !== category) return 'Dimension token category does not match this property.';
      if (!validPropertyShape(property, baseToken.value)) return 'This property does not support a multi-value dimension token.';
      if (referencedToken && !validPropertyShape(property, referencedToken.value)) return 'This property does not support a multi-value dimension token.';
      return null;
    }

    if (!compatibleToken(referencedToken, category)) return 'Dimension token category does not match this property.';
    if (baseName && !findToken(tokens, baseName)) return 'Responsive dimension tokens require an existing base token.';
    if (!validPropertyShape(property, referencedToken.value)) return 'This property does not support a multi-value dimension token.';
    return null;
  }

  const valueError = dimensionPresetValueError(category, trimmed);
  if (valueError) return valueError;
  if (!validPropertyShape(property, trimmed)) return 'This property does not support that many dimension values.';
  return null;
}

export function buildDimensionPresetApplyPlan(
  group: DimensionPresetGroup,
  property: string,
  viewportWidths: Record<string, number>,
): DimensionPresetApplyPlan {
  const baseName = group.base.name;
  const widths = [...new Set(Object.values(viewportWidths).filter((width) => Number.isFinite(width) && width > 0))]
    .sort((left, right) => right - left)
    .slice(1);
  const tiers: DimensionPresetTier[] = ['md', 'sm'];

  return {
    baseStyles: { [property]: `var(--${baseName})` },
    responsive: widths.slice(0, tiers.length).map((maxWidth, index) => {
      const tierName = dimensionPresetTokenName(group.category, group.name, tiers[index]);
      return {
        maxWidth,
        styles: { [property]: `var(--${tierName}, var(--${baseName}))` },
      };
    }),
  };
}
