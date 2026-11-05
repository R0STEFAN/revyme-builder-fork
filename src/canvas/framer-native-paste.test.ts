import { expect, it } from 'vitest';
import { handleNativeTransferPaste } from './framer-native-paste';
import type { NativeTransfer } from '../code/import/framer-native/types';
import { createPlan } from '../../packages/automation-core/src/plan';
import type { Receipt } from '../../packages/automation-core/src/contracts';

const transfer: NativeTransfer = { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'test', scopeId: 'page', mode: 'page' }, rootIds: ['page'], assets: [], definitions: [{ id: 'page', kind: 'WebPageNode', data: { id: 'page', __class: 'WebPageNode', parentid: 'doc', baseVariantId: 'desktop', children: [{ id: 'desktop', __class: 'FrameNode', width: 1200, widthType: 0, children: [] }] } }, { id: 'doc', kind: 'RootNode', data: { id: 'doc', __class: 'RootNode', homePageNodeId: 'page', children: [] } }] };

it('flushes before snapshot, validates real conversion and recovers a lost commit response once', async () => {
  const order: string[] = [], scope = { projectId: 'destination', branchId: 'main' };
  let receipt: Receipt | undefined, commits = 0;
  const result = await handleNativeTransferPaste(transfer, scope, {
    operationId: () => 'op-one', flush: async () => { order.push('flush'); },
    snapshot: async () => { order.push('snapshot'); return { scope, revision: 2, files: new Map(), config: {} }; },
    assetPayloads: async () => ({}), isCurrent: () => true,
    prepare: async (input, operationId) => { order.push('prepare'); expect(input.files).toHaveLength(2); return createPlan({ scope, baseRevision: 2, operationId, changes: input.files.map(file => ({ path: file.path, content: file.code, beforeHash: null })) }); },
    commit: async plan => { commits++; receipt = { operationId: plan.operationId, projectId: scope.projectId, branchId: 'main', revision: 3, planHash: plan.planHash, changedFiles: plan.changes.map(change => change.path) }; throw new Error('response lost'); },
    status: async () => receipt ?? null,
    apply: async confirmed => { order.push('apply'); expect(confirmed.revision).toBe(3); },
  });
  expect(order).toEqual(['flush', 'snapshot', 'prepare', 'apply']);
  expect(commits).toBe(1);
  expect(result.operationId).toBe('op-one');
});

it('reports a user-approved cursor omission only after the native import is committed', async () => {
  const input = structuredClone(transfer), scope = { projectId: 'destination', branchId: 'main' };
  Object.assign((input.definitions[0].data.children as Record<string, unknown>[])[0], { customCursorType: 'component', customCursorSmartComponentId: 'missing' });
  const result = await handleNativeTransferPaste(input, scope, {
    skipFeatures: { customCursors: true }, operationId: () => 'op-omission', flush: async () => {},
    snapshot: async () => ({ scope, revision: 0, files: new Map(), config: {} }), assetPayloads: async () => ({}), isCurrent: () => true,
    prepare: async (candidate, operationId) => createPlan({ scope, baseRevision: 0, operationId, changes: candidate.files.map(file => ({ path: file.path, content: file.code, beforeHash: null })) }),
    commit: async plan => ({ operationId: plan.operationId, projectId: scope.projectId, branchId: scope.branchId, revision: 1, planHash: plan.planHash, changedFiles: plan.changes.map(change => change.path) }),
    status: async () => null, apply: async () => {},
  });
  expect(result.sourceOmissions).toContainEqual(expect.objectContaining({ code: 'SOURCE_FEATURE_OMITTED', property: 'customCursor' }));
});

it('leaves the destination alone when conversion fails or local context changes', async () => {
  let committed = false;
  const scope = { projectId: 'destination', branchId: 'main' };
  const deps = { operationId: () => 'op-two', flush: async () => {}, snapshot: async () => ({ scope, revision: 2, files: new Map<string, string>(), config: {} }), assetPayloads: async () => ({}), isCurrent: () => false, prepare: async () => { throw new Error('must not prepare'); }, commit: async () => { committed = true; throw new Error('must not commit'); }, status: async () => null, apply: async () => { throw new Error('must not apply'); } };
  await expect(handleNativeTransferPaste(transfer, scope, deps)).rejects.toThrow(/LOCAL_CONTEXT_CHANGED/);
  await expect(handleNativeTransferPaste({ ...transfer, complete: false }, scope, { ...deps, isCurrent: () => true })).rejects.toThrow(/SOURCE_CAPTURE_INCOMPLETE/);
  expect(committed).toBe(false);
  const controller = new AbortController();
  await expect(handleNativeTransferPaste(transfer, scope, { ...deps, signal: controller.signal, isCurrent: () => true, assetPayloads: async () => { controller.abort(); return {}; } })).rejects.toThrow(/abort/i);
  expect(committed).toBe(false);
});

it('retains the committed receipt if new local edits prevent applying the server result', async () => {
  const scope = { projectId: 'destination', branchId: 'main' };
  let current = true, applied = false;
  const error = await handleNativeTransferPaste(transfer, scope, {
    operationId: () => 'op-three', flush: async () => {}, snapshot: async () => ({ scope, revision: 2, files: new Map(), config: {} }), assetPayloads: async () => ({}), isCurrent: () => current,
    prepare: async (input, operationId) => createPlan({ scope, baseRevision: 2, operationId, changes: input.files.map(file => ({ path: file.path, content: file.code, beforeHash: null })) }),
    commit: async plan => { current = false; return { operationId: plan.operationId, projectId: scope.projectId, branchId: scope.branchId, revision: 3, planHash: plan.planHash, changedFiles: plan.changes.map(change => change.path) }; },
    status: async () => null, apply: async () => { applied = true; },
  }).catch(error => error);
  expect(error.message).toContain('IMPORT_COMMITTED_SYNC_PENDING');
  expect(error.receipt.operationId).toBe('op-three');
  expect(applied).toBe(false);
});
