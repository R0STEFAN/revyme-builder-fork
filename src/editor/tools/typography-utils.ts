// typography-utils.ts — Shared typography preset utilities.
// Canonical suffix list, grouping, detection, and default token creation.

import type { PresetToken } from '@/shared/types';
import { trace } from '@/shared/debug-trace';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Known typography token suffixes (longest first for greedy match).
 *  Includes responsive tiers and min-width breakpoint config. */
export const TYPO_SUFFIXES = [
  'min-default', 'min-md',
  'line-height-md', 'line-height-sm', 'line-height',
  'spacing-md', 'spacing-sm', 'spacing',
  'size-md', 'size-sm', 'size',
  // OPTIONAL text stroke (only presets that set one carry these). Before `color` — longest first —
  // or `typo-x-stroke-color` would group as preset "x-stroke".
  'stroke-width', 'stroke-color',
  'decoration', 'transform', 'shadow',
  'weight', 'color', 'font', 'tag',
];

/** Text-stroke width is stored in `em` — relative to the font size, so ONE value keeps the same
 *  proportion at every breakpoint (a px stroke on a 144px desktop heading reads 3× heavier at 48px
 *  on mobile). */
export const TYPO_STROKE_UNIT = 'em';

/** The HTML element a typography preset renders as. Stored as the `-tag` token (`typo-<slug>-tag`) so
 *  applying the preset can also retag the element (p → h2, etc.) — mirroring the reference's Paragraph/Heading
 *  text-style choice. The badge shown next to the preset name comes from `typoTagLabel`. */
export const TYPO_TAG_OPTIONS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
  { value: 'h5', label: 'Heading 5' },
  { value: 'h6', label: 'Heading 6' },
] as const;

/** Valid preset tags — used to guard the retag-on-apply so we never rewrite a non-text element. */
const TYPO_TAGS = new Set<string>(TYPO_TAG_OPTIONS.map(o => o.value));

/** Short badge text for a preset tag: `p` → "P", `h3` → "H3". */
export function typoTagLabel(tag: string | undefined): string {
  return (tag || 'p').toUpperCase();
}

/** Responsive suffixes: token suffix → CSS property */
export const RESPONSIVE_PROPS: Record<string, string> = {
  size: 'fontSize',
  spacing: 'letterSpacing',
  'line-height': 'lineHeight',
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TypoGroup {
  name: string;        // "heading", "body"
  label: string;       // "Heading", "Body"
  tokens: PresetToken[]; // all tokens in this group
}

// ─── Grouping ────────────────────────────────────────────────────────────────

/** Group typography tokens by preset name (e.g. "heading", "body").
 *  Strips the "typo-" prefix and matches known suffixes to extract the group name. */
export function groupTypoTokens(tokens: PresetToken[]): TypoGroup[] {
  trace.fn('groupTypoTokens', { tokenCount: tokens.length });
  const groups = new Map<string, PresetToken[]>();
  for (const token of tokens) {
    if (token.category !== 'typography') continue;
    const withoutPrefix = token.name.replace(/^typo-/, '');
    let groupName = withoutPrefix;
    for (const suffix of TYPO_SUFFIXES) {
      if (withoutPrefix.endsWith('-' + suffix)) {
        groupName = withoutPrefix.slice(0, -(suffix.length + 1));
        break;
      }
    }
    if (!groupName) groupName = withoutPrefix;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push(token);
  }
  return Array.from(groups.entries()).map(([name, grpTokens]) => ({
    name,
    label: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    tokens: grpTokens,
  }));
}

// ─── Token value helpers ─────────────────────────────────────────────────────

/** The full token name for a suffix within a group. */
export function typoTokenName(group: Pick<TypoGroup, 'name'>, suffix: string): string {
  return `typo-${group.name}-${suffix}`;
}

/** The group's token for a suffix — by EXACT name. An `endsWith('-' + suffix)` lookup read
 *  `typo-x-stroke-color` as the preset's `color`. */
export function findTypoToken(group: TypoGroup, suffix: string): PresetToken | undefined {
  const name = typoTokenName(group, suffix);
  return group.tokens.find(t => t.name === name);
}

/** Get the token value for a suffix within a group */
export function getTypoTokenValue(group: TypoGroup, suffix: string): string {
  return findTypoToken(group, suffix)?.value ?? '';
}

/** The element tag a preset renders as (`p` when unset — legacy presets had no tag token). */
export function getTypoTag(group: TypoGroup): string {
  const t = getTypoTokenValue(group, 'tag');
  return TYPO_TAGS.has(t) ? t : 'p';
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** Detect which typography preset is currently applied to the node (if any).
 *  Checks if fontFamily references a typo var. */
export function detectActivePreset(styles: Record<string, string>, groups: TypoGroup[]): TypoGroup | null {
  const ff = styles.fontFamily || '';
  const varMatch = ff.match(/var\(--typo-([^-]+(?:-[^-]+)*)-font\)/);
  if (!varMatch) return null;
  const groupName = varMatch[1];
  trace.fn('detectActivePreset', { fontFamily: ff, groupName });
  return groups.find(g => g.name === groupName) ?? null;
}

// ─── Apply / detach ──────────────────────────────────────────────────────────

/** Token suffix → CSS property a typography preset drives (as a `var()` ref on
 *  apply). Single source of truth for both the apply path and `bakePresetStyles`. */
export const TYPO_VAR_PROP_MAP: Record<string, string> = {
  font: 'fontFamily',
  weight: 'fontWeight',
  color: 'color',
  transform: 'textTransform',
  decoration: 'textDecoration',
  shadow: 'textShadow',
  size: 'fontSize',
  spacing: 'letterSpacing',
  'line-height': 'lineHeight',
  // Longhands, not the `WebkitTextStroke` shorthand: width and color are separate tokens.
  'stroke-width': 'WebkitTextStrokeWidth',
  'stroke-color': 'WebkitTextStrokeColor',
};

/**
 * The inline-style patch that APPLIES a preset to a node with `styles`: every prop the preset has a
 * token for → `var(--typo-<group>-<suffix>)`. Two clean-ups ride along:
 *   - a prop the preset has NO token for (stroke is optional) but that still points at ANOTHER
 *     preset's var — left over from the previously applied preset — is cleared, so switching from a
 *     stroked preset to a plain one drops the old stroke;
 *   - a preset with a stroke clears the node's `WebkitTextStroke` shorthand, which would otherwise
 *     fight the longhands by key order.
 * Shared by the Text Style panel's apply and the agent's apply_typography_preset.
 */
export function presetApplyStyles(group: TypoGroup, styles: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [suffix, cssProp] of Object.entries(TYPO_VAR_PROP_MAP)) {
    if (findTypoToken(group, suffix)) out[cssProp] = `var(--${typoTokenName(group, suffix)})`;
    else if (/^var\(\s*--typo-/.test(styles[cssProp] ?? '')) out[cssProp] = '';
  }
  if (findTypoToken(group, 'stroke-width') && styles.WebkitTextStroke) out.WebkitTextStroke = '';
  return out;
}

/**
 * When DETACHING a typography preset, return the inline-style patch that BAKES
 * each preset-BOUND prop — a `var(--typo-<group>-<suffix>)` reference — to its
 * resolved literal token value, so the text keeps its EXACT look instead of
 * reverting to the element default. Props the user overrode with a literal (or a
 * different var) are NOT included, so those stay exactly as-is. Returns `{}` when
 * nothing is bound (caller can skip the write).
 */
export function bakePresetStyles(group: TypoGroup, styles: Record<string, string>): Record<string, string> {
  const norm = (v: string) => v.replace(/\s+/g, '');
  const out: Record<string, string> = {};
  for (const [suffix, cssProp] of Object.entries(TYPO_VAR_PROP_MAP)) {
    const presetVar = `var(--typo-${group.name}-${suffix})`;
    if (norm(styles[cssProp] || '') === norm(presetVar)) {
      out[cssProp] = getTypoTokenValue(group, suffix) || '';
    }
  }
  return out;
}

// ─── Default token creation ──────────────────────────────────────────────────

/** Returns the 11 default tokens (9 base + 2 min-width breakpoints) for a new typography preset. */
export function createDefaultTypoTokens(slug: string, tag: string = 'p'): PresetToken[] {
  trace.action('createDefaultTypoTokens', { slug, tag });
  return [
    { name: `typo-${slug}-tag`, value: TYPO_TAGS.has(tag) ? tag : 'p', category: 'typography' },
    { name: `typo-${slug}-font`, value: "'Inter', sans-serif", category: 'typography' },
    { name: `typo-${slug}-weight`, value: '400', category: 'typography' },
    { name: `typo-${slug}-color`, value: '#000000', category: 'typography' },
    { name: `typo-${slug}-transform`, value: 'none', category: 'typography' },
    { name: `typo-${slug}-decoration`, value: 'none', category: 'typography' },
    { name: `typo-${slug}-shadow`, value: 'none', category: 'typography' },
    { name: `typo-${slug}-size`, value: '16px', category: 'typography' },
    { name: `typo-${slug}-spacing`, value: '0px', category: 'typography' },
    { name: `typo-${slug}-line-height`, value: '1.5', category: 'typography' },
    { name: `typo-${slug}-min-default`, value: '1200', category: 'typography' },
    { name: `typo-${slug}-min-md`, value: '600', category: 'typography' },
  ];
}
