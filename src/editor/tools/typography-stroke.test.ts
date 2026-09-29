import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn() } }));
import { groupTypoTokens, getTypoTokenValue, presetApplyStyles, bakePresetStyles, TYPO_STROKE_UNIT } from './typography-utils';
import { bindPresetStrokeInCode } from '@/code/generation/typo-preset-gen';
import { readTextStroke } from './TextStyleTool/atoms/StrokeControl';
import type { PresetToken } from '@/shared/types';

const tok = (name: string, value: string): PresetToken => ({ name, value, category: 'typography' });
// Stroke tokens listed FIRST on purpose: a suffix lookup by `endsWith('-color')` returned the stroke
// color as the preset's text color.
const FOOTER: PresetToken[] = [
  tok('typo-footer-heading-stroke-color', '#000000'),
  tok('typo-footer-heading-stroke-width', '0.015em'),
  tok('typo-footer-heading-font', "'Beatrice', sans-serif"),
  tok('typo-footer-heading-color', '#ff71db'),
  tok('typo-footer-heading-size', '9rem'),
];

describe('typography preset text stroke', () => {
  const [group] = groupTypoTokens(FOOTER);

  it('groups the stroke tokens under their preset and never reads them as another suffix', () => {
    expect(groupTypoTokens(FOOTER).map((g) => g.name)).toEqual(['footer-heading']);
    expect(getTypoTokenValue(group, 'color')).toBe('#ff71db');
    expect(getTypoTokenValue(group, 'stroke-color')).toBe('#000000');
    expect(getTypoTokenValue(group, 'stroke-width')).toBe('0.015em');
    expect(TYPO_STROKE_UNIT).toBe('em');
  });

  it('apply binds the stroke longhands and clears a shorthand that would fight them', () => {
    const out = presetApplyStyles(group, { WebkitTextStroke: '2px red', color: '#111' });
    expect(out.WebkitTextStrokeWidth).toBe('var(--typo-footer-heading-stroke-width)');
    expect(out.WebkitTextStrokeColor).toBe('var(--typo-footer-heading-stroke-color)');
    expect(out.color).toBe('var(--typo-footer-heading-color)');
    expect(out.WebkitTextStroke).toBe('');
  });

  it('switching to a preset WITHOUT a stroke drops the previous preset\'s stroke refs, never a literal', () => {
    const [plain] = groupTypoTokens([tok('typo-body-font', 'Inter'), tok('typo-body-color', '#333')]);
    const out = presetApplyStyles(plain, {
      WebkitTextStrokeWidth: 'var(--typo-footer-heading-stroke-width)',
      WebkitTextStrokeColor: 'var(--typo-footer-heading-stroke-color)',
      textShadow: '0 1px 2px #000',
    });
    expect(out.WebkitTextStrokeWidth).toBe('');
    expect(out.WebkitTextStrokeColor).toBe('');
    expect('textShadow' in out).toBe(false);   // a literal the user set stays
  });

  it('detach bakes the stroke to its literal values', () => {
    const baked = bakePresetStyles(group, presetApplyStyles(group));
    expect(baked.WebkitTextStrokeWidth).toBe('0.015em');
    expect(baked.WebkitTextStrokeColor).toBe('#000000');
  });
});

describe('bindPresetStrokeInCode — a preset gains a stroke after it was applied', () => {
  const CODE = `export default function Footer() {
  return (
    <div data-id="root" style={{ position: 'relative' }}>
      <p data-id="a" style={{ position: 'relative', fontFamily: 'var(--typo-footer-heading-font)', color: 'var(--typo-footer-heading-color)' }}>A</p>
      <p data-id="b" style={{ position: 'relative', fontFamily: 'var(--typo-footer-heading-font)', WebkitTextStroke: '1px red' }}>B</p>
      <p data-id="c" style={{ position: 'relative', fontFamily: 'var(--typo-footer-heading-font-alt)' }}>C</p>
      <p data-id="d" style={{ position: 'relative', fontFamily: 'var(--typo-body-font)' }}>D</p>
    </div>
  );
}`;

  it('binds the texts using the preset; own strokes and other presets are left alone', () => {
    const out = bindPresetStrokeInCode(CODE, 'footer-heading');
    const line = (id: string) => out.split('\n').find((l) => l.includes(`data-id="${id}"`))!;
    expect(line('a')).toMatch(/WebkitTextStrokeWidth: ["']var\(--typo-footer-heading-stroke-width\)["']/);
    expect(line('a')).toMatch(/WebkitTextStrokeColor: ["']var\(--typo-footer-heading-stroke-color\)["']/);
    expect(line('b')).not.toContain('WebkitTextStrokeWidth');
    expect(line('c')).not.toContain('WebkitTextStrokeWidth');
    expect(line('d')).not.toContain('WebkitTextStrokeWidth');
    expect(bindPresetStrokeInCode(out, 'footer-heading')).toBe(out);   // idempotent
  });

  it("a file that doesn't use the preset is untouched", () => {
    expect(bindPresetStrokeInCode(CODE, 'navbar')).toBe(CODE);
  });
});

describe('readTextStroke — the Stroke row reads every form', () => {
  it('legacy shorthand (px)', () => {
    expect(readTextStroke({ WebkitTextStroke: '2px #ff0000' }, [])).toEqual({ width: 2, unit: 'px', color: '#ff0000' });
  });
  it('preset-bound longhands, resolved through the tokens (em)', () => {
    expect(readTextStroke({
      WebkitTextStrokeWidth: 'var(--typo-footer-heading-stroke-width)',
      WebkitTextStrokeColor: 'var(--typo-footer-heading-stroke-color)',
    }, FOOTER)).toEqual({ width: 0.015, unit: 'em', color: '#000000' });
  });
  it('no stroke', () => {
    expect(readTextStroke({}, []).width).toBe(0);
  });
});
