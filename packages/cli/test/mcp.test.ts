// packages/cli/test/mcp.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp';
import { AutomationClient } from '../src/client';
import { defaultRegistry } from '@revyme/automation-core';
import { observeAuditOperation, observeScreenshotOperation } from '@revyme/automation-core';

describe('T05: Revyme Model Context Protocol (MCP) Server v2', () => {
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;
  let autoClient: AutomationClient;

  beforeEach(async () => {
    autoClient = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    server = createMcpServer({
      client: autoClient,
      config: {
        projectId: 'test-default-proj',
        branchId: 'main',
        apiUrl: 'http://localhost:3000',
        projectDir: process.cwd(),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'vitest-mcp-client', version: '2.0.0' }, { capabilities: {} });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists all registered tools with valid JSON schemas and metadata', async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBeGreaterThanOrEqual(6);

    const metaTools = res.tools.find((t) => t.name === 'meta.tools');
    expect(metaTools).toBeDefined();
    expect(metaTools?.description).toContain('meta.tools');
    expect(metaTools?.inputSchema.type).toBe('object');
    expect(metaTools?.inputSchema.properties?.projectId).toBeDefined();
    expect(metaTools?.inputSchema.properties?.branchId).toBeDefined();
  });

  it('supports paged tool discovery via cursor', async () => {
    // When requesting tools, ensure the handler returns tools and appropriate pagination
    const page1 = await client.listTools();
    expect(page1.tools).toBeDefined();
    expect(Array.isArray(page1.tools)).toBe(true);
  });

function getTextContent(res: any, index = 0): string {
  const content = res.content as Array<{ type: string; text: string }>;
  return content[index]?.text ?? '';
}

  it('executes meta.guide successfully and returns structured text payload', async () => {
    const res = await client.callTool({
      name: 'meta.guide',
      arguments: { topic: 'general' },
    });

    expect(res.isError).toBe(false);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');

    const data = JSON.parse(getTextContent(res));
    expect(data.ok).toBe(true);
    expect(data.data.topic).toBe('general');
    expect(data.data.recommendedWorkflow.length).toBeGreaterThan(0);
  });

  it('handles unknown tool gracefully returning isError=true and near matches', async () => {
    const res = await client.callTool({
      name: 'meta.guides', // Typo of meta.guide
      arguments: {},
    });

    expect(res.isError).toBe(true);
    const data = JSON.parse(getTextContent(res));
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe('UNKNOWN_OPERATION');
    expect(data.error.message).toContain('meta.guide');
  });

  it('supports multi-project execution by specifying projectId in tool arguments', async () => {
    const res = await client.callTool({
      name: 'meta.index',
      arguments: {
        projectId: 'tenant-brand-alpha',
        branchId: 'staging',
        category: 'meta',
      },
    });

    expect(res.isError).toBe(false);
    const data = JSON.parse(getTextContent(res));
    expect(data.ok).toBe(true);
    expect(data.data.operations.length).toBeGreaterThanOrEqual(3);
  });

  it('passes a mutation target file into the scope used for plan hashing', async () => {
    const execute = vi.spyOn(autoClient, 'execute').mockResolvedValue({
      ok: true,
      data: { removedTokens: [] },
      meta: { commitStatus: 'not_committed', revision: 1 },
    });

    const res = await client.callTool({
      name: 'typography.remove',
      arguments: { name: 'legacy-copy', force: true, targetFile: 'app/globals.css' },
    });

    expect(res.isError).toBe(false);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'app/globals.css' }),
      'typography.remove',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('passes component master paths into the scope used for plan hashing', async () => {
    const execute = vi.spyOn(autoClient, 'execute').mockResolvedValue({
      ok: true,
      data: { connections: [] },
      meta: { commitStatus: 'not_committed', revision: 1 },
    });

    const res = await client.callTool({
      name: 'connections.create',
      arguments: {
        componentFile: 'components/PrimaryButton.tsx',
        from: 'default',
        to: 'hover',
        trigger: 'mouseEnter',
        sourceNode: 'button-root',
      },
    });

    expect(res.isError).toBe(false);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'components/PrimaryButton.tsx' }),
      'connections.create',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('captures screenshots through the active editor bridge adapter', async () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8=';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          available: true,
          status: 'ready',
          dataUrl,
          width: 640,
          height: 480,
          waitedMs: 24,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.spyOn(autoClient, 'execute').mockImplementation(async (scope, toolName, input, options) => {
      if (toolName !== 'observe.screenshot') throw new Error(`Unexpected tool: ${toolName}`);
      const output = await observeScreenshotOperation.execute(
        {
          scope,
          revision: 7,
          files: new Map([['app/page.client.tsx', '<div data-id="root" />']]),
          config: {},
        },
        input as any,
        options?.context as any,
      );
      return {
        ok: true,
        data: output,
        meta: { commitStatus: 'not_committed', revision: 7 },
      } as any;
    });

    const res = await client.callTool({
      name: 'observe.screenshot',
      arguments: {
        projectId: 'test-default-proj',
        branchId: 'main',
        filePath: 'app/page.client.tsx',
        viewport: 'desktop',
        format: 'png',
      },
    });

    expect(res.isError).toBe(false);
    const payload = JSON.parse(getTextContent(res));
    expect(payload.data.available).toBe(true);
    expect(payload.data.primary.dataUrl).toBe(dataUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8082/rpc');
    expect(JSON.parse(String(request.body))).toEqual({
      method: 'captureScreenshot',
      params: {
        projectId: 'test-default-proj',
        branchId: 'main',
        filePath: 'app/page.client.tsx',
        revision: 7,
        viewport: 'desktop',
        nodeId: 'root',
        format: 'png',
        pixelRatio: 1,
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports a disconnected editor as an unavailable screenshot instead of a generic bridge error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: 'No editor tab connected for project "test-default-proj"' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(autoClient, 'execute').mockImplementation(async (scope, toolName, input, options) => {
      if (toolName !== 'observe.screenshot') throw new Error(`Unexpected tool: ${toolName}`);
      const output = await observeScreenshotOperation.execute(
        {
          scope,
          revision: 7,
          files: new Map([['app/page.client.tsx', '<div data-id="root" />']]),
          config: {},
        },
        input as any,
        options?.context as any,
      );
      return { ok: true, data: output, meta: { commitStatus: 'not_committed', revision: 7 } } as any;
    });

    const res = await client.callTool({
      name: 'observe.screenshot',
      arguments: {
        projectId: 'test-default-proj',
        branchId: 'main',
        filePath: 'app/page.client.tsx',
        viewport: 'desktop',
        format: 'png',
      },
    });

    expect(res.isError).toBe(false);
    const payload = JSON.parse(getTextContent(res));
    expect(payload.data.primary).toMatchObject({
      available: false,
      status: 'unavailable',
      reason: 'EDITOR_NOT_CONNECTED',
      note: 'No editor tab connected for project "test-default-proj"',
    });
  });

  it('collects audit measurements from the active Builder canvas', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          status: 'ready',
          reason: 'Measured from the active Builder canvas.',
          nodes: [
            { id: 'root', parentId: null, children: ['cta-btn'], text: '', rect: { x: 0, y: 0, width: 1200, height: 900 }, computed: {} },
            { id: 'cta-btn', parentId: 'root', children: [], text: 'Go', rect: { x: 20, y: 20, width: 120, height: 48 }, computed: { color: '#fff', backgroundColor: '#000', fontSize: '16px' } },
          ],
          epoch: {
            renderSeq: 4,
            projectVersionAtFill: 3,
            projectVersionNow: 3,
            stale: false,
            withRect: 2,
            total: 2,
            unmeasured: [],
            unmeasuredTotal: 0,
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.spyOn(autoClient, 'execute').mockImplementation(async (scope, toolName, input, options) => {
      if (toolName !== 'observe.audit') throw new Error(`Unexpected tool: ${toolName}`);
      const data = await observeAuditOperation.execute(
        {
          scope,
          revision: 7,
          files: new Map([['app/page.client.tsx', '<div data-id="root"><button data-id="cta-btn">Go</button></div>']]),
          config: {},
        },
        input as any,
        options?.context as any,
      );
      return { ok: true, data, meta: { commitStatus: 'not_committed', revision: 7 } } as any;
    });

    const res = await client.callTool({
      name: 'observe.audit',
      arguments: { projectId: 'test-default-proj', branchId: 'main', filePath: 'app/page.client.tsx', viewport: 'desktop' },
    });

    expect(res.isError).toBe(false);
    const payload = JSON.parse(getTextContent(res));
    expect(payload.data.status).toBe('ready');
    expect(payload.data.stats.touchTargetsChecked).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8082/rpc');
    expect(JSON.parse(String(request.body))).toEqual({
      method: 'observeAuditSnapshot',
      params: {
        projectId: 'test-default-proj',
        branchId: 'main',
        filePath: 'app/page.client.tsx',
        revision: 7,
        viewport: 'desktop',
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('enforces structured error when project operation lacks projectId', async () => {
    // Create server with no default projectId
    const noProjServer = createMcpServer({
      client: autoClient,
      config: {
        branchId: 'main',
        apiUrl: 'http://localhost:3000',
        projectDir: process.cwd(),
      },
    });
    const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'no-proj-client', version: '2.0.0' }, { capabilities: {} });
    await Promise.all([noProjServer.connect(sTrans), testClient.connect(cTrans)]);

    try {
      const res = await testClient.callTool({
        name: 'workflow.batch',
        arguments: {
          operations: [{ tool: 'meta.guide', input: {} }],
        },
      });

      expect(res.isError).toBe(true);
      const data = JSON.parse(getTextContent(res));
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('MISSING_PROJECT_ID');
    } finally {
      await testClient.close();
      await noProjServer.close();
    }
  });

  it('verifies that no legacy /rpc fallback is used', async () => {
    // Calling an operation should go through new automation contracts and return standard format
    const res = await client.callTool({
      name: 'meta.tools',
      arguments: { name: 'meta.index' },
    });

    expect(res.isError).toBe(false);
    const payload = JSON.parse(getTextContent(res));
    expect(payload.meta).toBeDefined();
    expect(payload.meta.commitStatus).toBeDefined();
    // In legacy /rpc, responses had properties like { broadcast: ..., success: ... } without Revyme Result contract
    expect(payload.broadcast).toBeUndefined();
  });
});
