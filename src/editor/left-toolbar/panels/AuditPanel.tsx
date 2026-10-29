// src/editor/left-toolbar/panels/AuditPanel.tsx
// Dedicated in-editor diagnostic panel with interactive findings, cross-page navigation, canvas focusing, and 1-click quick fixes.

import React, { useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  auditResultAtom,
  auditRunningAtom,
  auditScopeFilterAtom,
  auditSeverityFilterAtom,
  auditPageFilterAtom,
  auditTargetScopeAtom,
  auditModeTabAtom,
  auditProdUrlAtom,
  auditProdWithLighthouseAtom,
  auditPagesListAtom,
  auditFilteredFindingsAtom,
  auditCountersAtom,
  runEditorAuditAtom,
  navigateToAuditFindingAtom,
  openPageSettingsAtom,
  applyAuditQuickFixAtom,
  applyAllAuditFixesAtom,
} from '@/code/stores/site-audit-store';
import { computeCleanRoute } from '@/code/audit/core/normalizer';
import type { AuditFinding, AuditScope } from '@/code/audit/core/types';
import ToolSegmentedControl from '@/editor/controls/ToolSegmentedControl';
import Button from '@/design-system/Button';
import { trace } from '@/shared/debug-trace';

const SCOPES: Array<{ id: AuditScope | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'accessibility', label: 'A11y' },
  { id: 'seo', label: 'SEO' },
  { id: 'performance', label: 'Perf' },
  { id: 'security', label: 'Security' },
  { id: 'clean-code', label: 'Code' },
];

const MODE_TABS = [
  { value: 'editor', label: '⚡ Editor' },
  { value: 'production', label: '🚀 Live Build' },
];

const SCOPE_TABS = [
  { value: 'project', label: 'Entire Site' },
  { value: 'page', label: 'Current Page' },
];

export default function AuditPanel() {
  const result = useAtomValue(auditResultAtom);
  const isRunning = useAtomValue(auditRunningAtom);
  const [scopeFilter, setScopeFilter] = useAtom(auditScopeFilterAtom);
  const [severityFilter, setSeverityFilter] = useAtom(auditSeverityFilterAtom);
  const [pageFilter, setPageFilter] = useAtom(auditPageFilterAtom);
  const [targetScope, setTargetScope] = useAtom(auditTargetScopeAtom);
  const [modeTab, setModeTab] = useAtom(auditModeTabAtom);
  const [prodUrl, setProdUrl] = useAtom(auditProdUrlAtom);
  const [withLighthouse, setWithLighthouse] = useAtom(auditProdWithLighthouseAtom);

  const pagesList = useAtomValue(auditPagesListAtom);
  const filteredFindings = useAtomValue(auditFilteredFindingsAtom);
  const counters = useAtomValue(auditCountersAtom);

  const runAudit = useSetAtom(runEditorAuditAtom);
  const navigateToFinding = useSetAtom(navigateToAuditFindingAtom);
  const openPageSettings = useSetAtom(openPageSettingsAtom);
  const applyFix = useSetAtom(applyAuditQuickFixAtom);
  const applyAllFixes = useSetAtom(applyAllAuditFixesAtom);

  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);

  // Run initial project-wide audit on mount if never run
  useEffect(() => {
    if (!result && !isRunning) {
      void runAudit({ mode: 'rendered', targetScope: 'project' });
    }
  }, [result, isRunning, runAudit]);

  const fixableCount = result?.findings.filter((f) => f.canAutoFix).length || 0;

  const handleRunAudit = (overrideMode?: 'rendered' | 'full-production') => {
    const mode = overrideMode || (modeTab === 'production' ? 'full-production' : 'rendered');
    void runAudit({
      mode,
      baseUrl: prodUrl,
      targetScope,
    });
  };

  const handleModeTabChange = (val: string) => {
    setModeTab(val as 'editor' | 'production');
  };

  const handleTargetScopeChange = (val: string) => {
    const next = val as 'project' | 'page';
    setTargetScope(next);
    void runAudit({
      mode: modeTab === 'production' ? 'full-production' : 'rendered',
      targetScope: next,
      baseUrl: prodUrl,
    });
  };

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-x-hidden bg-[var(--bg-panel)] text-[var(--text-primary)] text-xs select-none">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="p-3 border-b border-[var(--border-light)] flex items-center justify-between shrink-0 bg-[var(--bg-panel)]">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-[var(--accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="font-semibold text-xs text-[var(--text-primary)] truncate">Site Audit</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => handleRunAudit()}
          disabled={isRunning}
          loading={isRunning}
          className="h-7 text-[11px] shrink-0"
          title="Re-run site audit"
          icon={
            !isRunning ? (
              <svg className="w-3.5 h-3.5 text-[var(--text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            ) : undefined
          }
        >
          {isRunning ? 'Auditing...' : 'Audit'}
        </Button>
      </div>

      {/* ─── Mode Tabs: Editor vs Live Server ─────────────────────────────── */}
      <div className="px-3 pt-2.5 pb-2 border-b border-[var(--border-light)] bg-[var(--bg-toolbar)]/60 shrink-0">
        <ToolSegmentedControl
          value={modeTab}
          onChange={handleModeTabChange}
          options={MODE_TABS}
          size="compact"
        />

        {/* Common Scope Selector for both Editor and Live Build */}
        <div className="flex items-center justify-between gap-2 mt-2 text-[11px]">
          <span className="text-[var(--text-secondary)] text-[10px] font-medium shrink-0">Scope:</span>
          <div className="flex-1">
            <ToolSegmentedControl
              value={targetScope}
              onChange={handleTargetScopeChange}
              options={SCOPE_TABS}
              size="compact"
            />
          </div>
        </div>

        {/* Live Server Audit Controls (Visible when Live Build tab is active) */}
        {modeTab === 'production' && (
          <div className="mt-2 space-y-2 pb-1 pt-2 border-t border-[var(--border-light)]">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={prodUrl}
                onChange={(e) => setProdUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="w-full bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] border border-[var(--control-border)] hover:border-[var(--control-border-hover)] focus:border-[var(--border-focus)] rounded px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] font-mono outline-none transition-colors"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withLighthouse}
                  onChange={(e) => setWithLighthouse(e.target.checked)}
                  className="rounded accent-[var(--accent)] cursor-pointer"
                />
                <span>Lighthouse Core Vitals</span>
              </label>
              <Button
                size="sm"
                variant="primary"
                onClick={() => handleRunAudit('full-production')}
                disabled={isRunning}
                loading={isRunning}
                className="h-6 px-2 text-[10px]"
              >
                {isRunning ? 'Running...' : 'Run Live'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Score Overview Cards ────────────────────────────────────────── */}
      {counters.scores && (
        <div className="grid grid-cols-4 gap-1.5 px-3 py-2 bg-[var(--bg-toolbar)]/80 border-b border-[var(--border-light)] text-center shrink-0">
          <div className="p-1.5 rounded cut-corners bg-[var(--bg-surface)] border border-[var(--border-light)] min-w-0">
            <div className={`text-xs font-bold ${counters.scores.accessibility >= 90 ? 'text-emerald-500 dark:text-emerald-400' : counters.scores.accessibility >= 70 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
              {counters.scores.accessibility}
            </div>
            <div className="text-[9px] text-[var(--text-secondary)] truncate">A11y</div>
          </div>
          <div className="p-1.5 rounded cut-corners bg-[var(--bg-surface)] border border-[var(--border-light)] min-w-0">
            <div className={`text-xs font-bold ${counters.scores.seo >= 90 ? 'text-emerald-500 dark:text-emerald-400' : counters.scores.seo >= 70 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
              {counters.scores.seo}
            </div>
            <div className="text-[9px] text-[var(--text-secondary)] truncate">SEO</div>
          </div>
          <div className="p-1.5 rounded cut-corners bg-[var(--bg-surface)] border border-[var(--border-light)] min-w-0">
            <div className={`text-xs font-bold ${counters.scores.performance >= 90 ? 'text-emerald-500 dark:text-emerald-400' : counters.scores.performance >= 70 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
              {counters.scores.performance}
            </div>
            <div className="text-[9px] text-[var(--text-secondary)] truncate">Perf</div>
          </div>
          <div className="p-1.5 rounded cut-corners bg-[var(--bg-surface)] border border-[var(--border-light)] min-w-0">
            <div className={`text-xs font-bold ${counters.scores.bestPractices >= 90 ? 'text-emerald-500 dark:text-emerald-400' : counters.scores.bestPractices >= 70 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
              {counters.scores.bestPractices}
            </div>
            <div className="text-[9px] text-[var(--text-secondary)] truncate">Code</div>
          </div>
        </div>
      )}

      {/* ─── Filters & Page Selector ─────────────────────────────────────── */}
      <div className="p-3 border-b border-[var(--border-light)] space-y-2 bg-[var(--bg-toolbar)]/40 shrink-0">
        {/* Page Filter Dropdown */}
        {pagesList.length > 0 && (
          <div className="relative w-full min-w-0">
            <select
              value={pageFilter}
              onChange={(e) => setPageFilter(e.target.value)}
              className="w-full h-7 pl-2 pr-6 text-[11px] appearance-none bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] border border-[var(--control-border)] hover:border-[var(--control-border-hover)] focus:border-[var(--border-focus)] text-[var(--text-primary)] rounded cut-corners cut-border outline-none transition-colors truncate font-mono cursor-pointer"
            >
              <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                📄 All Pages ({result?.findings.length || 0})
              </option>
              {pagesList.map((p) => (
                <option key={p.route} value={p.route} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                  📄 {p.route} ({p.count})
                </option>
              ))}
            </select>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-2.5 h-2.5 text-[var(--text-secondary)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        )}

        {/* Scope Pills */}
        <div className="flex flex-wrap gap-1 items-center">
          {SCOPES.map((sc) => (
            <button
              key={sc.id}
              onClick={() => setScopeFilter(sc.id)}
              className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors cursor-pointer ${
                scopeFilter === sc.id
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)] font-medium shadow-xs'
                  : 'bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--control-border)]'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>

        {/* Severity counters & Fix All */}
        <div className="flex items-center justify-between text-[11px] gap-1 flex-wrap">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                if (severityFilter === 'error') {
                  setSeverityFilter('all');
                } else {
                  setSeverityFilter('error');
                  if (scopeFilter !== 'all') setScopeFilter('all');
                }
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                severityFilter === 'error'
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400 ring-1 ring-red-500/50 font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              title="Filter critical errors"
            >
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              <span>{counters.errors}</span>
            </button>
            <button
              onClick={() => {
                if (severityFilter === 'warning') {
                  setSeverityFilter('all');
                } else {
                  setSeverityFilter('warning');
                  if (scopeFilter !== 'all') setScopeFilter('all');
                }
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                severityFilter === 'warning'
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/50 font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              title="Filter warnings"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              <span>{counters.warnings}</span>
            </button>
            <button
              onClick={() => {
                if (severityFilter === 'info') {
                  setSeverityFilter('all');
                } else {
                  setSeverityFilter('info');
                  if (scopeFilter !== 'all') setScopeFilter('all');
                }
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                severityFilter === 'info'
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/50 font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
              title="Filter informational notices"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              <span>{counters.info}</span>
            </button>
          </div>

          {fixableCount > 0 && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void applyAllFixes()}
              className="h-6 px-2 text-[10px] shrink-0"
            >
              Fix All ({fixableCount})
            </Button>
          )}
        </div>
      </div>

      {/* ─── Finding List ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-w-0 max-w-full">
        {filteredFindings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center p-4 text-[var(--text-secondary)]">
            <svg className="w-8 h-8 text-emerald-500 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div className="font-medium text-[var(--text-primary)] text-xs">All checks passed</div>
            <div className="text-[10px] mt-1 text-[var(--text-muted)] leading-normal">
              No audit violations matching current filter criteria.
            </div>
          </div>
        ) : (
          filteredFindings.map((finding) => {
            const isSelected = activeFindingId === finding.id;
            const hasNode = Boolean(finding.location.nodeId);
            const isLayoutIssue = Boolean(
              finding.location.pagePath?.includes('layout.tsx') ||
              finding.location.route?.includes('Layout')
            );
            const isSeoPageIssue = finding.scope === 'seo' && !hasNode && !isLayoutIssue;
            const routeLabel = finding.location.route || computeCleanRoute(finding.location.pagePath);

            const handleNavigate = () => {
              setActiveFindingId(finding.id);
              if (isSeoPageIssue) {
                openPageSettings(finding.location.pagePath);
              } else {
                navigateToFinding({
                  pagePath: finding.location.pagePath,
                  nodeId: finding.location.nodeId,
                  route: routeLabel,
                });
              }
            };

            return (
              <div
                key={finding.id}
                onClick={handleNavigate}
                className={`p-2.5 rounded-lg border w-full max-w-full overflow-hidden transition-all cursor-pointer ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]'
                    : finding.severity === 'error'
                    ? 'border-red-500/30 bg-red-500/[0.04] hover:border-red-500/50 hover:bg-red-500/[0.08]'
                    : finding.severity === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/50 hover:bg-amber-500/[0.08]'
                    : 'border-[var(--border-light)] bg-[var(--bg-surface)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {/* Row 1: Severity badge & Category/Scope badge */}
                <div className="flex items-center justify-between gap-1.5 min-w-0 mb-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                      finding.severity === 'error'
                        ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                        : finding.severity === 'warning'
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                        : 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {finding.severity}
                  </span>

                  <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-[var(--control-bg)] text-[var(--text-secondary)] shrink-0">
                    {finding.scope}
                  </span>
                </div>

                {/* Row 2: Page route badge */}
                <div className="flex items-center min-w-0 mb-1.5">
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--control-bg)] border border-[var(--control-border)] text-[10px] text-[var(--accent)] font-mono font-medium truncate max-w-full"
                    title={`Page: ${finding.location.pagePath}`}
                  >
                    📄 {routeLabel}
                  </span>
                </div>

                {/* Finding Title */}
                <div className="font-semibold text-[var(--text-primary)] text-xs leading-snug break-words mt-1">
                  {finding.title}
                </div>

                {/* Message */}
                <div className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed break-words">
                  {finding.message}
                </div>

                {/* Remediation Tip */}
                {finding.remediation && (
                  <div className="text-[10px] text-[var(--text-primary)] bg-[var(--control-bg)] p-1.5 rounded border border-[var(--border-light)] mt-2 font-mono break-words leading-normal">
                    💡 {finding.remediation}
                  </div>
                )}

                {/* Element Tag & ID indicator */}
                {(finding.location.tag || finding.location.nodeId) && (
                  <div
                    className="text-[10px] text-[var(--text-muted)] font-mono truncate mt-1.5 block max-w-full"
                    title={`${finding.location.tag ? `<${finding.location.tag}>` : ''} #${finding.location.nodeId || ''}`}
                  >
                    {finding.location.tag ? `<${finding.location.tag}>` : ''}
                    {finding.location.nodeId ? ` #${finding.location.nodeId}` : ''}
                  </div>
                )}

                {/* Action Row */}
                <div className="flex items-center justify-between flex-wrap gap-1.5 pt-2 border-t border-[var(--border-light)] mt-2 text-[10px]">
                  {/* Action Button: Focus Element / Page Settings / Go to Page */}
                  {isSeoPageIssue ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveFindingId(finding.id);
                        openPageSettings(finding.location.pagePath);
                      }}
                      className="px-2 py-1 rounded bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] text-[var(--text-primary)] border border-[var(--control-border)] font-medium transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                      title="Open Page Settings (SEO & Metadata)"
                    >
                      <svg className="w-3 h-3 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      <span>Page Settings</span>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNavigate();
                      }}
                      className="px-2 py-1 rounded bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] text-[var(--text-primary)] border border-[var(--control-border)] font-medium transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                      title={hasNode ? 'Navigate to element on canvas' : 'Navigate to page'}
                    >
                      {hasNode ? (
                        <>
                          <svg className="w-3 h-3 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="22" y1="12" x2="18" y2="12" />
                            <line x1="6" y1="12" x2="2" y2="12" />
                            <line x1="12" y1="6" x2="12" y2="2" />
                            <line x1="12" y1="22" x2="12" y2="18" />
                          </svg>
                          <span>Focus</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          <span>Go to Page</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Fix Button */}
                  {finding.canAutoFix && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        applyFix(finding);
                      }}
                      className="h-6 px-2.5 text-[10px] ml-auto shrink-0"
                    >
                      Fix
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
