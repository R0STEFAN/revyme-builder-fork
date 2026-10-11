import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImagePickerInput from './ImagePickerInput';

vi.mock('../ui/ImageSearchModal', () => ({
  default: ({ isOpen, onClose, onSelect }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="image-search-modal">
        <button onClick={() => onSelect('https://example.com/new-pic.jpg')}>Pick</button>
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

describe('ImagePickerInput', () => {
  it('renders placeholder button when empty and opens modal on click', () => {
    render(<ImagePickerInput value="" onChange={() => {}} placeholder="Choose image…" />);

    const btn = screen.getByRole('button', { name: /Choose image…/i });
    expect(btn).toBeDefined();

    expect(screen.queryByTestId('image-search-modal')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId('image-search-modal')).toBeDefined();
  });

  it('renders preview image without displaying the raw URL text when image is set', () => {
    const rawUrl = 'https://cdn.example.com/very/long/path/to/uploaded/image-12345.webp';
    render(<ImagePickerInput value={rawUrl} onChange={() => {}} />);

    // Must NOT render the raw URL string as text content in the document
    expect(screen.queryByText(rawUrl)).toBeNull();

    // Must render preview image
    const img = screen.getByRole('img', { name: /Preview/i }) as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toBe(rawUrl);

    // Must have Clear button
    expect(screen.getByRole('button', { name: /Clear/i })).toBeDefined();
  });

  it('handles url(...) wrappers in CSS value and extracts pure image URL for preview', () => {
    const imgUrl = 'https://example.com/bg.png';
    render(<ImagePickerInput value={`url("${imgUrl}")`} onChange={() => {}} />);

    const img = screen.getByRole('img', { name: /Preview/i }) as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toBe(imgUrl);
    expect(screen.queryByText(`url("${imgUrl}")`)).toBeNull();
  });

  it('treats var: references as empty and does not render as an image url', () => {
    render(<ImagePickerInput value="var:image" onChange={() => {}} placeholder="Choose image…" />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: /Choose image…/i })).toBeDefined();
  });

  it('calls onChange with empty string when Clear button is clicked', () => {
    const onChange = vi.fn();
    render(<ImagePickerInput value="https://example.com/pic.png" onChange={onChange} />);

    const clearBtn = screen.getByRole('button', { name: /Clear/i });
    fireEvent.click(clearBtn);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('calls onChange with raw url or url(...) when rawUrl prop is toggled', () => {
    const onChangeRaw = vi.fn();
    const { rerender } = render(
      <ImagePickerInput value="" onChange={onChangeRaw} rawUrl={true} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Choose image…/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pick/i }));
    expect(onChangeRaw).toHaveBeenCalledWith('https://example.com/new-pic.jpg');

    const onChangeCss = vi.fn();
    rerender(<ImagePickerInput value="" onChange={onChangeCss} rawUrl={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose image…/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pick/i }));
    expect(onChangeCss).toHaveBeenCalledWith('url(https://example.com/new-pic.jpg)');
  });
});
