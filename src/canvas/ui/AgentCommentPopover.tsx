import React, { useState, useEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  agentCommentDialogAtom,
  agentAttachedNodeAtom,
  agentQueuedRequestAtom,
  agentDraftPromptAtom,
} from '@/code/stores/agent-chat-store';
import { leftPanelAtom } from '@/code/stores/left-panel-store';
import { toast } from 'sonner';

export const AgentCommentPopover: React.FC = () => {
  const [dialog, setDialog] = useAtom(agentCommentDialogAtom);
  const setAttachedNode = useSetAtom(agentAttachedNodeAtom);
  const setQueuedRequest = useSetAtom(agentQueuedRequestAtom);
  const setDraftPrompt = useSetAtom(agentDraftPromptAtom);
  const setLeftPanel = useSetAtom(leftPanelAtom);

  const [commentText, setCommentText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dialog?.isOpen) {
      setCommentText('');
      // Auto-focus after mounting
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [dialog?.isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!dialog?.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setDialog(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog?.isOpen, setDialog]);

  if (!dialog || !dialog.isOpen) return null;

  const handleClose = () => {
    setDialog(null);
  };

  const handleAttachOnly = () => {
    setAttachedNode(dialog.refData);
    if (commentText.trim()) {
      setDraftPrompt(commentText.trim());
    }
    setLeftPanel('vibe');
    toast.success(`Attached "${dialog.targetNodeName || dialog.targetNodeId}" to agent chat`);
    handleClose();
  };

  const handleAskAgent = () => {
    const text = commentText.trim();
    if (!text) {
      // If empty, attach and open chat
      handleAttachOnly();
      return;
    }

    setAttachedNode(dialog.refData);
    setQueuedRequest({
      text,
      nonce: Date.now(),
    });
    setLeftPanel('vibe');
    toast.success(`Sent instructions to agent for "${dialog.targetNodeName || dialog.targetNodeId}"`);
    handleClose();
  };

  // Clamp popover position so it stays within viewport
  const popoverWidth = 320;
  const popoverHeight = 180;
  const posX = Math.max(16, Math.min(dialog.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - popoverWidth - 16));
  const posY = Math.max(16, Math.min(dialog.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - popoverHeight - 16));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9990] bg-transparent"
        onClick={handleClose}
      />

      {/* Popover Card */}
      <div
        ref={containerRef}
        data-testid="agent-comment-popover"
        className="fixed z-[9991] flex flex-col w-[320px] rounded-lg shadow-2xl border border-[var(--border-light,#333)] bg-[var(--bg-primary,#18181b)] text-[var(--text-primary,#fff)] p-3 animate-fadeIn"
        style={{ left: `${posX}px`, top: `${posY}px` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-light,#27272a)]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-[var(--accent,#3b82f6)] text-[var(--accent-fg,#fff)]">
              Agent Target
            </span>
            <span className="font-mono text-xs font-semibold truncate text-[var(--text-primary,#fafafa)] max-w-[150px]">
              {dialog.targetNodeName || dialog.targetNodeId}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-xs text-[var(--text-tertiary,#71717a)] hover:text-[var(--text-primary,#fff)] p-0.5"
            title="Cancel"
          >
            ✕
          </button>
        </div>

        {/* Comment textarea */}
        <textarea
          ref={textareaRef}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Add comment or instruction for the agent... (e.g. 'Make this button rounded with hover animation')"
          rows={3}
          className="w-full resize-none rounded bg-[var(--bg-secondary,#27272a)] border border-[var(--border-light,#3f3f46)] p-2 text-xs leading-relaxed text-[var(--text-primary,#fff)] placeholder:text-[var(--text-tertiary,#71717a)] focus:outline-none focus:border-[var(--accent,#3b82f6)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault();
              handleAskAgent();
            }
          }}
        />

        {/* Footer actions */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-light,#27272a)] text-xs">
          <button
            type="button"
            onClick={handleAttachOnly}
            className="text-[11px] text-[var(--text-secondary,#a1a1aa)] hover:text-[var(--text-primary,#fff)] transition-colors underline-offset-2 hover:underline"
          >
            Attach to Chat
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleClose}
              className="px-2 py-1 rounded text-[11px] text-[var(--text-secondary,#a1a1aa)] hover:bg-[var(--bg-hover,#27272a)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAskAgent}
              className="px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--accent,#3b82f6)] text-[var(--accent-fg,#fff)] hover:brightness-110 transition-[filter]"
            >
              Ask Agent
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
