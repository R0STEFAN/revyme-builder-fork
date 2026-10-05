import { describe, it, expect } from 'vitest';
import { getDefaultStore } from 'jotai';
import {
  copiedElementStylesAtom,
  extractCopyableStyles,
  prepareStylesForPaste,
  resolveEffectiveStyles,
  EXCLUDED_STYLE_KEYS,
} from './context-menu-store';

describe('context-menu-store style copying', () => {
  it('extractCopyableStyles excludes position and dimensions', () => {
    const sourceStyles: Record<string, string> = {
      position: 'absolute',
      left: '100px',
      top: '50px',
      right: '20px',
      bottom: '10px',
      width: '200px',
      height: '100px',
      order: '1',
      zIndex: '10',
      gridColumn: 'span 2',
      gridRow: '1',
      gridArea: 'main',
      // Transferable styles:
      backgroundColor: '#ff0000',
      color: '#ffffff',
      fontSize: '16px',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      opacity: '0.9',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };

    const extracted = extractCopyableStyles(sourceStyles);

    for (const key of EXCLUDED_STYLE_KEYS) {
      expect(extracted).not.toHaveProperty(key);
    }

    expect(extracted).toEqual({
      backgroundColor: '#ff0000',
      color: '#ffffff',
      fontSize: '16px',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      opacity: '0.9',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
  });

  it('extractCopyableStyles ignores empty or undefined values', () => {
    const sourceStyles: Record<string, string> = {
      backgroundColor: '#333333',
      color: '',
      border: '',
    };
    const extracted = extractCopyableStyles(sourceStyles);
    expect(extracted).toEqual({
      backgroundColor: '#333333',
    });
  });

  it('prepareStylesForPaste clears competing background images on target when solid color is pasted', () => {
    const copiedStyles = {
      backgroundColor: '#00ff00',
      borderRadius: '4px',
    };
    const targetStyles = {
      backgroundImage: 'url("https://example.com/bg.jpg")',
      background: 'linear-gradient(to right, red, blue)',
      color: '#000000',
    };

    const prepared = prepareStylesForPaste(copiedStyles, targetStyles);

    expect(prepared.backgroundColor).toBe('#00ff00');
    expect(prepared.borderRadius).toBe('4px');
    expect(prepared.backgroundImage).toBe('');
    expect(prepared.background).toBe('');
  });

  it('copiedElementStylesAtom stores and retrieves clipboard data', () => {
    const store = getDefaultStore();
    expect(store.get(copiedElementStylesAtom)).toBeNull();

    store.set(copiedElementStylesAtom, {
      styles: { backgroundColor: '#abcdef', color: '#123456' },
      sourceNodeId: 'node-1',
      sourceNodeName: 'Hero Button',
    });

    const retrieved = store.get(copiedElementStylesAtom);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.sourceNodeId).toBe('node-1');
    expect(retrieved?.sourceNodeName).toBe('Hero Button');
    expect(retrieved?.styles).toEqual({
      backgroundColor: '#abcdef',
      color: '#123456',
    });
  });

  it('resolveEffectiveStyles merges default and active variant overrides', () => {
    const node = {
      styles: {
        backgroundColor: '#ffffff',
        color: '#000000',
        borderRadius: '8px',
      },
      motionVariants: {
        default: {
          backgroundColor: '#eeeeee', // overrides base on default
        },
        'pricing-secondary': {
          backgroundColor: '#3b82f6', // overrides default on pricing-secondary
          color: '#ffffff',
        },
      },
    };

    // On primary/desktop without variant:
    const onPrimary = resolveEffectiveStyles(node, 'default');
    expect(onPrimary.backgroundColor).toBe('#eeeeee');
    expect(onPrimary.color).toBe('#000000');
    expect(onPrimary.borderRadius).toBe('8px');

    // On pricing-secondary variant:
    const onSecondary = resolveEffectiveStyles(node, 'pricing-secondary');
    expect(onSecondary.backgroundColor).toBe('#3b82f6');
    expect(onSecondary.color).toBe('#ffffff');
    expect(onSecondary.borderRadius).toBe('8px');
  });
});
