// packages/cli/src/mcp.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { defaultRegistry, createIdFactory } from '@revyme/automation-core';
import type { OperationContext, Scope } from '@revyme/automation-core';
import type { AutomationClient } from './client';
import type { ProjectConfig } from './config';

const DEFAULT_MCP_BRIDGE_URL = 'http://127.0.0.1:8082';

function createBridgeScreenshotService() {
  const bridgeUrl = (
    process.env.REVYME_MCP_BRIDGE_URL ||
    process.env.VITE_AI_SERVICE_URL ||
    DEFAULT_MCP_BRIDGE_URL
  ).replace(/\/+$/, '');

  return {
    async captureScreenshot({ snapshot, revision, viewport, nodeId, format, pixelRatio, backgroundColor }: any) {
      const filePath = snapshot.scope.filePath || [...snapshot.files.keys()].find((path: string) =>
        path.endsWith('/page.client.tsx') || path === 'page.client.tsx'
      );
      if (!filePath) {
        return {
          available: false,
          status: 'unavailable',
          reason: 'TARGET_FILE_NOT_FOUND',
          note: 'No canvas page is included in the automation snapshot.',
          waitedMs: 0,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetch(`${bridgeUrl}/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'captureScreenshot',
            params: {
              projectId: snapshot.scope.projectId,
              branchId: snapshot.scope.branchId || 'main',
              filePath,
              revision,
              viewport,
              nodeId,
              format,
              pixelRatio,
              backgroundColor,
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          if (payload?.error?.startsWith('No editor tab connected')) {
            return {
              available: false,
              status: 'unavailable',
              reason: 'EDITOR_NOT_CONNECTED',
              note: payload.error,
              waitedMs: 0,
            };
          }
          throw new Error(`Screenshot bridge returned HTTP ${response.status}`);
        }
        const payload = await response.json() as { ok?: boolean; result?: unknown; error?: string };
        if (!payload.ok) throw new Error(payload.error || 'Screenshot bridge returned an empty response');
        return payload.result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function createBridgeAuditSnapshotService() {
  const bridgeUrl = (
    process.env.REVYME_MCP_BRIDGE_URL ||
    process.env.VITE_AI_SERVICE_URL ||
    DEFAULT_MCP_BRIDGE_URL
  ).replace(/\/+$/, '');

  return {
    async getSnapshot({ projectId, branchId, filePath, revision, viewport }: {
      projectId: string;
      branchId: string;
      filePath: string;
      revision: number;
      viewport: string;
    }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`${bridgeUrl}/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'observeAuditSnapshot',
            params: { projectId, branchId, filePath, revision, viewport },
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Audit snapshot bridge returned HTTP ${response.status}`);
        const payload = await response.json() as { ok?: boolean; result?: unknown; error?: string };
        if (!payload.ok) throw new Error(payload.error || 'Audit snapshot bridge returned an empty response');
        return payload.result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface McpServerOptions {
  client: AutomationClient;
  config?: ProjectConfig;
  name?: string;
  version?: string;
}

export function createMcpServer(options: McpServerOptions): Server {
  const { client, config } = options;
  const server = new Server(
    {
      name: options.name || 'revyme-automation',
      version: options.version || '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ListTools handler with cursor-based pagination
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const allOps = defaultRegistry.list();
    const cursorStr = request.params?.cursor;
    const startIndex = cursorStr ? parseInt(cursorStr, 10) : 0;
    const pageSize = 50;
    const pageOps = allOps.slice(startIndex, startIndex + pageSize);

    const tools = pageOps.map((op) => {
      let schemaObj: Record<string, unknown> = { type: 'object', properties: {} };
      try {
        const jsonSchema = z.toJSONSchema(op.inputSchema) as Record<string, unknown>;
        if (jsonSchema && jsonSchema.type === 'object') {
          schemaObj = jsonSchema;
        } else {
          schemaObj = {
            type: 'object',
            properties: {
              input: jsonSchema || {},
            },
          };
        }
      } catch {
        schemaObj = { type: 'object', properties: {} };
      }

      // Add optional projectId, branchId, and dryRun parameters to schema if not present
      const properties = { ...((schemaObj.properties as Record<string, unknown>) || {}) };
      if (!properties.projectId) {
        properties.projectId = {
          type: 'string',
          description: 'Project ID override (falls back to local configuration or REVYME_PROJECT_ID)',
        };
      }
      if (!properties.branchId) {
        properties.branchId = {
          type: 'string',
          description: 'Branch ID override (defaults to "main")',
        };
      }
      if (!properties.dryRun && op.kind === 'mutation') {
        properties.dryRun = {
          type: 'boolean',
          description: 'If true, generates and validates the plan without committing to storage',
        };
      }

      return {
        name: op.name,
        description: `[${op.name}] ${op.description} [Category: ${op.category}, Kind: ${op.kind}, Task: ${op.ownerTask}]`,
        inputSchema: {
          ...schemaObj,
          properties,
        },
      };
    });

    const nextIndex = startIndex + pageSize;
    const nextCursor = nextIndex < allOps.length ? String(nextIndex) : undefined;

    return {
      tools,
      nextCursor,
    };
  });

  // CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const rawArgs = (request.params.arguments || {}) as Record<string, unknown>;

    const op = defaultRegistry.get(toolName);
    if (!op) {
      const suggestions = defaultRegistry.findNearMatches(toolName);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: false,
                error: {
                  code: 'UNKNOWN_OPERATION',
                  message: `Tool "${toolName}" is not registered. Did you mean: ${suggestions.join(', ')}?`,
                  issues: [{ code: 'UNKNOWN_OPERATION', path: [], message: `Unknown tool "${toolName}"` }],
                },
                meta: {
                  commitStatus: 'not_committed',
                  revision: 0,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const projectId =
      (typeof rawArgs.projectId === 'string' && rawArgs.projectId) ||
      config?.projectId ||
      process.env.REVYME_PROJECT_ID;

    const branchId =
      (typeof rawArgs.branchId === 'string' && rawArgs.branchId) ||
      config?.branchId ||
      process.env.REVYME_BRANCH_ID ||
      'main';

    if (op.category !== 'meta' && !projectId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: false,
                error: {
                  code: 'MISSING_PROJECT_ID',
                  message: `projectId is required to execute "${toolName}". Provide it as an argument, in .revymelocal/automation.json, or via REVYME_PROJECT_ID.`,
                  issues: [{ code: 'MISSING_PROJECT_ID', path: ['projectId'], message: 'Missing project ID' }],
                },
                meta: {
                  commitStatus: 'not_committed',
                  revision: 0,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Scope participates in the plan hash. Document-oriented operations use
    // several schema names; retain the target path before preparing a plan so
    // the client and commit service hash the same scope.
    const scopeFilePath =
      (typeof rawArgs.filePath === 'string' && rawArgs.filePath) ||
      (typeof rawArgs.targetFile === 'string' && rawArgs.targetFile) ||
      (typeof rawArgs.componentFile === 'string' && rawArgs.componentFile) ||
      (typeof rawArgs.sourceFile === 'string' && rawArgs.sourceFile) ||
      undefined;
    const scope: Scope = {
      projectId: projectId || 'meta-project',
      branchId,
      ...(scopeFilePath ? { filePath: scopeFilePath } : {}),
    };

    const dryRun = Boolean(rawArgs.dryRun);

    // Strip tool wrapper fields from operation input if not part of its schema
    const opInput = { ...rawArgs };
    if (!('projectId' in (op.inputSchema as any))) delete opInput.projectId;
    if (!('branchId' in (op.inputSchema as any))) delete opInput.branchId;
    if (!('dryRun' in (op.inputSchema as any))) delete opInput.dryRun;

    // Progress reporting helper
    const progressToken = (extra as any)?._meta?.progressToken;
    const trace = (event: string, data: Record<string, unknown>) => {
      if (progressToken && typeof server.notification === 'function') {
        server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: 50,
            total: 100,
            message: `${event}: ${JSON.stringify(data)}`,
          },
        }).catch(() => {});
      }
    };

    const context: OperationContext = {
      createId: createIdFactory('mcp'),
      signal: extra.signal || new AbortController().signal,
      trace,
      adapters: {
        screenshotService: createBridgeScreenshotService(),
        auditSnapshotService: createBridgeAuditSnapshotService(),
      },
    };

    const result = await client.execute(scope, toolName, opInput, {
      dryRun,
      context,
    });

    return {
      isError: !result.ok,
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  return server;
}

export async function startStdioServer(options: McpServerOptions): Promise<Server> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
