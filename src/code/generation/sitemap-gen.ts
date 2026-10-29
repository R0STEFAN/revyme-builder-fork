// sitemap-gen.ts — Next.js App Router sitemap code generator (app/sitemap.ts).
// Supports static routes, Local JSON collections, Headless API collections, i18n locales, and noindex filtering.

import { moduleParses } from './metadata-gen';

export interface SitemapRoute {
  url: string; // e.g. '/', '/about', '/blog'
  lastModified?: string | Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export interface SitemapCmsCollection {
  collection: string; // e.g. 'posts', 'categories'
  routePrefix: string; // e.g. '/blog', '/category'
  paramName?: string; // default 'slug'
  slugField?: string; // default '_slug'
  lastModifiedField?: string; // e.g. '_updatedAt'
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  apiConfig?: {
    endpoint?: string;
    itemsPath?: string;
    headers?: Record<string, string>;
  } | null;
}

export interface SitemapGeneratorInput {
  baseUrl?: string;
  staticRoutes?: SitemapRoute[];
  cmsCollections?: SitemapCmsCollection[];
  locales?: string[];
  defaultLocale?: string;
}

function toValidIdentifier(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  return /^[0-9]/.test(clean) ? `cms_${clean}` : clean;
}

/**
 * Generate Next.js App Router `app/sitemap.ts` source code.
 */
export function generateSitemapCode(input: SitemapGeneratorInput): string {
  const {
    staticRoutes = [{ url: '/', priority: 1.0, changeFrequency: 'daily' }],
    cmsCollections = [],
    locales = [],
  } = input;

  const imports: string[] = ["import type { MetadataRoute } from 'next';"];
  const collectionProcessors: string[] = [];
  const importedCollections = new Set<string>();

  // Deduplicate imports for local collections
  for (const col of cmsCollections) {
    if (!col.apiConfig?.endpoint && !importedCollections.has(col.collection)) {
      importedCollections.add(col.collection);
      imports.push(`import ${toValidIdentifier(col.collection)}Items from '@/cms/${col.collection}.json';`);
    }
  }

  // Generate processors for each collection route
  const returnArrays: string[] = ['staticUrls'];

  for (let i = 0; i < cmsCollections.length; i++) {
    const col = cmsCollections[i];
    const baseVar = `${toValidIdentifier(col.collection)}Items`;
    const isDup = cmsCollections.filter((c) => c.collection === col.collection).length > 1;
    const listVar = isDup ? `${baseVar}List_${i}` : `${baseVar}List`;
    const urlsVar = isDup ? `${baseVar}Urls_${i}` : `${baseVar}Urls`;

    returnArrays.push(`...${urlsVar}`);

    if (!col.apiConfig?.endpoint) {
      const prefix = col.routePrefix.replace(/\/+$/, '');
      const priority = col.priority ?? 0.7;
      const freq = col.changeFrequency ? `'${col.changeFrequency}'` : "'weekly'";

      collectionProcessors.push(`
  // CMS Collection: ${col.collection} (${col.routePrefix})
  const ${listVar} = Array.isArray(${baseVar}) ? ${baseVar} : [];
  const ${urlsVar}: MetadataRoute.Sitemap = ${listVar}
    .filter((item: any) => item && item._status !== 'draft' && item.noindex !== true)
    .map((item: any) => {
      const slug = item.${col.slugField || '_slug'} || item.slug || item.id;
      if (!slug) return null;
      const dateVal = item.${col.lastModifiedField || '_updatedAt'} || item._createdAt || item.date;
      return {
        url: \`\${baseUrl}${prefix}/\${encodeURIComponent(String(slug))}\`,
        lastModified: dateVal ? new Date(dateVal) : new Date(),
        changeFrequency: ${freq},
        priority: ${priority},
      };
    })
    .filter(Boolean) as MetadataRoute.Sitemap;
`);
    } else {
      // API collection with server-side fetch
      const prefix = col.routePrefix.replace(/\/+$/, '');
      const priority = col.priority ?? 0.7;
      const freq = col.changeFrequency ? `'${col.changeFrequency}'` : "'weekly'";
      const headers = JSON.stringify(col.apiConfig.headers || {});
      const endpoint = col.apiConfig.endpoint;

      collectionProcessors.push(`
  // API CMS Collection: ${col.collection} (${col.routePrefix})
  let ${urlsVar}: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(${JSON.stringify(endpoint)}, {
      headers: ${headers},
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const json = await res.json();
      const items = Array.isArray(json) ? json : (json?.data || json?.items || []);
      if (Array.isArray(items)) {
        ${urlsVar} = items
          .filter((item: any) => item && item._status !== 'draft' && item.noindex !== true)
          .map((item: any) => {
            const slug = item.${col.slugField || '_slug'} || item.slug || item.id;
            if (!slug) return null;
            const dateVal = item.${col.lastModifiedField || '_updatedAt'} || item.date;
            return {
              url: \`\${baseUrl}${prefix}/\${encodeURIComponent(String(slug))}\`,
              lastModified: dateVal ? new Date(dateVal) : new Date(),
              changeFrequency: ${freq},
              priority: ${priority},
            };
          })
          .filter(Boolean) as MetadataRoute.Sitemap;
      }
    }
  } catch (err) {
    // Graceful fallback on network error during sitemap build
  }
`);
    }
  }

  // Static routes literal
  const staticItems = staticRoutes.map((r) => {
    const path = r.url.startsWith('/') ? r.url : `/${r.url}`;
    const cleanPath = path === '/' ? '' : path;
    const freq = r.changeFrequency ? `'${r.changeFrequency}'` : "'daily'";
    const priority = r.priority !== undefined ? r.priority : path === '/' ? 1.0 : 0.8;
    return `    {
      url: \`\${baseUrl}${cleanPath}\`,
      lastModified: new Date(),
      changeFrequency: ${freq},
      priority: ${priority},
    }`;
  }).join(',\n');

  const code = `${imports.join('\n')}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rawBase = process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com';
  const baseUrl = rawBase.replace(/\\/+$/, '');

  const staticUrls: MetadataRoute.Sitemap = [
${staticItems}
  ];
${collectionProcessors.join('\n')}
  return [${returnArrays.join(', ')}];
}
`;

  if (!moduleParses(code)) {
    throw new Error('generateSitemapCode: generated sitemap code failed to parse with Babel.');
  }

  return code;
}
