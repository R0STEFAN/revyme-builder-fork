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
});
