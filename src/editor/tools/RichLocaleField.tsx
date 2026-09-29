// RichLocaleField.tsx — the translation panel's editor for a RICH text node.
//
// A node with inline marks is translated as ONE message of sanitized inline
// HTML (shared/rich-message.ts). reference parity: instead of a text area the
// translator gets the same kind of editor the canvas uses — bold / italic /
// underline / strike / link / font size — so a translation can move or drop
// a mark ("<strong>bonjour</strong> mon ami"). Commits on blur with the
// sanitized HTML; the caller writes the message + the canvas override.
import RichInlineEditor, { ensurePanelRichCss } from '../ui/RichInlineEditor';

interface Props {
  label: string;
  isDefault: boolean;
  /** Sanitized inline HTML. */
  initialHtml: string;
  /** Default-locale HTML shown faded when the field is empty. */
  placeholderHtml: string;
  onCommit: (html: string) => void;
}



export default function RichLocaleField({ label, isDefault, initialHtml, placeholderHtml, onCommit }: Props) {
  ensurePanelRichCss();
  // The DEFAULT locale is design, not translation: its text and run styles are
  // edited on the canvas, and every translation inherits those run styles.
  if (isDefault) return <RichDefaultPreview label={label} html={initialHtml} />;
  return <RichLocaleEditor label={label} initialHtml={initialHtml} placeholderHtml={placeholderHtml} onCommit={onCommit} />;
}

function RichDefaultPreview({ label, html }: { label: string; html: string }) {
  return (
    <div className="flex flex-col gap-1.5" data-locale-field={label} data-rich-locale-field data-rich-default-preview>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-disabled)]">Default</span>
      </div>
      <div
        className="revyme-rich-default-preview w-full px-2 py-2 text-xs leading-snug bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] cut-corners cut-border text-[var(--text-secondary)]"
        title="Edit the default text on the canvas — translations inherit its styling"
        dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
      />
    </div>
  );
}

function RichLocaleEditor({ label, initialHtml, placeholderHtml, onCommit }: Omit<Props, 'isDefault'>) {
  return (
    <div className="flex flex-col gap-1.5" data-locale-field={label} data-rich-locale-field>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{label}</span>
      </div>
      <RichInlineEditor
        label={label}
        html={initialHtml}
        placeholderHtml={placeholderHtml}
        fieldAttributes={{ 'data-locale-field': label }}
        onCommit={onCommit}
      />
    </div>
  );
}
