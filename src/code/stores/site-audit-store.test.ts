// src/code/stores/site-audit-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  auditResultAtom,
  auditTargetScopeAtom,
  auditPageFilterAtom,
  auditFilteredFindingsAtom,
  auditPagesListAtom,
  navigateToAuditFindingAtom,
  applyAuditQuickFixAtom,
} from './site-audit-store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { selectedIdsAtom } from './store';
import { projectFS } from '@/code/project/project-fs';
import type { AuditResult } from '@/code/audit/core/types';

describe('Site Audit Store', () => {
  let store: ReturnType<typeof createStore>;

  const mockResult: AuditResult = {
    summary: {
      total: 3,
      bySeverity: { error: 2, warning: 1, info: 0 },
      byScope: { accessibility: 2, seo: 1, performance: 0, security: 0, 'clean-code': 0 },
      scores: { accessibility: 70, seo: 90, performance: 100, bestPractices: 100 },
    },
    findings: [
      {
        id: 'accessibility/missing-alt/root_img1',
        scope: 'accessibility',
        ruleId: 'missing-alt',
        severity: 'error',
        title: 'Missing alt',
        message: 'No alt',
        explanation: 'Needs alt',
        remediation: 'Add alt',
        location: { pagePath: 'app/page.client.tsx', route: '/', nodeId: 'img-1' },
        canAutoFix: true,
      },
      {
        id: 'accessibility/skipped-heading-level/blog_h3',
        scope: 'accessibility',
        ruleId: 'skipped-heading-level',
        severity: 'error',
        title: 'Skipped heading',
        message: 'h1 to h3',
        explanation: 'Hierarchy broken',
        remediation: 'Change to h2',
        location: { pagePath: 'app/(main)/blog/page.client.tsx', route: '/blog', nodeId: 'blog-h3' },
        canAutoFix: true,
      },
      {
        id: 'seo/missing-page-description/blog',
        scope: 'seo',
        ruleId: 'missing-page-description',
        severity: 'warning',
        title: 'Missing description',
        message: 'No description',
        explanation: 'Add description',
        remediation: 'Add description',
        location: { pagePath: 'app/(main)/blog/page.client.tsx', route: '/blog' },
        canAutoFix: true,
      },
    ],
    skippedChecks: [],
  };

  beforeEach(() => {
    store = createStore();
    store.set(auditResultAtom, mockResult);
  });

  it('defaults target scope to project (analyzes entire site)', () => {
    expect(store.get(auditTargetScopeAtom)).toBe('project');
  });

  it('groups distinct pages in auditPagesListAtom with routes', () => {
    const pages = store.get(auditPagesListAtom);
    expect(pages).toHaveLength(2);
    expect(pages[0].route).toBe('/blog'); // 1 error + 1 warning = 2
    expect(pages[1].route).toBe('/');     // 1 error
  });

  it('filters findings by page filter', () => {
    store.set(auditPageFilterAtom, '/blog');
    const filtered = store.get(auditFilteredFindingsAtom);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((f) => f.location.route === '/blog')).toBe(true);
  });

  it('switches page and focuses node on navigateToAuditFindingAtom', () => {
    store.set(activeFilePathAtom, 'app/page.client.tsx');

    // Mock projectFS exists
    projectFS.writeFile('app/(main)/blog/page.client.tsx', 'export default function Blog() { return null; }');

    store.set(navigateToAuditFindingAtom, {
      pagePath: 'app/(main)/blog/page.client.tsx',
      nodeId: 'blog-h3',
      route: '/blog',
    });

    // Active file should switch to blog
    expect(store.get(activeFilePathAtom)).toBe('app/(main)/blog/page.client.tsx');
  });

  it('routes SEO metadata quick fix to server page.tsx if companion exists', () => {
    projectFS.writeFile('app/blog/page.client.tsx', 'export default function Client() { return null; }');
    projectFS.writeFile('app/blog/page.tsx', "import PageClient from './page.client';\nexport const metadata = {};\nexport default function Page() { return <PageClient />; }");

    const finding = mockResult.findings[2]; // SEO missing-page-description
    const blogFinding = {
      ...finding,
      location: { pagePath: 'app/blog/page.client.tsx', route: '/blog' },
    };

    store.set(applyAuditQuickFixAtom, blogFinding);

    // Should modify server file, not client file
    const serverCode = projectFS.readFile('app/blog/page.tsx');
    expect(serverCode).toContain('description:');
  });
});
