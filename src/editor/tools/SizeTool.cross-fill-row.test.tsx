import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DimensionRow } from './SizeTool';

// A cross-axis Fill (align-self: stretch) showed "925 fr": the row treated every Fill as the
// main-axis grow, whose number is an `fr` multiplier. A stretch has no multiplier — the number
// is the measured size, shown like Fit (greyed, no `fr`), and typing one switches to px.

afterEach(() => cleanup());
const UNITS = [{ value: 'px', label: 'px' }, { value: 'fill', label: 'fill' }];

const row = (over: Partial<React.ComponentProps<typeof DimensionRow>>) => (
  <DimensionRow
    label="Height" property={undefined} value="925" onChange={vi.fn()} onUnitChange={vi.fn()}
    computedSize={925} parentSize={925} unitOptions={UNITS} currentUnit="fill" {...over}
  />
);

describe('DimensionRow — Fill display', () => {
  it('cross-axis fill: the measured size, no fr', () => {
    const { container } = render(row({ fillCross: true }));
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('925');
    expect(container.textContent).not.toContain('fr');
  });

  it('main-axis fill keeps its fr multiplier', () => {
    const { container } = render(row({ value: '2', computedSize: 400 }));
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('2');
    expect(container.textContent).toContain('fr');
  });

  it('typing a number on a cross-axis fill switches to px (not a multiplier write)', () => {
    const onChange = vi.fn();
    const onUnitChange = vi.fn();
    const { container } = render(row({ fillCross: true, onChange, onUnitChange }));
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '300' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
    expect(onUnitChange).toHaveBeenCalledWith('fill', 'px', 300);
    expect(onChange).not.toHaveBeenCalled();
  });
});
