// src/code/audit/production/ssr-fetcher.ts
// High-speed cheerio/fetch raw HTML production auditor (< 100ms) with CORS-free proxy fallback.

import * as cheerio from 'cheerio';
import type { AuditFinding } from '../core/types';
import { generateFindingId } from '../core/normalizer';
import { trace } from '@/shared/debug-trace';

export interface SsrAuditOptions {
  baseUrl: string;
  route: string;
  pagePath?: string;
  checkRobotsAndSitemap?: boolean;
  checkSoft404?: boolean;
}

export interface FetchResourceResult {
  status: number;
  text: string;
  ok: boolean;
  error?: string;
}

/**
 * Fetch a remote resource with transparent fallback to Revyme's /api/proxy when running
 * in the browser across different origins (e.g. builder on :3333 fetching live server on :3000).
 */
export async function fetchServerResource(targetUrl: string): Promise<FetchResourceResult> {
  const isBrowser = typeof window !== 'undefined';
  const isCrossOrigin = isBrowser && !targetUrl.startsWith(window.location.origin);

  if (isCrossOrigin) {
    try {
      const proxyRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, method: 'GET' }),
      });
      const text = await proxyRes.text();
      const isFailed = proxyRes.status === 502 || text.includes('"fetch failed"');
      return {
        status: isFailed ? 502 : proxyRes.status,
        text,
        ok: proxyRes.ok && !isFailed,
        error: isFailed ? 'Server unreachable' : undefined,
      };
    } catch (err: any) {
      trace.error('fetchServerResource:proxyFailed', { targetUrl, err: err?.message });
      return { status: 0, text: '', ok: false, error: err?.message || 'Proxy error' };
    }
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
    });
    const text = await res.text();
    return { status: res.status, text, ok: res.ok };
  } catch (err: any) {
    trace.error('fetchServerResource:directFailed', { targetUrl, err: err?.message });
    return { status: 0, text: '', ok: false, error: err?.message || 'Network fetch failed' };
  }
}

export async function auditRawServerHtml(
  options: SsrAuditOptions
): Promise<AuditFinding[]> {
  const { baseUrl, route } = options;
  const pagePath = options.pagePath || route;
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanRoute = route.startsWith('/') ? route : `/${route}`;
  const targetUrl = `${cleanBase}${cleanRoute}`;

  trace.fn('auditRawServerHtml', { targetUrl, pagePath });
  const findings: AuditFinding[] = [];

  // Fetch the SSR HTML through proxy or direct
  const fetchRes = await fetchServerResource(targetUrl);

  // ─── 0. Unreachable Server / HTTP Error Check ────────────────────────────
  if (fetchRes.status === 0 || fetchRes.status >= 500) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('performance', 'server-unreachable', loc),
      scope: 'performance',
      ruleId: 'server-unreachable',
      severity: 'error',
      title: 'Production server is unreachable',
      message: `Could not connect to live server at ${targetUrl} (HTTP ${fetchRes.status || 'Connection Refused'}). Ensure Next.js is running.`,
      explanation: 'Live audit requires an active web server responding to HTTP requests to inspect rendered HTML and headers.',
      remediation: `Start the production or dev server (e.g. npm run dev / next start) on ${cleanBase}.`,
      location: loc,
      canAutoFix: false,
    });
    return findings;
  }

  if (fetchRes.status === 404) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('performance', 'page-not-found', loc),
      scope: 'performance',
      ruleId: 'page-not-found',
      severity: 'error',
      title: 'Page returned HTTP 404 (Not Found)',
      message: `Live server returned HTTP 404 for ${targetUrl}. Route does not exist on server.`,
      explanation: 'Every published route must respond with HTTP 200.',
      remediation: `Verify export and routing configuration for ${route}.`,
      location: loc,
      canAutoFix: false,
    });
    return findings;
  }

  if (!fetchRes.ok) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('performance', 'http-error', loc),
      scope: 'performance',
      ruleId: 'http-error',
      severity: 'error',
      title: `Server error (HTTP ${fetchRes.status})`,
      message: `Request to ${targetUrl} failed with HTTP ${fetchRes.status}.`,
      explanation: 'Live audit expects pages to respond with HTTP 200.',
      remediation: 'Check server logs for errors.',
      location: loc,
      canAutoFix: false,
    });
    return findings;
  }

  const rawHtml = fetchRes.text;
  const $ = cheerio.load(rawHtml);

  // ─── 1. Builder Artifacts in Production ───────────────────────────────────
  // Revyme elements legitimately use `data-id` for AST mapping and `data-revyme-pt-stage` for page transitions.
  // Real leaked builder artifacts are editor overlays, drag previews, dropzones, or @canvas markers.
  const hasLeakedEditorArtifacts =
    rawHtml.includes('@canvas') ||
    rawHtml.includes('data-canvas-selected') ||
    rawHtml.includes('data-canvas-dropzone') ||
    rawHtml.includes('data-canvas-hovered') ||
    rawHtml.includes('__revyme_drag') ||
    rawHtml.includes('data-revyme-editor') ||
    rawHtml.includes('data-revyme-toolbar');

  if (hasLeakedEditorArtifacts) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('clean-code', 'builder-artifacts-in-prod', loc),
      scope: 'clean-code',
      ruleId: 'builder-artifacts-in-prod',
      severity: 'error',
      title: 'Builder artifacts present in production markup',
      message: 'Published server HTML contains internal attributes (editor overlays or drag placeholders).',
      explanation: 'Production HTML must be clean and unencumbered by builder internals.',
      remediation: 'Verify build-pipeline compiler transforms to ensure internal attributes are stripped.',
      location: loc,
      canAutoFix: false,
    });
  }

  // ─── 2. SSR Body Emptiness ────────────────────────────────────────────────
  const bodyText = $('body').text().trim();
  if (bodyText.length === 0) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('clean-code', 'empty-ssr-body', loc),
      scope: 'clean-code',
      ruleId: 'empty-ssr-body',
      severity: 'error',
      title: 'Server-side rendered body is empty',
      message: 'Page body yielded zero text during server rendering.',
      explanation: 'Search crawlers require pre-rendered HTML content for indexing.',
      remediation: 'Ensure components support server-side rendering and do not defer all rendering to client hooks.',
      location: loc,
      canAutoFix: false,
    });
  }

  // ─── 3. Head Metadata & SEO in Raw SSR ─────────────────────────────────────
  // Title
  const title = $('title').text().trim();
  if (!title) {
    const loc = { pagePath, route, propName: 'title' };
    findings.push({
      id: generateFindingId('seo', 'empty-page-title', loc),
      scope: 'seo',
      ruleId: 'empty-page-title',
      severity: 'error',
      title: 'Missing page title in server HTML',
      message: 'Document contains no non-empty <title> tag in server response.',
      explanation: 'Page title is a critical ranking factor and displays in browser tabs.',
      remediation: 'Set title in page metadata.',
      location: loc,
      canAutoFix: true,
    });
  } else if (title.length < 10) {
    const loc = { pagePath, route, propName: 'title' };
    findings.push({
      id: generateFindingId('seo', 'weak-page-title', loc),
      scope: 'seo',
      ruleId: 'weak-page-title',
      severity: 'warning',
      title: 'Page title is too brief in server HTML',
      message: `Title "${title}" is only ${title.length} characters (recommended: 30–60 characters).`,
      explanation: 'Short titles lack topical context and reduce search visibility.',
      remediation: 'Expand page title to be descriptive (30–60 characters).',
      location: loc,
      canAutoFix: false,
    });
  }

  // Meta Description
  const desc = $('meta[name="description"]').attr('content')?.trim();
  if (!desc) {
    const loc = { pagePath, route, propName: 'description' };
    findings.push({
      id: generateFindingId('seo', 'missing-page-description', loc),
      scope: 'seo',
      ruleId: 'missing-page-description',
      severity: 'warning',
      title: 'Missing meta description in server HTML',
      message: 'No meta[name="description"] tag found in server response.',
      explanation: 'Search engines display meta descriptions in search result snippets.',
      remediation: 'Set description in page metadata.',
      location: loc,
      canAutoFix: true,
    });
  } else if (desc.length < 50) {
    const loc = { pagePath, route, propName: 'description' };
    findings.push({
      id: generateFindingId('seo', 'weak-page-description', loc),
      scope: 'seo',
      ruleId: 'weak-page-description',
      severity: 'warning',
      title: 'Meta description is too short in server HTML',
      message: `Meta description is only ${desc.length} characters (recommended: 120–160 characters).`,
      explanation: 'Short descriptions provide insufficient context in search snippets.',
      remediation: 'Expand meta description to 120–160 characters.',
      location: loc,
      canAutoFix: false,
    });
  }

  // Canonical Link
  const canonical = $('link[rel="canonical"]').attr('href')?.trim();
  if (!canonical) {
    const loc = { pagePath, route, propName: 'canonical' };
    findings.push({
      id: generateFindingId('seo', 'missing-canonical', loc),
      scope: 'seo',
      ruleId: 'missing-canonical',
      severity: 'warning',
      title: 'Missing canonical link in server HTML',
      message: 'No link[rel="canonical"] found in server response.',
      explanation: 'Canonical URLs prevent duplicate content indexing.',
      remediation: 'Specify canonical URL in page metadata.',
      location: loc,
      canAutoFix: true,
    });
  }

  // OpenGraph Tags
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  if (!ogTitle) {
    const loc = { pagePath, route, propName: 'ogTitle' };
    findings.push({
      id: generateFindingId('seo', 'missing-og-title', loc),
      scope: 'seo',
      ruleId: 'missing-og-title',
      severity: 'warning',
      title: 'Missing og:title in server HTML',
      message: 'Document contains no meta[property="og:title"] in server response.',
      explanation: 'Social networks require og:title to generate link preview cards.',
      remediation: 'Add openGraph.title in page metadata.',
      location: loc,
      canAutoFix: true,
    });
  }

  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  if (!ogDesc) {
    const loc = { pagePath, route, propName: 'ogDescription' };
    findings.push({
      id: generateFindingId('seo', 'missing-og-description', loc),
      scope: 'seo',
      ruleId: 'missing-og-description',
      severity: 'warning',
      title: 'Missing og:description in server HTML',
      message: 'Document contains no meta[property="og:description"] in server response.',
      explanation: 'Social platforms display og:description in link share previews.',
      remediation: 'Add openGraph.description in page metadata.',
      location: loc,
      canAutoFix: true,
    });
  }

  const ogImage = $('meta[property="og:image"]').attr('content')?.trim();
  if (!ogImage) {
    const loc = { pagePath, route, propName: 'ogImage' };
    findings.push({
      id: generateFindingId('seo', 'missing-og-image', loc),
      scope: 'seo',
      ruleId: 'missing-og-image',
      severity: 'warning',
      title: 'Missing og:image preview in server HTML',
      message: 'Document contains no meta[property="og:image"] in server response.',
      explanation: 'Social share previews without images receive significantly lower engagement.',
      remediation: 'Specify openGraph.images in page metadata.',
      location: loc,
      canAutoFix: true,
    });
  }

  // ─── 4. Headings & Structure in Raw SSR ───────────────────────────────────
  const h1Elements = $('h1');
  if (h1Elements.length === 0) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('seo', 'missing-h1-heading', loc),
      scope: 'seo',
      ruleId: 'missing-h1-heading',
      severity: 'warning',
      title: 'Missing <h1> heading in server HTML',
      message: 'Document contains no <h1> heading tag.',
      explanation: 'An <h1> tag provides search engines and assistive technologies with the primary topic of the page.',
      remediation: 'Add a primary <h1> heading to the page content.',
      location: loc,
      canAutoFix: false,
    });
  } else if (h1Elements.length > 1) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('seo', 'multiple-h1-headings', loc),
      scope: 'seo',
      ruleId: 'multiple-h1-headings',
      severity: 'warning',
      title: `Multiple <h1> headings in server HTML (${h1Elements.length})`,
      message: `Page contains ${h1Elements.length} <h1> headings. Standard practice is to have exactly one <h1> per page.`,
      explanation: 'Multiple top-level headings dilute topical keyword hierarchy.',
      remediation: 'Keep one primary <h1> and change secondary headings to <h2>.',
      location: loc,
      canAutoFix: false,
    });
  }

  // ─── 5. Landmark check in Raw SSR ─────────────────────────────────────────
  if ($('main').length === 0) {
    const loc = { pagePath, route };
    findings.push({
      id: generateFindingId('accessibility', 'missing-main-landmark', loc),
      scope: 'accessibility',
      ruleId: 'missing-main-landmark',
      severity: 'warning',
      title: 'Missing <main> landmark in server HTML',
      message: 'Server HTML contains no <main> landmark tag.',
      explanation: 'Assistive technologies use the <main> landmark to identify primary page content.',
      remediation: 'Wrap page content within a <main> tag.',
      location: loc,
      canAutoFix: false,
    });
  }

  // ─── 6. Images missing alt attribute ──────────────────────────────────────
  $('img:not([alt])').each((i, el) => {
    const src = $(el).attr('src') || '';
    const loc = { pagePath, route, tag: 'img' };
    findings.push({
      id: generateFindingId('accessibility', 'missing-alt', loc) + `_${i}`,
      scope: 'accessibility',
      ruleId: 'missing-alt',
      severity: 'error',
      title: 'Missing image alt attribute in server HTML',
      message: `Image ${src ? `"${src.slice(0, 40)}..."` : ''} has no alt attribute.`,
      explanation: 'Screen readers cannot describe images without alt text.',
      remediation: 'Add an alt attribute describing the image or alt="" if decorative.',
      location: loc,
      canAutoFix: true,
    });
  });

  // ─── 7. Security: Links with target="_blank" without rel="noopener" ───────
  $('a[target="_blank"]:not([rel*="noopener"])').each((i, el) => {
    const href = $(el).attr('href') || '';
    const loc = { pagePath, route, tag: 'a' };
    findings.push({
      id: generateFindingId('security', 'target-blank-without-noopener', loc) + `_${i}`,
      scope: 'security',
      ruleId: 'target-blank-without-noopener',
      severity: 'warning',
      title: 'External link opens in new tab without rel="noopener"',
      message: `Link to "${href.slice(0, 40)}" opens in new tab without rel="noopener".`,
      explanation: 'Links opening in a new tab without rel="noopener" can expose the site to security vulnerabilities.',
      remediation: 'Add rel="noopener noreferrer" to external links.',
      location: loc,
      canAutoFix: true,
    });
  });

  // ─── 8. Robots.txt check ──────────────────────────────────────────────────
  if (options.checkRobotsAndSitemap) {
    try {
      const robotsRes = await fetchServerResource(`${cleanBase}/robots.txt`);
      if (robotsRes.status === 404) {
        const loc = { pagePath: '/robots.txt', route: '/robots.txt' };
        findings.push({
          id: generateFindingId('seo', 'robots-txt-missing', loc),
          scope: 'seo',
          ruleId: 'robots-txt-missing',
          severity: 'warning',
          title: 'Missing robots.txt route',
          message: 'Production server responded with 404 for /robots.txt.',
          explanation: 'A robots.txt file guides search engine crawlers on indexing policies.',
          remediation: 'Create app/robots.ts or public/robots.txt.',
          location: loc,
          canAutoFix: true,
        });
      }
    } catch {}

    // ─── 9. Sitemap.xml check ───────────────────────────────────────────────
    try {
      const sitemapRes = await fetchServerResource(`${cleanBase}/sitemap.xml`);
      if (sitemapRes.status === 404) {
        const loc = { pagePath: '/sitemap.xml', route: '/sitemap.xml' };
        findings.push({
          id: generateFindingId('seo', 'sitemap-xml-missing', loc),
          scope: 'seo',
          ruleId: 'sitemap-xml-missing',
          severity: 'warning',
          title: 'Missing sitemap.xml route',
          message: 'Production server responded with 404 for /sitemap.xml.',
          explanation: 'An XML sitemap assists search engines with intelligent site indexing.',
          remediation: 'Create app/sitemap.ts to generate an XML sitemap.',
          location: loc,
          canAutoFix: true,
        });
      }
    } catch {}
  }

  // ─── 10. Soft-404 Detection ───────────────────────────────────────────────
  if (options.checkSoft404) {
    try {
      const ghostRoute = `${cleanBase}/__non_existent_page_probe_${Date.now()}__`;
      const ghostRes = await fetchServerResource(ghostRoute);
      if (ghostRes.status === 200) {
        const loc = { pagePath: '/404', route: '/404' };
        findings.push({
          id: generateFindingId('seo', 'soft-404-detected', loc),
          scope: 'seo',
          ruleId: 'soft-404-detected',
          severity: 'error',
          title: 'Soft-404 route detected',
          message: 'Non-existent route returned HTTP 200 OK instead of HTTP 404 Not Found.',
          explanation: 'Returning HTTP 200 for missing pages causes search engines to index dead pages as real content.',
          remediation: 'Configure Next.js not-found.tsx to return true 404 status.',
          location: loc,
          canAutoFix: false,
        });
      }
    } catch {}
  }

  return findings;
}
