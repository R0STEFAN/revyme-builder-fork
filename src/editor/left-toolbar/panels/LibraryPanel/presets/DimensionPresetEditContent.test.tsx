import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PresetToken } from '@/shared/types';
import type { DimensionPresetGroup } from '@/shared/dimension-presets';
import { DimensionPresetEditContent } from './DimensionPresetEditContent';

const makeToken = (name: string, value: string, category: PresetToken['category'] = 'spacing'): PresetToken => ({
  name,
  value,
  category,
});

describe('DimensionPresetEditContent', () => {
  const base = makeToken('space-card', '16px');
  const group: DimensionPresetGroup = {
    name: 'card',
    label: 'Card',
    category: 'spacing',
    tokens: [base],
    base,
  };

  it('shows icon-only breakpoint controls with accessible names and inherits the base when a tier is absent', () => {
    render(<DimensionPresetEditContent group={group} onUpdate={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /desktop/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /tablet/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /mobile/i })).toBeTruthy();
    expect(screen.queryByText('Desktop')).toBeNull();
    expect(screen.queryByText('Tablet')).toBeNull();
    expect(screen.queryByText('Mobile')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', '16px');

    fireEvent.click(screen.getByRole('button', { name: /tablet/i }));
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', '16px');
  });

  it('creates an optional tier only after a valid edit and rejects non-pixel values', () => {
    const onUpdate = vi.fn();
    render(<DimensionPresetEditContent group={group} onUpdate={onUpdate} onDelete={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /tablet/i }));
    expect(onUpdate).not.toHaveBeenCalled();

    const input = screen.getByRole('textbox', { name: 'Value' });
    fireEvent.change(input, { target: { value: '1rem' } });
    expect(screen.getByText(/must use pixels/i)).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '8px 12px' } });
    expect(onUpdate).toHaveBeenCalledWith('space-card-md', '8px 12px', 'spacing');
  });
});
