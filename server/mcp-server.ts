import { mcpBridge } from './mcp-bridge';

const PORT = process.env.REVYME_MCP_PORT ? parseInt(process.env.REVYME_MCP_PORT, 10) : 8082;

// Start standalone HTTP bridge server (if not already running)
mcpBridge.startHttpServer(PORT);

// Connect MCP Stdio Transport for CLI / IDE agents
async function main() {
  await mcpBridge.startStdio();
}

main().catch((err) => {
  console.error('[Revyme Bridge] Fatal error:', err);
  process.exit(1);
});
