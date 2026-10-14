// Differential test suite: generated filter predicates (cms-gen.ts) vs canvas matcher (Renderer.ts:matchesValue)
import { describe, expect, it } from 'vitest';
import { transform } from '@babel/standalone';
import { parse } from '@babel/parser';
import { buildFilterExpression } from '@/code/generation/cms-gen';
import { matchesValue, getDeepFieldValue } from '@/canvas/Renderer';
import { checkCmsQueryConfig } from '@/code/oracle/check-file';
import type { FilterGroup } from '@/shared/types';
import type { OracleViolation } from '@/code/oracle/check-file';

function compileFilterPredicate(fg: FilterGroup, extraScope: Record<string, any> = {}): (item: any, params?: any) => boolean {
  const expression = buildFilterExpression(fg);
  const js = transform(`function match(item: any, params: any) { return (${expression}); }`, {
    filename: 'predicate.ts',
    presets: ['typescript'],
  }).code!;

  const scopeKeys = Object.keys(extraScope);
  const scopeValues = Object.values(extraScope);
  const factory = new Function(...scopeKeys, `${js}; return match;`);
  return factory(...scopeValues);
}

describe('CMS Filter Differential: generated predicate vs canvas matcher parity', () => {
  describe('1. Exact relation equality vs substring matching', () => {
    it('rejects substring match on relations for exact equality in both generated code and canvas matcher', () => {
      const itemJapanese = { id: 1, category: { slug: 'japanese' } };
      const itemJapan = { id: 2, category: { slug: 'japan' } };

      // Deep field relation filter
      const filterGroup: FilterGroup = {
        combinator: 'and',
        filters: [
          { field: 'category.slug', operator: 'equals', value: 'japan' },
        ],
      };
      const predicate = compileFilterPredicate(filterGroup);

      // Generated predicate
      expect(predicate(itemJapanese)).toBe(false);
      expect(predicate(itemJapan)).toBe(true);

      // Canvas matchesValue
      expect(matchesValue(getDeepFieldValue(itemJapanese, 'category.slug'), 'japan', true)).toBe(false);
      expect(matchesValue(getDeepFieldValue(itemJapan, 'category.slug'), 'japan', true)).toBe(true);
      expect(matchesValue(itemJapanese.category, 'japan', true)).toBe(false);
      expect(matchesValue(itemJapan.category, 'japan', true)).toBe(true);
    });

    it('rejects routeParam substring matching on deep relations', () => {
      const itemJapanese = { id: 1, category: { slug: 'japanese' } };
      const itemJapan = { id: 2, category: { slug: 'japan' } };

      const filterGroup: FilterGroup = {
        combinator: 'and',
        filters: [
          { field: 'category.slug', operator: 'equals', value: '', valueSource: 'routeParam', valueVar: 'cat' },
        ],
      };
      const predicate = compileFilterPredicate(filterGroup);

      expect(predicate(itemJapanese, { cat: 'japan' })).toBe(false);
      expect(predicate(itemJapan, { cat: 'japan' })).toBe(true);

      expect(matchesValue(itemJapanese.category, 'japan', true)).toBe(false);
      expect(matchesValue(itemJapan.category, 'japan', true)).toBe(true);
    });

    it('supports routeParam not_equals without substring false-negatives', () => {
      const itemJapanese = { id: 1, category: { slug: 'japanese' } };
      const itemJapan = { id: 2, category: { slug: 'japan' } };

      const filterGroup: FilterGroup = {
        combinator: 'and',
        filters: [
          { field: 'category.slug', operator: 'not_equals', value: '', valueSource: 'routeParam', valueVar: 'cat' },
        ],
      };
      const predicate = compileFilterPredicate(filterGroup);

      // For search 'japan', 'japanese' is NOT equal to 'japan', so not_equals should be true!
      expect(predicate(itemJapanese, { cat: 'japan' })).toBe(true);
      expect(predicate(itemJapan, { cat: 'japan' })).toBe(false);

      expect(!matchesValue(itemJapanese.category, 'japan', true)).toBe(true);
      expect(!matchesValue(itemJapan.category, 'japan', true)).toBe(false);
    });
  });

  describe('2. Substring contains', () => {
    it('accepts substring match when operator is contains in both generated code and canvas matcher', () => {
      const itemJapanese = { id: 1, category: { slug: 'japanese' } };
      const itemOther = { id: 2, category: { slug: 'french' } };

      const filterGroup: FilterGroup = {
        combinator: 'and',
        filters: [
          { field: 'category.slug', operator: 'contains', value: 'japan' },
        ],
      };
      const predicate = compileFilterPredicate(filterGroup);

      // Generated predicate
      expect(predicate(itemJapanese)).toBe(true);
      expect(predicate(itemOther)).toBe(false);

      // Canvas matchesValue with exact: false
      expect(matchesValue(getDeepFieldValue(itemJapanese, 'category.slug'), 'japan', false)).toBe(true);
      expect(matchesValue(getDeepFieldValue(itemOther, 'category.slug'), 'japan', false)).toBe(false);
      expect(matchesValue(itemJapanese.category, 'japan', false)).toBe(true);
      expect(matchesValue(itemOther.category, 'japan', false)).toBe(false);
    });
  });

  describe('3. M2M array of objects / IDs', () => {
    const itemWithTags = {
      id: 10,
      tags: [
        { id: 1, slug: 'men', name: 'Men Fashion' },
        { id: 2, slug: 'women', name: 'Women Fashion' },
      ],
    };

    it('matches exact tag slug and rejects partial substring when operator is equals', () => {
      const filterGroupMen: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'tags', operator: 'equals', value: 'men' }],
      };
      const filterGroupMe: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'tags', operator: 'equals', value: 'me' }],
      };

      const predMen = compileFilterPredicate(filterGroupMen);
      const predMe = compileFilterPredicate(filterGroupMe);

      // Exact match for 'men'
      expect(predMen(itemWithTags)).toBe(true);
      expect(matchesValue(itemWithTags.tags, 'men', true)).toBe(true);

      // Exact match for 'me' MUST be false (no substring matching in equals)
      expect(predMe(itemWithTags)).toBe(false);
      expect(matchesValue(itemWithTags.tags, 'me', true)).toBe(false);
    });

    it('matches partial substring on M2M when operator is contains', () => {
      const filterGroupMeContains: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'tags', operator: 'contains', value: 'me' }],
      };
      const predMeContains = compileFilterPredicate(filterGroupMeContains);

      expect(predMeContains(itemWithTags)).toBe(true);
      expect(matchesValue(itemWithTags.tags, 'me', false)).toBe(true);
    });

    it('handles numeric ID matching inside M2M array', () => {
      const filterGroupById: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'tags', operator: 'equals', value: '1' }],
      };
      const predById = compileFilterPredicate(filterGroupById);

      expect(predById(itemWithTags)).toBe(true);
      expect(matchesValue(itemWithTags.tags, '1', true)).toBe(true);
    });
  });

  describe('4. Null, undefined, and missing field handling', () => {
    const emptyItem = {};
    const nullCatItem = { category: null };
    const undefCatItem = { category: undefined };
    const nullSlugItem = { category: { slug: null } };

    it('evaluates safely without crashing or false-matching', () => {
      const filterGroup: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'category.slug', operator: 'equals', value: 'japan' }],
      };
      const predicate = compileFilterPredicate(filterGroup);

      expect(predicate(emptyItem)).toBe(false);
      expect(predicate(nullCatItem)).toBe(false);
      expect(predicate(undefCatItem)).toBe(false);
      expect(predicate(nullSlugItem)).toBe(false);

      expect(matchesValue(getDeepFieldValue(emptyItem, 'category.slug'), 'japan', true)).toBe(false);
      expect(matchesValue(getDeepFieldValue(nullCatItem, 'category.slug'), 'japan', true)).toBe(false);
      expect(matchesValue(getDeepFieldValue(nullSlugItem, 'category.slug'), 'japan', true)).toBe(false);
    });

    it('empty search value matches all items as an empty guard', () => {
      expect(matchesValue({ slug: 'japan' }, '', true)).toBe(true);
      expect(matchesValue(null, '', true)).toBe(true);

      const filterGroup: FilterGroup = {
        combinator: 'and',
        filters: [
          { field: 'category.slug', operator: 'equals', value: '', valueSource: 'routeParam', valueVar: 'q' },
        ],
      };
      const predicate = compileFilterPredicate(filterGroup);
      expect(predicate({ category: { slug: 'anything' } }, { q: '' })).toBe(true);
      expect(predicate({ category: { slug: 'anything' } }, {})).toBe(true);
    });
  });

  describe('5. Numbers and IDs: ID 19 vs 1', () => {
    const item19 = { id: 19, title: 'Item Nineteen' };

    it('matches exact ID 19 and rejects 1 on equals', () => {
      const filter19: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'id', operator: 'equals', value: '19' }],
      };
      const filter1: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'id', operator: 'equals', value: '1' }],
      };

      const pred19 = compileFilterPredicate(filter19);
      const pred1 = compileFilterPredicate(filter1);

      expect(pred19(item19)).toBe(true);
      expect(pred1(item19)).toBe(false);

      expect(matchesValue(item19.id, '19', true)).toBe(true);
      expect(matchesValue(item19.id, '1', true)).toBe(false);
    });

    it('matches substring on ID with contains operator', () => {
      const filterContains1: FilterGroup = {
        combinator: 'and',
        filters: [{ field: 'id', operator: 'contains', value: '1' }],
      };
      const predContains1 = compileFilterPredicate(filterContains1);

      expect(predContains1(item19)).toBe(true);
      expect(matchesValue(item19.id, '1', false)).toBe(true);
    });
  });

  describe('6. Combinators: AND vs OR combinations', () => {
    const itemA = { id: 1, category: { slug: 'japan' }, featured: true };
    const itemB = { id: 2, category: { slug: 'korea' }, featured: true };
    const itemC = { id: 3, category: { slug: 'japan' }, featured: false };

    it('filters correctly with AND combinator', () => {
      const filterGroupAnd: FilterGroup = {
        combinator: 'and',
        filters: [
          { field: 'category.slug', operator: 'equals', value: 'japan' },
          { field: 'featured', operator: 'equals', value: true },
        ],
      };
      const predAnd = compileFilterPredicate(filterGroupAnd);

      expect(predAnd(itemA)).toBe(true);
      expect(predAnd(itemB)).toBe(false);
      expect(predAnd(itemC)).toBe(false);
    });

    it('filters correctly with OR combinator', () => {
      const filterGroupOr: FilterGroup = {
        combinator: 'or',
        filters: [
          { field: 'category.slug', operator: 'equals', value: 'korea' },
          { field: 'featured', operator: 'equals', value: false },
        ],
      };
      const predOr = compileFilterPredicate(filterGroupOr);

      expect(predOr(itemA)).toBe(false);
      expect(predOr(itemB)).toBe(true);
      expect(predOr(itemC)).toBe(true);
    });
  });

  describe('7. Oracle checkCmsQueryConfig dialect rules', () => {
    function runOracleCheck(code: string): OracleViolation[] {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });
      const violations: OracleViolation[] = [];
      checkCmsQueryConfig(code, ast, violations);
      return violations;
    }

    it('passes clean collection list with valid data-query-config', () => {
      const code = `export default function Page() {
        return (
          <div data-id="list" data-query-config={JSON.stringify({ isApiMode: true, params: [{ key: "limit", value: "10" }] })}>
            {items.map(item => <p data-id="row">{item.title}</p>)}
          </div>
        );
      }`;
      const v = runOracleCheck(code);
      expect(v).toHaveLength(0);
    });

    it('flags duplicate data-query-config attributes on the same element', () => {
      const code = `export default function Page() {
        return (
          <div data-id="list" data-query-config='{"params":[]}' data-query-config='{"params":[]}'>
            {items.map(item => <p data-id="row">{item.title}</p>)}
          </div>
        );
      }`;
      const v = runOracleCheck(code);
      expect(v.some(violation => violation.code === 'CMS_DUPLICATE_QUERY_CONFIG')).toBe(true);
    });

    it('flags malformed JSON string in data-query-config', () => {
      const code = `export default function Page() {
        return (
          <div data-id="list" data-query-config="{invalid-json:">
            {items.map(item => <p data-id="row">{item.title}</p>)}
          </div>
        );
      }`;
      const v = runOracleCheck(code);
      expect(v.some(violation => violation.code === 'CMS_MALFORMED_QUERY_CONFIG')).toBe(true);
    });

    it('flags invalid or unescaped JS syntax expression in query params', () => {
      const code = `export default function Page() {
        return (
          <div data-id="list" data-query-config={JSON.stringify({ isApiMode: true, params: [{ key: "filter", value: "params...slug", isExpression: true }] })}>
            {items.map(item => <p data-id="row">{item.title}</p>)}
          </div>
        );
      }`;
      const v = runOracleCheck(code);
      expect(v.some(violation => violation.code === 'CMS_MALFORMED_QUERY_CONFIG')).toBe(true);
      expect(v.find(violation => violation.code === 'CMS_MALFORMED_QUERY_CONFIG')?.message).toContain('params...slug');
    });

    it('accepts valid JS expressions in query params', () => {
      const code = `export default function Page() {
        return (
          <div data-id="list" data-query-config={JSON.stringify({ isApiMode: true, params: [{ key: "filter", value: "String(params.slug)", isExpression: true }] })}>
            {items.map(item => <p data-id="row">{item.title}</p>)}
          </div>
        );
      }`;
      const v = runOracleCheck(code);
      expect(v).toHaveLength(0);
    });
  });
});
