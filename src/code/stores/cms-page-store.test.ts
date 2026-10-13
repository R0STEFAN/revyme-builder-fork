import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  routeParamHistoryAtom,
  recordRouteParamHistoryAtom,
  removeRouteParamHistoryAtom,
  getCmsSuggestionsForParam,
  extractRouteParamNames,
  getItemSlug,
  activePreviewSlugAtom,
  activePreviewItemAtom,
  previewSlugByFileAtom,
} from './cms-page-store';
import { collectionDataAtom } from './cms-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { codeAtom } from './store';

describe('cms-page-store routeParamHistory', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(routeParamHistoryAtom, {});
  });

  it('records new history entries without duplicates (most recent first)', () => {
    store.set(recordRouteParamHistoryAtom, { param: 'category', value: 'men' });
    store.set(recordRouteParamHistoryAtom, { param: 'category', value: 'women' });
    store.set(recordRouteParamHistoryAtom, { param: 'category', value: 'men' });

    const history = store.get(routeParamHistoryAtom);
    expect(history.category).toEqual(['men', 'women']);
  });

  it('removes specific entries from history', () => {
    store.set(recordRouteParamHistoryAtom, { param: 'place', value: 'noga' });
    store.set(recordRouteParamHistoryAtom, { param: 'place', value: 'spina' });
    store.set(recordRouteParamHistoryAtom, { param: 'place', value: 'ruka' });

    store.set(removeRouteParamHistoryAtom, { param: 'place', value: 'spina' });

    const history = store.get(routeParamHistoryAtom);
    expect(history.place).toEqual(['ruka', 'noga']);
  });
});

describe('getCmsSuggestionsForParam', () => {
  it('extracts suggestions from matching CMS collection by candidate name', () => {
    const allData = new Map<string, any[]>([
      [
        'categories',
        [
          { id: 1, slug: 'men', name: 'Чоловічі тату' },
          { id: 2, slug: 'women', name: 'Жіночі тату' },
        ],
      ],
      [
        'placements',
        [
          { id: 10, slug: 'noga', name: 'На нозі' },
          { id: 11, slug: 'ruka', name: 'На руці' },
        ],
      ],
    ]);

    const catSuggestions = getCmsSuggestionsForParam('category', allData);
    expect(catSuggestions).toEqual([
      { value: 'men', name: 'Чоловічі тату', source: 'categories' },
      { value: 'women', name: 'Жіночі тату', source: 'categories' },
    ]);

    const placeSuggestions = getCmsSuggestionsForParam('place', allData);
    expect(placeSuggestions).toEqual([
      { value: 'noga', name: 'На нозі', source: 'placements' },
      { value: 'ruka', name: 'На руці', source: 'placements' },
    ]);
  });
});

describe('getItemSlug', () => {
  it('resolves _slug, slug, id, or _id properly', () => {
    expect(getItemSlug({ _slug: 'local-post' })).toBe('local-post');
    expect(getItemSlug({ slug: 'api-post' })).toBe('api-post');
    expect(getItemSlug({ id: 42 })).toBe('42');
    expect(getItemSlug({ _id: 'mongo-id' })).toBe('mongo-id');
    expect(getItemSlug({ id: 'uuid-123', slug: 'pretty-slug' })).toBe('pretty-slug');
    expect(getItemSlug(null)).toBe('');
    expect(getItemSlug(undefined)).toBe('');
  });
});

describe('activePreviewSlugAtom and activePreviewItemAtom with API collections', () => {
  it('resolves preview slug and preview item for API collections lacking _slug', () => {
    const store = createStore();
    const detailCode = `/** @cmsPage { "collection": "works", "kind": "detail" } */
export default function Page() { return <div />; }`;
    const filePath = 'app/works/[slug]/page.client.tsx';

    const items = [
      { id: 101, title: 'First Tattoo', img_file: { id: 'file-1' } },
      { id: 102, title: 'Second Tattoo', img_file: { id: 'file-2' } },
    ];
    projectFS.writeFile(filePath, detailCode);
    projectFS.writeFile('cms/works.json', JSON.stringify(items));
    store.set(activeFilePathAtom, filePath);
    store.set(projectVersionAtom, (v) => v + 1);

    // Should default to first item's slug/id ('101') instead of returning null
    expect(store.get(activePreviewSlugAtom)).toBe('101');
    expect(store.get(activePreviewItemAtom)).toEqual(items[0]);

    // Should switch preview item when user picks a different item
    const nextMap = new Map([[filePath, '102']]);
    store.set(previewSlugByFileAtom, nextMap);
    expect(store.get(activePreviewSlugAtom)).toBe('102');
    expect(store.get(activePreviewItemAtom)).toEqual(items[1]);

    // Even if an unknown slug is passed, it falls back to items[0] instead of null
    const unknownMap = new Map([[filePath, 'non-existent']]);
    store.set(previewSlugByFileAtom, unknownMap);
    expect(store.get(activePreviewItemAtom)).toEqual(items[0]);
  });
});
