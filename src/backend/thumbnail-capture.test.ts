// thumbnail-capture.test.ts — Unit tests for thumbnail-capture helper

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureAndSaveProjectThumbnail, resetThumbnailCaptureState } from './thumbnail-capture';
import * as canvasBridgeModule from '@/canvas/canvas-bridge';
import * as projectIdModule from './project-id';

vi.mock('@/canvas/canvas-bridge', () => ({
  getCanvasBridge: vi.fn(),
}));

vi.mock('./project-id', () => ({
  getProjectId: vi.fn(() => 'test-project-id'),
}));

describe('captureAndSaveProjectThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetThumbnailCaptureState();
  });

  it('captures root element from bridge and posts to /api/projects/:id/thumbnail in self-host mode', async () => {
    const mockCaptureElement = vi.fn().mockResolvedValue('data:image/jpeg;base64,sample-jpeg-data');
    vi.mocked(canvasBridgeModule.getCanvasBridge).mockReturnValue({
      captureElement: mockCaptureElement,
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, previewImage: '/api/uploads/thumbnail-test-project-id.jpg' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await captureAndSaveProjectThumbnail('test-project-id');

    expect(mockCaptureElement).toHaveBeenCalledWith('root', '', expect.objectContaining({
      format: 'jpeg',
    }));
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/test-project-id/thumbnail', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,sample-jpeg-data' }),
    }));
    expect(result).toBe('/api/uploads/thumbnail-test-project-id.jpg');
  });

  it('returns null when captureElement is not available on bridge', async () => {
    vi.mocked(canvasBridgeModule.getCanvasBridge).mockReturnValue({} as any);

    const result = await captureAndSaveProjectThumbnail('test-project-id');
    expect(result).toBeNull();
  });

  it('returns null when captureElement returns null', async () => {
    const mockCaptureElement = vi.fn().mockResolvedValue(null);
    vi.mocked(canvasBridgeModule.getCanvasBridge).mockReturnValue({
      captureElement: mockCaptureElement,
    } as any);

    const result = await captureAndSaveProjectThumbnail('test-project-id');
    expect(result).toBeNull();
  });

  it('throttles rapid subsequent captures within cooldown interval', async () => {
    const mockCaptureElement = vi.fn().mockResolvedValue('data:image/jpeg;base64,data-1');
    vi.mocked(canvasBridgeModule.getCanvasBridge).mockReturnValue({
      captureElement: mockCaptureElement,
    } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, previewImage: '/api/uploads/thumb.jpg' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // First call succeeds
    const first = await captureAndSaveProjectThumbnail('test-project-id');
    expect(first).toBe('/api/uploads/thumb.jpg');
    expect(mockCaptureElement).toHaveBeenCalledTimes(1);

    // Immediate second call is throttled
    const second = await captureAndSaveProjectThumbnail('test-project-id');
    expect(second).toBeNull();
    expect(mockCaptureElement).toHaveBeenCalledTimes(1);

    // Forced call bypasses throttle
    const forced = await captureAndSaveProjectThumbnail('test-project-id', true);
    expect(forced).toBe('/api/uploads/thumb.jpg');
    expect(mockCaptureElement).toHaveBeenCalledTimes(2);
  });
});
