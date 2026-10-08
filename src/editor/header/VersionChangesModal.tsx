// VersionChangesModal.tsx — Visual inspector for reviewing changes in a saved version.
// Reuses describeFileChanges to display exact Added / Removed / Moved / Changed nodes
// and before → after property values before restoring.

import React, { useEffect, useState, useMemo } from 'react';
import Modal from '@/design-system/Modal';
import SectionLabel from '@/design-system/SectionLabel';
import { projectFS } from '@/code/project/project-fs';
import { describeFileChanges, type NodeChange } from '@/code/branching/describe-changes';
import { fetchVersionDetail, type ProjectVersionRecord } from '@/backend/version-history';

const KIND_LABEL: Record<NodeChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  moved: 'Moved',
  changed: 'Changed',
};

const KIND_COLOR: Record<NodeChange['kind'], string> = {
  added: 'var(--accent)',
  removed: 'var(--accent-danger, #dc2626)',
  moved: 'var(--text-secondary)',
  changed: 'var(--text-primary)',
};

export interface VersionChangesModalProps {
  versionId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRestore: (versionId: string) => Promise<void> | void;
}

export default function VersionChangesModal({
  versionId,
  isOpen,
  onClose,
  onRestore,
}: VersionChangesModalProps) {
  const [version, setVersion] = useState<ProjectVersionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!isOpen || !versionId) {
      setVersion(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    fetchVersionDetail(versionId).then((v) => {
      if (!cancelled) {
        setVersion(v);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, versionId]);

  // Compare current live files against version files
  const files = useMemo(() => {
    if (!version?.data?.files) return [];

    const currentFiles = projectFS.getSnapshot();
    // Resolve version files: if on non-main branch, check if branch files exist
    let vFilesMap: Record<string, string> = version.data.files;
    if (
      version.branchId &&
      version.branchId !== 'main' &&
      version.data.branches?.[version.branchId]?.files
    ) {
      vFilesMap = {
        ...version.data.files,
        ...version.data.branches[version.branchId].files,
      };
    }

    const versionFileKeys = Object.keys(vFilesMap);
    const paths = Array.from(new Set([...currentFiles.keys(), ...versionFileKeys])).sort();

    return paths
      .filter((p) => currentFiles.get(p) !== vFilesMap[p])
      .map((path) => ({
        path,
        ...describeFileChanges(currentFiles.get(path) ?? null, vFilesMap[path] ?? null),
      }));
  }, [version]);

  const total = files.reduce((n, f) => n + f.changes.length, 0);

  const handleRestore = async () => {
    if (!versionId) return;
    setRestoring(true);
    try {
      await onRestore(versionId);
      onClose();
    } finally {
      setRestoring(false);
    }
  };

  const title = version
    ? `Review changes: ${version.label || 'Saved Version'} (${new Date(version.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : 'Review changes';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width={600}>
      <div className="flex max-h-[65vh] flex-col">
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--text-tertiary)] flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" strokeWidth="2.5" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2.5" />
              </svg>
              <span>Loading version diff…</span>
            </div>
          ) : files.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-[var(--text-tertiary)]">
              No differences detected — this version matches your current canvas.
            </div>
          ) : (
            files.map((f) => (
              <div key={f.path} className="mb-3">
                <SectionLabel size="xs">{f.path}</SectionLabel>
                {f.unparsed && (
                  <div className="px-3 pb-2 text-[11px] text-[var(--text-disabled)]">
                    This file couldn’t be parsed — it will still be restored completely.
                  </div>
                )}
                {f.changes.length === 0 && !f.unparsed && (
                  <div className="px-3 py-1 text-[11px] text-[var(--text-tertiary)] italic">
                    File content changed (formatting or non-visual changes)
                  </div>
                )}
                {f.changes.map((c, i) => (
                  <div
                    key={`${c.title}-${i}`}
                    className="mx-2 my-1 px-2.5 py-1.5 rounded bg-[var(--bg-hover)] border border-[var(--border-light)] text-[12px]"
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider px-1 rounded"
                        style={{
                          color: KIND_COLOR[c.kind],
                          backgroundColor: `color-mix(in srgb, ${KIND_COLOR[c.kind]} 15%, transparent)`,
                        }}
                      >
                        {KIND_LABEL[c.kind]}
                      </span>
                      <span className="truncate font-medium text-[var(--text-primary)]">
                        {c.title}
                      </span>
                    </div>
                    {c.props.map((p) => (
                      <div key={p.label} className="pl-2 pt-1 text-[11px] text-[var(--text-secondary)]">
                        <span className="text-[var(--text-tertiary)]">{p.label}:</span>{' '}
                        <span className="line-through opacity-70">{p.before || '—'}</span>{' '}
                        <span className="text-[var(--accent)] font-medium">→ {p.after || '—'}</span>
                      </div>
                    ))}
                    {c.moreProps > 0 && (
                      <div className="pl-2 pt-0.5 text-[10px] text-[var(--text-tertiary)]">
                        +{c.moreProps} more property {c.moreProps === 1 ? 'change' : 'changes'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-3 mt-2">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {total} change{total === 1 ? '' : 's'} across {files.length} file{files.length === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 cut-corners text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring || !version}
              className="cut-corners bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-fg,#ffffff)] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
            >
              {restoring ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" strokeWidth="2.5" />
                    <path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2.5" />
                  </svg>
                  <span>Restoring…</span>
                </>
              ) : (
                'Restore this version'
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
