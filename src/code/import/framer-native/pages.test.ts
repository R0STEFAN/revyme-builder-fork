import { expect, it } from 'vitest';
import type { NativeTransfer } from './types';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { emitNativePages, sourcePageRoute } from './pages';
import { parseJSXToNodes } from '../../parsing/parser';
import { parseCanvasConfig } from '../../project/canvas-config';
import { checkFile } from '../../oracle/check-file';
import { framerImportSubmitOperation } from '../../../../packages/automation-core/src/operations/framer-import';
import { createSnapshot, createOperationContext } from '../../../../packages/automation-core/src/session';
import { nativePropName } from './components';
import { parseTemplateProps } from '../../features/template-props';
import { getTemplateRouteValues } from '../../generation/template-route-parse';
import { parsePropMeta } from '../../components/prop-meta';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { hasMountPresenceMotion } from '../../../editor/tools/AnimationTool/appear-utils';

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
it.each([true, false])('imports on-mount presence with exit enabled %s as editable native motion', exitEnabled => {
  const source = input(), states = source.definitions[0].data.children as Record<string, any>[];
  Object.assign(states[0].children[0], { styleAppearEffectEnabled: true, styleAppearEffectTrigger: 'onMount', styleAppearEffectLocked: false, enterEffectEnabled: true, enterEffectOpacity: 0, enterEffectY: 200, enterEffectTransition: { type: 'tween', duration: 0.8, delay: 0.1 }, exitEffectEnabled: exitEnabled, exitEffectOpacity: 0, exitEffectY: 100, exitEffectTransition: { type: 'tween', duration: 0.4, delay: 0.3 } });
  const { result, identity } = emit(source);
  expect(result.diagnostics).toEqual([]);
  const file = result.files[0], props = parseJSXToNodes(file.code).get(identity.heading)!.motionProps!;
  expect(hasMountPresenceMotion(props)).toBe(true);
  expect(props.initial).toMatchObject({ opacity: '0', y: '200' });
  expect(props.transition).toMatchObject({ duration: '0.8', delay: '0.1' });
  if (exitEnabled) { expect(props.exit).toMatchObject({ y: '100' }); expect(props.exit!.transition).toContain('0.3'); }
  else expect(props.exit!.transition).toContain('0');
  expect(checkFile(file.code, { kind: 'page', path: file.path })).toEqual([]);
});
it('keeps an animated design instance editable inside a native presence frame', () => {
  const source = input(), states = source.definitions[0].data.children as Record<string, any>[];
  Object.assign(states[0].children[0], { __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/card:default', width: 100, widthType: 0, height: 50, heightType: 0, styleAppearEffectEnabled: true, styleAppearEffectTrigger: 'onMount', styleAppearEffectLocked: false, enterEffectEnabled: true, enterEffectOpacity: 0, enterEffectTransition: { type: 'tween', duration: 0.8 }, exitEffectEnabled: true, exitEffectOpacity: 0, exitEffectTransition: { type: 'tween', duration: 0.4 } });
  delete states[0].children[0].html;
  states[1].replicaInfo.overrides.heading = {};
  source.definitions.push({ id: 'card', kind: 'SmartComponentNode', data: { id: 'card', __class: 'SmartComponentNode', baseVariantId: 'card-base', children: [{ id: 'card-base', __class: 'FrameNode', children: [] }] } });
  const { result, identity } = emit(source);
  expect(result.diagnostics).toEqual([]);
  const file = result.files[0], nodes = parseJSXToNodes(file.code);
  expect(hasMountPresenceMotion(nodes.get(identity.heading)?.motionProps)).toBe(true);
  expect(nodes.get(`${identity.heading}-content`)?.parentId).toBe(identity.heading);
  expect(checkFile(file.code, { kind: 'page', path: file.path })).toEqual([]);
});
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
it('preserves static breakpoint visibility through native responsive rules', () => {
  const source = input(), states = source.definitions[0].data.children as Record<string, any>[];
  states[1].replicaInfo.overrides.heading.visible = false;
  const { result, identity } = emit(source);
  expect(result.diagnostics).toEqual([]);
  const client = result.files[0];
  expect(client.code).toContain('display: none');
  expect(parseJSXToNodes(client.code).get(identity.heading)?.textContent).toBe('Привіт');
  expect(checkFile(client.code, { kind: 'page', path: client.path })).toEqual([]);
});
it('imports into a free route instead of overwriting an existing Home, including route groups', () => {
  const { result } = emit(input(), new Set(['app/(main)/page.client.tsx', 'app/(main)/page.tsx']));
  expect(result.diagnostics).toEqual([]);
  expect(result.files.some(file => file.path === 'app/page.client.tsx')).toBe(false);
  expect(result.files[0].path).toMatch(/^app\/framer-[\w-]+\/page\.client\.tsx$/);
});
it('resolves page references to their allocated route after a Home collision', () => {
  const source = input(), states = source.definitions[0].data.children as Record<string, any>[];
  states[0].children[0].link = { type: 'webPage', webPageId: 'home' };
  const { result, identity } = emit(source, new Set(['app/page.client.tsx']));
  expect(result.diagnostics).toEqual([]);
  expect(parseJSXToNodes(result.files[0].code).get(identity.heading)?.attrs.href).toBe(result.routes.home);
  expect(result.routes.home).not.toBe('/');
});
it('blocks unresolved template and CMS semantics instead of exporting a partial page', () => {
  const transfer = input();
  transfer.definitions[0].data.dataIdentifier = 'local-module:collection/missing:default';
  expect(emit(transfer).result.files).toEqual([]);
  expect(emit(transfer).result.diagnostics.length).toBeGreaterThan(0);
});
it('maps a CMS detail route to the native slug segment without accepting arbitrary dynamic routes', () => {
  const transfer = input(), page = transfer.definitions[0].data;
  transfer.definitions[1].data.homePageNodeId = 'other';
  page.pagePath = '/works/:fieldId';
  page.dataIdentifier = 'local-module:collection/works:default';
  transfer.definitions.push({ id: 'works', kind: 'CollectionNode', data: { id: 'works', __class: 'CollectionNode', children: [], variables: [{ id: 'fieldId', type: 'slug' }] } });
  const graph = buildSourceGraph(transfer);
  expect(sourcePageRoute(graph, graph.nodes.get('home')!)).toBe('/works/[slug]');
  delete page.dataIdentifier;
  expect(() => sourcePageRoute(buildSourceGraph(transfer), buildSourceGraph(transfer).nodes.get('home')!)).toThrow(/route.*adapter/i);
  page.dataIdentifier = 'local-module:collection/works:default';
  page.pagePath = '/works/:unknown';
  expect(() => sourcePageRoute(buildSourceGraph(transfer), buildSourceGraph(transfer).nodes.get('home')!)).toThrow(/route.*adapter/i);
  page.pagePath = '/works/:fieldId/nested';
  expect(() => sourcePageRoute(buildSourceGraph(transfer), buildSourceGraph(transfer).nodes.get('home')!)).toThrow(/route.*adapter/i);
});
it('imports a third-party code component as a native page placeholder', async () => {
  const transfer = input(), identifier = 'module:vendor/save/Widget.tsx:Widget';
  const desktop = transfer.definitions[0].data.children as Record<string, unknown>[];
  const instance = { id: 'widget', __class: 'CodeComponentNode', parentid: 'desktop', children: [], codeComponentIdentifier: identifier, width: 200, height: 80, widthType: 0, heightType: 0, $control__title: { value: 'Imported title' } };
  (desktop[0].children as unknown[]).push(instance);
  ((desktop[1] as any).replicaInfo.overrides as Record<string, unknown>).widget = { $control__title: { value: 'Different phone value' } };
  transfer.definitions.push({ id: 'vendor', kind: 'ExternalModuleNode', data: { id: 'vendor', __class: 'ExternalModuleNode', codeComponentIdentifier: identifier, intrinsicWidth: 200, intrinsicHeight: 80, children: [] } });
  transfer.codeFiles = [{ sourceId: 'vendor', moduleId: 'vendor', saveId: 'save', path: 'Widget.tsx', code: "import React from 'react'; import { addPropertyControls, ControlType } from 'framer'; export function Widget({title = ''}) {return <strong>{title}</strong>} addPropertyControls(Widget,{title:{type:ControlType.String,defaultValue:''}});" }];
  const graph = buildSourceGraph(transfer), identity = allocateTargetIdentity(graph, new Set());
  const pages = emitNativePages(graph, identity, { existingPaths: new Set() });
  expect(pages.diagnostics).toEqual([]);
  const node = parseJSXToNodes(pages.files[0].code).get(identity.widget)!;
  expect(node.type).toBe('div');
  expect(node.name).toContain('Заглушка');
  expect(node.styles.width).toBe('200px');
  const target = { projectId: 'destination', branchId: 'main' };
  const result = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: pages.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: transfer.context, rootIds: transfer.rootIds } }, createOperationContext());
  expect(result.diagnostics).toEqual([]);
  expect(result.changes).toHaveLength(2);
});
it('rejects breakpoint changes to source code controls instead of silently keeping the desktop value', () => {
  const transfer = input();
  const states = transfer.definitions[0].data.children as Record<string, any>[];
  states[1].replicaInfo.overrides.heading.$control__title = { value: 'Phone-only value' };
  const result = emit(transfer).result;
  expect(result.files).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('$control__title') }));
});
it.each(['mobile', 'deleted-state'])('resolves a design instance variant %s selected on a smaller viewport', selected => {
  const transfer = input(), states = transfer.definitions[0].data.children as Record<string, any>[];
  states[0].children.push({ id: 'card-instance', __class: 'CodeComponentNode', parentid: 'desktop', codeComponentIdentifier: 'local-module:canvasComponent/card:default', children: [] });
  states[1].replicaInfo.overrides['card-instance'] = { $control__variant: { value: selected } };
  const master = { id: 'card', __class: 'SmartComponentNode', baseVariantId: 'base', children: [{ id: 'base', __class: 'FrameNode', children: [] }, { id: 'mobile', __class: 'FrameNode', children: [], replicaInfo: { master: 'base', overrides: {} } }] };
  transfer.definitions.push({ id: master.id, kind: master.__class, data: master });
  const { result, identity } = emit(transfer);
  expect(result.diagnostics).toEqual([]);
  expect(JSON.parse(parseJSXToNodes(result.files[0].code).get(identity['card-instance'])!.attrs['data-responsive'])['1199'].initialVariant).toBe(selected === 'mobile' ? identity.mobile : 'default');
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

it('retains per-page template variables as native props, route values, visibility and section anchors', async () => {
  const transfer = input();
  transfer.definitions[1].data.layoutTemplateIdentifier = 'local-module:layoutTemplate/navigation:default';
  Object.assign(transfer.definitions[0].data, { $control__show: { value: false }, $control__title: { value: 'Page navigation' }, $control__anchor: { value: { target: 'heading' } } });
  const data = { id: 'navigation', __class: 'LayoutTemplateNode', parentid: 'document', baseVariantId: 'template-desktop', variables: [{ id: 'show', name: 'Show header', type: 'boolean', initialValue: true }, { id: 'title', name: 'Navigation title', type: 'string', initialValue: 'Default title' }, { id: 'anchor', name: 'Scroll section', type: 'scrollsectionref' }], children: [{ id: 'template-desktop', __class: 'FrameNode', parentid: 'navigation', width: 1200, widthType: 0, heightType: 2, children: [{ id: 'template-header', __class: 'RichTextNode', parentid: 'template-desktop', html: '<p>Default title</p>', visible: { type: 'variableReference', providerId: 'navigation', id: 'show' }, textContent: { type: 'variableReference', providerId: 'navigation', id: 'title' }, children: [] }, { id: 'template-slot', __class: 'SlotNode', parentid: 'template-desktop', children: [] }] }] };
  transfer.definitions.push({ id: data.id, kind: data.__class, data });
  const { result, identity } = emit(transfer);
  expect(result.diagnostics).toEqual([]);
  const layout = result.files.find(file => file.path.endsWith('LayoutClient.tsx'))!;
  const page = result.files.find(file => file.path.endsWith('page.client.tsx'))!;
  const show = nativePropName(identity, 'navigation', 'show'), title = nativePropName(identity, 'navigation', 'title'), anchor = nativePropName(identity, 'navigation', 'anchor');
  expect(parseTemplateProps(page.code)).toMatchObject({ [show]: 'false', [title]: 'Page navigation', [anchor]: identity.heading });
  expect(getTemplateRouteValues(layout.code, '/')).toMatchObject({ [show]: false, [title]: 'Page navigation', [anchor]: identity.heading });
  expect(parsePropMeta(layout.code)[show]).toMatchObject({ type: 'toggle', label: 'Show header' });
  expect(parsePropMeta(layout.code)[anchor]?.type).toBe('section');
  expect(layout.code).toContain(`${show} ? "block" : "none"`);
  expect(parseJSXToNodes(page.code).get(identity.heading)?.attrs.id).toBe(identity.heading);
  const executable = ts.transpileModule(layout.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { default?: React.ComponentType<{ children: React.ReactNode }> } = {};
  new Function('exports', 'require', executable)(exports, (name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'next/navigation') return { usePathname: () => '/' };
    throw new Error(`Unexpected template dependency ${name}`);
  });
  const rendered = renderToStaticMarkup(React.createElement(exports.default!, { children: 'Page content' }));
  expect(rendered).toContain('display:none');
  expect(rendered).toContain('Page navigation');
  expect(rendered).toContain('Page content');
  expect(rendered).not.toContain('Default title');
  const target = { projectId: 'destination', branchId: 'main' };
  expect((await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: result.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: transfer.context, rootIds: transfer.rootIds } }, createOperationContext())).diagnostics).toEqual([]);
  data.variables.push({ id: 'link', type: 'link', name: 'Navigation link', initialValue: '' } as any);
  Object.assign(data.children[0].children[0], { link: { type: 'variableReference', providerId: 'navigation', id: 'link' } });
  transfer.definitions[0].data.$control__link = { value: 'https://example.com/work' };
  const linked = emit(transfer);
  expect(linked.result.diagnostics).toEqual([]);
  const linkName = nativePropName(linked.identity, 'navigation', 'link');
  expect(linked.result.files.find(file => file.path.endsWith('LayoutClient.tsx'))!.code).toContain(`href={${linkName}}`);
  expect(parseTemplateProps(linked.result.files.find(file => file.path.endsWith('page.client.tsx'))!.code)[linkName]).toBe('https://example.com/work');
  const relocated = emit(transfer, new Set(['app/page.client.tsx']));
  expect(relocated.result.diagnostics).toEqual([]);
  expect(getTemplateRouteValues(relocated.result.files.find(file => file.path.endsWith('LayoutClient.tsx'))!.code, relocated.result.routes.home)[nativePropName(relocated.identity, 'navigation', 'show')]).toBe(false);
  transfer.definitions[0].data.$control__show = { value: 'false' };
  expect(emit(transfer).result.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Invalid template boolean') }));
});

it('skips missing section targets used only by inactive Scroll Variant metadata', () => {
  const transfer = input();
  transfer.definitions[1].data.layoutTemplateIdentifier = 'local-module:layoutTemplate/navigation:default';
  transfer.definitions[0].data.$control__anchor = { value: { target: 'deleted-section' } };
  const header: Record<string, unknown> = {
    id: 'template-header', __class: 'RichTextNode', html: '<p>Site navigation</p>', children: [],
    appearEffectScrollTargets: [{ id: 'old-target', target: { type: 'variableReference', providerId: 'navigation', id: 'anchor' }, variant: 'deleted-variant' }],
  };
  const data = { id: 'navigation', __class: 'LayoutTemplateNode', baseVariantId: 'template-desktop', variables: [{ id: 'anchor', name: 'Scroll section', type: 'scrollsectionref' }], children: [{ id: 'template-desktop', __class: 'FrameNode', width: 1200, widthType: 0, heightType: 2, children: [header, { id: 'template-slot', __class: 'SlotNode', children: [] }] }] };
  transfer.definitions.push({ id: data.id, kind: data.__class, data });
  const { result, identity } = emit(transfer);
  expect(result.diagnostics).toEqual([]);
  expect(parseJSXToNodes(result.files.find(file => file.path.endsWith('LayoutClient.tsx'))!.code).get(identity['template-header'])?.textContent).toBe('Site navigation');
  expect(parseTemplateProps(result.files.find(file => file.path.endsWith('page.client.tsx'))!.code)).not.toHaveProperty(nativePropName(identity, 'navigation', 'anchor'));
  header.appearEffectEnabled = true;
  expect(emit(transfer).result.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Missing template section target') }));
  delete header.appearEffectEnabled;
  header.link = { type: 'variableReference', providerId: 'navigation', id: 'anchor' };
  expect(emit(transfer).result.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Missing template section target') }));
  delete header.link;
  delete header.appearEffectScrollTargets;
  expect(emit(transfer).result.diagnostics).toEqual([]);
  transfer.definitions[0].data.$control__anchor = { value: { target: 123 } };
  expect(emit(transfer).result.diagnostics.length).toBeGreaterThan(0);
});
