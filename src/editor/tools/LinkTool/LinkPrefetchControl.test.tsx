import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LinkPrefetchControl from './LinkPrefetchControl';

describe('LinkPrefetchControl', () => {
  it('renders prefetch options and handles change via dropdown', () => {
    const onChange = vi.fn();
    const { container } = render(<LinkPrefetchControl value="intent" onChange={onChange} />);

    expect(screen.getByText('Prefetch')).toBeDefined();
    const select = container.querySelector('select');
    expect(select).toBeDefined();
    expect(select?.value).toBe('intent');

    // Change to viewport
    fireEvent.change(select!, { target: { value: 'viewport' } });
    expect(onChange).toHaveBeenCalledWith('viewport');
  });

  it('renders overridden state with Reset Override', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    const { container } = render(
      <LinkPrefetchControl
        value="viewport"
        onChange={onChange}
        overridden={true}
        onResetOverride={onReset}
      />
    );

    expect(screen.getByText('Prefetch')).toBeDefined();
    const select = container.querySelector('select');
    expect(select?.value).toBe('viewport');
  });
});
