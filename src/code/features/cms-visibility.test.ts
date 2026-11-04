import { expect, it } from 'vitest';
import { parseJSXToNodes } from '../parsing/parser';
import { applyDetailPageBindings } from './cms-page-bindings';
import { applyNodeCmsBindings } from '../../canvas/renderer/bindings';
import { checkFile } from '../oracle/check-file';
import { detachCmsSubtreeWithValues, dormantizeCloneBindings, bakeCmsValuesOnClone, rehydrateCmsBindings } from '../generation/cms-detach-gen';

const page = (expression: string) => `/** @cmsPage { "collection": "posts", "kind": "detail" } */
export default function Page({ item }) { return <div data-id="root"><div data-id="bound" style={{ display: ${expression} }} /></div>; }`;
const row = { _id: 'post', _slug: 'post', _status: 'published' as const, _createdAt: '', _updatedAt: '' };

it.each([
  [false, 'grid'], [0, 'grid'], ['', 'none'], [null, 'none'], [[], 'none'], [['image'], 'grid'],
])('keeps isSet display semantics in detail and collection previews for %j', (cover, expected) => {
  const nodes = parseJSXToNodes(page(`(Array.isArray(item.cover) ? item.cover.length > 0 : item.cover != null && item.cover !== '') ? 'grid' : 'none'`));
  expect(applyDetailPageBindings(nodes, { cover }).get('bound')?.styles.display).toBe(expected);
  const el = document.createElement('div');
  applyNodeCmsBindings(el, nodes.get('bound')!, { ...row, cover }, 1200, null);
  expect(el.style.display).toBe(expected);
});

it('keeps direct display values and viewport unbind literals as CSS', () => {
  const nodes = parseJSXToNodes(page('item.layout'));
  expect(applyDetailPageBindings(nodes, { layout: 'grid' }).get('bound')?.styles.display).toBe('grid');
  const el = document.createElement('div');
  const node = nodes.get('bound')!;
  node.responsiveBindings = { style: { 390: { display: { value: 'none' } } } };
  applyNodeCmsBindings(el, node, { ...row, layout: 'grid' }, 390, null);
  expect(el.style.display).toBe('none');
});

it('uses JavaScript truthiness for a boolean visibility field', () => {
  const nodes = parseJSXToNodes(page("item.visible ? 'flex' : 'none'"));
  expect(applyDetailPageBindings(nodes, { visible: false }).get('bound')?.styles.display).toBe('none');
  expect(applyDetailPageBindings(nodes, { visible: true }).get('bound')?.styles.display).toBe('flex');
});

it('admits only parser-readable visibility predicates inside their CMS scope', () => {
  const codes = (code: string) => checkFile(code, { kind: 'page' }).map(issue => issue.code);
  expect(codes(page("item.visible ? 'flex' : 'none'"))).not.toContain('DISPLAY_TOGGLE_VISIBILITY');
  expect(codes(page("item.visible ? 'flex' : 'none'"))).not.toContain('UNRESOLVABLE_TERNARY');
  expect(codes(page("Boolean(item.visible) ? 'flex' : 'none'"))).toContain('DISPLAY_TOGGLE_VISIBILITY');
  expect(codes(page("item.visible ? 'flex' : 'none'").replace(/\/\*\* @cmsPage.*?\*\//, ''))).toContain('DISPLAY_TOGGLE_VISIBILITY');
  const list = `import posts from '@/cms/posts.json'; export default function Page() { return <div data-id="root">{posts.map(post => <div data-id="bound" key={post._id} style={{ display: post.visible ? 'block' : 'none' }} />)}</div>; }`;
  expect(codes(list)).not.toContain('DISPLAY_TOGGLE_VISIBILITY');
  expect(codes(list)).not.toContain('UNRESOLVABLE_TERNARY');
  expect(codes(list.replace('post.visible', 'item.visible'))).toContain('DISPLAY_TOGGLE_VISIBILITY');
  expect(codes(page("(item.visible || true) ? 'flex' : 'none'"))).toContain('DISPLAY_TOGGLE_VISIBILITY');
  expect(parseJSXToNodes(page("(item.visible || true) ? 'flex' : 'none'")).get('bound')?.styleBindings).toBeUndefined();
  expect(codes(list.replace("import posts from '@/cms/posts.json';", 'const posts = [{ _id: "a", visible: true }];'))).toContain('DISPLAY_TOGGLE_VISIBILITY');
});

it.each([
  ["item.visible ? 'flex' : 'none'", false, 'none'],
  ["(Array.isArray(item.visible) ? item.visible.length > 0 : item.visible != null && item.visible !== '') ? 'grid' : 'none'", false, 'grid'],
  ["(Array.isArray(item.visible) ? item.visible.length > 0 : item.visible != null && item.visible !== '') ? 'grid' : 'none'", [], 'none'],
])('preserves visibility and other styles across detach and re-entry: %s', (expression, visible, display) => {
  const code = page(expression).replace('display:', "color: 'red', display:");
  const bound = parseJSXToNodes(code).get('bound')!;
  const detached = detachCmsSubtreeWithValues(code, 'bound', 'item', { visible });
  const node = parseJSXToNodes(detached).get('bound')!;
  expect(node.styles).toMatchObject({ color: 'red', display });
  const reentered = rehydrateCmsBindings(`import posts from '@/cms/posts.json'; export default function Page() { return <div data-id="root">{posts.map(post => ${detached.slice(detached.indexOf('<div data-id="bound"'), detached.indexOf('/>', detached.indexOf('<div data-id="bound"')) + 2)})}</div>; }`, 'bound');
  expect(parseJSXToNodes(reentered).get('bound')?.styleBindings).toEqual(bound.styleBindings);
});

it('keeps visibility metadata on a copied model node so re-entry can restore the predicate', () => {
  const code = page("item.visible ? 'flex' : 'none'"), bound = parseJSXToNodes(code).get('bound')!;
  const clone = bakeCmsValuesOnClone(dormantizeCloneBindings({ textContent: '', styles: bound.styles, attrs: {}, styleBindings: bound.styleBindings }), { '__style.display': 'none' });
  const encoded = clone.attrs!['data-cms-orphan'];
  const reentered = rehydrateCmsBindings(`import posts from '@/cms/posts.json'; export default function Page() { return <div data-id="root">{posts.map(post => <div data-id="bound" data-cms-orphan="${encoded}" style={{ display: 'none' }} />)}</div>; }`, 'bound');
  expect(parseJSXToNodes(reentered).get('bound')?.styleBindings).toEqual(bound.styleBindings);
});

it('updates detached visibility when the next detail record has no field value', () => {
  const code = page("(Array.isArray(item.visible) ? item.visible.length > 0 : item.visible != null && item.visible !== '') ? 'grid' : 'none'");
  const detached = detachCmsSubtreeWithValues(code, 'bound', 'item', { visible: false });
  expect(applyDetailPageBindings(parseJSXToNodes(detached), {}).get('bound')?.styles.display).toBe('none');
});
