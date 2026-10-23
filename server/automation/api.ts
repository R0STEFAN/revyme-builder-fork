// server/automation/api.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { Plan } from '../../packages/automation-core/src/contracts';
import { LocalProjectRepository } from './project-repository';
import { CommitService } from './commit-service';

export function createAutomationMiddleware(options: {
  repository?: LocalProjectRepository;
  commitService?: CommitService;
  validatePlan?: (snapshot: any, plan: Plan) => { ok: boolean; issues: any[] };
} = {}) {
  const repository = options.repository || new LocalProjectRepository();
  const commitService = options.commitService || new CommitService(repository);

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (!pathname.startsWith('/api/automation')) {
      return next();
    }

    // Helper to send json
    const sendJson = (code: number, data: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };

    // Helper to read JSON body
    const readBody = (): Promise<any> =>
      new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        });
        req.on('error', reject);
      });

    try {
      // 1. GET /api/automation/snapshot?projectId=...&branchId=...
      if (method === 'GET' && pathname === '/api/automation/snapshot') {
        const projectId = url.searchParams.get('projectId');
        const branchId = url.searchParams.get('branchId') || 'main';
        if (!projectId) {
          return sendJson(400, { ok: false, error: 'projectId is required' });
        }
        const snapshot = await repository.getSnapshot({ projectId, branchId });
        if (!snapshot) {
          return sendJson(404, { ok: false, error: `Project ${projectId} not found` });
        }
        const serializedSnapshot = {
          scope: snapshot.scope,
          revision: snapshot.revision,
          files: Object.fromEntries(snapshot.files),
          config: snapshot.config,
        };
        return sendJson(200, {
          ok: true,
          data: serializedSnapshot,
          snapshot: serializedSnapshot,
        });
      }

      // 2. POST /api/automation/plan (validate plan)
      if (method === 'POST' && pathname === '/api/automation/plan') {
        const plan = (await readBody()) as Plan;
        const snapshot = await repository.getSnapshot(plan.scope);
        if (!snapshot) {
          return sendJson(404, { ok: false, error: `Project ${plan.scope.projectId} not found` });
        }
        let validation = { ok: (plan.issues || []).length === 0, issues: plan.issues || [] };
        if (typeof options.validatePlan === 'function') {
          validation = options.validatePlan(snapshot, plan);
        } else {
          try {
            const mod = await import('../../packages/automation-core/src/validate');
            validation = mod.validatePlan(snapshot, plan);
          } catch {
            // If validator module is unavailable in this environment, return plan issues
            validation = { ok: (plan.issues || []).length === 0, issues: plan.issues || [] };
          }
        }
        return sendJson(200, validation);
      }

      // 3. POST /api/automation/commit (durable commit with CAS)
      if (method === 'POST' && pathname === '/api/automation/commit') {
        const plan = (await readBody()) as Plan;
        const result = await commitService.commit(plan);
        const statusCode = result.ok ? 200 : result.error?.code === 'REVISION_CONFLICT' ? 409 : 400;
        return sendJson(statusCode, result);
      }

      // 4. GET /api/automation/status?projectId=...&operationId=...
      if (method === 'GET' && pathname === '/api/automation/status') {
        const projectId = url.searchParams.get('projectId');
        const branchId = url.searchParams.get('branchId') || 'main';
        const operationId = url.searchParams.get('operationId');
        if (!projectId) {
          return sendJson(400, { ok: false, error: 'projectId is required' });
        }
        if (operationId) {
          const receipt = await commitService.status(projectId, operationId);
          return sendJson(200, {
            ok: true,
            found: Boolean(receipt),
            receipt,
          });
        }
        const snapshot = await repository.getSnapshot({ projectId, branchId });
        return sendJson(200, {
          ok: true,
          healthy: true,
          revision: snapshot?.revision ?? 0,
        });
      }

      next();
    } catch (err: any) {
      sendJson(500, { ok: false, error: err.message });
    }
  };
}
