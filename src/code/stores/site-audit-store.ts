// src/code/stores/site-audit-store.ts
// Jotai atoms for in-editor audit state, filtering, execution, and quick fixes.

import { atom } from 'jotai';
import type {
  AuditFinding,
  AuditResult,
  AuditScope,
  AuditSeverity,
} from '@/code/audit/core/types';
import { executeAuditTool } from '@/code/audit/mcp/audit-tool';
import { applySingleFindingFix, applyAutoFixesToCode } from '@/code/audit/remediation/auto-fixer';
import { computeCleanRoute } from '@/code/audit/core/normalizer';
import { projectFS } from '@/code/project/project-fs';
import { modifyProjectFile } from '@/code/project/modify-file';
import {
  activeFilePathAtom,
  componentBreadcrumbAtom,
  switchActiveFile,
  getPageClientPath,
  getPageServerPath,
  isPageServerFile,
  isPageClientFile,
} from '@/code/project/active-file-store';
import {
  selectedSeoPageAtom,
  settingsSectionAtom,
  settingsOverlayOpenAtom,
} from '@/code/stores/website-settings-store';
import { nodesAtom, selectedIdsAtom, updatingFromCanvasAtom } from './store';
import { syncQueueCode, flushNow } from '@/code/mutation/mutation-queue';
import { findNodeRect } from '@/canvas/node-ops';
import { transformManager } from '@/canvas/transform/TransformManager';
import { trace } from '@/shared/debug-trace';
import { toast } from 'sonner';

export const auditResultAtom = atom<AuditResult | null>(null);
export const auditRunningAtom = atom<boolean>(false);
export const auditScopeFilterAtom = atom<AuditScope | 'all'>('all');
export const auditSeverityFilterAtom = atom<AuditSeverity | 'all'>('all');
export const auditPageFilterAtom = atom<string | 'all'>('all');
export const auditTargetScopeAtom = atom<'project' | 'page'>('project');
export const auditModeTabAtom = atom<'editor' | 'production'>('editor');
export const auditProdUrlAtom = atom<string>('http://localhost:3000');
export const auditProdWithLighthouseAtom = atom<boolean>(true);

export const auditPagesListAtom = atom((get) => {
  const result = get(auditResultAtom);
  if (!result) return [];
  const map = new Map<string, { route: string; pagePath: string; count: number; errorCount: number }>();
  for (const f of result.findings) {
    const path = f.location.pagePath || '';
    const route = f.location.route || computeCleanRoute(path);
    const entry = map.get(route) || { route, pagePath: path, count: 0, errorCount: 0 };
    entry.count++;
    if (f.severity === 'error') entry.errorCount++;
    map.set(route, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.errorCount - a.errorCount || b.count - a.count);
});

export const auditFilteredFindingsAtom = atom((get) => {
  const result = get(auditResultAtom);
  if (!result) return [];

  const scopeFilter = get(auditScopeFilterAtom);
  const severityFilter = get(auditSeverityFilterAtom);
  const pageFilter = get(auditPageFilterAtom);

  return result.findings.filter((f) => {
    if (scopeFilter !== 'all' && f.scope !== scopeFilter) return false;
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (pageFilter !== 'all') {
      const clean = f.location.route || computeCleanRoute(f.location.pagePath);
      if (clean !== pageFilter && f.location.pagePath !== pageFilter) return false;
    }
    return true;
  });
});

export const auditCountersAtom = atom((get) => {
  const result = get(auditResultAtom);
  if (!result) {
    return { errors: 0, warnings: 0, info: 0, total: 0, scores: null };
  }
  return {
    errors: result.summary.bySeverity.error || 0,
    warnings: result.summary.bySeverity.warning || 0,
    info: result.summary.bySeverity.info || 0,
    total: result.summary.total,
    scores: result.summary.scores || null,
  };
});

/**
 * Trigger an in-editor audit across the project (or current page) and canvas elements.
 */
export const runEditorAuditAtom = atom(
  null,
  async (
    get,
    set,
    options?: {
      mode?: 'static' | 'rendered' | 'full-production';
      baseUrl?: string;
      pagePath?: string;
      targetScope?: 'project' | 'page';
    }
  ) => {
    set(auditRunningAtom, true);
    const targetScope = options?.targetScope || get(auditTargetScopeAtom);
    const mode = options?.mode || 'rendered';
    trace.action('audit:start', { mode, targetScope });

    try {
      const files: Record<string, string> = {};
      for (const p of projectFS.listFiles()) {
        const c = projectFS.readFile(p);
        if (c !== null) files[p] = c;
      }

      const activeFile = get(activeFilePathAtom);
      const canvasNodes = get(nodesAtom);

      // In 'project' scope, pass undefined so static runner checks all project pages!
      const targetPagePath =
        options?.pagePath !== undefined
          ? options.pagePath
          : targetScope === 'page'
          ? activeFile
          : undefined;

      const result = await executeAuditTool(
        {
          mode,
          pagePath: targetPagePath,
          baseUrl: options?.baseUrl || (mode === 'full-production' ? get(auditProdUrlAtom) : undefined),
        },
        {
          fileMap: files,
          canvasNodes,
          modifyProjectFile,
          baseUrl: options?.baseUrl || (mode === 'full-production' ? get(auditProdUrlAtom) : undefined),
        }
      );

      set(auditResultAtom, { ...result });
      trace.action('audit:complete', { total: result.summary.total, findings: result.findings.length });
      const label = mode === 'full-production' ? 'Live audit' : 'Site audit';
      toast.success(
        `${label} complete: ${result.findings.length} findings (${result.summary.bySeverity.error} errors, ${result.summary.bySeverity.warning} warnings)`
      );
    } catch (err: any) {
      trace.error('audit:failed', { err: err?.message });
      toast.error(`Audit failed: ${err?.message || 'Unknown error'}`);
    } finally {
      set(auditRunningAtom, false);
    }
  }
);

/**
 * Navigate to a finding's target page and focus/frame the element on canvas.
 */
export const navigateToAuditFindingAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      pagePath?: string;
      nodeId?: string;
      route?: string;
    }
  ) => {
    const activeFile = get(activeFilePathAtom);
    let targetPath = payload.pagePath;

    // Resolve client path for canvas rendering if it's a server page
    if (targetPath && isPageServerFile(targetPath)) {
      targetPath = getPageClientPath(targetPath);
    }

    const needsPageSwitch = Boolean(targetPath && targetPath !== activeFile && projectFS.exists(targetPath));

    if (needsPageSwitch && targetPath) {
      trace.action('audit:navigate-page', { from: activeFile, to: targetPath });
      set(componentBreadcrumbAtom, []);
      switchActiveFile(
        activeFile,
        targetPath,
        {
          setActiveFile: (p) => set(activeFilePathAtom, p),
          setSelectedIds: (ids) => set(selectedIdsAtom, ids),
          setUpdatingFromCanvas: (v) => set(updatingFromCanvasAtom, v),
        },
        { syncQueueCode, flushNow }
      );
      const clean = payload.route || computeCleanRoute(targetPath);
      toast.info(`Switched to page: ${clean}`);
    }

    const focusNode = () => {
      if (!payload.nodeId) return;
      trace.action('audit:focusNode', { nodeId: payload.nodeId });
      set(selectedIdsAtom, [payload.nodeId]);

      const rect = findNodeRect(payload.nodeId, 'desktop');
      if (rect) {
        const cur = transformManager.getTransform();
        const targetX = cur.x + (window.innerWidth / 2 - (rect.left + rect.width / 2));
        const targetY = cur.y + (window.innerHeight / 2 - (rect.top + rect.height / 2));
        transformManager.setTransform({ ...cur, x: targetX, y: targetY });
      }
    };

    if (payload.nodeId) {
      if (needsPageSwitch) {
        // Wait for canvas iframe to mount new page content
        window.setTimeout(focusNode, 220);
      } else {
        focusNode();
      }
    }
  }
);

/**
 * Focus and frame a canvas node when clicked in the findings list.
 */
export const focusAuditNodeAtom = atom(
  null,
  (get, set, nodeId: string) => {
    set(navigateToAuditFindingAtom, { nodeId });
  }
);

/**
 * Open the Page Settings modal directly on the Pages/SEO section for a specific page.
 */
export const openPageSettingsAtom = atom(
  null,
  (get, set, filePath: string) => {
    trace.action('audit:openPageSettings', { filePath });
    let clientPath = isPageServerFile(filePath) ? getPageClientPath(filePath) : filePath;
    if (!projectFS.exists(clientPath)) {
      // 1. Strip locale segment: app/(main)/en/blog/... -> app/(main)/blog/...
      const withoutLocale = clientPath.replace(/(app\/(?:\([^)]+\)\/)?)[a-z]{2}(-[A-Z]{2})?\//, '$1');
      if (projectFS.exists(withoutLocale)) {
        clientPath = withoutLocale;
      } else {
        // 2. Try route match against all project page.client.tsx files
        const cleanRoute = computeCleanRoute(filePath).replace(/^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/, '/');
        for (const file of projectFS.listFiles()) {
          if (file.endsWith('page.client.tsx')) {
            const fileRoute = computeCleanRoute(file);
            if (fileRoute === cleanRoute || (cleanRoute === '/' && fileRoute === '/')) {
              clientPath = file;
              break;
            }
          }
        }
      }
    }

    const activeFile = get(activeFilePathAtom);
    if (clientPath && clientPath !== activeFile && projectFS.exists(clientPath)) {
      set(componentBreadcrumbAtom, []);
      switchActiveFile(
        activeFile,
        clientPath,
        {
          setActiveFile: (p) => set(activeFilePathAtom, p),
          setSelectedIds: (ids) => set(selectedIdsAtom, ids),
          setUpdatingFromCanvas: (v) => set(updatingFromCanvasAtom, v),
        },
        { syncQueueCode, flushNow }
      );
    }
    set(selectedSeoPageAtom, clientPath);
    set(settingsSectionAtom, 'pages');
    set(settingsOverlayOpenAtom, true);
  }
);

/**
 * Apply a single quick fix to a finding in the project.
 */
export const applyAuditQuickFixAtom = atom(
  null,
  (get, set, finding: AuditFinding) => {
    let pagePath = finding.location.pagePath;
    if (!pagePath || !finding.canAutoFix) return;

    // Route metadata fixes to companion server page.tsx if needed
    if (finding.scope === 'seo' && isPageClientFile(pagePath)) {
      const serverPath = getPageServerPath(pagePath);
      if (projectFS.exists(serverPath)) {
        pagePath = serverPath;
      }
    }

    trace.action('audit:quickFix', { ruleId: finding.ruleId, pagePath, nodeId: finding.location.nodeId });

    modifyProjectFile(pagePath, (code) => {
      const fixed = applySingleFindingFix(code, finding);
      return fixed || code;
    });

    toast.success(`Applied fix for ${finding.ruleId}`);
    // Re-trigger audit after applying fix
    void set(runEditorAuditAtom, { mode: 'rendered' });
  }
);

/**
 * Apply all auto-fixable findings at once.
 */
export const applyAllAuditFixesAtom = atom(
  null,
  (get, set) => {
    const result = get(auditResultAtom);
    if (!result) return;

    const fixable = result.findings.filter((f) => f.canAutoFix);
    if (fixable.length === 0) return;

    trace.action('audit:fixAll', { count: fixable.length });

    // Group by pagePath, routing SEO metadata to server file if present
    const byPage = new Map<string, AuditFinding[]>();
    for (const f of fixable) {
      let p = f.location.pagePath;
      if (!p) continue;
      if (f.scope === 'seo' && isPageClientFile(p)) {
        const serverPath = getPageServerPath(p);
        if (projectFS.exists(serverPath)) {
          p = serverPath;
        }
      }
      const list = byPage.get(p) || [];
      list.push(f);
      byPage.set(p, list);
    }

    for (const [path, pageFindings] of byPage.entries()) {
      modifyProjectFile(path, (code) => {
        const res = applyAutoFixesToCode(code, pageFindings);
        return res.code;
      });
    }

    toast.success(`Applied ${fixable.length} automated fixes!`);
    void set(runEditorAuditAtom, { mode: 'rendered' });
  }
);
