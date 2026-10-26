import { describe, expect, it } from 'vitest';
import {
  resolveEnvHeaders,
  buildApiRequestUrl,
  extractApiItems,
  detectApiItemsKey,
  type ApiCollectionConfig,
} from '../cms-api-config';

describe('cms-api-config: resolveEnvHeaders', () => {
  it('resolves env:VAR, process.env.VAR, and $VAR formats', () => {
    const envVars = {
      TOKEN: 'secret-token-123',
      KEY: 'api-key-456',
      AUTH: 'custom-auth',
    };
    const headers = {
      Authorization: 'Bearer env:TOKEN',
      'X-Api-Key': 'process.env.KEY',
      'X-Custom': '$AUTH',
      'Content-Type': 'application/json',
    };

    const resolved = resolveEnvHeaders(headers, envVars);
    expect(resolved.Authorization).toBe('Bearer secret-token-123');
    expect(resolved['X-Api-Key']).toBe('api-key-456');
    expect(resolved['X-Custom']).toBe('custom-auth');
    expect(resolved['Content-Type']).toBe('application/json');
  });

  it('does not recursively treat resolved values containing $ as variable references (single pass)', () => {
    const envVars = {
      SECRET: 'tok$123',
      ANOTHER: 'val$456$VAR',
    };
    const headers = {
      Authorization: 'Bearer env:SECRET',
      'X-Test': 'process.env.ANOTHER',
    };

    const resolved = resolveEnvHeaders(headers, envVars);
    expect(resolved.Authorization).toBe('Bearer tok$123');
    expect(resolved['X-Test']).toBe('val$456$VAR');
  });

  it('handles missing env vars gracefully by replacing with empty string', () => {
    const headers = {
      Authorization: 'Bearer env:MISSING',
    };
    const resolved = resolveEnvHeaders(headers, {});
    expect(resolved.Authorization).toBe('Bearer ');
  });

  it('handles undefined headers or envVars safely', () => {
    expect(resolveEnvHeaders(undefined, undefined)).toEqual({});
    expect(resolveEnvHeaders({ Authorization: 'Bearer env:TOKEN' }, undefined)).toEqual({
      Authorization: 'Bearer ',
    });
  });
});

describe('cms-api-config: buildApiRequestUrl', () => {
  it('merges defaultParams and queryParams safely', () => {
    const config: ApiCollectionConfig = {
      name: 'Posts',
      slug: 'posts',
      provider: 'directus',
      url: 'https://cms.example.com/items/posts',
      method: 'GET',
      headers: {},
      defaultParams: { fields: '*.*', limit: '50' },
    };

    const url = buildApiRequestUrl(config, { 'filter[slug][_eq]': 'first-post' });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://cms.example.com');
    expect(parsed.pathname).toBe('/items/posts');
    expect(parsed.searchParams.get('fields')).toBe('*.*');
    expect(parsed.searchParams.get('limit')).toBe('50');
    expect(parsed.searchParams.get('filter[slug][_eq]')).toBe('first-post');
  });

  it('allows queryParams to override defaultParams', () => {
    const config: ApiCollectionConfig = {
      name: 'Posts',
      slug: 'posts',
      provider: 'directus',
      url: 'https://cms.example.com/items/posts',
      method: 'GET',
      headers: {},
      defaultParams: { limit: '50' },
    };

    const url = buildApiRequestUrl(config, { limit: '10' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('limit')).toBe('10');
  });

  it('evaluates defaultQueryParams expressions against routeParams including lang', () => {
    const config: ApiCollectionConfig = {
      name: 'Articles',
      slug: 'articles',
      provider: 'directus',
      url: 'https://cms.example.com/items/articles',
      method: 'GET',
      headers: {},
      defaultParams: { fields: '*,translations.*' },
      defaultQueryParams: [
        {
          key: 'deep[translations][_filter][languages_code][_eq]',
          value: "({uk: 'uk-UA', en: 'en-US'})[params.lang]",
          isExpression: true,
        },
      ],
    };

    const urlUk = buildApiRequestUrl(config, undefined, { lang: 'uk' });
    const parsedUk = new URL(urlUk);
    expect(parsedUk.searchParams.get('deep[translations][_filter][languages_code][_eq]')).toBe('uk-UA');
    expect(parsedUk.searchParams.get('fields')).toBe('*,translations.*');

    const urlEn = buildApiRequestUrl(config, undefined, { lang: 'en' });
    const parsedEn = new URL(urlEn);
    expect(parsedEn.searchParams.get('deep[translations][_filter][languages_code][_eq]')).toBe('en-US');
  });

  it('preserves relative URLs without adding a fake origin', () => {
    const config: ApiCollectionConfig = {
      name: 'Local API',
      slug: 'local',
      provider: 'custom_rest',
      url: '/api/v1/posts',
      method: 'GET',
      headers: {},
      defaultParams: { fields: 'id,title' },
    };

    const url = buildApiRequestUrl(config, { search: 'news' });
    expect(url.startsWith('/api/v1/posts?')).toBe(true);
    expect(url).toContain('fields=id%2Ctitle');
    expect(url).toContain('search=news');
    expect(url).not.toContain('http://');
    expect(url).not.toContain('localhost');
  });

  it('ignores empty query parameter values', () => {
    const config: ApiCollectionConfig = {
      name: 'Posts',
      slug: 'posts',
      provider: 'directus',
      url: 'https://cms.example.com/items',
      method: 'GET',
      headers: {},
      defaultParams: { filter: 'active' },
    };

    const url = buildApiRequestUrl(config, { emptyParam: '' });
    const parsed = new URL(url);
    expect(parsed.searchParams.has('emptyParam')).toBe(false);
    expect(parsed.searchParams.get('filter')).toBe('active');
  });
});

describe('cms-api-config: extractApiItems and detectApiItemsKey', () => {
  it('extracts from root array', () => {
    const root = [{ id: 1, title: 'Item 1' }, { id: 2, title: 'Item 2' }];
    expect(extractApiItems(root)).toEqual(root);
  });

  it('extracts from data, results, and items wrappers', () => {
    const directusResp = { data: [{ id: 10 }] };
    expect(extractApiItems(directusResp)).toEqual([{ id: 10 }]);

    const baserowResp = { results: [{ id: 20 }] };
    expect(extractApiItems(baserowResp)).toEqual([{ id: 20 }]);

    const genericResp = { items: [{ id: 30 }] };
    expect(extractApiItems(genericResp)).toEqual([{ id: 30 }]);
  });

  it('extracts from explicit itemsKey including nested dot-paths', () => {
    const custom = { records: [{ id: 100 }] };
    expect(extractApiItems(custom, 'records')).toEqual([{ id: 100 }]);

    const nested = { response: { items: [{ id: 200 }] } };
    expect(extractApiItems(nested, 'response.items')).toEqual([{ id: 200 }]);
  });

  it('preserves empty arrays and returns [] for invalid shapes', () => {
    expect(extractApiItems({ data: [] })).toEqual([]);
    expect(extractApiItems([])).toEqual([]);
    expect(extractApiItems(null)).toEqual([]);
    expect(extractApiItems(undefined)).toEqual([]);
    expect(extractApiItems({ error: 'not found' })).toEqual([]);
  });

  it('detects keys correctly', () => {
    expect(detectApiItemsKey({ data: [{ id: 1 }] })).toBe('data');
    expect(detectApiItemsKey({ results: [{ id: 1 }] })).toBe('results');
    expect(detectApiItemsKey({ items: [{ id: 1 }] })).toBe('items');
    expect(detectApiItemsKey([{ id: 1 }])).toBeUndefined();
    expect(detectApiItemsKey({ custom: [{ id: 1 }] }, 'custom')).toBe('custom');
  });
});
