import { describe, it, expect, beforeEach } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { initMutationQueue, queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { reorderNodeInCode, moveNodeInCode } from './generator-crud';
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

const TEMPLATE_FIXTURE = `function NavBar({ style }: any) { return <nav style={style} />; }
function Footer({ style }: any) { return <footer style={style} />; }
function PageTransitions({ children }: any) { return <div>{children}</div>; }
export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root">
      <PageTransitions>{children}</PageTransitions>
      <NavBar data-id="nav" style={{ position: 'relative' }} />
      <Footer data-id="footer" />
    </div>
  );
}`;

describe('reorder and move in Glide and template files', () => {
  beforeEach(() => {
    // Reset any queue state
  });

  it('reorders nav to index 0 in Glide container via mutation queue', () => {
    let out = '';
    initMutationQueue(GLIDED_FIXTURE, (code) => { out = code; });
    queueMutation({ type: 'reorder', nodeId: 'nav', parentId: 'root', index: 0 });
    queueMutation({ type: 'updateStyles', nodeId: 'nav', styles: { order: '' } });
    flushNow();

    expect(parses(out)).toBe(true);
    const nodes = parseJSXToNodes(out);
    expect(nodes.get('root')?.children).toEqual(['nav', 'first', 'second']);
    expect(out).not.toContain('<motion.div data-glide-item layout style={{ order: \'2\' }}></motion.div>');
  });

  it('reorders nav directly with reorderNodeInCode', () => {
    const out = reorderNodeInCode(GLIDED_FIXTURE, 'nav', 'root', 0);
    expect(parses(out)).toBe(true);
    const nodes = parseJSXToNodes(out);
    expect(nodes.get('root')?.children).toEqual(['nav', 'first', 'second']);
    // All items remain in LayoutGroup with data-glide-item
    expect(out).toMatch(/<LayoutGroup>[\s\S]*<NavBar data-id="nav"[\s\S]*<Section data-id="first"[\s\S]*<Section data-id="second"[\s\S]*<\/LayoutGroup>/);
  });

  it('PageTransitions regression: reordering NavBar to index 0 places it before PageTransitions', () => {
    const out = reorderNodeInCode(TEMPLATE_FIXTURE, 'nav', 'root', 0);
    expect(parses(out)).toBe(true);
    // NavBar must come before PageTransitions in JSX
    const navIdx = out.indexOf('<NavBar data-id="nav"');
    const ptIdx = out.indexOf('<PageTransitions>');
    expect(navIdx).toBeGreaterThan(-1);
    expect(ptIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeLessThan(ptIdx);

    // {children} remains inside PageTransitions exactly once
    const rootBlock = out.slice(out.indexOf('<div data-id="root">'));
    const childrenMatches = rootBlock.match(/\{children\}/g);
    expect(childrenMatches?.length).toBe(1);
    expect(out).toContain('<PageTransitions>{children}</PageTransitions>');
  });

  it('moves nav from inside a section to root between two sections using anchor', () => {
    const nested = `function NavBar({ style }: any) { return <div style={style} />; }
function Section({ children, style }: any) { return <section style={style}>{children}</section>; }
export default function Page() {
  return (
    <motion.div data-id="root" data-glide='{"transition":{"type":"spring"}}'>
      <LayoutGroup>
        <motion.div data-glide-item layout><Section data-id="first"><NavBar data-id="nav" /></Section></motion.div>
        <motion.div data-glide-item layout><Section data-id="second" /></motion.div>
      </LayoutGroup>
    </motion.div>
  );
}`;

    let out = '';
    initMutationQueue(nested, (code) => { out = code; });
    queueMutation({
      type: 'move',
      nodeId: 'nav',
      newParentId: 'root',
      index: 1,
      insertBeforeId: 'second',
      styles: { position: 'relative' },
    });
    flushNow();

    expect(parses(out)).toBe(true);
    const nodes = parseJSXToNodes(out);
    expect(nodes.get('root')?.children).toEqual(['first', 'nav', 'second']);
    expect(out).not.toContain('<motion.div data-glide-item layout></motion.div>');
  });
});
