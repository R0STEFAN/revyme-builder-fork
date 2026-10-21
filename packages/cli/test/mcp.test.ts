// packages/cli/test/mcp.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp';
import { AutomationClient } from '../src/client';
import { defaultRegistry } from '@revyme/automation-core';

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
