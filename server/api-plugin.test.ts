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
  const middlewares: Array<(req: any, res: any, next: (err?: any) => void) => Promise<void> | void> = [];
  const mockServer = {
    middlewares: {
      use: (fn: any) => {
        middlewares.push(fn);
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

      const runMiddleware = (idx: number) => {
        if (idx >= middlewares.length) {
          resolve({
            status: 404,
            headers: {},
            body: null,
            passedThrough: true,
          });
          return;
        }

        try {
          const result = middlewares[idx](req, res, () => runMiddleware(idx + 1));
          if (result && typeof (result as any).catch === 'function') {
            (result as any).catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      };

      runMiddleware(0);

      process.nextTick(() => {
        if (bodyData) {
          req.emit('data', Buffer.from(bodyData));
        }
        req.emit('end');
      });
    });
  };
}

describe('selfHostApiPlugin - Local Server REST API', () => {
  let mockManager: LocalServerManager;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    mockManager = createMockManager();
    const plugin = selfHostApiPlugin({ manager: mockManager, autoStartMcpHttp: false });
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
      expect(mockManager.build).toHaveBeenCalledWith('proj-123', files, undefined);
      expect(res.body).toEqual({
        success: true,
        log: 'Build finished successfully',
      });
    });

    it('passes branch parameter to manager.build', async () => {
      const files = { 'app/page.tsx': 'export default function Page() {}' };
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/build',
        body: { files, branch: 'feat-new' },
      });

      expect(res.status).toBe(200);
      expect(mockManager.build).toHaveBeenCalledWith('proj-123', files, 'feat-new');
    });

    it('handles build without files payload', async () => {
      const res = await dispatch({
        method: 'POST',
        url: '/api/local-server/proj-123/build',
        body: {},
      });

      expect(res.status).toBe(200);
      expect(mockManager.build).toHaveBeenCalledWith('proj-123', undefined, undefined);
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
      const defaultPlugin = selfHostApiPlugin({ autoStartMcpHttp: false });
      const defaultDispatch = createDispatcher(defaultPlugin);

      const res = await defaultDispatch({
        method: 'GET',
        url: '/api/local-server/test-default/status',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.status.status).toBe('idle');
    });

    it('handles native MCP bridge status via Vite API plugin', async () => {
      const res = await dispatch({
        method: 'GET',
        url: '/api/mcp/status',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        activeTabs: expect.any(Number),
        pendingRequests: expect.any(Number),
      });
    });

    it('handles project thumbnail upload via POST /api/projects/:id/thumbnail', async () => {
      // First create project
      await dispatch({
        method: 'POST',
        url: '/api/projects',
        body: { id: 'test-thumb-proj', name: 'Thumb Test', data: { files: {} } },
      });

      const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64');
      const res = await dispatch({
        method: 'POST',
        url: '/api/projects/test-thumb-proj/thumbnail',
        body: { dataUrl },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.previewImage).toMatch(/^\/api\/uploads\/thumbnail-test-thumb-proj\.jpg\?t=\d+$/);
    });

    it('handles unified preview-image upload via POST /api/websites/:id/preview-image', async () => {
      await dispatch({
        method: 'POST',
        url: '/api/projects',
        body: { id: 'test-website-thumb', name: 'Website Thumb Test', data: { files: {} } },
      });

      const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes-2').toString('base64');
      const res = await dispatch({
        method: 'POST',
        url: '/api/websites/test-website-thumb/preview-image',
        body: { dataUrl },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.url).toMatch(/^\/api\/uploads\/thumbnail-test-website-thumb\.jpg\?t=\d+$/);
    });

    it('handles project bundle export via GET /api/projects/:id/bundle', async () => {
      await dispatch({
        method: 'POST',
        url: '/api/projects',
        body: {
          id: 'test-bundle-export',
          name: 'Bundle Export Test',
          data: { files: { 'app/page.tsx': '<img src="/api/uploads/non-existent.png" />' } },
        },
      });

      const res = await dispatch({
        method: 'GET',
        url: '/api/projects/test-bundle-export/bundle',
      });

      expect(res.status).toBe(200);
      expect(res.body.format).toBe('revyme-bundle-v1');
      expect(res.body.name).toBe('Bundle Export Test');
      expect(res.body.data.files).toBeDefined();
    });

    it('handles project bundle import via POST /api/projects/import-bundle', async () => {
      const bundle = {
        format: 'revyme-bundle-v1',
        name: 'Imported Bundle Test',
        data: { files: { 'app/page.tsx': 'export default () => <h1>Imported</h1>' } },
        assets: {
          'test-asset-imported.png': {
            base64: Buffer.from('png-bytes').toString('base64'),
            mime: 'image/png',
          },
        },
      };

      const res = await dispatch({
        method: 'POST',
        url: '/api/projects/import-bundle',
        body: bundle,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.project.name).toBe('Imported Bundle Test');
      expect(res.body.assetCount).toBe(1);
    });
  });
});

