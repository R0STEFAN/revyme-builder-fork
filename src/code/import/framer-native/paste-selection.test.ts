import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { compileNativeTransfer } from './compile';
import { framerImportSubmitOperation } from '../../../../packages/automation-core/src/operations/framer-import';
import { createOperationContext, createSnapshot } from '../../../../packages/automation-core/src/session';

function page() {
  return { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'page', mode: 'page' }, rootIds: ['page'], assets: [], definitions: [{ id: 'page', kind: 'WebPageNode', data: { id: 'page', __class: 'WebPageNode', pagePath: '/', baseVariantId: 'desktop', children: [{ id: 'desktop', __class: 'FrameNode', width: 1200, widthType: 0, children: [] }] } }] };
}
function selection() {
  return { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'page', mode: 'selection' }, rootIds: ['selected'], assets: [], definitions: [{ id: 'selected', kind: 'FrameNode', data: { id: 'selected', __class: 'FrameNode', name: 'Selected', width: 200, widthType: 0, height: 100, heightType: 0, children: [{ id: 'label', __class: 'RichTextNode', html: '<p>Selected text</p>', children: [] }] } }] };
}

it('inserts a selected native subtree under the explicit parent and preserves old nodes', async () => {
  const base = compileNativeTransfer(page(), { existingFiles: new Map(), mode: 'create' });
  expect(base.diagnostics).toEqual([]);
  const existingFiles = new Map(base.files.map(file => [file.path, file.code]));
  const parentNodeId = base.identity.desktop;
  const path = 'app/page.client.tsx';
  const source = selection();
  const result = compileNativeTransfer(source, { existingFiles, mode: 'paste', filePath: path, parentNodeId });
  expect(result.diagnostics).toEqual([]);
  expect(result.files).toHaveLength(1);
  expect(result.files[0].code).toContain('Selected text');
  const target = { projectId: 'destination', branchId: 'main', filePath: path, parentNodeId };
  const input = { files: result.files.map(file => ({ ...file, baseHash: createHash('sha256').update(existingFiles.get(file.path)!).digest('hex') })), mode: 'paste' as const, target, expectedRevision: 2, sourceManifest: { format: source.format as 'revyme.framer.native', version: source.version as 1, complete: true as const, context: { ...source.context, mode: 'selection' as const }, rootIds: source.rootIds } };
  const prepared = await framerImportSubmitOperation.execute(createSnapshot(target, 2, Object.fromEntries(existingFiles)), input, createOperationContext());
  expect(prepared.diagnostics).toEqual([]);
  expect(prepared.createdIds).toContain(result.identity.selected);
  expect(prepared.createdIds).toContain(result.identity.label);
  expect(compileNativeTransfer(source, { existingFiles, mode: 'paste', filePath: path, parentNodeId: 'missing' }).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_TARGET_INVALID' }));
});

it('fails explicitly for selected interactions and responsive overrides', () => {
  const base = compileNativeTransfer(page(), { existingFiles: new Map(), mode: 'create' });
  const existingFiles = new Map(base.files.map(file => [file.path, file.code]));
  const target = { existingFiles, mode: 'paste' as const, filePath: 'app/page.client.tsx', parentNodeId: base.identity.desktop };
  const linked = selection();
  Object.assign(linked.definitions[0].data, { link: '/contact' });
  expect(compileNativeTransfer(linked, target).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_BEHAVIOR_ADAPTER_REQUIRED' }));
  const responsive = selection();
  responsive.definitions.push({ id: 'mobile', kind: 'FrameNode', data: { id: 'mobile', __class: 'FrameNode', replicaInfo: { master: 'selected', overrides: { selected: { width: 100 } } } } } as never);
  expect(compileNativeTransfer(responsive, target).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED' }));
});
