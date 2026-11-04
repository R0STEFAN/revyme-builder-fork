import { expect, it } from 'vitest';
import { buildChainCode, updateCollectionListConfigInCode } from './cms-gen';
import { parseJSXToNodes } from '../parsing/parser';
import { applyDetailPageBindings } from '../features/cms-page-bindings';
import type { FilterGroup } from '../../shared/types';
import { writeResponsiveListConfigInCode } from './cms-responsive-gen';

const filters: FilterGroup = { combinator: 'and', filters: [
  { field: '_id', operator: 'in', value: '', valueSource: 'variable', valueVar: 'item.related' },
  { field: 'featured', operator: 'equals', value: true },
] };

it('filters rows against an enclosing detail record without shadowing it in mixed predicates', () => {
  const rows = [{ _id: 'a', featured: true }, { _id: 'b', featured: false }, { _id: 'c', featured: true }];
  const chain = buildChainCode('rows', filters);
  const run = new Function('rows', 'item', `return ${chain}`);
  expect(run(rows, { related: ['a', 'b'] })).toEqual([{ _id: 'a', featured: true }]);
  expect(run(rows, { related: [] })).toEqual([]);
});

it('does not shadow a second enclosing variable when choosing a filter iterator', () => {
  const group: FilterGroup = { ...filters, filters: [filters.filters[0], { field: 'category', operator: 'equals', value: '', valueSource: 'variable', valueVar: 'row.category' }] };
  const chain = buildChainCode('rows', group);
  expect(new Function('rows', 'item', 'row', `return ${chain}`)([{ _id: 'a', category: 'x' }, { _id: 'b', category: 'y' }], { related: ['a', 'b'] }, { category: 'x' })).toEqual([{ _id: 'a', category: 'x' }]);
});

it('retains enclosing-field filters through a native config edit and detail preview', () => {
  const code = `/** @cmsPage { "collection": "posts", "kind": "detail" } */
import rows from '@/cms/works.json';
export default function Page({ item }) { return <div data-id="root"><div data-id="list">{${buildChainCode('rows', filters)}.map(card => <p data-id="title" key={card._id}>{card.title}</p>)}</div></div>; }`;
  const parsed = parseJSXToNodes(code);
  const unresolved = { ...filters, filters: [{ ...filters.filters[0], value: undefined }, filters.filters[1]] };
  expect(parsed.get('list')?.collectionList?.filterGroup).toEqual(unresolved);
  const preview = applyDetailPageBindings(parsed, { related: ['a'] });
  expect(preview.get('list')?.collectionList?.filterGroup?.filters[0].value).toEqual(['a']);
  const edited = updateCollectionListConfigInCode(code, 'list', filters, null, 2);
  expect(parseJSXToNodes(edited).get('list')?.collectionList?.filterGroup).toEqual(unresolved);
});

it('resolves enclosing detail fields in responsive and variant list configs without mutating the parser cache', () => {
  const code = `/** @cmsPage { "collection": "posts", "kind": "detail" } */
import rows from '@/cms/works.json';
export default function Page({ item }) { return <div data-id="root">{rows.map(card => <p data-id="title" key={card._id}>{card.title}</p>)}</div>; }`;
  const nodes = parseJSXToNodes(code), list = nodes.get('root')!.collectionList!;
  list.responsive = { 390: { filterGroup: filters } };
  list.variantConfigs = { featured: { filterGroup: filters } };
  const resolved = applyDetailPageBindings(nodes, { related: ['a'] }).get('root')!.collectionList!;
  expect(resolved.responsive?.[390].filterGroup?.filters[0].value).toEqual(['a']);
  expect(resolved.variantConfigs?.featured.filterGroup?.filters[0].value).toEqual(['a']);
  expect(filters.filters[0].value).toBe('');
});

it('preserves enclosing-item filters when the last responsive override is removed', () => {
  const code = `/** @cmsPage { "collection": "posts", "kind": "detail" } */
import rows from '@/cms/works.json';
export default function Page({ item }) { return <div data-id="root"><div data-id="list">{rows.map(card => <p data-id="title" key={card._id}>{card.title}</p>)}</div></div>; }`;
  const base = { filterGroup: filters };
  const upgraded = writeResponsiveListConfigInCode(code, 'list', 'rows', { base, viewport: { 390: { sort: [{ field: 'title', direction: 'asc' }] } }, variants: {} });
  const downgraded = writeResponsiveListConfigInCode(upgraded, 'list', 'rows', { base, viewport: {}, variants: {} });
  expect(parseJSXToNodes(downgraded).get('list')?.collectionList?.filterGroup?.filters[0]).toMatchObject({ field: '_id', operator: 'in', valueSource: 'variable', valueVar: 'item.related' });
});
