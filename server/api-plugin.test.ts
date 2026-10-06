import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { selfHostApiPlugin } from './api-plugin';
import { LocalServerManager, type LocalServerStatus } from './local-server';

function createMockManager(overrides: Partial<Record<keyof LocalServerManager, any>> = {}) {
  const defaultStatus: LocalServerStatus = {
    status: 'idle',
    port: null,
    url: null,
    isBuilt: false,
    lastBuiltAt: null,
    lastError: null,
    pid: null,
  };

  return {
    getStatus: vi.fn((_projectId: string) => ({ ...defaultStatus })),
    build: vi.fn(async (_projectId: string, _files?: Record<string, string>) => ({
      success: true,
      log: 'Build finished successfully',
    })),
    start: vi.fn(async (_projectId: string, port = 3000) => ({
      ...defaultStatus,
      status: 'running' as const,
      port,
      url: `http://localhost:${port}`,
      pid: 4321,
    })),
    stop: vi.fn(async (_projectId: string) => ({
      ...defaultStatus,
      status: 'idle' as const,
    })),
    ...overrides,
  } as unknown as LocalServerManager;
}

interface DispatchOptions {
  method?: string;
  url: string;
  body?: any;
  headers?: Record<string, string>;
}

interface DispatchResult {
  status: number;
  headers: Record<string, string>;
  body: any;
  passedThrough: boolean;
}

function createDispatcher(plugin: ReturnType<typeof selfHostApiPlugin>) {
  let middleware: (req: any, res: any, next: (err?: any) => void) => Promise<void> | void;
  const mockServer = {
    middlewares: {
      use: (fn: any) => {
        middleware = fn;
      },
    },
  };
  (plugin as any).configureServer(mockServer);

  return async function dispatch(opts: DispatchOptions): Promise<DispatchResult> {
    return new Promise((resolve, reject) => {
      const req = new EventEmitter() as any;
      req.method = opts.method || 'GET';
      req.url = opts.url;
      req.headers = { ...(opts.headers || {}) };

      const bodyData =
        opts.body !== undefined
          ? typeof opts.body === 'string'
            ? opts.body
            : JSON.stringify(opts.body)
          : null;

      if (bodyData && !req.headers['content-type']) {
        req.headers['content-type'] = 'application/json';
      }

      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(name: string, val: string) {
          this.headers[name.toLowerCase()] = val;
        },
        end(data?: any) {
          const raw = data ? data.toString('utf-8') : '';
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Keep raw string
          }
          resolve({
            status: this.statusCode,
            headers: this.headers,
            body: parsed,
            passedThrough: false,
          });
        },
      };

      const next = () => {
        resolve({
          status: 404,
          headers: {},
          body: null,
          passedThrough: true,
        });
      };

      try {
        const result = middleware(req, res, next);
        if (result && typeof (result as any).catch === 'function') {
          (result as any).catch(reject);
        }

        process.nextTick(() => {
          if (bodyData) {
            req.emit('data', Buffer.from(bodyData));
          }
          req.emit('end');
        });
      } catch (err) {
        reject(err);
      }
    });
  };
}

describe('selfHostApiPlugin - Local Server REST API', () => {
  let mockManager: LocalServerManager;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    mockManager = createMockManager();
    const plugin = selfHostApiPlugin({ manager: mockManager });
    dispatch = createDispatcher(plugin);
  });

  describe('GET /api/local-server/:projectId/status', () => {
    it('returns 200 with LocalServerStatus wrapped in { status }', async () => {
      (mockManager.getStatus as any).mockReturnValue({
        status: 'running',
        port: 3000,
        url: 'http://localhost:3000',
        isBuilt: true,
        lastBuiltAt: 123456789,
        lastError: null,
        pid: 9999,
      });

      const res = await dispatch({
        method: 'GET',
        url: '/api/local-server/my-project/status',
      });

      expect(res.status).toBe(200);
      expect(mockManager.getStatus).toHaveBeenCalledWith('my-project');
      expect(res.body).toEqual({
        status: {
          status: 'running',
          port: 3000,
          url: 'http://localhost:3000',
          isBuilt: true,
          lastBuiltAt: 123456789,
          lastError: null,
          pid: 9999,
        },
      });
      expect(res.passedThrough).toBe(false);
    });

    it('decodes URI-encoded projectId correctly', async () => {
      await dispatch({
        method: 'GET',
        url: '/api/local-server/project%20with%20spaces/status',
      });

      expect(mockManager.getStatus).toHaveBeenCalledWith('project with spaces');
    });
  });

  describe('POST /api/local-server/:projectId/build', () => {
    it('returns 200 on successful build with log', async () => {
      const files = { 'app/page.tsx': 'export default function Page() {}' };
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/build',
        body: { files },
      });

      expect(res.status).toBe(200);
      expect(mockManager.build).toHaveBeenCalledWith('proj-123', files);
      expect(res.body).toEqual({
        success: true,
        log: 'Build finished successfully',
      });
    });

    it('handles build without files payload', async () => {
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/build',
        body: {},
      });

      expect(res.status).toBe(200);
      expect(mockManager.build).toHaveBeenCalledWith('proj-123', undefined);
      expect(res.body).toEqual({
        success: true,
        log: 'Build finished successfully',
      });
    });

    it('returns 500 when build fails', async () => {
      (mockManager.build as any).mockResolvedValue({
        success: false,
        log: 'Error: Failed to compile src/page.tsx',
      });

      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/build',
        body: {},
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Build failed',
        log: 'Error: Failed to compile src/page.tsx',
      });
    });

    it('returns 500 when build throws an unhandled error', async () => {
      (mockManager.build as any).mockRejectedValue(new Error('Spawn failed: next binary not found'));

      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/build',
        body: {},
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Spawn failed');
    });
  });

  describe('POST /api/local-server/:projectId/start', () => {
    it('returns 200 with LocalServerStatus on success with custom port', async () => {
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/start',
        body: { port: 3005 },
      });

      expect(res.status).toBe(200);
      expect(mockManager.start).toHaveBeenCalledWith('proj-123', 3005);
      expect(res.body).toEqual({
        status: 'running',
        port: 3005,
        url: 'http://localhost:3005',
        isBuilt: false,
        lastBuiltAt: null,
        lastError: null,
        pid: 4321,
      });
    });

    it('returns 200 and defaults port if not provided in body', async () => {
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/start',
        body: {},
      });

      expect(res.status).toBe(200);
      expect(mockManager.start).toHaveBeenCalledWith('proj-123', undefined);
    });

    it('returns 500 on start failure and includes error and current status', async () => {
      (mockManager.start as any).mockRejectedValue(new Error('Port 3000 is already in use'));
      (mockManager.getStatus as any).mockReturnValue({
        status: 'error',
        port: null,
        url: null,
        isBuilt: true,
        lastBuiltAt: 12345,
        lastError: 'Port 3000 is already in use',
        pid: null,
      });

      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/start',
        body: { port: 3000 },
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Port 3000 is already in use',
        status: {
          status: 'error',
          port: null,
          url: null,
          isBuilt: true,
          lastBuiltAt: 12345,
          lastError: 'Port 3000 is already in use',
          pid: null,
        },
      });
    });
  });

  describe('POST /api/local-server/:projectId/stop', () => {
    it('returns 200 with updated LocalServerStatus', async () => {
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/stop',
      });

      expect(res.status).toBe(200);
      expect(mockManager.stop).toHaveBeenCalledWith('proj-123');
      expect(res.body).toEqual({
        status: 'idle',
        port: null,
        url: null,
        isBuilt: false,
        lastBuiltAt: null,
        lastError: null,
        pid: null,
      });
    });

    it('returns 500 on stop failure', async () => {
      (mockManager.stop as any).mockRejectedValue(new Error('Process kill timed out'));
      (mockManager.getStatus as any).mockReturnValue({
        status: 'error',
        port: 3000,
        url: 'http://localhost:3000',
        isBuilt: true,
        lastBuiltAt: 12345,
        lastError: 'Process kill timed out',
        pid: 9999,
      });

      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/stop',
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Process kill timed out',
        status: {
          status: 'error',
          port: 3000,
          url: 'http://localhost:3000',
          isBuilt: true,
          lastBuiltAt: 12345,
          lastError: 'Process kill timed out',
          pid: 9999,
        },
      });
    });
  });

  describe('Pass-through and unhandled routes', () => {
    it('passes through when route is not local-server', async () => {
      const res = await dispatch({
        method: 'GET',
        url: '/api/unknown-endpoint',
      });

      expect(res.passedThrough).toBe(true);
    });

    it('passes through when local-server action is unknown', async () => {
      const res = await dispatch({
        method: 'GET',
        url: '/api/local-server/proj-123/restart',
      });

      expect(res.passedThrough).toBe(true);
    });

    it('passes through when HTTP method does not match action', async () => {
      const res = await dispatch({
        method: 'GET',
        url: '/api/local-server/proj-123/build',
      });

      expect(res.passedThrough).toBe(true);
    });

    it('handles query parameters and trailing slash in local-server URLs', async () => {
      const res = await dispatch({
        method: 'GET',
        url: '/api/local-server/proj-123/status/?timestamp=12345',
      });

      expect(res.status).toBe(200);
      expect(mockManager.getStatus).toHaveBeenCalledWith('proj-123');
    });

    it('defaults to shared localServerManager when no manager option provided', async () => {
      const defaultPlugin = selfHostApiPlugin();
      const defaultDispatch = createDispatcher(defaultPlugin);

      const res = await defaultDispatch({
        method: 'GET',
        url: '/api/local-server/test-default/status',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.status.status).toBe('idle');
    });
  });
});

