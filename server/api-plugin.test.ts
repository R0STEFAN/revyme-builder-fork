import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { selfHostApiPlugin } from './api-plugin';
import { LocalServerManager, type LocalServerStatus } from './local-server';
import { saveUploadExact } from './storage';

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

      const chunks: Buffer[] = [];
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(name: string, val: string) {
          this.headers[name.toLowerCase()] = val;
        },
        write(chunk: any) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        },
        end(data?: any) {
          if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
          const totalBuffer = Buffer.concat(chunks);
          const raw = totalBuffer.toString('utf-8');
          let parsed: any = raw;
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
      });

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

    it('exports and imports custom fonts in project bundle with metadata', async () => {
      // 1. Save an upload font file
      saveUploadExact('my-test-font.woff2', Buffer.from('mock-woff2-binary-data'));

      // 2. Create project referencing font via both /api/uploads/ and /uploads/
      const css = `
@font-face {
  font-family: 'Test Custom Font';
  src: url('/uploads/my-test-font.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
}
      `;
      await dispatch({
        method: 'POST',
        url: '/api/projects',
        body: {
          id: 'test-font-bundle-proj',
          name: 'Font Bundle Project',
          data: {
            files: {
              'app/globals.css': css,
              'app/page.tsx': '<h1 style={{ fontFamily: "Test Custom Font" }}>Title</h1>',
            },
          },
        },
      });

      // 3. Export bundle
      const exportRes = await dispatch({
        method: 'GET',
        url: '/api/projects/test-font-bundle-proj/bundle',
      });

      expect(exportRes.status).toBe(200);
      expect(exportRes.body.assets['my-test-font.woff2']).toBeDefined();
      expect(exportRes.body.assets['my-test-font.woff2'].mime).toBe('font/woff2');
      expect(exportRes.body.customFonts).toBeDefined();
      expect(exportRes.body.customFonts[0]).toMatchObject({
        family: 'Test Custom Font',
        weight: 700,
        style: 'normal',
      });

      // 4. Import bundle
      const importRes = await dispatch({
        method: 'POST',
        url: '/api/projects/import-bundle',
        body: exportRes.body,
      });

      expect(importRes.status).toBe(201);
      expect(importRes.body.success).toBe(true);
      expect(importRes.body.assetCount).toBe(1);
      expect(importRes.body.customFonts).toBeDefined();
    });

    it('records versions on disk during project save and supports branch filtering, restore, and delete', async () => {
      const projId = `test-ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // 1. Create a project
      await dispatch({
        method: 'POST',
        url: '/api/projects',
        body: { id: projId, name: 'Version Test', data: { files: { 'app/page.tsx': 'v1' } } },
      });

      // 2. Save an update (autosave) on branch main
      const putRes = await dispatch({
        method: 'PUT',
        url: `/api/projects/${projId}`,
        body: {
          data: { files: { 'app/page.tsx': 'v2' } },
          branchId: 'main',
          source: 'autosave',
          label: 'Autosave v2',
          changesSummary: 'Updated app/page.tsx',
        },
      });
      expect(putRes.status).toBe(200);

      // 3. Save a manual update on branch feat-a
      await dispatch({
        method: 'PUT',
        url: `/api/projects/${projId}`,
        body: {
          data: { files: { 'app/page.tsx': 'v3-feat' } },
          branchId: 'feat-a',
          source: 'manual',
          label: 'Manual save v3',
        },
      });

      // 4. List all versions
      const listAll = await dispatch({
        method: 'GET',
        url: `/api/projects/${projId}/versions`,
      });
      expect(listAll.status).toBe(200);
      expect(listAll.body.count).toBe(2);
      expect(listAll.body.versions[0].source).toBe('manual');
      expect(listAll.body.versions[0].branchId).toBe('feat-a');
      expect(listAll.body.versions[1].source).toBe('autosave');
      expect(listAll.body.versions[1].branchId).toBe('main');

      // 5. Filter by branchId
      const listMain = await dispatch({
        method: 'GET',
        url: `/api/projects/${projId}/versions?branchId=main`,
      });
      expect(listMain.status).toBe(200);
      expect(listMain.body.count).toBe(1);
      expect(listMain.body.versions[0].branchId).toBe('main');

      // 6. Get single version detail
      const vId = listAll.body.versions[0].id;
      const getV = await dispatch({
        method: 'GET',
        url: `/api/projects/${projId}/versions/${vId}`,
      });
      expect(getV.status).toBe(200);
      expect(getV.body.data.files['app/page.tsx']).toBe('v3-feat');

      // 7. Restore an older version (v2 from main)
      const v2Id = listAll.body.versions[1].id;
      const restoreRes = await dispatch({
        method: 'POST',
        url: `/api/projects/${projId}/versions/${v2Id}/restore`,
      });
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.success).toBe(true);
      expect(restoreRes.body.project.data.files['app/page.tsx']).toBe('v2');

      // Verify "Before restore" checkpoint was saved to versions
      const listAfterRestore = await dispatch({
        method: 'GET',
        url: `/api/projects/${projId}/versions`,
      });
      expect(listAfterRestore.body.versions[0].label).toBe('Before restore');
      expect(listAfterRestore.body.versions[0].source).toBe('restore');

      // 8. Delete a version
      const delRes = await dispatch({
        method: 'DELETE',
        url: `/api/projects/${projId}/versions/${vId}`,
      });
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });

    it('caps saved versions to 100 on disk with FIFO rotation', async () => {
      const projId = `test-fifo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await dispatch({
        method: 'POST',
        url: '/api/projects',
        body: { id: projId, name: 'FIFO Test', data: { files: { 'app/page.tsx': 'init' } } },
      });

      // Save 105 distinct versions
      for (let i = 1; i <= 105; i++) {
        await dispatch({
          method: 'PUT',
          url: `/api/projects/${projId}`,
          body: {
            data: { files: { 'app/page.tsx': `v-${i}` } },
            source: 'autosave',
            label: `Version ${i}`,
          },
        });
      }

      const listRes = await dispatch({
        method: 'GET',
        url: `/api/projects/${projId}/versions`,
      });
      expect(listRes.status).toBe(200);
      expect(listRes.body.count).toBe(100);
      // Newest should be version 105
      expect(listRes.body.versions[0].label).toBe('Version 105');
      // Oldest kept should be version 6 (1-5 were pruned)
      expect(listRes.body.versions[99].label).toBe('Version 6');
    });

    it('handles file upload via POST /api/upload and serves it via GET /api/uploads/:file without collision with GET /api/upload', async () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const fileContent = 'PNG_MOCK_IMAGE_DATA_12345';
      const multipartBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="my-directus-test.png"',
        'Content-Type: image/png',
        '',
        fileContent,
        `--${boundary}--`,
      ].join('\r\n');

      // 1. Upload the file
      const uploadRes = await dispatch({
        method: 'POST',
        url: '/api/upload',
        body: multipartBody,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });
      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.filename).toContain('my-directus-test.png');
      expect(uploadRes.body.url).toMatch(/^\/api\/uploads\/.+my-directus-test\.png$/);

      const uploadedUrl = uploadRes.body.url;
      const uploadedFile = uploadRes.body.filename;

      // 2. Fetch the uploaded file directly (GET /api/uploads/:file)
      const fileRes = await dispatch({
        method: 'GET',
        url: uploadedUrl,
      });
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers['content-type']).toBe('image/png');
      expect(fileRes.body).toBe(fileContent);

      // 3. GET /api/upload should return the list of uploads and NOT intercept the file endpoint
      const listRes = await dispatch({
        method: 'GET',
        url: '/api/upload?type=image',
      });
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.uploads)).toBe(true);
      const found = listRes.body.uploads.find((u: any) => u.key === uploadedFile);
      expect(found).toBeDefined();

      // 4. DELETE /api/upload removes the file
      const deleteRes = await dispatch({
        method: 'DELETE',
        url: `/api/upload?key=${encodeURIComponent(uploadedFile)}`,
      });
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.deleted).toBe(1);

      // 5. Subsequent GET /api/uploads/:file should 404
      const afterDeleteRes = await dispatch({
        method: 'GET',
        url: uploadedUrl,
      });
      expect(afterDeleteRes.status).toBe(404);
    });

    it('isolates uploads per project via websiteId query and form fields', async () => {
      // 1. Upload for project-1 with multipart field websiteId
      const boundary = '----WebKitFormBoundaryProjectScope123';
      const file1 = 'IMAGE_DATA_PROJECT_1';
      const body1 = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="proj1-image.png"',
        'Content-Type: image/png',
        '',
        file1,
        `--${boundary}`,
        'Content-Disposition: form-data; name="websiteId"',
        '',
        'site-alpha',
        `--${boundary}--`,
      ].join('\r\n');

      const upload1 = await dispatch({
        method: 'POST',
        url: '/api/upload',
        body: body1,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(upload1.status).toBe(200);

      // 2. Upload for project-2 with query parameter websiteId
      const file2 = 'IMAGE_DATA_PROJECT_2';
      const body2 = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="proj2-image.png"',
        'Content-Type: image/png',
        '',
        file2,
        `--${boundary}--`,
      ].join('\r\n');

      const upload2 = await dispatch({
        method: 'POST',
        url: '/api/upload?websiteId=site-beta',
        body: body2,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(upload2.status).toBe(200);

      // 3. GET /api/upload?websiteId=site-alpha returns only site-alpha uploads
      const listAlpha = await dispatch({
        method: 'GET',
        url: '/api/upload?websiteId=site-alpha&type=image',
      });
      expect(listAlpha.status).toBe(200);
      expect(listAlpha.body.uploads.some((u: any) => u.key === upload1.body.filename)).toBe(true);
      expect(listAlpha.body.uploads.some((u: any) => u.key === upload2.body.filename)).toBe(false);

      // 4. GET /api/upload?websiteId=site-beta returns only site-beta uploads
      const listBeta = await dispatch({
        method: 'GET',
        url: '/api/upload?websiteId=site-beta&type=image',
      });
      expect(listBeta.status).toBe(200);
      expect(listBeta.body.uploads.some((u: any) => u.key === upload2.body.filename)).toBe(true);
      expect(listBeta.body.uploads.some((u: any) => u.key === upload1.body.filename)).toBe(false);

      // 5. Clean up
      await dispatch({ method: 'DELETE', url: `/api/upload?key=${encodeURIComponent(upload1.body.filename)}` });
      await dispatch({ method: 'DELETE', url: `/api/upload?key=${encodeURIComponent(upload2.body.filename)}` });
    });
  });
});

