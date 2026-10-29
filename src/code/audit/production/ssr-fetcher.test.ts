// src/code/audit/production/ssr-fetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditRawServerHtml } from './ssr-fetcher';
import { runProductionAudit } from './prod-runner';

describe('Site Audit: Phase 4 Production SSR Fetcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects builder artifacts in production HTML (data-id, @canvas)', async () => {
    const dirtyHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>My Clean Page</title></head>
        <body>
          <main>
            <h1 data-id="title-1">Hello</h1>
            <div data-id="box-2" class="@canvas-element">Content</div>
          </main>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('robots.txt') || u.includes('sitemap.xml')) {
        return new Response('User-agent: *', { status: 200 });
      }
      return new Response(dirtyHtml, { status: 200 });
    });

    const findings = await auditRawServerHtml({
      baseUrl: 'http://localhost:3000',
      route: '/',
    });

    const ruleIds = findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('builder-artifacts-in-prod');
  });

  it('detects empty SSR body and missing metadata', async () => {
    const emptyHtml = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body></body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(emptyHtml, { status: 200 });
    });

    const findings = await auditRawServerHtml({
      baseUrl: 'http://localhost:3000',
      route: '/pricing',
      checkRobotsAndSitemap: false,
    });

    const ruleIds = findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('empty-ssr-body');
    expect(ruleIds).toContain('empty-page-title');
    expect(ruleIds).toContain('missing-page-description');
  });

  it('detects missing robots.txt and soft-404', async () => {
    const cleanHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Valid Title</title>
          <meta name="description" content="Valid meta description for tests." />
          <link rel="canonical" href="https://example.com/" />
        </head>
        <body>
          <main><h1>Valid Heading</h1><p>Body</p></main>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('robots.txt')) {
        return new Response('Not found', { status: 404 });
      }
      if (u.includes('__non_existent_page_probe_')) {
        return new Response(cleanHtml, { status: 200 }); // Soft 404 bug!
      }
      return new Response(cleanHtml, { status: 200 });
    });

    const findings = await auditRawServerHtml({
      baseUrl: 'http://localhost:3000',
      route: '/',
      checkRobotsAndSitemap: true,
      checkSoft404: true,
    });

    const ruleIds = findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('robots-txt-missing');
    expect(ruleIds).toContain('soft-404-detected');
  });

  it('resolves dynamic route templates like /category/[category] to live sitemap pages', async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>http://localhost:3000</loc></url>
        <url><loc>http://localhost:3000/category/tech</loc></url>
        <url><loc>http://localhost:3000/blog/my-post</loc></url>
      </urlset>`;

    const pageHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Tech Category</title>
          <meta name="description" content="Articles about tech." />
        </head>
        <body>
          <main><h1>Tech</h1></main>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('sitemap.xml')) {
        return new Response(sitemapXml, { status: 200 });
      }
      if (u.includes('/category/tech')) {
        return new Response(pageHtml, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const result = await runProductionAudit({
      baseUrl: 'http://localhost:3000',
      pagePath: 'app/(main)/category/[category]/page.client.tsx',
    });

    const ruleIds = result.findings.map((f) => f.ruleId);
    // Should NOT report server-unreachable or page-not-found because it resolved to /category/tech!
    expect(ruleIds).not.toContain('server-unreachable');
    expect(ruleIds).not.toContain('page-not-found');
  });
});
