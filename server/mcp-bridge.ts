import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: NodeJS.Timeout;
}

export interface McpBridgeOptions {
  port?: number;
  requestTimeoutMs?: number;
}

export class McpBridge {
  private sseClients = new Set<http.ServerResponse>();
  private pendingRequests = new Map<string | number, PendingRequest>();
  private reqSeq = 0;
  private httpServer: http.Server | null = null;
  private mcpServer: Server | null = null;
  private port: number;
  private requestTimeoutMs: number;

  constructor(options?: McpBridgeOptions) {
    this.port = options?.port ?? 8082;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 45000;
  }

  public getActiveClientCount(): number {
    return this.sseClients.size;
  }

  public getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Dispatch an RPC method to the connected browser editor via SSE
   */
  public async sendToEditor(method: string, params: any = {}, timeoutMs?: number): Promise<any> {
    if (this.sseClients.size === 0) {
      // If this process has no direct SSE clients connected (e.g. running as stdio MCP server),
      // try forwarding the RPC request to the running bridge HTTP endpoint.
      const endpoints = Array.from(new Set([
        `http://localhost:${this.port}/rpc`,
        `http://localhost:3333/rpc`,
      ]));

      for (const endpoint of endpoints) {
        try {
          const timeout = timeoutMs ?? this.requestTimeoutMs;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const data: any = await res.json();
            if (data.ok) return data.result;
            if (data.error) throw new Error(data.error);
          }
        } catch (fetchErr: any) {
          if (fetchErr.name === 'AbortError') {
            throw new Error(`Timed out waiting for response from Revyme editor (method: ${method})`);
          }
          if (fetchErr.message && !fetchErr.message.includes('fetch failed') && !fetchErr.message.includes('ECONNREFUSED')) {
            throw fetchErr;
          }
        }
      }

      throw new Error(
        'Revyme editor is not connected. Open http://localhost:3333 in your browser.'
      );
    }

    const id = ++this.reqSeq;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const ms = timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for response from Revyme editor (method: ${method})`));
      }, ms);

      this.pendingRequests.set(id, { resolve, reject, timer });

      for (const client of this.sseClients) {
        try {
          client.write(`data: ${payload}\n\n`);
        } catch {
          // Ignore closed write errors; client cleanup handles it on 'close'
        }
      }
    });
  }

  /**
   * SSE connection handler for browser editor
   */
  public handleEventsStream(req: any, res: any): void {
    const origin = req.headers?.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(': ping\n\n');

    this.sseClients.add(res);
    console.error(`[Revyme Bridge] Editor tab connected via SSE. Active tabs: ${this.sseClients.size}`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        // Client gone
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      this.sseClients.delete(res);
      console.error(`[Revyme Bridge] Editor tab disconnected. Remaining: ${this.sseClients.size}`);
    });
  }

  /**
   * Handle result submission from browser editor
   */
  public handleResult(bodyStr: string, res: any): void {
    const origin = '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      const data = JSON.parse(bodyStr || '{}');
      const { id, result, error } = data;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        if (error) {
          pending.reject(new Error(String(error)));
        } else {
          pending.resolve(result);
        }
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /**
   * Direct RPC call handler
   */
  public async handleRpc(bodyStr: string, res: any): Promise<void> {
    const origin = '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      const { method, params } = JSON.parse(bodyStr || '{}');
      if (!method) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Method is required' }));
        return;
      }
      const result = await this.sendToEditor(method, params || {});
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  /**
   * Status handler
   */
  public handleStatus(res: any): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      activeTabs: this.sseClients.size,
      pendingRequests: this.pendingRequests.size,
    }));
  }

  /**
   * Connect middleware for Vite / Express / Connect
   */
  public middleware() {
    return async (req: any, res: any, next: any) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      const method = req.method || 'GET';

      // Set CORS headers for all bridge / API endpoints
      const origin = req.headers?.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

      if (method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }

      // Return empty engines array for AI agent engines check if queried on the bridge
      if (pathname === '/api/agent/engines') {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ engines: [] }));
        return;
      }

      // SSE endpoint for editor: GET /bridge/events
      if (method === 'GET' && pathname === '/bridge/events') {
        this.handleEventsStream(req, res);
        return;
      }

      // Result endpoint: POST /bridge/result
      if (method === 'POST' && pathname === '/bridge/result') {
        let body = '';
        req.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          this.handleResult(body, res);
        });
        return;
      }

      // RPC endpoint: POST /rpc or POST /api/mcp/rpc
      if (method === 'POST' && (pathname === '/rpc' || pathname === '/api/mcp/rpc')) {
        let body = '';
        req.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          await this.handleRpc(body, res);
        });
        return;
      }

      // Status endpoint: GET /api/mcp/status
      if (method === 'GET' && pathname === '/api/mcp/status') {
        this.handleStatus(res);
        return;
      }

      next();
    };
  }

  /**
   * Create configured MCP Server instance
   */
  public createMcpServer(): Server {
    if (this.mcpServer) return this.mcpServer;

    const mcp = new Server(
      {
        name: 'revyme-builder-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'revyme_get_context',
            description:
              'Get the active editor context: current page/component path, JSX code, pages list, components, presets (design tokens) and CMS collections.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'revyme_read_file',
            description: 'Read the code of a specific file in the active Revyme project.',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path, e.g. "app/page.client.tsx" or "components/Card.tsx"' },
              },
              required: ['path'],
            },
          },
          {
            name: 'revyme_list_files',
            description: 'List all files currently in the Revyme virtual project.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'revyme_submit_files',
            description:
              'Write or update files in the Revyme project with full Oracle gate validation. Every write must be valid Next.js React code.',
            inputSchema: {
              type: 'object',
              properties: {
                files: {
                  type: 'array',
                  description: 'Array of files to write',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string', description: 'Path to file' },
                      code: { type: 'string', description: 'Complete source code' },
                      kind: { type: 'string', enum: ['page', 'component'], description: 'Type of file' },
                    },
                    required: ['path', 'code'],
                  },
                },
              },
              required: ['files'],
            },
          },
          {
            name: 'revyme_manage_presets',
            description:
              'Manage design tokens in globals.css (colors, typography, spacing). Action: list, set, remove, set_typography.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['list', 'set', 'remove', 'set_typography'] },
                tokens: {
                  type: 'array',
                  description: 'List of tokens to set for action="set"',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'e.g. "color-accent" or "radius-card"' },
                      value: { type: 'string', description: 'e.g. "#FF4500" or "16px"' },
                      category: { type: 'string', description: 'color, typography, spacing, radius, shadow' },
                    },
                    required: ['name', 'value'],
                  },
                },
                name: { type: 'string', description: 'Preset name for set_typography, e.g. "heading"' },
                values: { type: 'object', description: 'Overrides for typography preset suffixes' },
              },
              required: ['action'],
            },
          },
          {
            name: 'revyme_manage_cms',
            description:
              'Manage CMS collections, fields and data items directly in the project.',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: [
                    'list_collections',
                    'get_collection',
                    'create_collection',
                    'rename_collection',
                    'delete_collection',
                    'add_field',
                    'add_item',
                    'update_item',
                    'remove_item',
                  ],
                },
                collection: { type: 'string', description: 'Collection slug' },
                name: { type: 'string', description: 'Name for create_collection or add_field' },
                field: { type: 'object', description: 'Field configuration for add_field' },
                item: { type: 'object', description: 'Item data for add_item' },
                itemId: { type: 'string', description: 'Item ID for update_item or remove_item' },
              },
              required: ['action'],
            },
          },
          {
            name: 'revyme_agent_tool',
            description:
              'Call any of the 168 fine-grained semantic agent tools of the editor: set_motion, set_styles, add_node, wrap_in_layout, set_smooth_scroll, cms_create_collection, batch, etc.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the tool, e.g. "set_motion", "add_node", "set_styles", "cms_create_collection", "batch"',
                },
                input: {
                  type: 'object',
                  description: 'Arguments object for the tool',
                },
              },
              required: ['name', 'input'],
            },
          },
          {
            name: 'revyme_agent_manifest',
            description: 'Get the full manifest and schema of all 168 internal agent tools supported by the editor.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: any;
        switch (name) {
          case 'revyme_get_context':
            result = await this.sendToEditor('getContext', args);
            break;
          case 'revyme_read_file':
            result = await this.sendToEditor('readFile', args);
            break;
          case 'revyme_list_files':
            result = await this.sendToEditor('listFiles', args);
            break;
          case 'revyme_submit_files':
            result = await this.sendToEditor('submitFiles', args);
            break;
          case 'revyme_manage_presets':
            result = await this.sendToEditor('managePresets', args);
            break;
          case 'revyme_manage_cms':
            result = await this.sendToEditor('manageCms', args);
            break;
          case 'revyme_agent_manifest':
            result = await this.sendToEditor('agent.manifest', {});
            break;
          case 'revyme_agent_tool':
            result = await this.sendToEditor('agent.tool', {
              name: (args as any)?.name,
              input: (args as any)?.input,
            });
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${err.message}`,
            },
          ],
        };
      }
    });

    this.mcpServer = mcp;
    return mcp;
  }

  /**
   * Start standalone HTTP server (e.g. port 8082)
   */
  public startHttpServer(port?: number): http.Server {
    if (this.httpServer) return this.httpServer;

    const listenPort = port ?? this.port;
    const middleware = this.middleware();

    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Revyme Bridge] Port ${listenPort} is already in use. MCP bridge remains available through Vite server middleware.`);
      } else {
        console.error('[Revyme Bridge] HTTP server error:', err);
      }
    });

    server.listen(listenPort, () => {
      console.log(`[Revyme Bridge] Native MCP bridge listening on http://localhost:${listenPort}`);
    });

    this.httpServer = server;
    return server;
  }

  /**
   * Stop standalone HTTP server
   */
  public stopHttpServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close(() => {
        this.httpServer = null;
        resolve();
      });
    });
  }

  /**
   * Start MCP Stdio Transport
   */
  public async startStdio(): Promise<void> {
    const mcp = this.createMcpServer();
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    console.error('[Revyme Bridge] MCP Stdio transport connected.');
  }
}

export const mcpBridge = new McpBridge();
