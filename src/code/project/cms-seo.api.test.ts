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
    dump: vi.fn(() => Object.fromEntries(fsStore)),
  },
}));

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: vi.fn(),
}));

import { saveApiCollection, setCmsMode } from './cms-api-config';
import { buildCmsDetailServerWrapper } from './cms-seo';

describe('cms-seo — API Headless CMS Server Wrapper Generation', () => {
  beforeEach(() => {
    fsStore.clear();
  });

  it('generates standard local JSON import wrapper when collection is local', () => {
    const code = buildCmsDetailServerWrapper({
      collection: 'articles',
      bindings: { title: 'name' },
    });

    expect(code).toContain("import articles from '@/cms/articles.json';");
    expect(code).toContain('export async function generateMetadata');
    expect(code).toContain('export default function Page');
  });

  it('generates async server fetch wrapper with process.env headers for API collection', () => {
    saveApiCollection('tattoos', {
      name: 'Tattoos',
      slug: 'tattoos',
      provider: 'directus',
      url: 'https://cms.example.com/items/tattoos',
      method: 'GET',
      headers: {
        Authorization: 'Bearer process.env.DIRECTUS_TOKEN',
      },
      defaultParams: {
        fields: '*.*',
      },
      cacheMaxAge: 14400,
    });
    setCmsMode('api');

    const code = buildCmsDetailServerWrapper({
      collection: 'tattoos',
      bindings: { title: 'name', description: 'desc' },
      includeStaticParams: true,
    });

    // Does not import static JSON in server wrapper
    expect(code).not.toContain("import tattoos from '@/cms/tattoos.json';");
    // Imports notFound
    expect(code).toContain("import { notFound } from 'next/navigation';");
    // Contains process.env token header interpolation
    expect(code).toContain('`Bearer ${process.env.DIRECTUS_TOKEN}`');
    // Generates metadata with dynamic server fetch
    expect(code).toContain('export async function generateMetadata');
    expect(code).toContain('revalidate: 14400');
    // Generates static params
    expect(code).toContain('export async function generateStaticParams');
    // Dynamic params enabled
    expect(code).toContain('export const dynamicParams = true;');
    // Exports async Page component with notFound guard and PageClient prop
    expect(code).toContain('export default async function Page');
    expect(code).toContain('notFound()');
    expect(code).toContain('<PageClient item={item} />');
  });
});
