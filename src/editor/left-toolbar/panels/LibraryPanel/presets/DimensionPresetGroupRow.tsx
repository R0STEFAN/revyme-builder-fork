import React from 'react';
import SidebarRow from '@/design-system/SidebarRow';
import { type DropdownMenuEntry } from '@/design-system/DropdownMenu';
import { type PresetUsage } from '@/code/stores/preset-store';
import type { DimensionPresetGroup } from '@/shared/dimension-presets';
import { MULTI_SELECT_OUTLINE } from '../shared/section-utils';
import { UsageBadge } from './UsagePopup';

interface DimensionPresetGroupRowProps {
  group: DimensionPresetGroup;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  usages: PresetUsage[];
  onShiftClick?: (id: string) => void;
  isMultiSelected?: boolean;
  menuOverride?: DropdownMenuEntry[];
}

export function DimensionPresetGroupRow({
  group, isEditing, onEdit, onDelete, usages, onShiftClick, isMultiSelected, menuOverride,
}: DimensionPresetGroupRowProps) {
  const groupId = `dimension-group:${group.category}:${group.name}`;
  const menuItems: DropdownMenuEntry[] = menuOverride ?? [
    { id: 'edit', label: 'Edit', onClick: onEdit },
    { type: 'separator' },
    { id: 'delete', label: 'Delete', onClick: onDelete },
  ];

  return (
    <div style={isMultiSelected ? MULTI_SELECT_OUTLINE : undefined}>
      <SidebarRow
        label={group.label}
        icon={<span className="w-3.5 h-3.5 cut-corners cut-sm border border-[var(--text-tertiary)] block" aria-hidden="true" />}
        isActive={isEditing}
        menuItems={menuItems}
        onClick={(event: React.MouseEvent) => {
          if (event.shiftKey && onShiftClick) {
            event.preventDefault();
            event.stopPropagation();
            onShiftClick(groupId);
            return;
          }
          onEdit();
        }}
        style={{ cursor: 'pointer' }}
        right={(
          <div className="flex items-center gap-1.5 shrink-0">
            <UsageBadge count={usages.length} usages={usages} />
            <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)] select-none pointer-events-none">
              {group.base.value}
            </span>
          </div>
        )}
      />
    </div>
  );
}
