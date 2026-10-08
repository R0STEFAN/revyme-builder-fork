// HistoryButton.tsx — Version history button placed next to SaveButton in the toolbar.
// Toggles the HistoryDropdown menu and opens VersionChangesModal for visual diff inspection.

import React, { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';
import { useIsViewer } from '@/code/stores/viewer-mode-store';
import { restoreProjectVersion } from '@/backend/version-history';
import HistoryDropdown from './HistoryDropdown';
import VersionChangesModal from './VersionChangesModal';

export default function HistoryButton({ className }: { className?: string } = {}) {
  const isViewer = useIsViewer();
  const [isOpen, setIsOpen] = useState(false);
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, isOpen, () => setIsOpen(false));

  const handleToggle = useCallback(() => {
    if (isViewer) return;
    setIsOpen((prev) => !prev);
  }, [isViewer]);

  const handleOpenReview = useCallback((versionId: string) => {
    setReviewVersionId(versionId);
    setIsOpen(false);
  }, []);

  const handleRestore = useCallback(async (versionId: string) => {
    await restoreProjectVersion(versionId);
  }, []);

  const buttonStyle: React.CSSProperties = {
    background: isOpen
      ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))'
      : 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
    color: isOpen ? 'var(--accent-text, var(--accent))' : 'var(--text-secondary)',
    border: isOpen ? '1px solid var(--accent)' : '1px solid var(--border-light)',
    backdropFilter: 'blur(16px) saturate(1.15)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isViewer}
        title="Version history (Ctrl+Z timeline · up to 100 saves on disk)"
        data-testid="header-history-button"
        className={
          className ??
          'flex items-center justify-center h-[32px] px-2.5 cut-corners cut-border text-xs font-semibold gap-1.5 cursor-pointer select-none transition-all duration-150 hover:brightness-110 hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed'
        }
        style={buttonStyle}
      >
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="truncate">History</span>
      </button>

      {/* History dropdown menu */}
      <HistoryDropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onOpenReview={handleOpenReview}
        onRestore={handleRestore}
      />

      {/* Version diff inspector modal */}
      {reviewVersionId && (
        <VersionChangesModal
          versionId={reviewVersionId}
          isOpen={!!reviewVersionId}
          onClose={() => setReviewVersionId(null)}
          onRestore={handleRestore}
        />
      )}
    </div>
  );
}
