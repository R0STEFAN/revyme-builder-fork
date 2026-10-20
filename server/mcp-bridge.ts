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
              'Write or update files in the Revyme project with full Oracle gate validation. Every write must be valid Next.js React code. CAUTION: For building UI sections, cards, and page layouts, prefer revyme_insert_fragment which guarantees proper AST insertion, auto-generated data-ids, and native Framer Motion hover support. Use revyme_submit_files ONLY for Code Components (@controls), standalone non-visual logic, or initial empty file scaffolding.',
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
            name: 'revyme_insert_fragment',
            description:
              'PRIMARY UI TOOL: Insert a whole semantic subtree/fragment (nested tree with auto-generated unique data-ids, styles, attributes, text, and Framer Motion hover effects) in a single atomic operation. Use this to construct or append sections, cards, navbars, and layouts into the active page (query parent_id with revyme_get_context). MANDATORY ARCHITECTURE: Every section MUST use the Two-Tier layout: full-bleed <section> (width: 100%, explicit backgroundColor) containing a centered inner <div name="Container"> (maxWidth: 1200px, width: 100%, margin: "0 auto", padding: "0 24px") so all page sections share identical alignment lines! 100% GUI-Parity: hover effects compile to Framer Motion whileHover and spring transitions.',
            inputSchema: {
              type: 'object',
              properties: {
                parent_id: { type: 'string', description: 'data-id of the parent node in the page tree' },
                index: { type: 'number', description: '0-based position among siblings' },
                fragment: {
                  type: 'object',
                  description: 'Tree structure to insert (tag, id, name, styles, attrs, text, hover, children)',
                  properties: {
                    tag: { type: 'string', description: 'HTML tag (div, section, h2, p, button, a)' },
                    id: { type: 'string', description: 'Optional unique kebab-case data-id' },
                    name: { type: 'string', description: 'Display name in layers panel' },
                    styles: { type: 'object', description: 'camelCase CSS styles' },
                    attrs: { type: 'object', description: 'HTML attributes' },
                    responsive: {
                      type: 'object',
                      description: 'Responsive style overrides per viewport (e.g. { tablet: { padding: "24px" }, mobile: { flexDirection: "column" } })',
                    },
                    text: { type: 'string', description: 'Plain text content' },
                    hover: {
                      type: 'object',
                      description: 'Framer Motion whileHover target properties and spring transition',
                    },
                    children: {
                      type: 'array',
                      description: 'Nested children nodes',
                      items: { type: 'object' },
                    },
                  },
                  required: [],
                },
              },
              required: ['parent_id', 'fragment'],
            },
          },
          {
            name: 'revyme_apply_motion_preset',
            description:
              'Apply a calibrated spring animation or interaction preset to an element (lift-on-hover, scale-on-hover, fade-up, fade-in, slide-in-left, slide-in-right, stagger-children). 100% GUI-Parity: hover effects use Framer Motion whileHover and spring physics.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: { type: 'string', description: 'data-id of the target element' },
                preset: {
                  type: 'string',
                  enum: [
                    'lift-on-hover',
                    'scale-on-hover',
                    'fade-up',
                    'fade-in',
                    'slide-in-left',
                    'slide-in-right',
                    'stagger-children',
                  ],
                  description: 'Preset name',
                },
                physics: {
                  type: 'string',
                  enum: ['snappy', 'gentle', 'bouncy', 'slow'],
                  description: 'Calibrated spring physics curve (snappy, gentle, bouncy, slow)',
                },
                stagger: {
                  type: 'number',
                  description: 'Stagger delay step in seconds for stagger-children (default 0.08)',
                },
                targets: {
                  type: 'object',
                  description: 'Optional overrides for whileHover targets',
                },
              },
              required: ['node_id', 'preset'],
            },
          },
          {
            name: 'revyme_manage_component_variant',
            description:
              'Create and manage Design Component variants and interactive states (hover/pressed) with 100% GUI-Parity. Actions: "add_interaction" (creates hover/pressed variant with auto-wired mouseEnter/mouseLeave connections and styles), "create" (creates new custom variant), "set_styles" (updates styles on an existing variant), "list" (lists all variants).',
            inputSchema: {
              type: 'object',
              properties: {
                component: { type: 'string', description: 'PascalCase component name, e.g. "Button" or "Card"' },
                action: {
                  type: 'string',
                  enum: ['add_interaction', 'create', 'set_styles', 'list'],
                  description: 'Action to perform',
                },
                variant: { type: 'string', description: 'Variant name (for create or set_styles)' },
                interaction: {
                  type: 'string',
                  enum: ['hover', 'pressed'],
                  description: 'Interaction type for add_interaction ("hover" or "pressed", default "hover")',
                },
                parent_variant: { type: 'string', description: 'Source variant name to cascade from (default "default")' },
                styles: { type: 'object', description: 'Optional camelCase CSS styles to apply to the variant' },
                element: { type: 'string', description: 'data-id of element inside component to style (default: component root)' },
              },
              required: ['component', 'action'],
            },
          },
          {
            name: 'revyme_list_built_in_components',
            description:
              'Browse Revyme\'s rich built-in code component library (~80 production-ready components): animated marquees (Marquee, Marquee3D, RibbonMarquee), carousels (Carousel, EmblaCarousel, HorizontalScroll), cursor hotspots (BlobCursor, DesignCursor, SplashCursor), text effects (WordRotate, MorphingText, TextPressure, AnimatedCounter), GPU shaders & backgrounds (AuroraBackground, MeshGradient, CausticsLight, GrainGradient, LiquidMetal, LiquidChrome, GemSmoke, Metaballs, SmokeRing, CyberGrid, MatrixRain), and embeds. ALWAYS prefer a built-in component over writing from scratch!',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Filter components by keyword, e.g. "marquee", "carousel", "cursor", "shader"' },
              },
            },
          },
          {
            name: 'revyme_add_built_in_component',
            description:
              'Instantly install and place a Revyme built-in component (Marquee, Carousel, EmblaCarousel, AuroraBackground, BlobCursor, AnimatedCounter, etc.) inside a parent container on the active page canvas. Props are configured dynamically.',
            inputSchema: {
              type: 'object',
              properties: {
                tag: { type: 'string', description: 'Built-in component tag (e.g. "Marquee", "Carousel", "AuroraBackground", "BlobCursor")' },
                parent_id: { type: 'string', description: 'data-id of the parent container to place the component inside' },
                props: { type: 'object', description: 'Component props (e.g. { speed: 60, direction: "left", gap: 32 } for Marquee)' },
              },
              required: ['tag'],
            },
          },
          {
            name: 'revyme_set_responsive_styles',
            description:
              'Set responsive CSS styles on a node for specific viewports (e.g. "tablet" for 810px, "mobile" for 375px) via container queries. Pass empty string "" for any property to remove it.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: { type: 'string', description: 'data-id of the target node' },
                viewport: { type: 'string', description: 'Viewport name ("tablet", "mobile") or breakpoint width in px (810, 375)' },
                styles: { type: 'object', description: 'camelCase CSS style properties' },
              },
              required: ['node_id', 'viewport', 'styles'],
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
          case 'revyme_insert_fragment':
            result = await this.sendToEditor('agent.tool', {
              name: 'insert_fragment',
              input: args,
            });
            break;
          case 'revyme_apply_motion_preset':
            result = await this.sendToEditor('agent.tool', {
              name: 'apply_motion_preset',
              input: args,
            });
            break;
          case 'revyme_manage_component_variant':
            result = await this.sendToEditor('agent.tool', {
              name: 'manage_component_variant',
              input: args,
            });
            break;
          case 'revyme_list_built_in_components':
            result = await this.sendToEditor('agent.tool', {
              name: 'list_built_in_components',
              input: args,
            });
            break;
          case 'revyme_add_built_in_component':
            result = await this.sendToEditor('agent.tool', {
              name: 'add_built_in_component',
              input: args,
            });
            break;
          case 'revyme_set_responsive_styles':
            result = await this.sendToEditor('agent.tool', {
              name: 'set_styles',
              input: args,
            });
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
