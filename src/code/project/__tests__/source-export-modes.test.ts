import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import {
  prepareSiteFiles,
  stripGenerateStaticParams,
  detectPageCollectionQueries,
  injectCmsDatasetsIntoClientPage,
  orchestrateServerFetchForQueries,
} from '../source-export';
import { buildCmsDetailServerWrapper } from '../cms-seo';
import { saveApiCollection, setCmsMode } from '../cms-api-config';

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
