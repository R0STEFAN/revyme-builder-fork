import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { exportedOverrideFunctions, overrideRenderFunction, validateNativeOverrideSource } from '../../components/code-override-source';
import { generate } from '../../generation/generator-utils';
import { normalizeBabelTraverse } from '../../generation/variant-visibility-gen';
import type { CodeOverrideRef } from '../../generation/code-override-gen';
import { sourceRecord } from './source-graph';
import type { NativeCompileResult, SourceGraph } from './types';

export interface NativeCodeOverrideResult extends NativeCompileResult {
  overrides: Record<string, CodeOverrideRef>;
}

export function emitNativeCodeOverrides(graph: SourceGraph, identity: Record<string, string>): NativeCodeOverrideResult {
  trace.fn('framer-native.emitCodeOverrides', { nodes: graph.reachable.size });
  const result: NativeCodeOverrideResult = { files: [], createdIds: [], identity, diagnostics: [...graph.diagnostics], overrides: {} };
  if (result.diagnostics.length) return result;
  const requested = new Map<string, Set<string>>();
  // Replica tables can contain an active override absent from their master.
  const scan = (value: unknown, sourceId: string): void => {
    if (Array.isArray(value)) { value.forEach(item => scan(item, sourceId)); return; }
    const object = sourceRecord(value);
    if (!object) return;
    if (object.codeOverrideEnabled === true) {
      const identifier = object.codeOverrideIdentifier;
      const match = typeof identifier === 'string' && /^local-module:(codeFile\/[^:]+):([A-Za-z_$][\w$]*)$/.exec(identifier);
      if (!match) result.diagnostics.push({ code: 'CODE_SOURCE_UNAVAILABLE', sourceId, property: 'codeOverrideIdentifier', message: `Original override source unavailable: ${String(identifier)}` });
      else {
        const names = requested.get(match[1]) ?? new Set<string>();
        names.add(match[2]); requested.set(match[1], names);
      }
    }
    for (const [key, item] of Object.entries(object)) if (key !== 'children') scan(item, sourceId);
  };
  for (const id of graph.reachable) scan(graph.nodes.get(id)!.raw, id);
  for (const [sourceId, names] of requested) {
    try {
      const save = sourceRecord(graph.nodes.get(sourceId)?.raw.save);
      const file = graph.transfer.codeFiles?.find(file => file.sourceId === sourceId);
      if (!file) throw new Error('CODE_SOURCE_UNAVAILABLE: original code was not captured');
      if (!save || save.moduleId !== file.moduleId || save.saveId !== file.saveId || save.name !== file.path) throw new Error('CODE_SOURCE_STALE: original code does not match the captured module save');
      if (!identity[sourceId]) throw new Error('CODE_IDENTITY_MISSING');
      const converted = adaptOverrideSource(file.code, names);
      const path = `overrides/${identity[sourceId]}.tsx`;
      result.files.push({ path, code: converted.code });
      for (const [name, nativeName] of converted.names) result.overrides[`local-module:${sourceId}:${name}`] = { file: path, name: nativeName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.diagnostics.push({ code: message.split(':')[0].startsWith('CODE_') ? message.split(':')[0] : 'CODE_ADAPTER_UNSUPPORTED', sourceId, property: 'codeOverrideIdentifier', message });
    }
  }
  if (result.diagnostics.length) { result.files = []; result.overrides = {}; }
  return result;
}

const traverse = normalizeBabelTraverse(_traverse);
const unusedBoilerplate = new Set(['https://framer.com/m/framer/store.js@^1.0.0', 'https://framer.com/m/framer/utils.js@^0.9.0']);

function adaptOverrideSource(code: string, requested: ReadonlySet<string>): { code: string; names: Map<string, string> } {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const names = new Map<string, string>();
  traverse(ast, { Program(program) {
    for (const statement of program.get('body')) {
      if (!statement.isImportDeclaration() || statement.node.source.value === 'react') continue;
      if (!unusedBoilerplate.has(statement.node.source.value) || !statement.node.specifiers.length || statement.node.specifiers.some(spec => program.scope.getBinding(spec.local.name)?.referenced)) {
        throw new Error(`CODE_DEPENDENCY_UNSUPPORTED: ${statement.node.source.value}`);
      }
      statement.remove();
    }
    const exports = exportedOverrideFunctions(ast);
    for (const name of requested) {
      const fn = exports.get(name);
      const render = fn && overrideRenderFunction(fn, ast);
      if (!fn || !render) throw new Error(`CODE_OVERRIDE_HOC_REQUIRED: ${name}`);
      const stem = /^with[A-Z_$]/.test(name) ? name : `with${name[0].toUpperCase()}${name.slice(1)}`;
      let target = stem;
      for (let index = 2; target !== name && program.scope.hasBinding(target); index++) target = `${stem}${index}`;
      names.set(name, target);
      // Original Framer files may rely on implicit any. Make that contract explicit
      // without rewriting the author's handler, prop forwarding or callback order.
      const parameter = fn.params[0] as t.Identifier;
      if (!parameter.typeAnnotation) parameter.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
      for (const parameter of render.params) {
        if ((t.isIdentifier(parameter) || t.isObjectPattern(parameter) || t.isArrayPattern(parameter)) && !parameter.typeAnnotation) parameter.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
      }
      const value = t.isBlockStatement(fn.body) ? fn.body.body.find(t.isReturnStatement)?.argument : fn.body;
      if (t.isCallExpression(value) && !value.typeParameters && !value.typeArguments) value.typeParameters = t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()]);
      if (target !== name) program.scope.rename(name, target);
    }
    for (const statement of program.get('body')) {
      if (!statement.isExportNamedDeclaration()) continue;
      const declaration = statement.node.declaration;
      if (declaration) statement.replaceWith(declaration);
      else statement.remove();
    }
    for (const statement of program.get('body')) {
      const declaration = statement.node;
      const exportedNames = t.isFunctionDeclaration(declaration) && declaration.id ? [declaration.id.name] :
        t.isVariableDeclaration(declaration) ? declaration.declarations.map(item => t.isIdentifier(item.id) ? item.id.name : '') : [];
      const selected = exportedNames.filter(name => [...names.values()].includes(name));
      if (selected.length && selected.length !== exportedNames.length) throw new Error('CODE_EXPORT_GROUP_UNSUPPORTED');
      if (selected.length && t.isDeclaration(declaration)) statement.replaceWith(t.exportNamedDeclaration(declaration));
    }
  } });
  if (!ast.program.directives.some(directive => directive.value.value === 'use client')) ast.program.directives.unshift(t.directive(t.directiveLiteral('use client')));
  const output = generate(ast).code;
  validateNativeOverrideSource(output);
  return { code: output, names };
}
