import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import { buildFilterExpression } from './cms-gen';
import { listConfigVar, writeResponsiveListConfigInCode } from './cms-responsive-gen';
import { parseJSXToNodes } from '../parsing/parser';
import type { FilterGroup } from '../../shared/types';

const group: FilterGroup = { combinator: 'and', filters: [{ field: '_id', operator: 'equals', value: '', valueSource: 'variable', valueVar: 'category' }] };
const base = `import rows from '@/cms/rows.json';
export default function Card({category = 'A'}) { return <div data-id="list">{rows.map(item => <p data-id="row">{item.title}</p>)}</div>; }`;

describe('native variable-driven CMS predicates', () => {
  it('uses strict equality without the search input empty guard', () => {
    const predicate = buildFilterExpression(group);
    const run = new Function('item', 'category', `return ${predicate};`);
    expect(run({ _id: 'A' }, 'A')).toBe(true);
    expect(run({ _id: 'A' }, '')).toBe(false);
    expect(run({ _id: 'A' }, 'a')).toBe(false);
    expect(run({ _id: 0 }, false)).toBe(false);
    expect(run({ _id: false }, false)).toBe(true);
  });
  it('parses a prop binding and resolves its default and instance override for canvas', () => {
    const code = base.replace('rows.map', `rows.filter(item => item._id === category).map`);
    expect(parseJSXToNodes(code).get('list')?.collectionList?.filterGroup?.filters).toEqual([{ ...group.filters[0], value: 'A' }]);
    expect(parseJSXToNodes(code, { category: 'B' }).get('list')?.collectionList?.filterGroup?.filters[0]).toMatchObject({ valueSource: 'variable', valueVar: 'category', value: 'B' });
  });
  it('keeps boolean and numeric defaults typed instead of comparing to strings', () => {
    const code = `import rows from '@/cms/rows.json'; export default function Card({flag = false, count = 0}) { return <div data-id="list">{rows.filter(item => item.active === flag && item.rank === count).map(item => <p data-id="row">{item.title}</p>)}</div>; }`;
    expect(parseJSXToNodes(code).get('list')?.collectionList?.filterGroup?.filters.map(filter => filter.value)).toEqual([false, 0]);
  });
  it.each(['in', 'not_in'] as const)('retains a variable %s predicate and an empty array default', operator => {
    const filter: FilterGroup = { combinator: 'and', filters: [{ ...group.filters[0], operator, valueVar: 'related' }] };
    const predicate = buildFilterExpression(filter);
    const code = `import rows from '@/cms/rows.json'; export default function Card({related = []}) { return <div data-id="list">{rows.filter(item => ${predicate}).map(item => <p data-id="row">{item.title}</p>)}</div>; }`;
    const parsed = parseJSXToNodes(code).get('list')?.collectionList?.filterGroup?.filters[0];
    expect(parsed).toMatchObject({ field: '_id', operator, valueSource: 'variable', valueVar: 'related', value: [] });
    const run = new Function('item', 'related', `return ${predicate};`);
    expect(run({ _id: 'A' }, ['A'])).toBe(operator === 'in');
    expect(run({ _id: 'A' }, null)).toBe(operator === 'not_in');
  });
  it('preserves runtime variable values through responsive upgrade and downgrade', () => {
    const code = writeResponsiveListConfigInCode(base, 'list', 'rows', {
      base: { filterGroup: group }, viewport: { 768: { filterGroup: group } }, variants: {},
    }, { vpWidths: [768] });
    const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const declarations = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && ['useResponsiveListConfig', '__matchListFilter', '__applyListConfig'].includes(node.id!.name));
    const runtime = declarations.map(node => code.slice(node.start!, node.end!)).join('\n');
    const cfgName = listConfigVar('list');
    const expression = new RegExp(`const ${cfgName} = ([^;]+);`).exec(code)![1];
    const run = new Function('useState', 'useEffect', 'category', 'rows', `${runtime}; return __applyListConfig(rows, ${expression});`);
    const rows = [{ _id: 'A' }, { _id: 'B' }];
    const state = () => [500, () => {}];
    expect(run(state, () => {}, 'B', rows)).toEqual([{ _id: 'B' }]);
    expect(run(state, () => {}, '', rows)).toEqual([]);
    const down = writeResponsiveListConfigInCode(code, 'list', 'rows', { base: { filterGroup: group }, viewport: {}, variants: {} }, {});
    expect(parseJSXToNodes(down, { category: 'B' }).get('list')?.collectionList?.filterGroup?.filters[0]).toMatchObject({ valueSource: 'variable', valueVar: 'category', value: 'B' });
  });
});
