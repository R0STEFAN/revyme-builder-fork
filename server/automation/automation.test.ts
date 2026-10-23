// server/automation/automation.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { LocalProjectRepository, ConflictError } from './project-repository';
import { CommitService } from './commit-service';
import { createAutomationMiddleware } from './api';
import { createPlan } from '../../packages/automation-core/src/plan';
import { saveProject, getProject } from '../storage';

function createMockReqRes(opts: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | object;
}) {
  const req = new EventEmitter() as any;
  req.method = opts.method || 'GET';
  req.url = opts.url;
  req.headers = { ...(opts.headers || {}) };

  const bodyData =
    opts.body !== undefined
      ? typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body)
      : '';

  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    writtenData: [] as string[],
    setHeader(name: string, val: string) {
      this.headers[name.toLowerCase()] = val;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          this.headers[k.toLowerCase()] = v;
        }
      }
    },
    write(chunk: string) {
      this.writtenData.push(chunk);
    },
    end(chunk?: string) {
      if (chunk) this.writtenData.push(chunk);
      this.ended = true;
    },
    ended: false,
  };

  return { req, res, bodyData };
}

describe('T04: Canonical Repository, CAS/Idempotency and Commit Service', () => {
  let tmpDir: string;
  let repo: LocalProjectRepository;
  let service: CommitService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-t04-test-'));
    repo = new LocalProjectRepository(tmpDir);
    service = new CommitService(repo);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('CAS & Concurrent Commit Enforcement', () => {
    it('applies initial plan at baseRevision 1 and increments to revision 2', async () => {
      const scope = { projectId: 'test-p1', branchId: 'main' };
      const plan = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-init',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">Init</div>; }`,
          },
        ],
      });

      const receipt = await repo.applyPlan(plan);
      expect(receipt.revision).toBe(2);
      expect(receipt.operationId).toBe('op-init');

      const snapshot = await repo.getSnapshot(scope);
      expect(snapshot?.revision).toBe(2);
      expect(snapshot?.files.get('app/page.tsx')).toContain('Init');
    });

    it('rejects concurrent commits based on the same base revision', async () => {
      const scope = { projectId: 'test-concurrency', branchId: 'main' };

      // Initialize project at revision 7
      const initPlan = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-setup',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">Rev7</div>; }`,
          },
        ],
      });
      await repo.applyPlan(initPlan); // Revision is now 2
      const previousHash = createHash('sha256').update(initPlan.changes[0].content!).digest('hex');

      // Two concurrent plans based on revision 2
      const planA = createPlan({
        scope,
        baseRevision: 2,
        operationId: 'op-concurrent-A',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: previousHash,
            content: `export default function Page() { return <div data-id="root">From A</div>; }`,
          },
        ],
      });

      const planB = createPlan({
        scope,
        baseRevision: 2,
        operationId: 'op-concurrent-B',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: previousHash,
            content: `export default function Page() { return <div data-id="root">From B</div>; }`,
          },
        ],
      });

      // Commit through service to test serialized CAS
      const [resA, resB] = await Promise.all([service.commit(planA), service.commit(planB)]);

      // Exactly one should succeed with committed status, the other must fail with REVISION_CONFLICT
      const successes = [resA, resB].filter((r) => r.ok);
      const conflicts = [resA, resB].filter((r) => !r.ok && r.error?.code === 'REVISION_CONFLICT');

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(successes[0].meta.revision).toBe(3);
    });

    it('stale plan write is refused without modifying project files', async () => {
      const scope = { projectId: 'test-stale', branchId: 'main' };
      const plan1 = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-1',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">First</div>; }`,
          },
        ],
      });
      await repo.applyPlan(plan1); // revision 2

      const stalePlan = createPlan({
        scope,
        baseRevision: 1, // stale
        operationId: 'op-stale',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">Clobber Attempt</div>; }`,
          },
        ],
      });

      const result = await service.commit(stalePlan);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('REVISION_CONFLICT');

      // Check that content was NOT overwritten
      const snapshot = await repo.getSnapshot(scope);
      expect(snapshot?.revision).toBe(2);
      expect(snapshot?.files.get('app/page.tsx')).toContain('First');
    });
  });

  describe('Idempotency & Operation Recovery', () => {
    it('returns the same receipt when re-applying identical operationId and planHash', async () => {
      const scope = { projectId: 'test-idempotent', branchId: 'main' };
      const plan = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-repeat',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">Repeatable</div>; }`,
          },
        ],
      });

      const receipt1 = await repo.applyPlan(plan);
      const receipt2 = await repo.applyPlan(plan);

      expect(receipt1.revision).toBe(receipt2.revision);
      expect(receipt1.planHash).toBe(receipt2.planHash);
      expect(receipt1.operationId).toBe(receipt2.operationId);

      // Verify status query returns the exact receipt
      const queried = await service.status('test-idempotent', 'op-repeat');
      expect(queried).toEqual(receipt1);
    });

    it('rejects duplicate operationId with different planHash', async () => {
      const scope = { projectId: 'test-conflict-id', branchId: 'main' };
      const plan1 = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-reuse',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">First Content</div>; }`,
          },
        ],
      });
      await repo.applyPlan(plan1);

      const plan2 = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-reuse', // Reused operationId but different changes!
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">Different Content</div>; }`,
          },
        ],
      });

      await expect(repo.applyPlan(plan2)).rejects.toThrow(ConflictError);
    });
  });

  describe('HTTP Automation API Middleware', () => {
    it('serves snapshot, validates plan, and commits with CAS via HTTP', async () => {
      const middleware = createAutomationMiddleware({ repository: repo, commitService: service });

      // 1. Initialize project
      const scope = { projectId: 'test-http', branchId: 'main' };
      const plan = createPlan({
        scope,
        baseRevision: 1,
        operationId: 'op-http-init',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div data-id="root">Hello HTTP</div>; }`,
          },
        ],
      });
      await repo.applyPlan(plan); // rev 2
      const previousHash = createHash('sha256').update(plan.changes[0].content!).digest('hex');

      // 2. GET /api/automation/snapshot
      const { req: snapReq, res: snapRes } = createMockReqRes({
        method: 'GET',
        url: '/api/automation/snapshot?projectId=test-http&branchId=main',
      });
      await middleware(snapReq, snapRes, () => {});
      expect(snapRes.statusCode).toBe(200);
      const snapJson = JSON.parse(snapRes.writtenData.join(''));
      expect(snapJson.ok).toBe(true);
      expect(snapJson.snapshot.revision).toBe(2);

      // 3. POST /api/automation/commit
      const nextPlan = createPlan({
        scope,
        baseRevision: 2,
        operationId: 'op-http-commit',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: previousHash,
            content: `export default function Page() { return <div data-id="root">Hello Next HTTP</div>; }`,
          },
        ],
      });

      const { req: commitReq, res: commitRes, bodyData } = createMockReqRes({
        method: 'POST',
        url: '/api/automation/commit',
        body: nextPlan,
      });

      const endPromise = new Promise<void>((resolve) => {
        const origEnd = commitRes.end;
        commitRes.end = function (chunk?: string) {
          origEnd.call(this, chunk);
          resolve();
        };
      });

      middleware(commitReq, commitRes, () => {});
      commitReq.emit('data', Buffer.from(bodyData));
      commitReq.emit('end');
      await endPromise;

      expect(commitRes.statusCode).toBe(200);
      const commitJson = JSON.parse(commitRes.writtenData.join(''));
      expect(commitJson.ok).toBe(true);
      expect(commitJson.data.revision).toBe(3);
    });
  });

  describe('Storage saveProject CAS Integration', () => {
    it('enforces baseRevision check on saveProject and increments revision', () => {
      // 1. Save new project (revision 2)
      const p1 = saveProject('proj-cas', { files: { 'app/page.tsx': 'Init' } }, 'Test CAS', tmpDir);
      expect(p1.revision).toBe(2);

      // 2. Save with matching baseRevision 2 (advances to 3)
      const p2 = saveProject(
        'proj-cas',
        { files: { 'app/page.tsx': 'Updated' } },
        'Test CAS',
        tmpDir,
        undefined,
        undefined,
        2
      );
      expect(p2.revision).toBe(3);

      // 3. Save with stale baseRevision 2 (conflicts)
      expect(() => {
        saveProject(
          'proj-cas',
          { files: { 'app/page.tsx': 'Stale Write' } },
          'Test CAS',
          tmpDir,
          undefined,
          undefined,
          2
        );
      }).toThrow(/REVISION_CONFLICT/);

      // Verify that content remains 'Updated'
      const check = getProject('proj-cas', tmpDir);
      expect(check?.data?.files['app/page.tsx']).toBe('Updated');
    });
  });
});
