import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AutomationClient } from '../../cli/src/client';
import { startStandaloneServer } from '../../../server/automation/standalone';
import { LocalProjectRepository } from '../../../server/automation/project-repository';
import { CommitService } from '../../../server/automation/commit-service';
import { saveProject, getProject } from '../../../server/storage';
import { LocalBackend } from '@/backend/local-backend';
import { getBaseRevision, resetSaveRevisionForTest } from '@/backend/save-revision';
import { publishDeployOperation } from '../src/operations/publish';
import { createPlan } from '../src/plan';
import { createSnapshot, createOperationContext } from '../src/session';
import { validatePlan } from '../src/validate';
import { catalogPlaceOperation } from '../src/operations/catalog';

const scope = { projectId: 'review-fixture', branchId: 'main' };
const page = `'use client'; export default function Page(){return <div data-id="root" style={{width:'100%',height:'auto'}}/>;}`;
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-review-'));
  fs.mkdirSync(path.join(dir, 'projects'));
  const file = path.join(dir, 'projects', scope.projectId + '.json');
  fs.writeFileSync(file, JSON.stringify({ id:scope.projectId, name:'Review', revision:1,
    data:{format:'revyme-v1',files:{'app/page.client.tsx':page}}, receipts:{} }));
  return { dir, file, repo:new LocalProjectRepository(dir) };
}
function planFor(content: string, operationId='review-op') {
  return createPlan({ scope, baseRevision:1, operationId,
    changes:[{path:'app/page.client.tsx',beforeHash:createHash('sha256').update(page).digest('hex'),content}] });
}

describe('Regression test suite: verified resolution of review findings R1-R10', () => {
  it('real HTTP snapshot is compatible with AutomationClient and execute commits changes', async () => {
    const f = fixture();
    const server = await startStandaloneServer(0, f.dir);
    try {
      const address = server.server.address() as { port: number };
      const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${address.port}` });
      const res = await client.getSnapshot(scope);
      expect(res.ok).toBe(true);
      expect(res.data?.scope.projectId).toBe(scope.projectId);
      expect(res.data?.revision).toBe(1);

      const mutation = await client.execute(scope, 'pages.create', { slug: 'about', title: 'About' });
      expect(mutation.ok).toBe(true);
      expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(2);
    } finally {
      await server.close();
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('same committed plan returns idempotent receipt on retry', async () => {
    const f = fixture();
    try {
      const service = new CommitService(f.repo);
      const plan = planFor(page.replace('/>', '>Saved</div>'));
      const firstCommit = await service.commit(plan);
      expect(firstCommit.ok).toBe(true);

      const retry = await service.commit(plan);
      expect(retry.ok).toBe(true);
      expect(retry.data?.revision).toBe(2);
      expect(retry.data?.planHash).toBe(plan.planHash);
      expect(await service.status(scope.projectId, plan.operationId)).not.toBeNull();
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('failed disk replace does not leave false receipt cached and retry write succeeds', async () => {
    const f = fixture();
    const plan = planFor(page.replace('/>', '>Saved</div>'));
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated disk failure');
    });
    try {
      await expect(f.repo.applyPlan(plan)).rejects.toThrow('simulated disk failure');
      rename.mockRestore();

      expect(await f.repo.getReceipt(scope.projectId, plan.operationId)).toBeNull();

      const retry = await f.repo.applyPlan(plan);
      expect(retry.revision).toBe(2);
      expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(2);
    } finally {
      rename.mockRestore();
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('an ordinary editor save preserves persisted operation receipts', async () => {
    const f = fixture();
    try {
      const plan = planFor(page.replace('/>', '>Saved</div>'));
      await f.repo.applyPlan(plan);
      const persisted = JSON.parse(fs.readFileSync(f.file, 'utf8'));
      saveProject(scope.projectId, persisted.data, 'Review', f.dir, undefined, undefined, 2);

      const receipt = await new LocalProjectRepository(f.dir).getReceipt(scope.projectId, plan.operationId);
      expect(receipt).not.toBeNull();
      expect(receipt?.revision).toBe(2);
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('validator rejects invalid source per Oracle rules', () => {
    const invalid = `'use client'; export default function Page(){return <div data-id="root" style={{width:'100%',height:'auto',padding:'1.5rem'}}/>;}`;
    const snapshot = createSnapshot(scope, 1, { 'app/page.client.tsx': page });
    const result = validatePlan(snapshot, planFor(invalid));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /spacing|pixels|rem/i.test(i.message))).toBe(true);
  });

  it('catalog places a component and installs its source file', async () => {
    const snapshot = createSnapshot(scope, 1, { 'app/page.client.tsx': page });
    const placed = await catalogPlaceOperation.execute(
      snapshot,
      { targetFile: 'app/page.client.tsx', parentId: 'root', itemId: 'cs-marquee' },
      createOperationContext()
    );
    expect(placed.changes.length).toBeGreaterThanOrEqual(2);
    expect(placed.changes[0].content).toContain('@/components/Marquee');

    const compChange = placed.changes.find((c) => c.path === 'components/Marquee.tsx');
    expect(compChange).toBeDefined();
    expect(compChange?.content).toContain('export default withResponsiveProps(Marquee)');

    const changes = placed.changes.map(change => ({ ...change, beforeHash: snapshot.files.has(change.path)
      ? createHash('sha256').update(snapshot.files.get(change.path)!).digest('hex') : null }));
    const plan = createPlan({ scope, baseRevision: 1, operationId: 'review-built-in', changes });
    expect(validatePlan(snapshot, plan).ok).toBe(true);
  });

  it('editor prevents stale save from clobbering an MCP commit', async () => {
    const f = fixture();
    resetSaveRevisionForTest();
    localStorage.clear();
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string);
        try {
          const saved = saveProject(scope.projectId, body.data, body.name, f.dir, undefined, undefined, body.baseRevision);
          return new Response(JSON.stringify({ success: true, project: saved }));
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message, code: err.code }), { status: 409 });
        }
      }
      return new Response(JSON.stringify(getProject(scope.projectId, f.dir)));
    });
    try {
      const backend = new LocalBackend();
      const loaded = (await backend.loadProject(scope.projectId))!;
      expect(getBaseRevision()).toBe(1);

      await f.repo.applyPlan(planFor(page.replace('/>', '>Agent change</div>')));
      await expect(backend.saveProject(scope.projectId, loaded)).rejects.toThrow('REVISION_CONFLICT');

      const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
      expect(disk.data.files['app/page.client.tsx']).toContain('Agent change');
      expect(disk.revision).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      resetSaveRevisionForTest();
      localStorage.clear();
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('editor reload maintains integer server CAS revision without false conflict', async () => {
    const f = fixture();
    resetSaveRevisionForTest();
    localStorage.clear();
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string);
        try {
          const saved = saveProject(scope.projectId, body.data, body.name, f.dir, undefined, undefined, body.baseRevision);
          return new Response(JSON.stringify({ success: true, project: saved }));
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), { status: e.status ?? 500 });
        }
      }
      return new Response(JSON.stringify(getProject(scope.projectId, f.dir)));
    });
    try {
      const backend = new LocalBackend();
      const loaded = (await backend.loadProject(scope.projectId))!;
      await backend.saveProject(scope.projectId, loaded);

      resetSaveRevisionForTest();
      localStorage.clear();
      const reloaded = (await backend.loadProject(scope.projectId))!;
      const base = getBaseRevision();
      expect(base).toBe(2);

      await expect(backend.saveProject(scope.projectId, reloaded)).resolves.not.toThrow();

      const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
      expect(disk.revision).toBe(3);
    } finally {
      vi.unstubAllGlobals();
      resetSaveRevisionForTest();
      localStorage.clear();
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('deploy reports unavailable when no hosting adapter is provided', async () => {
    const snapshot = createSnapshot(scope, 1, { 'app/page.client.tsx': page });
    const fetchSpy = vi.fn(() => {
      throw new Error('unexpected network call');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const result = await publishDeployOperation.execute(
        snapshot,
        { target: 'production', force: true },
        createOperationContext()
      );
      expect(result.status).toBe('unavailable');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('HOSTING_ADAPTER_UNAVAILABLE');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
