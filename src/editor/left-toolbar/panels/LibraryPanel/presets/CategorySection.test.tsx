import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PresetToken } from '@/shared/types';
import type { CategoryConfig } from '../shared/types';
import type { LibraryMultiSelect } from '../shared/useLibraryMultiSelect';
import { CategorySection } from './CategorySection';

vi.mock('@/design-system/FolderTree', async () => {
  const ReactModule = await import('react');
  return {
    FolderTree: ({ rootOrder, renderItem }: { rootOrder: string[]; renderItem: (args: { itemId: string }) => React.ReactNode }) => ReactModule.createElement(
      'div',
      { 'data-testid': 'folder-tree', 'data-root-order': rootOrder.join('|') },
      ...rootOrder.map((itemId) => ReactModule.createElement(ReactModule.Fragment, { key: itemId }, renderItem({ itemId }))),
    ),
  };
});

vi.mock('@/design-system/SidebarRow', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ label, onClick, menuItems, right }: { label: string; onClick?: (event: React.MouseEvent) => void; menuItems?: Array<{ id?: string; label?: string; onClick?: () => void; type?: string }>; right?: React.ReactNode }) => ReactModule.createElement(
      'div',
      null,
      ReactModule.createElement('button', { type: 'button', 'data-testid': `row-${label}`, onClick }, label),
      right,
      ...(menuItems ?? []).filter((item) => item.type !== 'separator' && item.onClick).map((item) => ReactModule.createElement('button', { key: item.id, type: 'button', onClick: item.onClick }, item.label)),
    ),
  };
});

vi.mock('@/design-system/AddButton', () => ({
  default: React.forwardRef<HTMLButtonElement, { onClick?: () => void; title?: string }>(({ onClick, title }, ref) => <button ref={ref} type="button" title={title} onClick={onClick}>+</button>),
}));
vi.mock('@/design-system/DropdownMenu', () => ({ default: () => null }));
vi.mock('./UsagePopup', () => ({ UsageBadge: ({ count }: { count: number }) => <span data-testid="usage-count">{count}</span> }));

const prefixFor = { spacing: 'space', margin: 'margin', radius: 'radius' } as const;
const labelFor = { spacing: 'Padding', margin: 'Margin', radius: 'Radius' } as const;
const token = (name: string, category: PresetToken['category'], value = '16px'): PresetToken => ({ name, category, value });

function multiSelect(overrides: Partial<LibraryMultiSelect> = {}): LibraryMultiSelect {
  return {
    size: 0,
    isMultiSelected: () => false,
    togglePath: vi.fn(),
    clearSelection: vi.fn(),
    requestBulkDelete: vi.fn(),
    bulkDeleteModal: null as unknown as React.ReactElement,
    ...overrides,
  };
}

function renderSection(category: keyof typeof prefixFor, tokens: PresetToken[], options: {
  onDeletePreset?: (id: string) => void;
  multi?: LibraryMultiSelect;
  usageMap?: Map<string, Array<{ filePath: string; fileLabel: string; nodeId: string; nodeName: string }>>;
} = {}) {
  const config: CategoryConfig = {
    key: category,
    label: labelFor[category],
    prefix: prefixFor[category],
    defaultValue: '16px',
  };
  return render(<CategorySection
    config={config}
    tokens={tokens}
    editingName={null}
    renamingName={null}
    renameValue=""
    onRenameChange={vi.fn()}
    onRenameSubmit={vi.fn()}
    onRenameCancel={vi.fn()}
    onEdit={vi.fn()}
    onStartRename={vi.fn()}
    onDeletePreset={options.onDeletePreset ?? vi.fn()}
    creating={false}
    onStartCreate={vi.fn()}
    onCancelCreate={vi.fn()}
    onSubmitCreate={vi.fn()}
    collapsed={false}
    onToggleCollapse={vi.fn()}
    usageMap={options.usageMap ?? new Map()}
    multiSelect={options.multi ?? multiSelect()}
  />);
}

describe('CategorySection responsive dimension groups', () => {
  it.each(['spacing', 'margin', 'radius'] as const)('renders one family row for all %s tiers', (category) => {
    const prefix = prefixFor[category];
    renderSection(category, [
      token(`${prefix}-card`, category),
      token(`${prefix}-card-md`, category, '12px'),
      token(`${prefix}-card-sm`, category, '8px'),
    ]);

    expect(screen.getAllByTestId('row-Card')).toHaveLength(1);
    expect(screen.queryByTestId('row-Card Md')).toBeNull();
    expect(screen.queryByTestId('row-Card Sm')).toBeNull();
    expect(screen.getByTestId('folder-tree').getAttribute('data-root-order')).toBe(`${prefix}-card`);
  });

  it('keeps legacy single-token presets visible and category-scopes multi-select ids', () => {
    const spacingMulti = multiSelect();
    const radiusMulti = multiSelect();
    const renderOne = (category: 'spacing' | 'radius', multi: LibraryMultiSelect) => (
      <CategorySection
        config={{ key: category, label: labelFor[category], prefix: prefixFor[category], defaultValue: '16px' }}
        tokens={[token(`${prefixFor[category]}-card`, category)]}
        editingName={null} renamingName={null} renameValue=""
        onRenameChange={vi.fn()} onRenameSubmit={vi.fn()} onRenameCancel={vi.fn()}
        onEdit={vi.fn()} onStartRename={vi.fn()} onDeletePreset={vi.fn()}
        creating={false} onStartCreate={vi.fn()} onCancelCreate={vi.fn()} onSubmitCreate={vi.fn()}
        collapsed={false} onToggleCollapse={vi.fn()} usageMap={new Map()} multiSelect={multi}
      />
    );
    render(<>{renderOne('spacing', spacingMulti)}{renderOne('radius', radiusMulti)}</>);

    const cardRows = screen.getAllByTestId('row-Card');
    expect(cardRows).toHaveLength(2);
    fireEvent.click(cardRows[0], { shiftKey: true });
    fireEvent.click(cardRows[1], { shiftKey: true });
    expect(spacingMulti.togglePath).toHaveBeenCalledWith('dimension-group:spacing:card');
    expect(radiusMulti.togglePath).toHaveBeenCalledWith('dimension-group:radius:card');
  });

  it('deduplicates usage counts across sibling tokens and deletes through the group id', () => {
    const onDeletePreset = vi.fn();
    const usage = (nodeId: string) => ({ filePath: 'app/page.tsx', fileLabel: 'Home', nodeId, nodeName: 'Card' });
    const usageMap = new Map([
      ['space-card', [usage('node-1')]],
      ['space-card-md', [usage('node-1')]],
      ['space-card-sm', [usage('node-2')]],
    ]);
    renderSection('spacing', [
      token('space-card', 'spacing'),
      token('space-card-md', 'spacing', '12px'),
      token('space-card-sm', 'spacing', '8px'),
    ], { onDeletePreset, usageMap });

    const groupRow = screen.getByTestId('row-Card').parentElement!;
    expect(within(groupRow).getByTestId('usage-count').textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeletePreset).toHaveBeenCalledWith('dimension-group:spacing:card');
  });
});
