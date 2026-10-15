import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState, useRef } from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import PageEffectPopup from './PageEffectPopup';
import ToolPopup from '../../ui/ToolPopup';
import { createDefaultSide, type PageEffect } from '@/code/project/page-effects-config';

afterEach(() => { cleanup(); vi.useRealTimers(); });

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

function TestPopupContainer({ initialEffect, onChange }: { initialEffect: PageEffect; onChange: (e: PageEffect) => void }) {
  const [effect, setEffect] = useState(initialEffect);
  const anchorRef = useRef<HTMLDivElement>(null);
  const handleChange = (next: PageEffect) => {
    setEffect(next);
    onChange(next);
  };
  return (
    <div>
      <div ref={anchorRef} />
      <ToolPopup isOpen={true} onClose={() => {}} title="Page Effect" anchorRef={anchorRef}>
        <PageEffectPopup
          effect={effect}
          onChange={handleChange}
          targetOptions={[{ value: 'all', label: 'All Pages' }, { value: '/about', label: 'About' }]}
        />
      </ToolPopup>
    </div>
  );
}

describe('PageEffectPopup inside ToolPopup', () => {
  it('updates opacity via input and does not revert to initial value', async () => {
    const onChange = vi.fn();
    const initialEffect: PageEffect = {
      preset: 'custom',
      target: 'all',
      exit: { ...createDefaultSide(), opacity: 1 },
      enter: { ...createDefaultSide(), opacity: 1 },
    };

    const { getByText } = render(
      <TestPopupContainer initialEffect={initialEffect} onChange={onChange} />
    );

    // Click on Exit row to open SideEditor
    const exitBtn = getByText('Exit');
    fireEvent.click(exitBtn);

    // Look for all inputs
    const inputs = document.querySelectorAll('input');
    // First input in SideEditor is Opacity (value "1")
    const opacityInput = [...inputs].find((i) => i.value === '1') as HTMLInputElement;
    expect(opacityInput).toBeTruthy();

    // Type 0.4 into opacity input
    fireEvent.change(opacityInput, { target: { value: '0.4' } });
    fireEvent.blur(opacityInput);

    expect(onChange).toHaveBeenCalled();
    expect(opacityInput.value).toBe('0.4');
  });

  it('clicking "Add Exit..." when exit is undefined correctly sets up Exit and allows editing', async () => {
    const onChange = vi.fn();
    const initialEffect: PageEffect = {
      preset: 'custom',
      target: 'all',
      // exit is initially undefined!
      enter: { ...createDefaultSide(), opacity: 0 },
    };

    const { getByText } = render(
      <TestPopupContainer initialEffect={initialEffect} onChange={onChange} />
    );

    // Click on "Add Exit…"
    const addExitBtn = getByText('Add Exit…');
    fireEvent.click(addExitBtn);

    // onChange should have been called to initialize exit
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].exit).toBeTruthy();

    // Now inside SideEditor, look for Offset X input
    const inputs = [...document.querySelectorAll('input')];
    // In SideEditor: [0]=opacity(1), [1]=scale(1), [2]=rotateZ(0), [3]=offsetX(0), [4]=offsetY(0)
    const offsetXInput = inputs[3];
    expect(offsetXInput).toBeTruthy();
    expect(offsetXInput.value).toBe('0');

    // Change Offset X to 150
    fireEvent.change(offsetXInput, { target: { value: '150' } });
    fireEvent.blur(offsetXInput);

    // Check that onChange was called with offsetX 150
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.exit.offsetX).toBe(150);
    // Value remains 150 and does not revert to 0 or empty!
    expect(offsetXInput.value).toBe('150');
  });

  it('allows editing Mask inside SideEditor without losing state', async () => {
    const onChange = vi.fn();
    const initialEffect: PageEffect = {
      preset: 'custom',
      target: 'all',
      exit: { ...createDefaultSide() },
    };

    const { getByText } = render(
      <TestPopupContainer initialEffect={initialEffect} onChange={onChange} />
    );

    // Open Exit
    fireEvent.click(getByText('Exit'));

    // In PanelRow, the button is the sibling of label "Mask"
    const maskRow = getByText('Mask').parentElement!;
    const maskBtn = maskRow.querySelector('button') as HTMLButtonElement;
    expect(maskBtn).toBeTruthy();
    fireEvent.click(maskBtn);

    // Look for Origin X input (default 50)
    const inputs = document.querySelectorAll('input');
    const originXInput = [...inputs].find((i) => i.value === '50') as HTMLInputElement;
    expect(originXInput).toBeTruthy();

    // Change Origin X to 80
    fireEvent.change(originXInput, { target: { value: '80' } });
    fireEvent.blur(originXInput);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.exit.mask.originX).toBe(80);
    expect(originXInput.value).toBe('80');
  });

  it('allows selecting preset "custom" and editing properties', async () => {
    const onChange = vi.fn();
    const initialEffect: PageEffect = {
      preset: 'crossfade',
      target: 'all',
      exit: { ...createDefaultSide(), opacity: 0 },
      enter: { ...createDefaultSide(), opacity: 0 },
    };

    const { getByText } = render(
      <TestPopupContainer initialEffect={initialEffect} onChange={onChange} />
    );

    // Find preset select in document.body
    const selects = document.querySelectorAll('select');
    const presetSelect = selects[1]; // second select is preset
    expect(presetSelect.value).toBe('crossfade');

    // Switch to custom
    fireEvent.change(presetSelect, { target: { value: 'custom' } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].preset).toBe('custom');

    // Open Enter
    fireEvent.click(getByText('Enter'));

    // Look for scale input in SliderRow (default 1)
    const inputs = document.querySelectorAll('input');
    const scaleInput = [...inputs].find((i) => i.value === '1') as HTMLInputElement;
    expect(scaleInput).toBeTruthy();

    fireEvent.change(scaleInput, { target: { value: '1.5' } });
    fireEvent.blur(scaleInput);

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.preset).toBe('custom');
    expect(lastCall.enter.scale).toBe(1.5);
    expect(scaleInput.value).toBe('1.5');
  });

  it('allows editing Transition inside SideEditor without losing state', async () => {
    const onChange = vi.fn();
    const initialEffect: PageEffect = {
      preset: 'custom',
      target: 'all',
      exit: { ...createDefaultSide() },
    };

    const { getByText } = render(
      <TestPopupContainer initialEffect={initialEffect} onChange={onChange} />
    );

    // Open Exit
    fireEvent.click(getByText('Exit'));

    // In PanelRow, find button next to "Transition"
    const transRow = getByText('Transition').parentElement!;
    const transBtn = transRow.querySelector('button') as HTMLButtonElement;
    expect(transBtn).toBeTruthy();
    fireEvent.click(transBtn);

    // Look for Duration input in TransitionPanel (default 0.4s)
    const inputs = document.querySelectorAll('input');
    const durationInput = [...inputs].find((i) => i.value === '0.4') as HTMLInputElement;
    expect(durationInput).toBeTruthy();

    // Change duration to 0.8
    fireEvent.change(durationInput, { target: { value: '0.8' } });
    fireEvent.blur(durationInput);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.exit.transition.duration).toBe(0.8);
    expect(durationInput.value).toBe('0.8');
  });
});
