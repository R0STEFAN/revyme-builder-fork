// ToolSection.tsx — Collapsible section wrapper.
// Title row: mixed-case label on left, optional action button on right.
// Content: flex column with consistent spacing, reused by every tool.
// When hasContent=false (or collapsed): no bottom margin, no separator.

import React, { useRef, useState } from 'react';
import { trace } from '@/shared/debug-trace';

interface Props {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  /** Action button rendered on the right side of the title row */
  action?: React.ReactNode;
  /** When false, section renders compact with no bottom spacing/separator.
   *  Useful for sections like Animation/Layout that may have no entries. */
  hasContent?: boolean;
}

export default function ToolSection({ title, children, defaultOpen = true, collapsible = true, action, hasContent = true }: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const actionRef = useRef<HTMLSpanElement>(null);

  // Right-click anywhere on the title row opens the SAME menu the `+` (or
  // toggle) button opens — the action's first button is clicked
  // programmatically, so every section's add-menu stays the single source of
  // its items (user request 2026-09-09). No action → the native menu is left
  // alone.
  const onHeaderContextMenu = (e: React.MouseEvent) => {
    const btn = actionRef.current?.querySelector('button');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    trace.action('tool-section:context-open-action', { title });
    btn.click();
  };

  const validChildren = React.Children.toArray(children).filter(Boolean);
  if (validChildren.length === 0) return null;

  const showContent = isOpen && hasContent;

  return (
    <div className="px-2">
      {/* Title row: label + action */}
      <div className={`${showContent ? 'mb-2' : 'mb-0'} flex items-center justify-between pt-3 pb-1.5`} onContextMenu={onHeaderContextMenu}>
        <span
          onClick={() => { if (collapsible) { setIsOpen(!isOpen); trace.action('tool-section:toggle', { title, isOpen: !isOpen }); } }}
          // Eyebrow, not a heading. Bold sentence-case at body size makes the
          // titles compete with the controls for attention and produces the
          // ruled-list rhythm this panel shares with every other builder. Small
          // + uppercase + tracked reads as a spec sheet: the titles recede and
          // the controls become the content.
          //
          // --text-PRIMARY, same as the row labels. Dimming the title looked
          // right in isolation but inverted the hierarchy in place: the labels
          // below it use --text-primary, so a grey title read as LESS important
          // than the rows it heads. The recession comes from size, case and
          // tracking instead — 10px uppercase tracked against 12px sentence
          // case is unmistakably a different role at the same colour.
          // Sentence case in the default UI stack (the display-font experiment
          // was retired 2026-08-20) — same face as the row labels, one size up
          // and semibold so the heading role still reads.
          className={`text-xs font-semibold text-[var(--text-primary)] ${collapsible ? 'cursor-pointer select-none flex-1' : ''} ${collapsible && !isOpen ? 'opacity-50' : ''}`}
        >
          {title}
        </span>
        <span ref={actionRef} className="flex items-center shrink-0">{action}</span>
      </div>
      {isOpen && showContent && (
        <div className="flex flex-col py-0.5 gap-[var(--control-gap)] pl-3">
          {children}
        </div>
      )}
    </div>
  );
}
