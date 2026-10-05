import { describe, it, expect } from 'vitest';
import { isStyleModified } from './style-modified';
import type { CanvasNode } from '@/code/parsing/parser';

function makeNode(overrides?: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'test-node',
    type: 'div',
    name: 'Test',
    parentId: null,
    children: [],
    styles: {},
    conditionalStyles: null,
    attrs: {},
    textContent: '',
    hasMixedContent: false,
    order: 0,
    isCanvasNode: false,
    componentFile: null,
    ...overrides,
  } as CanvasNode;
}

describe('isStyleModified', () => {
  it('returns false for empty or unsupplied property', () => {
    expect(isStyleModified('', {})).toBe(false);
  });

  describe('margin and padding', () => {
    it('returns false when no margin is set', () => {
      expect(isStyleModified('margin', {})).toBe(false);
    });

    it('returns false when margin is 0 or 0px', () => {
      expect(isStyleModified('margin', { margin: '0' })).toBe(false);
      expect(isStyleModified('margin', { margin: '0px' })).toBe(false);
    });

    it('returns true when shorthand margin is set', () => {
      expect(isStyleModified('margin', { margin: '16px' })).toBe(true);
    });

    it('returns true when individual margin side is set', () => {
      expect(isStyleModified('margin', { marginTop: '24px' })).toBe(true);
      expect(isStyleModified('margin', { marginRight: '10px' })).toBe(true);
    });

    it('returns false when padding is empty or 0', () => {
      expect(isStyleModified('padding', {})).toBe(false);
      expect(isStyleModified('padding', { padding: '0px' })).toBe(false);
    });

    it('returns true when padding is set via shorthand or side', () => {
      expect(isStyleModified('padding', { padding: '12px' })).toBe(true);
      expect(isStyleModified('padding', { paddingLeft: '8px' })).toBe(true);
    });
  });

  describe('borderRadius and border', () => {
    it('returns false when borderRadius is unset or 0', () => {
      expect(isStyleModified('borderRadius', {})).toBe(false);
      expect(isStyleModified('borderRadius', { borderRadius: '0' })).toBe(false);
    });

    it('returns true when borderRadius or corner is set', () => {
      expect(isStyleModified('borderRadius', { borderRadius: '8px' })).toBe(true);
      expect(isStyleModified('borderRadius', { borderTopLeftRadius: '12px' })).toBe(true);
    });

    it('returns false when border is unset or none/0', () => {
      expect(isStyleModified('border', {})).toBe(false);
      expect(isStyleModified('border', { border: 'none' })).toBe(false);
      expect(isStyleModified('border', { borderWidth: '0px' })).toBe(false);
    });

    it('returns true when border is set via shorthand or longhands', () => {
      expect(isStyleModified('border', { border: '1px solid black' })).toBe(true);
      expect(isStyleModified('border', { borderWidth: '2px', borderStyle: 'solid' })).toBe(true);
      expect(isStyleModified('border', { borderBottom: '1px solid red' })).toBe(true);
    });

    it('detects overlay border in node.afterCSS', () => {
      const node = makeNode({ afterCSS: '[data-id="test-node"]::after { border: 1px solid blue; }' });
      expect(isStyleModified('border', {}, node)).toBe(true);
    });
  });

  describe('backgroundColor and fill', () => {
    it('returns false for transparent, none, or empty background', () => {
      expect(isStyleModified('backgroundColor', {})).toBe(false);
      expect(isStyleModified('backgroundColor', { backgroundColor: 'transparent' })).toBe(false);
      expect(isStyleModified('backgroundColor', { backgroundColor: 'rgba(0, 0, 0, 0)' })).toBe(false);
      expect(isStyleModified('backgroundColor', { backgroundColor: 'none' })).toBe(false);
    });

    it('returns true for solid color or gradient background', () => {
      expect(isStyleModified('backgroundColor', { backgroundColor: '#ff5500' })).toBe(true);
      expect(isStyleModified('backgroundColor', { background: 'linear-gradient(90deg, red, blue)' })).toBe(true);
    });
  });

  describe('opacity', () => {
    it('returns false for opacity 1 or unset', () => {
      expect(isStyleModified('opacity', {})).toBe(false);
      expect(isStyleModified('opacity', { opacity: '1' })).toBe(false);
      expect(isStyleModified('opacity', { opacity: '1.0' })).toBe(false);
      expect(isStyleModified('opacity', { opacity: '100%' })).toBe(false);
    });

    it('returns true for modified opacity', () => {
      expect(isStyleModified('opacity', { opacity: '0.8' })).toBe(true);
      expect(isStyleModified('opacity', { opacity: '0' })).toBe(true);
    });
  });

  describe('display and HideControl', () => {
    it('HideControl is modified only when display is none', () => {
      expect(isStyleModified('display', { display: 'flex' }, null, null, 'Hide')).toBe(false);
      expect(isStyleModified('display', { display: 'none' }, null, null, 'Hide')).toBe(true);
      expect(isStyleModified('display', {}, null, null, 'Hide')).toBe(false);
    });

    it('Layout display is modified when flex or grid', () => {
      expect(isStyleModified('display', { display: 'flex' }, null, null, 'Display')).toBe(true);
      expect(isStyleModified('display', { display: 'grid' }, null, null, 'Display')).toBe(true);
      expect(isStyleModified('display', { display: 'block' }, null, null, 'Display')).toBe(false);
      expect(isStyleModified('display', {}, null, null, 'Display')).toBe(false);
    });
  });

  describe('layout properties', () => {
    it('flexDirection: row is default, column is modified', () => {
      expect(isStyleModified('flexDirection', {})).toBe(false);
      expect(isStyleModified('flexDirection', { flexDirection: 'row' })).toBe(false);
      expect(isStyleModified('flexDirection', { flexDirection: 'column' })).toBe(true);
    });

    it('gap: 0 is default, >0 is modified', () => {
      expect(isStyleModified('gap', {})).toBe(false);
      expect(isStyleModified('gap', { gap: '0px' })).toBe(false);
      expect(isStyleModified('gap', { gap: '16px' })).toBe(true);
      expect(isStyleModified('gap', { rowGap: '12px' })).toBe(true);
    });

    it('alignItems & justifyContent: default vs custom', () => {
      expect(isStyleModified('alignItems', { alignItems: 'stretch' })).toBe(false);
      expect(isStyleModified('alignItems', { alignItems: 'center' })).toBe(true);
      expect(isStyleModified('justifyContent', { justifyContent: 'flex-start' })).toBe(false);
      expect(isStyleModified('justifyContent', { justifyContent: 'space-between' })).toBe(true);
    });
  });

  describe('typography', () => {
    it('color: empty is default, value is modified', () => {
      expect(isStyleModified('color', {})).toBe(false);
      expect(isStyleModified('color', { color: '#ffffff' })).toBe(true);
    });

    it('fontSize: empty is default, value is modified', () => {
      expect(isStyleModified('fontSize', {})).toBe(false);
      expect(isStyleModified('fontSize', { fontSize: '20px' })).toBe(true);
    });

    it('fontWeight: 400 is default, 600/700 is modified', () => {
      expect(isStyleModified('fontWeight', {})).toBe(false);
      expect(isStyleModified('fontWeight', { fontWeight: '400' })).toBe(false);
      expect(isStyleModified('fontWeight', { fontWeight: 'normal' })).toBe(false);
      expect(isStyleModified('fontWeight', { fontWeight: '700' })).toBe(true);
      expect(isStyleModified('fontWeight', { fontWeight: 'bold' })).toBe(true);
    });

    it('textAlign: left is default, center/right is modified', () => {
      expect(isStyleModified('textAlign', {})).toBe(false);
      expect(isStyleModified('textAlign', { textAlign: 'left' })).toBe(false);
      expect(isStyleModified('textAlign', { textAlign: 'center' })).toBe(true);
    });
  });

  describe('variable and CMS bindings', () => {
    it('returns true when property has a style variable bound on node', () => {
      const node = makeNode({ styleVariables: { color: 'brandColor' } });
      expect(isStyleModified('color', {}, node)).toBe(true);
    });

    it('returns true when property has a CMS binding on node', () => {
      const node = makeNode({ cmsBindings: { textContent: 'post.title' } } as any);
      expect(isStyleModified('textContent', {}, node)).toBe(true);
    });
  });
});
