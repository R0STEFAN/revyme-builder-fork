import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DimensionRow } from './SizeTool';

afterEach(() => cleanup());

const ALL_UNITS = [
  { value: 'px', label: 'px' },
  { value: '%', label: '%' },
  { value: 'rem', label: 'rem' },
  { value: 'em', label: 'em' },
  { value: 'vw', label: 'vw' },
  { value: 'vh', label: 'vh' },
  { value: 'auto', label: 'fit' },
  { value: 'fill', label: 'fill' },
];

function renderRow(props: Partial<React.ComponentProps<typeof DimensionRow>> = {}) {
  const onChange = vi.fn();
  const onUnitChange = vi.fn();
  const utils = render(
    <DimensionRow
      label="Width"
      property="width"
      value="200px"
      onChange={onChange}
      onUnitChange={onUnitChange}
      computedSize={200}
      parentSize={800}
      unitOptions={ALL_UNITS}
      {...props}
    />
  );
  const input = utils.container.querySelector('input') as HTMLInputElement;
  const select = utils.container.querySelector('select') as HTMLSelectElement | null;
  const typeValue = (val: string) => {
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: val } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
  };
  return { ...utils, input, select, onChange, onUnitChange, typeValue };
}

describe('DimensionRow — Smart Unit Typing', () => {
  it('typing "100%" switches value and unit to %', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('100%');
    expect(onChange).toHaveBeenCalledWith('100%');
  });

  it('typing "50vh" switches value and unit to vh', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('50vh');
    expect(onChange).toHaveBeenCalledWith('50vh');
  });

  it('typing "10vw" switches value and unit to vw', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('10vw');
    expect(onChange).toHaveBeenCalledWith('10vw');
  });

  it('typing "2.5rem" switches value and unit to rem', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('2.5rem');
    expect(onChange).toHaveBeenCalledWith('2.5rem');
  });

  it('handles spaces between number and unit e.g. "100 %"', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('100 %');
    expect(onChange).toHaveBeenCalledWith('100%');
  });

  it('handles uppercase unit e.g. "50VH"', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('50VH');
    expect(onChange).toHaveBeenCalledWith('50vh');
  });

  it('typing a plain number "300" preserves the currently active unit (px)', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('300');
    expect(onChange).toHaveBeenCalledWith('300px');
  });

  it('typing a plain number "75" preserves the currently active unit (%)', () => {
    const { typeValue, onChange } = renderRow({ value: '50%' });
    typeValue('75');
    expect(onChange).toHaveBeenCalledWith('75%');
  });

  it('typing "fit" calls onUnitChange to auto', () => {
    const { typeValue, onUnitChange } = renderRow({ value: '200px' });
    typeValue('fit');
    expect(onUnitChange).toHaveBeenCalledWith('px', 'auto');
  });

  it('typing "fill" calls onUnitChange to fill', () => {
    const { typeValue, onUnitChange } = renderRow({ value: '200px' });
    typeValue('fill');
    expect(onUnitChange).toHaveBeenCalledWith('px', 'fill');
  });

  it('typing "100%" over auto/measured size sets 100% directly', () => {
    const { typeValue, onChange } = renderRow({ value: 'auto', currentUnit: 'auto' });
    typeValue('100%');
    expect(onChange).toHaveBeenCalledWith('100%');
  });

  it('typing a plain number "300" over auto switches to px via onUnitChange', () => {
    const { typeValue, onUnitChange, onChange } = renderRow({ value: 'auto', currentUnit: 'auto' });
    typeValue('300');
    expect(onUnitChange).toHaveBeenCalledWith('auto', 'px', 300);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('typing an unsupported unit "100xyz" falls back to active unit (px)', () => {
    const { typeValue, onChange } = renderRow({ value: '200px' });
    typeValue('100xyz');
    expect(onChange).toHaveBeenCalledWith('100px');
  });
});
