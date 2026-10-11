import { describe, it, expect } from 'vitest';
import { parseJSX, findFirstElementByDataId } from '@/code/parsing/ast-utils';
import { parseJSXToNodes } from '@/code/parsing/parser';
import {
  collectLogicalChildSlots,
  insertLogicalChild,
  findLogicalChildSlot,
  removeLogicalChild,
} from './jsx-child-slots';
import * as t from '@babel/types';

describe('jsx-child-slots', () => {
  it('collects plain direct children', () => {
    const code = `<div data-id="root">
      <div data-id="c1" />
      <div data-id="c2" />
    </div>`;
    const ast = parseJSX(code)!;
    let slots: any[] = [];
    findFirstElementByDataId(ast, 'root', (path) => {
      slots = collectLogicalChildSlots(path.node);
    });
    expect(slots.map((s) => s.id)).toEqual(['c1', 'c2']);
    const nodes = parseJSXToNodes(code);
    expect(nodes.get('root')?.children).toEqual(['c1', 'c2']);
  });

  it('traverses transparent LayoutGroup and collects inner Glide items as single units', () => {
    const code = `<motion.div data-id="root" data-glide='{"transition":{}}'>
      <LayoutGroup>
        <motion.div data-glide-item><section data-id="first" /></motion.div>
        <motion.div data-glide-item><section data-id="second" /></motion.div>
        <motion.div data-glide-item><div data-id="nav" /></motion.div>
      </LayoutGroup>
    </motion.div>`;
    const ast = parseJSX(code)!;
    let slots: any[] = [];
    findFirstElementByDataId(ast, 'root', (path) => {
      slots = collectLogicalChildSlots(path.node);
    });
    expect(slots.map((s) => s.id)).toEqual(['first', 'second', 'nav']);
    // Each slot's owner should be the LayoutGroup element, and node should be the motion.div glide wrapper
    expect(slots[0].owner.type).toBe('JSXElement');
    expect(slots[0].node.openingElement.attributes.some((a: any) => a.name?.name === 'data-glide-item')).toBe(true);

    const nodes = parseJSXToNodes(code);
    expect(nodes.get('root')?.children).toEqual(['first', 'second', 'nav']);
  });

  it('collects template {children} and ignores leading <style> and comments', () => {
    const code = `<div data-id="root">
      <style>{\`@media (max-width: 768px) { ... }\`}</style>
      {/* comment */}
      <Header data-id="header" />
      {children}
      <Footer data-id="footer" />
    </div>`;
    const ast = parseJSX(code)!;
    let slots: any[] = [];
    findFirstElementByDataId(ast, 'root', (path) => {
      slots = collectLogicalChildSlots(path.node);
    });
    expect(slots.map((s) => s.id)).toEqual(['header', 'children-slot', 'footer']);
  });

  it('collects PageTransitions-wrapped {children} as whole unit with id children-slot', () => {
    const code = `<div data-id="root">
      <Header data-id="header" />
      <PageTransitions>{children}</PageTransitions>
      <Footer data-id="footer" />
    </div>`;
    const ast = parseJSX(code)!;
    let slots: any[] = [];
    findFirstElementByDataId(ast, 'root', (path) => {
      slots = collectLogicalChildSlots(path.node);
    });
    expect(slots.map((s) => s.id)).toEqual(['header', 'children-slot', 'footer']);
    expect(slots[1].node.openingElement.name.name).toBe('PageTransitions');
  });

  it('collects AnimatePresence wrapper as single unit under inner element data-id', () => {
    const code = `<div data-id="root">
      <AnimatePresence>
        {variant !== 'default' && <div data-id="menu" />}
      </AnimatePresence>
      <div data-id="main" />
    </div>`;
    const ast = parseJSX(code)!;
    let slots: any[] = [];
    findFirstElementByDataId(ast, 'root', (path) => {
      slots = collectLogicalChildSlots(path.node);
    });
    expect(slots.map((s) => s.id)).toEqual(['menu', 'main']);
    expect(slots[0].node.openingElement.name.name).toBe('AnimatePresence');
  });

  it('collects CMS collection .map() container under inner template data-id', () => {
    const code = `<div data-id="root">
      {items.map((item: any) => (
        <div data-id="card" key={item.id} />
      ))}
    </div>`;
    const ast = parseJSX(code)!;
    let slots: any[] = [];
    findFirstElementByDataId(ast, 'root', (path) => {
      slots = collectLogicalChildSlots(path.node);
    });
    expect(slots.map((s) => s.id)).toEqual(['card']);
    expect(slots[0].node.type).toBe('JSXExpressionContainer');
  });

  it('insertLogicalChild inserts before named anchor inside LayoutGroup', () => {
    const code = `<motion.div data-id="root" data-glide='{"transition":{}}'>
      <LayoutGroup>
        <motion.div data-glide-item><section data-id="first" /></motion.div>
        <motion.div data-glide-item><section data-id="second" /></motion.div>
      </LayoutGroup>
    </motion.div>`;
    const ast = parseJSX(code)!;
    const newNode = t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier('section'), [
        t.jsxAttribute(t.jsxIdentifier('data-id'), t.stringLiteral('inserted')),
      ], true),
      null,
      [],
      true,
    );

    findFirstElementByDataId(ast, 'root', (path) => {
      const ok = insertLogicalChild(path.node, newNode, 1, 'second');
      expect(ok).toBe(true);
      const slots = collectLogicalChildSlots(path.node);
      expect(slots.map((s) => s.id)).toEqual(['first', 'inserted', 'second']);
    });
  });

  it('insertLogicalChild inserts by index at start, middle, and end', () => {
    const code = `<div data-id="root">
      <div data-id="first" />
      <div data-id="second" />
    </div>`;
    const createNode = (id: string) => t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier('div'), [
        t.jsxAttribute(t.jsxIdentifier('data-id'), t.stringLiteral(id)),
      ], true),
      null,
      [],
      true,
    );

    // Index 0 -> before first
    const ast0 = parseJSX(code)!;
    findFirstElementByDataId(ast0, 'root', (path) => {
      insertLogicalChild(path.node, createNode('lead'), 0);
      expect(collectLogicalChildSlots(path.node).map((s) => s.id)).toEqual(['lead', 'first', 'second']);
    });

    // Index 1 -> between first and second
    const ast1 = parseJSX(code)!;
    findFirstElementByDataId(ast1, 'root', (path) => {
      insertLogicalChild(path.node, createNode('mid'), 1);
      expect(collectLogicalChildSlots(path.node).map((s) => s.id)).toEqual(['first', 'mid', 'second']);
    });

    // Index 2 -> after second
    const ast2 = parseJSX(code)!;
    findFirstElementByDataId(ast2, 'root', (path) => {
      insertLogicalChild(path.node, createNode('tail'), 2);
      expect(collectLogicalChildSlots(path.node).map((s) => s.id)).toEqual(['first', 'second', 'tail']);
    });
  });

  it('removeLogicalChild removes whole slot wrapper cleanly', () => {
    const code = `<motion.div data-id="root" data-glide='{"transition":{}}'>
      <LayoutGroup>
        <motion.div data-glide-item><section data-id="first" /></motion.div>
        <motion.div data-glide-item><section data-id="second" /></motion.div>
      </LayoutGroup>
    </motion.div>`;
    const ast = parseJSX(code)!;
    findFirstElementByDataId(ast, 'root', (path) => {
      const removed = removeLogicalChild(path.node, 'first');
      expect(removed).not.toBeNull();
      expect((removed as any).openingElement.attributes.some((a: any) => a.name?.name === 'data-glide-item')).toBe(true);
      const remaining = collectLogicalChildSlots(path.node);
      expect(remaining.map((s) => s.id)).toEqual(['second']);
    });
  });
});
