// LocalServerDropdown.tsx — Self-host local live server dropdown menu.
// Provides controls to build, start, stop, configure port, view status, and launch
// the local Next.js production server.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchLocalServerStatus,
  buildLocalServer,
  startLocalServer,
  stopLocalServer,
  type LocalServerStatus,
} from '@/backend/local-server-client';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import { activeBranchIdAtom } from '@/code/stores/branch-store';
import { flushNow } from '@/code/mutation/mutation-queue';
import { getProjectId } from '@/backend/project-id';
import { BranchIcon } from '@/shared/icons';
import { toast } from 'sonner';
import { trace } from '@/shared/debug-trace';

// ─── Inline icons ────────────────────────────────────────────────────────────

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
}

function ExternalLink({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function Globe({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function Play({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
    </svg>
  );
}

function Square({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </svg>
  );
}

function Hammer({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" />
      <path d="M17.64 15 22 10.64" />
      <path d="m20.91 3.26-1.55-1.55a2 2 0 0 0-2.83 0l-4.5 4.5 4.38 4.38 4.5-4.5a2 2 0 0 0 0-2.83Z" />
    </svg>
  );
}

function X({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function Check({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function stripAnsi(str: string): string {
  return str
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\[\d+(?:;\d+)*m/g, '');
}

// ─── Component Props ─────────────────────────────────────────────────────────

export interface LocalServerDropdownProps {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (status: LocalServerStatus | null) => void;
}

export function LocalServerDropdown({ open, onClose, onStatusChange }: LocalServerDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<LocalServerStatus | null>(null);
  const [port, setPort] = useState<number>(3000);
  const [building, setBuilding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [buildLog, setBuildLog] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const projectId = getProjectId();
  const currentBranch = useAtomValue(activeBranchIdAtom) || MAIN_BRANCH_ID;

  // Outside click listener
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-live-trigger]')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, onClose]);

  // Status fetcher & state broadcaster
  const refreshStatus = useCallback(async () => {
    try {
      const curStatus = await fetchLocalServerStatus(projectId);
      setStatus(curStatus);
      if (curStatus?.port && !building && !starting) {
        setPort(curStatus.port);
      }
      if (curStatus?.lastError) {
        setErrorMessage(curStatus.lastError);
      } else if (curStatus?.status === 'running') {
        setErrorMessage(null);
      }
      onStatusChange?.(curStatus);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('local-server-status-changed', { detail: curStatus }));
      }
      return curStatus;
    } catch (err: any) {
      trace.error('local-server-dropdown:fetch-status-error', { error: err?.message || String(err) });
      return null;
    }
  }, [projectId, building, starting, onStatusChange]);

  // Initial load and periodic polling while open
  useEffect(() => {
    if (!open) return;
    trace.action('local-server-dropdown:opened', { projectId });
    void refreshStatus();

    const interval = setInterval(() => {
      void refreshStatus();
    }, 2500);

    return () => {
      clearInterval(interval);
    };
  }, [open, projectId, refreshStatus]);

  // Handle Build
  const handleBuild = useCallback(async () => {
    if (building) return;
    setBuilding(true);
    setErrorMessage(null);
    setShowLog(false);

    const activeBranch = projectFS.getActiveBranchId() || currentBranch || MAIN_BRANCH_ID;
    trace.action('local-server-dropdown:build-start', { projectId, branch: activeBranch });

    try {
      // 1. Flush any pending mutations
      flushNow();

      // 2. Extract current files from projectFS for the active branch
      const branchFiles = projectFS.readBranchFiles(activeBranch, { shared: true })
        ?? projectFS.readBranchFiles(MAIN_BRANCH_ID, { shared: true });
      const files: Record<string, string> = {};
      if (branchFiles) {
        for (const [k, v] of branchFiles.entries()) {
          files[k] = v;
        }
      }

      // 3. Trigger build
      const result = await buildLocalServer(projectId, files, activeBranch);
      setBuildLog(result.log || null);

      if (result.success) {
        trace.action('local-server-dropdown:build-success', { projectId, branch: activeBranch });
        toast.success(`Build succeeded (${activeBranch})! Ready to start server.`);
        await refreshStatus();
      } else {
        trace.error('local-server-dropdown:build-failed', { projectId, branch: activeBranch, log: result.log });
        const errMsg = result.log || 'Build failed';
        setErrorMessage(errMsg);
        toast.error(`Build failed: ${errMsg.slice(0, 80)}`);
      }
    } catch (err: any) {
      const msg = err?.message || 'Build failed unexpectedly';
      trace.error('local-server-dropdown:build-error', { projectId, error: msg });
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setBuilding(false);
      void refreshStatus();
    }
  }, [building, currentBranch, projectId, refreshStatus]);

  // Handle Start
  const handleStart = useCallback(async () => {
    if (starting || building || status?.status === 'running') return;
    setStarting(true);
    setErrorMessage(null);
    trace.action('local-server-dropdown:start', { projectId, port });

    try {
      const nextStatus = await startLocalServer(projectId, port);
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('local-server-status-changed', { detail: nextStatus }));
      }
      toast.success(`Local server started on port ${nextStatus.port || port}`);
    } catch (err: any) {
      const msg = err?.message || 'Failed to start local server';
      trace.error('local-server-dropdown:start-error', { projectId, error: msg });
      setErrorMessage(msg);
      toast.error(msg);
      void refreshStatus();
    } finally {
      setStarting(false);
    }
  }, [starting, building, status?.status, projectId, port, onStatusChange, refreshStatus]);

  // Handle Stop
  const handleStop = useCallback(async () => {
    if (stopping || status?.status !== 'running') return;
    setStopping(true);
    setErrorMessage(null);
    trace.action('local-server-dropdown:stop', { projectId });

    try {
      const nextStatus = await stopLocalServer(projectId);
      setStatus(nextStatus);
      setErrorMessage(nextStatus?.lastError || null);
      onStatusChange?.(nextStatus);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('local-server-status-changed', { detail: nextStatus }));
      }
      toast.success('Local server stopped');
    } catch (err: any) {
      const msg = err?.message || 'Failed to stop local server';
      trace.error('local-server-dropdown:stop-error', { projectId, error: msg });
      setErrorMessage(msg);
      toast.error(msg);
      void refreshStatus();
    } finally {
      setStopping(false);
    }
  }, [stopping, status?.status, projectId, onStatusChange, refreshStatus]);

  const isRunning = status?.status === 'running';
  const isBuilding = building || status?.status === 'building';
  const isError = !isBuilding && (status?.status === 'error' || !!errorMessage);

  // Derive badge dot class and text
  let dotClass = 'bg-neutral-500';
  let badgeLabel = 'Stopped';

  if (isBuilding) {
    dotClass = 'bg-amber-500 animate-pulse';
    badgeLabel = 'Building...';
  } else if (isRunning) {
    dotClass = 'bg-emerald-500';
    badgeLabel = `Running: ${status?.port || port}`;
  } else if (isError) {
    dotClass = 'bg-red-500';
    badgeLabel = 'Error';
  }

  const liveUrl = isRunning ? (status?.url || `http://localhost:${status?.port || port}`) : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22, mass: 0.8 }}
          className="absolute top-full right-0 mt-6 min-w-[280px] bg-[var(--dropdown-bg)] border border-[var(--border-light)] cut-corners cut-lg py-2.5 px-3 z-[10001] shadow-[var(--shadow-lg)] flex flex-col gap-2.5"
        >
          {/* Header row: Title + status badge */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border-light)] text-xs">
            <span className="font-semibold text-[var(--text-primary)]">Local Live Server</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-surface,rgba(255,255,255,0.05))] text-[var(--text-secondary)]">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
              <span>{badgeLabel}</span>
            </span>
          </div>

          {/* Active branch indicator */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-[var(--text-secondary)] select-none flex items-center gap-1.5">
              <BranchIcon size={12} className="text-[var(--text-tertiary)]" />
              <span>Branch</span>
            </span>
            <span
              className={`font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                currentBranch === MAIN_BRANCH_ID
                  ? 'text-[var(--text-secondary)] bg-[var(--bg-surface,rgba(255,255,255,0.05))] border-[var(--border-light)]'
                  : 'text-[var(--accent)] bg-[var(--accent)]/10 border-[var(--accent)]/30 font-medium'
              }`}
              title={`Active branch: ${currentBranch}`}
            >
              {currentBranch}
            </span>
          </div>

          {/* URL link when running */}
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-[var(--accent)] hover:underline bg-[var(--bg-surface,rgba(0,0,0,0.2))] rounded border border-[var(--border-light)] transition-colors group"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Globe size={13} className="shrink-0 text-[var(--text-secondary)]" />
                <span className="truncate font-mono text-[11px]">{liveUrl}</span>
              </div>
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] shrink-0">
                Open in new tab
                <ExternalLink size={12} />
              </span>
            </a>
          )}

          {/* Port input row */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <label htmlFor="local-server-port" className="text-[var(--text-secondary)] select-none">
              Port
            </label>
            <input
              id="local-server-port"
              type="number"
              min={1024}
              max={65535}
              value={port}
              disabled={isRunning || isBuilding}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setPort(isNaN(val) ? 3000 : val);
              }}
              className="w-20 px-2 py-1 text-xs font-mono bg-[var(--bg-surface,rgba(0,0,0,0.2))] border border-[var(--border-light)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
          </div>

          {/* Action buttons row: Build, Start, Stop */}
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={handleBuild}
              disabled={isBuilding}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded cut-corners border border-[var(--border-light)] bg-[var(--bg-surface,rgba(255,255,255,0.05))] hover:bg-[var(--bg-hover,rgba(255,255,255,0.1))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[var(--text-primary)]"
            >
              <Hammer size={12} />
              <span>{isBuilding ? 'Building...' : 'Build'}</span>
            </button>

            <button
              type="button"
              onClick={handleStart}
              disabled={isRunning || isBuilding || starting}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded cut-corners bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-opacity"
            >
              <Play size={11} />
              <span>{starting ? 'Starting...' : 'Start'}</span>
            </button>

            <button
              type="button"
              onClick={handleStop}
              disabled={!isRunning || stopping}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded cut-corners border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Square size={11} />
              <span>{stopping ? 'Stopping...' : 'Stop'}</span>
            </button>
          </div>

          {/* Error view */}
          {errorMessage ? (
            <div className="mt-1 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-1 text-red-400">
                <span className="font-medium truncate leading-tight">
                  {errorMessage}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setShowLog(false);
                  }}
                  className="text-red-400 hover:text-red-300 p-0.5 rounded cursor-pointer"
                  title="Dismiss error"
                >
                  <X size={12} />
                </button>
              </div>

              {buildLog && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowLog((prev) => !prev)}
                    className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                  >
                    {showLog ? 'Hide log' : 'View error log'}
                  </button>
                  {showLog && (
                    <pre className="mt-1 p-1.5 max-h-36 overflow-auto font-mono text-[10px] bg-black/60 text-red-300 rounded whitespace-pre-wrap select-text">
                      {stripAnsi(buildLog)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : buildLog ? (
            /* Build Success log notice */
            <div className="mt-1 p-2 rounded bg-emerald-500/10 border border-emerald-500/25 text-xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-1 text-emerald-400">
                <span className="font-medium truncate leading-tight flex items-center gap-1.5">
                  <Check size={12} />
                  <span>Build succeeded ({currentBranch})</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBuildLog(null);
                    setShowLog(false);
                  }}
                  className="text-emerald-400/70 hover:text-emerald-300 p-0.5 rounded cursor-pointer"
                  title="Dismiss"
                >
                  <X size={12} />
                </button>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowLog((prev) => !prev)}
                  className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                >
                  {showLog ? 'Hide log' : 'View build log'}
                </button>
                {showLog && (
                  <pre className="mt-1 p-1.5 max-h-36 overflow-auto font-mono text-[10px] bg-black/60 text-emerald-300 rounded whitespace-pre-wrap select-text">
                    {stripAnsi(buildLog)}
                  </pre>
                )}
              </div>
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
