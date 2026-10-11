import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import ComponentPropsPanel from './ComponentPropsPanel';
import { parseComponentControlsMeta } from '@/code/components/controls-parser';
import { ACCORDION_COMPONENT } from '@/code/project/default-code-components/Accordion';

vi.mock('@/editor/controls', () => ({
  ToolRow: ({ children, label }: any) => <div data-testid="tool-row"><span data-testid="label">{label}</span>{children}</div>,
  ToolInput: ({ value, onChange }: any) => (
    <input
      data-testid="tool-input"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
  ToolSlider: ({ value, onChange }: any) => (
    <div data-testid="slider" data-value={value} onClick={() => onChange?.(value)}>
      {String(value)}
    </div>
  ),
  ToolSelect: () => null,
  ToolSegmentedControl: () => null,
}));

vi.mock('../tools/ObjectListControl', () => ({
  default: ({ label, value, onChange }: any) => (
    <div data-testid="object-list-control">
      <span>{label}</span>
      <span data-testid="object-list-count">{value?.length ?? 0}</span>
      <button data-testid="object-list-change" onClick={() => onChange([{ question: 'Q1', answer: 'A1' }])}>
        Change
      </button>
    </div>
  ),
}));

vi.mock('../tools/ImageListControl', () => ({
  default: ({ label, value, uploadSource, onChange }: any) => (
    <div data-testid="image-list-control" data-upload-source={uploadSource}>
      <span>{label}</span>
      <button data-testid="image-list-change" onClick={() => onChange('url1|url2')}>
        Change Image List
      </button>
    </div>
  ),
}));

vi.mock('../tools/TextStyleTool/atoms/FontFamilyControl', () => ({
  FontFamilyControl: ({ label, value, onChange }: any) => (
    <div data-testid="font-family-control">
      <span>{label}</span>
      <button data-testid="font-family-change" onClick={() => onChange('Inter, sans-serif')}>
        Change Font
      </button>
    </div>
  ),
}));

vi.mock('../controls/UploadControl', () => ({
  default: ({ value, uploadSource, onBatchComplete, onChange }: any) => (
    <div data-testid="upload-control" data-upload-source={uploadSource}>
      <button data-testid="upload-batch" onClick={() => onBatchComplete?.(42)}>
        Batch
      </button>
      <button data-testid="upload-single" onClick={() => onChange('new-url')}>
        Upload
      </button>
    </div>
  ),
}));

vi.mock('../tools/TransitionControl', () => ({
  default: ({ label, value, onChange }: any) => (
    <div data-testid="transition-control" data-value={value}>
      <span>{label}</span>
      <button data-testid="transition-change" onClick={() => onChange('{"type":"spring"}')}>
        Change Transition
      </button>
    </div>
  ),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

describe('ComponentPropsPanel (AUD-10)', () => {
  it('slider and ranged number zero stays zero in slider and input; finite negatives preserved', () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <ComponentPropsPanel
        controls={{
          radius: { type: 'number', label: 'Radius', min: 0, max: 40, default: 16 },
          speed: { type: 'slider', label: 'Speed', min: -10, max: 10, default: 5 },
        }}
        values={{ radius: 0, speed: -5 }}
        onChange={handleChange}
      />
    );

    const sliders = screen.getAllByTestId('slider');
    expect(sliders[0].textContent).toBe('0');
    expect(sliders[0].getAttribute('data-value')).toBe('0');
    expect(sliders[1].textContent).toBe('-5');
    expect(sliders[1].getAttribute('data-value')).toBe('-5');

    const inputs = screen.getAllByTestId('tool-input') as HTMLInputElement[];
    expect(inputs[0].value).toBe('0');
    expect(inputs[1].value).toBe('-5');

    // Changing input to 0 forwards 0
    fireEvent.change(inputs[1], { target: { value: '0' } });
    expect(handleChange).toHaveBeenCalledWith('speed', 0);

    // Changing input to positive number forwards number
    fireEvent.change(inputs[0], { target: { value: '25' } });
    expect(handleChange).toHaveBeenCalledWith('radius', 25);
  });

  it('renders Accordion Questions & Answers objectList and changes list', () => {
    const controls = parseComponentControlsMeta(ACCORDION_COMPONENT)!.controls;
    const handleChange = vi.fn();
    render(<ComponentPropsPanel controls={controls} values={{}} onChange={handleChange} />);

    expect(screen.getByText('Questions & Answers')).toBeTruthy();
    expect(screen.getByTestId('object-list-control')).toBeTruthy();

    fireEvent.click(screen.getByTestId('object-list-change'));
    expect(handleChange).toHaveBeenCalledWith('items', [{ question: 'Q1', answer: 'A1' }]);
  });

  it('renders imageList and forwards value and uploadSource', () => {
    const handleChange = vi.fn();
    render(
      <ComponentPropsPanel
        controls={{
          gallery: { type: 'imageList', label: 'Gallery', uploadSource: 'sequence' },
        }}
        values={{ gallery: 'a|b' }}
        onChange={handleChange}
      />
    );

    const control = screen.getByTestId('image-list-control');
    expect(control.getAttribute('data-upload-source')).toBe('sequence');
    fireEvent.click(screen.getByTestId('image-list-change'));
    expect(handleChange).toHaveBeenCalledWith('gallery', 'url1|url2');
  });

  it('renders font control and forwards font family', () => {
    const handleChange = vi.fn();
    render(
      <ComponentPropsPanel
        controls={{
          customFont: { type: 'font', label: 'Custom Font' },
        }}
        values={{ customFont: 'Roboto' }}
        onChange={handleChange}
      />
    );

    expect(screen.getByTestId('font-family-control')).toBeTruthy();
    fireEvent.click(screen.getByTestId('font-family-change'));
    expect(handleChange).toHaveBeenCalledWith('customFont', 'Inter, sans-serif');
  });

  it('propagates uploadSource=sequence and batch totalFrames in upload control', () => {
    const handleChange = vi.fn();
    render(
      <ComponentPropsPanel
        controls={{
          frames: { type: 'upload', label: 'Frames', multiple: true, uploadSource: 'sequence' },
          totalFrames: { type: 'number', label: 'Total frames', default: 30 },
        }}
        values={{}}
        onChange={handleChange}
      />
    );

    const upload = screen.getByTestId('upload-control');
    expect(upload.getAttribute('data-upload-source')).toBe('sequence');

    fireEvent.click(screen.getByTestId('upload-batch'));
    expect(handleChange).toHaveBeenCalledWith('totalFrames', 42);
  });

  it('formats transition object as valid JSON and never [object Object]', () => {
    const handleChange = vi.fn();
    render(
      <ComponentPropsPanel
        controls={{
          bounce: { type: 'transition', label: 'Bounce', default: { duration: 0.3 } },
        }}
        values={{ bounce: { duration: 0.3 } }}
        onChange={handleChange}
      />
    );

    const transition = screen.getByTestId('transition-control');
    const rawValue = transition.getAttribute('data-value') || '';
    expect(rawValue).not.toContain('[object Object]');
    expect(JSON.parse(rawValue)).toEqual({ duration: 0.3 });

    fireEvent.click(screen.getByTestId('transition-change'));
    expect(handleChange).toHaveBeenCalledWith('bounce', '{"type":"spring"}');
  });

  it('renders an honest explanation for slot controls', () => {
    render(
      <ComponentPropsPanel
        controls={{
          content: { type: 'slot', label: 'Children' },
        }}
        values={{}}
        onChange={() => {}}
      />
    );

    expect(screen.getByText(/slots can only be connected on canvas/i)).toBeTruthy();
  });
});
