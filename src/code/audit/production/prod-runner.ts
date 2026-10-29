// src/code/audit/production/prod-runner.ts
// Production audit runner orchestrating raw SSR HTML analysis and Lighthouse Core API.

import type { AuditFinding, AuditResult, AuditScores, RunAuditOptions } from '../core/types';
import { normalizeFindings, calculateAuditSummary, computeCleanRoute } from '../core/normalizer';
import { auditRawServerHtml, fetchServerResource } from './ssr-fetcher';
import { runLighthouseAudit } from './lighthouse-runner';
import { trace } from '@/shared/debug-trace';

export interface ProductionAuditOptions extends RunAuditOptions {
  baseUrl?: string;
  route?: string;
  runLighthouse?: boolean;
}

export async function runProductionAudit(
  options: ProductionAuditOptions
): Promise<AuditResult & { lighthouseScores?: AuditScores }> {
  const baseUrl = options.baseUrl || 'http://localhost:3000';
  const cleanBase = baseUrl.replace(/\/+$/, '');
  trace.fn('runProductionAudit', { baseUrl });

  const rawFindings: AuditFinding[] = [];

  // 1. Discover routes from live sitemap.xml
  const sitemapRoutes: string[] = [];
  try {
    const sitemapRes = await fetchServerResource(`${cleanBase}/sitemap.xml`);
    if (sitemapRes.ok && sitemapRes.status === 200) {
      const matches = Array.from(sitemapRes.text.matchAll(/<loc>(.*?)<\/loc>/g)).map((m) => m[1]);
      for (const urlStr of matches) {
        try {
          const u = new URL(urlStr);
          if (!sitemapRoutes.includes(u.pathname)) {
            sitemapRoutes.push(u.pathname);
          }
        } catch {}
      }
    }
  } catch {}

  const requestedRaw = options.route || options.pagePath;
  let cleanR = requestedRaw ? (requestedRaw.startsWith('app/') ? computeCleanRoute(requestedRaw) : requestedRaw) : undefined;

  // Resolve dynamic bracketed routes (e.g. /category/[category] -> /category/tech) using live sitemap URLs
  if (cleanR && cleanR.includes('[')) {
    const pattern = new RegExp(
      "^(/([a-z]{2}(-[A-Z]{2})?))?" + cleanR.replace(/\[.*?\]/g, "[^/]+") + "$"
    );
    const matched = sitemapRoutes.find((r) => pattern.test(r));
    if (matched) {
      cleanR = matched;
    }
  }

  let routesToAudit: string[] = [];

  if (cleanR) {
    routesToAudit = [cleanR];
  } else if (sitemapRoutes.length > 0) {
    routesToAudit = [...sitemapRoutes];
  } else {
    // 2. Fallback to fileMap routes if sitemap routes weren't found
    if (options.fileMap) {
      for (const p of Object.keys(options.fileMap)) {
        if (p.startsWith('app/') && (p.endsWith('page.tsx') || p.endsWith('page.client.tsx'))) {
          const r = computeCleanRoute(p);
          if (!routesToAudit.includes(r)) {
            routesToAudit.push(r);
          }
        }
      }
    }

    if (routesToAudit.length === 0) {
      routesToAudit = ['/'];
    }
  }

  // Audit up to 15 key routes in parallel
  const routes = routesToAudit.slice(0, 15);
  trace.action('runProductionAudit:routes', { count: routes.length, routes });

  const routeResults = await Promise.all(
    routes.map((r, idx) => {
      let pagePath = options.pagePath || r;
      if (!options.pagePath && options.fileMap) {
        for (const p of Object.keys(options.fileMap)) {
          if (p.startsWith('app/') && (p.endsWith('page.tsx') || p.endsWith('page.client.tsx'))) {
            const clean = computeCleanRoute(p);
            if (clean === r) {
              pagePath = p;
              break;
            }
            if (clean.includes('[')) {
              const pattern = new RegExp("^(/([a-z]{2}(-[A-Z]{2})?))?" + clean.replace(/\[.*?\]/g, "[^/]+") + "$");
              if (pattern.test(r)) {
                pagePath = p;
                break;
              }
            }
          }
        }
      }

      return auditRawServerHtml({
        baseUrl,
        route: r,
        pagePath,
        checkRobotsAndSitemap: idx === 0,
        checkSoft404: idx === 0,
      });
    })
  );

  for (const list of routeResults) {
    rawFindings.push(...list);
  }

  // 2. Lighthouse Core API (only in Node environments where chrome-launcher is available)
  let lighthouseScores: AuditScores | undefined = undefined;
  if (options.runLighthouse && typeof window === 'undefined') {
    const primaryRoute = routes[0] || '/';
    const lhResult = await runLighthouseAudit(`${cleanBase}${primaryRoute.startsWith('/') ? primaryRoute : `/${primaryRoute}`}`);
    if (lhResult) {
      lighthouseScores = lhResult.scores;
    }
  }

  const normalized = normalizeFindings(rawFindings);
  const summary = calculateAuditSummary(normalized, lighthouseScores);

  return {
    summary,
    findings: normalized,
    skippedChecks: [],
    lighthouseScores,
  };
}
