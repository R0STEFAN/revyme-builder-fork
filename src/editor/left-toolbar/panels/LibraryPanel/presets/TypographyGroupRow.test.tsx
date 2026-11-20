import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TypographyGroupRow } from './TypographyGroupRow';
import type { TypoGroup } from '@/editor/tools/typography-utils';

describe('TypographyGroupRow', () => {
  it('keeps a preset name readable beside a fluid font size', () => {
    const size = 'clamp(4.375rem, 10.82vw, 10rem)';
    const group: TypoGroup = {
      name: 'heading',
      label: 'Heading',
      tokens: [
        { name: 'typo-heading-tag', value: 'h1', category: 'typography' },
        { name: 'typo-heading-size', value: size, category: 'typography' },
      ],
    };

    render(<TypographyGroupRow
      group={group} isEditing={false} isRenaming={false}
      onStartRename={vi.fn()} onRenameCommit={vi.fn()} onEdit={vi.fn()}
      onDelete={vi.fn()} onDuplicate={vi.fn()} usages={[]}
    />);

    const name = screen.getByText('Heading');
    const value = screen.getByText(size);
    expect(name.className).toContain('min-w-0');
    expect(value.parentElement?.className).toContain('max-w-[40%]');
    expect(value.className).toContain('truncate');
    expect(value.getAttribute('title')).toBe(size);
    expect(value.className).not.toContain('pointer-events-none');
  });
});
