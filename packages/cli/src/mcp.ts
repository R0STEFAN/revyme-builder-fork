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

async function captureHeadlessScreenshot({
  projectId,
  viewport,
  nodeId,
  format,
  pixelRatio,
  backgroundColor,
}: {
  projectId?: string;
  viewport?: string;
  nodeId?: string;
  format?: 'png' | 'jpeg';
  pixelRatio?: number;
  backgroundColor?: string;
}): Promise<any> {
  if (!projectId) return null;
  const startTime = Date.now();
  let chromium: any;
  try {
    const pw = require('playwright');
    chromium = pw.chromium;
  } catch {
    try {
      const pw = require('@playwright/test');
      chromium = pw.chromium;
    } catch {
      return null;
    }
  }

  if (!chromium) return null;

  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
    const vpConfig: { width: number; height: number; prefix: string } = {
      mobile: { width: 390, height: 844, prefix: 'mobile-' },
      tablet: { width: 810, height: 1080, prefix: 'tablet-' },
      desktop: { width: 1440, height: 900, prefix: '' },
    }[viewport || 'desktop'] || { width: 1440, height: 900, prefix: '' };

    const page = await browser.newPage({
      viewport: { width: vpConfig.width, height: vpConfig.height },
      deviceScaleFactor: pixelRatio || 1,
    });

    const builderBase = (process.env.REVYME_BUILDER_URL || 'http://localhost:3333').replace(/\/+$/, '');
    const targetUrl = `${builderBase}/builder/${projectId}`;

    await page.goto(targetUrl, { waitUntil: 'load', timeout: 15_000 });
    await page.waitForFunction(() => !!(window as any).__canvasBridge, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const targetNode = nodeId || 'root';
    const targetPrefix = vpConfig.prefix;

    const dataUrl = await page.evaluate(async (opts: any) => {
      const bridge = (window as any).__canvasBridge;
      if (bridge && typeof bridge.captureElement === 'function') {
        return await bridge.captureElement(opts.targetNode, opts.targetPrefix, {
          format: opts.format || 'png',
          pixelRatio: opts.pixelRatio || 1,
          backgroundColor: opts.backgroundColor,
        });
      }
      return null;
    }, { targetNode, targetPrefix, format, pixelRatio, backgroundColor });

    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      const base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      return {
        available: true,
        status: 'ready',
        dataUrl,
        bytes: buffer.length,
        width: vpConfig.width,
        height: vpConfig.height,
        dimensions: { width: vpConfig.width, height: vpConfig.height },
        waitedMs: Date.now() - startTime,
        source: 'headless-chromium',
        note: 'Captured autonomously via headless Chromium engine',
      };
    }

    return null;
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export function createBridgeScreenshotService(customUrl?: string) {
  const bridgeUrl = (
    customUrl ||
    process.env.REVYME_MCP_BRIDGE_URL ||
    process.env.VITE_AI_SERVICE_URL ||
    DEFAULT_MCP_BRIDGE_URL
  ).replace(/\/+$/, '');

  return {
    async captureScreenshot({ snapshot, revision, filePath: requestedFilePath, viewport, nodeId, format, pixelRatio, backgroundColor, headless }: any) {
      const clientPage = [...snapshot.files.keys()].find((path: string) =>
        path.endsWith('/page.client.tsx') || path === 'page.client.tsx' || path.endsWith('page.client.tsx')
      );
      const filePath = requestedFilePath || clientPage || snapshot.scope.filePath;
      if (!filePath) {
        return {
          available: false,
          status: 'unavailable',
          reason: 'TARGET_FILE_NOT_FOUND',
          note: 'No canvas page is included in the automation snapshot.',
          waitedMs: 0,
        };
      }

      const preferHeadless = process.env.REVYME_HEADLESS_SCREENSHOT === '1' ||
                             process.env.REVYME_HEADLESS_SCREENSHOT === 'true' ||
                             Boolean(headless);

      if (preferHeadless) {
        const headlessResult = await captureHeadlessScreenshot({
          projectId: snapshot.scope.projectId,
          viewport,
          nodeId,
          format,
          pixelRatio,
          backgroundColor,
        });
        if (headlessResult && headlessResult.available) {
          return headlessResult;
        }
      }

      const controller = new AbortController();
      // Bounded 5s timer: don't hang for 45s if browser tab is suspended in background
      const timer = setTimeout(() => controller.abort(), 5_000);
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
              revision: revision ?? snapshot.revision,
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
        const payload = await response.json() as { ok?: boolean; result?: any; error?: string };
        if (!payload.ok) throw new Error(payload.error || 'Screenshot bridge returned an empty response');
        return payload.result;
      } catch (err: any) {
        // If aborted (timed out because browser tab was throttled in background), attempt headless capture!
        if (err?.name === 'AbortError' || err?.message?.includes('aborted') || err?.code === 'ECONNREFUSED') {
          const headlessFallback = await captureHeadlessScreenshot({
            projectId: snapshot.scope.projectId,
            viewport,
            nodeId,
            format,
            pixelRatio,
            backgroundColor,
          });

          if (headlessFallback && headlessFallback.available) {
            return headlessFallback;
          }
        }
        throw err;
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
    async getSnapshot({ projectId, branchId, filePath, revision, viewport, properties, nodeIds }: {
      projectId: string;
      branchId: string;
      filePath: string;
      revision: number;
      viewport: string;
      properties?: string[];
      nodeIds?: string[];
    }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`${bridgeUrl}/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'observeAuditSnapshot',
            params: {
              projectId,
              branchId,
              filePath,
              revision,
              viewport,
              ...(properties ? { properties } : {}),
              ...(nodeIds ? { nodeIds } : {}),
            },
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
