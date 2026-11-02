import { expect, it } from 'vitest';
import ts from 'typescript';
import * as React from 'react';
import { withResponsiveProps } from '@revyme/runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseComponentControlsMeta } from '../../components/controls-parser';
import { checkFile } from '../../oracle/check-file';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import type { NativeTransfer } from './types';
import { emitNativeCodeComponents } from './code-components';
import { emitNativeComponents } from './components';
import { parseJSXToNodes } from '../../parsing/parser';
import { framerImportSubmitOperation } from '../../../../packages/automation-core/src/operations/framer-import';
import { createSnapshot, createOperationContext } from '../../../../packages/automation-core/src/session';

const identifier = 'module:vendor-widget/save-one/Widget.tsx:Widget';
const original = `import * as React from 'react';
import { addPropertyControls, ControlType } from 'framer';
export function Widget({ title = 'Hello', enabled = true, count = 3, ...props }) {
  return <button {...props} style={{ color: 'red', ...props.style }} disabled={!enabled} onClick={props.onClick}>{title}: {count}</button>;
}
addPropertyControls(Widget, {
  title: { type: ControlType.String, title: 'Label', defaultValue: 'Hello' },
  enabled: { type: ControlType.Boolean, title: 'Enabled', defaultValue: true },
  count: { type: ControlType.Number, title: 'Count', defaultValue: 3, min: 0, max: 10, step: 1 },
});`;
function input(code = original): NativeTransfer {
  const node = { id: 'instance', __class: 'CodeComponentNode', codeComponentIdentifier: identifier, children: [], width: 240, height: 80, widthType: 0, heightType: 0 };
  const module = { id: 'vendor-widget', __class: 'ExternalModuleNode', codeComponentIdentifier: identifier, title: 'Vendor Widget', intrinsicWidth: 240, intrinsicHeight: 80, children: [] };
  return { format: 'revyme.framer.native', version: 1, context: { projectId: 'generic', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: node.id, mode: 'selection' }, rootIds: [node.id], definitions: [node, module].map(data => ({ id: data.id, kind: data.__class, data })), assets: [], complete: true, diagnostics: [], codeFiles: [{ sourceId: module.id, moduleId: module.id, saveId: 'save-one', path: 'Widget.tsx', code }] };
}
function emit(value = input()) {
  const graph = buildSourceGraph(value);
  return emitNativeCodeComponents(graph, allocateTargetIdentity(graph, new Set()));
}

it('retains a third-party React component as native editable code with its controls', () => {
  const value = input();
  const before = JSON.stringify(value);
  const result = emit(value);
  expect(result.diagnostics).toEqual([]);
  expect(result.files).toHaveLength(1);
  const file = result.files[0];
  expect(result.components[identifier]).toMatchObject({ path: file.path });
  expect(parseComponentControlsMeta(file.code)?.controls).toEqual({
    title: { type: 'text', label: 'Label', default: 'Hello' },
    enabled: { type: 'toggle', label: 'Enabled', default: true },
    count: { type: 'number', label: 'Count', default: 3, min: 0, max: 10, step: 1 },
  });
  expect(checkFile(file.code, { kind: 'code-component', path: file.path })).toEqual([]);
  expect(JSON.stringify(value)).toBe(before);
  const exports: Record<string, any> = {};
  const js = ts.transpileModule(file.code, { fileName: file.path, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  new Function('exports', 'require', js)(exports, (module: string) => {
    if (module === 'react') return React;
    if (module === '@revyme/runtime') return { withResponsiveProps };
    throw new Error(`Unexpected runtime import ${module}`);
  });
  const clicked = () => 'clicked';
  const element = exports.Widget({ title: 'Preserved', count: 4, enabled: false, style: { color: 'blue' }, onClick: clicked, 'data-id': 'native-instance' });
  expect(element.type).toBe('button');
  expect(element.props.disabled).toBe(true);
  expect(element.props.style.color).toBe('blue');
  expect(element.props.onClick()).toBe('clicked');
  expect(element.props['data-id']).toBe('native-instance');
  expect(element.props.children).toEqual(['Preserved', ': ', 4]);
});

it('also adapts original local code files using the captured module save', () => {
  const value = input();
  const source = value.definitions[1].data;
  source.id = 'codeFile/custom'; source.__class = 'LocalModuleNode';
  delete source.codeComponentIdentifier;
  source.save = { moduleId: 'vendor-widget', saveId: 'save-one', name: 'Widget.tsx', type: 'codeFile', annotations: { default: { framerIntrinsicWidth: 240, framerIntrinsicHeight: 80 } } };
  value.definitions[1] = { id: 'codeFile/custom', kind: 'LocalModuleNode', data: source };
  value.definitions[0].data.codeComponentIdentifier = 'local-module:codeFile/custom:Widget';
  value.codeFiles![0].sourceId = 'codeFile/custom';
  const result = emit(value);
  expect(result.diagnostics).toEqual([]);
  expect(result.components['local-module:codeFile/custom:Widget']).toBeDefined();
});

it('passes the same generated third-party files through the dedicated native submit boundary', async () => {
  const transfer = input(), compiled = emit(transfer);
  const target = { projectId: 'destination', branchId: 'main' };
  const result = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), {
    files: compiled.files,
    sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: transfer.context, rootIds: transfer.rootIds },
    mode: 'create', target, expectedRevision: 0,
  }, createOperationContext());
  expect(result.diagnostics).toEqual([]);
  expect(result.changes.map(change => ({ path: change.path, content: change.content }))).toEqual(compiled.files.map(file => ({ path: file.path, content: file.code })));
});

it('emits strict TypeScript while keeping the original React function body', () => {
  const file = emit().files[0], path = `${process.cwd()}/${file.path}`;
  const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2020, types: ['react'] };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, create) => name === path ? ts.createSourceFile(name, file.code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX) : read(name, version, onError, create);
  const program = ts.createProgram([path], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
});

it('keeps a third-party fragment and defaultProps inside a native host without rewriting its body', () => {
  const source = `import * as React from 'react';
    export function Widget(props) { return <><span>{props.title}</span><span>{props.count}</span></>; }
    Widget.defaultProps = { title: 'Original fallback', count: 7 };`;
  const result = emit(input(source));
  expect(result.diagnostics).toEqual([]);
  const file = result.files[0];
  expect(checkFile(file.code, { kind: 'code-component', path: file.path })).toEqual([]);
  const exports: Record<string, any> = {};
  const js = ts.transpileModule(file.code, { fileName: file.path, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  new Function('exports', 'require', js)(exports, (module: string) => module === 'react' ? React : { withResponsiveProps });
  const html = renderToStaticMarkup(React.createElement(exports.default, { title: undefined, count: 0, 'data-id': 'source-instance', style: { width: '240px' } }));
  expect(html).toContain('Original fallback');
  expect(html).toContain('<span>0</span>');
  expect(html).toContain('data-id="source-instance"');
  expect(html).toContain('width:240px');
});

it('keeps third-party instances inside a native design master with their original props', () => {
  const value = input();
  const instance = value.definitions[0].data;
  instance.parentid = 'base'; instance.$control__title = { type: 'string', value: 'Instance title' };
  const data = { id: 'master', __class: 'SmartComponentNode', baseVariantId: 'base', variables: [], children: [{ id: 'base', __class: 'FrameNode', width: 300, height: 200, widthType: 0, heightType: 0, children: [instance] }] };
  value.definitions.push({ id: data.id, kind: data.__class, data }); value.rootIds = [data.id];
  const graph = buildSourceGraph(value), identity = allocateTargetIdentity(graph, new Set());
  const code = emitNativeCodeComponents(graph, identity);
  const design = emitNativeComponents(graph, identity, { codeComponents: code.components });
  expect(design.diagnostics).toEqual([]);
  expect(design.files).toHaveLength(1);
  const paths = new Set([...code.files, ...design.files].map(file => file.path));
  expect(checkFile(design.files[0].code, { kind: 'component', path: design.files[0].path, projectFiles: paths })).toEqual([]);
  expect(parseJSXToNodes(design.files[0].code).get(identity.instance)?.attrs.title).toBe('Instance title');
});

it.each(['missing', 'stale', 'runtime-api', 'dynamic-control', 'hoc'])('reports %s third-party source without emitting a placeholder', problem => {
  const value = input();
  if (problem === 'missing') value.codeFiles = [];
  if (problem === 'stale') value.codeFiles![0].saveId = 'different-version';
  if (problem === 'runtime-api') value.codeFiles![0].code = original.replace('addPropertyControls, ControlType', 'addPropertyControls, ControlType, useIsStaticRenderer').replace('return <button', 'useIsStaticRenderer(); return <button');
  if (problem === 'dynamic-control') value.codeFiles![0].code = original.replace("title: { type: ControlType.String,", "title: { hidden: props => !props.enabled, type: ControlType.String,");
  if (problem === 'hoc') value.codeFiles![0].code = `export function Widget(Component) { return props => <Component {...props} />; }`;
  const result = emit(value);
  expect(result.files).toEqual([]);
  expect(result.components).toEqual({});
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
