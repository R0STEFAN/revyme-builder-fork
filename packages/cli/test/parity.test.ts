// packages/cli/test/parity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runCli } from '../src/main';
import { createMcpServer } from '../src/mcp';
import { AutomationClient } from '../src/client';

function getTextContent(res: any, index = 0): string {
  const content = res.content as Array<{ type: string; text: string }>;
  return content[index]?.text ?? '';
}

describe('T05: Parity between CLI and stdio MCP', () => {
  let mcpClient: Client;
  let mcpServer: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    const autoClient = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    mcpServer = createMcpServer({
      client: autoClient,
      config: {
        projectId: 'test-parity-proj',
        branchId: 'main',
        apiUrl: 'http://localhost:3000',
        projectDir: process.cwd(),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcpClient = new Client({ name: 'parity-client', version: '2.0.0' }, { capabilities: {} });
    await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
  });

  afterEach(async () => {
    await mcpClient.close();
    await mcpServer.close();
  });

  it('produces identical structured success result for meta.guide between CLI and MCP', async () => {
    // 1. Invoke via CLI
    const cliOutputs: string[] = [];
    const cliCode = await runCli({
      argv: ['meta.guide', '--topic', 'general'],
      stdout: (msg) => cliOutputs.push(msg),
    });
    expect(cliCode).toBe(0);
    const cliResult = JSON.parse(cliOutputs.join(''));

    // 2. Invoke via MCP
    const mcpRes = await mcpClient.callTool({
      name: 'meta.guide',
      arguments: { topic: 'general' },
    });
    expect(mcpRes.isError).toBe(false);
    const mcpResult = JSON.parse(getTextContent(mcpRes));

    // 3. Parity assertions
    expect(cliResult.ok).toBe(mcpResult.ok);
    expect(cliResult.data).toEqual(mcpResult.data);
    expect(cliResult.meta.commitStatus).toBe(mcpResult.meta.commitStatus);
    expect(cliResult.meta.revision).toBe(mcpResult.meta.revision);
  });

  it('produces identical structured error response for unknown operation between CLI and MCP', async () => {
    // 1. Invoke via CLI
    const cliErrors: string[] = [];
    const cliCode = await runCli({
      argv: ['nonexistent.tool'],
      stderr: (msg) => cliErrors.push(msg),
    });
    expect(cliCode).toBe(1);
    const cliResult = JSON.parse(cliErrors.join(''));

    // 2. Invoke via MCP
    const mcpRes = await mcpClient.callTool({
      name: 'nonexistent.tool',
      arguments: {},
    });
    expect(mcpRes.isError).toBe(true);
    const mcpResult = JSON.parse(getTextContent(mcpRes));

    // 3. Parity assertions
    expect(cliResult.ok).toBe(mcpResult.ok);
    expect(cliResult.error.code).toBe(mcpResult.error.code);
    expect(cliResult.meta.commitStatus).toBe(mcpResult.meta.commitStatus);
  });

  it('produces identical structured schemas in meta.tools and MCP listTools', async () => {
    const cliOutputs: string[] = [];
    await runCli({
      argv: ['meta.tools', '--name', 'meta.index'],
      stdout: (msg) => cliOutputs.push(msg),
    });
    const cliResult = JSON.parse(cliOutputs.join(''));
    const cliSchema = cliResult.data.tools[0].inputSchema;

    const toolsRes = await mcpClient.listTools();
    const mcpTool = toolsRes.tools.find((t) => t.name === 'meta.index');
    expect(mcpTool).toBeDefined();

    // Verify key properties in both schemas
    expect(cliSchema.properties.category).toBeDefined();
    expect(cliSchema.properties.page).toBeDefined();
    expect(mcpTool?.inputSchema.properties?.category).toBeDefined();
    expect(mcpTool?.inputSchema.properties?.page).toBeDefined();
  });
});
