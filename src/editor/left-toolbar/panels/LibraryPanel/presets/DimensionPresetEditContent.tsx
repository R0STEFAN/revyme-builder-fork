import React, { useState } from 'react';
import { DesktopViewportIcon, TabletViewportIcon, MobileViewportIcon } from '@/shared/icons';
import ToolSegmentedControl from '@/editor/controls/ToolSegmentedControl';
import ControlLabel from '@/editor/controls/ControlLabel';
import { dimensionPresetTokenName, dimensionPresetValueError, type DimensionPresetGroup, type DimensionPresetTier } from '@/shared/dimension-presets';
import { trace } from '@/shared/debug-trace';

interface DimensionPresetEditContentProps {
  group: DimensionPresetGroup;
  onUpdate: (tokenName: string, value: string, category: DimensionPresetGroup['category']) => void;
  onDelete: (group: DimensionPresetGroup) => void;
  onClose: () => void;
}

const RESPONSIVE_TIERS: Array<{ value: DimensionPresetTier; ariaLabel: string; icon: React.ReactNode }> = [
  { value: 'base', ariaLabel: 'Desktop', icon: <DesktopViewportIcon size={14} className="text-[var(--text-secondary)]" /> },
  { value: 'md', ariaLabel: 'Tablet', icon: <TabletViewportIcon size={14} className="text-[var(--text-secondary)]" /> },
  { value: 'sm', ariaLabel: 'Mobile', icon: <MobileViewportIcon size={14} className="text-[var(--text-secondary)]" /> },
];

export function DimensionPresetEditContent({ group, onUpdate, onDelete, onClose }: DimensionPresetEditContentProps) {
  const [tier, setTier] = useState<DimensionPresetTier>('base');
  const [values, setValues] = useState<Record<DimensionPresetTier, string>>({
    base: group.base.value,
    md: group.md?.value ?? group.base.value,
    sm: group.sm?.value ?? group.base.value,
  });
  const [error, setError] = useState<string | null>(null);

  const handleTierChange = (next: string) => {
    const nextTier = next as DimensionPresetTier;
    setTier(nextTier);
    setError(null);
    trace.action('dimension-preset:tier-change', { category: group.category, name: group.name, tier: nextTier });
  };

  const handleValueChange = (value: string) => {
    setValues((current) => ({ ...current, [tier]: value }));
    const reason = dimensionPresetValueError(group.category, value);
    const tokenName = dimensionPresetTokenName(group.category, group.name, tier);
    setError(reason);
    if (reason) {
      trace.error('dimension-preset:reject-value', { category: group.category, tokenName, reason });
      return;
    }

    trace.action('dimension-preset:value-change', { category: group.category, tokenName, value });
    onUpdate(tokenName, value, group.category);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="border-t border-[var(--border-light)] pt-2 -mx-3 px-3 flex items-center justify-between">
        <ControlLabel label="Breakpoint" property="" plain />
        <ToolSegmentedControl
          value={tier}
          onChange={handleTierChange}
          options={RESPONSIVE_TIERS.map(({ value, ariaLabel, icon }) => ({ value, ariaLabel, icon }))}
          size="compact"
        />
      </div>

      <div className="flex items-center justify-between gap-3 w-full">
        <ControlLabel label="Value" property="" plain />
        <input
          aria-label="Value"
          type="text"
          value={values[tier]}
          onChange={(event) => handleValueChange(event.target.value)}
          aria-invalid={!!error}
          placeholder={group.category === 'margin' ? '16px or 0 auto' : '16px or 8px 16px'}
          className="w-32 h-[var(--control-height-sm)] px-2 text-xs text-right bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] cut-corners cut-border text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
        />
      </div>
      {error && <div role="alert" className="text-[10px] text-[var(--accent-danger,#dc2626)]">{error}</div>}
      {tier !== 'base' && !group[tier] && (
        <div className="text-[10px] text-[var(--text-tertiary)]">Inherits Desktop until changed.</div>
      )}
      <button
        type="button"
        onClick={() => onDelete(group)}
        className="self-start text-[10px] text-[var(--accent-danger,#dc2626)] hover:text-[var(--text-primary)] transition-colors"
      >
        Delete preset
      </button>
      <button
        type="button"
        onClick={onClose}
        className="self-start text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        Done
      </button>
    </div>
  );
}
