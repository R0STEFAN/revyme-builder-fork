import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLocalServerStatus,
  buildLocalServer,
  startLocalServer,
  stopLocalServer,
  type LocalServerStatus,
} from './local-server-client';

describe('local-server-client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('fetchLocalServerStatus', () => {
    it('returns LocalServerStatus when API returns status object wrapped in { status }', async () => {
      const mockStatus: LocalServerStatus = {
        status: 'running',
        port: 3000,
        url: 'http://localhost:3000',
        isBuilt: true,
        lastBuiltAt: 12345678,
        lastError: null,
        pid: 9999,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: mockStatus }),
      });

      const result = await fetchLocalServerStatus('proj-123');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/local-server/proj-123/status');
      expect(result).toEqual(mockStatus);
    });

    it('returns LocalServerStatus when API returns unwrapped status object', async () => {
      const mockStatus: LocalServerStatus = {
        status: 'idle',
        port: null,
        url: null,
        isBuilt: false,
        lastBuiltAt: null,
        lastError: null,
        pid: null,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockStatus,
      });

      const result = await fetchLocalServerStatus('proj-123');
      expect(result).toEqual(mockStatus);
    });

    it('encodes special characters in projectId', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: { status: 'idle', port: null, url: null, isBuilt: false, lastBuiltAt: null, lastError: null, pid: null } }),
      });

      await fetchLocalServerStatus('proj/special name#1');
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/local-server/proj%2Fspecial%20name%231/status');
    });

    it('returns null on non-200 HTTP response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      });

      const result = await fetchLocalServerStatus('proj-123');
      expect(result).toBeNull();
    });

    it('returns null on network/fetch rejection', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await fetchLocalServerStatus('proj-123');
      expect(result).toBeNull();
    });
  });

  describe('buildLocalServer', () => {
    it('sends POST request with files and returns success result with log', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, log: 'Build completed in 2.1s' }),
      });

      const files = { 'pages/index.tsx': 'export default function() {}' };
      const result = await buildLocalServer('proj-123', files);

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/local-server/proj-123/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      expect(result).toEqual({
        success: true,
        log: 'Build completed in 2.1s',
      });
    });

    it('sends POST request without files when not specified', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, log: '' }),
      });

      const result = await buildLocalServer('proj-123');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/local-server/proj-123/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: undefined }),
      });
      expect(result).toEqual({
        success: true,
        log: '',
      });
    });

    it('returns failure result with log on non-200 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Build failed', log: 'SyntaxError at line 1' }),
      });

      const result = await buildLocalServer('proj-123');
      expect(result).toEqual({
        success: false,
        log: 'SyntaxError at line 1',
      });
    });

    it('returns failure result with error message fallback when log is empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Build process crashed' }),
      });

      const result = await buildLocalServer('proj-123');
      expect(result).toEqual({
        success: false,
        log: 'Build process crashed',
      });
    });

    it('returns failure result when fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await buildLocalServer('proj-123');
      expect(result).toEqual({
        success: false,
        log: 'Connection refused',
      });
    });
  });

  describe('startLocalServer', () => {
    it('sends POST request with port and returns LocalServerStatus on success', async () => {
      const mockStatus: LocalServerStatus = {
        status: 'running',
        port: 3005,
        url: 'http://localhost:3005',
        isBuilt: true,
        lastBuiltAt: 12345,
        lastError: null,
        pid: 1234,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockStatus,
      });

      const result = await startLocalServer('proj-123', 3005);

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/local-server/proj-123/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 3005 }),
      });
      expect(result).toEqual(mockStatus);
    });

    it('handles response wrapped in { status: ... }', async () => {
      const mockStatus: LocalServerStatus = {
        status: 'running',
        port: 3000,
        url: 'http://localhost:3000',
        isBuilt: true,
        lastBuiltAt: 12345,
        lastError: null,
        pid: 1234,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: mockStatus }),
      });

      const result = await startLocalServer('proj-123');
      expect(result).toEqual(mockStatus);
    });

    it('throws error with message on non-200 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Port 3000 is already in use' }),
      });

      await expect(startLocalServer('proj-123', 3000)).rejects.toThrow('Port 3000 is already in use');
    });

    it('throws error when fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to connect'));

      await expect(startLocalServer('proj-123')).rejects.toThrow('Failed to connect');
    });
  });

  describe('stopLocalServer', () => {
    it('sends POST request and returns LocalServerStatus on success', async () => {
      const mockStatus: LocalServerStatus = {
        status: 'idle',
        port: null,
        url: null,
        isBuilt: true,
        lastBuiltAt: 12345,
        lastError: null,
        pid: null,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockStatus,
      });

      const result = await stopLocalServer('proj-123');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/local-server/proj-123/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockStatus);
    });

    it('handles response wrapped in { status: ... }', async () => {
      const mockStatus: LocalServerStatus = {
        status: 'idle',
        port: null,
        url: null,
        isBuilt: true,
        lastBuiltAt: 12345,
        lastError: null,
        pid: null,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: mockStatus }),
      });

      const result = await stopLocalServer('proj-123');
      expect(result).toEqual(mockStatus);
    });

    it('throws error on non-200 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server process not found' }),
      });

      await expect(stopLocalServer('proj-123')).rejects.toThrow('Server process not found');
    });

    it('throws error when fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset'));

      await expect(stopLocalServer('proj-123')).rejects.toThrow('Connection reset');
    });
  });
});
