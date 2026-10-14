// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import {
  codeAtom,
  canvasInteractingAtom,
} from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { previewRouteParamsByFileAtom } from '@/code/stores/cms-page-store';
import { useRendererSync, type UseRendererSyncOptions } from '../useRendererSync';
import { getCanvasRenderer } from '@/canvas/CanvasRenderer';
import { projectFS } from '@/code/project/project-fs';

const API_CONFIG_JSON = JSON.stringify({
  mode: 'api',
  apiCollections: {
    tattoos: {
      name: 'Tattoos',
      slug: 'tattoos',
      provider: 'directus',
      url: 'https://cms.example.com/items/tattoos',
      method: 'GET',
      headers: {},
      itemsKey: 'data',
    },
  },
});

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: () => {},
}));

vi.mock('@/editor/left-toolbar/panels/cms/ApiResourceModal', () => ({
  getEnvVariables: () => ({}),
}));

const pageWithTwoListsCode = `
import tattoos from '@/cms/tattoos.json';

export default function Page() {
  return (
    <div data-id="root">
      <div data-id="list-men" data-query-config='{"params":[{"key":"filter[category][_eq]","value":"params.category","isExpression":true}]}'>
        {tattoos.map((item, idx) => (
          <div data-id="row-men" key={idx}><p data-id="title-men">{item.title}</p></div>
        ))}
      </div>
      <div data-id="list-women" data-query-config='{"params":[{"key":"filter[category][_eq]","value":"\\"women\\"","isExpression":true}]}'>
        {tattoos.map((item, idx) => (
          <div data-id="row-women" key={idx}><p data-id="title-women">{item.title}</p></div>
        ))}
      </div>
    </div>
  );
}
`;

describe('useRendererSync — per-node list datasets, empty response, and request cancellation', () => {
  let store: ReturnType<typeof createStore>;
  let defaultOpts: UseRendererSyncOptions;
  let renderSpy: any;

  beforeEach(() => {
    projectFS.writeFile('_meta/cms-api-config.json', API_CONFIG_JSON);

    store = createStore();
    store.set(activeFilePathAtom, 'app/category/[category]/page.tsx');
    store.set(previewRouteParamsByFileAtom, new Map([
      ['app/category/[category]/page.tsx', { category: 'men' }],
    ]));
    store.set(codeAtom, pageWithTwoListsCode);
    store.set(canvasInteractingAtom, false);

    const renderer = getCanvasRenderer();
    renderer.setSandboxReady(true);
    renderSpy = vi.spyOn(renderer, 'render').mockImplementation(() => {});
    vi.spyOn(renderer, 'forceRender').mockImplementation(() => true);

    defaultOpts = {
      activeViewports: [{ id: 'desktop', width: 1440, isPrimary: true }] as any,
      sandboxReady: true,
      iframeRenderTick: 1,
      vpOverlayRef: { current: document.createElement('div') },
      postMessageBridgeRef: { current: null },
      editingNodeIdRef: { current: null },
      canvasInteractingValRef: { current: false },
      isComponentFile: false,
      isIconSetMaster: false,
      setSnapGuides: () => {},
      setSpacingGuides: () => {},
      setAddVpMenu: () => {},
      startTextEdit: null,
      commitTextEdit: null,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createTestWrapper(testStore: ReturnType<typeof createStore>) {
    return ({ children }: { children: React.ReactNode }) => (
      <Provider store={testStore}>{children}</Provider>
    );
  }

  it('fetches and stores independent datasets for two lists backed by the same collection', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.url.includes('filter%5Bcategory%5D%5B_eq%5D=men')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'm1', title: 'Dragon Tattoo' },
              { id: 'm2', title: 'Tiger Tattoo' },
            ],
          }),
        };
      }
      if (body.url.includes('filter%5Bcategory%5D%5B_eq%5D=women')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'w1', title: 'Rose Tattoo' },
              { id: 'w2', title: 'Lotus Tattoo' },
              { id: 'w3', title: 'Butterfly Tattoo' },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useRendererSync(defaultOpts), {
      wrapper: createTestWrapper(store),
    });

    await waitFor(() => {
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      const renderInput = lastCall?.[0];
      const listData = renderInput?.cmsCollections?.listData;
      expect(listData?.['list-men']).toBeDefined();
      expect(listData?.['list-women']).toBeDefined();
      expect(listData?.['list-men'].length).toBe(2);
      expect(listData?.['list-women'].length).toBe(3);
    });

    const finalRenderInput = renderSpy.mock.calls[renderSpy.mock.calls.length - 1][0];
    expect(finalRenderInput.cmsCollections.listData['list-men'][0].title).toBe('Dragon Tattoo');
    expect(finalRenderInput.cmsCollections.listData['list-women'][0].title).toBe('Rose Tattoo');
    expect(finalRenderInput.listDatasets['list-men'].length).toBe(2);
    expect(finalRenderInput.listDatasets['list-women'].length).toBe(3);
  });

  it('records empty API response ([]) without dropping it or retaining stale items', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        data: [], // empty array response
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useRendererSync(defaultOpts), {
      wrapper: createTestWrapper(store),
    });

    await waitFor(() => {
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      const renderInput = lastCall?.[0];
      expect(renderInput?.cmsCollections?.listData?.['list-men']).toBeDefined();
      expect(renderInput?.cmsCollections?.listData?.['list-men']).toEqual([]);
      expect(renderInput?.listDatasets?.['list-men']).toEqual([]);
    });
  });

  it('cancels in-flight request when route params change and ignores slower stale response', async () => {
    let resolveMenRequest: ((val: any) => void) | null = null;
    let menAborted = false;

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      const signal = init?.signal;

      if (body.url.includes('filter%5Bcategory%5D%5B_eq%5D=men')) {
        signal?.addEventListener('abort', () => {
          menAborted = true;
        });
        return new Promise((resolve) => {
          resolveMenRequest = (res) => {
            resolve(res);
          };
        });
      }

      if (body.url.includes('filter%5Bcategory%5D%5B_eq%5D=japan')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'j1', title: 'Newer Japan Tattoo' }],
          }),
        };
      }

      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useRendererSync(defaultOpts), {
      wrapper: createTestWrapper(store),
    });

    // Wait until 'men' fetch was initiated
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Switch route parameter from 'men' to 'japan' while 'men' request is still pending
    act(() => {
      store.set(previewRouteParamsByFileAtom, new Map([
        ['app/category/[category]/page.tsx', { category: 'japan' }],
      ]));
    });

    // Wait for 'japan' request to complete and update canvas
    await waitFor(() => {
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      const renderInput = lastCall?.[0];
      const data = renderInput?.cmsCollections?.listData?.['list-men'];
      expect(data).toBeDefined();
      expect(data?.[0]?.title).toBe('Newer Japan Tattoo');
    });

    // Verify that the 'men' request's AbortController was aborted
    expect(menAborted).toBe(true);

    // Now let the older, slower 'men' request resolve late
    if (resolveMenRequest) {
      act(() => {
        resolveMenRequest!({
          ok: true,
          json: async () => ({
            data: [{ id: 'm-stale', title: 'Older Stale Men Tattoo' }],
          }),
        });
      });
    }

    // Verify the newer 'japan' tattoo was NOT overwritten by the stale 'men' response
    const lastCallAfterStale = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
    const finalData = lastCallAfterStale?.[0]?.cmsCollections?.listData?.['list-men'];
    expect(finalData?.[0]?.title).toBe('Newer Japan Tattoo');
  });

  it('prunes listDatasets when a collection list node is deleted from the page', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        data: [{ id: 't1', title: 'Tattoo 1' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useRendererSync(defaultOpts), {
      wrapper: createTestWrapper(store),
    });

    await waitFor(() => {
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      expect(lastCall?.[0]?.cmsCollections?.listData?.['list-men']).toBeDefined();
      expect(lastCall?.[0]?.cmsCollections?.listData?.['list-women']).toBeDefined();
    });

    // Delete list-men by setting code without list-men
    const codeWithoutMen = `
import tattoos from '@/cms/tattoos.json';

export default function Page() {
  return (
    <div data-id="root">
      <div data-id="list-women" data-query-config='{"params":[{"key":"filter[category][_eq]","value":"\\"women\\"","isExpression":true}]}'>
        {tattoos.map((item, idx) => (
          <div data-id="row-women" key={idx}><p data-id="title-women">{item.title}</p></div>
        ))}
      </div>
    </div>
  );
}
`;
    act(() => {
      store.set(codeAtom, codeWithoutMen);
    });

    await waitFor(() => {
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      expect(lastCall?.[0]?.cmsCollections?.listData?.['list-men']).toBeUndefined();
      expect(lastCall?.[0]?.cmsCollections?.listData?.['list-women']).toBeDefined();
    });
  });
});
