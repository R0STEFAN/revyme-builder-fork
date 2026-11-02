import { expect, it } from 'vitest';
import type { NativeTransfer } from './types';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { emitNativePages } from './pages';
import { parseJSXToNodes } from '../../parsing/parser';
import { parseCanvasConfig } from '../../project/canvas-config';
import { checkFile } from '../../oracle/check-file';
import { emitNativeCodeComponents } from './code-components';
import { framerImportSubmitOperation } from '../../../../packages/automation-core/src/operations/framer-import';
import { createSnapshot, createOperationContext } from '../../../../packages/automation-core/src/session';

function input(): NativeTransfer {
  const label = { id: 'heading', __class: 'RichTextNode', parentid: 'desktop', children: [], html: '<h1>Привіт</h1>' };
  const desktop = { id: 'desktop', __class: 'FrameNode', name: 'Desktop', parentid: 'home', children: [label], width: 1200, widthType: 0, heightType: 2, layout: 'stack', stackDirection: 'vertical' };
  const phone = { id: 'phone', __class: 'FrameNode', parentid: 'home', name: 'Phone', children: [], replicaInfo: { master: 'desktop', overrides: { desktop: { width: 390 }, heading: { html: '<h1 style="font-size: 24px">Привіт</h1>' } } } };
  const page = { id: 'home', __class: 'WebPageNode', parentid: 'document', baseVariantId: 'desktop', children: [desktop, phone] };
  const root = { id: 'document', __class: 'RootNode', homePageNodeId: page.id, children: [] };
  return { format: 'revyme.framer.native', version: 1, context: { projectId: 'synthetic', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: page.id, mode: 'page' }, complete: true, diagnostics: [], rootIds: [page.id], definitions: [page, root].map(data => ({ id: data.id, kind: data.__class, data })), assets: [] };
}
function emit(transfer = input(), paths = new Set<string>()) {
  const graph = buildSourceGraph(transfer), identity = allocateTargetIdentity(graph, paths);
  return { result: emitNativePages(graph, identity, { existingPaths: paths }), identity };
}
it('emits a native page pair with one fluid tree and source responsive typography', () => {
  const { result, identity } = emit();
  expect(result.diagnostics).toEqual([]);
  expect(result.files.map(file => file.path)).toEqual(['app/page.client.tsx', 'app/page.tsx']);
  const client = result.files[0];
  const nodes = parseJSXToNodes(client.code);
  expect(nodes.get(identity.desktop)?.styles.width).toBe('100%');
  expect(nodes.get(identity.heading)?.textContent).toBe('Привіт');
  expect(parseCanvasConfig(client.code)?.viewports.map(viewport => [viewport.width, viewport.designWidth ?? viewport.width])).toEqual([[1200, 1200], [1199, 390]]);
  expect(client.code).not.toContain('width: 390px');
  expect(client.code).toContain('font-size: 24px');
  expect(checkFile(client.code, { kind: 'page', path: client.path, projectFiles: new Set(result.files.map(file => file.path)) })).toEqual([]);
});
it('imports into a free route instead of overwriting an existing Home, including route groups', () => {
  const { result } = emit(input(), new Set(['app/(main)/page.client.tsx', 'app/(main)/page.tsx']));
  expect(result.diagnostics).toEqual([]);
  expect(result.files.some(file => file.path === 'app/page.client.tsx')).toBe(false);
  expect(result.files[0].path).toMatch(/^app\/framer-[\w-]+\/page\.client\.tsx$/);
});
it('blocks unresolved template and CMS semantics instead of exporting a partial page', () => {
  const transfer = input();
  transfer.definitions[0].data.dataIdentifier = 'local-module:collection/missing:default';
  expect(emit(transfer).result.files).toEqual([]);
  expect(emit(transfer).result.diagnostics.length).toBeGreaterThan(0);
});
it('retains third-party component instances on pages through the validated native import', async () => {
  const transfer = input(), identifier = 'module:vendor/save/Widget.tsx:Widget';
  const desktop = transfer.definitions[0].data.children as Record<string, unknown>[];
  const instance = { id: 'widget', __class: 'CodeComponentNode', parentid: 'desktop', children: [], codeComponentIdentifier: identifier, width: 200, height: 80, widthType: 0, heightType: 0, $control__title: { value: 'Imported title' } };
  (desktop[0].children as unknown[]).push(instance);
  transfer.definitions.push({ id: 'vendor', kind: 'ExternalModuleNode', data: { id: 'vendor', __class: 'ExternalModuleNode', codeComponentIdentifier: identifier, intrinsicWidth: 200, intrinsicHeight: 80, children: [] } });
  transfer.codeFiles = [{ sourceId: 'vendor', moduleId: 'vendor', saveId: 'save', path: 'Widget.tsx', code: "import React from 'react'; import { addPropertyControls, ControlType } from 'framer'; export function Widget({title = ''}) {return <strong>{title}</strong>} addPropertyControls(Widget,{title:{type:ControlType.String,defaultValue:''}});" }];
  const graph = buildSourceGraph(transfer), identity = allocateTargetIdentity(graph, new Set());
  const components = emitNativeCodeComponents(graph, identity);
  expect(components.diagnostics).toEqual([]);
  const pages = emitNativePages(graph, identity, { existingPaths: new Set(), codeComponents: components.components });
  expect(pages.diagnostics).toEqual([]);
  const node = parseJSXToNodes(pages.files[0].code).get(identity.widget)!;
  expect(node.attrs.title).toBe('Imported title');
  const target = { projectId: 'destination', branchId: 'main' };
  const result = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: [...components.files, ...pages.files], mode: 'create', target, expectedRevision: 0, sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: transfer.context, rootIds: transfer.rootIds } }, createOperationContext());
  expect(result.diagnostics).toEqual([]);
  expect(result.changes).toHaveLength(3);
});
it('rejects breakpoint changes to source code controls instead of silently keeping the desktop value', () => {
  const transfer = input();
  const states = transfer.definitions[0].data.children as Record<string, any>[];
  states[1].replicaInfo.overrides.heading.$control__title = { value: 'Phone-only value' };
  const result = emit(transfer).result;
  expect(result.files).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('$control__title') }));
});
it('preserves an inherited native template, its content slot and page assignment', async () => {
  const transfer = input();
  transfer.definitions[1].data.layoutTemplateIdentifier = 'local-module:layoutTemplate/navigation:default';
  const data = { id: 'navigation', __class: 'LayoutTemplateNode', name: 'Navigation', baseVariantId: 'template-desktop', children: [{ id: 'template-desktop', __class: 'FrameNode', width: 1200, widthType: 0, heightType: 2, layout: 'stack', stackDirection: 'vertical', children: [{ id: 'template-header', __class: 'RichTextNode', html: '<p>Site navigation</p>', children: [] }, { id: 'template-slot', __class: 'SlotNode', children: [] }] }] };
  transfer.definitions.push({ id: data.id, kind: data.__class, data });
  const { result, identity } = emit(transfer);
  expect(result.diagnostics).toEqual([]);
  const clientPath = `app/(${identity.navigation})/LayoutClient.tsx`;
  const files = new Map(result.files.map(file => [file.path, file.code]));
  expect(files.get(clientPath)).toContain('{children}');
  expect(files.has(`app/(${identity.navigation})/page.client.tsx`)).toBe(true);
  expect(parseJSXToNodes(files.get(clientPath)!).get(identity['template-header'])?.textContent).toBe('Site navigation');
  expect(checkFile(files.get(clientPath)!, { kind: 'template', path: clientPath, projectFiles: new Set(files.keys()) })).toEqual([]);
  const target = { projectId: 'destination', branchId: 'main' };
  const imported = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: result.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: transfer.context, rootIds: transfer.rootIds } }, createOperationContext());
  expect(imported.changes).toHaveLength(4);
});
