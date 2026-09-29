// RichInlineEditor.tsx — a small TipTap editor for sanitized INLINE HTML.
//
// Shared by every panel surface that edits formatted text outside the canvas:
// the translation panel's rich message field and the formatted-text variable
// (instance "Edit Content" popup + Variable modal default). Bold / italic /
// underline / strike / link — the marks shared/rich-message.ts allows — with
// the editor's own Cmd+B / Cmd+I / Cmd+U. Paragraphs flatten to `<br>`
// (unwrapParagraphs) so the value stays inline and fits any text tag.
//
// Commits the sanitized HTML on blur, on unmount (a popup closed with Escape
// never blurs), after each link change, and — with `commitDelayMs` — while
// typing, so the canvas re-renders from source as you go (the canvas lives in
// an iframe; there is no cheap DOM preview from the panel).
//
// The link button opens a separate Link popup over the editor (Framer's text
// link popup) — the Link tool's page / URL picker, the target page's Section
// anchors, New Tab — instead of a prompt.
import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontSize } from '@/canvas/tiptap-extensions';
import { sanitizeRichMessage } from '@/shared/rich-message';
import { trace } from '@/shared/debug-trace';
import { ControlLabel, ToolSegmentedControl } from '../controls';
import { LinkUrlField } from '../tools/LinkTool/LinkUrlControl';
import ToolPopup from './ToolPopup';
import LinkSectionControl from '../tools/LinkTool/LinkSectionControl';

// The HTML can carry run styles (font-size / colour / family) for the canvas
// to paint; inside the PANEL those must not apply — a 58px run made the field
// unreadable. Inline styles beat utility classes, so this scoped sheet
// neutralises them with !important while keeping the structural marks
// (bold / italic / underline / strike) visible.
const PANEL_RICH_CSS = `
.revyme-rich-locale-field span, .revyme-rich-default-preview span,
.revyme-rich-locale-field a, .revyme-rich-default-preview a {
  font-size: inherit !important; line-height: inherit !important; font-family: inherit !important;
  letter-spacing: normal !important; color: inherit !important; background: none !important;
  -webkit-text-fill-color: inherit !important; text-transform: none !important; opacity: 1 !important;
}
.revyme-rich-locale-field a, .revyme-rich-default-preview a { text-decoration: underline !important; }
.revyme-rich-locale-field p { margin: 0; }
`;
let panelCssInjected = false;
export function ensurePanelRichCss(): void {
  if (panelCssInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-revyme-rich-locale-css', '');
  el.textContent = PANEL_RICH_CSS;
  document.head.appendChild(el);
  panelCssInjected = true;
}

const BTN = 'w-6 h-6 flex items-center justify-center text-[11px] cut-corners transition-colors cursor-pointer hover:bg-[var(--bg-hover)]';
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
/** Internal page links split into page + `#section`; external / mail / phone stay whole. */
const isExternalHref = (href: string) => /^(https?:|mailto:|tel:)/i.test(href);

interface Props {
  /** Sanitized inline HTML. */
  html: string;
  onCommit: (html: string) => void;
  /** Every edit, sanitized. */
  onInput?: (html: string) => void;
  /** Also commit this long after the last edit (live source updates while typing). */
  commitDelayMs?: number;
  /** Shown faded while the editor is empty. */
  placeholderHtml?: string;
  /** Extra attributes on the editable element (e.g. `data-locale-field`). */
  fieldAttributes?: Record<string, string>;
  /** Tailwind min-height class of the editable area. */
  minHeightClass?: string;
  autoFocus?: boolean;
  /** Trace label. */
  label: string;
}

export default function RichInlineEditor({
  html, onCommit, onInput, commitDelayMs, placeholderHtml, fieldAttributes, minHeightClass = 'min-h-[40px]', autoFocus, label,
}: Props) {
  ensurePanelRichCss();
  // What the editor holds (sanitized) and what was last handed to onCommit. Loading a value
  // sets both, so an untouched field never commits TipTap's normalisation (`<b>` → `<strong>`).
  const latestHtml = useRef(html);
  const lastCommitted = useRef(html);
  // Values THIS editor produced. The caller echoes them back through `html` (optimistic panel
  // state, then the source round-trip — possibly a debounce behind the typing); an echo is not an
  // external change and must never reload the editor: the reload reset the caret and dropped the
  // edit, so closing the popup had nothing left to commit (2026-09-29).
  const emitted = useRef(new Set<string>());
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const linkBtnRef = useRef<HTMLButtonElement>(null);
  const [, forceRender] = useState(0);

  const remember = (value: string) => {
    if (emitted.current.size > 64) emitted.current.clear();
    emitted.current.add(value);
  };

  const commit = () => {
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    const next = latestHtml.current;
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    remember(next);
    trace.action('rich-inline-editor:commit', { label, html: next.slice(0, 60) });
    onCommit(next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const delayRef = useRef(commitDelayMs);
  delayRef.current = commitDelayMs;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, bulletList: false, orderedList: false, listItem: false,
        blockquote: false, codeBlock: false, horizontalRule: false,
        hardBreak: { keepMarks: true },
        // A click selects the link (and shows it in the Link panel) instead of navigating; the
        // target is per link (New Tab), never TipTap's blanket `_blank` + nofollow.
        link: { openOnClick: false, HTMLAttributes: { target: null, rel: null } },
      }),
      TextStyle,
      Color,
      FontSize,
    ],
    content: html ? `<p>${html}</p>` : '<p></p>',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: `revyme-rich-locale-field outline-none ${minHeightClass} text-xs leading-snug px-2 py-2`,
        ...(fieldAttributes ?? {}),
      },
    },
    onSelectionUpdate: () => forceRender((n) => n + 1),
    onTransaction: () => forceRender((n) => n + 1),
    onUpdate: ({ editor: ed }) => {
      latestHtml.current = sanitizeRichMessage(ed.getHTML());
      remember(latestHtml.current);
      onInputRef.current?.(latestHtml.current);
      if (delayRef.current != null) {
        if (commitTimer.current) clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(() => commitRef.current(), delayRef.current);
      }
    },
  });

  // A genuinely external change (locale switch / undo / another selection) → reload.
  useEffect(() => {
    if (!editor) return;
    if (html === latestHtml.current || emitted.current.has(html)) return;
    trace.action('rich-inline-editor:external-reload', { label });
    latestHtml.current = html;
    lastCommitted.current = html;
    emitted.current.clear();
    editor.commands.setContent(html ? `<p>${html}</p>` : '<p></p>', { emitUpdate: false });
  }, [editor, html, label]);

  // Unmount (popup closed without a blur) → commit what was typed.
  useEffect(() => () => commitRef.current(), []);

  const isEmpty = !!editor && editor.getText().trim() === '';

  return (
    <div
      className="relative w-full bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] cut-corners cut-border text-[var(--text-primary)]"
      // Keep typing (Cmd+B, Backspace, arrows…) away from the builder's shortcuts.
      onKeyDown={(e) => { e.stopPropagation(); }}
      onBlur={(e) => {
        // Commit when focus leaves the whole field (toolbar clicks stay inside; the Link popup commits its own).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
    >
      <div className="flex items-center gap-0.5 px-1 pt-1 border-b border-[var(--border-light)] pb-1">
        <button type="button" tabIndex={-1} title="Bold (⌘B)" className={`${BTN} font-bold ${editor?.isActive('bold') ? 'bg-[var(--bg-hover)]' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}>B</button>
        <button type="button" tabIndex={-1} title="Italic (⌘I)" className={`${BTN} italic ${editor?.isActive('italic') ? 'bg-[var(--bg-hover)]' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</button>
        <button type="button" tabIndex={-1} title="Underline (⌘U)" className={`${BTN} underline ${editor?.isActive('underline') ? 'bg-[var(--bg-hover)]' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleUnderline().run()}>U</button>
        <button type="button" tabIndex={-1} title="Strikethrough" className={`${BTN} line-through ${editor?.isActive('strike') ? 'bg-[var(--bg-hover)]' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleStrike().run()}>S</button>
        <button ref={linkBtnRef} type="button" tabIndex={-1} title="Link" data-rich-link-toggle className={`${BTN} ${linkOpen || editor?.isActive('link') ? 'bg-[var(--bg-hover)]' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setLinkOpen((o) => !o)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
        </button>
      </div>
      {editor && (
        <ToolPopup isOpen={linkOpen} onClose={() => setLinkOpen(false)} title="Link" anchorRef={linkBtnRef} width={260} nested>
          <RichLinkPanel editor={editor} onApplied={() => commitRef.current()} />
        </ToolPopup>
      )}
      {isEmpty && placeholderHtml && (
        <div className="revyme-rich-default-preview pointer-events-none absolute left-2 top-[34px] right-2 text-xs leading-snug text-[var(--text-disabled)] truncate" dangerouslySetInnerHTML={{ __html: placeholderHtml }} />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

type TipTapEditor = NonNullable<ReturnType<typeof useEditor>>;

/**
 * The Link popup's content — the Link tool's controls for the link under the selection: Link To (pages,
 * CMS routes or a typed URL), Section (anchors on the linked page) and New Tab.
 * Writes through TipTap on the editor's own selection — ProseMirror keeps it
 * while focus is in these fields — so the editor never has to refocus.
 */
function RichLinkPanel({ editor, onApplied }: { editor: TipTapEditor; onApplied: () => void }) {
  const attrs = editor.getAttributes('link') as { href?: string; target?: string | null };
  const href = attrs.href ?? '';
  const inLink = editor.isActive('link');
  const hasSelection = !editor.state.selection.empty;
  const external = isExternalHref(href);
  const [pagePart, sectionPart = ''] = external ? [href, ''] : href.split('#');

  const apply = (next: { href?: string; target?: string | null }) => {
    const nextHref = next.href ?? href;
    const target = 'target' in next ? next.target ?? null : attrs.target ?? null;
    // Inside a link the whole link is edited; otherwise the selected text becomes one.
    const chain = editor.chain().extendMarkRange('link');
    if (!nextHref) chain.unsetLink().run();
    else chain.setLink({ href: nextHref, target }).run();
    trace.action('rich-inline-editor:link', { href: nextHref, target });
    onApplied();
  };

  if (!inLink && !hasSelection) {
    return (
      <div className="px-3 pb-3 pt-1 text-[11px] text-[var(--text-secondary)]" data-rich-link-panel>
        Select the text to link.
      </div>
    );
  }

  // Same rows as the Link tool / link-variable popup (ControlLabel + field; `pl-5` = the label's
  // chevron footprint).
  const row = 'flex items-center justify-between w-full';
  return (
    <div className="flex flex-col gap-2 pl-5 pr-3 pb-3 pt-1" data-rich-link-panel>
      <div className={row}>
        <ControlLabel label="Link" property="__link-to" plain />
        <LinkUrlField value={href} onChange={(v) => apply({ href: v })} />
      </div>
      {!!href && !external && (
        <LinkSectionControl
          pageSlug={pagePart || '/'}
          value={sectionPart}
          onChange={(section) => apply({ href: section ? `${pagePart || '/'}#${section}` : (pagePart || '/') })}
        />
      )}
      {!!href && (
        <div className={row}>
          <ControlLabel label="New Tab" property="__link-new-tab" plain />
          <ToolSegmentedControl
            value={attrs.target === '_blank' ? 'yes' : 'no'}
            onChange={(v) => apply({ target: v === 'yes' ? '_blank' : null })}
            options={YES_NO}
            size="sm"
          />
        </div>
      )}
      {inLink && (
        <button
          type="button"
          className="self-end text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply({ href: '' })}
        >
          Remove link
        </button>
      )}
    </div>
  );
}
