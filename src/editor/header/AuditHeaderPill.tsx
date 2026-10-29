// src/editor/header/AuditHeaderPill.tsx
// Header status indicator for site audit issues (🔴 Errors, 🟡 Warnings, 🛡️ Clean).

import React, { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  auditResultAtom,
  auditCountersAtom,
  auditRunningAtom,
  runEditorAuditAtom,
} from '@/code/stores/site-audit-store';
import { leftPanelAtom } from '@/code/stores/left-panel-store';
import { trace } from '@/shared/debug-trace';

export default function AuditHeaderPill() {
  const result = useAtomValue(auditResultAtom);
  const counters = useAtomValue(auditCountersAtom);
  const isRunning = useAtomValue(auditRunningAtom);
  const runAudit = useSetAtom(runEditorAuditAtom);
  const setLeftPanel = useSetAtom(leftPanelAtom);

  // Trigger initial project audit on mount so status is live from app load
  useEffect(() => {
    if (!result && !isRunning) {
      const timer = window.setTimeout(() => {
        void runAudit({ mode: 'rendered', targetScope: 'project' });
      }, 1200);
      return () => window.clearTimeout(timer);
    }
  }, [result, isRunning, runAudit]);

  const handleClick = () => {
    trace.action('audit-pill:click');
    setLeftPanel('audit');
  };

  const hasIssues = counters.errors > 0 || counters.warnings > 0;
  const isLoaded = result !== null;

  return (
    <button
      onClick={handleClick}
      type="button"
      className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded cut-corners text-[11px] font-mono cursor-pointer border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/80 transition-colors select-none"
      title={
        !isLoaded
          ? 'Site Diagnostics: Click to run audit.'
          : `Site Diagnostics: ${counters.errors} errors, ${counters.warnings} warnings. Click to open Audit panel.`
      }
    >
      {isRunning ? (
        <span className="flex items-center gap-1 text-zinc-400">
          <svg className="w-3 h-3 animate-spin text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth="3" strokeDasharray="30 60" />
          </svg>
          <span className="text-[10px]">Auditing</span>
        </span>
      ) : !isLoaded ? (
        <span className="flex items-center gap-1 text-zinc-400 hover:text-zinc-300">
          <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Audit</span>
        </span>
      ) : hasIssues ? (
        <span className="flex items-center gap-1.5">
          {counters.errors > 0 && (
            <span className="flex items-center gap-0.5 text-red-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
              <span>{counters.errors}</span>
            </span>
          )}
          {counters.warnings > 0 && (
            <span className="flex items-center gap-0.5 text-amber-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
              <span>{counters.warnings}</span>
            </span>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-emerald-400 font-medium">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>{counters.scores ? `${counters.scores.accessibility}%` : 'Clean'}</span>
        </span>
      )}
    </button>
  );
}
