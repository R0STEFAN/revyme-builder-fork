import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  routeParamHistoryAtom,
  recordRouteParamHistoryAtom,
  removeRouteParamHistoryAtom,
  getCmsSuggestionsForParam,
  extractRouteParamNames,
} from './cms-page-store';

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
