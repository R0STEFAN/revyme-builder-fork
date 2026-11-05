import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/autosave', () => ({ flushSaveNow: async () => {}, setAutosaveHeld: vi.fn(), triggerAutosave: vi.fn() }));
vi.mock('../code/mutation/mutation-queue', async original => ({ ...await original<any>(), flushNow: vi.fn(), hasQueuedMutations: () => false, isMutationQueueProcessing: () => false, syncQueueCode: vi.fn(), setForceRender: vi.fn() }));
vi.mock('../code/project/active-file-store', async original => {
  const mod = await original<any>();
  return { ...mod, switchActiveFile: (_from: string, to: string, setters: any) => setters.setActiveFile(to) };
});
import { getDefaultStore } from 'jotai';
import { projectFS } from '../code/project/project-fs';
import { activeFilePathAtom } from '../code/project/active-file-store';
import { selectedIdsAtom } from '../code/stores/store';
import { setLoadedRevision } from '../backend/save-revision';
import { initHistory, getHistoryState, undo, redo, finishPendingRestore } from '../code/mutation/history';
import { isBranchLocked } from '../code/stores/agent-run-lock-store';
import { pasteNativeTransferInEditor } from './framer-native-editor';
import { createPlan } from '../../packages/automation-core/src/plan';
import { compileNativeTransfer } from '../code/import/framer-native/compile';
import { createHash, webcrypto } from 'node:crypto';

const source = { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'test', scopeId: 'page', mode: 'page' }, rootIds: ['page'], assets: [], definitions: [{ id: 'page', kind: 'WebPageNode', data: { id: 'page', __class: 'WebPageNode', parentid: 'doc', baseVariantId: 'desktop', children: [{ id: 'desktop', __class: 'FrameNode', width: 1200, widthType: 0, children: [] }] } }, { id: 'doc', kind: 'RootNode', data: { id: 'doc', __class: 'RootNode', homePageNodeId: 'page', children: [] } }] };
beforeEach(() => {
  projectFS.loadSnapshot(new Map([['app/page.client.tsx', "'use client';export default function Page(){return <div data-id=\"root\"/>}"]]));
  getDefaultStore().set(activeFilePathAtom, 'app/page.client.tsx');
  setLoadedRevision(7);
  const store = getDefaultStore();
  initHistory('', () => {}, () => store.get(activeFilePathAtom), undefined, { get: () => [], set: () => {}, getNodeIds: () => new Set(['root']), navigateToFile: path => { store.set(activeFilePathAtom, path); return true; } });
});
it('applies the confirmed server files and records one editor undo operation', async () => {
  let files = projectFS.getSnapshot(), revision = 7;
  const before = new Map(files);
  await pasteNativeTransferInEditor(source, async (url, init) => {
    if (String(url).includes('/snapshot')) return Response.json({ ok: true, data: { scope: { projectId: 'local', branchId: 'main' }, revision, files: Object.fromEntries(files), config: {} } });
    const body = JSON.parse(init!.body as string);
    if (String(url).endsWith('/prepare')) return Response.json({ ok: true, data: createPlan({ scope: body.input.target, operationId: body.operationId, baseRevision: 7, changes: body.input.files.map((f: any) => ({ path: f.path, content: f.code, beforeHash: null })) }) });
    for (const change of body.changes) files.set(change.path, change.content);
    revision = 8;
    return Response.json({ ok: true, data: { operationId: body.operationId, projectId: 'local', branchId: 'main', revision, planHash: body.planHash, changedFiles: body.changes.map((c: any) => c.path) } });
  });
  expect(projectFS.getSnapshot().size).toBeGreaterThan(before.size);
  expect(getHistoryState().undoSize).toBe(1);
  const importedPath = getDefaultStore().get(activeFilePathAtom);
  expect(importedPath).not.toBe('app/page.client.tsx');
  expect(undo()).toBe(true); finishPendingRestore();
  expect([...projectFS.getSnapshot()]).toEqual([...before]);
  expect(getDefaultStore().get(activeFilePathAtom)).toBe('app/page.client.tsx');
  expect(redo()).toBe(true); finishPendingRestore();
  expect(getDefaultStore().get(activeFilePathAtom)).toBe(importedPath);
  expect(projectFS.exists(importedPath)).toBe(true);
  expect(isBranchLocked('main')).toBe(false);
});
it('keeps files and history unchanged and releases the branch after rejected source', async () => {
  const before = projectFS.getSnapshot();
  await expect(pasteNativeTransferInEditor({ ...source, complete: false }, async () => Response.json({ ok: true, data: { scope: { projectId: 'local', branchId: 'main' }, revision: 7, files: Object.fromEntries(before), config: {} } }))).rejects.toThrow(/SOURCE_CAPTURE_INCOMPLETE/);
  expect([...projectFS.getSnapshot()]).toEqual([...before]);
  expect(getHistoryState().undoSize).toBe(0);
  expect(isBranchLocked('main')).toBe(false);
});

it('pastes a selected subtree as one undoable edit in the active page', async () => {
  const store = getDefaultStore();
  const base = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(base.diagnostics).toEqual([]);
  const files = new Map(base.files.map(file => [file.path, file.code]));
  projectFS.loadSnapshot(new Map(files));
  const before = new Map(files);
  store.set(activeFilePathAtom, 'app/page.client.tsx');
  store.set(selectedIdsAtom, [base.identity.desktop]);
  setLoadedRevision(7);
  initHistory('', () => {}, () => store.get(activeFilePathAtom), undefined, { get: () => [], set: () => {}, getNodeIds: () => new Set([base.identity.desktop]), navigateToFile: path => { store.set(activeFilePathAtom, path); return true; } });
  const captured = { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'test', scopeId: 'page', mode: 'selection' }, rootIds: ['selected'], assets: [], definitions: [{ id: 'selected', kind: 'FrameNode', data: { id: 'selected', __class: 'FrameNode', width: 200, widthType: 0, height: 100, heightType: 0, children: [{ id: 'label', __class: 'RichTextNode', html: '<p>Inserted selection</p>', children: [] }] } }] };
  const createdId = compileNativeTransfer(captured, { existingFiles: before, mode: 'paste', filePath: 'app/page.client.tsx', parentNodeId: base.identity.desktop }).identity.selected;
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  let revision = 7;
  try {
    await pasteNativeTransferInEditor(captured, async (url, init) => {
      if (String(url).includes('/snapshot')) return Response.json({ ok: true, data: { scope: { projectId: 'local', branchId: 'main' }, revision, files: Object.fromEntries(files), config: {} } });
      const body = JSON.parse(init!.body as string);
      if (String(url).endsWith('/prepare')) {
        expect(body.input.mode).toBe('paste');
        expect(body.input.target.parentNodeId).toBe(base.identity.desktop);
        expect(body.input.files[0].baseHash).toBe(createHash('sha256').update(before.get('app/page.client.tsx')!).digest('hex'));
        return Response.json({ ok: true, data: createPlan({ scope: body.input.target, operationId: body.operationId, baseRevision: 7, changes: body.input.files.map((f: any) => ({ path: f.path, content: f.code, beforeHash: body.input.files[0].baseHash })), createdIds: [createdId] }) });
      }
      for (const change of body.changes) files.set(change.path, change.content);
      revision = 8;
      return Response.json({ ok: true, data: { operationId: body.operationId, projectId: 'local', branchId: 'main', revision, planHash: body.planHash, changedFiles: body.changes.map((change: any) => change.path), createdIds: body.createdIds } });
    });
  } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }); }
  expect(projectFS.readFile('app/page.client.tsx')).toContain('Inserted selection');
  expect(store.get(selectedIdsAtom)).toEqual([createdId]);
  expect(getHistoryState().undoSize).toBe(1);
  expect(undo()).toBe(true); finishPendingRestore();
  expect([...projectFS.getSnapshot()]).toEqual([...before]);
  expect(redo()).toBe(true); finishPendingRestore();
  expect(projectFS.readFile('app/page.client.tsx')).toContain('Inserted selection');
});
