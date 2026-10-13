import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'jotai';

const fsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('../project/project-fs', () => {
  const { atom } = require('jotai');
  return {
    projectVersionAtom: atom(0),
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
  };
});

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: vi.fn(),
}));

import {
  cmsModeAtom,
  apiCollectionsConfigAtom,
  cmsProjectConfigAtom,
  collectionSchemasAtom,
  collectionDataAtom,
} from './cms-store';

describe('cms-store atoms', () => {
  beforeEach(() => {
    fsStore.clear();
  });

  it('defaults to local mode and empty apiCollections', () => {
    const store = createStore();
    expect(store.get(cmsModeAtom)).toBe('local');
    expect(store.get(apiCollectionsConfigAtom).size).toBe(0);
  });

  it('reflects api mode and collections from _meta/cms-api-config.json', () => {
    const store = createStore();
    const config = {
      mode: 'api',
      apiCollections: {
        products: {
          slug: 'products',
          name: 'Products',
          provider: 'directus',
          url: 'https://example.com/items/products',
          method: 'GET',
          headers: {},
        },
      },
    };
    fsStore.set('_meta/cms-api-config.json', JSON.stringify(config));

    expect(store.get(cmsModeAtom)).toBe('api');
    const apiCols = store.get(apiCollectionsConfigAtom);
    expect(apiCols.size).toBe(1);
    expect(apiCols.get('products')?.name).toBe('Products');
  });

  it('reads schemas and data from cms/ directory', () => {
    const store = createStore();
    fsStore.set('cms/blog.schema.json', JSON.stringify({ slug: 'blog', name: 'Blog', fields: [] }));
    fsStore.set('cms/blog.json', JSON.stringify([{ id: '1', title: 'Post 1' }]));

    const schemas = store.get(collectionSchemasAtom);
    const data = store.get(collectionDataAtom);

    expect(schemas.has('blog')).toBe(true);
    expect(data.get('blog')?.length).toBe(1);
  });
});
