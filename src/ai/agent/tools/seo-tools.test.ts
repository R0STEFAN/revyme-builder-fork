import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultRegistry } from '@revyme/automation-core';
import type { Snapshot, OperationContext } from '@revyme/automation-core';
import {
  seoAuditOperation,
  seoSetRobotsOperation,
  seoConfigureLlmsOperation,
  seoSetSchemaOrgOperation,
  seoSyncSitemapOperation,
} from '@revyme/automation-core';

const mockContext: OperationContext = {
  createId: () => 'test-id',
  signal: new AbortController().signal,
  trace: () => {},
  adapters: {},
};

function makeSnapshot(files: Record<string, string>): Snapshot {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) {
    map.set(k, v);
  }
  return {
    scope: { projectId: 'test-project', branchId: 'main' },
    revision: 1,
    files: map,
    config: {},
  };
}

describe('MCP SEO Operations & Tools', () => {
  it('registers canonical operations and user-friendly aliases in defaultRegistry', () => {
    expect(defaultRegistry.get('seo.audit')).toBeDefined();
    expect(defaultRegistry.get('get_seo_audit')).toBeDefined();

    expect(defaultRegistry.get('seo.setRobots')).toBeDefined();
    expect(defaultRegistry.get('set_robots_config')).toBeDefined();

    expect(defaultRegistry.get('seo.configureLlms')).toBeDefined();
    expect(defaultRegistry.get('configure_llms_txt')).toBeDefined();

    expect(defaultRegistry.get('seo.setSchemaOrg')).toBeDefined();
    expect(defaultRegistry.get('set_page_schema_org')).toBeDefined();

    expect(defaultRegistry.get('seo.syncSitemap')).toBeDefined();
    expect(defaultRegistry.get('sync_sitemap')).toBeDefined();
  });

  describe('seo.audit', () => {
    it('audits site-wide metadata, robots, sitemap, llms, and page health', async () => {
      const snapshot = makeSnapshot({
        'app/layout.tsx': `export const metadata = { title: 'Test Site', description: 'This is a description with sufficient length for modern search engines.' };`,
        'app/page.client.tsx': `'use client'; export default function Page() { return <div>Home</div>; }`,
        'app/page.tsx': `import PageClient from './page.client'; export const metadata = { title: 'Home Page' }; export default function Page() { return <PageClient />; }`,
        'app/about/page.client.tsx': `'use client'; export default function AboutClient() { return <div>About</div>; }`,
        'app/about/page.tsx': `import PageClient from './page.client'; export const metadata = { title: 'About Us', description: 'About description' }; export default function Page() { return <PageClient />; }`,
      });

      const audit = await seoAuditOperation.execute(snapshot, {}, mockContext);
      expect(audit.site.title).toBe('Test Site');
      expect(audit.pageCount).toBe(2);
      expect(audit.pages.some((p: any) => p.page === 'app/about/page.client.tsx')).toBe(true);
      expect(audit.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('seo.setRobots', () => {
    it('generates app/robots.ts and _meta/robots.json with AI crawler policies', async () => {
      const snapshot = makeSnapshot({});
      const result = await seoSetRobotsOperation.execute(
        snapshot,
        {
          mode: 'allow_all',
          disallowPaths: ['/api/', '/admin/'],
          aiBots: { gptBot: false, claudeBot: true, perplexityBot: true, googleExtended: false },
        },
        mockContext,
      );

      expect(result.changes).toHaveLength(2);
      const robotsJson = result.changes.find((c) => c.path === '_meta/robots.json')!;
      const robotsTs = result.changes.find((c) => c.path === 'app/robots.ts')!;

      expect(robotsJson).toBeDefined();
      expect(robotsTs).toBeDefined();
      expect(robotsTs.content).toContain('GPTBot');
      expect(robotsTs.content).toContain('ClaudeBot');
      expect(robotsTs.content).toContain('PerplexityBot');
    });
  });

  describe('seo.configureLlms', () => {
    it('generates app/llms.txt/route.ts and app/llms-full.txt/route.ts', async () => {
      const snapshot = makeSnapshot({
        'app/layout.tsx': `export const metadata = { title: 'AI Ready Website', description: 'Built for autonomous agents' };`,
      });

      const result = await seoConfigureLlmsOperation.execute(
        snapshot,
        {
          enabled: true,
          siteTitle: 'AI Ready Website',
          notes: 'Strict factual answers only.',
          sections: [{ title: 'API Guidelines', content: 'Use JSON endpoints.' }],
        },
        mockContext,
      );

      expect(result.changes.length).toBe(3);
      const llmsRoute = result.changes.find((c) => c.path === 'app/llms.txt/route.ts')!;
      const llmsFull = result.changes.find((c) => c.path === 'app/llms-full.txt/route.ts')!;

      expect(llmsRoute.content).toContain('AI Ready Website');
      expect(llmsRoute.content).toContain('## API Guidelines');
      expect(llmsFull.content).toContain('AI Ready Website');
    });
  });

  describe('seo.setSchemaOrg', () => {
    it('attaches Schema.org JSON-LD to standard pages', async () => {
      const snapshot = makeSnapshot({
        'app/about/page.client.tsx': `'use client'; export default function About() { return <div>About</div>; }`,
        'app/about/page.tsx': `import PageClient from './page.client'; export const metadata = { title: 'About Us' }; export default function Page() { return <PageClient />; }`,
      });

      const result = await seoSetSchemaOrgOperation.execute(
        snapshot,
        {
          page: 'about',
          schemaType: 'Organization',
          staticValues: { name: 'Acme Corp', url: 'https://example.com' },
        },
        mockContext,
      );

      expect(result.serverPath).toBe('app/about/page.tsx');
      expect(result.changes).toHaveLength(1);
      const updatedCode = result.changes[0].content;
      expect(updatedCode).toContain('application/ld+json');
      expect(updatedCode).toContain('Organization');
      expect(updatedCode).toContain('Acme Corp');
    });

    it('attaches Schema.org with fx expressions to CMS detail pages', async () => {
      const snapshot = makeSnapshot({
        'app/blog/[slug]/page.client.tsx': `// @cmsPage {"kind":"detail","collection":"posts"}\n'use client'; export default function PostClient({ item }: any) { return <div>{item.title}</div>; }`,
        'app/blog/[slug]/page.tsx': `import PageClient from './page.client';\nexport default function Page({ params }: any) { return <PageClient />; }`,
        'cms/posts.json': JSON.stringify([{ slug: 'hello', title: 'Hello World', cover: { url: 'https://img.png' } }]),
      });

      const result = await seoSetSchemaOrgOperation.execute(
        snapshot,
        {
          page: 'app/blog/[slug]',
          schemaType: 'Article',
          expressions: { headline: 'item.title', image: 'item.cover.url' },
        },
        mockContext,
      );

      expect(result.serverPath).toBe('app/blog/[slug]/page.tsx');
      const updatedCode = result.changes[0].content;
      expect(updatedCode).toContain('application/ld+json');
      expect(updatedCode).toContain('Article');
      expect(updatedCode).toContain('item.title');
    });
  });

  describe('seo.syncSitemap', () => {
    it('regenerates app/sitemap.ts discovering all static routes and CMS collections', async () => {
      const snapshot = makeSnapshot({
        'app/page.tsx': `export default function Page() { return <div>Home</div>; }`,
        'app/contact/page.tsx': `export default function Contact() { return <div>Contact</div>; }`,
        'app/blog/[slug]/page.tsx': `import posts from '@/cms/posts.json'; export default function Blog() { return <div>Blog</div>; }`,
        'cms/posts.json': JSON.stringify([{ slug: 'first-post', title: 'First Post' }]),
      });

      const result = await seoSyncSitemapOperation.execute(snapshot, {}, mockContext);
      expect(result.sitemapPath).toBe('app/sitemap.ts');
      const sitemapCode = result.changes[0].content;
      expect(sitemapCode).toContain("import type { MetadataRoute } from 'next';");
      expect(sitemapCode).toContain('${baseUrl}/contact');
      expect(sitemapCode).toContain('${baseUrl}/blog/');
    });
  });
});
