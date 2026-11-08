import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { normalizeBabelTraverse } from '../../parsing/ast-utils';
import { generate, ensureNamedImport } from '../../generation/generator-utils';
import { checkFile } from '../../oracle/check-file';
import { parseComponentControlsMeta, type ComponentControlDef } from '../../components/controls-parser';
import { nativeComponentName } from './components';
import { sourceCodeComponentIdentifiers, sourceCodeExportKey, sourceRecord } from './source-graph';
import type { NativeCompileResult, SourceGraph } from './types';

export interface NativeCodeComponentRef { name: string; path: string; controls: Record<string, ComponentControlDef> }
export interface NativeCodeComponentResult extends NativeCompileResult {
  components: Record<string, NativeCodeComponentRef>;
}
export function emitNativeCodeComponents(graph: SourceGraph, identity: Record<string, string>, options: { skipUnsupported?: boolean } = {}): NativeCodeComponentResult {
  trace.fn('framer-native.emitCodeComponents');
  const result: NativeCodeComponentResult = { files: [], createdIds: [], identity, diagnostics: [...graph.diagnostics], components: {} };
  if (result.diagnostics.length) return result;
  for (const identifier of sourceCodeComponentIdentifiers(graph)) {
    if (/SmoothScroll/i.test(identifier)) {
      trace.action('framer-native.skipNativeSmoothScrollComponent', { identifier });
      continue;
    }
    try {
      const local = /^local-module:(codeFile\/[^:]+):([A-Za-z_$][\w$]*|default)$/.exec(identifier);
      const external = /^module:([^/]+)\/([^/]+)\/([^:]+):([A-Za-z_$][\w$]*|default)$/.exec(identifier);
      const sourceId = local?.[1] ?? external?.[1];
      if (!sourceId) throw new Error('CODE_IDENTIFIER_UNSUPPORTED');
      const node = graph.nodes.get(sourceId);
      const save = sourceRecord(node?.raw.save);
      const moduleId = local ? save?.moduleId : external![1];
      const saveId = local ? save?.saveId : external![2];
      const path = local ? save?.name : external![3];
      const original = graph.transfer.codeFiles?.find(file => file.sourceId === sourceId && file.moduleId === moduleId && file.saveId === saveId && file.path === path);
      if (!original) throw new Error(`CODE_SOURCE_UNAVAILABLE: Original source for ${identifier} was not captured at its pinned save`);
      const name = nativeComponentName(identity, sourceCodeExportKey(identifier));
      const code = convertCodeComponent(original.code, local?.[2] ?? external![4], node?.raw, name);
      const target = `components/${name}.tsx`;
      const violations = checkFile(code, { kind: 'code-component', path: target });
      if (violations.length) throw new Error(`CODE_NATIVE_VALIDATION_FAILED: ${violations.map(item => item.code).join(', ')}`);
      result.files.push({ path: target, code }); result.components[identifier] = { name, path: target, controls: parseComponentControlsMeta(code)!.controls };
    } catch (error) {
      if (options.skipUnsupported) {
        trace.action('framer-native.skipUnsupportedCodeComponent', { identifier });
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      result.diagnostics.push({ code: message.startsWith('CODE_') ? message.split(':')[0] : 'CODE_ADAPTER_UNSUPPORTED', sourceId: identifier, property: 'codeComponentIdentifier', message });
    }
  }
  if (result.diagnostics.length) { result.files = []; result.components = {}; }
  return result;
}

const traverse = normalizeBabelTraverse(_traverse);
function convertCodeComponent(code: string, exportedName: string, module: Record<string, unknown> | undefined, nativeName: string): string {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  let selectedName: string | undefined;
  let selected: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | undefined;
  const controls: Record<string, ComponentControlDef> = Object.create(null);
  let controlsFunction: string | undefined, controlTypes: string | undefined;
  for (const statement of ast.program.body) {
    if (t.isImportDeclaration(statement) && statement.source.value === 'framer') {
      for (const specifier of statement.specifiers) {
        if (!t.isImportSpecifier(specifier) || !t.isIdentifier(specifier.imported)) throw new Error('CODE_DEPENDENCY_UNSUPPORTED: framer namespace');
        if (specifier.imported.name === 'addPropertyControls') controlsFunction = specifier.local.name;
        else if (specifier.imported.name === 'ControlType') controlTypes = specifier.local.name;
        else throw new Error(`CODE_DEPENDENCY_UNSUPPORTED: framer.${specifier.imported.name}`);
      }
    } else if (t.isImportDeclaration(statement) && !['react', 'framer-motion', '@revyme/runtime'].includes(statement.source.value)) throw new Error(`CODE_DEPENDENCY_UNSUPPORTED: ${statement.source.value}`);
    const declaration = t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement) ? statement.declaration : statement;
    const isDefault = t.isExportDefaultDeclaration(statement);
    if (t.isFunctionDeclaration(declaration) && (isDefault && exportedName === 'default' || declaration.id?.name === exportedName)) {
      if (!declaration.id) declaration.id = t.identifier(nativeName);
      selectedName = declaration.id.name; selected = declaration;
    }
    if (t.isVariableDeclaration(declaration)) for (const item of declaration.declarations) {
      if (t.isIdentifier(item.id, { name: exportedName }) && (t.isFunctionExpression(item.init) || t.isArrowFunctionExpression(item.init))) { selectedName = item.id.name; selected = item.init; }
    }
    if (isDefault && t.isIdentifier(declaration) && exportedName === 'default') selectedName = declaration.name;
  }
  if (!selected && selectedName) for (const statement of ast.program.body) {
    if (t.isFunctionDeclaration(statement) && statement.id?.name === selectedName) selected = statement;
    if (t.isVariableDeclaration(statement)) for (const item of statement.declarations) if (t.isIdentifier(item.id, { name: selectedName }) && (t.isFunctionExpression(item.init) || t.isArrowFunctionExpression(item.init))) selected = item.init;
  }
  if (!selected || !selectedName || selected.async || selected.generator) throw new Error(`CODE_COMPONENT_EXPORT_UNSUPPORTED: ${exportedName}`);
  const returns = t.isBlockStatement(selected.body) ? selected.body.body.filter(t.isReturnStatement).map(node => node.argument) : [selected.body];
  if (!returns.length || !returns.every(value => t.isJSXElement(value) || t.isJSXFragment(value))) throw new Error('CODE_COMPONENT_EXPORT_UNSUPPORTED: expected an ordinary React render function, not an override HOC');
  for (const parameter of selected.params) if ((t.isObjectPattern(parameter) || t.isIdentifier(parameter)) && !parameter.typeAnnotation) parameter.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
  traverse(ast, { Program(program) {
    for (const statement of program.get('body')) {
      if (statement.isExpressionStatement()) {
        const value = statement.node.expression;
        if (t.isCallExpression(value) && controlsFunction && t.isIdentifier(value.callee, { name: controlsFunction })) {
          if (value.arguments.length !== 2 || !t.isIdentifier(value.arguments[0])) throw new Error('CODE_CONTROLS_UNSUPPORTED');
          if (value.arguments[0].name === selectedName) Object.assign(controls, convertControls(value.arguments[1], controlTypes));
          statement.remove();
        }
      }
    }
    program.scope.crawl();
    for (const statement of program.get('body')) {
      if (statement.isImportDeclaration() && statement.node.source.value === 'framer') {
        if (statement.node.specifiers.some(specifier => program.scope.getBinding(specifier.local.name)?.referenced)) throw new Error('CODE_DEPENDENCY_UNSUPPORTED: remaining Framer runtime usage');
        statement.remove();
      }
      if (statement.isExportDefaultDeclaration()) {
        const declaration = statement.node.declaration;
        if (t.isFunctionDeclaration(declaration)) statement.replaceWith(declaration);
        else statement.remove();
      }
    }
    if (selectedName === nativeName) {
      const renamed = program.scope.generateUidIdentifier(`${nativeName}Source`).name;
      program.scope.rename(selectedName, renamed); selectedName = renamed;
    } else if (program.scope.hasBinding(nativeName)) throw new Error('CODE_COMPONENT_NAME_CONFLICT');
  } });
  const annotations = sourceRecord(sourceRecord(module?.save)?.annotations);
  const defaults = sourceRecord(annotations?.default);
  const width = Number(module?.intrinsicWidth ?? defaults?.framerIntrinsicWidth ?? /@framerIntrinsicWidth\s+(\d+(?:\.\d+)?)/.exec(code)?.[1]);
  const height = Number(module?.intrinsicHeight ?? defaults?.framerIntrinsicHeight ?? /@framerIntrinsicHeight\s+(\d+(?:\.\d+)?)/.exec(code)?.[1]);
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('CODE_INTRINSIC_SIZE_UNAVAILABLE');
  // Metadata describes this real code component; it never exempts it from Oracle.
  const label = String(module?.title ?? selectedName).replace(/["\n\r]/g, ' ').replace(/\*\//g, '*\\/');
  const header = `"use client";\n/** @label "${label}" */\n/** @defaultWidth ${width} */\n/** @defaultHeight ${height} */\n/** @controls ${JSON.stringify(controls).replace(/\*\//g, '*\\/')} */\n`;
  // Framer gives arbitrary code a frame. Keep the author's DOM/props inside
  // an ordinary native host so layout edits do not overwrite their root styles.
  const host = `
function ${nativeName}({ style, 'data-id': nodeId, 'data-name': nodeName, ...props }: any) {
  const defaults = (${selectedName} as any).defaultProps ?? {};
  const resolved: Record<string, any> = { ...props };
  for (const key of Object.keys(defaults)) if (resolved[key] === undefined) resolved[key] = defaults[key];
  return <div data-id={nodeId} data-name={nodeName} style={{ position: 'relative', ...style }}>
    <${selectedName} {...resolved} style={{ width: '100%', height: '100%' }} />
  </div>;
}
export default withResponsiveProps(${nativeName});
`;
  return ensureNamedImport(`${header}${generate(ast).code}\n${host}`, '@revyme/runtime', ['withResponsiveProps']);
}

function convertControls(value: t.Node | null | undefined, controlTypeName: string | undefined): Record<string, ComponentControlDef> {
  if (!t.isObjectExpression(value) || !controlTypeName) throw new Error('CODE_CONTROLS_UNSUPPORTED');
  const output: Record<string, ComponentControlDef> = Object.create(null);
  const types: Record<string, ComponentControlDef['type']> = { String: 'text', Boolean: 'toggle', Number: 'number', Color: 'color', Enum: 'select', Link: 'text', File: 'upload', Image: 'upload' };
  const literal = (node: t.Node): unknown => {
    if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return node.value;
    if (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument)) return -node.argument.value;
    if (t.isArrayExpression(node)) return node.elements.map(element => { if (!element) throw new Error('CODE_CONTROL_VALUE_UNSUPPORTED'); return literal(element); });
    throw new Error('CODE_CONTROL_VALUE_UNSUPPORTED');
  };
  for (const entry of value.properties) {
    if (!t.isObjectProperty(entry) || entry.computed || !t.isObjectExpression(entry.value)) throw new Error('CODE_CONTROLS_UNSUPPORTED');
    const prop = t.isIdentifier(entry.key) ? entry.key.name : t.isStringLiteral(entry.key) ? entry.key.value : '';
    if (!/^[A-Za-z_$][\w$]*$/.test(prop) || ['__proto__', 'constructor', 'prototype'].includes(prop)) throw new Error('CODE_CONTROL_NAME_UNSUPPORTED');
    const config: Record<string, unknown> = Object.create(null);
    for (const property of entry.value.properties) {
      if (!t.isObjectProperty(property) || property.computed) throw new Error('CODE_CONTROL_VALUE_UNSUPPORTED');
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : '';
      if (key === 'type' && t.isMemberExpression(property.value) && !property.value.computed && t.isIdentifier(property.value.object, { name: controlTypeName }) && t.isIdentifier(property.value.property)) config.type = property.value.property.name;
      else config[key] = literal(property.value);
    }
    const type = types[String(config.type)];
    if (!type) throw new Error(`CODE_CONTROL_TYPE_UNSUPPORTED: ${String(config.type)}`);
    const supported = new Set(['type', 'title', 'defaultValue', 'description', 'min', 'max', 'step', 'unit', 'displayStepper', 'placeholder', 'options', 'optionTitles', 'allowedFileTypes']);
    for (const key of Object.keys(config)) if (!supported.has(key)) throw new Error(`CODE_CONTROL_PROPERTY_UNSUPPORTED: ${key}`);
    const control: ComponentControlDef = { type, label: typeof config.title === 'string' ? config.title : prop };
    for (const key of ['min', 'max', 'step', 'unit', 'displayStepper', 'placeholder', 'description'] as const) if (config[key] !== undefined) Object.assign(control, { [key]: config[key] });
    if (config.defaultValue !== undefined) control.default = config.defaultValue as ComponentControlDef['default'];
    if (config.type === 'Enum') {
      if (!Array.isArray(config.options) || !config.options.every(item => typeof item === 'string') || config.optionTitles !== undefined && (!Array.isArray(config.optionTitles) || config.optionTitles.length !== config.options.length || !config.optionTitles.every(item => typeof item === 'string'))) throw new Error('CODE_CONTROL_OPTIONS_UNSUPPORTED');
      const labels = config.optionTitles as string[] | undefined;
      control.options = config.options.map((value, index) => ({ value, label: labels?.[index] ?? value }));
    }
    if (config.type === 'Image') control.accept = 'image/*';
    if (config.type === 'File' && config.allowedFileTypes !== undefined) {
      if (!Array.isArray(config.allowedFileTypes) || !config.allowedFileTypes.every(item => typeof item === 'string' && /^\.?[A-Za-z0-9]+$/.test(item))) throw new Error('CODE_CONTROL_FILE_TYPES_UNSUPPORTED');
      control.accept = config.allowedFileTypes.map(value => `.${String(value).replace(/^\./, '')}`).join(',');
    }
    output[prop] = control;
  }
  return output;
}
