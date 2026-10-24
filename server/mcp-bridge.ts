import http from 'node:http';
import { exec } from 'node:child_process';
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
  } catch {
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
  host?: string;
  requestTimeoutMs?: number;
}

export class McpBridge {
  private sseClients = new Set<http.ServerResponse>();
  private clientRoles = new WeakMap<http.ServerResponse, string>();
  private clientWebsiteIds = new WeakMap<http.ServerResponse, string>();
  private pendingRequests = new Map<string | number, PendingRequest>();
  private reqSeq = 0;
  private httpServer: http.Server | null = null;
  private httpServerRetryTimer: NodeJS.Timeout | null = null;
  private httpServerRetryAttempts = 0;
  private port: number;
  private host: string;
  private requestTimeoutMs: number;

  private static readonly MAX_HTTP_SERVER_RETRIES = 10;
  private static readonly HTTP_SERVER_RETRY_DELAY_MS = 100;

  constructor(options?: McpBridgeOptions) {
    this.port = options?.port ?? 8082;
    this.host = options?.host ?? '127.0.0.1';
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
    const targetWebsiteId = typeof params?.projectId === 'string' ? params.projectId : null;
    const matchingCanvasClients = () => Array.from(this.sseClients).filter(
      (c) => this.clientRoles.get(c) !== 'dashboard' &&
        (!targetWebsiteId || this.clientWebsiteIds.get(c) === targetWebsiteId)
    );
    let canvasClients = matchingCanvasClients();
    const dashboardClients = Array.from(this.sseClients).filter(
      (c) => this.clientRoles.get(c) === 'dashboard'
    );

    // If no canvas tab is connected but a dashboard tab is open, ask it to navigate to the builder
    if (!targetWebsiteId && canvasClients.length === 0 && dashboardClients.length > 0) {
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
        canvasClients = matchingCanvasClients();
        if (canvasClients.length > 0) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    if (canvasClients.length === 0) {
      if (targetWebsiteId) {
        throw new Error(`No editor tab connected for project "${targetWebsiteId}"`);
      }
      // If this process has no direct SSE clients connected, try forwarding to running bridge HTTP endpoint
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
        'Or launch the editor automatically.'
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
   * Broadcast an idempotent project event and keep one acknowledgement per
   * matching editor. A shared request id would settle on whichever tab replied
   * first, hiding successful syncs behind another tab's dirty-state refusal.
   */
  public async sendToEditors(method: string, params: any = {}, timeoutMs?: number): Promise<Array<
    { ok: true; result: any } | { ok: false; error: string }
  >> {
    const targetWebsiteId = typeof params?.projectId === 'string' ? params.projectId : null;
    const clients = Array.from(this.sseClients).filter((client) =>
      this.clientRoles.get(client) !== 'dashboard' &&
      (!targetWebsiteId || this.clientWebsiteIds.get(client) === targetWebsiteId)
    );

    if (clients.length === 0) {
      if (targetWebsiteId) {
        throw new Error(`No editor tab connected for project "${targetWebsiteId}"`);
      }
      throw new Error('No editor tabs connected');
    }

    return Promise.all(clients.map(async (client) => {
      try {
        return { ok: true as const, result: await this.sendToClient(client, method, params, timeoutMs) };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    }));
  }

  private async sendAuditSnapshotToEditor(params: any): Promise<any> {
    const results = await this.sendToEditors('observeAuditSnapshot', params);
    const successes = results.filter((result): result is { ok: true; result: any } => result.ok);
    if (successes.length === 0) {
      const errors = results.map((result) => result.ok ? '' : result.error).filter(Boolean);
      throw new Error(errors.join('; ') || 'No editor returned an audit snapshot');
    }

    // Multiple Builder tabs may be open on the same project at different saved
    // revisions. A shared request id made the first tab win nondeterministically,
    // even when it was stale. Prefer a ready snapshot from the requested source
    // revision, then an honest pending/unavailable result from that same revision.
    const matchingRevision = successes.filter((result) => result.result?.revision === params?.revision);
    return (
      matchingRevision.find((result) => result.result?.status === 'ready') ||
      matchingRevision[0] ||
      successes[0]
    ).result;
  }

  private sendToClient(client: http.ServerResponse, method: string, params: any, timeoutMs?: number): Promise<any> {
    const id = ++this.reqSeq;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for response from Revyme editor (method: ${method})`));
      }, timeoutMs ?? this.requestTimeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      try {
        client.write(`data: ${payload}\n\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error);
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
    const websiteId = url.searchParams.get('websiteId');
    if (websiteId) this.clientWebsiteIds.set(res, websiteId);
    this.sseClients.add(res);
    console.error(`[Revyme Bridge] Editor tab (${role}) connected via SSE. Active tabs: ${this.sseClients.size}`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        // Client gone
      }
    }, 15000);

    let disconnected = false;
    const cleanup = () => {
      if (disconnected) return;
      disconnected = true;
      clearInterval(keepAlive);
      this.sseClients.delete(res);
      console.error(`[Revyme Bridge] Editor tab disconnected. Remaining: ${this.sseClients.size}`);
    };

    // IncomingMessage `close` also fires when the GET request body completes,
    // which is immediate for an SSE GET and incorrectly tears down a healthy
    // long-lived stream. The ServerResponse owns the stream lifetime.
    res.on('close', cleanup);
    req.on('aborted', cleanup);
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
      const rpcParams = params || {};
      const result = method === 'observeAuditSnapshot'
        ? await this.sendAuditSnapshotToEditor(rpcParams)
        : await this.sendToEditor(method, rpcParams);
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
   * Start standalone HTTP server
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
        if (this.httpServer === server) this.httpServer = null;

        if (this.httpServerRetryAttempts < McpBridge.MAX_HTTP_SERVER_RETRIES && !this.httpServerRetryTimer) {
          this.httpServerRetryAttempts += 1;
          if (this.httpServerRetryAttempts === 1) {
            console.warn(`[Revyme Bridge] Port ${listenPort} is busy; retrying MCP bridge startup.`);
          }
          this.httpServerRetryTimer = setTimeout(() => {
            this.httpServerRetryTimer = null;
            if (!this.httpServer) this.startHttpServer(listenPort);
          }, McpBridge.HTTP_SERVER_RETRY_DELAY_MS);
          return;
        }

        console.warn(`[Revyme Bridge] Port ${listenPort} is already in use after ${this.httpServerRetryAttempts} retries.`);
        this.httpServerRetryAttempts = 0;
      } else {
        console.error('[Revyme Bridge] HTTP server error:', err);
      }
    });

    this.port = listenPort;
    server.listen(listenPort, this.host, () => {
      this.httpServerRetryAttempts = 0;
      console.error(`[Revyme Bridge] Internal bridge listening on http://${this.host}:${listenPort}`);
    });

    this.httpServer = server;
    return server;
  }

  /**
   * Stop standalone HTTP server
   */
  public stopHttpServer(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServerRetryTimer) {
        clearTimeout(this.httpServerRetryTimer);
        this.httpServerRetryTimer = null;
      }
      this.httpServerRetryAttempts = 0;

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
}

export const mcpBridge = new McpBridge();
