import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageSearchModal from './ImageSearchModal';

vi.mock('@/shared/cloud-flag', () => ({
  CLOUD_ENABLED: false,
}));

vi.mock('@/backend', () => ({
  backend: {
    uploadAsset: vi.fn(),
    getUser: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@/backend/project-id', () => ({
  getProjectId: () => 'test-project-123',
}));

describe('ImageSearchModal upload tab in self-hosted / local mode', () => {
  const mockUploads = [
    { url: '/api/uploads/photo1.jpg', key: 'photo1.jpg' },
    { url: '/api/uploads/photo2.png', key: 'photo2.png', thumbnailUrl: '/api/uploads/thumb-photo2.png' },
    { url: '/api/uploads/thumbnail-internal.png', key: 'thumbnail-internal.png' },
    { url: '/api/uploads/page-preview/thumbnail-xyz.png' },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/upload')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ uploads: mockUploads }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
  });

  it('fetches uploads and filters internal thumbnails', async () => {
    render(
      <ImageSearchModal
        isOpen={true}
        onClose={() => {}}
        onSelect={() => {}}
      />
    );

    // In non-cloud mode with no Unsplash key, it defaults to the upload tab
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/upload?websiteId=test-project-123&type=image')
      );
    });

    // Valid uploaded images should be rendered
    await waitFor(() => {
      const img1 = screen.getByTitle('photo1.jpg');
      expect(img1).toBeDefined();
    });

    const img2 = screen.getByTitle('photo2.png');
    expect(img2).toBeDefined();

    // Thumbnails should be filtered out
    expect(screen.queryByTitle('thumbnail-internal.png')).toBeNull();
    expect(screen.queryByTitle('/api/uploads/page-preview/thumbnail-xyz.png')).toBeNull();
  });

  it('calls onSelect and onClose when clicking an uploaded image', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <ImageSearchModal
        isOpen={true}
        onClose={onClose}
        onSelect={onSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle('photo1.jpg')).toBeDefined();
    });

    const photoTile = screen.getByTitle('photo1.jpg');
    fireEvent.click(photoTile);

    expect(onSelect).toHaveBeenCalledWith('/api/uploads/photo1.jpg');
    expect(onClose).toHaveBeenCalled();
  });

  describe('Link tab', () => {
    it('opens on Link tab when currentUrl is provided and displays preview', () => {
      render(
        <ImageSearchModal
          isOpen={true}
          onClose={() => {}}
          onSelect={() => {}}
          currentUrl="https://images.unsplash.com/photo-test"
        />
      );

      const input = screen.getByPlaceholderText(/https:\/\/images\.unsplash\.com/i) as HTMLInputElement;
      expect(input.value).toBe('https://images.unsplash.com/photo-test');
      const previewImg = screen.getByRole('img', { name: /Preview/i }) as HTMLImageElement;
      expect(previewImg.src).toBe('https://images.unsplash.com/photo-test');
    });

    it('applies new link on Apply click', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <ImageSearchModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
        />
      );

      // Switch to Link tab
      const linkTabBtn = screen.getByRole('button', { name: 'Link' });
      fireEvent.click(linkTabBtn);

      const input = screen.getByPlaceholderText(/https:\/\/images\.unsplash\.com/i);
      fireEvent.change(input, { target: { value: 'https://example.com/custom.jpg' } });

      const applyBtn = screen.getByRole('button', { name: 'Apply' });
      fireEvent.click(applyBtn);

      expect(onSelect).toHaveBeenCalledWith('https://example.com/custom.jpg');
      expect(onClose).toHaveBeenCalled();
    });

    it('clears image when URL is empty and Apply is clicked', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <ImageSearchModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
          currentUrl="https://example.com/old.jpg"
        />
      );

      // Should have clear button ✕
      const clearBtn = screen.getByRole('button', { name: 'Clear link' });
      fireEvent.click(clearBtn);

      const input = screen.getByPlaceholderText(/https:\/\/images\.unsplash\.com/i) as HTMLInputElement;
      expect(input.value).toBe('');

      const applyBtn = screen.getByRole('button', { name: 'Apply' });
      fireEvent.click(applyBtn);

      expect(onSelect).toHaveBeenCalledWith('');
      expect(onClose).toHaveBeenCalled();
    });

    it('submits on Enter key in link input', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <ImageSearchModal
          isOpen={true}
          onClose={onClose}
          onSelect={onSelect}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Link' }));
      const input = screen.getByPlaceholderText(/https:\/\/images\.unsplash\.com/i);
      fireEvent.change(input, { target: { value: 'https://example.com/enter-test.jpg' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(onSelect).toHaveBeenCalledWith('https://example.com/enter-test.jpg');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
