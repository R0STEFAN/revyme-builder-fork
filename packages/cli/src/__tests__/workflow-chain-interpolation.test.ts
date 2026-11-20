import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, stripJsonSchemaMeta } from '../mcp';
import { AutomationClient, resolveChainStepInput } from '../client';

function findDollarSchemaKeys(node: unknown, prefix = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(node)) {
    node.forEach((item, idx) => hits.push(...findDollarSchemaKeys(item, `${prefix}[${idx}]`)));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const nextPath = prefix ? `${prefix}.${k}` : k;
      if (k === '$schema') hits.push(nextPath);
      hits.push(...findDollarSchemaKeys(v, nextPath));
    }
  }
  return hits;
}

describe('Task 10: strip $schema in ListTools and workflow.chain step ID interpolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits $schema keys from every tool inputSchema returned by ListTools', async () => {
    const clientInstance = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    const server = createMcpServer({
      client: clientInstance,
      config: {
        projectId: 'test-proj',
        branchId: 'main',
        apiUrl: 'http://localhost:3000',
        projectDir: process.cwd(),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    try {
      const allTools: Array<{ name: string; inputSchema: unknown }> = [];
      let cursor: string | undefined;
      do {
        const res = await mcpClient.listTools(cursor ? { cursor } : undefined);
        allTools.push(...res.tools);
        cursor = res.nextCursor;
      } while (cursor);

      expect(allTools.length).toBeGreaterThan(0);
      for (const tool of allTools) {
        expect(
          findDollarSchemaKeys(tool.inputSchema, tool.name),
          `Found $schema in ${tool.name}`
        ).toEqual([]);
      }
      expect(typeof stripJsonSchemaMeta).toBe('function');
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });

  it('resolves $prev and $steps[N] dot/bracket paths and embedded template tokens recursively', () => {
    const receipts = [
      {
        result: {
          ok: true,
          operationResult: {
            rootId: 'hero-42',
            insertedIds: ['hero-42', 'cta-9'],
            meta: { count: 2 },
          },
          meta: { commitStatus: 'committed' as const, revision: 1 },
        },
      },
      {
        result: {
          ok: true,
          data: {
            nodeId: 'btn-7',
          },
          meta: { commitStatus: 'committed' as const, revision: 2 },
        },
      },
    ] as any;

    const resolved = resolveChainStepInput(
      {
        nodeId: '$prev.nodeId',
        firstRoot: '$steps[0].rootId',
        secondChild: '$steps[0].insertedIds[1]',
        countVal: '$steps[0].meta.count',
        selector: '[data-id="$steps[0].rootId"]:hover',
        nested: [{ id: '$prev.nodeId' }],
      },
      receipts
    );

    expect(resolved).toEqual({
      nodeId: 'btn-7',
      firstRoot: 'hero-42',
      secondChild: 'cta-9',
      countVal: 2,
      selector: '[data-id="hero-42"]:hover',
      nested: [{ id: 'btn-7' }],
    });
  });

  it('interpolates $prev.rootId across live workflow.chain steps inside AutomationClient.execute', async () => {
    const autoClient = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    const scope = { projectId: 'test-proj', branchId: 'main' };
    const seenInputs: Array<{ tool: string; input: Record<string, unknown> }> = [];

    const origExecute = autoClient.execute.bind(autoClient);
    vi.spyOn(autoClient, 'execute').mockImplementation(async (s, tool, inp, opts) => {
      if (tool === 'workflow.chain') {
        return origExecute(s, tool, inp, opts);
      }
      const typedInput = (inp ?? {}) as Record<string, unknown>;
      seenInputs.push({ tool, input: typedInput });
      if (tool === 'fragments.insert') {
        return {
          ok: true,
          data: { operationId: 'op-1', projectId: s.projectId, branchId: 'main', revision: 2 },
          operationResult: { rootId: 'hero-99', insertedIds: ['hero-99'] },
          meta: { commitStatus: 'committed', revision: 2 },
        } as any;
      }
      return {
        ok: true,
        data: { operationId: 'op-2', projectId: s.projectId, branchId: 'main', revision: 3 },
        operationResult: { nodeId: typedInput.nodeId },
        meta: { commitStatus: 'committed', revision: 3 },
      } as any;
    });

    const chainRes = await autoClient.execute(
      scope,
      'workflow.chain',
      {
        steps: [
          {
            tool: 'fragments.insert',
            input: { parentId: 'root', fragment: '<div>Hero</div>' },
          },
          {
            tool: 'styles.set',
            input: { nodeId: '$prev.rootId', pseudo: ':hover', styles: { opacity: '0.8' } },
          },
        ],
      }
    );

    expect(chainRes.ok).toBe(true);
    expect(seenInputs[1]).toEqual({
      tool: 'styles.set',
      input: { nodeId: 'hero-99', pseudo: ':hover', styles: { opacity: '0.8' } },
    });
  });
});
