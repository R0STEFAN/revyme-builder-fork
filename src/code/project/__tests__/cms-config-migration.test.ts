import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('@/code/project/project-fs', () => ({
  projectFS: {
    readFile: (path: string) => files.get(path) ?? null,
    writeFile: (path: string, code: string) => { files.set(path, code); },
    exists: (path: string) => files.has(path),
    listFiles: (dir = '') => [...files.keys()].filter(p => p.startsWith(dir)),
    dump: () => Object.fromEntries(files),
  },
}));
vi.mock('@/backend/autosave', () => ({ triggerAutosave: vi.fn() }));

import {
  syncAffectedCmsPageWrappers,
  createCmsIndexPageFile,
  createCmsDetailPageFile,
  repairLegacyDetailBindings,
  repairBareAltAttributes,
} from '@/code/project/cms-page-ops';
import { saveCollectionSchema } from '@/code/project/cms-ops';
import { saveApiCollection, setCmsMode, type ApiCollectionConfig } from '@/code/project/cms-api-config';
import { projectFS } from '@/code/project/project-fs';

describe('CMS Config Migration & Wrapper Synchronization', () => {
  beforeEach(() => {
    files.clear();
    saveCollectionSchema('posts', {
      slug: 'posts',
      name: 'Posts',
      fields: [
        { id: 'title', name: 'Title', type: 'text' },
        { id: 'body', name: 'Body', type: 'textarea' },
        { id: 'cover', name: 'Cover', type: 'image' },
      ],
    });
  });

  it('migrates local index and detail wrappers to API fetch wrappers when switching local -> API', () => {
    // 1. Create standard local pages
    createCmsIndexPageFile('posts');
    createCmsDetailPageFile('posts');

    expect(projectFS.readFile('app/posts/page.tsx')).toContain("import PageClient from './page.client';");
    expect(projectFS.readFile('app/posts/page.tsx')).not.toContain('fetch(');
    expect(projectFS.readFile('app/posts/[slug]/page.tsx')).toContain("from '@/cms/posts.json';");

    // 2. Define API config
    const apiConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'directus',
      url: 'https://cms.example.com/items/posts',
      method: 'GET',
      headers: { Authorization: 'Bearer env:CMS_TOKEN' },
      cacheMaxAge: 7200,
      itemsKey: 'data',
    };

    saveApiCollection('posts', apiConfig);
    setCmsMode('api');

    // 3. Synchronize affected page wrappers
    const modified = syncAffectedCmsPageWrappers('posts', apiConfig);
    expect(modified).toContain('app/posts/page.tsx');
    expect(modified).toContain('app/posts/[slug]/page.tsx');

    // Verify index server wrapper
    const indexServer = projectFS.readFile('app/posts/page.tsx')!;
    expect(indexServer).toContain('https://cms.example.com/items/posts');
    expect(indexServer).toContain('revalidate: 7200');
    expect(indexServer).toContain('process.env.CMS_TOKEN');
    expect(indexServer).toContain('json["data"]');
    expect(indexServer).toContain('<PageClient items={items} />');
    expect(indexServer).not.toContain("from '@/cms/posts.json'");

    // Verify detail server wrapper
    const detailServer = projectFS.readFile('app/posts/[slug]/page.tsx')!;
    expect(detailServer).toContain('https://cms.example.com/items/posts');
    expect(detailServer).toContain('revalidate: 7200');
    expect(detailServer).toContain('process.env.CMS_TOKEN');
    expect(detailServer).toContain('json["data"]?.[0]');
    expect(detailServer).toContain('<PageClient item={item} />');
    expect(detailServer).not.toContain("from '@/cms/posts.json'");

    // Verify detail client file upgraded signature
    const detailClient = projectFS.readFile('app/posts/[slug]/page.client.tsx')!;
    expect(detailClient).toContain('Page({ item: serverItem }');
    expect(detailClient).toContain('const item = serverItem ??');

    // Verify index client file upgraded signature
    const indexClient = projectFS.readFile('app/posts/page.client.tsx')!;
    expect(indexClient).toContain('Page({ items: serverItems }');
    expect(indexClient).toContain('const items = serverItems ??');
  });

  it('updates endpoint URL from old to new across all wrappers', () => {
    const oldConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'custom_rest',
      url: 'https://old.example.com/items',
      method: 'GET',
      headers: {},
      cacheMaxAge: 14400,
    };
    saveApiCollection('posts', oldConfig);
    setCmsMode('api');

    createCmsIndexPageFile('posts');
    createCmsDetailPageFile('posts');

    expect(projectFS.readFile('app/posts/page.tsx')).toContain('https://old.example.com/items');
    expect(projectFS.readFile('app/posts/[slug]/page.tsx')).toContain('https://old.example.com/items');

    const newConfig: ApiCollectionConfig = {
      ...oldConfig,
      url: 'https://new.example.com/items',
    };
    saveApiCollection('posts', newConfig);

    syncAffectedCmsPageWrappers('posts', newConfig);

    const indexServer = projectFS.readFile('app/posts/page.tsx')!;
    expect(indexServer).toContain('https://new.example.com/items');
    expect(indexServer).not.toContain('https://old.example.com/items');

    const detailServer = projectFS.readFile('app/posts/[slug]/page.tsx')!;
    expect(detailServer).toContain('https://new.example.com/items');
    expect(detailServer).not.toContain('https://old.example.com/items');
  });

  it('updates authorization headers from OLD_TOKEN to NEW_TOKEN across all wrappers', () => {
    const initialConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'directus',
      url: 'https://cms.example.com/posts',
      method: 'GET',
      headers: { Authorization: 'Bearer env:OLD_TOKEN' },
      cacheMaxAge: 14400,
    };
    saveApiCollection('posts', initialConfig);
    setCmsMode('api');

    createCmsIndexPageFile('posts');
    createCmsDetailPageFile('posts');

    expect(projectFS.readFile('app/posts/page.tsx')).toContain('OLD_TOKEN');
    expect(projectFS.readFile('app/posts/[slug]/page.tsx')).toContain('OLD_TOKEN');

    const updatedConfig: ApiCollectionConfig = {
      ...initialConfig,
      headers: { Authorization: 'Bearer env:NEW_TOKEN' },
    };
    saveApiCollection('posts', updatedConfig);

    syncAffectedCmsPageWrappers('posts', updatedConfig);

    const indexServer = projectFS.readFile('app/posts/page.tsx')!;
    expect(indexServer).toContain('NEW_TOKEN');
    expect(indexServer).not.toContain('OLD_TOKEN');

    const detailServer = projectFS.readFile('app/posts/[slug]/page.tsx')!;
    expect(detailServer).toContain('NEW_TOKEN');
    expect(detailServer).not.toContain('OLD_TOKEN');
  });

  it('is completely idempotent when executed multiple times with identical config', () => {
    const apiConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'strapi',
      url: 'https://strapi.example.com/api/posts',
      method: 'GET',
      headers: { Authorization: 'Bearer env:STRAPI_TOKEN' },
      cacheMaxAge: 3600,
      itemsKey: 'data',
    };
    saveApiCollection('posts', apiConfig);
    setCmsMode('api');

    createCmsIndexPageFile('posts');
    createCmsDetailPageFile('posts');

    // Run first sync
    syncAffectedCmsPageWrappers('posts', apiConfig);
    const dumpAfterFirst = Object.fromEntries(files);

    // Run second sync
    const modifiedSecond = syncAffectedCmsPageWrappers('posts', apiConfig);
    const dumpAfterSecond = Object.fromEntries(files);

    expect(modifiedSecond).toHaveLength(0);
    expect(dumpAfterSecond).toEqual(dumpAfterFirst);
  });

  it('preserves SEO bindings, defaults, custom components and layout structures', () => {
    const detailServerWithCustomCode = `import PageClient from './page.client';
import CustomLayout from '@/components/CustomLayout';
import CustomTracker from '@/components/CustomTracker';

const seoDefaults = { title: "Custom Posts Default", description: "Default Description" };

const seoBindings = { title: "title", description: "body" };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return seoDefaults;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <CustomLayout>
      <CustomTracker />
      <PageClient item={item} />
    </CustomLayout>
  );
}
`;
    projectFS.writeFile('app/posts/[slug]/page.tsx', detailServerWithCustomCode);
    projectFS.writeFile('app/posts/[slug]/page.client.tsx', `
/** @cmsPage {
  "collection": "posts",
  "kind": "detail"
} */
export default function Page({ item: serverItem }: { item?: any } = {}) {
  return <div>Detail</div>;
}
`);

    const indexServerWithCustomCode = `import PageClient from './page.client';
import HeaderLayout from '@/components/HeaderLayout';

export const metadata = { title: "Articles & Blog" };

export default async function Page() {
  return (
    <HeaderLayout>
      <PageClient items={items} />
    </HeaderLayout>
  );
}
`;
    projectFS.writeFile('app/posts/page.tsx', indexServerWithCustomCode);
    projectFS.writeFile('app/posts/page.client.tsx', `
export default function Page({ items: serverItems }: { items?: any[] } = {}) {
  return <div>Index</div>;
}
`);

    const apiConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'directus',
      url: 'https://directus.example.com/items/posts',
      method: 'POST',
      headers: { Authorization: 'Bearer env:DIRECTUS_KEY' },
      cacheMaxAge: 1800,
    };

    syncAffectedCmsPageWrappers('posts', apiConfig);

    // Verify detail server preserved SEO bindings, custom imports, and layout
    const detailUpdated = projectFS.readFile('app/posts/[slug]/page.tsx')!;
    expect(detailUpdated).toContain('seoDefaults = { title: "Custom Posts Default", description: "Default Description" }');
    expect(detailUpdated).toContain('seoBindings = { title: "title", description: "body" }');
    expect(detailUpdated).toContain("import CustomLayout from '@/components/CustomLayout';");
    expect(detailUpdated).toContain("import CustomTracker from '@/components/CustomTracker';");
    expect(detailUpdated).toContain('<CustomLayout>');
    expect(detailUpdated).toContain('<PageClient item={item} />');
    expect(detailUpdated).toContain("method: 'POST'");

    // Verify index server preserved custom metadata, custom imports, and layout
    const indexUpdated = projectFS.readFile('app/posts/page.tsx')!;
    expect(indexUpdated).toContain('export const metadata = { title: "Articles & Blog" };');
    expect(indexUpdated).toContain("import HeaderLayout from '@/components/HeaderLayout';");
    expect(indexUpdated).toContain('<HeaderLayout>');
    expect(indexUpdated).toContain('<PageClient items={items} />');
    expect(indexUpdated).toContain("method: 'POST'");
  });

  it('repairs legacy {item.img_file.metadata} and bare alt attributes in detail pages', () => {
    const legacyClientCode = `'use client';

/** @cmsPage {
  "collection": "posts",
  "kind": "detail"
} */

import React from 'react';
import posts from '@/cms/posts.json';

export default function Page() {
  const item = posts[0];
  return (
    <div>
      <img data-id="img-1" src={item.cover} alt style={{ width: '100%' }} />
      <p data-id="meta">{item.img_file.metadata}</p>
      <p data-id="meta2">{item.other?.metadata}</p>
    </div>
  );
}
`;
    projectFS.writeFile('app/posts/[slug]/page.client.tsx', legacyClientCode);
    projectFS.writeFile('app/posts/[slug]/page.tsx', `
import PageClient from './page.client';
import posts from '@/cms/posts.json';
export const metadata = {};
export default function Page() { return <PageClient />; }
`);

    const apiConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'directus',
      url: 'https://directus.example.com/items/posts',
      method: 'GET',
      headers: {},
    };

    syncAffectedCmsPageWrappers('posts', apiConfig);

    const clientRepaired = projectFS.readFile('app/posts/[slug]/page.client.tsx')!;
    expect(clientRepaired).toContain('alt=""');
    expect(clientRepaired).not.toMatch(/<img[^>]*\balt(?!\s*=)/);
    expect(clientRepaired).toContain("typeof item.img_file?.metadata === 'object' ? JSON.stringify(item.img_file?.metadata)");
    expect(clientRepaired).toContain("typeof item.other?.metadata === 'object' ? JSON.stringify(item.other?.metadata)");
  });

  it('scans and upgrades wrappers located inside route groups and locale prefixes', () => {
    projectFS.writeFile('app/(marketing)/posts/page.tsx', `
import PageClient from './page.client';
export const metadata = {};
export default function Page() { return <PageClient />; }
`);
    projectFS.writeFile('app/(marketing)/posts/page.client.tsx', `
import posts from '@/cms/posts.json';
export default function Page() { return <div>{posts.map(p => p.title)}</div>; }
`);

    projectFS.writeFile('app/[locale]/(marketing)/posts/[slug]/page.tsx', `
import PageClient from './page.client';
import posts from '@/cms/posts.json';
const seoDefaults = {};
const seoBindings = {};
export default function Page() { return <PageClient />; }
`);
    projectFS.writeFile('app/[locale]/(marketing)/posts/[slug]/page.client.tsx', `
/** @cmsPage {
  "collection": "posts",
  "kind": "detail"
} */
import posts from '@/cms/posts.json';
export default function Page() { return <div>Detail</div>; }
`);

    const apiConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'directus',
      url: 'https://directus.example.com/items/posts',
      method: 'GET',
      headers: { 'X-Custom-Header': 'custom-val' },
    };

    const modified = syncAffectedCmsPageWrappers('posts', apiConfig);
    expect(modified).toContain('app/(marketing)/posts/page.tsx');
    expect(modified).toContain('app/[locale]/(marketing)/posts/[slug]/page.tsx');

    expect(projectFS.readFile('app/(marketing)/posts/page.tsx')).toContain('https://directus.example.com/items/posts');
    expect(projectFS.readFile('app/[locale]/(marketing)/posts/[slug]/page.tsx')).toContain('https://directus.example.com/items/posts');
  });

  it('does not touch arbitrary pages (like home or about) or different collections importing json', () => {
    // 1. Home page importing posts for a card list
    projectFS.writeFile('app/page.tsx', `
import PageClient from './page.client';
export const metadata = { title: "Home" };
export default function Page() { return <PageClient />; }
`);
    projectFS.writeFile('app/page.client.tsx', `
import posts from '@/cms/posts.json';
export default function Page() { return <div>Latest: {posts.length}</div>; }
`);

    // 2. About page importing posts for a team/posts showcase
    projectFS.writeFile('app/about/page.tsx', `
import PageClient from './page.client';
export const metadata = { title: "About" };
export default function Page() { return <PageClient />; }
`);
    projectFS.writeFile('app/about/page.client.tsx', `
import posts from '@/cms/posts.json';
export default function Page() { return <div>About with {posts.length} posts</div>; }
`);

    // 3. Different collection route (authors)
    projectFS.writeFile('app/authors/page.tsx', `
import PageClient from './page.client';
export const metadata = { title: "Authors" };
export default function Page() { return <PageClient />; }
`);
    projectFS.writeFile('app/authors/page.client.tsx', `
/** @cmsPage {
  "collection": "authors",
  "kind": "index"
} */
import posts from '@/cms/posts.json';
export default function Page() { return <div>Authors</div>; }
`);

    const apiConfig: ApiCollectionConfig = {
      slug: 'posts',
      name: 'Posts',
      provider: 'directus',
      url: 'https://directus.example.com/items/posts',
      method: 'GET',
      headers: {},
    };

    const modified = syncAffectedCmsPageWrappers('posts', apiConfig);
    expect(modified).not.toContain('app/page.tsx');
    expect(modified).not.toContain('app/page.client.tsx');
    expect(modified).not.toContain('app/about/page.tsx');
    expect(modified).not.toContain('app/about/page.client.tsx');
    expect(modified).not.toContain('app/authors/page.tsx');
    expect(modified).not.toContain('app/authors/page.client.tsx');

    expect(projectFS.readFile('app/page.tsx')).not.toContain('fetch(');
    expect(projectFS.readFile('app/about/page.tsx')).not.toContain('fetch(');
    expect(projectFS.readFile('app/authors/page.tsx')).not.toContain('fetch(');
  });

  it('respects word boundary in repairBareAltAttributes and ignores altText or altitude', () => {
    const codeWithAltProps = `
      <img data-id="img-1" src="/a.jpg" altText="sample description" altitude="1200" />
      <img data-id="img-2" src="/b.jpg" alt />
    `;
    const repaired = repairBareAltAttributes(codeWithAltProps);
    expect(repaired).toContain('altText="sample description"');
    expect(repaired).toContain('altitude="1200"');
    expect(repaired).toContain('<img data-id="img-2" src="/b.jpg" alt="" />');
  });

  it('repairs multiline bare alt attributes across newlines and guards complex relation properties', () => {
    const multilineCode = `
      <img
        data-id="img-multiline"
        src={item.cover}
        alt
        style={{ width: '100%' }}
      />
      <p data-id="p1">{item.categories_m2m}</p>
      <p data-id="p2">{item.title}</p>
    `;
    const repairedAlt = repairBareAltAttributes(multilineCode);
    expect(repairedAlt).toContain('alt=""');
    expect(repairedAlt).not.toMatch(/<img[^>]*\balt(?!\s*=)/);

    const repairedBindings = repairLegacyDetailBindings(repairedAlt);
    expect(repairedBindings).toContain('typeof item?.categories_m2m === \'object\'');
    expect(repairedBindings).toContain('{item.title}');
  });
});

