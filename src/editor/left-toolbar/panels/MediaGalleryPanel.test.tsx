import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MediaGalleryPanel from './MediaGalleryPanel';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    callback: (entries: any[]) => void;
    constructor(cb: (entries: any[]) => void) {
      this.callback = cb;
    }
    observe(target: any) {
      this.callback([{
        contentRect: { width: 256, height: 600, top: 0, left: 0, right: 256, bottom: 600, x: 0, y: 0, toJSON() {} },
        target,
      }]);
    }
    unobserve() {}
    disconnect() {}
  };
}

// Mock backend and project-id
vi.mock('@/backend', () => ({
  backend: {
    uploadAsset: vi.fn(),
    deleteAssets: vi.fn(),
  },
}));

vi.mock('@/backend/project-id', () => ({
  getProjectId: () => 'test-project',
}));

describe('MediaGalleryPanel virtualization and performance', () => {
  const mockUploads = [
    { url: '/api/uploads/img1.png', key: 'img1.png', size: 1024 },
    { url: '/api/uploads/img2.png', key: 'img2.png', size: 2048 },
    { url: '/api/uploads/img3.png', key: 'img3.png', size: 3072 },
    { url: '/api/uploads/img4.png', key: 'img4.png', size: 4096 },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('type=image')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ uploads: mockUploads }),
        });
      }
      if (url.includes('type=storage')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ used: 1024 * 1024 * 5, limit: 1024 * 1024 * 500 }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders uploaded tiles in virtual rows with async decoding and lazy loading', async () => {
    render(<MediaGalleryPanel />);

    await waitFor(() => {
      expect(screen.getByText('Select all (4)')).toBeDefined();
    });

    const images = Array.from(document.querySelectorAll('img'));
    expect(images.length).toBeGreaterThan(0);
    // Verify async decoding and lazy loading are set on images
    images.forEach((img) => {
      expect(img.getAttribute('decoding')).toBe('async');
      expect(img.getAttribute('loading')).toBe('lazy');
    });
  });

  it('handles select all and single tile selection correctly', async () => {
    render(<MediaGalleryPanel />);

    await waitFor(() => {
      expect(screen.getByText('Select all (4)')).toBeDefined();
    });

    const selectAllCheckbox = screen.getByRole('checkbox');
    fireEvent.click(selectAllCheckbox);

    expect(screen.getByText('Selected 4 of 4')).toBeDefined();
    expect(screen.getByText('Delete (4)')).toBeDefined();

    // Click Clear
    const clearBtn = screen.getByText('Clear');
    fireEvent.click(clearBtn);

    expect(screen.getByText('Select all (4)')).toBeDefined();
  });

  it('shows empty state when no uploads are returned', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('type=image')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ uploads: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ used: 0, limit: 500 }),
      });
    }));

    render(<MediaGalleryPanel />);

    await waitFor(() => {
      expect(screen.getByText('No images uploaded yet')).toBeDefined();
    });
  });
});
