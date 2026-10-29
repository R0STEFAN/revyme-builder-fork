import { describe, it, expect } from 'vitest';
import { generateSitemapCode } from './sitemap-gen';
import { moduleParses } from './metadata-gen';

describe('sitemap-gen', () => {
  it('generates a valid sitemap for static routes', () => {
    const code = generateSitemapCode({
      staticRoutes: [
        { url: '/', priority: 1.0, changeFrequency: 'daily' },
        { url: '/about', priority: 0.8, changeFrequency: 'monthly' },
      ],
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain("import type { MetadataRoute } from 'next';");
    expect(code).toContain('export default async function sitemap()');
    expect(code).toContain('${baseUrl}/about');
  });

  it('imports local CMS collections and iterates over items filtering drafts and noindex', () => {
    const code = generateSitemapCode({
      staticRoutes: [{ url: '/' }],
      cmsCollections: [
        {
          collection: 'posts',
          routePrefix: '/blog',
          slugField: 'slug',
          lastModifiedField: 'date',
          priority: 0.7,
        },
      ],
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain("import postsItems from '@/cms/posts.json';");
    expect(code).toContain("item._status === 'draft'");
    expect(code).toContain('item.noindex === true');
    expect(code).toContain('${baseUrl}/blog/');
    expect(code).toContain('...postsItemsUrls');
    expect(code).toContain('return [...staticUrls, ...postsItemsUrls];');
  });

  it('generates localized entries and optional hreflang alternates for multilingual sites', () => {
    const code = generateSitemapCode({
      staticRoutes: [{ url: '/' }, { url: '/about' }],
      cmsCollections: [
        {
          collection: 'posts',
          routePrefix: '/blog',
          slugField: 'slug',
        },
      ],
      locales: ['uk', 'en'],
      defaultLocale: 'uk',
      includeAlternates: true,
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain('${baseUrl}');
    expect(code).toContain('${baseUrl}/en');
    expect(code).toContain('${baseUrl}/about');
    expect(code).toContain('${baseUrl}/en/about');
    expect(code).toContain('${baseUrl}/blog/');
    expect(code).toContain('${baseUrl}/en/blog/');
    expect(code).toContain('alternates: {');
    expect(code).toContain('"uk": `${baseUrl}');
    expect(code).toContain('"en": `${baseUrl}/en');
  });

  it('handles external API CMS collections with server-side fetch', () => {
    const code = generateSitemapCode({
      staticRoutes: [{ url: '/' }],
      cmsCollections: [
        {
          collection: 'products',
          routePrefix: '/shop',
          apiConfig: {
            endpoint: 'https://api.example.com/products',
            headers: { Authorization: 'Bearer test' },
          },
        },
      ],
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain('https://api.example.com/products');
    expect(code).toContain('revalidate: 3600');
    expect(code).toContain('...productsItemsUrls');
  });
});
