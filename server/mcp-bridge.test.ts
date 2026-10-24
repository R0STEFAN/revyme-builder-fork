import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpBridge } from './mcp-bridge';

function createMockReqRes(opts: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | object;
}) {
  const req = new EventEmitter() as any;
  req.method = opts.method || 'GET';
  req.url = opts.url;
  req.headers = { ...(opts.headers || {}) };

  const bodyData =
    opts.body !== undefined
      ? typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body)
      : '';

  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {} as Record<string, string>,
    writtenData: [] as string[],
    setHeader(name: string, val: string) {
      this.headers[name.toLowerCase()] = val;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          this.headers[k.toLowerCase()] = v;
        }
      }
    },
    write(chunk: string) {
      this.writtenData.push(chunk);
    },
    end(chunk?: string) {
      if (chunk) this.writtenData.push(chunk);
      this.ended = true;
    },
    ended: false,
  });

  return { req, res, bodyData };
}

describe('McpBridge', () => {
  let bridge: McpBridge;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed ECONNREFUSED')));
    bridge = new McpBridge({ requestTimeoutMs: 1000 });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await bridge.stopHttpServer();
  });

  describe('Basic Editor Communication', () => {
    it('rejects sendToEditor if no browser tabs are connected', async () => {
      await expect(bridge.sendToEditor('getContext', {})).rejects.toThrow(
        /Revyme editor is not connected/
      );
    });

    it('connects SSE client and receives ping', () => {
      const { req, res } = createMockReqRes({ method: 'GET', url: '/bridge/events' });
      bridge.handleEventsStream(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.writtenData[0]).toBe(': ping\n\n');
      expect(bridge.getActiveClientCount()).toBe(1);

      // Completing the GET request is not the same as closing its SSE response.
      req.emit('end');
      expect(bridge.getActiveClientCount()).toBe(1);

      // Disconnect
      res.emit('close');
      expect(bridge.getActiveClientCount()).toBe(0);
    });

    it('sends RPC to connected editor and resolves upon result', async () => {
      const { req, res } = createMockReqRes({ method: 'GET', url: '/bridge/events' });
      bridge.handleEventsStream(req, res);

      const sendPromise = bridge.sendToEditor('readFile', { path: 'app/page.tsx' });
      expect(bridge.getPendingRequestCount()).toBe(1);

      // Verify SSE payload sent
      expect(res.writtenData.length).toBeGreaterThan(1);
      const sseMsg = res.writtenData[1];
      expect(sseMsg).toContain('data: {"id":1,"method":"readFile","params":{"path":"app/page.tsx"}}\n\n');

      // Emulate editor returning result via handleResult
      const resultRes = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader() {},
        end: vi.fn(),
      };
      bridge.handleResult(
        JSON.stringify({ id: 1, result: { code: 'export default function Page() {}' } }),
        resultRes
      );

      const response = await sendPromise;
      expect(response).toEqual({ code: 'export default function Page() {}' });
      expect(bridge.getPendingRequestCount()).toBe(0);
    });

    it('routes project-scoped RPC only to the editor tab for that website', async () => {
      const other = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=other-site' });
      const target = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      bridge.handleEventsStream(other.req, other.res);
      bridge.handleEventsStream(target.req, target.res);

      const sendPromise = bridge.sendToEditor('project.snapshot.changed', {
        projectId: 'target-site',
        baseRevision: 10,
        revision: 11,
      });

      expect(other.res.writtenData).toHaveLength(1);
      expect(target.res.writtenData[1]).toContain('"method":"project.snapshot.changed"');
      expect(target.res.writtenData[1]).toContain('"projectId":"target-site"');

      bridge.handleResult(JSON.stringify({ id: 1, result: { applied: true } }), {
        statusCode: 200, headers: {}, setHeader() {}, end() {},
      });
      await expect(sendPromise).resolves.toEqual({ applied: true });

      other.res.emit('close');
      target.res.emit('close');
    });

    it('collects independent acknowledgements from every matching project tab', async () => {
      const first = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      const second = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      const other = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=other-site' });
      bridge.handleEventsStream(first.req, first.res);
      bridge.handleEventsStream(second.req, second.res);
      bridge.handleEventsStream(other.req, other.res);

      const sendPromise = bridge.sendToEditors('projectSnapshotChanged', {
        projectId: 'target-site',
        revision: 12,
      });
      const firstRequest = JSON.parse(first.res.writtenData[1].slice('data: '.length));
      const secondRequest = JSON.parse(second.res.writtenData[1].slice('data: '.length));

      expect(firstRequest.method).toBe('projectSnapshotChanged');
      expect(secondRequest.method).toBe('projectSnapshotChanged');
      expect(firstRequest.id).not.toBe(secondRequest.id);
      expect(other.res.writtenData).toHaveLength(1);

      const resultResponse = () => ({ statusCode: 200, headers: {}, setHeader() {}, end() {} });
      bridge.handleResult(JSON.stringify({ id: firstRequest.id, result: { applied: false, reason: 'LOCAL_CHANGES_PENDING' } }), resultResponse());
      bridge.handleResult(JSON.stringify({ id: secondRequest.id, result: { applied: true, revision: 12 } }), resultResponse());

      await expect(sendPromise).resolves.toEqual([
        { ok: true, result: { applied: false, reason: 'LOCAL_CHANGES_PENDING' } },
        { ok: true, result: { applied: true, revision: 12 } },
      ]);
      first.res.emit('close');
      second.res.emit('close');
      other.res.emit('close');
    });

    it('chooses the audit snapshot from the tab matching the requested revision', async () => {
      const stale = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      const current = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      bridge.handleEventsStream(stale.req, stale.res);
      bridge.handleEventsStream(current.req, current.res);
      const { res } = createMockReqRes({ method: 'POST', url: '/rpc' });

      const rpcPromise = bridge.handleRpc(JSON.stringify({
        method: 'observeAuditSnapshot',
        params: { projectId: 'target-site', revision: 12, viewport: 'desktop' },
      }), res);
      const staleRequest = JSON.parse(stale.res.writtenData[1].slice('data: '.length));
      const currentRequest = JSON.parse(current.res.writtenData[1].slice('data: '.length));
      expect(staleRequest.id).not.toBe(currentRequest.id);

      const resultResponse = () => ({ statusCode: 200, headers: {}, setHeader() {}, end() {} });
      bridge.handleResult(JSON.stringify({ id: staleRequest.id, result: {
        status: 'unavailable', reason: 'REVISION_MISMATCH', revision: 11,
      } }), resultResponse());
      bridge.handleResult(JSON.stringify({ id: currentRequest.id, result: {
        status: 'ready', revision: 12, nodes: [{ id: 'root' }],
      } }), resultResponse());

      await rpcPromise;
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.writtenData.join(''))).toMatchObject({
        ok: true,
        result: { status: 'ready', revision: 12, nodes: [{ id: 'root' }] },
      });
      stale.res.emit('close');
      current.res.emit('close');
    });

    it('chooses the screenshot from the tab matching the requested revision', async () => {
      const stale = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      const current = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=target-site' });
      bridge.handleEventsStream(stale.req, stale.res);
      bridge.handleEventsStream(current.req, current.res);
      const { res } = createMockReqRes({ method: 'POST', url: '/rpc' });

      const rpcPromise = bridge.handleRpc(JSON.stringify({
        method: 'captureScreenshot',
        params: {
          projectId: 'target-site',
          branchId: 'main',
          filePath: 'app/page.client.tsx',
          revision: 12,
          viewport: 'desktop',
          nodeId: 'root',
          format: 'png',
        },
      }), res);
      const staleRequest = JSON.parse(stale.res.writtenData[1].slice('data: '.length));
      const currentRequest = JSON.parse(current.res.writtenData[1].slice('data: '.length));
      expect(staleRequest.id).not.toBe(currentRequest.id);

      const resultResponse = () => ({ statusCode: 200, headers: {}, setHeader() {}, end() {} });
      bridge.handleResult(JSON.stringify({ id: staleRequest.id, result: {
        available: false,
        status: 'unavailable',
        reason: 'REVISION_MISMATCH',
        canvasRevision: 11,
      } }), resultResponse());
      bridge.handleResult(JSON.stringify({ id: currentRequest.id, result: {
        available: true,
        status: 'ready',
        dataUrl: 'data:image/png;base64,current',
        canvasRevision: 12,
      } }), resultResponse());

      await rpcPromise;
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.writtenData.join(''))).toMatchObject({
        ok: true,
        result: {
          available: true,
          status: 'ready',
          dataUrl: 'data:image/png;base64,current',
          canvasRevision: 12,
        },
      });
      stale.res.emit('close');
      current.res.emit('close');
    });

    it('does not fall back to a different project tab for project-scoped RPC', async () => {
      const other = createMockReqRes({ method: 'GET', url: '/bridge/events?websiteId=other-site' });
      bridge.handleEventsStream(other.req, other.res);

      await expect(bridge.sendToEditor('project.snapshot.changed', { projectId: 'target-site' }))
        .rejects.toThrow(/No editor tab connected for project "target-site"/);
      expect(other.res.writtenData).toHaveLength(1);
      other.res.emit('close');
    });

    it('rejects sendToEditor if editor returns an error', async () => {
      const { req, res } = createMockReqRes({ method: 'GET', url: '/bridge/events' });
      bridge.handleEventsStream(req, res);

      const sendPromise = bridge.sendToEditor('readFile', { path: 'nonexistent.tsx' });

      const resultRes = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader() {},
        end: vi.fn(),
      };
      bridge.handleResult(
        JSON.stringify({ id: 1, error: 'File not found: nonexistent.tsx' }),
        resultRes
      );

      await expect(sendPromise).rejects.toThrow('File not found: nonexistent.tsx');
    });

    it('times out if editor does not respond', async () => {
      const { req, res } = createMockReqRes({ method: 'GET', url: '/bridge/events' });
      bridge.handleEventsStream(req, res);

      const sendPromise = bridge.sendToEditor('longTask', {}, 50);
      await expect(sendPromise).rejects.toThrow(/Timed out waiting for response/);
      expect(bridge.getPendingRequestCount()).toBe(0);
    });
  });

  describe('HTTP & Middleware handling', () => {
    it('binds the standalone HTTP bridge to loopback only', async () => {
      const server = bridge.startHttpServer(0);
      await new Promise<void>((resolve) => server.once('listening', resolve));

      expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
    });

    it('recovers after a transient EADDRINUSE during a Vite restart', async () => {
      const blocker = http.createServer();
      await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
      const port = (blocker.address() as AddressInfo).port;
      const recoveringBridge = new McpBridge();
      const failedAttempt = recoveringBridge.startHttpServer(port);

      try {
        const bindError = await new Promise<NodeJS.ErrnoException>((resolve) => {
          failedAttempt.once('error', resolve);
        });
        expect(bindError.code).toBe('EADDRINUSE');

        await new Promise<void>((resolve, reject) => {
          blocker.close((error) => error ? reject(error) : resolve());
        });

        const deadline = Date.now() + 1500;
        let status: number | undefined;
        while (Date.now() < deadline) {
          status = await new Promise<number | undefined>((resolve) => {
            const request = http.get({ host: '127.0.0.1', port, path: '/api/mcp/status' }, (response) => {
              response.resume();
              resolve(response.statusCode);
            });
            request.once('error', () => resolve(undefined));
          });
          if (status === 200) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        expect(status).toBe(200);
      } finally {
        await recoveringBridge.stopHttpServer();
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    });

    it('handles CORS OPTIONS request', async () => {
      const middleware = bridge.middleware();
      const { req, res } = createMockReqRes({
        method: 'OPTIONS',
        url: '/rpc',
        headers: { origin: 'http://localhost:3000' },
      });

      const next = vi.fn();
      await middleware(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.ended).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('handles /api/mcp/status endpoint', async () => {
      const middleware = bridge.middleware();
      const { req, res } = createMockReqRes({ method: 'GET', url: '/api/mcp/status' });

      const next = vi.fn();
      await middleware(req, res, next);

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.writtenData.join(''));
      expect(parsed).toEqual({ ok: true, activeTabs: 0, pendingRequests: 0 });
    });

    it('handles /rpc endpoint dispatching to editor', async () => {
      const { req: sseReq, res: sseRes } = createMockReqRes({ method: 'GET', url: '/bridge/events' });
      bridge.handleEventsStream(sseReq, sseRes);

      const middleware = bridge.middleware();
      const { req: rpcReq, res: rpcRes, bodyData } = createMockReqRes({
        method: 'POST',
        url: '/rpc',
        body: { method: 'getContext', params: {} },
      });

      const next = vi.fn();
      const endPromise = new Promise<void>((resolve) => {
        const origEnd = rpcRes.end;
        rpcRes.end = function (chunk?: string) {
          origEnd.call(this, chunk);
          resolve();
        };
      });

      middleware(rpcReq, rpcRes, next);

      // Emit data and end
      rpcReq.emit('data', Buffer.from(bodyData));
      rpcReq.emit('end');

      // Resolve from browser
      bridge.handleResult(
        JSON.stringify({ id: 1, result: { activeFilePath: 'app/page.client.tsx' } }),
        { statusCode: 200, headers: {}, setHeader() {}, end() {} }
      );

      await endPromise;
      expect(rpcRes.statusCode).toBe(200);
      const parsed = JSON.parse(rpcRes.writtenData.join(''));
      expect(parsed).toEqual({
        ok: true,
        result: { activeFilePath: 'app/page.client.tsx' },
      });
    });

    it('handles /rpc missing method error', async () => {
      const middleware = bridge.middleware();
      const { req, res, bodyData } = createMockReqRes({
        method: 'POST',
        url: '/rpc',
        body: {},
      });

      const next = vi.fn();
      const endPromise = new Promise<void>((resolve) => {
        const origEnd = res.end;
        res.end = function (chunk?: string) {
          origEnd.call(this, chunk);
          resolve();
        };
      });

      middleware(req, res, next);
      req.emit('data', Buffer.from(bodyData));
      req.emit('end');
      await endPromise;

      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.writtenData.join(''));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('Method is required');
    });

    it('passes unhandled routes through next()', async () => {
      const middleware = bridge.middleware();
      const { req, res } = createMockReqRes({ method: 'GET', url: '/api/projects' });

      const next = vi.fn();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Legacy External MCP Removal Assertions', () => {
    it('verifies old stdio launcher and public tools dispatcher are removed', () => {
      expect((bridge as any).createMcpServer).toBeUndefined();
      expect((bridge as any).startStdio).toBeUndefined();
      expect((bridge as any).mcpServer).toBeUndefined();
    });

    it('ensures internal editor bridge communication remains operational', async () => {
      const { req, res } = createMockReqRes({ method: 'GET', url: '/bridge/events' });
      bridge.handleEventsStream(req, res);
      expect(bridge.getActiveClientCount()).toBe(1);

      const sendPromise = bridge.sendToEditor('testMethod', { foo: 'bar' });
      expect(bridge.getPendingRequestCount()).toBe(1);

      const resultRes = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader() {},
        end() {},
      };
      bridge.handleResult(
        JSON.stringify({ id: 1, result: { success: true } }),
        resultRes
      );

      const result = await sendPromise;
      expect(result).toEqual({ success: true });
    });
  });
});
