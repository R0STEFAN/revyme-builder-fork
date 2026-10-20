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

  describe('MCP Protocol SDK Server', () => {
    it('registers MCP tools properly', async () => {
      const mcpServer = bridge.createMcpServer();
      expect(mcpServer).toBeDefined();
    });

    it('lists revyme_insert_fragment with proper schema in ListTools', async () => {
      const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const result = await handler({ method: 'tools/list', params: {} });
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('revyme_insert_fragment');

      const tool = result.tools.find((t: any) => t.name === 'revyme_insert_fragment');
      expect(tool.inputSchema.properties.parent_id).toBeDefined();
      expect(tool.inputSchema.properties.fragment).toBeDefined();
    });

    it('dispatches revyme_insert_fragment via CallTool to agent.tool with name insert_fragment', async () => {
      const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        root_id: 'frame-123',
        count: 1,
      });

      const callResult = await handler({
        method: 'tools/call',
        params: {
          name: 'revyme_insert_fragment',
          arguments: {
            parent_id: 'main-container',
            fragment: { tag: 'div', name: 'Card' },
          },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'insert_fragment',
        input: {
          parent_id: 'main-container',
          fragment: { tag: 'div', name: 'Card' },
        },
      });
      expect(callResult.isError).toBeUndefined();
      expect(callResult.content[0].text).toContain('frame-123');
    });

    it('lists revyme_insert_section with proper schema in ListTools', async () => {
      const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const result = await handler({ method: 'tools/list', params: {} });
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('revyme_insert_section');

      const tool = result.tools.find((t: any) => t.name === 'revyme_insert_section');
      expect(tool.inputSchema.properties.section).toBeDefined();
    });

    it('dispatches revyme_insert_section via CallTool to agent.tool with name insert_section', async () => {
      const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        node_id: 'section-header-editorial',
        section: 'header-editorial',
        name: 'Header — Editorial',
      });

      const callResult = await handler({
        method: 'tools/call',
        params: {
          name: 'revyme_insert_section',
          arguments: {
            section: 'header-editorial',
            parent_id: 'root',
            index: 0,
          },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'insert_section',
        input: {
          section: 'header-editorial',
          parent_id: 'root',
          index: 0,
        },
      });
      expect(callResult.isError).toBeUndefined();
      expect(callResult.content[0].text).toContain('section-header-editorial');
    });

    it('lists revyme_apply_motion_preset with proper schema in ListTools', async () => {
      const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const result = await handler({ method: 'tools/list', params: {} });
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('revyme_apply_motion_preset');

      const tool = result.tools.find((t: any) => t.name === 'revyme_apply_motion_preset');
      expect(tool.inputSchema.properties.node_id).toBeDefined();
      expect(tool.inputSchema.properties.preset).toBeDefined();
    });

    it('dispatches revyme_apply_motion_preset via CallTool to agent.tool with name apply_motion_preset', async () => {
      const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        node_id: 'card-1',
        preset: 'lift-on-hover',
        physics: 'gentle',
      });

      const callResult = await handler({
        method: 'tools/call',
        params: {
          name: 'revyme_apply_motion_preset',
          arguments: {
            node_id: 'card-1',
            preset: 'lift-on-hover',
          },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'apply_motion_preset',
        input: {
          node_id: 'card-1',
          preset: 'lift-on-hover',
        },
      });
      expect(callResult.isError).toBeUndefined();
      expect(callResult.content[0].text).toContain('lift-on-hover');
    });

    it('lists revyme_manage_component_variant with proper schema in ListTools', async () => {
      const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const result = await handler({ method: 'tools/list', params: {} });
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('revyme_manage_component_variant');

      const tool = result.tools.find((t: any) => t.name === 'revyme_manage_component_variant');
      expect(tool.inputSchema.properties.component).toBeDefined();
      expect(tool.inputSchema.properties.action).toBeDefined();
    });

    it('dispatches revyme_manage_component_variant via CallTool to agent.tool with name manage_component_variant', async () => {
      const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const handler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);
      expect(handler).toBeDefined();

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        component: 'Button',
        variant: 'default-hover',
        interaction: 'hover',
      });

      const callResult = await handler({
        method: 'tools/call',
        params: {
          name: 'revyme_manage_component_variant',
          arguments: {
            component: 'Button',
            action: 'add_interaction',
            interaction: 'hover',
          },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'manage_component_variant',
        input: {
          component: 'Button',
          action: 'add_interaction',
          interaction: 'hover',
        },
      });
      expect(callResult.isError).toBeUndefined();
      expect(callResult.content[0].text).toContain('default-hover');
    });

    it('lists and calls revyme_list_built_in_components', async () => {
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const listHandler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const callHandler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const listResult = await listHandler({ method: 'tools/list', params: {} });
      expect(listResult.tools.some((t: any) => t.name === 'revyme_list_built_in_components')).toBe(true);

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        count: 1,
        components: [{ tag: 'Marquee', label: 'Marquee', comment: 'Continuous strip' }],
      });

      const callResult = await callHandler({
        method: 'tools/call',
        params: {
          name: 'revyme_list_built_in_components',
          arguments: { query: 'marquee' },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'list_built_in_components',
        input: { query: 'marquee' },
      });
      expect(callResult.content[0].text).toContain('Marquee');
    });

    it('lists and calls revyme_add_built_in_component', async () => {
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const listHandler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const callHandler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const listResult = await listHandler({ method: 'tools/list', params: {} });
      expect(listResult.tools.some((t: any) => t.name === 'revyme_add_built_in_component')).toBe(true);

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        node_id: 'marquee-1',
        tag: 'Marquee',
        installed: true,
      });

      const callResult = await callHandler({
        method: 'tools/call',
        params: {
          name: 'revyme_add_built_in_component',
          arguments: {
            tag: 'Marquee',
            parent_id: 'marquee-sec',
            props: { speed: 80, direction: 'left' },
          },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'add_built_in_component',
        input: {
          tag: 'Marquee',
          parent_id: 'marquee-sec',
          props: { speed: 80, direction: 'left' },
        },
      });
      expect(callResult.content[0].text).toContain('marquee-1');
    });

    it('lists and calls revyme_set_responsive_styles', async () => {
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const listHandler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const callHandler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const listResult = await listHandler({ method: 'tools/list', params: {} });
      expect(listResult.tools.some((t: any) => t.name === 'revyme_set_responsive_styles')).toBe(true);

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        applied: 1,
        viewport: 'mobile',
      });

      const callResult = await callHandler({
        method: 'tools/call',
        params: {
          name: 'revyme_set_responsive_styles',
          arguments: {
            node_id: 'hero-title',
            viewport: 'mobile',
            styles: { fontSize: '32px' },
          },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'set_styles',
        input: {
          node_id: 'hero-title',
          viewport: 'mobile',
          styles: { fontSize: '32px' },
        },
      });
      expect(callResult.content[0].text).toContain('applied');
    });

    it('lists and calls revyme_inspect_node', async () => {
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const listHandler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const callHandler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const listResult = await listHandler({ method: 'tools/list', params: {} });
      expect(listResult.tools.some((t: any) => t.name === 'revyme_inspect_node')).toBe(true);

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        id: 'site-header',
        type: 'header',
        name: 'Site Header',
        styles: { display: 'flex' },
      });

      const callResult = await callHandler({
        method: 'tools/call',
        params: {
          name: 'revyme_inspect_node',
          arguments: { node_id: 'site-header' },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'get_node',
        input: { node_id: 'site-header' },
      });
      expect(callResult.content[0].text).toContain('Site Header');
    });

    it('lists and calls revyme_search_project', async () => {
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const listHandler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const callHandler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const listResult = await listHandler({ method: 'tools/list', params: {} });
      expect(listResult.tools.some((t: any) => t.name === 'revyme_search_project')).toBe(true);

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        query: 'Navbar',
        matchCount: 1,
        matches: [{ file: 'components/Navbar.tsx', line: 10, text: 'export default Navbar' }],
      });

      const callResult = await callHandler({
        method: 'tools/call',
        params: {
          name: 'revyme_search_project',
          arguments: { query: 'Navbar' },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('searchProject', { query: 'Navbar' });
      expect(callResult.content[0].text).toContain('components/Navbar.tsx');
    });

    it('lists and calls revyme_audit_design', async () => {
      const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
      const mcpServer = bridge.createMcpServer() as any;
      const listHandler = mcpServer._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const callHandler = mcpServer._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const listResult = await listHandler({ method: 'tools/list', params: {} });
      expect(listResult.tools.some((t: any) => t.name === 'revyme_audit_design')).toBe(true);

      const sendToEditorSpy = vi.spyOn(bridge, 'sendToEditor').mockResolvedValue({
        status: 'ready',
        violations: [],
        summary: 'No violations detected.',
      });

      const callResult = await callHandler({
        method: 'tools/call',
        params: {
          name: 'revyme_audit_design',
          arguments: { viewport: 'tablet' },
        },
      });

      expect(sendToEditorSpy).toHaveBeenCalledWith('agent.tool', {
        name: 'audit_design',
        input: { viewport: 'tablet' },
      });
      expect(callResult.content[0].text).toContain('No violations detected');
    });
  });
});
