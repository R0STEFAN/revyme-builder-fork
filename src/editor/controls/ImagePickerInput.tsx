// ImagePickerInput.tsx — Reusable image-picker input row.
//
// Shows a small thumbnail + URL chip (truncated) + ×, click anywhere on the
// row opens the existing `ImageSearchModal` (Unsplash + upload + URL paste).
// On select, wraps the chosen URL in `url(...)` so the value drops straight
// into a CSS `backgroundImage:` slot (or any other image-bearing property)
// without runtime wrapping.
//
// Used by:
//   - PageVariablesModal — default-value editor for `image` variables
//   - InteractionsTool   — Set Variable form's value control on `image` vars
//
// Why centralise this? Both call sites need the same behaviour (show
// thumbnail, swap via picker, clear via ×) and divergence between them
// would be a paper-cut whenever the picker UX changes.

import { useState, useCallback } from 'react';
import ImageSearchModal from '../ui/ImageSearchModal';
import { trace } from '@/shared/debug-trace';

interface ImagePickerInputProps {
  /** CSS image value — e.g. `url(https://...)` or bare URL, or empty. */
  value: string;
  onChange: (value: string) => void;
  /** Optional placeholder text shown when no image is set. */
  placeholder?: string;
  /** When true, emits bare URL instead of wrapping in `url(...)` (for HTML attributes like img src). */
  rawUrl?: boolean;
}

/** Pull URL out of `url(...)` wrapper (handles single/double/no quotes). */
function extractUrl(value: string): string | null {
  if (!value) return null;
  const m = value.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
  if (m) {
    const inner = m[1].trim();
    if (inner.startsWith('var:')) return null;
    return inner;
  }
  if (value.startsWith('var:')) return null;
  if (value.startsWith('http') || value.startsWith('/') || value.startsWith('data:')) return value;
  return null;
}

export default function ImagePickerInput({
  value,
  onChange,
  placeholder = 'Choose image…',
  rawUrl = false,
}: ImagePickerInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const url = extractUrl(value) ?? '';
  const hasImage = url.length > 0;

  const handleSelect = useCallback((picked: string) => {
    // If rawUrl is requested (HTML attrs like <img> src), emit bare URL; otherwise CSS-ready url(...)
    onChange(rawUrl ? picked : `url(${picked})`);
    trace.action('image-picker-input:select', { url: picked.slice(0, 80), rawUrl });
  }, [onChange, rawUrl]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    trace.action('image-picker-input:clear');
  }, [onChange]);

  return (
    <>
      {hasImage ? (
        <div className="flex items-center gap-2">
          {/* Image preview thumbnail — clicking opens picker to change image */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="group relative h-10 w-10 cut-corners cut-border border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--border-focus)] hover:[--cut-border-color:var(--border-focus)] overflow-hidden cursor-pointer bg-[var(--grid-line)] transition-colors shrink-0"
            title={url}
          >
            <img
              src={url}
              alt="Preview"
              className="w-full h-full object-cover transition-transform group-hover:scale-105 pointer-events-none"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="text-[8px] text-white font-medium bg-black/70 px-1 py-0.5 rounded leading-none">Change</span>
            </div>
          </button>

          {/* Clear button */}
          <button
            type="button"
            onClick={handleClear}
            className="h-6 px-1.5 text-xs text-[var(--text-secondary)] hover:text-red-400 hover:bg-[var(--bg-hover)] cut-corners transition-colors cursor-pointer"
            title="Clear image"
          >
            Clear
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="h-8 flex items-center gap-2 px-2.5 bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] cut-corners cut-border hover:border-[var(--border-focus)] hover:[--cut-border-color:var(--border-focus)] transition-colors cursor-pointer text-left min-w-0"
          title={placeholder}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--text-secondary)] shrink-0"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span className="text-xs text-[var(--text-secondary)] truncate">
            {placeholder}
          </span>
        </button>
      )}

      <ImageSearchModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          handleSelect(picked);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
