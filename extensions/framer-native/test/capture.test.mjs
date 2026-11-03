import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNativeTransfer } from '../capture.mjs';

function adapter({ unresolved = [], revisions = ['a'], missing = [] } = {}) {
  let reads = 0;
  const scopes = new Map([
    ['page', { id: 'page', kind: 'WebPageNode', data: { id: 'page' }, dependencyIds: ['master'], loaded: true }],
    ['master', { id: 'master', kind: 'CanvasComponentNode', data: { id: 'master', variables: [] }, dependencyIds: [], loaded: false }],
  ]);
  return {
    async readContext() { return { projectId: 'project', branchId: 'main', revision: revisions[Math.min(reads++, revisions.length - 1)], editorBuild: 'build', scopeId: 'page', mode: 'page' }; },
    async readScope(id) { return missing.includes(id) ? null : scopes.get(id); },
    async loadScopes(ids) { for (const id of ids) if (!unresolved.includes(id)) scopes.get(id).loaded = true; },
    async readDefinitions(ids) { return ids.map(id => { const n = scopes.get(id); return { id, kind: n.kind, data: structuredClone(n.data) }; }); },
    async readAssets() { return []; },
  };
}

test('captures a page and its actual component definition after loading', async () => {
  const result = await captureNativeTransfer(adapter(), { mode: 'page' }, new AbortController().signal);
  assert.equal(result.complete, true);
  assert.deepEqual(result.definitions.map(x => x.id), ['page', 'master']);
  assert.deepEqual(result.definitions[1].data.variables, []);
});

test('does not succeed with an unresolved component scope', async () => {
  const result = await captureNativeTransfer(adapter({ unresolved: ['master'] }), { mode: 'page' }, new AbortController().signal);
  assert.equal(result.complete, false);
  assert(result.diagnostics.some(x => x.sourceId === 'master'));
});

test('does not silently drop a missing referenced scope', async () => {
  const result = await captureNativeTransfer(adapter({ missing: ['master'] }), { mode: 'page' }, new AbortController().signal);
  assert.equal(result.complete, false);
  assert(result.diagnostics.some(x => x.code === 'SOURCE_DEPENDENCY_MISSING' && x.sourceId === 'master'));
});

test('marks a missing assigned design cursor incomplete while ignoring code component internals', async () => {
  const source = adapter(), read = source.readDefinitions;
  source.readDefinitions = async ids => {
    const definitions = await read(ids);
    definitions[0].data.children = [{ id: 'button', __class: 'FrameNode', customCursorType: 'component', customCursorSmartComponentId: 'missing-cursor', children: [] }, { id: 'placeholder', __class: 'CodeComponentNode', codeComponentIdentifier: 'module:vendor/save/File.tsx:Widget', $control__cursor: { value: { customCursorType: 'component', customCursorSmartComponentId: 'ignored' } }, children: [] }];
    return definitions;
  };
  const result = await captureNativeTransfer(source, { mode: 'project' }, new AbortController().signal);
  assert.equal(result.complete, false);
  assert(result.diagnostics.some(item => item.code === 'SOURCE_DEPENDENCY_MISSING' && item.sourceId === 'missing-cursor'));
  assert(!result.diagnostics.some(item => item.sourceId === 'ignored'));
});

test('does not reject a present cursor or deleted component control', async () => {
  const source = adapter(), read = source.readDefinitions;
  source.readDefinitions = async ids => {
    const definitions = await read(ids);
    definitions[1].data.__class = 'SmartComponentNode';
    definitions[0].data.children = [{ id: 'button', __class: 'FrameNode', customCursorType: 'component', customCursorSmartComponentId: 'cursor', children: [] }, { id: 'instance', __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/master:default', $control__deleted: { value: { customCursorType: 'component', customCursorSmartComponentId: 'old' } }, children: [] }, { id: 'cursor', __class: 'SmartComponentNode', children: [] }];
    return definitions;
  };
  assert.equal((await captureNativeTransfer(source, { mode: 'project' }, new AbortController().signal)).complete, true);
});

test('retries a changing revision and emits only a stable capture', async () => {
  const result = await captureNativeTransfer(adapter({ revisions: ['a', 'b', 'b', 'b'] }), { mode: 'page' }, new AbortController().signal);
  assert.equal(result.context.revision, 'b');
  assert.equal(result.complete, true);
});

test('fails explicitly when the source never settles', async () => {
  const result = await captureNativeTransfer(adapter({ revisions: ['a', 'b', 'c', 'd', 'e', 'f'] }), { mode: 'page' }, new AbortController().signal);
  assert.equal(result.complete, false);
  assert(result.diagnostics.some(x => x.code === 'SOURCE_CHANGED_DURING_CAPTURE'));
});

test('does not turn a canceled capture into a successful bundle', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(captureNativeTransfer(adapter(), { mode: 'page' }, controller.signal), { name: 'AbortError' });
});

test('carries original code source in the same stable capture envelope', async () => {
  const source = adapter();
  source.readCodeFiles = async () => [{ sourceId: 'original', path: 'Original.tsx', moduleId: 'module', saveId: 'save', code: 'export const original = true;' }];
  const result = await captureNativeTransfer(source, { mode: 'page' }, new AbortController().signal);
  assert.equal(result.complete, true);
  assert.equal(result.codeFiles[0].code, 'export const original = true;');
});

test('marks unavailable original source incomplete instead of silently dropping it', async () => {
  const source = adapter();
  source.readCodeFiles = async () => { throw Object.assign(new Error('Source unavailable'), { sourceId: 'original' }); };
  const result = await captureNativeTransfer(source, { mode: 'page' }, new AbortController().signal);
  assert.equal(result.complete, false);
  assert(result.diagnostics.some(d => d.code === 'SOURCE_CODE_UNAVAILABLE' && d.sourceId === 'original'));
});
