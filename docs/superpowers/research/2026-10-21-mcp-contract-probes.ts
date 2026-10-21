// Isolated audit probes. No editor, network connection or project write is used.
// Run: ./node_modules/.bin/tsx docs/superpowers/research/2026-10-21-mcp-contract-probes.ts
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpBridge } from '../../../server/mcp-bridge';

async function main() {
  const bridge = new McpBridge();
  const server = bridge.createMcpServer();
  const client = new Client({ name: 'isolated-audit', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    bridge.sendToEditor = async () => ({
      isError: true,
      content: [{ type: 'text', text: 'Node does not exist' }],
    });
    const nested = await client.callTool({
      name: 'revyme_agent_tool', arguments: { name: 'set_styles', input: {} },
    });
    assert.notEqual(nested.isError, true);
    const nestedText = (nested.content as Array<{ text: string }>)[0].text;
    assert.equal(JSON.parse(nestedText).isError, true);
    console.log('CONFIRMED: editor isError=true arrives as an MCP result without isError=true');

    bridge.sendToEditor = async () => ({ committed: false, violations: [{ code: 'STALE_FILE' }] });
    const rejected = await client.callTool({
      name: 'revyme_submit_files',
      arguments: { files: [{ path: 'components/AuditProbe.tsx', code: '' }] },
    });
    assert.notEqual(rejected.isError, true);
    assert.equal(JSON.parse((rejected.content as Array<{ text: string }>)[0].text).committed, false);
    console.log('CONFIRMED: rejected submitFiles arrives without an MCP error flag');

    bridge.sendToEditor = async () => { throw new Error('Simulated unavailable measurement'); };
    const screenshot = await client.callTool({ name: 'revyme_capture_screenshot', arguments: {} });
    const screenshotData = JSON.parse((screenshot.content as Array<{ text: string }>)[0].text);
    assert.equal(screenshotData.status, 'unavailable');
    assert.equal(screenshotData.layout.horizontalOverflow, false);
    assert.equal(screenshotData.layout.note, 'Layout fits cleanly within viewport width.');
    console.log('CONFIRMED: unavailable screenshot + failed audit still reports a clean layout');

    const catalog = await client.listTools();
    const fragment = catalog.tools.find((tool) => tool.name === 'revyme_insert_fragment');
    assert.ok(fragment);
    const properties = fragment.inputSchema.properties as Record<string, any>;
    assert.deepEqual(properties.fragment.properties.children.items, { type: 'object' });
    console.log(`CONFIRMED: ${catalog.tools.length} public tools; nested fragment items lack property schemas`);
  } finally {
    await client.close();
    await server.close();
  }

  const routingBridge = new McpBridge({ requestTimeoutMs: 1000 });
  const connections = ['project-a', 'project-b'].map((websiteId) => {
    const req = new EventEmitter() as any;
    req.headers = {};
    req.url = `/bridge/events?websiteId=${websiteId}`;
    const messages: string[] = [];
    const res = { setHeader() {}, writeHead() {}, write(value: string) { messages.push(value); } };
    routingBridge.handleEventsStream(req, res);
    return { req, messages };
  });
  try {
    const result = routingBridge.sendToEditor('agent.tool', { name: 'insert_fragment', input: {} });
    const dispatched = connections.map(({ messages }) => messages.filter((message) => message.startsWith('data: ')));
    assert.equal(dispatched[0].length, 1);
    assert.equal(dispatched[1].length, 1);
    assert.equal(dispatched[0][0], dispatched[1][0]);
    const requestId = JSON.parse(dispatched[0][0].slice(6).trim()).id;
    routingBridge.handleResult(JSON.stringify({ id: requestId, result: 'first reply' }), {
      setHeader() {}, end() {}, statusCode: 0,
    });
    assert.equal(await result, 'first reply');
    console.log('CONFIRMED: one mutation request is broadcast identically to two different websiteId tabs');
  } finally {
    for (const connection of connections) connection.req.emit('close');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
