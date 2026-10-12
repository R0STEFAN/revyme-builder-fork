// RemoveButton — small inline "x" button for removing entries in lists.

import React from 'react';

export function RemoveButton({
  onClick,
  disabled = false,
  title,
}: {
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick(e);
      }}
      title={title}
      className={`text-sm ml-2 shrink-0 transition-colors ${
        disabled
          ? 'text-[var(--text-disabled)] opacity-30 cursor-not-allowed select-none'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'
      }`}
    >
      &times;
    </span>
  );
}

