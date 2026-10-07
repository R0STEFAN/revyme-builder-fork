// SaveButton.tsx — Manual save button and project save status floating on the canvas.
// Displays status ('Saved' with checkmark / 'Saving…' / 'Save' when unsaved / 'Retry' on error).
// Triggered on click and synced with Ctrl+S / Cmd+S shortcut and background autosave.

import React, { useCallback, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { saveStatusAtom } from '@/backend/save-store';
import { flushSaveNow } from '@/backend/autosave';
import { flushNow } from '@/code/mutation/mutation-queue';
import { commitActiveTextEdit } from '@/canvas/text-edit-committer';
import { isComponentFileAtom } from '@/code/stores/store';
import { useIsViewer } from '@/code/stores/viewer-mode-store';
import { captureAndSaveProjectThumbnail } from '@/backend/thumbnail-capture';
import { trace } from '@/shared/debug-trace';
import { toast } from 'sonner';

/**
 * Save the entire project state immediately (flush pending text edits,
 * flush code mutation queue, and force persist to backend DB/storage).
 */
export async function saveProjectNow(): Promise<boolean> {
  trace.action('project:manual-save-start');
  try {
    // 1. Commit active text edit if open
    await commitActiveTextEdit();

    // 2. Flush AST mutation queue
    flushNow();

    // 3. Persist project snapshot to backend
    await flushSaveNow();

    // 4. Capture & save canvas screenshot thumbnail for dashboard
    void captureAndSaveProjectThumbnail();

    toast.success('Project saved');
    trace.action('project:manual-save-success');
    return true;
  } catch (err) {
    toast.error('Failed to save project');
    trace.error('project:manual-save-error', err);
    return false;
  }
}

const GLASS_BASE: React.CSSProperties = {
  backdropFilter: 'blur(16px) saturate(1.15)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
  boxShadow: '0 2px 8px -1px rgba(0, 0, 0, 0.2), 0 1px 3px -1px rgba(0, 0, 0, 0.1)',
};

export default function SaveButton({ className }: { className?: string } = {}) {
  const [saveStatus, setSaveStatus] = useAtom(saveStatusAtom);
  const isViewer = useIsViewer();
  const isComponentFile = useAtomValue(isComponentFileAtom);
  const [isManualSaving, setIsManualSaving] = useState(false);

  const isSaving = saveStatus === 'saving' || isManualSaving;

  const handleClick = useCallback(async () => {
    if (isViewer || isSaving) return;
    setIsManualSaving(true);
    setSaveStatus('saving');
    try {
      await saveProjectNow();
    } finally {
      setIsManualSaving(false);
    }
  }, [isViewer, isSaving, setSaveStatus]);

  // Determine appearance based on status
  let buttonStyle: React.CSSProperties = {};
  let content: React.ReactNode = null;

  if (isSaving) {
    buttonStyle = {
      background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-light)',
    };
    content = (
      <>
        <svg
          className="animate-spin w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
        <span className="truncate">Saving…</span>
      </>
    );
  } else if (saveStatus === 'saved') {
    buttonStyle = {
      background: 'rgba(34, 197, 94, 0.15)',
      color: '#22c55e',
      border: '1px solid rgba(34, 197, 94, 0.35)',
    };
    content = (
      <>
        <svg
          className="w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="truncate">Saved</span>
      </>
    );
  } else if (saveStatus === 'error') {
    buttonStyle = {
      background: 'rgba(239, 68, 68, 0.15)',
      color: '#ef4444',
      border: '1px solid rgba(239, 68, 68, 0.35)',
    };
    content = (
      <>
        <svg
          className="w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="truncate">Retry</span>
      </>
    );
  } else {
    // 'unsaved' state
    buttonStyle = {
      background: isComponentFile ? 'var(--accent-secondary)' : 'var(--accent)',
      color: 'var(--accent-fg, #ffffff)',
      border: '1px solid transparent',
    };
    content = (
      <>
        <svg
          className="w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span className="truncate">Save</span>
      </>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={isViewer || isSaving}
      tabIndex={-1}
      title="Save project (Ctrl+S / Cmd+S). Edits are autosaved automatically."
      data-testid="header-save-button"
      data-tutorial="canvas-save-button"
      className={
        className ??
        'flex items-center justify-center h-[32px] px-2.5 cut-corners cut-border text-xs font-semibold gap-1.5 cursor-pointer select-none transition-all duration-150 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'
      }
      style={buttonStyle}
    >
      {content}
    </button>
  );
}
