import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  duplicateProject,
  saveUpload,
  getUploadFilePath,
} from './storage';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json',
};

function readBodyBuffer(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function parseMultipartFile(body: Buffer, contentType: string): { filename: string; buffer: Buffer } | null {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBuffer = Buffer.from(`--${boundary}`);

  const startIdx = body.indexOf(boundaryBuffer);
  if (startIdx === -1) return null;

  // Find header separator \r\n\r\n
  const headerSep = Buffer.from('\r\n\r\n');
  const headerStart = startIdx + boundaryBuffer.length;
  const headerEnd = body.indexOf(headerSep, headerStart);
  if (headerEnd === -1) return null;

  const headerStr = body.slice(headerStart, headerEnd).toString('utf-8');
  const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
  const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';

  const dataStart = headerEnd + headerSep.length;
  // End is next boundary \r\n--boundary
  const nextBoundary = Buffer.from(`\r\n--${boundary}`);
  const dataEnd = body.indexOf(nextBoundary, dataStart);
  if (dataEnd === -1) return null;

  return {
    filename,
    buffer: body.slice(dataStart, dataEnd),
  };
}

export function selfHostApiPlugin(): Plugin {
  const setupMiddlewares = (middlewares: any) => {
    middlewares.use(async (req: any, res: any, next: any) => {
      const url = req.url || '';
      const method = req.method || 'GET';

      // ─── GET /api/selfhost/status ─────────────────────────────────────────
      if (url === '/api/selfhost/status' && method === 'GET') {
        const projects = listProjects();
        return sendJson(res, 200, {
          enabled: true,
          mode: 'selfhost',
          projectCount: projects.length,
        });
      }

      // ─── POST /api/proxy (CORS-free proxy for plugins) ───────────────────
      if (url === '/api/proxy' && method === 'POST') {
        try {
          const bodyBuf = await readBodyBuffer(req);
          const { url: targetUrl, method: targetMethod = 'GET', headers = {}, body: targetBody } = JSON.parse(bodyBuf.toString('utf-8') || '{}');
          if (!targetUrl) return sendJson(res, 400, { error: 'targetUrl required' });

          const fetchHeaders: Record<string, string> = { ...headers };
          delete fetchHeaders['host'];

          const upstreamRes = await fetch(targetUrl, {
            method: targetMethod,
            headers: fetchHeaders,
            body: targetBody ? (typeof targetBody === 'string' ? targetBody : JSON.stringify(targetBody)) : undefined,
          });

          const contentType = upstreamRes.headers.get('content-type') || 'application/json';
          res.statusCode = upstreamRes.status;
          res.setHeader('Content-Type', contentType);

          const upstreamData = await upstreamRes.arrayBuffer();
          res.end(Buffer.from(upstreamData));
          return;
        } catch (err: any) {
          return sendJson(res, 502, { error: err.message || 'Proxy request failed' });
        }
      }

      // ─── GET /api/projects ────────────────────────────────────────────────
      if (url === '/api/projects' && method === 'GET') {
        const projects = listProjects();
        return sendJson(res, 200, projects);
      }

      // ─── POST /api/projects ───────────────────────────────────────────────
      if (url === '/api/projects' && method === 'POST') {
        try {
          const bodyBuf = await readBodyBuffer(req);
          const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
          const id = body.id || `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const name = body.name || 'Untitled Website';
          const data = body.data || { format: 'revyme-v1', files: {} };
          const saved = saveProject(id, data, name);
          return sendJson(res, 201, saved);
        } catch (err: any) {
          return sendJson(res, 400, { error: err.message || 'Failed to create project' });
        }
      }

      // ─── POST /api/upload ─────────────────────────────────────────────────
      if (url.startsWith('/api/upload') && method === 'POST') {
        try {
          const contentType = req.headers['content-type'] || '';
          const bodyBuf = await readBodyBuffer(req);

          let filename = 'upload.bin';
          let fileBuffer = bodyBuf;

          if (contentType.includes('multipart/form-data')) {
            const parsed = parseMultipartFile(bodyBuf, contentType);
            if (parsed) {
              filename = parsed.filename;
              fileBuffer = parsed.buffer;
            }
          } else {
            // Check query param ?filename= or header x-filename
            const parsedUrl = new URL(url, 'http://localhost');
            const qFile = parsedUrl.searchParams.get('filename') || req.headers['x-filename'];
            if (qFile) {
              filename = decodeURIComponent(qFile);
            }
          }

          const result = saveUpload(filename, fileBuffer);
          return sendJson(res, 200, result);
        } catch (err: any) {
          return sendJson(res, 500, { error: err.message || 'Failed to save upload' });
        }
      }

      // ─── GET /api/uploads/:file ───────────────────────────────────────────
      if (url.startsWith('/api/uploads/') && method === 'GET') {
        const filename = url.replace('/api/uploads/', '').split('?')[0];
        const filePath = getUploadFilePath(filename);
        if (!filePath) {
          res.statusCode = 404;
          return res.end('Not found');
        }

        const ext = path.extname(filename).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        const stream = fs.createReadStream(filePath);
        return stream.pipe(res);
      }

      // ─── Project detail routes: /api/projects/:id ─────────────────────────
      const projectRouteMatch = url.match(/^\/api\/projects\/([^/?#]+)(\/duplicate)?/);
      if (projectRouteMatch) {
        const id = decodeURIComponent(projectRouteMatch[1]);
        const isDuplicate = !!projectRouteMatch[2];

        // POST /api/projects/:id/duplicate
        if (isDuplicate && method === 'POST') {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = bodyBuf.length ? JSON.parse(bodyBuf.toString('utf-8')) : {};
            const duplicate = duplicateProject(id, body.name);
            if (!duplicate) {
              return sendJson(res, 404, { error: 'Source project not found' });
            }
            return sendJson(res, 201, duplicate);
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message || 'Failed to duplicate project' });
          }
        }

        // GET /api/projects/:id
        if (method === 'GET' && !isDuplicate) {
          const project = getProject(id);
          if (!project) {
            return sendJson(res, 404, { error: 'Project not found' });
          }
          return sendJson(res, 200, project);
        }

        // PUT /api/projects/:id
        if (method === 'PUT' && !isDuplicate) {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
            const data = body.data || body;
            const name = body.name;
            const saved = saveProject(id, data, name);
            return sendJson(res, 200, { success: true, project: saved });
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message || 'Failed to save project' });
          }
        }

        // DELETE /api/projects/:id
        if (method === 'DELETE' && !isDuplicate) {
          const ok = deleteProject(id);
          if (!ok) {
            return sendJson(res, 404, { error: 'Project not found' });
          }
          return sendJson(res, 200, { success: true });
        }
      }

      next();
    });
  };

  return {
    name: 'revyme-selfhost-api',
    configureServer(server) {
      setupMiddlewares(server.middlewares);
    },
    configurePreviewServer(server) {
      setupMiddlewares(server.middlewares);
    },
  };
}
