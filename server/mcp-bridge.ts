import http from 'node:http';
import { exec } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listProjects } from './storage';

export function assertProjectScopedPath(filePath: unknown): void {
  const p = String(filePath ?? '').trim();
  if (!p) throw new Error('Path cannot be empty.');
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p) || p.includes('..') || p.includes('\0')) {
    throw new Error(`Access denied: Path "${p}" is outside the active project. MCP tools are strictly restricted to files within the active project.`);
  }
}

export function getRecentBuilderUrl(baseOrigin = 'http://localhost:3333'): string {
  try {
    const list = listProjects();
    const valid = (list || []).filter((p) => !p.id.startsWith('test-') && !p.id.includes('fifo'));
    if (valid.length > 0 && valid[0]?.id) {
      const prefix = baseOrigin ? `${baseOrigin.replace(/\/+$/, '')}` : '';
      return `${prefix}/builder/${encodeURIComponent(valid[0].id)}`;
    }
  } catch (err) {
    // If data dir does not exist or storage cannot be read
  }
  const prefix = baseOrigin ? `${baseOrigin.replace(/\/+$/, '')}` : '';
  return prefix ? `${prefix}/dashboard` : '/dashboard';
}

export function openBrowserUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    let cmd = '';
    if (process.platform === 'win32') {
      cmd = `start "" "${url}"`;
    } else if (process.platform === 'darwin') {
      cmd = `open "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }
    exec(cmd, (err) => {
      if (err) {
        console.warn(`[Revyme Bridge] Failed to launch browser: ${err.message}`);
      }
      resolve();
    });
  });
}

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
  private clientRoles = new WeakMap<http.ServerResponse, string>();
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
    let canvasClients = Array.from(this.sseClients).filter(
      (c) => this.clientRoles.get(c) !== 'dashboard'
    );
    const dashboardClients = Array.from(this.sseClients).filter(
      (c) => this.clientRoles.get(c) === 'dashboard'
    );

    // If no canvas tab is connected but a dashboard tab is open, ask it to navigate to the builder
    if (canvasClients.length === 0 && dashboardClients.length > 0) {
      const recentUrl = getRecentBuilderUrl('');
      console.warn(`[Revyme Bridge] Browser tab is on dashboard. Auto-navigating to ${recentUrl}...`);
      const navPayload = JSON.stringify({
        id: 0,
        method: 'navigateToBuilder',
        params: { url: recentUrl },
      });
      for (const dc of dashboardClients) {
        try {
          dc.write(`data: ${navPayload}\n\n`);
        } catch {
          // ignore
        }
      }
      const navWaitStart = Date.now();
      while (Date.now() - navWaitStart < 8000) {
        canvasClients = Array.from(this.sseClients).filter(
          (c) => this.clientRoles.get(c) !== 'dashboard'
        );
        if (canvasClients.length > 0) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    if (canvasClients.length === 0) {
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

      const recentUrl = getRecentBuilderUrl('http://localhost:3333');
      throw new Error(
        'Revyme editor is not connected (0 active canvas browser tabs). ' +
        `Open ${recentUrl} in your browser (not /dashboard). ` +
        'Or call the "revyme_open_editor" tool to launch it automatically.'
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

      for (const client of canvasClients) {
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

    const url = new URL(req.url || '/', 'http://localhost');
    const role = url.searchParams.get('role') || 'canvas';
    this.clientRoles.set(res, role);
    this.sseClients.add(res);
    console.error(`[Revyme Bridge] Editor tab (${role}) connected via SSE. Active tabs: ${this.sseClients.size}`);

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
              'Get the active editor context: current page/component path, JSX code, compact page node tree (nodeTree with data-ids, names, and hierarchy), pages list, components, presets (design tokens) and CMS collections.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'revyme_inspect_node',
            description:
              'Inspect a specific element/node on the active canvas by its data-id. Returns full details: type/tag, name, parentId, children IDs, full CSS styles, attributes, and text content.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: { type: 'string', description: 'data-id of the target node to inspect' },
              },
              required: ['node_id'],
            },
          },
          {
            name: 'revyme_search_project',
            description:
              'Full-text search across all files in the Revyme project. Quickly finds component usages, data-ids, classes, text strings, or CSS variables without loading every file into context.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search term or keyword to find' },
                path_prefix: { type: 'string', description: 'Optional path filter, e.g. "components/" or "app/"' },
              },
              required: ['query'],
            },
          },
          {
            name: 'revyme_audit_design',
            description:
              'Lints the rendered layout against hard visual and responsive design rules across viewports (sibling overlap >4px, child overflow beyond parent >8px, section viewport overflow, WCAG text contrast below 4.5:1, font sizes below 12px, text truncation). ALWAYS run this after editing layouts or responsive styles to verify perfection.',
            inputSchema: {
              type: 'object',
              properties: {
                viewport: { type: 'string', description: 'Optional viewport ID ("desktop", "tablet", "mobile") or width in px (e.g. 1200, 810, 375)' },
              },
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
            name: 'revyme_upload_image',
            description:
              'Upload an image asset directly into the active project via base64 data. Returns the project upload URL (/api/uploads/<filename>) that can then be referenced by project elements and components.',
            inputSchema: {
              type: 'object',
              properties: {
                dataBase64: { type: 'string', description: 'Base64-encoded image file bytes' },
                contentType: { type: 'string', description: 'MIME type (e.g. "image/png", "image/jpeg", "image/webp")' },
                filename: { type: 'string', description: 'Desired filename, e.g. "cover.webp"' },
              },
              required: ['dataBase64'],
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
              'Manage CMS collections, fields, items, list data bindings, external API CMS integration, and dynamic fx expressions. Supports 3 categories of operations: 1) Collection CRUD: list_collections, get_collection, create_collection, rename_collection, delete_collection, add_field, update_field, remove_field, add_item, update_item, remove_item, set_item_translation, create_pages, create_page, create_template. 2) CMS List & Prop Data Binding: bind_list (repeater loop on template row), bind_field (bind text/attr/CSS to item.field), unbind_field, bind_prop (bind component instance prop to item.field), set_list_config (filters, sort, limit, offset), set_pagination (loadMore, infinite, none). 3) External API CMS & Dynamic Expressions: get_mode, set_mode (local | api), configure_api_collection (Directus, Strapi, Baserow, REST), get_api_collection, remove_api_collection, set_list_query (data-query-config with backend parameters and formula expressions), bind_expression (bind dynamic JavaScript formula fx to text, href, or src), unbind_expression.',
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
                    'update_field',
                    'remove_field',
                    'add_item',
                    'update_item',
                    'remove_item',
                    'set_item_translation',
                    'create_pages',
                    'create_page',
                    'create_template',
                    // CMS List & Field Data Binding
                    'bind_list',
                    'bind_field',
                    'unbind_field',
                    'bind_prop',
                    'set_list_config',
                    'set_pagination',
                    // External API CMS Mode
                    'get_mode',
                    'set_mode',
                    'configure_api_collection',
                    'get_api_collection',
                    'remove_api_collection',
                    'set_list_query',
                    // Dynamic Expressions (fx)
                    'bind_expression',
                    'unbind_expression',
                  ],
                },
                collection: { type: 'string', description: 'Collection slug' },
                name: { type: 'string', description: 'Name for create_collection or add_field' },
                field: { type: 'object', description: 'Field configuration for add_field' },
                item: { type: 'object', description: 'Item data for add_item' },
                itemId: { type: 'string', description: 'Item ID for update_item or remove_item' },
                nodeId: { type: 'string', description: 'data-id of element, template row, or list container' },
                property: { type: 'string', description: 'Property to bind (text, src, href, alt, or CSS property)' },
                fieldId: { type: 'string', description: 'Field ID from collection schema to bind' },
                componentName: { type: 'string', description: 'Component tag name for bind_prop' },
                prop: { type: 'string', description: 'Prop name on component instance for bind_prop' },
                targetProperty: { type: 'string', enum: ['text', 'href', 'src'], description: 'Target property for bind_expression / unbind_expression' },
                expression: { type: 'string', description: 'Dynamic JavaScript expression / formula fx without wrapping {}' },
                fallbackValue: { type: 'string', description: 'Static fallback value when unbinding expression' },
                mode: { type: 'string', enum: ['local', 'api'], description: 'CMS mode for set_mode (local | api)' },
                apiConfig: { type: 'object', description: 'External API configuration for configure_api_collection' },
                queryConfig: { type: 'object', description: 'Query parameters configuration for set_list_query' },
                filters: { type: 'array', description: 'Filter rules for set_list_config' },
                combinator: { type: 'string', enum: ['and', 'or'], description: 'Combinator for filter rules (and | or)' },
                sort: { type: 'array', description: 'Sort rules for set_list_config' },
                limit: { type: 'number', description: 'Item limit count for set_list_config' },
                offset: { type: 'number', description: 'Offset count for set_list_config' },
                pagination: {
                  type: 'object',
                  properties: {
                    mode: { type: 'string', enum: ['loadMore', 'infinite', 'none'] },
                    perPage: { type: 'number' },
                  },
                  description: 'Pagination configuration for set_pagination',
                },
              },
              required: ['action'],
            },
          },
          {
            name: 'revyme_bind_expression',
            description:
              'Bind a dynamic JavaScript formula / expression (fx) to an element: text content, link href, or image src. Supports item.<field> access, template literals (`https://.../${item.img}`), route params (params.id automatically imports useParams()), and ternary expressions (item.price ? "$" + item.price : "Free"). Formulas must NOT be wrapped in {}.',
            inputSchema: {
              type: 'object',
              properties: {
                nodeId: { type: 'string', description: 'data-id of the element' },
                targetProperty: { type: 'string', enum: ['text', 'href', 'src'], description: 'Target property to bind (default: text)' },
                expression: { type: 'string', description: 'Dynamic JavaScript expression formula without wrapping {}' },
              },
              required: ['nodeId', 'expression'],
            },
          },
          {
            name: 'revyme_insert_fragment',
            description:
              'PRIMARY UI TOOL: Insert a whole semantic subtree/fragment (nested tree with auto-generated unique data-ids, styles, attributes, text, responsive overrides, and Framer Motion hover effects) in a single atomic operation. Use this to construct or append sections, cards, navbars, and layouts into the active page (query parent_id with revyme_get_context). MANDATORY DESIGN-SYSTEM-FIRST PROTOCOL: 1) Master Components: Create buttons, cards, navbars, and badges as Design Components FIRST (via create_component in revyme_agent_tool), then place them using uppercase component tags (e.g. tag: "StudioButton", "ProjectCard") with attrs (e.g. attrs: { label: "...", variant: "secondary" })! Never inline raw <div> cards or raw <button> tags when reusable components should exist! 2) Two-Tier Layout: Full-bleed <section> (width: 100%, explicit backgroundColor) containing a centered inner <div name="Container"> (maxWidth: 1200px, width: 100%, margin: "0 auto", padding: "0 24px"). 3) Navbar Responsive Matrix: Desktop links group must have display: "flex", mobile hamburger button display: "none" on desktop; on tablet/mobile, desktop links must be display: "none" and hamburger display: "flex". 4) Zero-In-Flow Overlay: Fullscreen menus/drawers must NEVER be placed as in-flow section blocks; drawers must be position: "fixed", inset: 0, zIndex: 9999, display: "none" by default!',
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
            name: 'revyme_insert_section',
            description:
              'Insert an art-directed, fully-responsive Section blueprint from the Revyme library (e.g. "header-editorial", "header-glass", "hero-editorial", "hero-typewall") into the active page canvas. Drops production-ready typography, container padding, and responsive mobile/tablet behaviors with 100% verified design standards.',
            inputSchema: {
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  enum: ['header-editorial', 'header-glass', 'hero-editorial', 'hero-typewall'],
                  description: 'Blueprint ID to insert ("header-editorial", "header-glass", "hero-editorial", "hero-typewall")',
                },
                parent_id: { type: 'string', description: 'Parent container data-id (default: "root")' },
                index: { type: 'number', description: '0-based position among siblings (e.g. 0 to place at top of page)' },
              },
              required: ['section'],
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
              'Instantly install and place a Revyme built-in component (Marquee, Carousel, EmblaCarousel, AuroraBackground, BlobCursor, AnimatedCounter, etc.) inside a parent container on the active page canvas. For Marquee or Carousel, populate items with reusable Design Component instances (e.g. MarqueeCard) with border and hover variants.',
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
            name: 'revyme_add_component_instance',
            description:
              'Place an instance of an existing project component (e.g. Navbar, Hero, ProjectCard, PrimaryButton) into a container on the active canvas. The instance tag is the component name and its props are written as JSX attributes. Only declared props on the master are applied. You can specify "variant" directly to set the initialVariant display state.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Component name as defined in components/ (e.g. "Navbar", "Hero", "ProjectCard")',
                },
                parent_id: {
                  type: 'string',
                  description: 'data-id of the parent node to insert into (defaults to selected element or root)',
                },
                variant: {
                  type: 'string',
                  description: 'Optional initial variant name to display on canvas, e.g. "secondary", "asym-b", "menu-open"',
                },
                props: {
                  type: 'object',
                  description: 'Component props (e.g. { studioName: "ACME", initialVariant: "default" })',
                },
                index: {
                  type: 'number',
                  description: '0-based position among siblings in parent',
                },
              },
              required: ['name'],
            },
          },
          {
            name: 'revyme_set_variant',
            description:
              'Set or update the CSS styles or text content of a COMPONENT INSTANCE\'s variant in its component master. node_id is the instance on the page; variant is the variant name (e.g. "menu-open", "hover", "dark"). Use element to target an inner element inside the master by its data-id.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: {
                  type: 'string',
                  description: 'data-id of the component instance node on the page',
                },
                variant: {
                  type: 'string',
                  description: 'The variant name on the master (e.g. "menu-open", "hover", "dark")',
                },
                element: {
                  type: 'string',
                  description: 'Optional data-id of an element INSIDE the component master to style (defaults to root)',
                },
                styles: {
                  type: 'object',
                  description: 'camelCase CSS style properties to write on that variant; pass "" to remove',
                },
                text: {
                  type: 'string',
                  description: 'New text content for that variant',
                },
              },
              required: ['node_id', 'variant'],
            },
          },
          {
            name: 'revyme_show_variant',
            description:
              'Choose which VARIANT a component INSTANCE displays on the active canvas (initialVariant) — the same write as picking a variant in the inspector. Pass variant="default" to reset. Optional viewport scopes the display to that breakpoint width in px (e.g. 375 for mobile). Use this to preview or edit non-default states like "menu-open" on the canvas.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: {
                  type: 'string',
                  description: 'data-id of the component instance node on the page',
                },
                variant: {
                  type: 'string',
                  description: 'Variant name to display on canvas, e.g. "menu-open" or "default"',
                },
                viewport: {
                  type: 'number',
                  description: 'Optional breakpoint width in px to scope the choice to (omit for base/desktop)',
                },
                inside: {
                  type: 'string',
                  description: 'Optional master name when the instance sits inside another component',
                },
              },
              required: ['node_id', 'variant'],
            },
          },
          {
            name: 'revyme_add_connection',
            description:
              'Wire a TRIGGER to switch variants on a design component (e.g. "clicking the hamburger button switches to the menu-open variant"). component is the component name; from -> to are variant names; trigger is click | clickStart | mouseEnter | mouseLeave | inView | afterDelay. source_node is the data-id inside the master that carries the trigger (e.g. "header-hamburger-btn"); omit for root.',
            inputSchema: {
              type: 'object',
              properties: {
                component: {
                  type: 'string',
                  description: 'Component name, e.g. "Navbar" or "PricingCard"',
                },
                from: {
                  type: 'string',
                  description: 'Source variant the trigger fires in (e.g. "default")',
                },
                to: {
                  type: 'string',
                  description: 'Target variant to switch to (e.g. "menu-open")',
                },
                trigger: {
                  type: 'string',
                  enum: ['click', 'clickStart', 'mouseEnter', 'mouseLeave', 'inView', 'afterDelay'],
                  description: 'Trigger event type',
                },
                source_node: {
                  type: 'string',
                  description: 'Optional data-id inside the master that carries the trigger (e.g. "header-hamburger-btn"); omit for root',
                },
                delay: {
                  type: 'number',
                  description: 'Optional delay in seconds for afterDelay (0-2)',
                },
              },
              required: ['component', 'from', 'to', 'trigger'],
            },
          },
          {
            name: 'revyme_open_editor',
            description:
              'Open the Revyme builder canvas in the user\'s browser and wait for SSE connection. Automatically opens the most recent project (e.g. /builder/<projectId>), or a specified project_id/url. Use this when the editor is disconnected or the browser is on /dashboard instead of /builder.',
            inputSchema: {
              type: 'object',
              properties: {
                project_id: {
                  type: 'string',
                  description: 'Optional ID of the project to open (defaults to the most recently modified project on disk)',
                },
                url: {
                  type: 'string',
                  description: 'Direct target URL to open (overrides project_id, e.g. "http://localhost:3333/builder/proj-...")',
                },
                wait_ms: {
                  type: 'number',
                  description: 'Milliseconds to wait for canvas SSE connection (default 8000)',
                },
              },
            },
          },
          {
            name: 'revyme_add_canvas_node',
            description:
              'Create a FREE-CANVAS NODE sitting outside the viewport tree (on the open canvas, e.g. for Marquee or Carousel slots). In Revyme and Framer, elements connected to Marquee/Carousel MUST be created on the free canvas and connected via revyme_connect_slot, NEVER placed as inline JSX children. Returns the created node_id.',
            inputSchema: {
              type: 'object',
              properties: {
                tag: { type: 'string', description: 'HTML tag or Component name (e.g. "div", "MarqueeCard", "ProjectCard")' },
                id: { type: 'string', description: 'Optional unique data-id (e.g. "marquee-card-1")' },
                name: { type: 'string', description: 'Display name in layers panel' },
                styles: { type: 'object', description: 'camelCase CSS styles' },
                attrs: { type: 'object', description: 'Attributes or component props (e.g. { variant: "asym-b", category: "ISSUE 01", title: "..." })' },
                text: { type: 'string', description: 'Plain text content' },
              },
              required: ['tag'],
            },
          },
          {
            name: 'revyme_connect_slot',
            description:
              'Connect a FREE-CANVAS NODE into a code component\'s slot (e.g. Carousel slides, Marquee items). Slot components (Marquee, Carousel) MUST use connected free-canvas nodes (created with revyme_add_canvas_node) and NEVER inline children in JSX. Hoists node to const cn_<id> = (...) and references {cn_<id>} inside the slot.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: { type: 'string', description: 'data-id of the slot code component instance (e.g. Marquee or Carousel)' },
                canvas_node_id: { type: 'string', description: 'data-id of the free-canvas node to connect' },
              },
              required: ['node_id', 'canvas_node_id'],
            },
          },
          {
            name: 'revyme_get_slots',
            description:
              'Inspect a code component\'s slot controls: its label, how many nodes it takes, what is connected, and available free-canvas candidates.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: { type: 'string', description: 'data-id of the code component instance (e.g. Marquee)' },
              },
              required: ['node_id'],
            },
          },
          {
            name: 'revyme_disconnect_slot',
            description:
              'Take a canvas node out of a code component\'s slot. The node remains on the free canvas.',
            inputSchema: {
              type: 'object',
              properties: {
                node_id: { type: 'string', description: 'data-id of the code component instance' },
                canvas_node_id: { type: 'string', description: 'data-id of the free-canvas node to disconnect' },
              },
              required: ['node_id', 'canvas_node_id'],
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
          case 'revyme_inspect_node':
            result = await this.sendToEditor('agent.tool', {
              name: 'get_node',
              input: args,
            });
            break;
          case 'revyme_search_project':
            if ((args as any)?.path_prefix) {
              assertProjectScopedPath((args as any).path_prefix);
            }
            result = await this.sendToEditor('searchProject', args);
            break;
          case 'revyme_audit_design':
            result = await this.sendToEditor('agent.tool', {
              name: 'audit_design',
              input: args,
            });
            break;
          case 'revyme_read_file':
            assertProjectScopedPath((args as any)?.path);
            result = await this.sendToEditor('readFile', args);
            break;
          case 'revyme_list_files':
            result = await this.sendToEditor('listFiles', args);
            break;
          case 'revyme_submit_files':
            if (Array.isArray((args as any)?.files)) {
              for (const f of (args as any).files) {
                assertProjectScopedPath(f?.path);
              }
            }
            result = await this.sendToEditor('submitFiles', args);
            break;
          case 'revyme_upload_image':
            result = await this.sendToEditor('uploadImage', args);
            break;
          case 'revyme_manage_presets':
            result = await this.sendToEditor('managePresets', args);
            break;
          case 'revyme_manage_cms':
            result = await this.sendToEditor('manageCms', args);
            break;
          case 'revyme_bind_expression':
            result = await this.sendToEditor('manageCms', { action: 'bind_expression', ...args });
            break;
          case 'revyme_insert_fragment':
            result = await this.sendToEditor('agent.tool', {
              name: 'insert_fragment',
              input: args,
            });
            break;
          case 'revyme_insert_section':
            result = await this.sendToEditor('agent.tool', {
              name: 'insert_section',
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
          case 'revyme_add_component_instance':
            result = await this.sendToEditor('agent.tool', {
              name: 'add_component_instance',
              input: args,
            });
            break;
          case 'revyme_set_variant':
            result = await this.sendToEditor('agent.tool', {
              name: 'set_variant',
              input: args,
            });
            break;
          case 'revyme_show_variant':
            result = await this.sendToEditor('agent.tool', {
              name: 'show_variant',
              input: args,
            });
            break;
          case 'revyme_add_connection':
            result = await this.sendToEditor('agent.tool', {
              name: 'add_connection',
              input: args,
            });
            break;
          case 'revyme_open_editor': {
            const projectId = (args as any)?.project_id;
            let targetUrl = (args as any)?.url;
            const waitMs = (args as any)?.wait_ms ?? 8000;

            if (!targetUrl) {
              if (projectId) {
                targetUrl = `http://localhost:3333/builder/${encodeURIComponent(projectId)}`;
              } else {
                targetUrl = getRecentBuilderUrl('http://localhost:3333');
              }
            }

            await openBrowserUrl(targetUrl);
            const start = Date.now();
            let connected = false;
            while (Date.now() - start < waitMs) {
              const hasCanvas = Array.from(this.sseClients).some(
                (c) => this.clientRoles.get(c) !== 'dashboard'
              );
              if (hasCanvas) {
                connected = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 400));
            }
            result = {
              ok: connected,
              connected,
              url: targetUrl,
              activeTabs: this.getActiveClientCount(),
              message: connected
                ? `Revyme builder canvas connected successfully at ${targetUrl}.`
                : `Opened ${targetUrl}. Waiting for user browser tab to finish loading.`,
            };
            break;
          }
          case 'revyme_add_canvas_node':
            result = await this.sendToEditor('agent.tool', {
              name: 'add_canvas_node',
              input: args,
            });
            break;
          case 'revyme_connect_slot':
            result = await this.sendToEditor('agent.tool', {
              name: 'connect_slot',
              input: args,
            });
            break;
          case 'revyme_get_slots':
            result = await this.sendToEditor('agent.tool', {
              name: 'get_slots',
              input: args,
            });
            break;
          case 'revyme_disconnect_slot':
            result = await this.sendToEditor('agent.tool', {
              name: 'disconnect_slot',
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
        console.warn(`[Revyme Bridge] Port ${listenPort} is already in use by an active MCP server or IDE daemon. Bridge is running on port ${listenPort}.`);
      } else {
        console.error('[Revyme Bridge] HTTP server error:', err);
      }
    });

    server.listen(listenPort, () => {
      console.error(`[Revyme Bridge] Native MCP bridge listening on http://localhost:${listenPort}`);
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
