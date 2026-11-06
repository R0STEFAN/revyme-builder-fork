import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { findFirstElementByDataId, parseJSX } from '../../parsing/ast-utils';
import { ensureNamedImport, generate, setTagAttr } from '../../generation/generator-utils';
import { updateVariantStyleInCode } from '../../generation/generator-styles';
import { cursorOptsPropName, serializeInstanceCursorOpts } from '../../generation/cursor-gen';
import { bindSourcePropInCode } from './bindings';
import { nativeComponentName, nativePropName } from './components';
import { sourceStateNames, sourceInstanceStateName } from './interactions';
import { sourceCollectionId } from './cms';
import { sourceRecord, sourceVariables, sourceCssImageVariables } from './source-graph';
import { sourceShowOverlayTarget } from './overlays';
import { sourceStaticLinkValue } from './links';
import type { SourceGraph } from './types';
import type { SourceScene } from './scene';

/** Same imported instances and prop bindings in pages, templates and masters. */
export function applySourceInstances(code: string, scene: Pick<SourceScene, 'jsx' | 'sourceIds' | 'nested' | 'codeInstances' | 'links' | 'slots'>, graph: SourceGraph, identity: Record<string, string>, assets?: Record<string, string>, options: { allowOverlayEvents?: boolean; routes?: Readonly<Record<string, string>>; componentScopeId?: string } = {}): string {
  trace.fn('framer-native.applyInstances', { design: scene.nested.size, code: scene.codeInstances.size });
  let result = code;
  const imported = new Set<string>();
  const imageDomains = new Map<string, Set<string>>();
  const attach = (id: string, name: string, path: string) => {
    const ast = parseJSX(result);
    if (!ast) throw new Error('Native instance host does not parse');
    if (!imported.has(name)) ast.program.body.unshift(t.importDeclaration([t.importDefaultSpecifier(t.identifier(name))], t.stringLiteral(`@/${path.replace(/\.tsx$/, '')}`)));
    imported.add(name);
    findFirstElementByDataId(ast, identity[id], (_path, element) => {
      element.openingElement.name = t.jsxIdentifier(name);
      if (element.closingElement) element.closingElement.name = t.jsxIdentifier(name);
    });
    result = generate(ast).code;
  };
  const assetValue = (value: unknown, id: string, prop: string) => {
    if (typeof value !== 'string' || !value.startsWith('data:framer/asset-reference,')) return value;
    if (!assets?.[value]) throw new Error(`Missing instance asset on ${id}:${prop}`);
    return assets[value];
  };
  for (const [id, masterId] of scene.nested) {
    const name = nativeComponentName(identity, masterId);
    attach(id, name, `components/${name}.tsx`);
    const variables = sourceVariables(graph, masterId);
    for (const [key, control] of Object.entries(graph.nodes.get(id)!.raw)) {
      if (!key.startsWith('$control__')) continue;
      const sourceProp = key.slice(10), value = sourceRecord(control)?.value;
      if (sourceProp === 'variant') {
        const variant = sourceInstanceStateName({ graph, scopeId: masterId }, identity, value);
        result = setTagAttr(result, identity[id], 'initialVariant', JSON.stringify(variant));
        continue;
      }
      const variable = variables.find(variable => variable.id === sourceProp);
      if (!variable) {
        trace.action('framer-native.skipDeletedInstanceProp', { sourceId: id, masterId, prop: sourceProp });
        continue;
      }
      if (variable.type === 'customcursor') {
        if (value != null && value !== '') {
          const cursor = sourceRecord(value), componentId = cursor?.customCursorSmartComponentId;
          if (cursor?.customCursorType !== 'component' || typeof componentId !== 'string' || Object.keys(cursor).some(key => !['customCursorType', 'customCursorSmartComponentId', 'customCursorVariant'].includes(key)) || graph.nodes.get(componentId)?.kind !== 'SmartComponentNode') throw new Error(`Cursor assignment on ${id} requires its native component adapter`);
          const name = nativeComponentName(identity, componentId), prop = nativePropName(identity, masterId, sourceProp);
          const variant = cursor.customCursorVariant == null ? undefined : sourceStateNames({ graph, scopeId: componentId }, identity)[String(cursor.customCursorVariant)];
          if (cursor.customCursorVariant != null && !variant) throw new Error(`Missing cursor variant ${String(cursor.customCursorVariant)} on ${id}`);
          result = ensureNamedImport(result, `@/components/${name}`, [], { ensureDefault: name });
          result = setTagAttr(result, identity[id], prop, `{${name}}`);
          if (variant) result = setTagAttr(result, identity[id], cursorOptsPropName(prop), `{${serializeInstanceCursorOpts({ variant })}}`);
        }
        continue;
      }
      if (variable.type === 'eventhandler') {
        if (sourceShowOverlayTarget(value)) {
          if (!options.allowOverlayEvents) throw new Error(`Source instance overlay event on ${id} requires its native scope adapter`);
          continue;
        }
        const triggerAction = Array.isArray(value) ? value.map(sourceRecord).find(a => a?.actionIdentifier === 'framer/useTriggerEvent') : undefined;
        if (triggerAction) {
          const triggerId = sourceRecord(sourceRecord(triggerAction.controls)?.id)?.value;
          if (typeof triggerId === 'string' && options.componentScopeId) {
            const parentProp = nativePropName(identity, options.componentScopeId, triggerId);
            result = setTagAttr(result, identity[id], nativePropName(identity, masterId, sourceProp), `{${parentProp}}`);
            result = updateVariantStyleInCode(result, identity[id], 'default', { cursor: 'pointer' });
            continue;
          }
        }
      }
      if (variable.type === 'image' && !imageDomains.has(masterId)) imageDomains.set(masterId, sourceCssImageVariables(graph, masterId));
      const cssImage = variable.type === 'image' && imageDomains.get(masterId)!.has(sourceProp);
      let mapped = assetValue(value, id, sourceProp);
      if (variable.type === 'link') mapped = sourceStaticLinkValue(mapped, options.routes);
      if (cssImage && typeof mapped === 'string' && mapped) mapped = `url(${mapped})`;
      result = bindSourcePropInCode(result, identity[id], nativePropName(identity, masterId, sourceProp), mapped, {
        graph, identity, nodeId: id,
        ...(cssImage ? { cssImage: true } : {}),
        ...(variable.type === 'collectionreference' ? { referenceCollectionId: sourceCollectionId(variable.dataIdentifier) } : {}),
      });
    }
  }
  for (const [id, ref] of scene.codeInstances) {
    attach(id, ref.name, ref.path);
    const values = new Map(Object.entries(ref.controls).filter(([, control]) => control.default !== undefined).map(([prop, control]) => [prop, control.default as unknown]));
    for (const [key, control] of Object.entries(graph.nodes.get(id)!.raw)) {
      if (!key.startsWith('$control__')) continue;
      const prop = key.slice(10);
      if (!ref.controls[prop]) throw new Error(`Code component control ${prop} on ${id} has no native adapter`);
      values.set(prop, sourceRecord(control)?.value);
    }
    for (const [prop, value] of values) result = bindSourcePropInCode(result, identity[id], prop, assetValue(value, id, prop), { graph, identity, nodeId: id });
  }
  return result;
}
