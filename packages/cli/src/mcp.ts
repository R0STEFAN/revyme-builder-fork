// packages/cli/src/mcp.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire as createNodeRequire } from 'node:module';
import { z } from 'zod';
import { defaultRegistry, createIdFactory } from '@revyme/automation-core';
import type { OperationContext, Scope } from '@revyme/automation-core';
import type { AutomationClient } from './client';
import type { ProjectConfig } from './config';

const DEFAULT_MCP_BRIDGE_URL = 'http://127.0.0.1:8082';
const DEFAULT_PREVIEW_URL = 'http://localhost:5175';
const DEFAULT_BUILDER_URL = 'http://localhost:3333';

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'item';
}

async function probeReachableUrl(candidateUrls: string[]): Promise<string | null> {
  for (const candidate of candidateUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const res = await fetch(candidate, { method: 'GET', signal: controller.signal });
      if (res.ok) return candidate;
    } catch {
      // Try next candidate URL
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function defaultLaunchPlaywrightBrowser(): Promise<any | null> {
  const localRequire = createNodeRequire(import.meta.url);
  for (const modName of ['playwright', '@playwright/test']) {
    try {
      const pw = localRequire(modName);
      if (pw?.chromium) {
        return await pw.chromium.launch({ headless: true });
      }
    } catch {
      // Try next Playwright package
    }
  }
  return null;
}

export async function captureHeadlessScreenshot({
  projectId,
  viewport,
  nodeId,
  format,
  pixelRatio,
  launchBrowser,
}: {
  projectId?: string;
  viewport?: string;
  nodeId?: string;
  format?: 'png' | 'jpeg';
  pixelRatio?: number;
  backgroundColor?: string;
  launchBrowser?: () => Promise<any>;
}): Promise<any> {
  const startTime = Date.now();
  if (!projectId) {
    return {
      available: false,
      status: 'unavailable',
      reason: 'HEADLESS_CAPTURE_FAILED',
      note: 'Project ID is required for headless screenshot capture.',
      waitedMs: 0,
    };
  }

  const vpName = viewport || 'desktop';
  const vpConfig: { width: number; height: number; prefix: string } = {
    mobile: { width: 390, height: 844, prefix: 'mobile-' },
    tablet: { width: 810, height: 1080, prefix: 'tablet-' },
    desktop: { width: 1200, height: 900, prefix: '' },
  }[vpName] || { width: 1200, height: 900, prefix: '' };

  const previewBase = (process.env.REVYME_PREVIEW_URL || DEFAULT_PREVIEW_URL).replace(/\/+$/, '');
  const builderBase = (process.env.REVYME_BUILDER_URL || DEFAULT_BUILDER_URL).replace(/\/+$/, '');
  const encodedId = encodeURIComponent(projectId);
  const targetUrl = await probeReachableUrl([
    `${previewBase}/preview/${encodedId}`,
    `${builderBase}/builder/${encodedId}`,
  ]);

  if (!targetUrl) {
    return {
      available: false,
      status: 'unavailable',
      reason: 'HEADLESS_CAPTURE_FAILED',
      note: 'No reachable preview or builder server found for headless capture.',
      waitedMs: Date.now() - startTime,
    };
  }

  let browser: any;
  try {
    browser = launchBrowser ? await launchBrowser() : await defaultLaunchPlaywrightBrowser();
    if (!browser) {
      return {
        available: false,
        status: 'unavailable',
        reason: 'HEADLESS_CAPTURE_FAILED',
        note: 'Playwright browser runtime is unavailable for headless capture.',
        waitedMs: Date.now() - startTime,
      };
    }

    const page = await browser.newPage({
      viewport: { width: vpConfig.width, height: vpConfig.height },
      deviceScaleFactor: pixelRatio || 1,
    });
    if (typeof page.setViewportSize === 'function') {
      await page.setViewportSize({ width: vpConfig.width, height: vpConfig.height });
    }

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15_000 });
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
    if (typeof page.waitForFunction === 'function') {
      await page
        .waitForFunction(
          () => Array.from(document.querySelectorAll('img')).every((img: HTMLImageElement) => img.complete),
          { timeout: 4_000 }
        )
        .catch(() => {});
    }

    const targetNode = nodeId || 'root';
    const imgType = format === 'jpeg' ? 'jpeg' : 'png';
    const ext = imgType === 'jpeg' ? 'jpg' : 'png';
    const mime = imgType === 'jpeg' ? 'image/jpeg' : 'image/png';

    const rawShot =
      targetNode === 'root'
        ? await page.screenshot({ type: imgType, fullPage: true })
        : await page.locator(`[data-id="${targetNode}"]`).first().screenshot({ type: imgType });

    const buffer = Buffer.isBuffer(rawShot) ? rawShot : Buffer.from(rawShot);
    const screenshotDir = path.join(os.tmpdir(), 'revyme-screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const outPath = path.join(
      screenshotDir,
      `${sanitizeFileSegment(projectId)}-${sanitizeFileSegment(vpName)}-${sanitizeFileSegment(targetNode)}.${ext}`
    );
    fs.writeFileSync(outPath, buffer);

    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    return {
      available: true,
      status: 'ready',
      filePath: outPath,
      dataUrl,
      bytes: buffer.length,
      width: vpConfig.width,
      height: vpConfig.height,
      dimensions: { width: vpConfig.width, height: vpConfig.height },
      waitedMs: Date.now() - startTime,
      source: 'headless-chromium',
      note: 'Captured autonomously via headless Chromium engine',
    };
  } catch (err: any) {
    return {
      available: false,
      status: 'unavailable',
      reason: 'HEADLESS_CAPTURE_FAILED',
      note: err?.message || 'Headless capture failed',
      waitedMs: Date.now() - startTime,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export function createBridgeScreenshotService(
  customUrl?: string,
  deps?: { launchBrowser?: () => Promise<any> }
) {
  const bridgeUrl = (
    customUrl ||
    process.env.REVYME_MCP_BRIDGE_URL ||
    process.env.VITE_AI_SERVICE_URL ||
    DEFAULT_MCP_BRIDGE_URL
  ).replace(/\/+$/, '');

  return {
    async captureScreenshot({ snapshot, revision, filePath: requestedFilePath, viewport, nodeId, format, pixelRatio, backgroundColor, headless }: any) {
      const clientPage = [...snapshot.files.keys()].find((filePathKey: string) =>
        filePathKey.endsWith('/page.client.tsx') || filePathKey === 'page.client.tsx' || filePathKey.endsWith('page.client.tsx')
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
          launchBrowser: deps?.launchBrowser,
        });
        if (headlessResult?.available) {
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
            const headlessFallback = await captureHeadlessScreenshot({
              projectId: snapshot.scope.projectId,
              viewport,
              nodeId,
              format,
              pixelRatio,
              backgroundColor,
              launchBrowser: deps?.launchBrowser,
            });
            if (headlessFallback?.available) {
              return headlessFallback;
            }
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
        const errCode = err?.code || err?.cause?.code;
        if (
          err?.name === 'AbortError' ||
          err?.message?.includes('aborted') ||
          errCode === 'ECONNREFUSED' ||
          err?.message?.includes('ECONNREFUSED')
        ) {
          const headlessFallback = await captureHeadlessScreenshot({
            projectId: snapshot.scope.projectId,
            viewport,
            nodeId,
            format,
            pixelRatio,
            backgroundColor,
            launchBrowser: deps?.launchBrowser,
          });

          if (headlessFallback?.available) {
            return headlessFallback;
          }
          return headlessFallback || {
            available: false,
            status: 'unavailable',
            reason: 'HEADLESS_CAPTURE_FAILED',
            note: err?.message || 'Headless capture failed',
            waitedMs: 0,
          };
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

export function stripJsonSchemaMeta<T = unknown>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripJsonSchemaMeta(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '$schema') continue;
      out[k] = stripJsonSchemaMeta(v);
    }
    return out as T;
  }
  return value;
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
        const jsonSchema = stripJsonSchemaMeta(z.toJSONSchema(op.inputSchema)) as Record<string, unknown>;
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
        inputSchema: stripJsonSchemaMeta({
          ...schemaObj,
          properties,
        }) as Record<string, unknown>,
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

    return formatMcpToolResult(toolName, result);
  });

  return server;
}

function extractImageBlocksFromEntry(entry: any, seenData: Set<string>): Array<{ type: 'image'; mimeType: string; data: string }> {
  const dataUrl = entry?.dataUrl;
  if (typeof dataUrl !== 'string') return [];
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return [];
  const mimeType = match[1];
  const data = match[2];
  if (seenData.has(data)) return [];
  seenData.add(data);
  return [{ type: 'image', mimeType, data }];
}

function sanitizeScreenshotEntry(entry: any): any {
  if (!entry || typeof entry !== 'object') return entry;
  const shouldStrip = Boolean(entry.filePath) || (typeof entry.dataUrl === 'string' && entry.dataUrl.length > 512);
  if (!shouldStrip) return entry;
  const { dataUrl: _omitted, ...rest } = entry;
  return rest;
}

export function formatMcpToolResult(toolName: string, result: any): {
  isError: boolean;
  content: Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }>;
} {
  if (toolName === 'observe.screenshot' && result?.ok && result?.data) {
    const seenData = new Set<string>();
    const imageBlocks: Array<{ type: 'image'; mimeType: string; data: string }> = [];
    const data = result.data;

    if (data.primary) imageBlocks.push(...extractImageBlocksFromEntry(data.primary, seenData));
    if (Array.isArray(data.captures)) {
      for (const item of data.captures) imageBlocks.push(...extractImageBlocksFromEntry(item, seenData));
    }
    if (Array.isArray(data.results)) {
      for (const item of data.results) imageBlocks.push(...extractImageBlocksFromEntry(item, seenData));
    }

    const sanitizedResult = {
      ...result,
      data: {
        ...data,
        ...(data.primary ? { primary: sanitizeScreenshotEntry(data.primary) } : {}),
        ...(Array.isArray(data.captures) ? { captures: data.captures.map(sanitizeScreenshotEntry) } : {}),
        ...(Array.isArray(data.results) ? { results: data.results.map(sanitizeScreenshotEntry) } : {}),
      },
    };

    return {
      isError: !result.ok,
      content: [
        { type: 'text', text: JSON.stringify(sanitizedResult, null, 2) },
        ...imageBlocks,
      ],
    };
  }

  return {
    isError: !result?.ok,
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function startStdioServer(options: McpServerOptions): Promise<Server> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
