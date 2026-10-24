import { describe, expect, it } from 'vitest';
import type { PresetToken } from '@/shared/types';
import {
  buildDimensionPresetApplyPlan,
  dimensionCategoryForProperty,
  dimensionCategoryFromToken,
  dimensionPresetTokenName,
  dimensionPresetValueError,
  dimensionStyleValueError,
  findDimensionPresetGroupForToken,
  groupDimensionTokens,
} from './dimension-presets';

const token = (name: string, value = '8px', category: PresetToken['category'] = 'spacing'): PresetToken => ({
  name,
  value,
  category,
});

describe('dimension preset groups', () => {
  it('groups the base, tablet, and mobile tokens into one family', () => {
    expect(groupDimensionTokens([
      token('space-card-sm', '4px'),
      token('space-card', '16px'),
      token('space-card-md', '8px'),
    ], 'spacing')).toMatchObject([
      {
        name: 'card',
        category: 'spacing',
        base: { name: 'space-card' },
        md: { name: 'space-card-md' },
        sm: { name: 'space-card-sm' },
      },
    ]);
  });

  it('keeps a legacy token ending in a tier suffix as a standalone base when no family base exists', () => {
    expect(groupDimensionTokens([token('space-card-md')], 'spacing')).toMatchObject([
      { name: 'card-md', base: { name: 'space-card-md' } },
    ]);
  });

  it('keeps legacy one-token presets and isolates categories', () => {
    const groups = groupDimensionTokens([
      token('space-card-padding', '24px', 'spacing'),
      token('margin-card', 'auto', 'margin'),
      token('radius-card', '12px', 'radius'),
      token('space-not-spacing', '20px', 'radius'),
    ], 'spacing');

    expect(groups).toMatchObject([{ name: 'card-padding', base: { name: 'space-card-padding' } }]);
    expect(groupDimensionTokens([
      token('space-card-padding', '24px', 'spacing'),
      token('margin-card', 'auto', 'margin'),
    ], 'margin')).toMatchObject([{ name: 'card', category: 'margin', base: { name: 'margin-card' } }]);
  });

  it('finds a base family from any tier token', () => {
    const tokens = [token('space-card', '16px'), token('space-card-md', '8px')];
    expect(findDimensionPresetGroupForToken('space-card-md', 'spacing', tokens))
      .toMatchObject({ name: 'card', base: { name: 'space-card' }, md: { name: 'space-card-md' } });
    expect(findDimensionPresetGroupForToken('space-missing', 'spacing', tokens)).toBeNull();
  });

  it('maps dimension categories and token prefixes', () => {
    expect(dimensionCategoryFromToken('space-card')).toBe('spacing');
    expect(dimensionCategoryFromToken('margin-card-md')).toBe('margin');
    expect(dimensionCategoryFromToken('radius-pill-sm')).toBe('radius');
    expect(dimensionCategoryFromToken('color-brand')).toBeNull();

    expect(dimensionPresetTokenName('spacing', 'card', 'base')).toBe('space-card');
    expect(dimensionPresetTokenName('spacing', 'card', 'md')).toBe('space-card-md');
    expect(dimensionPresetTokenName('spacing', 'card', 'sm')).toBe('space-card-sm');
    expect(dimensionPresetTokenName('margin', 'card', 'base')).toBe('margin-card');
    expect(dimensionPresetTokenName('margin', 'card', 'md')).toBe('margin-card-md');
    expect(dimensionPresetTokenName('margin', 'card', 'sm')).toBe('margin-card-sm');
    expect(dimensionPresetTokenName('radius', 'card', 'base')).toBe('radius-card');
    expect(dimensionPresetTokenName('radius', 'card', 'md')).toBe('radius-card-md');
    expect(dimensionPresetTokenName('radius', 'card', 'sm')).toBe('radius-card-sm');
  });
});

describe('dimension preset validation', () => {
  it('accepts pixel values, zero, and supported shorthands', () => {
    expect(dimensionPresetValueError('spacing', '8px')).toBeNull();
    expect(dimensionPresetValueError('spacing', '0')).toBeNull();
    expect(dimensionPresetValueError('spacing', '0px 16px')).toBeNull();
    expect(dimensionPresetValueError('radius', '8px 12px 16px 20px')).toBeNull();
    expect(dimensionPresetValueError('margin', '-12px auto')).toBeNull();
    expect(dimensionPresetValueError('margin', 'auto')).toBeNull();
  });

  it('rejects fluid units, empty values, and malformed shorthand', () => {
    for (const value of ['', 'clamp(8px, 2vw, 24px)', 'calc(8px + 2px)', '8%', '1rem', '2em', '10vh', '10vw', '8px 12px 16px 20px 24px', '8px nope']) {
      expect(dimensionPresetValueError('spacing', value), value).not.toBeNull();
    }
  });

  it('rejects negative values outside Margin', () => {
    expect(dimensionPresetValueError('spacing', '-8px')).not.toBeNull();
    expect(dimensionPresetValueError('radius', '-8px')).not.toBeNull();
    expect(dimensionPresetValueError('margin', '-8px')).toBeNull();
  });

  it('maps supported properties to their preset family', () => {
    expect(dimensionCategoryForProperty('padding')).toBe('spacing');
    expect(dimensionCategoryForProperty('paddingTop')).toBe('spacing');
    expect(dimensionCategoryForProperty('gap')).toBe('spacing');
    expect(dimensionCategoryForProperty('rowGap')).toBe('spacing');
    expect(dimensionCategoryForProperty('column-gap')).toBe('spacing');
    expect(dimensionCategoryForProperty('margin')).toBe('margin');
    expect(dimensionCategoryForProperty('marginLeft')).toBe('margin');
    expect(dimensionCategoryForProperty('borderRadius')).toBe('radius');
    expect(dimensionCategoryForProperty('borderTopLeftRadius')).toBe('radius');
    expect(dimensionCategoryForProperty('color')).toBeNull();
  });

  it('allows only known, category-compatible dimension token references', () => {
    const tokens = [
      token('space-card', '16px'),
      token('space-card-md', '8px'),
      token('space-triple', '8px 12px 16px'),
      token('space-triple-md', '8px 12px 16px'),
      token('margin-page', 'auto', 'margin'),
      token('radius-card', '12px', 'radius'),
    ];

    expect(dimensionStyleValueError('paddingTop', 'var(--space-card)', tokens)).toBeNull();
    expect(dimensionStyleValueError('padding', 'var(--space-card-md, var(--space-card))', tokens)).toBeNull();
    expect(dimensionStyleValueError('padding', 'var(--space-card-sm, var(--space-card))', tokens)).toBeNull();
    expect(dimensionStyleValueError('gap', 'var(--space-card)', tokens)).toBeNull();
    expect(dimensionStyleValueError('margin', 'var(--margin-page)', tokens)).toBeNull();
    expect(dimensionStyleValueError('borderRadius', 'var(--radius-card)', tokens)).toBeNull();

    expect(dimensionStyleValueError('padding', 'var(--space-missing)', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('padding', 'var(--radius-card)', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('margin', 'var(--space-card)', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('borderRadius', 'var(--margin-page)', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('gap', 'var(--space-triple)', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('gap', 'var(--space-triple-md, var(--space-triple))', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('padding', 'var(--space-card-md, var(--space-other))', tokens)).not.toBeNull();
    expect(dimensionStyleValueError('padding', 'var(--space-unknown-md, var(--space-unknown))', tokens)).not.toBeNull();
  });
});

describe('responsive dimension preset apply plan', () => {
  const group = {
    name: 'card',
    label: 'Card',
    category: 'spacing' as const,
    tokens: [token('space-card')],
    base: token('space-card'),
  };

  it('plans the base value and configured tablet/mobile bands with a base fallback', () => {
    expect(buildDimensionPresetApplyPlan(group, 'padding', { desktop: 1200, tablet: 1199, mobile: 809 })).toEqual({
      baseStyles: { padding: 'var(--space-card)' },
      responsive: [
        { maxWidth: 1199, styles: { padding: 'var(--space-card-md, var(--space-card))' } },
        { maxWidth: 809, styles: { padding: 'var(--space-card-sm, var(--space-card))' } },
      ],
    });
  });

  it('uses actual custom and reduced viewport bands without inventing missing tiers', () => {
    expect(buildDimensionPresetApplyPlan(group, 'padding', { wide: 1600, tablet: 900, phone: 420 }).responsive)
      .toEqual([
        { maxWidth: 900, styles: { padding: 'var(--space-card-md, var(--space-card))' } },
        { maxWidth: 420, styles: { padding: 'var(--space-card-sm, var(--space-card))' } },
      ]);
    expect(buildDimensionPresetApplyPlan(group, 'padding', { desktop: 1440, tablet: 768 }).responsive)
      .toEqual([{ maxWidth: 768, styles: { padding: 'var(--space-card-md, var(--space-card))' } }]);
    expect(buildDimensionPresetApplyPlan(group, 'padding', { desktop: 1440 }).responsive).toEqual([]);
  });
});
