// ConvertToImageModal.tsx — Choice dialog shown when converting a container with children into an image.
// Offers two modes:
// 1. "nested-background": Keeps the container div, styles, gradients and children intact,
//    and inserts a semantic absolute <img /> element inside behind the content for Google & SEO.
// 2. "replace": Clears child elements and directly converts the container into a self-closing <img /> tag.

import Modal from '@/design-system/Modal';

export interface ConvertToImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: 'replace' | 'nested-background') => void;
  childCount?: number;
}

export default function ConvertToImageModal({
  isOpen,
  onClose,
  onConfirm,
  childCount = 1,
}: ConvertToImageModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Convert to Image"
      width={420}
    >
      <div className="p-4 flex flex-col gap-4 text-left">
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {childCount === 1
            ? 'This container has 1 child element. Choose how to convert:'
            : `This container has ${childCount} child elements. Choose how to convert:`}
        </p>

        {/* Option 1: Nested image (Recommended) */}
        <button
          type="button"
          onClick={() => {
            onConfirm('nested-background');
            onClose();
          }}
          className="group relative p-3 text-left border border-[var(--border-light)] hover:border-[var(--accent)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] cut-corners transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
              Keep content & styling (Nested &lt;img&gt;)
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
              Recommended
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] leading-snug">
            The container keeps all styles, gradients, and child elements intact. The image is added as a real semantic &lt;img&gt; tag inside, positioned behind the content for SEO and performance.
          </p>
        </button>

        {/* Option 2: Direct replace */}
        <button
          type="button"
          onClick={() => {
            onConfirm('replace');
            onClose();
          }}
          className="group relative p-3 text-left border border-[var(--border-light)] hover:border-red-500/50 bg-[var(--bg-card)] hover:bg-red-500/5 cut-corners transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-red-400">
              Clear children & convert directly to &lt;img&gt;
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] leading-snug">
            Removes all child elements (text, buttons) and converts the container directly into a self-closing &lt;img /&gt; tag.
          </p>
        </button>

        {/* Footer / Cancel */}
        <div className="flex justify-end pt-2 border-t border-[var(--border-light)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cut-corners transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
