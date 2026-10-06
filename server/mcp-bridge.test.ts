import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
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

  const res = {
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
  };

  return { req, res, bodyData };
}

describe('McpBridge', () => {
  let bridge: McpBridge;

  beforeEach(() => {
    bridge = new McpBridge({ requestTimeoutMs: 1000 });
  });

  afterEach(async () => {
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

      // Disconnect
      req.emit('close');
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
      const rpcPromise = middleware(rpcReq, rpcRes, next);

      // Emit data and end
      rpcReq.emit('data', Buffer.from(bodyData));
      rpcReq.emit('end');

      // Resolve from browser
      bridge.handleResult(
        JSON.stringify({ id: 1, result: { activeFilePath: 'app/page.client.tsx' } }),
        { statusCode: 200, headers: {}, setHeader() {}, end() {} }
      );

      await rpcPromise;
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
      const p = middleware(req, res, next);
      req.emit('data', Buffer.from(bodyData));
      req.emit('end');
      await p;

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

  describe('MCP Protocol SDK Server', () => {
    it('registers MCP tools properly', async () => {
      const mcpServer = bridge.createMcpServer();
      expect(mcpServer).toBeDefined();
    });
  });
});
