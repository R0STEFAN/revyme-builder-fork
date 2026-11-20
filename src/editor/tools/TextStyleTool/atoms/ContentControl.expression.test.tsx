/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../../controls', () => ({
  ToolInput: ({ value }: { value: string }) => <input aria-label="Content value" value={value} readOnly />,
  ControlLabel: () => <span>Content</span>,
}));
vi.mock('../../../controls/VariableBoundPill', () => ({ LegacyVariableBoundPill: () => null }));
vi.mock('../../../controls/ExpressionBoundPill', () => ({ ExpressionBoundPill: () => null }));
vi.mock('../../../controls/CmsBoundPill', () => ({ CmsBoundPill: () => null, CmsMissingPill: () => null, cmsOrphanInScope: () => null }));
vi.mock('../../../ui/FormattedContentButton', () => ({ default: () => null }));
vi.mock('../../../ui/ExpressionEditorPopup', () => ({
  default: ({ isOpen, initialExpression }: { isOpen: boolean; initialExpression: string }) =>
    isOpen ? <textarea aria-label="FX expression" value={initialExpression} readOnly /> : null,
}));
vi.mock('../../../controls/ControlProvider', () => ({
  useControl: () => ({
    node: { id: 'headline', type: 'h1', textContent: 'A "long" line\nwith \\ a path', children: [] },
    getValueSource: () => ({ source: 'literal' }),
    removeVariable: vi.fn(),
    cmsBinding: null,
  }),
}));
vi.mock('../../../hooks/useTextStyles', () => ({ useTextStyles: () => ({ isEditing: false }) }));
vi.mock('@/code/stores/node-family', () => ({ useNodesComputed: (select: (nodes: Map<string, unknown>) => unknown) => select(new Map()) }));

import { ContentControl } from './ContentControl';

describe('ContentControl FX editor', () => {
  it('opens with the current Content as an escaped quoted string', () => {
    render(<ContentControl />);
    expect((screen.getByRole('textbox', { name: 'Content value' }) as HTMLInputElement).value).toContain('A "long" line');
    fireEvent.click(screen.getByRole('button', { name: 'fx' }));
    expect((screen.getByRole('textbox', { name: 'FX expression' }) as HTMLTextAreaElement).value)
      .toBe('"A \\"long\\" line\\nwith \\\\ a path"');
  });
});
