import { describe, it, expect } from 'vitest';
import { getDefaultStore } from 'jotai';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import { extractStyleCSS, parseJSXToNodes } from '@/code/parsing/parser';
import { updateContainerQueryStyle } from '@/code/generation/generator-styles';
import { parseContainerRules } from './container-query-store';
import {
  contextMenuAtom,
  copiedElementStylesAtom,
  extractCopyableStyles,
  prepareStylesForPaste,
  resolveEffectiveStyles,
  EXCLUDED_STYLE_KEYS,
} from './context-menu-store';

describe('context-menu-store style copying', () => {
  it.each([
    ['div', { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px', gridColumn: 'span 5', padding: '12px', borderRadius: '8px' },
      { display: 'flex', flexDirection: 'column', gridColumn: 'span 1', paddingLeft: '40px', borderTopLeftRadius: '32px', opacity: '0.4' }],
    ['p', { fontSize: 'clamp(1rem, 2vw, 2rem)', color: '#222222', fontWeight: '700', lineHeight: '1.4' },
      { fontSize: '12px', color: '#ffffff', fontStyle: 'italic', letterSpacing: '2px', textDecoration: 'underline' }],
    ['img', { objectFit: 'cover', borderRadius: '10px', opacity: '0.8' },
      { objectFit: 'contain', objectPosition: 'top', filter: 'blur(4px)', boxShadow: '0 0 3px black' }],
    ['video', { objectFit: 'cover' }, { objectPosition: 'bottom', borderRadius: '12px' }],
    ['svg', { fill: '#123456', strokeWidth: '2px' }, { fill: '#dddddd', stroke: '#000000', opacity: '0.5' }],
    ['button', {}, { backgroundColor: 'red', cursor: 'pointer', transform: 'rotate(15deg)' }],
  ] as const)('replaces transferable %s styles through a JSX round trip', (tag, source, target) => {
    const code = `export default function Page() {
      return <div data-id="root">
        <${tag} data-id="source" style={${JSON.stringify(source)}} />
        <${tag} data-id="target" style={${JSON.stringify({ ...target, width: '220px' })}} />
      </div>;
    }`;
    const nodes = parseJSXToNodes(code);
    const sourceStyles = nodes.get('source')!.styles;
    const targetStyles = nodes.get('target')!.styles;
    const payload = prepareStylesForPaste({
      sourceNodeId: 'source',
      styles: extractCopyableStyles(sourceStyles),
    }, targetStyles);
    const result = parseJSXToNodes(updateNodeInCode(code, 'target', payload)).get('target')!.styles;
    expect(result).toEqual({ width: '220px', ...source });
  });

  it('replaces styles in the active breakpoint while preserving base styles', () => {
    const code = `export default function Page() {
      return <div data-id="root"><p data-id="target" style={{ opacity: '0.5', gridColumn: 'span 1' }} /></div>;
    }`;
    const base = parseJSXToNodes(code).get('target')!.styles;
    const withOverride = updateContainerQueryStyle(code, 'target', 768, { gridColumn: 'span 2', letterSpacing: '2px' });
    const payload = prepareStylesForPaste({ gridColumn: 'span 5' }, {
      ...base, gridColumn: 'span 2', letterSpacing: '2px',
    }, { fallbackStyles: base });
    const result = updateContainerQueryStyle(withOverride, 'target', 768, payload);
    expect(parseJSXToNodes(result).get('target')!.styles).toEqual(base);
    expect(Object.fromEntries(parseContainerRules(extractStyleCSS(result)).get(768)!.get('target')!))
      .toEqual({ 'grid-column': 'span 5', opacity: 'unset' });
  });

  it('reads grid placement from the current component variant', () => {
    const node = {
      styles: { gridColumn: 'span 1' },
      conditionalStyles: { gridColumn: { default: 'span 1', compact: 'span 5' } },
    };
    expect(resolveEffectiveStyles(node).gridColumn).toBe('span 1');
    expect(resolveEffectiveStyles(node, 'compact').gridColumn).toBe('span 5');
  });

  it('lets pasted shorthands win over inherited longhands', () => {
    const target = { paddingLeft: '24px', backgroundColor: 'blue' };
    expect(prepareStylesForPaste({ padding: '8px', background: 'red' }, target, { fallbackStyles: target }))
      .toEqual({ padding: '8px', background: 'red', paddingLeft: '', backgroundColor: '' });
  });

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
      gridArea: 'main',
      // Transferable styles:
      gridColumn: 'span 5',
      gridRow: 'span 2',
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
      gridColumn: 'span 5',
      gridRow: 'span 2',
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
    expect(prepareStylesForPaste(extracted, { gridColumn: 'span 1', gridRow: 'span 1' })).toMatchObject({
      gridColumn: 'span 5',
      gridRow: 'span 2',
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

  it('prepareStylesForPaste clears border on target when copied element has no border', () => {
    const copiedWithoutBorder = {
      styles: {
        backgroundColor: '#ffffff',
        padding: '16px',
      },
      sourceNodeId: 'node-plain',
      hasBorder: false,
    };
    const targetWithBorder = {
      border: '2px solid red',
      borderColor: 'red',
      borderWidth: '2px',
      borderStyle: 'solid',
      '--border-width': '2px',
    };

    const prepared = prepareStylesForPaste(copiedWithoutBorder, targetWithBorder);
    expect(prepared.backgroundColor).toBe('#ffffff');
    expect(prepared.padding).toBe('16px');
    expect(prepared.border).toBe('');
    expect(prepared.borderWidth).toBe('');
    expect(prepared.borderColor).toBe('');
    expect(prepared.borderStyle).toBe('');
    expect(prepared['--border-width']).toBe('');
  });

  it('prepareStylesForPaste clears shadow on target when copied element has no shadow', () => {
    const copiedWithoutShadow = {
      styles: {
        backgroundColor: '#ffffff',
      },
      sourceNodeId: 'node-plain',
      hasShadow: false,
    };
    const targetWithShadow = {
      boxShadow: '0 10px 20px rgba(0,0,0,0.5)',
      filter: 'blur(4px) drop-shadow(0 2px 4px black)',
    };

    const prepared = prepareStylesForPaste(copiedWithoutShadow, targetWithShadow);
    expect(prepared.boxShadow).toBe('');
    expect(prepared.filter).toBe('');
  });

  it('prepareStylesForPaste sets position relative and clears inline keys for overlay border', () => {
    const copiedOverlayBorder = {
      styles: {
        backgroundColor: '#ffffff',
      },
      sourceNodeId: 'node-gradient-border',
      borderOverlayCSS: 'border: 2px solid transparent; border-image: linear-gradient(...) 1;',
      hasBorder: true,
    };
    const targetStyles = {
      border: '1px solid #ccc',
      position: 'static',
    };

    const prepared = prepareStylesForPaste(copiedOverlayBorder, targetStyles);
    expect(prepared.border).toBe('');
    expect(prepared.position).toBe('relative');
  });

  it('prepareStylesForPaste converts canonical transform appropriately for motion and non-motion targets', () => {
    const copiedWithTransform = {
      styles: {},
      sourceNodeId: 'node-rotated',
      transformCSS: 'rotate(45deg)',
    };

    // For a motion target (e.g. inside a component):
    const forMotion = prepareStylesForPaste(copiedWithTransform, { scaleX: '1.2' }, { isMotionTarget: true });
    expect(forMotion.transform).toBe('');
    expect(forMotion.rotate).toBe('45');
    // Stale previous scaleX on target is cleared
    expect(forMotion.scaleX).toBe('');

    // For a non-motion target (e.g. plain page element):
    const forPage = prepareStylesForPaste(copiedWithTransform, { rotate: '15' }, { isMotionTarget: false });
    expect(forPage.transform).toBe('rotate(45deg)');
    // Stale motion props on target are cleared
    expect(forPage.rotate).toBe('');
  });

  it('prepareStylesForPaste on a variant sets border and shadow to "none" rather than "" to prevent inheriting default', () => {
    const copiedPlain = {
      styles: { backgroundColor: '#111827' },
      sourceNodeId: 'node-plain',
      hasBorder: false,
      hasShadow: false,
    };
    const targetWithBorderAndShadow = {
      border: '1px solid #e5e5e5',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    };

    // On primary/default: clears with '' so property is removed from code
    const forPrimary = prepareStylesForPaste(copiedPlain, targetWithBorderAndShadow, { isVariant: false });
    expect(forPrimary.border).toBe('');
    expect(forPrimary.boxShadow).toBe('');

    // On a secondary variant: overrides with 'none' so framer-motion does not inherit default's border/shadow
    const forVariant = prepareStylesForPaste(copiedPlain, targetWithBorderAndShadow, { isVariant: true });
    expect(forVariant.border).toBe('none');
    expect(forVariant.borderWidth).toBe('0px');
    expect(forVariant.boxShadow).toBe('none');
  });

  it('contextMenu state tracks open and target node for Edit Code', () => {
    const store = getDefaultStore();
    store.set(contextMenuAtom, { show: true, x: 100, y: 200, nodeId: 'box-1' });
    const state = store.get(contextMenuAtom);
    expect(state.show).toBe(true);
    expect(state.nodeId).toBe('box-1');
  });
});

