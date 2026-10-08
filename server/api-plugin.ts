import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import {
  listProjects,
  getProject,
  saveProject,
  saveProjectThumbnail,
  deleteProject,
  duplicateProject,
  saveUpload,
  saveUploadExact,
  getUploadFilePath,
  listFolders,
  saveFolder,
  renameFolder,
  deleteFolder,
  saveProjectVersion,
  listProjectVersions,
  getProjectVersion,
  restoreProjectVersion,
  deleteProjectVersion,
  listUploads,
  deleteUpload,
  getStorageInfo,
} from './storage';
import { LocalServerManager, localServerManager } from './local-server';
import { McpBridge, mcpBridge as defaultMcpBridge } from './mcp-bridge';



const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
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

export interface SelfHostApiPluginOptions {
  manager?: LocalServerManager;
  bridge?: McpBridge;
  mcpPort?: number;
  autoStartMcpHttp?: boolean;
}

export function selfHostApiPlugin(options?: SelfHostApiPluginOptions): Plugin {
  const manager = options?.manager || localServerManager;
  const bridge = options?.bridge || defaultMcpBridge;
  const mcpPort = options?.mcpPort ?? (process.env.REVYME_MCP_PORT ? parseInt(process.env.REVYME_MCP_PORT, 10) : 8082);
  const autoStartMcpHttp = options?.autoStartMcpHttp ?? true;

  const setupMiddlewares = (middlewares: any) => {
    middlewares.use(bridge.middleware());
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

      // ─── GET /api/folders ─────────────────────────────────────────────────
      if (url === '/api/folders' && method === 'GET') {
        const folders = listFolders();
        return sendJson(res, 200, folders);
      }

      // ─── POST /api/folders ────────────────────────────────────────────────
      if (url === '/api/folders' && method === 'POST') {
        try {
          const bodyBuf = await readBodyBuffer(req);
          const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
          const name = body.name || 'New Folder';
          const saved = saveFolder(name);
          return sendJson(res, 201, saved);
        } catch (err: any) {
          return sendJson(res, 400, { error: err.message || 'Failed to create folder' });
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
          const folderId = body.folderId !== undefined ? body.folderId : null;
          const previewImage = body.previewImage !== undefined ? body.previewImage : null;
          const saved = saveProject(id, data, name, undefined, folderId, previewImage);
          return sendJson(res, 201, saved);
        } catch (err: any) {
          return sendJson(res, 400, { error: err.message || 'Failed to create project' });
        }
      }

      // ─── POST /api/projects/import-bundle ─────────────────────────────────
      if (url === '/api/projects/import-bundle' && method === 'POST') {
        try {
          const bodyBuf = await readBodyBuffer(req);
          const bundle = JSON.parse(bodyBuf.toString('utf-8') || '{}');
          const name = bundle.name || 'Imported Project';
          const data = bundle.data || { format: 'revyme-v1', files: {} };
          const assets = bundle.assets || {};

          let savedAssetCount = 0;
          for (const [filename, assetData] of Object.entries(assets)) {
            if (assetData && typeof assetData === 'object' && (assetData as any).base64) {
              const buf = Buffer.from((assetData as any).base64, 'base64');
              saveUploadExact(filename, buf);
              savedAssetCount++;
            }
          }

          const newId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const saved = saveProject(newId, data, name, undefined, bundle.folderId ?? null, bundle.previewImage ?? null);

          return sendJson(res, 201, {
            success: true,
            project: saved,
            assetCount: savedAssetCount,
          });
        } catch (err: any) {
          return sendJson(res, 400, { error: err.message || 'Failed to import bundle' });
        }
      }

      // ─── GET /api/uploads/:file ───────────────────────────────────────────
      if (url.startsWith('/api/uploads/') && (method === 'GET' || method === 'HEAD')) {
        const rawFilename = url.replace('/api/uploads/', '').split('?')[0];
        let filename = rawFilename;
        try {
          filename = decodeURIComponent(rawFilename);
        } catch {}
        const filePath = getUploadFilePath(filename);
        if (!filePath) {
          res.statusCode = 404;
          return res.end('Not found');
        }

        const ext = path.extname(filename).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (method === 'HEAD') {
          try {
            const stat = fs.statSync(filePath);
            res.setHeader('Content-Length', String(stat.size));
          } catch {}
          return res.end();
        }
        const stream = fs.createReadStream(filePath);
        return stream.pipe(res);
      }

      const isUploadEndpoint = url === '/api/upload' || url.startsWith('/api/upload?') || url === '/api/upload/' || url.startsWith('/api/upload/?');

      // ─── GET /api/upload ──────────────────────────────────────────────────
      if (isUploadEndpoint && method === 'GET') {
        const parsedUrl = new URL(url, 'http://localhost');
        const typeParam = parsedUrl.searchParams.get('type');
        if (typeParam === 'storage') {
          return sendJson(res, 200, getStorageInfo());
        }
        const uploads = listUploads(typeParam === 'video' ? 'video' : typeParam === 'image' ? 'image' : undefined);
        return sendJson(res, 200, { uploads });
      }

      // ─── DELETE /api/upload ───────────────────────────────────────────────
      if (isUploadEndpoint && method === 'DELETE') {
        try {
          const parsedUrl = new URL(url, 'http://localhost');
          let keys: string[] = [];
          const keyParam = parsedUrl.searchParams.get('key') || parsedUrl.searchParams.get('keys');
          if (keyParam) {
            keys = keyParam.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            const bodyBuf = await readBodyBuffer(req);
            if (bodyBuf.length > 0) {
              const body = JSON.parse(bodyBuf.toString('utf-8'));
              if (Array.isArray(body.keys)) keys = body.keys;
              else if (typeof body.key === 'string') keys = [body.key];
            }
          }
          let deletedCount = 0;
          for (const key of keys) {
            if (deleteUpload(key)) deletedCount++;
          }
          return sendJson(res, 200, { success: true, deleted: deletedCount });
        } catch (err: any) {
          return sendJson(res, 500, { error: err.message || 'Failed to delete upload' });
        }
      }

      // ─── POST /api/upload ─────────────────────────────────────────────────
      if (isUploadEndpoint && method === 'POST') {
        try {
          const contentType = req.headers['content-type'] || '';
          const bodyBuf = await readBodyBuffer(req);

          let filename = 'upload.bin';
          let fileBuffer = bodyBuf;

          const parsedUrl = new URL(url, 'http://localhost');
          const isExact = parsedUrl.searchParams.get('exact') === '1' ||
                          parsedUrl.searchParams.get('exact') === 'true' ||
                          req.headers['x-exact-filename'] === 'true';

          if (contentType.includes('multipart/form-data')) {
            const parsed = parseMultipartFile(bodyBuf, contentType);
            if (parsed) {
              filename = parsed.filename;
              fileBuffer = parsed.buffer;
            }
          } else {
            // Check query param ?filename= or header x-filename
            const qFile = parsedUrl.searchParams.get('filename') || req.headers['x-filename'];
            if (qFile) {
              filename = decodeURIComponent(qFile);
            }
          }

          const result = isExact ? saveUploadExact(filename, fileBuffer) : saveUpload(filename, fileBuffer);
          return sendJson(res, 200, result);
        } catch (err: any) {
          return sendJson(res, 500, { error: err.message || 'Failed to save upload' });
        }
      }

      // ─── Snapshots / Backups routes: /api/snapshots ───────────────────────
      const snapshotMatch = url.match(/^\/api\/snapshots(?:\/([^/?#]+)(?:\/(restore))?)?(?:\?.*)?$/);
      if (snapshotMatch) {
        const parsedUrl = new URL(url, 'http://localhost');
        const websiteId = parsedUrl.searchParams.get('websiteId') || 'local';
        const snapId = snapshotMatch[1] ? decodeURIComponent(snapshotMatch[1]) : null;
        const isRestore = snapshotMatch[2] === 'restore';

        // GET /api/snapshots?websiteId=...
        if (method === 'GET' && !snapId) {
          const versions = listProjectVersions(websiteId);
          const snapshots = versions.map((v) => ({
            id: v.id,
            website_id: websiteId,
            kind: v.source,
            deploy_meta: null,
            created_at: new Date(v.timestamp).toISOString(),
            label: v.label || null,
            created_by: null,
          }));
          return sendJson(res, 200, {
            snapshots,
            effectivePlan: 'studio',
            liveSnapshotId: snapshots[0]?.id || null,
          });
        }

        // POST /api/snapshots/:id/restore
        if (method === 'POST' && snapId && isRestore) {
          const result = restoreProjectVersion(websiteId, snapId);
          if (!result.success) {
            return sendJson(res, 404, { error: result.error || 'Failed to restore snapshot' });
          }
          return sendJson(res, 200, { success: true, project: result.project });
        }

        // DELETE /api/snapshots/:id
        if (method === 'DELETE' && snapId && !isRestore) {
          const ok = deleteProjectVersion(websiteId, snapId);
          return sendJson(res, 200, { success: ok });
        }

        // PATCH /api/snapshots/:id (update label)
        if (method === 'PATCH' && snapId) {
          return sendJson(res, 200, { success: true });
        }
      }

      // ─── GET /api/analytics ───────────────────────────────────────────────
      if (url.startsWith('/api/analytics') && method === 'GET') {
        const now = Date.now();
        const days = 90;
        const viewsByDay: Array<{ date: string; views: number }> = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(now - i * 86400000);
          const dateStr = d.toISOString().slice(0, 10);
          viewsByDay.push({ date: dateStr, views: Math.floor(20 + Math.sin(i / 3) * 15 + Math.random() * 10) });
        }
        return sendJson(res, 200, {
          totalViews: viewsByDay.reduce((a, b) => a + b.views, 0),
          uniqueVisitors: Math.round(viewsByDay.reduce((a, b) => a + b.views, 0) * 0.72),
          topPages: [
            { path: '/', views: 640 },
            { path: '/about', views: 180 },
            { path: '/pricing', views: 120 },
            { path: '/contact', views: 85 },
          ],
          topCountries: [
            { country: 'Ukraine', views: 450 },
            { country: 'United States', views: 280 },
            { country: 'Germany', views: 140 },
            { country: 'United Kingdom', views: 90 },
          ],
          topSources: [
            { source: 'Direct', views: 520 },
            { source: 'Google', views: 310 },
            { source: 'GitHub', views: 110 },
            { source: 'Twitter / X', views: 80 },
          ],
          topDevices: [
            { device: 'Desktop', views: 680 },
            { device: 'Mobile', views: 310 },
            { device: 'Tablet', views: 30 },
          ],
          viewsByDay,
          advanced: true,
        });
      }

      // ─── A/B Tests routes: /api/ab-tests ──────────────────────────────────
      if (url.startsWith('/api/ab-tests')) {
        if (method === 'GET') {
          return sendJson(res, 200, {
            tests: [],
            canManage: true,
            isStudio: true,
            caps: { maxVariants: 10, maxGoals: 10, maxConcurrent: 10 },
          });
        }
        if (method === 'POST') {
          const bodyBuf = await readBodyBuffer(req);
          const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
          return sendJson(res, 201, {
            test: {
              id: `ab-${Date.now()}`,
              website_id: body.websiteId || 'local',
              page_path: body.pagePath || 'page',
              name: body.name || 'New A/B Test',
              status: 'draft',
              variants: body.variants || [{ id: 'control', name: 'Control', weight: 50 }, { id: 'variant-b', name: 'Variant B', weight: 50 }],
              goals: body.goals || [{ id: 'goal-1', type: 'visit', name: 'Page Visit' }],
              audience: null,
              winner: null,
              started_at: null,
              ended_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
        }
        if (method === 'PATCH' || method === 'DELETE') {
          return sendJson(res, 200, { success: true });
        }
      }

      // ─── GET /api/websites/:id ────────────────────────────────────────────
      const websiteDetailMatch = url.match(/^\/api\/websites\/([^/?#]+)(?:\/(forms\/usage|domain))?/);
      if (websiteDetailMatch && method === 'GET') {
        const id = decodeURIComponent(websiteDetailMatch[1]);
        const sub = websiteDetailMatch[2];
        if (sub === 'forms/usage') {
          return sendJson(res, 200, { plan: 'paid', cap: null, used: 0, heldThisMonth: 0, held: 0 });
        }
        return sendJson(res, 200, {
          id,
          name: 'Local Website',
          plan: 'studio',
          planStatus: 'active',
          hide_watermark: false,
          custom_domain: null,
          domain_status: 'verified',
        });
      }


      // ─── POST /api/websites/:id/preview-image (unified thumbnail upload) ──
      const websiteThumbMatch = url.match(/^\/api\/websites\/([^/?#]+)\/preview-image/);
      if (websiteThumbMatch && method === 'POST') {
        const id = decodeURIComponent(websiteThumbMatch[1]);
        try {
          const bodyBuf = await readBodyBuffer(req);
          const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
          const dataUrl = body.dataUrl || body.previewImage || body.image;
          if (!dataUrl) {
            return sendJson(res, 400, { error: 'dataUrl required' });
          }
          const saved = saveProjectThumbnail(id, dataUrl);
          return sendJson(res, 200, { success: true, url: saved?.previewImage || '' });
        } catch (err: any) {
          return sendJson(res, 500, { error: err.message || 'Failed to save thumbnail' });
        }
      }

      // ─── Project version routes: /api/projects/:id/versions ───────────────
      const versionRouteMatch = url.match(/^\/api\/projects\/([^/?#]+)\/versions(?:\/([^/?#]+)(?:\/(restore))?)?(?:\?.*)?$/);
      if (versionRouteMatch) {
        const id = decodeURIComponent(versionRouteMatch[1]);
        const versionId = versionRouteMatch[2] ? decodeURIComponent(versionRouteMatch[2]) : null;
        const isRestore = versionRouteMatch[3] === 'restore';

        // GET /api/projects/:id/versions (list all, optional ?branchId=...)
        if (method === 'GET' && !versionId) {
          const queryPart = (url.split('?')[1] || '');
          const params = new URLSearchParams(queryPart);
          const branchId = params.get('branchId') || undefined;
          const versions = listProjectVersions(id, branchId);
          return sendJson(res, 200, { versions, count: versions.length });
        }

        // GET /api/projects/:id/versions/:versionId
        if (method === 'GET' && versionId && !isRestore) {
          const version = getProjectVersion(id, versionId);
          if (!version) {
            return sendJson(res, 404, { error: 'Version not found' });
          }
          return sendJson(res, 200, version);
        }

        // POST /api/projects/:id/versions/:versionId/restore
        if (method === 'POST' && versionId && isRestore) {
          const result = restoreProjectVersion(id, versionId);
          if (!result.success) {
            return sendJson(res, 404, { error: result.error || 'Failed to restore version' });
          }
          return sendJson(res, 200, { success: true, project: result.project, version: result.version });
        }

        // DELETE /api/projects/:id/versions/:versionId
        if (method === 'DELETE' && versionId && !isRestore) {
          const ok = deleteProjectVersion(id, versionId);
          if (!ok) {
            return sendJson(res, 404, { error: 'Version not found' });
          }
          return sendJson(res, 200, { success: true });
        }
      }

      // ─── Project detail routes: /api/projects/:id ─────────────────────────
      const projectRouteMatch = url.match(/^\/api\/projects\/([^/?#]+)(\/duplicate|\/thumbnail|\/bundle)?/);
      if (projectRouteMatch) {
        const id = decodeURIComponent(projectRouteMatch[1]);
        const subRoute = projectRouteMatch[2];
        const isDuplicate = subRoute === '/duplicate';
        const isThumbnail = subRoute === '/thumbnail';
        const isBundle = subRoute === '/bundle';

        // GET /api/projects/:id/bundle
        if (isBundle && method === 'GET') {
          const project = getProject(id);
          if (!project) {
            return sendJson(res, 404, { error: 'Project not found' });
          }

          const serialized = JSON.stringify(project.data || {});
          const assetMatches = serialized.matchAll(/\/api\/uploads\/([a-zA-Z0-9._-]+)/g);
          const assetFileNames = Array.from(new Set(Array.from(assetMatches, (m) => m[1])));

          // Also check project previewImage
          if (project.previewImage && project.previewImage.startsWith('/api/uploads/')) {
            const previewFile = project.previewImage.replace('/api/uploads/', '').split('?')[0];
            if (previewFile && !assetFileNames.includes(previewFile)) {
              assetFileNames.push(previewFile);
            }
          }

          const assets: Record<string, { base64: string; mime?: string; size: number }> = {};
          for (const filename of assetFileNames) {
            const filePath = getUploadFilePath(filename);
            if (filePath && fs.existsSync(filePath)) {
              try {
                const buf = fs.readFileSync(filePath);
                const ext = path.extname(filename).toLowerCase();
                const mime = MIME_TYPES[ext] || 'application/octet-stream';
                assets[filename] = {
                  base64: buf.toString('base64'),
                  mime,
                  size: buf.length,
                };
              } catch {}
            }
          }

          const bundle = {
            format: 'revyme-bundle-v1',
            id: project.id,
            name: project.name,
            exportedAt: new Date().toISOString(),
            data: project.data,
            previewImage: project.previewImage || null,
            folderId: project.folderId || null,
            assets,
          };

          return sendJson(res, 200, bundle);
        }

        // POST /api/projects/:id/thumbnail
        if (isThumbnail && method === 'POST') {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
            const dataUrl = body.dataUrl || body.previewImage || body.image;
            if (!dataUrl) {
              return sendJson(res, 400, { error: 'dataUrl required' });
            }
            const saved = saveProjectThumbnail(id, dataUrl);
            if (!saved) {
              return sendJson(res, 404, { error: 'Project not found' });
            }
            return sendJson(res, 200, { success: true, previewImage: saved.previewImage, url: saved.previewImage });
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message || 'Failed to save thumbnail' });
          }
        }

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
        if (method === 'GET' && !isDuplicate && !isThumbnail && !isBundle) {
          const project = getProject(id);
          if (!project) {
            return sendJson(res, 404, { error: 'Project not found' });
          }
          return sendJson(res, 200, project);
        }

        // PUT /api/projects/:id
        if (method === 'PUT' && !isDuplicate && !isThumbnail && !isBundle) {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
            const data = body.data;
            const name = body.name;
            const folderId = body.folderId;
            const previewImage = body.previewImage;
            let current = getProject(id);
            if (!current && (data || body.files)) {
              // Creating or importing via PUT
              const saved = saveProject(id, data || body, name, undefined, folderId, previewImage);
              const verData = data || body;
              if (verData && verData.files) {
                saveProjectVersion(id, verData, {
                  branchId: body.branchId,
                  source: body.source || 'manual',
                  label: body.label,
                  changesSummary: body.changesSummary,
                });
              }
              return sendJson(res, 200, { success: true, project: saved });
            }
            if (!current) {
              return sendJson(res, 404, { error: 'Project not found' });
            }
            const saved = saveProject(
              id,
              data !== undefined ? data : current.data,
              name !== undefined ? name : current.name,
              undefined,
              folderId !== undefined ? folderId : current.folderId,
              previewImage !== undefined ? previewImage : current.previewImage
            );
            const verData = data !== undefined ? data : current.data;
            if (verData && verData.files) {
              saveProjectVersion(id, verData, {
                branchId: body.branchId,
                source: body.source || 'autosave',
                label: body.label,
                changesSummary: body.changesSummary,
              });
            }
            return sendJson(res, 200, { success: true, project: saved });
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message || 'Failed to save project' });
          }
        }

        // DELETE /api/projects/:id
        if (method === 'DELETE' && !isDuplicate && !isThumbnail) {
          const ok = deleteProject(id);
          if (!ok) {
            return sendJson(res, 404, { error: 'Project not found' });
          }
          return sendJson(res, 200, { success: true });
        }
      }

      // ─── Folder detail routes: /api/folders/:id ───────────────────────────
      const folderRouteMatch = url.match(/^\/api\/folders\/([^/?#]+)/);
      if (folderRouteMatch) {
        const folderId = decodeURIComponent(folderRouteMatch[1]);
        if (method === 'PUT') {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = JSON.parse(bodyBuf.toString('utf-8') || '{}');
            const updated = renameFolder(folderId, body.name);
            if (!updated) {
              return sendJson(res, 404, { error: 'Folder not found' });
            }
            return sendJson(res, 200, updated);
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message || 'Failed to rename folder' });
          }
        }
        if (method === 'DELETE') {
          const ok = deleteFolder(folderId);
          if (!ok) {
            return sendJson(res, 404, { error: 'Folder not found' });
          }
          return sendJson(res, 200, { success: true });
        }
      }

      // ─── Local Server routes: /api/local-server/:projectId/* ─────────────
      const localServerMatch = url.match(/^\/api\/local-server\/([^/?#]+)\/(status|build|start|stop)(?:\/)?(?:[?#].*)?$/);
      if (localServerMatch) {
        const projectId = decodeURIComponent(localServerMatch[1]);
        const action = localServerMatch[2];

        // GET /api/local-server/:projectId/status
        if (action === 'status' && method === 'GET') {
          const status = manager.getStatus(projectId);
          return sendJson(res, 200, { status });
        }

        // POST /api/local-server/:projectId/build
        if (action === 'build' && method === 'POST') {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = bodyBuf.length ? JSON.parse(bodyBuf.toString('utf-8')) : {};
            const result = await manager.build(projectId, body.files, body.branch);
            if (result.success) {
              return sendJson(res, 200, { success: true, log: result.log });
            } else {
              return sendJson(res, 500, { error: 'Build failed', log: result.log });
            }
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message || 'Build failed', log: err.stack || '' });
          }
        }

        // POST /api/local-server/:projectId/start
        if (action === 'start' && method === 'POST') {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = bodyBuf.length ? JSON.parse(bodyBuf.toString('utf-8')) : {};
            const status = await manager.start(projectId, body.port);
            return sendJson(res, 200, status);
          } catch (err: any) {
            return sendJson(res, 500, {
              error: err.message || 'Failed to start server',
              status: manager.getStatus(projectId),
            });
          }
        }

        // POST /api/local-server/:projectId/stop
        if (action === 'stop' && method === 'POST') {
          try {
            const bodyBuf = await readBodyBuffer(req);
            const body = bodyBuf.length ? JSON.parse(bodyBuf.toString('utf-8')) : {};
            const status = body.port !== undefined
              ? await manager.stop(projectId, body.port)
              : await manager.stop(projectId);
            return sendJson(res, 200, status);
          } catch (err: any) {
            return sendJson(res, 500, {
              error: err.message || 'Failed to stop server',
              status: manager.getStatus(projectId),
            });
          }
        }
      }

      next();

    });
  };

  return {
    name: 'revyme-selfhost-api',
    configureServer(server) {
      setupMiddlewares(server.middlewares);
      if (autoStartMcpHttp) {
        bridge.startHttpServer(mcpPort);
        server.httpServer?.on('close', () => {
          void bridge.stopHttpServer();
        });
      }
    },
    configurePreviewServer(server) {
      setupMiddlewares(server.middlewares);
      if (autoStartMcpHttp) {
        bridge.startHttpServer(mcpPort);
        server.httpServer?.on('close', () => {
          void bridge.stopHttpServer();
        });
      }
    },
  };
}
