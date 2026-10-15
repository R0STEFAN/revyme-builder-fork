import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LinkPrefetchControl from './LinkPrefetchControl';

describe('LinkPrefetchControl', () => {
  it('renders prefetch options and handles change', () => {
    const onChange = vi.fn();
    render(<LinkPrefetchControl value="intent" onChange={onChange} />);

    expect(screen.getByText('Prefetch')).toBeDefined();
    expect(screen.getByText('Intent')).toBeDefined();

    // Click "View" (viewport)
    const viewButton = screen.getByText('View');
    fireEvent.click(viewButton);
    expect(onChange).toHaveBeenCalledWith('viewport');
  });

  it('renders overridden state with Reset Override', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <LinkPrefetchControl
        value="viewport"
        onChange={onChange}
        overridden={true}
        onResetOverride={onReset}
      />
    );

    // Should indicate overridden
    expect(screen.getByText('Prefetch')).toBeDefined();
    expect(screen.getByText('View')).toBeDefined();
  });
});
