import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { compileNativeTransfer } from './compile';
import { framerImportSubmitOperation } from '../../../../packages/automation-core/src/operations/framer-import';
import { createOperationContext, createSnapshot } from '../../../../packages/automation-core/src/session';
import { updateCanvasConfigInCode } from '../../project/canvas-config';

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

it('allocates fresh identities when the same selection is pasted twice', () => {
  const base = compileNativeTransfer(page(), { existingFiles: new Map(), mode: 'create' });
  const files = new Map(base.files.map(file => [file.path, file.code]));
  const path = 'app/page.client.tsx';
  const target = { existingFiles: files, mode: 'paste' as const, filePath: path, parentNodeId: base.identity.desktop };
  const first = compileNativeTransfer(selection(), target);
  expect(first.diagnostics).toEqual([]);
  files.set(path, first.files[0].code);
  const second = compileNativeTransfer(selection(), target);
  expect(second.diagnostics).toEqual([]);
  expect(second.createdIds).not.toContain(first.identity.selected);
  expect(second.files[0].code.match(/Selected text/g)).toHaveLength(2);
});

it('keeps literal links in selected layers and diagnoses unresolved page links', () => {
  const base = compileNativeTransfer(page(), { existingFiles: new Map(), mode: 'create' });
  const existingFiles = new Map(base.files.map(file => [file.path, file.code]));
  const target = { existingFiles, mode: 'paste' as const, filePath: 'app/page.client.tsx', parentNodeId: base.identity.desktop };
  const linked = selection();
  Object.assign(linked.definitions[0].data, { link: { type: 'url', url: 'https://example.com' }, linkOpenInNewTab: true });
  const result = compileNativeTransfer(linked, target);
  expect(result.diagnostics).toEqual([]);
  expect(result.files[0].code).toContain('href="https://example.com"');
  expect(result.files[0].code).toContain('target="_blank"');
  const pageLink = selection();
  Object.assign(pageLink.definitions[0].data, { link: { type: 'webPage', webPageId: 'other-page' } });
  expect(compileNativeTransfer(pageLink, target).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_LINK_ROUTE_REQUIRED' }));
});

it('fails explicitly for selected interactions and responsive overrides', () => {
  const base = compileNativeTransfer(page(), { existingFiles: new Map(), mode: 'create' });
  const existingFiles = new Map(base.files.map(file => [file.path, file.code]));
  const target = { existingFiles, mode: 'paste' as const, filePath: 'app/page.client.tsx', parentNodeId: base.identity.desktop };
  const linked = selection();
  Object.assign(linked.definitions[0].data, { appearEffectEnabled: true });
  expect(compileNativeTransfer(linked, target).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_BEHAVIOR_ADAPTER_REQUIRED' }));
  const responsive = selection();
  responsive.definitions.push({ id: 'mobile', kind: 'FrameNode', data: { id: 'mobile', __class: 'FrameNode', replicaInfo: { master: 'selected', overrides: { selected: { width: 100 } } } } } as never);
  expect(compileNativeTransfer(responsive, target).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED' }));
});

it('maps a captured selected replica to the matching destination breakpoint', () => {
  const base = compileNativeTransfer(page(), { existingFiles: new Map(), mode: 'create' });
  const files = new Map(base.files.map(file => [file.path, file.code]));
  const path = 'app/page.client.tsx';
  files.set(path, updateCanvasConfigInCode(files.get(path)!, { viewports: [
    { id: 'desktop', label: 'Desktop', width: 1200, isPrimary: true, order: 0, x: 0, y: 0 },
    { id: 'mobile', label: 'Mobile', width: 1199, designWidth: 390, isPrimary: false, order: 1, x: 1320, y: 0 },
  ], positions: { desktop: { x: 0, y: 0 }, mobile: { x: 1320, y: 0 } } }));
  const responsive = selection();
  responsive.definitions.push({ id: 'mobile-state', kind: 'FrameNode', data: { id: 'mobile-state', __class: 'FrameNode', width: 390, replicaInfo: { master: 'selected', overrides: { selected: { width: 100 } } } } } as never);
  const result = compileNativeTransfer(responsive, { existingFiles: files, mode: 'paste', filePath: path, parentNodeId: base.identity.desktop });
  expect(result.diagnostics).toEqual([]);
  expect(result.files[0].code).toContain('max-width: 1199px');
  expect(result.files[0].code).toContain('width: 100px');
  const semantic = structuredClone(responsive);
  const replicaData = semantic.definitions[1].data as unknown as { replicaInfo: { overrides: Record<string, Record<string, unknown>> } };
  Object.assign(replicaData.replicaInfo.overrides.selected, { link: '/contact' });
  expect(compileNativeTransfer(semantic, { existingFiles: files, mode: 'paste', filePath: path, parentNodeId: base.identity.desktop }).diagnostics).toContainEqual(expect.objectContaining({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED', property: 'link' }));
});
