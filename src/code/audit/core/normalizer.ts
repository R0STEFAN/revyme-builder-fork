// src/code/audit/core/normalizer.ts
// Finding deduplication, severity sorting, stable ID generation, and scoring.

import type {
  AuditFinding,
  AuditLocation,
  AuditScores,
  AuditSeverity,
  AuditScope,
  AuditSummary,
} from './types';
import { AUDIT_RULES } from './registry';

/**
 * Generate a deterministic, URL-safe unique finding ID.
 */
export function generateFindingId(
  scope: AuditScope,
  ruleId: string,
  location: AuditLocation
): string {
  const page = (location.pagePath || '').replace(/^\/+/, '').replace(/\//g, '_') || 'root';
  const node = location.nodeId ? `_${location.nodeId}` : '';
  const prop = location.propName ? `_${location.propName}` : '';
  const tag = location.tag ? `_${location.tag}` : '';
  return `${scope}/${ruleId}/${page}${node}${tag}${prop}`;
}

/**
 * Derive a clean, user-friendly URL route from a project file path.
 * e.g. app/(main)/blog/page.client.tsx -> /blog
 *      app/page.client.tsx -> /
 *      app/pricing/page.tsx -> /pricing
 */
export function computeCleanRoute(pagePath?: string): string {
  if (!pagePath) return '/';
  if (pagePath.includes('layout.tsx') || pagePath.includes('LayoutClient.tsx')) {
    return 'Root Layout';
  }
  if (pagePath.startsWith('app/')) {
    const slug = pagePath
      .replace(/^app\//, '')
      .replace(/^\[lang\]\/?/, '')
      .replace(/\(.+?\)\//g, '')
      .replace(/\/page\.client\.tsx$/, '')
      .replace(/page\.client\.tsx$/, '')
      .replace(/\/page\.tsx$/, '')
      .replace(/page\.tsx$/, '');
    return slug ? (slug.startsWith('/') ? slug : `/${slug}`) : '/';
  }
  if (pagePath.startsWith('components/')) {
    return `Component: ${pagePath.replace(/^components\//, '').replace(/\.tsx$/, '')}`;
  }
  return pagePath;
}

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Deduplicate findings, ensure canonical metadata from registry if missing,
 * and sort by severity (error -> warning -> info).
 */
export function normalizeFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  const normalized: AuditFinding[] = [];

  for (const f of findings) {
    const canonicalRule = AUDIT_RULES[f.ruleId];
    const scope = f.scope || canonicalRule?.scope || 'accessibility';
    const severity = f.severity || canonicalRule?.severity || 'warning';
    const id = f.id || generateFindingId(scope, f.ruleId, f.location);

    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    normalized.push({
      ...f,
      id,
      scope,
      severity,
      title: f.title || canonicalRule?.title || f.ruleId,
      explanation: f.explanation || canonicalRule?.explanation || '',
      remediation: f.remediation || canonicalRule?.remediation || '',
      documentationUrl: f.documentationUrl || canonicalRule?.documentationUrl,
      canAutoFix: typeof f.canAutoFix === 'boolean' ? f.canAutoFix : (canonicalRule?.canAutoFix ?? false),
      location: {
        ...f.location,
        route: f.location.route || computeCleanRoute(f.location.pagePath),
      },
    });
  }

  // Sort by severity first, then by scope, then ruleId
  normalized.sort((a, b) => {
    const sA = SEVERITY_ORDER[a.severity] ?? 99;
    const sB = SEVERITY_ORDER[b.severity] ?? 99;
    if (sA !== sB) return sA - sB;
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.ruleId.localeCompare(b.ruleId);
  });

  return normalized;
}

/**
 * Calculate scores and summary based on findings and optional external scores (e.g. from Lighthouse).
 */
export function calculateAuditSummary(
  findings: AuditFinding[],
  externalScores?: Partial<AuditScores>
): AuditSummary {
  const bySeverity: Record<AuditSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };

  const byScope: Record<AuditScope, number> = {
    accessibility: 0,
    seo: 0,
    performance: 0,
    security: 0,
    'clean-code': 0,
  };

  // Count unique audited pages/routes to normalize site-wide scores
  const auditedPages = new Set<string>();
  for (const f of findings) {
    const p = f.location.route || f.location.pagePath;
    if (p) auditedPages.add(p);
  }
  const pageCount = Math.max(1, auditedPages.size);

  // Base score counters
  let a11yDeduction = 0;
  let seoDeduction = 0;
  let perfDeduction = 0;
  let bestPracticesDeduction = 0;

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byScope[f.scope] = (byScope[f.scope] || 0) + 1;

    const penalty = f.severity === 'error' ? 20 : f.severity === 'warning' ? 8 : 2;

    switch (f.scope) {
      case 'accessibility':
        a11yDeduction += penalty;
        break;
      case 'seo':
        seoDeduction += penalty;
        break;
      case 'performance':
        perfDeduction += penalty;
        break;
      case 'security':
      case 'clean-code':
        bestPracticesDeduction += penalty;
        break;
    }
  }

  // Normalize site-wide deductions by the number of audited pages (average health score across pages)
  const normA11y = Math.round(a11yDeduction / pageCount);
  const normSeo = Math.round(seoDeduction / pageCount);
  const normPerf = Math.round(perfDeduction / pageCount);
  const normBestPractices = Math.round(bestPracticesDeduction / pageCount);

  const scores: AuditScores = {
    accessibility: Math.max(0, Math.min(100, (externalScores?.accessibility ?? 100) - normA11y)),
    seo: Math.max(0, Math.min(100, (externalScores?.seo ?? 100) - normSeo)),
    performance: Math.max(0, Math.min(100, (externalScores?.performance ?? 100) - normPerf)),
    bestPractices: Math.max(0, Math.min(100, (externalScores?.bestPractices ?? 100) - normBestPractices)),
  };

  return {
    total: findings.length,
    bySeverity,
    byScope,
    scores,
  };
}
