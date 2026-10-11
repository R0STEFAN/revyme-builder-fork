import { describe, it, expect } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { initMutationQueue, queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { addNodeInCode } from './generator-crud';
import { parse } from '@babel/parser';

const parses = (c: string) => {
  parse(c, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  return true;
};

const GLIDED_FIXTURE = `function NavBar({ style }: any) { return <div style={style} />; }
function Section({ style }: any) { return <section style={style} />; }
export default function Page() {
  return (
    <motion.div data-id="root" data-glide='{"transition":{"type":"spring"}}'>
      <LayoutGroup>
        <motion.div data-glide-item layout style={{ order: '0' }}><Section data-id="first" /></motion.div>
        <motion.div data-glide-item layout style={{ order: '1' }}><Section data-id="second" /></motion.div>
        <motion.div data-glide-item layout style={{ order: '2' }}><NavBar data-id="nav" /></motion.div>
      </LayoutGroup>
    </motion.div>
  );
}`;

const PLAIN_TEMPLATE_FIXTURE = `function Header() { return <header />; }
function Footer() { return <footer />; }
export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root">
      <Header data-id="header" />
      {children}
      <Footer data-id="footer" />
    </div>
  );
}`;

const TRANSITIONS_TEMPLATE_FIXTURE = `function Header() { return <header />; }
function Footer() { return <footer />; }
function PageTransitions({ children }: any) { return <div>{children}</div>; }
export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root">
      <Header data-id="header" />
      <PageTransitions>{children}</PageTransitions>
      <Footer data-id="footer" />
    </div>
  );
}`;

const STYLE_TEMPLATE_FIXTURE = `function Header() { return <header />; }
function Footer() { return <footer />; }
export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root">
      <style>{\`body { margin: 0; }\`}</style>
      <Header data-id="header" />
      {children}
      <Footer data-id="footer" />
    </div>
  );
}`;

describe('addNode with logical child slots', () => {
  it('adds node into Glide root at index 1 via mutation queue', () => {
    let out = '';
    initMutationQueue(GLIDED_FIXTURE, (code) => { out = code; });
    queueMutation({
      type: 'addNode',
      parentId: 'root',
      node: { id: 'inserted', type: 'div', name: 'Inserted', styles: {} },
      index: 1,
    });
    flushNow();

    expect(parses(out)).toBe(true);
    const nodes = parseJSXToNodes(out);
    expect(nodes.get('root')?.children).toEqual(['first', 'inserted', 'second', 'nav']);
    expect(out).toContain('data-glide-item');
    expect(out).toContain('data-id="inserted"');
  });

  it('inserts node before {children} in plain template fixture at index 1', () => {
    const out = addNodeInCode(
      PLAIN_TEMPLATE_FIXTURE,
      'root',
      { id: 'banner', type: 'div', styles: {} },
      1,
    );
    expect(parses(out)).toBe(true);
    const bannerIdx = out.indexOf('data-id="banner"');
    const childrenIdx = out.indexOf('{children}');
    const footerIdx = out.indexOf('data-id="footer"');
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(childrenIdx);
    expect(childrenIdx).toBeLessThan(footerIdx);
  });

  it('inserts node after {children} in plain template fixture at index 2', () => {
    const out = addNodeInCode(
      PLAIN_TEMPLATE_FIXTURE,
      'root',
      { id: 'banner', type: 'div', styles: {} },
      2,
    );
    expect(parses(out)).toBe(true);
    const childrenIdx = out.indexOf('{children}');
    const bannerIdx = out.indexOf('data-id="banner"');
    const footerIdx = out.indexOf('data-id="footer"');
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(childrenIdx).toBeLessThan(bannerIdx);
    expect(bannerIdx).toBeLessThan(footerIdx);
  });

  it('inserts node before children-slot using insertBeforeId in plain template fixture', () => {
    const out = addNodeInCode(
      PLAIN_TEMPLATE_FIXTURE,
      'root',
      { id: 'banner', type: 'div', styles: {} },
      undefined,
      'children-slot',
    );
    expect(parses(out)).toBe(true);
    const bannerIdx = out.indexOf('data-id="banner"');
    const childrenIdx = out.indexOf('{children}');
    expect(bannerIdx).toBeLessThan(childrenIdx);
  });

  it('inserts node before PageTransitions wrapped {children}', () => {
    const out = addNodeInCode(
      TRANSITIONS_TEMPLATE_FIXTURE,
      'root',
      { id: 'banner', type: 'div', styles: {} },
      1,
    );
    expect(parses(out)).toBe(true);
    const bannerIdx = out.indexOf('data-id="banner"');
    const transitionsIdx = out.indexOf('<PageTransitions>');
    expect(bannerIdx).toBeLessThan(transitionsIdx);
  });

  it('inserts node after PageTransitions wrapped {children}', () => {
    const out = addNodeInCode(
      TRANSITIONS_TEMPLATE_FIXTURE,
      'root',
      { id: 'banner', type: 'div', styles: {} },
      2,
    );
    expect(parses(out)).toBe(true);
    const transitionsIdx = out.indexOf('</PageTransitions>');
    const bannerIdx = out.indexOf('data-id="banner"');
    const footerIdx = out.indexOf('data-id="footer"');
    expect(transitionsIdx).toBeLessThan(bannerIdx);
    expect(bannerIdx).toBeLessThan(footerIdx);
  });

  it('correctly skips leading <style> tag when inserting by index', () => {
    const out = addNodeInCode(
      STYLE_TEMPLATE_FIXTURE,
      'root',
      { id: 'top-bar', type: 'div', styles: {} },
      0,
    );
    expect(parses(out)).toBe(true);
    const styleIdx = out.indexOf('<style>');
    const topBarIdx = out.indexOf('data-id="top-bar"');
    const headerIdx = out.indexOf('data-id="header"');
    expect(styleIdx).toBeLessThan(topBarIdx);
    expect(topBarIdx).toBeLessThan(headerIdx);
  });
});
