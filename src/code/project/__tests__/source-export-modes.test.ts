import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import {
  prepareSiteFiles,
  stripGenerateStaticParams,
  detectPageCollectionQueries,
  injectCmsDatasetsIntoClientPage,
  orchestrateServerFetchForQueries,
  buildCmsQueryRouteHandler,
  buildCmsRevalidateRouteHandler,
  injectResponsiveImageSrcSets,
} from '../source-export';
import { buildCmsDetailServerWrapper } from '../cms-seo';
import { saveApiCollection, setCmsMode, type ApiCollectionConfig } from '../cms-api-config';

beforeEach(() => {
  saveApiCollection('posts', {
    name: 'Posts',
    slug: 'posts',
    provider: 'directus',
    url: 'https://cms.example.invalid/items/posts',
    method: 'GET',
    headers: { Authorization: 'Bearer env:CMS_TOKEN' },
    itemsKey: 'data',
  });
  setCmsMode('api');
});

describe('Source Export Modes: Dynamic vs Hybrid SSG', () => {
  const localDetailServerWrapper = `import PageClient from './page.client';
import articles from '@/cms/articles.json';

const seoDefaults = {};
const seoBindings = {};

export async function generateMetadata({ params }) {
  const resolved = await params;
  return {};
}

export default function Page() {
  return <PageClient />;
}
`;

  const localeWrapperWithSsg = `// @revyme-locale-route
export { default, generateStaticParams } from '../[slug]/page';
`;

  const localeWrapperWithoutSsg = `// @revyme-locale-route
export { default } from '../[slug]/page';
`;

  it('Dynamic mode (ssg: false): strips generateStaticParams from detail page and ensures dynamicParams', () => {
    const apiDetailServer = buildCmsDetailServerWrapper({
      collection: 'posts',
      includeStaticParams: true,
    });
    expect(apiDetailServer).toContain('export async function generateStaticParams');

    const files = {
      'app/posts/[slug]/page.tsx': apiDetailServer,
      'app/[locale]/posts/[slug]/page.tsx': localeWrapperWithSsg,
      'app/articles/[slug]/page.tsx': localDetailServerWrapper,
    };

    const dynamicPrepared = prepareSiteFiles(files, { ssg: false });

    // Confirm Dynamic contains NO generateStaticParams
    expect(dynamicPrepared['app/posts/[slug]/page.tsx']).not.toContain('generateStaticParams');
    expect(dynamicPrepared['app/posts/[slug]/page.tsx']).toContain('export const dynamicParams = true;');

    // Confirm locale wrapper was stripped of generateStaticParams
    expect(dynamicPrepared['app/[locale]/posts/[slug]/page.tsx']).not.toContain('generateStaticParams');
    expect(dynamicPrepared['app/[locale]/posts/[slug]/page.tsx']).toContain('export { default } from');

    // Confirm valid JS/TS AST
    expect(() =>
      parse(dynamicPrepared['app/posts/[slug]/page.tsx'], {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      }),
    ).not.toThrow();

    expect(() =>
      parse(dynamicPrepared['app/[locale]/posts/[slug]/page.tsx'], {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      }),
    ).not.toThrow();
  });

  it('Hybrid SSG mode (ssg: true): preserves or injects generateStaticParams', () => {
    const apiDetailServer = buildCmsDetailServerWrapper({
      collection: 'posts',
      includeStaticParams: true,
    });

    const files = {
      'app/posts/[slug]/page.tsx': apiDetailServer,
      'app/[locale]/posts/[slug]/page.tsx': localeWrapperWithoutSsg,
      'app/articles/[slug]/page.tsx': localDetailServerWrapper,
    };

    const hybridPrepared = prepareSiteFiles(files, { ssg: true });

    // Preserves generateStaticParams in API CMS detail page
    expect(hybridPrepared['app/posts/[slug]/page.tsx']).toContain('export async function generateStaticParams');

    // Injects generateStaticParams in local CMS detail page
    expect(hybridPrepared['app/articles/[slug]/page.tsx']).toContain('export async function generateStaticParams');

    // Injects generateStaticParams into locale route wrapper
    expect(hybridPrepared['app/[locale]/posts/[slug]/page.tsx']).toContain(
      'export { default, generateStaticParams } from',
    );
  });

  it('Direct comparison between Dynamic mode (ssg: false) and Hybrid SSG mode (ssg: true)', () => {
    const apiDetailServer = buildCmsDetailServerWrapper({
      collection: 'posts',
      includeStaticParams: true,
    });

    const initialFiles = {
      'app/posts/[slug]/page.tsx': apiDetailServer,
      'app/articles/[slug]/page.tsx': localDetailServerWrapper,
      'app/[locale]/posts/[slug]/page.tsx': localeWrapperWithSsg,
    };

    const dynamicOutput = prepareSiteFiles(initialFiles, { ssg: false });
    const hybridOutput = prepareSiteFiles(initialFiles, { ssg: true });

    // Dynamic mode has NO generateStaticParams anywhere in server wrappers
    for (const [path, code] of Object.entries(dynamicOutput)) {
      if (path.endsWith('page.tsx')) {
        expect(code).not.toContain('generateStaticParams');
      }
    }

    // Hybrid mode HAS generateStaticParams in CMS detail and locale wrappers
    expect(hybridOutput['app/posts/[slug]/page.tsx']).toContain('generateStaticParams');
    expect(hybridOutput['app/articles/[slug]/page.tsx']).toContain('generateStaticParams');
    expect(hybridOutput['app/[locale]/posts/[slug]/page.tsx']).toContain('generateStaticParams');
  });

  it('stripGenerateStaticParams helper handles multi-line comments and nested braces cleanly', () => {
    const code = `
export async function generateStaticParams() {
  const query = { nested: { val: 1 } };
  const str = "braces { inside } string";
  return [{ slug: 'a' }, { slug: 'b' }];
}

export default async function Page() {
  return <div>Detail</div>;
}
`;
    const stripped = stripGenerateStaticParams(code);
    expect(stripped).not.toContain('generateStaticParams');
    expect(stripped).toContain('export default async function Page');
    expect(stripped).toContain('export const dynamicParams = true;');
  });

  it('Hybrid SSG mode: generates generateStaticParams for arbitrary multi-segment and non-slug dynamic routes', () => {
    const files = {
      'app/gallery/[category]/page.tsx': `import PageClient from './page.client';
export const metadata = {};
export default function Page() {
  return <PageClient />;
}`,
      'app/gallery/[category]/[place]/page.tsx': `import PageClient from './page.client';
export const metadata = {};
export default async function Page() {
  return <PageClient />;
}`,
      'components/Navbar.tsx': `import React from 'react';
import Link from 'next/link';
import placements from '@/cms/placements.json';
export default function Navbar() {
  return (
    <div>
      <Link href="/gallery/women">Women</Link>
      {placements.map((item: any) => (
        <Link key={item.slug} href={"/gallery/men/" + item.slug}>{item.name}</Link>
      ))}
    </div>
  );
}`,
      'cms/placements.json': JSON.stringify([
        { name: 'На передпліччі', slug: 'peredplichcha' },
        { name: 'На спині', slug: 'spina' },
      ]),
    };

    const hybridPrepared = prepareSiteFiles(files, { ssg: true });

    // Single-segment non-slug route receives generateStaticParams with discovered categories
    const catPage = hybridPrepared['app/gallery/[category]/page.tsx'];
    expect(catPage).toContain('export async function generateStaticParams');
    expect(catPage).toContain('"category": "women"');
    expect(catPage).toContain('"category": "men"');

    // Multi-segment dynamic route receives generateStaticParams with cartesian combinations
    const placePage = hybridPrepared['app/gallery/[category]/[place]/page.tsx'];
    expect(placePage).toContain('export async function generateStaticParams');
    expect(placePage).toContain('"category": "men"');
    expect(placePage).toContain('"place": "peredplichcha"');
    expect(placePage).toContain('"place": "spina"');

    // In Dynamic mode, they remain clean without generateStaticParams
    const dynamicPrepared = prepareSiteFiles(hybridPrepared, { ssg: false });
    expect(dynamicPrepared['app/gallery/[category]/page.tsx']).not.toContain('generateStaticParams');
    expect(dynamicPrepared['app/gallery/[category]/[place]/page.tsx']).not.toContain('generateStaticParams');
  });
});

describe('Server fetch orchestration for arbitrary collection lists', () => {
  const clientPageWithList = `'use client';

import React from 'react';
import tattoos from '@/cms/tattoos.json';

export default function Page() {
  return (
    <div data-id="root">
      <div
        data-id="gallery-grid"
        data-query-config={JSON.stringify({
          isApiMode: true,
          params: [
            { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
            { key: 'filter[place][_eq]', value: 'params.place', isExpression: true },
            { key: 'limit', value: '20' },
          ],
        })}
      >
        {tattoos.map((item: any, idx: number) => (
          <div data-id="card" key={idx}>
            <p data-id="title">{item.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

  const serverWrapper = `import PageClient from './page.client';

export const metadata = {};

export default function Page() {
  return <PageClient />;
}
`;

  it('detects collection query config with balanced tags and expression params', () => {
    const queries = detectPageCollectionQueries(clientPageWithList);
    expect(queries).toHaveLength(1);
    expect(queries[0].listId).toBe('gallery-grid');
    expect(queries[0].source).toBe('tattoos');
    expect(queries[0].queryConfig.params).toHaveLength(3);
  });

  it('detects collection query config and injects cmsDatasets even with pagination .slice() and multiple imports', () => {
    const paginatedClientPage = `import tattoos from '@/cms/tattoos.json';
import categories from '@/cms/categories.json';
import placements from '@/cms/placements.json';

export default function Page() {
  const [limit] = useState(9);
  return (
    <div data-id="root">
      <div
        data-id="gallery-grid"
        data-pagination="loadMore:9"
        data-query-config={JSON.stringify({
          isApiMode: true,
          params: [
            { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
            { key: 'filter[place][_eq]', value: 'params.place', isExpression: true },
          ],
        })}
      >
        {tattoos.slice(0, limit).map((item: any, idx: number) => (
          <div data-id="card" key={idx}>
            <p data-id="title">{item.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}`;

    const queries = detectPageCollectionQueries(paginatedClientPage);
    expect(queries).toHaveLength(1);
    expect(queries[0].listId).toBe('gallery-grid');
    expect(queries[0].source).toBe('tattoos');

    const updatedClient = injectCmsDatasetsIntoClientPage(paginatedClientPage, queries);
    expect(updatedClient).toContain(
      "(cmsDatasets?.['gallery-grid'] || cmsDatasets?.['tattoos'] || tattoos).slice(0, limit).map(",
    );
  });

  it('injects datasetExpr into hasMoreVar useState and useEffect for remote paginated collections', () => {
    const remotePage = `import React, { useState, useEffect } from 'react';
import tattoos from '@/cms/tattoos.json';
import LoadMore from '@/components/LoadMore';
export default function Page() {
  const [itemsGrid, setItemsGrid] = useState(() => (Array.isArray(tattoos) ? tattoos.slice(0, 4) : []));
  const [hasMoreGrid, setHasMoreGrid] = useState(true);
  useEffect(() => {
    setItemsGrid(Array.isArray(tattoos) ? tattoos.slice(0, 4) : []);
    setHasMoreGrid(true);
  }, [tattoos]);
  return <div data-id="root">
    <div data-id="grid" data-query-config='{"source":"tattoos"}' data-pagination="loadMore:4" data-remote-pagination="true">
      {itemsGrid.map((item, idx) => <div data-id="card" key={idx}>{item.title}</div>)}
    </div>
    {hasMoreGrid && <LoadMore data-id="loadmore-grid" />}
  </div>;
}`;
    const queries = detectPageCollectionQueries(remotePage);
    const updated = injectCmsDatasetsIntoClientPage(remotePage, queries);
    expect(updated).toContain("const [hasMoreGrid, setHasMoreGrid] = useState(() => (Array.isArray((cmsDatasets?.['grid'] || cmsDatasets?.['tattoos'] || tattoos)) ? (cmsDatasets?.['grid'] || cmsDatasets?.['tattoos'] || tattoos).length > 4 : true));");
    expect(updated).toContain("setHasMoreGrid(Array.isArray((cmsDatasets?.['grid'] || cmsDatasets?.['tattoos'] || tattoos)) ? (cmsDatasets?.['grid'] || cmsDatasets?.['tattoos'] || tattoos).length > 4 : true);");
  });

  it('safely injects datasetExpr into hasMoreVar useState when already initialized with lazy arrow function', () => {
    const remotePage = `import React, { useState, useEffect } from 'react';
import tattoos from '@/cms/tattoos.json';
import Spinner from '@/components/Spinner';
export default function Page() {
  const [itemsGrid, setItemsGrid] = useState(() => (Array.isArray(tattoos) ? tattoos.slice(0, 4) : []));
  const [hasMoreGrid, setHasMoreGrid] = useState(() => (Array.isArray(tattoos) ? tattoos.length > 4 : true));
  return <div data-id="root">
    <div data-id="grid" data-query-config='{"source":"tattoos"}' data-pagination="infinite:4" data-remote-pagination="true">
      {itemsGrid.map((item, idx) => <div data-id="card" key={idx}>{item.title}</div>)}
    </div>
  </div>;
}`;
    const queries = detectPageCollectionQueries(remotePage);
    const updated = injectCmsDatasetsIntoClientPage(remotePage, queries);
    expect(updated).toContain("const [hasMoreGrid, setHasMoreGrid] = useState(() => (Array.isArray((cmsDatasets?.['grid'] || cmsDatasets?.['tattoos'] || tattoos)) ? (cmsDatasets?.['grid'] || cmsDatasets?.['tattoos'] || tattoos).length > 4 : true));");
    expect(updated).not.toContain("=> (Array.isArray(tattoos) ? tattoos.length > 4 : true)); =>");
  });

  it('injects cmsDatasets into client page mapping and Page component signature', () => {
    const updatedClient = injectCmsDatasetsIntoClientPage(clientPageWithList);

    expect(updatedClient).toContain(
      "export default function Page({ cmsDatasets }: { cmsDatasets?: Record<string, any[]> } = {})",
    );
    expect(updatedClient).toContain(
      "(cmsDatasets?.['gallery-grid'] || cmsDatasets?.['tattoos'] || tattoos).map(",
    );
  });

  it('orchestrates server fetch in page.tsx with resolved route params, headers, and timeout', () => {
    const queries = detectPageCollectionQueries(clientPageWithList);
    const apiConfigs = {
      tattoos: {
        slug: 'tattoos',
        name: 'Tattoos',
        provider: 'directus' as const,
        url: 'https://api.example.com/items/tattoos',
        method: 'GET' as const,
        headers: { Authorization: 'Bearer env:CMS_API_KEY' },
        defaultParams: { fields: '*.*' },
        cacheMaxAge: 3600,
        itemsKey: 'data',
      },
    };

    const orchestrated = orchestrateServerFetchForQueries(serverWrapper, queries, apiConfigs);

    // Checks async signature & params
    expect(orchestrated).toContain('export default async function Page({ params }');
    expect(orchestrated).toContain('const routeParams = (params ? await params : {})');

    // Checks parameter evaluation & construction
    expect(orchestrated).toContain('function evaluateParam(');
    expect(orchestrated).toContain('evaluateParam("params.category", routeParams)');
    expect(orchestrated).toContain('evaluateParam("params.place", routeParams)');
    expect(orchestrated).toContain('qParams_0.set("limit", "20")');

    // Checks fetch call, headers, timeout, and next revalidate
    expect(orchestrated).toContain('signal: AbortSignal.timeout(10000)');
    expect(orchestrated).toContain('${process.env.CMS_API_KEY}');
    expect(orchestrated).toContain('next: { revalidate: 3600 }');

    // Checks datasets assignment and PageClient prop
    expect(orchestrated).toContain('cmsDatasets["gallery-grid"] = items_0;');
    expect(orchestrated).toContain('<PageClient cmsDatasets={cmsDatasets} />');

    // Confirms valid JS/TS AST
    expect(() =>
      parse(orchestrated, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      }),
    ).not.toThrow();
  });

  it('prepareSiteFiles end-to-end orchestrates both page.tsx and page.client.tsx for arbitrary lists', () => {
    const files = {
      '_meta/cms-api-config.json': JSON.stringify({
        mode: 'api',
        apiCollections: {
          tattoos: {
            slug: 'tattoos',
            name: 'Tattoos',
            provider: 'directus',
            url: 'https://api.example.com/items/tattoos',
            method: 'GET',
            headers: { Authorization: 'Bearer $API_SECRET' },
          },
        },
      }),
      'app/gallery/[category]/[place]/page.client.tsx': clientPageWithList,
      'app/gallery/[category]/[place]/page.tsx': serverWrapper,
    };

    const prepared = prepareSiteFiles(files, { ssg: false });

    // Client page updated
    expect(prepared['app/gallery/[category]/[place]/page.client.tsx']).toContain('cmsDatasets');
    expect(prepared['app/gallery/[category]/[place]/page.client.tsx']).toContain(
      "(cmsDatasets?.['gallery-grid'] || cmsDatasets?.['tattoos'] || tattoos).map(",
    );

    // Server wrapper updated
    expect(prepared['app/gallery/[category]/[place]/page.tsx']).toContain('signal: AbortSignal.timeout(10000)');
    expect(prepared['app/gallery/[category]/[place]/page.tsx']).toContain('${process.env.API_SECRET}');
    expect(prepared['app/gallery/[category]/[place]/page.tsx']).toContain('<PageClient cmsDatasets={cmsDatasets} />');
  });

  it('supports multiple arbitrary collection lists on the same page without collisions', () => {
    const multiListClient = `'use client';
import React from 'react';
import products from '@/cms/products.json';

export default function Page() {
  return (
    <div data-id="root">
      <div data-id="list-women" data-query-config='{"isApiMode":true,"params":[{"key":"filter[cat][_eq]","value":"\\"women\\"","isExpression":true}]}'>
        {products.map((item: any, idx: number) => <span key={idx}>{item.name}</span>)}
      </div>
      <div data-id="list-men" data-query-config='{"isApiMode":true,"params":[{"key":"filter[cat][_eq]","value":"\\"men\\"","isExpression":true}]}'>
        {products.map((item: any, idx: number) => <span key={idx}>{item.name}</span>)}
      </div>
    </div>
  );
}
`;
    const files = {
      '_meta/cms-api-config.json': JSON.stringify({
        mode: 'api',
        apiCollections: {
          products: {
            slug: 'products',
            name: 'Products',
            provider: 'directus',
            url: 'https://api.example.com/items/products',
            method: 'GET',
            headers: {},
          },
        },
      }),
      'app/shop/page.client.tsx': multiListClient,
      'app/shop/page.tsx': serverWrapper,
    };

    const prepared = prepareSiteFiles(files);
    const clientResult = prepared['app/shop/page.client.tsx'];
    const serverResult = prepared['app/shop/page.tsx'];

    expect(clientResult).toContain("cmsDatasets?.['list-women']");
    expect(clientResult).toContain("cmsDatasets?.['list-men']");

    expect(serverResult).toContain('cmsDatasets["list-women"] = items_0;');
    expect(serverResult).toContain('cmsDatasets["list-men"] = items_1;');
    expect(serverResult).toContain('<PageClient cmsDatasets={cmsDatasets} />');
  });
  it('prepares gallery route from portfolio-test2 with queryConfig and remote pagination', () => {
    const fs = require('fs');
    const project = JSON.parse(fs.readFileSync('data/projects/proj-1791960645579-j02nu7.json', 'utf8'));
    const files = {
      '_meta/cms-api-config.json': project.data.files['_meta/cms-api-config.json'],
      'app/(main)/gallery/[category]/[place]/page.client.tsx': project.data.files['app/(main)/gallery/[category]/[place]/page.client.tsx'],
      'app/(main)/gallery/[category]/[place]/page.tsx': project.data.files['app/(main)/gallery/[category]/[place]/page.tsx'],
    };
    const queries = detectPageCollectionQueries(files['app/(main)/gallery/[category]/[place]/page.client.tsx']);
    expect(queries).toHaveLength(1);
    expect(queries[0].source).toBe('tattoos');
    expect(queries[0].paginationLimit).toBe(4);

    const prepared = prepareSiteFiles(files, { ssg: false });
    expect(prepared['app/(main)/gallery/[category]/[place]/page.tsx']).toContain('qParams_0.set("limit", "5")');
    expect(prepared['app/(main)/gallery/[category]/[place]/page.tsx']).toContain('<PageClient cmsDatasets={cmsDatasets} />');
    expect(prepared['app/(main)/gallery/[category]/[place]/page.client.tsx']).toContain("cmsDatasets?.['frame-mv7ra9vc-5']");
    expect(prepared['app/(main)/gallery/[category]/[place]/page.client.tsx']).toContain('{itemsFrameMv7ra9vc5.map(');
    expect(prepared['app/(main)/gallery/[category]/[place]/page.client.tsx']).toContain('[tattoos, cmsDatasets]');

    const ssgPrepared = prepareSiteFiles(files, { ssg: true });
    expect(ssgPrepared['app/(main)/gallery/[category]/[place]/page.tsx']).toContain('qParams_0.set("limit", "5")');
    expect(ssgPrepared['app/(main)/gallery/[category]/[place]/page.tsx']).toContain('<PageClient cmsDatasets={cmsDatasets} />');
    expect(ssgPrepared['app/(main)/gallery/[category]/[place]/page.client.tsx']).toContain("cmsDatasets?.['frame-mv7ra9vc-5']");
    expect(ssgPrepared['app/(main)/gallery/[category]/[place]/page.client.tsx']).toContain('{itemsFrameMv7ra9vc5.map(');
    expect(ssgPrepared['app/(main)/gallery/[category]/[place]/page.client.tsx']).toContain('[tattoos, cmsDatasets]');
  });
});

describe('Application-Level Timeout & Error Handling in Server Wrappers', () => {
  it('detail server wrapper uses 10s AbortSignal timeout and distinguishes 404 from 5xx/network errors', () => {
    const wrapper = buildCmsDetailServerWrapper({
      collection: 'posts',
      includeStaticParams: true,
    });

    // Timeout signal present in fetch
    expect(wrapper).toContain('signal: AbortSignal.timeout(10000)');

    // Distinguishes 404 from 5xx
    expect(wrapper).toContain('if (res.status === 404) notFound();');
    expect(wrapper).toContain('if (!res.ok) {');
    expect(wrapper).toContain('throw new Error(`Failed to fetch CMS detail for ${slug}: ${res.status} ${res.statusText}`);');

    // Catches network error and rethrows
    expect(wrapper).toContain("console.error('Network error fetching CMS detail for ' + slug + ':', err);");
    expect(wrapper).toContain('throw err;');
  });
});

describe('buildCmsQueryRouteHandler caching & revalidate', () => {
  it('emits next: { revalidate: ... } with configured TTL or default 60', () => {
    const handler = buildCmsQueryRouteHandler({
      articles: {
        slug: 'articles',
        name: 'Articles',
        provider: 'directus' as const,
        method: 'GET',
        headers: {},
        url: 'https://cms.example.com/items/articles',
        revalidateTtl: 300,
      },
      tags: {
        slug: 'tags',
        name: 'Tags',
        provider: 'directus' as const,
        method: 'GET',
        headers: {},
        url: 'https://cms.example.com/items/tags',
      },
    });

    expect(handler).toContain('next: {');
    expect(handler).toContain('revalidate: config.revalidateTtl ?? 60');
    expect(handler).toContain('"revalidateTtl": 300');
  });
});

describe('Component data adaptation in source export', () => {
  it('adapts component CMS imports into /api/cms/query POST relay with { collection: ... }', () => {
    const navComponent = `'use client';
import React from 'react';
import categories from '@/cms/categories.json';

export default function Navbar() {
  return (
    <nav data-id="nav">
      {categories.map((c: any) => <a key={c.id} href={'/cat/' + c.slug}>{c.name}</a>)}
    </nav>
  );
}
`;
    const files = {
      '_meta/cms-api-config.json': JSON.stringify({
        mode: 'api',
        apiCollections: {
          categories: {
            slug: 'categories',
            name: 'Categories',
            url: 'https://cms.example.com/items/categories',
          },
        },
      }),
      'components/Navbar.tsx': navComponent,
    };

    const prepared = prepareSiteFiles(files, { buildMode: 'dynamic' });
    const result = prepared['components/Navbar.tsx'];

    expect(result).toContain("fetch('/api/cms/query'");
    expect(result).toContain("collection: 'categories'");
    expect(result).not.toContain("source: 'categories'");
    expect(result).not.toContain("source=");
  });

  it('injects CMS query hooks into the primary component instead of preceding helper functions (e.g. MotionLinkBase)', () => {
    const navWithHelpers = `'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import placements from '@/cms/placements.json';
import { withResponsiveProps } from '@revyme/runtime';

const MotionLink = React.forwardRef(function MotionLinkBase({ href, ...props }: any, ref: any) {
  return href ? <Link ref={ref} href={href} {...props} /> : <div ref={ref} {...props} />;
});

function Navbar({ style }: any) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  return (
    <nav style={style}>
      <button onClick={() => setDropdownOpen(!dropdownOpen)}>Menu</button>
      {dropdownOpen && (
        <div>
          {placements.map((item: any, idx: number) => (
            <MotionLink key={idx} href={'/items/' + item.slug}>{item.name}</MotionLink>
          ))}
        </div>
      )}
    </nav>
  );
}

export default withResponsiveProps(Navbar);
`;

    const files = {
      '_meta/cms-api-config.json': JSON.stringify({
        mode: 'api',
        apiCollections: {
          placements: {
            slug: 'placements',
            name: 'Placements',
            url: 'https://cms.example.com/items/placements',
          },
        },
      }),
      'components/Navbar.tsx': navWithHelpers,
    };

    const prepared = prepareSiteFiles(files, { ssg: true });
    const result = prepared['components/Navbar.tsx'];

    // Ensure placements hook was NOT placed inside MotionLinkBase
    const motionLinkPart = result.slice(0, result.indexOf('function Navbar'));
    expect(motionLinkPart).not.toContain('const [placements, setPlacements]');

    // Ensure placements hook WAS placed inside Navbar
    const navbarPart = result.slice(result.indexOf('function Navbar'));
    expect(navbarPart).toContain('const [placements, setPlacements] = React.useState<any[]>(placementsInitial);');
    expect(navbarPart).toContain("collection: 'placements'");
  });
});

describe('Remote CMS image optimization in export pipeline', () => {
  it('attaches srcSet and preserves query params for remote CMS images', () => {
    const pageWithImage = `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root">
      <img src="https://cms.example.com/assets/banner-123.jpg?token=secret123" style={{ width: '800px' }} />
    </div>
  );
}
`;
    const apiConfigs: Record<string, ApiCollectionConfig> = {
      banner: {
        slug: 'banner',
        name: 'Banner',
        provider: 'directus',
        method: 'GET',
        headers: {},
        url: 'https://cms.example.com/items/banner',
        imageOptimization: {
          enabled: true,
          engine: 'directus',
          quality: 80,
          format: 'webp',
        },
      },
    };

    const out = injectResponsiveImageSrcSets(pageWithImage, apiConfigs);
    expect(out).toContain('srcSet="');
    expect(out).toContain('width=640');
    expect(out).toContain('quality=80');
    expect(out).toContain('format=webp');
    expect(out).toContain('token=secret123');
    expect(out).toContain('640w');
  });

  it('bypasses signed remote image URLs without attaching transformed srcSet', () => {
    const pageWithSignedImage = `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root">
      <img src="https://cms.example.com/assets/img.jpg?X-Amz-Signature=abcdef123456" style={{ width: '800px' }} />
    </div>
  );
}
`;
    const apiConfigs: Record<string, ApiCollectionConfig> = {
      banner: {
        slug: 'banner',
        name: 'Banner',
        provider: 'directus',
        method: 'GET',
        headers: {},
        url: 'https://cms.example.com/items/banner',
        imageOptimization: {
          enabled: true,
          engine: 'directus',
        },
      },
    };

    const out = injectResponsiveImageSrcSets(pageWithSignedImage, apiConfigs);
    expect(out).not.toContain('width=640');
  });
});

describe('On-demand revalidation handler generation', () => {
  it('emits app/api/revalidate/route.ts when API collections exist', () => {
    const files = {
      '_meta/cms-api-config.json': JSON.stringify({
        mode: 'api',
        apiCollections: {
          posts: {
            slug: 'posts',
            name: 'Posts',
            url: 'https://cms.example.com/items/posts',
          },
        },
      }),
      'app/page.tsx': 'export default function Page() { return <div>Home</div>; }',
    };

    const prepared = prepareSiteFiles(files);
    expect(prepared['app/api/revalidate/route.ts']).toBeDefined();
    expect(prepared['app/api/revalidate/route.ts']).toContain('revalidatePath');
    expect(prepared['app/api/revalidate/route.ts']).toContain('revalidateTag');
    expect(prepared['app/api/revalidate/route.ts']).toContain('REVALIDATION_SECRET');
  });
});

describe('Differentiated link prefetching', () => {
  it('injects prefetch={true} on navigation links and intent prefetch on repeating collection items', () => {
    const navCode = `'use client';
import React from 'react';
import Link from 'next/link';

export default function Navbar() {
  return (
    <nav data-id="nav">
      <Link href="/about">About</Link>
    </nav>
  );
}
`;
    const repeaterCode = `'use client';
import React from 'react';
import Link from 'next/link';

export default function List() {
  return (
    <div data-id="root">
      <Link data-cms-nav="row" href="/posts/hello">Hello</Link>
    </div>
  );
}
`;
    const files = {
      'components/Navbar.tsx': navCode,
      'app/list/page.client.tsx': repeaterCode,
    };

    const prepared = prepareSiteFiles(files);
    expect(prepared['components/Navbar.tsx']).toContain('prefetch={true}');
    expect(prepared['app/list/page.client.tsx']).toContain('router.prefetch');
  });

  it('honors explicit data-prefetch choices: off, viewport, intent', () => {
    const customCode = `'use client';
import React from 'react';
import Link from 'next/link';

export default function Page() {
  return (
    <div data-id="root">
      <Link data-prefetch="off" href="/page1">Disabled</Link>
      <Link data-prefetch="viewport" href="/page2">Eager</Link>
      <Link data-prefetch="intent" href="/page3">Intent</Link>
    </div>
  );
}
`;
    const files = {
      'app/custom/page.client.tsx': customCode,
    };

    const prepared = prepareSiteFiles(files);
    const out = prepared['app/custom/page.client.tsx'];
    expect(out).toContain('data-prefetch="off"');
    expect(out).toContain('prefetch={false}');
    expect(out).toContain('data-prefetch="viewport"');
    expect(out).toContain('prefetch={true}');
    expect(out).toContain('data-prefetch="intent"');
    expect(out).toContain('router.prefetch');
  });

  it('honors responsive data-prefetch overrides across breakpoints', () => {
    const customCode = `'use client';
import React from 'react';
import Link from 'next/link';

export default function Page() {
  return (
    <div data-id="root">
      <Link data-prefetch="intent" data-prefetch-tablet="viewport" data-prefetch-mobile="viewport" href="/page1">Responsive Link</Link>
    </div>
  );
}
`;
    const files = {
      'app/custom/page.client.tsx': customCode,
    };

    const prepared = prepareSiteFiles(files);
    const out = prepared['app/custom/page.client.tsx'];
    expect(out).toContain('data-prefetch="intent"');
    expect(out).toContain('data-prefetch-tablet="viewport"');
    expect(out).toContain('data-prefetch-mobile="viewport"');
    expect(out).toContain('prefetch={false}');
    expect(out).toContain('router.prefetch');
  });
});

