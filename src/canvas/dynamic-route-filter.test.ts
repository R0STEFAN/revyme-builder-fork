import { describe, it, expect } from 'vitest';
import { matchesValue, getDeepFieldValue } from './Renderer';
import { extractRouteParamNames } from '@/code/stores/cms-page-store';
import { projectFS } from '@/code/project/project-fs';

describe('extractRouteParamNames', () => {
  it('extracts route parameter names from Next.js dynamic route paths', () => {
    expect(extractRouteParamNames('app/gallery/[category]/[place]/page.client.tsx')).toEqual(['category', 'place']);
    expect(extractRouteParamNames('app/shop/[category]/page.tsx')).toEqual(['category']);
    expect(extractRouteParamNames('app/[...slug]/page.tsx')).toEqual(['slug']);
    expect(extractRouteParamNames('app/about/page.client.tsx')).toEqual([]);
    expect(extractRouteParamNames('')).toEqual([]);
  });
});

describe('matchesValue for Collection List filtering', () => {
  it('matches primitive strings and numbers exact and partial', () => {
    expect(matchesValue('men', 'men', true)).toBe(true);
    expect(matchesValue('Men', 'men', true)).toBe(true);
    expect(matchesValue('women', 'men', true)).toBe(false);

    expect(matchesValue('Чоловічі тату', 'чоловічі', false)).toBe(true);
    expect(matchesValue('Чоловічі тату', 'чоловічі', true)).toBe(false);
  });

  it('matches arrays of primitive strings (tags/arrays)', () => {
    const tags = ['men', 'traditional', 'blackwork'];
    expect(matchesValue(tags, 'men', true)).toBe(true);
    expect(matchesValue(tags, 'women', true)).toBe(false);
    expect(matchesValue(tags, 'trad', false)).toBe(true);
  });

  it('matches M2M junction arrays with nested objects (Directus format)', () => {
    const categoriesM2M = [
      { id: 1, name: 'Чоловічі', slug: 'men' },
      { id: 2, name: 'Рукав', slug: 'sleeve' },
    ];
    // Exact match against name
    expect(matchesValue(categoriesM2M, 'Чоловічі', true)).toBe(true);
    // Exact match against slug
    expect(matchesValue(categoriesM2M, 'men', true)).toBe(true);
    // Non-match
    expect(matchesValue(categoriesM2M, 'Жіночі', true)).toBe(false);
    // Partial contains
    expect(matchesValue(categoriesM2M, 'чоловіч', false)).toBe(true);
  });

  it('matches deep nested Directus junction relation structures', () => {
    const placementsM2M = [
      {
        id: 10,
        tattoos_id: 101,
        placements_id: {
          id: 5,
          name: 'На передпліччі',
          slug: 'forearm',
        },
      },
    ];
    expect(matchesValue(placementsM2M, 'На передпліччі', true)).toBe(true);
    expect(matchesValue(placementsM2M, 'forearm', true)).toBe(true);
    expect(matchesValue(placementsM2M, 'chest', true)).toBe(false);
    expect(matchesValue(placementsM2M, 'передпліч', false)).toBe(true);
  });

  it('handles empty / undefined search values safely', () => {
    expect(matchesValue(['anything'], '', true)).toBe(true);
    expect(matchesValue(['anything'], undefined, true)).toBe(true);
    expect(matchesValue(null, 'test', true)).toBe(false);
  });
});

describe('getDeepFieldValue with foreign references', () => {
  it('resolves foreign ID arrays against CMS collections in projectFS', () => {
    projectFS.writeFile('cms/categories.schema.json', JSON.stringify({
      slug: 'categories',
      fields: [{ id: 'slug', name: 'slug', type: 'text' }],
    }));
    projectFS.writeFile('cms/categories.json', JSON.stringify([
      { _id: 'cat_1', slug: 'men', name: 'Чоловічі' },
      { _id: 'cat_2', slug: 'women', name: 'Жіночі' },
    ]));
    projectFS.writeFile('cms/placements.schema.json', JSON.stringify({
      slug: 'placements',
      fields: [{ id: 'slug', name: 'slug', type: 'text' }],
    }));
    projectFS.writeFile('cms/placements.json', JSON.stringify([
      { _id: 'place_1', slug: 'noga', name: 'На нозі' },
      { _id: 'place_2', slug: 'ruka', name: 'На руці' },
    ]));

    const item = {
      title: 'Test Tattoo',
      categoriesM2m: ['cat_1'],
      placementsM2m: ['place_1'],
    };

    const catSlug = getDeepFieldValue(item, 'categoriesM2m.slug');
    expect(catSlug).toEqual(['men']);

    const placeSlug = getDeepFieldValue(item, 'placementsM2m.slug');
    expect(placeSlug).toEqual(['noga']);

    expect(matchesValue(catSlug, 'men', true)).toBe(true);
    expect(matchesValue(catSlug, 'women', true)).toBe(false);
    expect(matchesValue(placeSlug, 'noga', true)).toBe(true);
    expect(matchesValue(placeSlug, 'ruka', true)).toBe(false);
  });

  it('filters collection items when valueSource is routeParam', () => {
    projectFS.writeFile('cms/categories.schema.json', JSON.stringify({
      slug: 'categories',
      fields: [{ id: 'slug', name: 'slug', type: 'text' }],
    }));
    projectFS.writeFile('cms/categories.json', JSON.stringify([
      { _id: 'cat_men', slug: 'men', name: 'Чоловічі' },
      { _id: 'cat_women', slug: 'women', name: 'Жіночі' },
    ]));
    projectFS.writeFile('cms/placements.schema.json', JSON.stringify({
      slug: 'placements',
      fields: [{ id: 'slug', name: 'slug', type: 'text' }],
    }));
    projectFS.writeFile('cms/placements.json', JSON.stringify([
      { _id: 'place_noga', slug: 'noga', name: 'На нозі' },
      { _id: 'place_ruka', slug: 'ruka', name: 'На руці' },
    ]));

    const items = [
      { id: 1, title: 'Tattoo 1 (Men, Noga)', categoriesM2m: ['cat_men'], placementsM2m: ['place_noga'] },
      { id: 2, title: 'Tattoo 2 (Men, Ruka)', categoriesM2m: ['cat_men'], placementsM2m: ['place_ruka'] },
      { id: 3, title: 'Tattoo 3 (Women, Noga)', categoriesM2m: ['cat_women'], placementsM2m: ['place_noga'] },
    ];

    const filter1 = { field: 'categoriesM2m.slug', operator: 'equals' as const, value: '', valueSource: 'routeParam' as const, valueVar: 'category' };
    const filter2 = { field: 'placementsM2m.slug', operator: 'equals' as const, value: '', valueSource: 'routeParam' as const, valueVar: 'place' };

    // Test with routeParam category=men, place=noga
    const routeParams: Record<string, string> = { category: 'men', place: 'noga' };
    
    const filtered = items.filter(item => {
      const val1 = getDeepFieldValue(item, filter1.field);
      const val2 = getDeepFieldValue(item, filter2.field);
      return matchesValue(val1, routeParams.category, true) && matchesValue(val2, routeParams.place, true);
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe('Tattoo 1 (Men, Noga)');
  });
});

