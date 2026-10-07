// ExpressionBoundPill.tsx — Value-column pill shown when text or href is driven by an Expression.
// Shows an `fx` badge + formula preview. Clicking opens the Expression Editor; × clears it.

import React from 'react';
import { RemoveButton } from './index';

interface ExpressionBoundPillProps {
  expression: string;
  onEdit: () => void;
  onClear: () => void;
  title?: string;
}

export function ExpressionBoundPill({ expression, onEdit, onClear, title }: ExpressionBoundPillProps) {
  return (
    <div
      onClick={onEdit}
      title={title || `Formula: ${expression}`}
      className="group relative flex items-center justify-between gap-1.5 h-[var(--control-height)] px-2 bg-purple-600/20 border border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-600/30 text-purple-200 cut-corners cut-border cursor-pointer transition-colors max-w-full min-w-0"
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
        <span className="shrink-0 text-[10px] font-bold tracking-wider px-1 py-0.2 rounded bg-purple-500/30 text-purple-300 font-mono">
          fx
        </span>
        <span className="text-xs font-mono truncate text-[var(--text-primary)]">
          {expression}
        </span>
      </div>
      <div
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
      >
        <RemoveButton onClick={onClear} />
      </div>
    </div>
  );
}

export default ExpressionBoundPill;
