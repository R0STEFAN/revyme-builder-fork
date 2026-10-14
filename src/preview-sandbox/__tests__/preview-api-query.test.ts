import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  evaluateParamExpression,
  evaluateQueryParamExpressions,
  buildPreviewQueryKey,
  detectCollectionQueries,
  wrapCollectionListMapping,
  dispatchApiQuery,
  handleApiQueryResult,
  getPreviewDataset,
  setPreviewDataset,
  getPreviewQueryStatus,
  clearPreviewDatasets,
  subscribePreviewQueries,
} from '../preview-api-query';

describe('preview-api-query', () => {
  beforeEach(() => {
    clearPreviewDatasets();
  });

  afterEach(() => {
    clearPreviewDatasets();
    vi.restoreAllMocks();
  });

  describe('evaluateParamExpression and evaluateQueryParamExpressions', () => {
    it('evaluates simple params lookup', () => {
      const res = evaluateParamExpression('params.category', { category: 'men', place: 'arm' });
      expect(res).toBe('men');
    });

    it('evaluates expression with fallback', () => {
      const res = evaluateParamExpression('params.category || "all"', {});
      expect(res).toBe('all');
    });

    it('returns empty string for missing param or malformed expression without throwing', () => {
      expect(evaluateParamExpression('params.unknown', {})).toBe('');
      expect(evaluateParamExpression('invalid syntax !!!', {})).toBe('');
      expect(evaluateParamExpression('', {})).toBe('');
    });

    it('evaluates entire query config params record', () => {
      const queryConfig = {
        isApiMode: true,
        params: [
          { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
          { key: 'filter[place][_eq]', value: 'params.place', isExpression: true },
          { key: 'limit', value: '19', isExpression: false },
        ],
      };
      const routeParams = { category: 'men', place: 'peredplichcha' };
      const resolved = evaluateQueryParamExpressions(queryConfig, routeParams);

      expect(resolved).toEqual({
        'filter[category][_eq]': 'men',
        'filter[place][_eq]': 'peredplichcha',
        limit: '19',
      });
    });
  });

  describe('buildPreviewQueryKey', () => {
    it('builds deterministic query cache key with sorted parameters', () => {
      const key1 = buildPreviewQueryKey('tattoos', { b: '2', a: '1' });
      const key2 = buildPreviewQueryKey('tattoos', { a: '1', b: '2' });
      expect(key1).toBe('tattoos?a=1&b=2');
      expect(key1).toBe(key2);
    });
  });

  describe('detectCollectionQueries', () => {
    it('detects collection query configs in JSX code with JSON.stringify attribute', () => {
      const code = `
        import tattoos from '@/cms/tattoos.json';
        export default function Page({ params }: any) {
          return (
            <div
              data-id="gallery-grid"
              data-query-config={JSON.stringify({
                isApiMode: true,
                params: [
                  { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
                  { key: 'filter[place][_eq]', value: 'params.place', isExpression: true },
                  { key: 'limit', value: '19' }
                ]
              })}
            >
              {tattoos.map((item) => (
                <div key={item.id} data-id="card">
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          );
        }
      `;

      const queries = detectCollectionQueries(code);
      expect(queries).toHaveLength(1);
      expect(queries[0].listId).toBe('gallery-grid');
      expect(queries[0].source).toBe('tattoos');
      expect(queries[0].queryConfig.params).toHaveLength(3);
      expect(queries[0].queryConfig.params![0].key).toBe('filter[category][_eq]');
    });

    it('detects collection query configs with literal string attribute', () => {
      const code = `
        import items from '@/cms/items.json';
        export default function Page() {
          return (
            <div data-id="list-node" data-query-config='{"isApiMode":true,"params":[{"key":"limit","value":"10"}]}'>
              {items.map(i => <div key={i.id} />)}
            </div>
          );
        }
      `;

      const queries = detectCollectionQueries(code);
      expect(queries).toHaveLength(1);
      expect(queries[0].listId).toBe('list-node');
      expect(queries[0].source).toBe('items');
      expect(queries[0].queryConfig.params![0].value).toBe('10');
    });

    it('returns empty array when no data-query-config is present', () => {
      const code = `
        import items from '@/cms/items.json';
        export default function Page() {
          return <div>{items.map(i => <div key={i.id} />)}</div>;
        }
      `;
      expect(detectCollectionQueries(code)).toEqual([]);
    });
  });

  describe('wrapCollectionListMapping', () => {
    it('wraps collection list mapping to read from __getPreviewData', () => {
      const code = `
        <div data-id="gallery-grid" data-query-config={JSON.stringify({ isApiMode: true, params: [] })}>
          {tattoos.map((item) => (
            <div key={item.id}>{item.name}</div>
          ))}
        </div>
      `;

      const wrapped = wrapCollectionListMapping(code, [
        {
          listId: 'gallery-grid',
          source: 'tattoos',
          queryConfig: { isApiMode: true, params: [] },
        },
      ]);

      expect(wrapped).toContain("__getPreviewData('tattoos', 'gallery-grid')");
      expect(wrapped).toContain('|| tattoos).map(');
    });
  });

  describe('dispatchApiQuery and handleApiQueryResult bridge', () => {
    it('dispatches preview:fetch-api-query to target window with request metadata without secrets', () => {
      const mockPostMessage = vi.fn();
      const mockWindow = { postMessage: mockPostMessage } as unknown as Window;

      const queryConfig = {
        isApiMode: true,
        params: [
          { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
        ],
      };

      const routeParams = { category: 'men' };
      const reqId = dispatchApiQuery({
        listId: 'gallery-grid',
        source: 'tattoos',
        queryConfig,
        routeParams,
        url: '/gallery/men',
        targetWindow: mockWindow,
      });

      expect(reqId).toMatch(/^query_/);
      expect(mockPostMessage).toHaveBeenCalledTimes(1);

      const sentPayload = mockPostMessage.mock.calls[0][0];
      expect(sentPayload.type).toBe('preview:fetch-api-query');
      expect(sentPayload.requestId).toBe(reqId);
      expect(sentPayload.source).toBe('tattoos');
      expect(sentPayload.routeParams).toEqual({ category: 'men' });
      expect(sentPayload.url).toBe('/gallery/men');

      // Verify no secrets or env files are attached
      expect(sentPayload.headers).toBeUndefined();
      expect(sentPayload.env).toBeUndefined();
      expect(sentPayload.token).toBeUndefined();

      // Status should be loading
      expect(getPreviewQueryStatus('gallery-grid').loading).toBe(true);
      expect(getPreviewQueryStatus('tattoos').loading).toBe(true);
    });

    it('handles successful preview:api-query-result, stores datasets, and notifies subscribers', () => {
      const mockPostMessage = vi.fn();
      const mockWindow = { postMessage: mockPostMessage } as unknown as Window;
      const listener = vi.fn();
      const unsub = subscribePreviewQueries(listener);

      const reqId = dispatchApiQuery({
        listId: 'grid-1',
        source: 'tattoos',
        queryConfig: { isApiMode: true, params: [] },
        routeParams: {},
        url: '/gallery',
        targetWindow: mockWindow,
      });

      const mockItems = [
        { id: '1', title: 'Dragon' },
        { id: '2', title: 'Phoenix' },
      ];

      const handled = handleApiQueryResult({
        requestId: reqId,
        data: mockItems,
        error: null,
      });

      expect(handled).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      // Datasets available by listId and by source
      expect(getPreviewDataset('tattoos', 'grid-1')).toEqual(mockItems);
      expect(getPreviewDataset('tattoos')).toEqual(mockItems);

      // Status is updated
      expect(getPreviewQueryStatus('grid-1').loading).toBe(false);
      expect(getPreviewQueryStatus('grid-1').error).toBeNull();

      unsub();
    });

    it('handles query error gracefully and sets error status without crashing', () => {
      const mockPostMessage = vi.fn();
      const mockWindow = { postMessage: mockPostMessage } as unknown as Window;
      const listener = vi.fn();
      const unsub = subscribePreviewQueries(listener);

      const reqId = dispatchApiQuery({
        listId: 'grid-err',
        source: 'broken-col',
        queryConfig: { isApiMode: true, params: [] },
        routeParams: {},
        url: '/test',
        targetWindow: mockWindow,
      });

      handleApiQueryResult({
        requestId: reqId,
        data: null,
        error: 'Proxy 500: Upstream API Timeout',
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(getPreviewQueryStatus('grid-err').loading).toBe(false);
      expect(getPreviewQueryStatus('grid-err').error).toBe('Proxy 500: Upstream API Timeout');
      expect(getPreviewDataset('broken-col', 'grid-err')).toBeUndefined();

      unsub();
    });

    it('handles route transitions and delivers dynamic filtered datasets', () => {
      const mockPostMessage = vi.fn();
      const mockWindow = { postMessage: mockPostMessage } as unknown as Window;

      const queryConfig = {
        isApiMode: true,
        params: [
          { key: 'category', value: 'params.category', isExpression: true },
          { key: 'place', value: 'params.place', isExpression: true },
        ],
      };

      // 1. Initial route: /gallery/men (47 items)
      const req1 = dispatchApiQuery({
        listId: 'gallery',
        source: 'tattoos',
        queryConfig,
        routeParams: { category: 'men', place: '' },
        url: '/gallery/men',
        targetWindow: mockWindow,
      });

      const men47Items = Array.from({ length: 47 }, (_, i) => ({ id: `m${i}`, title: `Men Tattoo ${i}` }));
      handleApiQueryResult({ requestId: req1, data: men47Items, error: null });

      expect(getPreviewDataset('tattoos')?.length).toBe(47);

      // 2. Route transition to sub-filter: /gallery/men/peredplichcha (19 items)
      const req2 = dispatchApiQuery({
        listId: 'gallery',
        source: 'tattoos',
        queryConfig,
        routeParams: { category: 'men', place: 'peredplichcha' },
        url: '/gallery/men/peredplichcha',
        targetWindow: mockWindow,
      });

      const peredplichcha19Items = Array.from({ length: 19 }, (_, i) => ({ id: `p${i}`, title: `Forearm Tattoo ${i}` }));
      handleApiQueryResult({ requestId: req2, data: peredplichcha19Items, error: null });

      // Verifies /gallery/men/peredplichcha renders 19 items instead of 93 or 47
      expect(getPreviewDataset('tattoos')?.length).toBe(19);
      expect(getPreviewDataset('tattoos', 'gallery')?.length).toBe(19);
    });
  });
});
