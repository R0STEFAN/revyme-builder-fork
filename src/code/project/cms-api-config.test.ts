import { describe, it, expect, vi, beforeEach } from 'vitest';

const fsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('./project-fs', () => ({
  projectFS: {
    readFile: vi.fn((path: string) => fsStore.get(path) ?? null),
    writeFile: vi.fn((path: string, content: string) => { fsStore.set(path, content); }),
    deleteFile: vi.fn((path: string) => { fsStore.delete(path); }),
    listFiles: vi.fn((dir?: string) => {
      const prefix = dir ? (dir.endsWith('/') ? dir : dir + '/') : '';
      const result: string[] = [];
      for (const path of fsStore.keys()) {
        if (!prefix || path.startsWith(prefix)) result.push(path);
      }
      return result.sort();
    }),
    exists: vi.fn((path: string) => fsStore.has(path)),
  },
}));

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: vi.fn(),
}));

import {
  loadCmsProjectConfig,
  saveCmsProjectConfig,
  getApiCollection,
  saveApiCollection,
  removeApiCollection,
  setCmsMode,
  type ApiCollectionConfig,
  type CmsProjectConfig,
} from './cms-api-config';

describe('cms-api-config', () => {
  beforeEach(() => {
    fsStore.clear();
  });

  it('returns default config when file does not exist', () => {
    const config = loadCmsProjectConfig();
    expect(config).toEqual({
      mode: 'local',
      apiCollections: {},
    });
  });

  it('loads valid existing config from _meta/cms-api-config.json', () => {
    const mockConfig: CmsProjectConfig = {
      mode: 'api',
      apiCollections: {
        tattoos: {
          slug: 'tattoos',
          name: 'Tattoos',
          provider: 'directus',
          url: 'https://api.example.com/items/tattoos',
          method: 'GET',
          headers: { Authorization: 'Bearer env:DIRECTUS_TOKEN' },
          cacheMaxAge: 14400,
        },
      },
    };
    fsStore.set('_meta/cms-api-config.json', JSON.stringify(mockConfig));

    const config = loadCmsProjectConfig();
    expect(config.mode).toBe('api');
    expect(config.apiCollections.tattoos.name).toBe('Tattoos');
  });

  it('saves config to _meta/cms-api-config.json', () => {
    const sample: CmsProjectConfig = {
      mode: 'api',
      apiCollections: {
        posts: {
          slug: 'posts',
          name: 'Posts',
          provider: 'custom_rest',
          url: 'https://api.example.com/posts',
          method: 'GET',
          headers: {},
        },
      },
    };
    saveCmsProjectConfig(sample);

    const savedRaw = fsStore.get('_meta/cms-api-config.json');
    expect(savedRaw).toBeDefined();
    const parsed = JSON.parse(savedRaw!);
    expect(parsed.mode).toBe('api');
    expect(parsed.apiCollections.posts.slug).toBe('posts');
  });

  it('gets, saves, and removes an individual API collection', () => {
    setCmsMode('api');
    expect(getApiCollection('articles')).toBeNull();

    const articleCol: ApiCollectionConfig = {
      slug: 'articles',
      name: 'Articles',
      provider: 'strapi',
      url: 'https://strapi.example.com/api/articles',
      method: 'GET',
      headers: { Authorization: 'Bearer env:STRAPI_TOKEN' },
      itemsKey: 'data',
    };

    saveApiCollection('articles', articleCol);
    expect(getApiCollection('articles')).toEqual(articleCol);

    removeApiCollection('articles');
    expect(getApiCollection('articles')).toBeNull();
  });

  it('sets and updates cms mode', () => {
    expect(loadCmsProjectConfig().mode).toBe('local');
    setCmsMode('api');
    expect(loadCmsProjectConfig().mode).toBe('api');
    setCmsMode('local');
    expect(loadCmsProjectConfig().mode).toBe('local');
  });
});
