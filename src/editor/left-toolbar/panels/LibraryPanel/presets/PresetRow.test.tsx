import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { getPresetNumericValue } from '../shared/format-utils';
import { PresetRow } from './PresetRow';
import type { PresetToken } from '@/shared/types';

describe('getPresetNumericValue', () => {
  it('returns dimension value for radius tokens', () => {
    expect(getPresetNumericValue({ category: 'radius', value: '16px' })).toBe('16px');
    expect(getPresetNumericValue({ category: 'radius', value: '8px' })).toBe('8px');
    expect(getPresetNumericValue({ category: 'radius', value: '100px' })).toBe('100px');
    expect(getPresetNumericValue({ category: 'radius', value: '9999px' })).toBe('9999px');
  });

  it('returns dimension value for spacing (padding) tokens', () => {
    expect(getPresetNumericValue({ category: 'spacing', value: '80px' })).toBe('80px');
    expect(getPresetNumericValue({ category: 'spacing', value: '24px' })).toBe('24px');
    expect(getPresetNumericValue({ category: 'spacing', value: '16px 24px' })).toBe('16px 24px');
  });

  it('returns dimension value for margin tokens', () => {
    expect(getPresetNumericValue({ category: 'margin', value: '16px' })).toBe('16px');
    expect(getPresetNumericValue({ category: 'margin', value: '0 auto' })).toBe('0 auto');
  });

  it('returns null for color tokens', () => {
    expect(getPresetNumericValue({ category: 'color', value: '#6366f1' })).toBeNull();
    expect(getPresetNumericValue({ category: 'color', value: '#ffffff' })).toBeNull();
    expect(getPresetNumericValue({ category: 'color', value: 'rgb(255, 255, 255)' })).toBeNull();
    expect(getPresetNumericValue({ category: 'color', value: 'rgba(0, 0, 0, 0.5)' })).toBeNull();
    expect(getPresetNumericValue({ category: 'color', value: 'hsl(210, 50%, 50%)' })).toBeNull();
  });

  it('returns null for media and asset tokens', () => {
    expect(getPresetNumericValue({ category: 'image', value: 'https://example.com/photo.jpg' })).toBeNull();
    expect(getPresetNumericValue({ category: 'image', value: 'url(/asset.png)' })).toBeNull();
    expect(getPresetNumericValue({ category: 'video', value: 'https://example.com/video.mp4' })).toBeNull();
  });

  it('returns null for shadow tokens', () => {
    expect(getPresetNumericValue({ category: 'shadow', value: '0 1px 3px rgba(0,0,0,0.1)' })).toBeNull();
    expect(getPresetNumericValue({ category: 'shadow', value: '0 4px 12px rgba(0,0,0,0.2)' })).toBeNull();
  });

  it('handles custom dimension tokens and units', () => {
    expect(getPresetNumericValue({ category: 'other', value: '24px' })).toBe('24px');
    expect(getPresetNumericValue({ category: 'other', value: '1.5rem' })).toBe('1.5rem');
    expect(getPresetNumericValue({ category: 'other', value: '2em' })).toBe('2em');
    expect(getPresetNumericValue({ category: 'other', value: '100%' })).toBe('100%');
    expect(getPresetNumericValue({ category: 'other', value: '50vh' })).toBe('50vh');
    expect(getPresetNumericValue({ category: 'other', value: '32' })).toBe('32');
  });

  it('returns null for non-numeric strings or empty values', () => {
    expect(getPresetNumericValue({ category: 'other', value: 'Inter, sans-serif' })).toBeNull();
    expect(getPresetNumericValue({ category: 'other', value: 'none' })).toBeNull();
    expect(getPresetNumericValue({ category: 'spacing', value: '' })).toBeNull();
    expect(getPresetNumericValue(null)).toBeNull();
    expect(getPresetNumericValue(undefined)).toBeNull();
  });
});

describe('PresetRow rendering', () => {
  const defaultProps = {
    isEditing: false,
    isRenaming: false,
    renameValue: '',
    onRenameChange: vi.fn(),
    onRenameSubmit: vi.fn(),
    onRenameCancel: vi.fn(),
    onEdit: vi.fn(),
    onStartRename: vi.fn(),
    onDelete: vi.fn(),
    usages: [],
  };

  it('renders numeric dimension value for a radius preset', () => {
    const token: PresetToken = {
      name: 'radius-card',
      value: '16px',
      category: 'radius',
      label: 'Card Radius',
    };

    render(<PresetRow {...defaultProps} token={token} />);
    expect(screen.getByText('Card Radius')).toBeTruthy();
    expect(screen.getByText('16px')).toBeTruthy();
  });

  it('renders numeric dimension value for a spacing preset', () => {
    const token: PresetToken = {
      name: 'space-section-y',
      value: '80px',
      category: 'spacing',
      label: 'Section Y',
    };

    render(<PresetRow {...defaultProps} token={token} />);
    expect(screen.getByText('Section Y')).toBeTruthy();
    expect(screen.getByText('80px')).toBeTruthy();
  });

  it('does NOT render numeric value for a color preset', () => {
    const token: PresetToken = {
      name: 'color-brand',
      value: '#6366f1',
      category: 'color',
      label: 'Brand',
    };

    render(<PresetRow {...defaultProps} token={token} />);
    expect(screen.getByText('Brand')).toBeTruthy();
    expect(screen.queryByText('#6366f1')).toBeNull();
  });

  it('renders usage count badge alongside numeric dimension value', () => {
    const token: PresetToken = {
      name: 'radius-button',
      value: '8px',
      category: 'radius',
      label: 'Button Radius',
    };
    const usages = [
      { filePath: 'app/page.tsx', fileLabel: 'Home', nodeId: 'btn-1', nodeName: 'Button' },
      { filePath: 'app/about/page.tsx', fileLabel: 'About', nodeId: 'btn-2', nodeName: 'Button' },
    ];

    render(<PresetRow {...defaultProps} token={token} usages={usages} />);
    expect(screen.getByText('Button Radius')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('8px')).toBeTruthy();
  });
});
