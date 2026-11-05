import { afterEach, beforeEach, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAutomationMiddleware } from './api';
import { LocalProjectRepository } from './project-repository';
import { CommitService } from './commit-service';
import { createPlan } from '../../packages/automation-core/src/plan';
import { createOperationContext } from '../../packages/automation-core/src/session';
import { prepareHistory } from '../../packages/automation-core/src/operations/scoped-history';

let dir: string, repo: LocalProjectRepository, commit: CommitService;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framer-prepare-')); repo = new LocalProjectRepository(dir); commit = new CommitService(repo); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function post(body: unknown) {
  const req = new EventEmitter() as any;
  req.method = 'POST'; req.url = '/api/automation/framer/prepare';
  const response: { statusCode: number; body?: any; setHeader: () => void; end: (value?: string) => void } = { statusCode: 200, setHeader: () => {}, end: () => {} };
  const ended = new Promise<void>(resolve => { response.end = value => { response.body = value ? JSON.parse(value) : undefined; resolve(); }; });
  void createAutomationMiddleware({ repository: repo, commitService: commit })(req, response as any, () => { response.statusCode = 404; response.end('{}'); });
  req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
  await ended;
  return response;
}

it('prepares a validated atomic import and one reversible history entry without writing first', async () => {
  const target = { projectId: 'framer-test', branchId: 'main' };
  await repo.applyPlan(createPlan({ scope: target, baseRevision: 1, operationId: 'init', changes: [{ path: 'notes.txt', beforeHash: null, content: 'before' }] }));
  const input = { files: [{ path: 'app/imported/page.client.tsx', code: `'use client'; /** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */ export default function Page(){return <div data-id="root" style={{position:'relative',width:'100%'}}><p data-id="text">Hello</p></div>}` }, { path: 'app/imported/page.tsx', code: "import PageClient from './page.client'; export default function Page(){return <PageClient/>;}" }], mode: 'create', target, expectedRevision: 2, sourceManifest: { format: 'revyme.framer.native', version: 1, complete: true, context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'test', scopeId: 'page', mode: 'page' }, rootIds: ['page'] } };
  const result = await post({ operationId: 'import-one', input });
  if (!result.body.ok) throw new Error(JSON.stringify(result.body));
  expect(result.statusCode).toBe(200);
  expect((await repo.getSnapshot(target))!.files.has('app/imported/page.client.tsx')).toBe(false);
  expect(result.body.data.changes.map((change: any) => change.path)).toContain('_meta/history.json');
  const committed = await commit.commit(result.body.data);
  expect(committed.ok).toBe(true);
  expect(committed.data?.createdIds).toEqual(result.body.data.createdIds);
  const after = (await repo.getSnapshot(target))!;
  expect((await commit.commit(result.body.data)).data?.revision).toBe(after.revision);
  expect((await post({ operationId: 'stale', input })).statusCode).toBe(409);
  const undo = prepareHistory(after, 'undo', createOperationContext());
  expect(undo.changes.filter(change => change.path.startsWith('app/imported/')).every(change => change.content === null)).toBe(true);
  expect(after.files.get('notes.txt')).toBe('before');
  const invalid = await post({ operationId: 'import-bad', input: { ...input, expectedRevision: after.revision, files: [{ path: 'app/bad/page.client.tsx', code: '<div>missing IDs</div>' }] } });
  expect(invalid.statusCode).not.toBe(200);
  expect((await repo.getSnapshot(target))!.files.has('app/bad/page.client.tsx')).toBe(false);
  expect((await commit.commit(createPlan({ scope: target, baseRevision: after.revision, operationId: 'undo-import', changes: undo.changes }))).ok).toBe(true);
  const undone = (await repo.getSnapshot(target))!;
  expect(undone.files.has('app/imported/page.client.tsx')).toBe(false);
  const redo = prepareHistory(undone, 'redo', createOperationContext());
  expect((await commit.commit(createPlan({ scope: target, baseRevision: undone.revision, operationId: 'redo-import', changes: redo.changes }))).ok).toBe(true);
  expect((await repo.getSnapshot(target))!.files.get('app/imported/page.client.tsx')).toContain('Hello');
});
