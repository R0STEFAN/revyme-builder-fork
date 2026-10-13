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
import { saveCollectionSchema } from './cms-ops';
import { createCmsDetailPageFile, createCmsIndexPageFile } from './cms-page-ops';
import { buildSourceExport } from './source-export';
import { projectFS } from './project-fs';

describe('cms-page-ops — Next.js Codegen for API CMS collections', () => {
  beforeEach(() => {
    fsStore.clear();
  });

  it('scaffolds detail page pair with server fetch wrapper and client fallback pattern', () => {
    saveApiCollection('artworks', {
      name: 'Artworks',
      slug: 'artworks',
      provider: 'directus',
      url: 'https://directus.app/items/artworks',
      method: 'GET',
      headers: {
        Authorization: 'Bearer process.env.API_KEY',
      },
      cacheMaxAge: 14400,
    });
    saveCollectionSchema('artworks', {
      name: 'Artworks',
      slug: 'artworks',
      fields: [
        { id: 'title', name: 'Title', type: 'text' },
        { id: 'description', name: 'Description', type: 'textarea' },
      ],
    });
    setCmsMode('api');

    const clientPath = createCmsDetailPageFile('artworks');
    expect(clientPath).toBe('app/artworks/[slug]/page.client.tsx');

    const clientCode = projectFS.readFile(clientPath) || '';
    expect(clientCode).toContain("/** @cmsPage");
    expect(clientCode).toContain('serverItem');
    expect(clientCode).toContain('artworks.find');

    const serverPath = 'app/artworks/[slug]/page.tsx';
    const serverCode = projectFS.readFile(serverPath) || '';
    expect(serverCode).toContain('export async function generateMetadata');
    expect(serverCode).toContain('export async function generateStaticParams');
    expect(serverCode).toContain('export const dynamicParams = true;');
    expect(serverCode).toContain('export default async function Page');
    expect(serverCode).toContain('<PageClient item={item} />');
  });

  it('scaffolds index page pair with server fetch and PageClient items prop', () => {
    saveApiCollection('artworks', {
      name: 'Artworks',
      slug: 'artworks',
      provider: 'directus',
      url: 'https://directus.app/items/artworks',
      method: 'GET',
      headers: {},
      cacheMaxAge: 14400,
    });
    saveCollectionSchema('artworks', {
      name: 'Artworks',
      slug: 'artworks',
      fields: [{ id: 'title', name: 'Title', type: 'text' }],
    });
    setCmsMode('api');

    const clientPath = createCmsIndexPageFile('artworks');
    expect(clientPath).toBe('app/artworks/page.client.tsx');

    const clientCode = projectFS.readFile(clientPath) || '';
    expect(clientCode).toContain('serverItems');

    const serverPath = 'app/artworks/page.tsx';
    const serverCode = projectFS.readFile(serverPath) || '';
    expect(serverCode).toContain('export default async function Page');
    expect(serverCode).toContain('<PageClient items={items} />');
  });

  it('generates .env.example and excludes _meta/ and .env.local during source export', async () => {
    projectFS.writeFile('.env.local', 'DIRECTUS_TOKEN=super_secret_value\nAPI_URL=https://secret.com\n');
    projectFS.writeFile('_meta/cms-api.json', JSON.stringify({ mode: 'api', collections: [] }));
    projectFS.writeFile('app/page.tsx', "export default function Home() { return <div>{process.env.PUBLIC_ANALYTICS}</div>; }\n");

    const exportResult = await buildSourceExport(Object.fromEntries(fsStore), {
      name: 'my-project',
      runtimeRange: '^1.0.0',
    });

    // Secret files must not be exported
    expect(exportResult.files['.env.local']).toBeUndefined();
    expect(exportResult.files['_meta/cms-api.json']).toBeUndefined();

    // .env.example must be present and document referenced environment variables
    const envExample = exportResult.files['.env.example'];
    expect(envExample).toBeDefined();
    expect(envExample).toContain('DIRECTUS_TOKEN=');
    expect(envExample).toContain('API_URL=');
    expect(envExample).toContain('PUBLIC_ANALYTICS=');
    // Secret values must never be included in example
    expect(envExample).not.toContain('super_secret_value');
  });
});
