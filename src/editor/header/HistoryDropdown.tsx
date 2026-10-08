// HistoryDropdown.tsx — Dropdown list of up to 100 disk-saved versions.
// Shows timestamps, save type badge, branch, change summaries, and actions to Review or Restore.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { projectFS } from '@/code/project/project-fs';
import {
  fetchProjectVersions,
  versionHistorySignalAtom,
  type ProjectVersionSummary,
} from '@/backend/version-history';

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const d = new Date(timestamp);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface HistoryDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenReview: (versionId: string) => void;
  onRestore: (versionId: string) => Promise<void>;
}

export default function HistoryDropdown({
  isOpen,
  onClose,
  onOpenReview,
  onRestore,
}: HistoryDropdownProps) {
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string>('current');

  const historySignal = useAtomValue(versionHistorySignalAtom);
  const activeBranchId = projectFS.getActiveBranchId();
  const allBranches = useMemo(() => projectFS.listBranches(), [historySignal]);

  const loadVersions = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const branchParam = filterBranch === 'current' ? activeBranchId : undefined;
      const list = await fetchProjectVersions(branchParam);
      setVersions(list);
    } finally {
      setLoading(false);
    }
  }, [isOpen, filterBranch, activeBranchId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions, historySignal]);

  const handleRestoreClick = async (versionId: string) => {
    if (restoringId) return;
    setRestoringId(versionId);
    try {
      await onRestore(versionId);
      onClose();
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute bottom-full mb-2 right-0 w-[360px] max-h-[480px] bg-[var(--bg-surface)] border border-[var(--border-light)] cut-corners cut-lg cut-border [--cut-border-color:var(--border-light)] shadow-2xl p-3 z-[110] flex flex-col text-xs select-none"
      style={{
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-light)]">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <svg className="w-3.5 h-3.5 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Version History</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {versions.length} / 100 on disk
          </span>
          <button
            onClick={() => loadVersions()}
            title="Refresh history"
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>
      </div>

      {/* Branch selector chip if multiple branches exist */}
      {allBranches.length > 1 && (
        <div className="flex items-center gap-1 pb-2 mb-1.5 text-[11px]">
          <span className="text-[var(--text-tertiary)]">Branch:</span>
          <button
            onClick={() => setFilterBranch('current')}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              filterBranch === 'current'
                ? 'bg-[var(--accent)] text-[var(--accent-fg,#ffffff)] font-medium'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {activeBranchId} (active)
          </button>
          <button
            onClick={() => setFilterBranch('all')}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              filterBranch === 'all'
                ? 'bg-[var(--accent)] text-[var(--accent-fg,#ffffff)] font-medium'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            All branches
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto max-h-[340px] pr-1 space-y-1">
        {loading && versions.length === 0 ? (
          <div className="py-8 text-center text-[var(--text-tertiary)] flex items-center justify-center gap-2">
            <svg className="animate-spin w-3.5 h-3.5 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" strokeWidth="2.5" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2.5" />
            </svg>
            <span>Loading versions…</span>
          </div>
        ) : versions.length === 0 ? (
          <div className="py-8 px-3 text-center text-[var(--text-tertiary)]">
            No versions saved yet. Saves and autosaves will be permanently recorded here on disk.
          </div>
        ) : (
          versions.map((v, index) => {
            const isManual = v.source === 'manual';
            const isRestore = v.source === 'restore';
            const isRestoringThis = restoringId === v.id;
            const fullDate = new Date(v.timestamp).toLocaleString();

            let badgeStyle = {
              bg: 'rgba(59, 130, 246, 0.12)',
              color: '#60a5fa',
              border: 'rgba(59, 130, 246, 0.3)',
              label: 'Autosave',
            };
            if (isManual) {
              badgeStyle = {
                bg: 'rgba(34, 197, 94, 0.12)',
                color: '#4ade80',
                border: 'rgba(34, 197, 94, 0.3)',
                label: 'Save',
              };
            } else if (isRestore) {
              badgeStyle = {
                bg: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                border: 'rgba(245, 158, 11, 0.3)',
                label: 'Checkpoint',
              };
            }

            return (
              <div
                key={v.id}
                className="group flex items-center justify-between gap-2 p-2 rounded hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--border-light)] transition-all"
                title={`${v.label || badgeStyle.label} · ${fullDate}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0"
                      style={{
                        backgroundColor: badgeStyle.bg,
                        color: badgeStyle.color,
                        borderColor: badgeStyle.border,
                      }}
                    >
                      {badgeStyle.label}
                    </span>
                    <span className="font-medium text-[var(--text-primary)] truncate">
                      {formatRelativeTime(v.timestamp)}
                    </span>
                    {filterBranch === 'all' && (
                      <span className="text-[10px] text-[var(--text-tertiary)] truncate">
                        [{v.branchId}]
                      </span>
                    )}
                  </div>

                  <div className="text-[10px] text-[var(--text-secondary)] truncate">
                    {v.changesSummary ? (
                      <span className="text-[var(--text-secondary)]">{v.changesSummary}</span>
                    ) : (
                      <span>{v.label || (index === 0 ? 'Latest state' : 'Snapshot')}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  {/* Review Changes Button */}
                  <button
                    onClick={() => onOpenReview(v.id)}
                    title="Review changes in this version"
                    className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-secondary-bg,#333)] transition-colors cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>

                  {/* Restore Button */}
                  <button
                    onClick={() => handleRestoreClick(v.id)}
                    disabled={isRestoringThis}
                    title="Restore this version (Ctrl+Z to this state)"
                    className="px-2 py-1 cut-corners text-[11px] font-semibold bg-[var(--accent)] text-[var(--accent-fg,#ffffff)] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1"
                  >
                    {isRestoringThis ? (
                      <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" strokeWidth="2.5" />
                        <path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2.5" />
                      </svg>
                    ) : (
                      'Restore'
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 mt-2 border-t border-[var(--border-light)] text-[10px] text-[var(--text-tertiary)] flex items-center justify-between">
        <span>Persistent across restarts</span>
        <button
          onClick={onClose}
          className="hover:text-[var(--text-primary)] cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
}
