import { describe, it, expect } from 'vitest';
import {
  parsePseudoRules,
  isValidCustomPseudoSuffix,
  normalizePseudoKind,
} from './pseudo-parser';

describe('parsePseudoRules', () => {
  it('parses ::before rules', () => {
    const css = `[data-id="title"]::before { content: attr(data-text); position: absolute; top: 0; left: 2px; color: #FF0033; }`;
    const result = parsePseudoRules(css);
    expect(result.get('title')).toEqual({
      before: { content: 'attr(data-text)', position: 'absolute', top: '0', left: '2px', color: '#FF0033' },
    });
  });

  it('parses ::after rules', () => {
    const css = `[data-id="title"]::after { content: ''; background-color: #00FF41; opacity: 0.5; }`;
    const result = parsePseudoRules(css);
    expect(result.get('title')).toEqual({
      after: { content: "''", backgroundColor: '#00FF41', opacity: '0.5' },
    });
  });

  it('parses both ::before and ::after on same node', () => {
    const css = `
      [data-id="heading"]::before { content: ''; position: absolute; left: 2px; color: #FF0033; }
      [data-id="heading"]::after { content: ''; position: absolute; left: -2px; color: #00FF41; }
    `;
    const result = parsePseudoRules(css);
    const heading = result.get('heading');
    expect(heading?.before?.color).toBe('#FF0033');
    expect(heading?.after?.color).toBe('#00FF41');
  });

  it('strips !important from values', () => {
    const css = `[data-id="box"]::before { opacity: 0.5 !important; }`;
    const result = parsePseudoRules(css);
    expect(result.get('box')?.before?.opacity).toBe('0.5');
  });

  it('returns empty map for empty css and parses :hover rules', () => {
    expect(parsePseudoRules('')).toEqual(new Map());
    expect(parsePseudoRules('[data-id="x"]:hover { color: red; }').get('x')).toEqual({
      hover: { color: 'red' },
    });
  });

  it('parses :active, :focus-visible, :focus-within, :disabled, and custom node-scoped suffixes', () => {
    const css = `
      [data-id="btn-1"]:hover { background-color: #1e1e1e !important; color: #f2f2f2 !important; }
      [data-id="btn-1"]:active { transform: scale(0.98) !important; }
      [data-id="btn-1"]:focus-visible { outline: 2px solid #111111 !important; }
      [data-id="btn-1"]:focus-within { border-color: #111111 !important; }
      [data-id="btn-1"]:disabled { opacity: 0.4 !important; }
      [data-id="btn-1"]:nth-child(odd) { background-color: #ffffff !important; }
      [data-id="btn-1"][aria-expanded="true"] { border-color: #111111 !important; }
    `;
    const parsed = parsePseudoRules(css);
    const btn = parsed.get('btn-1');
    expect(btn?.hover).toEqual({ backgroundColor: '#1e1e1e', color: '#f2f2f2' });
    expect(btn?.active).toEqual({ transform: 'scale(0.98)' });
    expect(btn?.['focus-visible']).toEqual({ outline: '2px solid #111111' });
    expect(btn?.['focus-within']).toEqual({ borderColor: '#111111' });
    expect(btn?.disabled).toEqual({ opacity: '0.4' });
    expect(btn?.['custom::nth-child(odd)']).toEqual({ backgroundColor: '#ffffff' });
    expect(btn?.['custom:[aria-expanded="true"]']).toEqual({ borderColor: '#111111' });
  });

  it('validates custom suffixes and normalizes pseudo kinds safely', () => {
    expect(isValidCustomPseudoSuffix(':nth-child(2n)')).toBe(true);
    expect(isValidCustomPseudoSuffix('[data-open="true"]')).toBe(true);
    expect(isValidCustomPseudoSuffix(':hover::after')).toBe(true);
    expect(isValidCustomPseudoSuffix(' .child')).toBe(false);
    expect(isValidCustomPseudoSuffix(' > [data-id="other"]')).toBe(false);
    expect(isValidCustomPseudoSuffix(':hover { color: red }')).toBe(false);
    expect(normalizePseudoKind(':hover')).toBe('hover');
    expect(normalizePseudoKind('::before')).toBe('before');
    expect(normalizePseudoKind(':focus-visible')).toBe('focus-visible');
    expect(normalizePseudoKind(':nth-child(2)')).toBe('custom::nth-child(2)');
    expect(normalizePseudoKind('.bad > span')).toBeNull();
  });

  it('handles animation shorthand', () => {
    const css = `[data-id="title"]::before { animation: glitch 3s infinite linear alternate-reverse; }`;
    const result = parsePseudoRules(css);
    expect(result.get('title')?.before?.animation).toBe('glitch 3s infinite linear alternate-reverse');
  });

  it('parses ::placeholder rules (Input tool placeholder color)', () => {
    const css = `[data-id="email-field"]::placeholder { color: #94a3b8 !important; }`;
    const result = parsePseudoRules(css);
    expect(result.get('email-field')?.placeholder?.color).toBe('#94a3b8');
    expect(result.get('email-field')?.before).toBeUndefined();
  });
});
