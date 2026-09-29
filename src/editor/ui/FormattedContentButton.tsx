// FormattedContentButton.tsx — "Edit Content" button + its rich-editor popup,
// for any FORMATTED text value (sanitized inline HTML): a formatted-text
// variable on an instance (Component tool), or a formatted node's own text on a
// variant (Content row). Cmd+B / Cmd+I / Cmd+U, strike, link. The value is
// committed a beat after each edit and on close, so the canvas follows the
// typing through the normal write → parse → render loop.

import { useRef, useState } from 'react';
import ToolPopup from './ToolPopup';
import RichInlineEditor from './RichInlineEditor';

export default function FormattedContentButton({ title, value, onCommit, testId }: {
  /** Popup title. */
  title: string;
  /** Sanitized inline HTML. */
  value: string;
  onCommit: (html: string) => void;
  /** `data-formatted-text-edit` / `data-formatted-text-field` value (tests, traces). */
  testId: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-formatted-text-edit={testId}
        onClick={() => setOpen(true)}
        className="w-full min-w-0 h-[var(--control-height)] flex items-center justify-center px-2 cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] bg-[var(--control-bg)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] text-xs text-[var(--text-primary)] transition-colors cursor-pointer"
      >
        Edit Content
      </button>
      <ToolPopup isOpen={open} onClose={() => setOpen(false)} title={title} anchorRef={btnRef} width={300}>
        {open && (
          <RichInlineEditor
            label={testId}
            html={value}
            autoFocus
            minHeightClass="min-h-[120px]"
            fieldAttributes={{ 'data-formatted-text-field': testId }}
            commitDelayMs={250}
            onCommit={onCommit}
          />
        )}
      </ToolPopup>
    </>
  );
}
