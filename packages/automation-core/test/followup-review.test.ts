import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AutomationClient } from '../../cli/src/client';
import { startStandaloneServer } from '../../../server/automation/standalone';
import { LocalProjectRepository } from '../../../server/automation/project-repository';
import { CommitService } from '../../../server/automation/commit-service';
import { saveProject, getProject, saveUpload, deleteProject, listUploads, getUploadFilePath } from '../../../server/storage';
import { LocalBackend } from '@/backend/local-backend';
import { resetSaveRevisionForTest } from '@/backend/save-revision';
import { createPlan } from '../src/plan';
import { createSnapshot, createOperationContext } from '../src/session';
import { projectsBackupExportOperation } from '../src/operations/projects';
const scope = { projectId: 'followup-review', branchId: 'main' };
const page = `'use client'; export default function Page(){return <div data-id="root" style={{width:'100%',height:'auto'}}/>;}`;
const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-followup-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'projects'));
  const file = path.join(dir, 'projects', scope.projectId + '.json');
  fs.writeFileSync(file, JSON.stringify({ id:scope.projectId, name:'Review', revision:1,
    data:{format:'revyme-v1',files:{'app/page.client.tsx':page}}, receipts:{} }));
  return { dir, file, repo:new LocalProjectRepository(dir) };
}
afterEach(() => {
  vi.unstubAllGlobals(); resetSaveRevisionForTest(); localStorage.clear();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, {recursive:true, force:true});
});
it('Windows: pages.create must commit through HTTP', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({apiUrl:`http://127.0.0.1:${(server.server.address() as any).port}`});
    const result = await client.execute(scope, 'pages.create', {slug:'about', title:'About'});
    expect(result.ok).toBe(true);
  } finally { await server.close(); }
});
it('duplicates a scoped project durably, including assets and branches, and supports idempotent retry', async () => {
  const f = fixture();
  const upload = saveUpload('clip.mp4', Buffer.from('clip'), f.dir, scope.projectId);
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.files['asset.txt'] = upload.url;
  record.data.settings = { asset: upload.url };
  record.data.branches = { draft: { files: { 'asset.txt': upload.url }, baseSnapshot: { 'asset.txt': upload.url }, parentId: 'main' } };
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const preview = await client.execute(scope, 'projects.duplicate', { targetName: 'Copy', targetProjectId: 'copy-1' }, { dryRun: true });
    expect(preview.ok).toBe(true);
    expect(preview.meta.commitStatus).toBe('not_committed');
    expect(getProject('copy-1', f.dir)).toBeNull();
    const committed = await client.commit(preview.data);
    expect(committed.ok).toBe(true);
    expect(committed.data?.createdIds).toEqual(['copy-1']);
    const duplicate = getProject('copy-1', f.dir)!;
    const copied = listUploads(undefined, f.dir, 'copy-1')[0];
    expect(duplicate.data.files['asset.txt']).toBe(copied.url);
    expect(duplicate.data.settings.asset).toBe(copied.url);
    expect(duplicate.data.branches.draft.baseSnapshot['asset.txt']).toBe(copied.url);
    expect((await client.commit(preview.data)).data).toEqual(committed.data);
    expect(deleteProject(scope.projectId, f.dir)).toBe(true);
    expect(fs.readFileSync(getUploadFilePath(copied.key, f.dir)!)).toEqual(Buffer.from('clip'));
    expect(deleteProject('copy-1', f.dir)).toBe(true);
    expect(await new LocalProjectRepository(f.dir).getReceipt(scope.projectId, preview.data.operationId)).toEqual(committed.data);
  } finally { await server.close(); }
});

it('recovers a duplicate receipt after source receipt persistence fails', async () => {
  const f = fixture();
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const preview = await client.execute(scope, 'projects.duplicate', { targetName: 'Copy', targetProjectId: 'copy-recover' }, { dryRun: true });
    const originalRename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (String(newPath).includes('automation-receipts')) throw new Error('injected receipt write failure');
      return originalRename(oldPath, newPath);
    });
    const result = await client.commit(preview.data);
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(result.meta.commitStatus).toBe('unknown');
    expect(getProject('copy-recover', f.dir)).not.toBeNull();
    const recovered = await new LocalProjectRepository(f.dir).getReceipt(scope.projectId, preview.data.operationId);
    expect(recovered?.createdIds).toEqual(['copy-recover']);
    expect((await client.commit(preview.data)).data).toEqual(recovered);
    expect(deleteProject('copy-recover', f.dir)).toBe(true);
    expect(await new LocalProjectRepository(f.dir).getReceipt(scope.projectId, preview.data.operationId)).toEqual(recovered);
  } finally { vi.restoreAllMocks(); await server.close(); }
});
it('does not overwrite an editor save made after duplicate publication', async () => {
  const f = fixture();
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const preview = await client.execute(scope, 'projects.duplicate', { targetName: 'Copy', targetProjectId: 'copy-concurrent' }, { dryRun: true });
    const link = fs.linkSync.bind(fs);
    const spy = vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      link(from, to);
      saveProject(scope.projectId, { files: { 'editor.txt': 'new content' } }, 'Edited', f.dir, undefined, undefined, 1);
    });
    const result = await client.commit(preview.data);
    spy.mockRestore();
    expect(result.ok).toBe(true);
    expect(getProject(scope.projectId, f.dir)?.data.files['editor.txt']).toBe('new content');
    expect(getProject('copy-concurrent', f.dir)?.data.files['app/page.client.tsx']).toBe(page);
  } finally { vi.restoreAllMocks(); await server.close(); }
});
it('refuses stale duplicate plans and never overwrites an existing target', async () => {
  const f = fixture();
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const preview = await client.execute(scope, 'projects.duplicate', { targetName: 'Copy', targetProjectId: 'reserved' }, { dryRun: true });
    saveProject('reserved', { files: { 'keep.txt': 'original' } }, 'Existing', f.dir);
    const collision = await client.commit(preview.data);
    expect(collision.ok).toBe(false);
    expect(collision.error?.code).toBe('PROJECT_ALREADY_EXISTS');
    expect(getProject('reserved', f.dir)?.data.files['keep.txt']).toBe('original');
    saveProject(scope.projectId, { files: { 'changed.txt': 'newer' } }, 'Review', f.dir, undefined, undefined, 1);
    const stale = await client.commit(preview.data);
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe('REVISION_CONFLICT');
  } finally { await server.close(); }
});
it('recovery reload must not bypass stale-save protection', async () => {
  const f = fixture(); resetSaveRevisionForTest(); localStorage.clear();
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body as string);
      try { return new Response(JSON.stringify({success:true, project:saveProject(scope.projectId, body.data, 'Review', f.dir, undefined, undefined, body.baseRevision)})); }
      catch (err:any) { return new Response(JSON.stringify({error:err.message,code:err.code}), {status:409}); }
    }
    return new Response(JSON.stringify(getProject(scope.projectId, f.dir)));
  });
  const backend = new LocalBackend(); const loaded = (await backend.loadProject(scope.projectId))!;
  const plan = createPlan({scope, baseRevision:1, operationId:'agent', changes:[{path:'app/page.client.tsx',beforeHash:null,content:page.replace('/>', '>Agent</div>')}]});
  await f.repo.applyPlan(plan);
  await expect(backend.saveProject(scope.projectId, loaded)).rejects.toThrow('REVISION_CONFLICT');
  resetSaveRevisionForTest();
  const recovered = (await backend.loadProject(scope.projectId))!;
  let rejected = false;
  try { await backend.saveProject(scope.projectId, recovered); } catch { rejected = true; }
  expect(rejected).toBe(true);
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toContain('Agent');
});
it('workflow.chain must persist successful steps', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({apiUrl:`http://127.0.0.1:${(server.server.address() as any).port}`});
    const result = await client.execute(scope, 'workflow.chain', {steps:[{tool:'styles.set',input:{filePath:'app/page.client.tsx',nodeId:'root',styles:{backgroundColor:'red'}}}, {tool:'meta.index',input:{}}]});
    expect(result.ok).toBe(true);
    expect(result.meta.commitStatus).toBe('committed');
    expect(result.meta.revision).toBe(2);
    expect(JSON.parse(fs.readFileSync(f.file,'utf8')).revision).toBe(2);
  } finally { await server.close(); }
});
it('records committed changes for durable scoped undo and redo', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const result = await client.execute(scope, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'red' } });
    expect(result.ok).toBe(true);
    const changed = JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx'];
    expect(changed).toContain('red');
    expect((await client.execute(scope, 'history.undo', {})).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toBe(page);
    expect((await client.execute(scope, 'history.redo', {})).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toBe(changed);
  } finally { await server.close(); }
});
it('dry-run must validate source like commit', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({apiUrl:`http://127.0.0.1:${(server.server.address() as any).port}`});
    const input = {filePath:'app/page.client.tsx',nodeId:'root',styles:{padding:'1.5rem'}};
    const dry = await client.execute(scope,'styles.set',input,{dryRun:true});
    const committed = await client.execute(scope,'styles.set',input);
    expect(dry.ok).toBe(committed.ok);
  } finally { await server.close(); }
});
it('commit must reject altered plan bytes with an old hash', async () => {
  const f = fixture(); const plan = createPlan({scope,baseRevision:1,operationId:'tamper',changes:[{path:'notes.txt',beforeHash:null,content:'reviewed'}]});
  plan.changes[0].content = 'changed after review';
  const result = await new CommitService(f.repo).commit(plan);
  expect(result.ok).toBe(false);
});
it('commit rejects a plan whose validation issues were removed after preparation', async () => {
  const f = fixture();
  const plan = createPlan({ scope, baseRevision: 1, operationId: 'tamper-issues', changes: [],
    issues: [{ code: 'BLOCKED', path: [], message: 'Cannot safely prepare this change' }] });
  plan.issues = [];
  const result = await new CommitService(f.repo).commit(plan);
  expect(result.error?.code).toBe('PLAN_HASH_MISMATCH');
});
it('rejects a plan claiming an existing file is absent', async () => {
  const f = fixture();
  const plan = createPlan({ scope, baseRevision: 1, operationId: 'blind-overwrite',
    changes: [{ path: 'app/page.client.tsx', beforeHash: null, content: page }] });
  const result = await new CommitService(f.repo).commit(plan);
  expect(result.ok).toBe(false);
  expect(result.error?.issues.some(issue => issue.code === 'BEFORE_HASH_MISMATCH')).toBe(true);
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(1);
});
it('does not substitute main when a requested branch does not exist', async () => {
  const f = fixture();
  expect(await f.repo.getSnapshot({ ...scope, branchId: 'missing' })).toBeNull();
});
it('work branch snapshots and commits use shared main metadata', async () => {
  const f = fixture();
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.files['_meta/settings.json'] = 'main metadata';
  record.data.branches = { feature: { files: { 'app/page.client.tsx': page, '_meta/settings.json': 'stale' }, baseSnapshot: { 'app/page.client.tsx': page }, status: 'clean' } };
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const branchScope = { ...scope, branchId: 'feature' };
    const snapshot = await client.getSnapshot(branchScope);
    expect(snapshot.data?.files.get('_meta/settings.json')).toBe('main metadata');
    const result = await client.execute(branchScope, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'red' } });
    expect(result.ok).toBe(true);
    const saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(saved.data.files['_meta/history.json']).toBeDefined();
    expect(saved.data.branches.feature.files['_meta/history.json']).toBeUndefined();
    expect(saved.data.branches.feature.files['app/page.client.tsx']).toContain('red');
    expect(saved.data.files['app/page.client.tsx']).toBe(page);
    expect(saved.data.branches.feature.status).toBe('dirty');
    // Identical content on main must not let another branch's history undo it.
    const branchContent = saved.data.branches.feature.files['app/page.client.tsx'];
    const mainPlan = createPlan({ scope, baseRevision: saved.revision, operationId: 'copy-to-main',
      changes: [{ path: 'app/page.client.tsx', beforeHash: createHash('sha256').update(page).digest('hex'), content: branchContent }] });
    expect((await client.commit(mainPlan)).ok).toBe(true);
    const wrongBranch = await client.execute(scope, 'history.undo', {});
    expect(wrongBranch.ok).toBe(false);
    expect(wrongBranch.error?.message).toMatch(/belongs to branch/);
    expect((await client.execute(branchScope, 'history.undo', {})).ok).toBe(true);
    const undone = JSON.parse(fs.readFileSync(f.file, 'utf8')).data.branches.feature;
    expect(undone.files['app/page.client.tsx']).toBe(page);
    expect(undone.status).toBe('clean');
  } finally { await server.close(); }
});
it('rejects unsafe or duplicate paths in externally supplied plans', async () => {
  const f = fixture();
  const service = new CommitService(f.repo);
  for (const [operationId, changes] of [
    ['unsafe-path', [{ path: '../outside.ts', beforeHash: null, content: 'export {}' }]],
    ['duplicate-path', [{ path: 'new.txt', beforeHash: null, content: 'one' }, { path: 'new.txt', beforeHash: null, content: 'two' }]],
  ] as const) {
    const result = await service.commit(createPlan({ scope, baseRevision: 1, operationId, changes: [...changes] }));
    expect(result.ok).toBe(false);
  }
});
it('reads branch metadata from the requested project envelope', async () => {
  const f = fixture();
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.activeBranchId = 'feature';
  record.data.branches = { feature: { files: { 'note.txt': 'new' }, baseSnapshot: { 'note.txt': 'old' }, status: 'editing', parentId: 'main' } };
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const list = await client.execute(scope, 'branches.list', {});
    expect(list.ok).toBe(true);
    expect((list.data as any).active).toBe('feature');
    expect((list.data as any).branches.find((b: any) => b.id === 'feature').changedFiles).toBe(1);
    const review = await client.execute(scope, 'branches.review', { branch: 'feature' });
    expect(review.ok).toBe(true);
    expect((review.data as any).files[0].path).toBe('note.txt');
  } finally { await server.close(); }
});
it('deleting a referenced module must fail final dependency validation', async () => {
  const f = fixture(); const record=JSON.parse(fs.readFileSync(f.file,'utf8'));
  record.data.files['lib/a.ts'] = "import { b } from './b'; export const a = b;";
  record.data.files['lib/b.ts'] = 'export const b = 1;';
  fs.writeFileSync(f.file,JSON.stringify(record));
  const plan=createPlan({scope,baseRevision:1,operationId:'delete-dependency',changes:[{path:'lib/b.ts',beforeHash:null,content:null}]});
  const result=await new CommitService(f.repo).commit(plan);
  expect(result.ok).toBe(false);
});
it('project backups must not retain another project source', async () => {
  const context = createOperationContext();
  await projectsBackupExportOperation.execute(createSnapshot({projectId:'project-a',branchId:'main'},1,{'only-a.txt':'private A','common.txt':'A'}),{},context);
  const result = await projectsBackupExportOperation.execute(createSnapshot({projectId:'project-b',branchId:'main'},1,{'only-b.txt':'B','common.txt':'B'}),{},context);
  const files = JSON.parse(result.backupPayload).files;
  expect(files['only-a.txt']).toBeUndefined();
  expect(files['common.txt']).toBe('B');
});

it('chain preserves earlier receipts and stops when a later step fails', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const result = await client.execute(scope, 'workflow.chain', { steps: [
      { tool: 'styles.set', input: { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'red' } } },
      { tool: 'styles.set', input: { filePath: 'missing.tsx', nodeId: 'root', styles: { backgroundColor: 'blue' } } },
      { tool: 'pages.create', input: { slug: 'never', title: 'Never' } },
    ] });
    expect(result.ok).toBe(false);
    expect(result.data.completed).toBe(1);
    expect(result.data.receipts[0].result.meta.receipt.revision).toBe(2);
    expect(result.meta.commitStatus).toBe('committed');
    const disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(disk.revision).toBe(2);
    expect(disk.data.files['app/never/page.client.tsx']).toBeUndefined();
  } finally { await server.close(); }
});

it('normalizes a known unit context and commits the exact dry-run bytes', async () => {
  const f = fixture();
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.settings = { unitContext: { rootFontSize: 20 } };
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const result = await client.execute(scope, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { padding: '1.5rem' } }, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.data.normalizations[0].after).toBe('30px');
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(1);
    const commitDryRun = await client.execute(scope, 'plans.commit', { plan: result.data }, { dryRun: true });
    expect(commitDryRun.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(1);
    const committed = await client.commit(result.data);
    expect(committed.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toBe(result.data.changes[0].content);
    const status = await client.getStatus(scope, result.data.operationId);
    expect(status.data?.receipt?.planHash).toBe(result.data.planHash);
  } finally { await server.close(); }
});

it('hash identity is checked before the idempotent receipt lookup', async () => {
  const f = fixture();
  const service = new CommitService(f.repo);
  const plan = createPlan({ scope, baseRevision: 1, operationId: 'retry-hash', changes: [{ path: 'note.txt', beforeHash: null, content: 'original' }] });
  expect((await service.commit(plan)).ok).toBe(true);
  plan.changes[0].content = 'changed';
  expect((await service.commit(plan)).error?.code).toBe('PLAN_HASH_MISMATCH');
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['note.txt']).toBe('original');
});

it('rejects malformed plans and missing revisions on existing project writes', async () => {
  const f = fixture();
  const result = await new CommitService(f.repo).commit({} as any);
  expect(result.error?.code).toBe('INVALID_PLAN');
  expect(() => saveProject(scope.projectId, { files: { 'note.txt': 'blind' } }, 'Review', f.dir)).toThrow('REVISION_CONFLICT');
  expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(1);
});

it('exports main and work branch contents from the scoped server envelope', async () => {
  const f = fixture();
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.branches = { feature: { files: { 'feature.txt': 'feature' } } };
  record.data.activeBranchId = 'feature';
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const result = await client.execute({ ...scope, branchId: 'feature' }, 'projects.backup.export', {});
    expect(result.ok).toBe(true);
    const backup = JSON.parse(result.data.backupPayload);
    expect(backup.files['app/page.client.tsx']).toBe(page);
    expect(backup.branches.feature.files['feature.txt']).toBe('feature');
    expect(backup.activeBranchId).toBe('feature');
  } finally { await server.close(); }
});

it('restores a compressed backup and its branches in one durable commit', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    expect((await client.execute(scope, 'branches.create', { name: 'feature' })).ok).toBe(true);
    const backup = await client.execute(scope, 'projects.backup.export', { compress: true });
    expect(backup.ok).toBe(true);
    expect(backup.data.compressed).toBe(true);
    const uncompressed = await client.execute(scope, 'projects.backup.export', {});
    const tampered = JSON.parse(uncompressed.data.backupPayload);
    tampered.branches.feature.files['injected.txt'] = 'unexpected';
    const rejected = await client.execute(scope, 'projects.backup.restore', { backupPayload: JSON.stringify(tampered) });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.message).toMatch(/CHECKSUM_MISMATCH/);
    const feature = { ...scope, branchId: 'feature' };
    expect((await client.execute(feature, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'red' } })).ok).toBe(true);
    expect((await client.execute(scope, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'blue' } })).ok).toBe(true);
    const preview = await client.execute(scope, 'projects.backup.restore', { backupPayload: backup.data.backupPayload }, { dryRun: true });
    expect(preview.ok).toBe(true);
    const before = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(before.data.files['app/page.client.tsx']).toContain('blue');
    expect((await client.commit(preview.data)).ok).toBe(true);
    const after = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.files['app/page.client.tsx']).toBe(page);
    expect(after.data.branches.feature.files['app/page.client.tsx']).toBe(page);
    expect(after.data.activeBranchId).toBe('feature');
  } finally { await server.close(); }
});

it('refuses damaged, invalid or stale backups without modifying project files', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const backup = await client.execute(scope, 'projects.backup.export', {});
    const payload = JSON.parse(backup.data.backupPayload);
    payload.files['notes.txt'] = 'tampered';
    const damaged = await client.execute(scope, 'projects.backup.restore', { backupPayload: JSON.stringify(payload) });
    expect(damaged.ok).toBe(false);
    expect(damaged.error?.message).toMatch(/CHECKSUM_MISMATCH/);
    const invalid = { files: { 'bad.txt': 'safe' }, branches: { feature: { files: { '../bad': 'invalid' }, baseSnapshot: {} } } };
    expect((await client.execute(scope, 'projects.backup.restore', { backupPayload: JSON.stringify(invalid) })).ok).toBe(false);
    const preview = await client.execute(scope, 'projects.backup.restore', { backupPayload: backup.data.backupPayload }, { dryRun: true });
    expect(preview.ok).toBe(true);
    expect((await client.execute(scope, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'red' } })).ok).toBe(true);
    const before = fs.readFileSync(f.file, 'utf8');
    const stale = await client.commit(preview.data);
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe('REVISION_CONFLICT');
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
  } finally { await server.close(); }
});

it('can preserve existing branches and files omitted from a backup', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    expect((await client.execute(scope, 'branches.create', { name: 'feature' })).ok).toBe(true);
    const payload = JSON.stringify({ files: { 'note.txt': 'restored' } });
    const result = await client.execute(scope, 'projects.backup.restore', { backupPayload: payload, restoreBranches: false, cleanOrphanFiles: false });
    expect(result.ok).toBe(true);
    const data = JSON.parse(fs.readFileSync(f.file, 'utf8')).data;
    expect(data.files['note.txt']).toBe('restored');
    expect(data.files['app/page.client.tsx']).toBe(page);
    expect(data.branches.feature.files['app/page.client.tsx']).toBe(page);
    expect(data.activeBranchId).toBe('feature');
  } finally { await server.close(); }
});

it('creates, switches and deletes branches durably without mixing project state', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const preview = await client.execute(scope, 'branches.create', { name: 'New Branch' }, { dryRun: true });
    expect(preview.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(1);
    const created = await client.commit(preview.data);
    expect(created.ok).toBe(true);
    expect((await client.commit(preview.data)).data).toEqual(created.data);
    let saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(saved.data.activeBranchId).toBe('new-branch');
    expect(saved.data.branches['new-branch'].baseSnapshot['app/page.client.tsx']).toBe(page);
    expect(saved.data.branches['new-branch'].files['app/page.client.tsx']).toBe(page);
    expect(saved.revision).toBe(2);
    const branchScope = { ...scope, branchId: 'new-branch' };
    expect((await client.execute(branchScope, 'branches.switch', { branch: 'main' })).ok).toBe(true);
    expect((await client.execute(scope, 'branches.delete', { branch: 'new-branch' })).ok).toBe(true);
    saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(saved.data.activeBranchId).toBe('main');
    expect(saved.data.branches['new-branch']).toBeUndefined();
    expect(saved.data.files['app/page.client.tsx']).toBe(page);
    expect(saved.revision).toBe(4);
  } finally { await server.close(); }
});

it('previews and atomically applies a branch to main, rebasing it afterwards', async () => {
  const f = fixture(); const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    expect((await client.execute(scope, 'branches.create', { name: 'feature' })).ok).toBe(true);
    const feature = { ...scope, branchId: 'feature' };
    expect((await client.execute(feature, 'styles.set', { filePath: 'app/page.client.tsx', nodeId: 'root', styles: { backgroundColor: 'red' } })).ok).toBe(true);
    const preview = await client.execute(feature, 'branches.apply', {}, { dryRun: true });
    expect(preview.ok).toBe(true);
    expect(preview.data.projectAction.mainChanges[0].content).toContain('red');
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toBe(page);
    const result = await client.commit(preview.data);
    expect(result.ok).toBe(true);
    const data = JSON.parse(fs.readFileSync(f.file, 'utf8')).data;
    expect(data.files['app/page.client.tsx']).toContain('red');
    expect(data.branches.feature.files['app/page.client.tsx']).toBe(data.files['app/page.client.tsx']);
    expect(data.branches.feature.baseSnapshot).toEqual(data.branches.feature.files);
    expect(data.branches.feature.status).toBe('clean');
    expect(data.activeBranchId).toBe('main');
    expect((await client.execute(scope, 'history.undo', {})).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toBe(page);
    expect((await client.execute(scope, 'history.redo', {})).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).data.files['app/page.client.tsx']).toContain('red');
  } finally { await server.close(); }
});

it('refuses a conflicting branch merge without changing either branch', async () => {
  const f = fixture();
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.files['note.txt'] = 'base';
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    expect((await client.execute(scope, 'branches.create', { name: 'feature' })).ok).toBe(true);
    const change = async (branchId: string, revision: number, operationId: string, content: string) => client.commit(createPlan({
      scope: { ...scope, branchId }, baseRevision: revision, operationId,
      changes: [{ path: 'note.txt', beforeHash: createHash('sha256').update('base').digest('hex'), content }],
    }));
    expect((await change('feature', 2, 'feature-change', 'feature')).ok).toBe(true);
    expect((await change('main', 3, 'main-change', 'main')).ok).toBe(true);
    const before = fs.readFileSync(f.file, 'utf8');
    const result = await client.execute({ ...scope, branchId: 'feature' }, 'branches.apply', {});
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/conflict/i);
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
  } finally { await server.close(); }
});

it('undo and redo persist both source and journal and reject stale history', async () => {
  const f = fixture();
  const record = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  record.data.files['note.txt'] = 'after';
  record.data.files['_meta/history.json'] = JSON.stringify({ undoStack: [{ id: 'edit', timestamp: 1, activeFile: 'note.txt', diffs: [{ path: 'note.txt', oldContent: 'before', newContent: 'after' }] }], redoStack: [] });
  fs.writeFileSync(f.file, JSON.stringify(record));
  const server = await startStandaloneServer(0, f.dir);
  try {
    const client = new AutomationClient({ apiUrl: `http://127.0.0.1:${(server.server.address() as any).port}` });
    const undo = await client.execute(scope, 'history.undo', {});
    expect(undo.ok).toBe(true);
    let disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(disk.data.files['note.txt']).toBe('before');
    expect(JSON.parse(disk.data.files['_meta/history.json']).redoStack).toHaveLength(1);
    const redo = await client.execute(scope, 'history.redo', {});
    expect(redo.ok).toBe(true);
    disk = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    expect(disk.data.files['note.txt']).toBe('after');
    expect(disk.revision).toBe(3);
    disk.data.files['note.txt'] = 'outside change';
    fs.writeFileSync(f.file, JSON.stringify(disk));
    const stale = await client.execute(scope, 'history.undo', {});
    expect(stale.ok).toBe(false);
    expect(stale.error?.message).toContain('HISTORY_CONFLICT');
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8')).revision).toBe(3);
  } finally { await server.close(); }
});
