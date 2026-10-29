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
  includeAlternates?: boolean;
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
    defaultLocale = 'en',
    includeAlternates = false,
  } = input;

  const defaultLoc = defaultLocale || 'en';
  const otherLocales = locales.filter((l) => l && l !== defaultLoc);

  const imports: string[] = [
    "import type { MetadataRoute } from 'next';",
    "import { headers } from 'next/headers';",
  ];
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
  const returnArrays: string[] = ['...staticUrls'];

  for (let i = 0; i < cmsCollections.length; i++) {
    const col = cmsCollections[i];
    const baseVar = `${toValidIdentifier(col.collection)}Items`;
    const isDup = cmsCollections.filter((c) => c.collection === col.collection).length > 1;
    const listVar = isDup ? `${baseVar}List_${i}` : `${baseVar}List`;
    const urlsVar = isDup ? `${baseVar}Urls_${i}` : `${baseVar}Urls`;

    returnArrays.push(`...${urlsVar}`);

    const prefix = col.routePrefix.replace(/\/+$/, '');
    const priority = col.priority ?? 0.7;
    const freq = col.changeFrequency ? `'${col.changeFrequency}'` : "'weekly'";

    let alternatesExpr = '';
    let otherPushSnippets = '';
    if (includeAlternates && otherLocales.length > 0) {
      const langs = [`${JSON.stringify(defaultLoc)}: \`\${baseUrl}${prefix}/\${encodeURIComponent(String(slug))}\``];
      for (const loc of otherLocales) {
        langs.push(`${JSON.stringify(loc)}: \`\${baseUrl}/${loc}${prefix}/\${encodeURIComponent(String(slug))}\``);
      }
      alternatesExpr = `,\n      alternates: {\n        languages: { ${langs.join(', ')} },\n      }`;
    }

    if (otherLocales.length > 0) {
      otherPushSnippets = otherLocales
        .map(
          (loc) => `
    ${urlsVar}.push({
      url: \`\${baseUrl}/${loc}${prefix}/\${encodeURIComponent(String(slug))}\`,
      lastModified: dateVal ? new Date(dateVal) : new Date(),
      changeFrequency: ${freq},
      priority: ${priority}${alternatesExpr}
    });`,
        )
        .join('');
    }

    if (!col.apiConfig?.endpoint) {
      collectionProcessors.push(`
  // CMS Collection: ${col.collection} (${col.routePrefix})
  const ${listVar} = Array.isArray(${baseVar}) ? ${baseVar} : [];
  const ${urlsVar}: MetadataRoute.Sitemap = [];
  for (const item of ${listVar}) {
    if (!item || item._status === 'draft' || item.noindex === true) continue;
    const slug = item.${col.slugField || 'slug'} || item.slug || item._slug || item.id;
    if (!slug) continue;
    const dateVal = item.${col.lastModifiedField || '_updatedAt'} || item._createdAt || item.date;
    ${urlsVar}.push({
      url: \`\${baseUrl}${prefix}/\${encodeURIComponent(String(slug))}\`,
      lastModified: dateVal ? new Date(dateVal) : new Date(),
      changeFrequency: ${freq},
      priority: ${priority}${alternatesExpr}
    });${otherPushSnippets}
  }
`);
    } else {
      // API collection with server-side fetch
      const headers = JSON.stringify(col.apiConfig.headers || {});
      const endpoint = col.apiConfig.endpoint;

      collectionProcessors.push(`
  // API CMS Collection: ${col.collection} (${col.routePrefix})
  const ${urlsVar}: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(${JSON.stringify(endpoint)}, {
      headers: ${headers},
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const json = await res.json();
      const items = Array.isArray(json) ? json : (json?.data || json?.items || []);
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item || item._status === 'draft' || item.noindex === true) continue;
          const slug = item.${col.slugField || 'slug'} || item.slug || item._slug || item.id;
          if (!slug) continue;
          const dateVal = item.${col.lastModifiedField || '_updatedAt'} || item.date;
          ${urlsVar}.push({
            url: \`\${baseUrl}${prefix}/\${encodeURIComponent(String(slug))}\`,
            lastModified: dateVal ? new Date(dateVal) : new Date(),
            changeFrequency: ${freq},
            priority: ${priority}${alternatesExpr}
          });${otherPushSnippets}
        }
      }
    }
  } catch (err) {
    // Graceful fallback on network error during sitemap build
  }
`);
    }
  }

  // Static routes literal
  const staticItems: string[] = [];
  for (const r of staticRoutes) {
    const path = r.url.startsWith('/') ? r.url : `/${r.url}`;
    const cleanPath = path === '/' ? '' : path;
    const freq = r.changeFrequency ? `'${r.changeFrequency}'` : "'daily'";
    const priority = r.priority !== undefined ? r.priority : path === '/' ? 1.0 : 0.8;

    let alternatesSnippet = '';
    if (includeAlternates && otherLocales.length > 0) {
      const langs = [`${JSON.stringify(defaultLoc)}: \`\${baseUrl}${cleanPath || '/'}\``];
      for (const loc of otherLocales) {
        langs.push(`${JSON.stringify(loc)}: \`\${baseUrl}/${loc}${cleanPath}\``);
      }
      alternatesSnippet = `,\n      alternates: {\n        languages: { ${langs.join(', ')} },\n      }`;
    }

    // Default locale entry
    staticItems.push(`    {
      url: \`\${baseUrl}${cleanPath}\`,
      lastModified: new Date(),
      changeFrequency: ${freq},
      priority: ${priority}${alternatesSnippet}
    }`);

    // Localized entries for non-default locales
    for (const loc of otherLocales) {
      staticItems.push(`    {
      url: \`\${baseUrl}/${loc}${cleanPath}\`,
      lastModified: new Date(),
      changeFrequency: ${freq},
      priority: ${priority}${alternatesSnippet}
    }`);
    }
  }

  const code = `${imports.join('\n')}

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let baseUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  try {
    const reqHeaders = await headers();
    const host = reqHeaders.get('x-forwarded-host') || reqHeaders.get('host') || '';
    const proto = reqHeaders.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    if (host) {
      baseUrl = \`\${proto}://\${host}\`;
    }
  } catch {}
  if (!baseUrl) {
    baseUrl = 'http://localhost:3000';
  }
  baseUrl = baseUrl.replace(/\\/+$/, '');

  const staticUrls: MetadataRoute.Sitemap = [
${staticItems.join(',\n')}
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
