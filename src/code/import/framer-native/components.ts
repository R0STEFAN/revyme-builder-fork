import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { nodeIdToVarNameCapitalised } from '../../../shared/id-utils';
import { PROJECTION_STYLE_PROPS } from '../../../shared/constants';
import { normalizeTransparent, TRANSPARENT_FILL } from '../../../shared/css-utils';
import { setPropLabelInCode, setPropTypeInCode, setPropReferenceCollectionInCode } from '../../components/prop-meta';
import { buildCreatedMaster } from '../../generation/create-component-gen';
import { findJSXElementByDataId, findClosingTag } from '../../generation/cms-gen';
import { setCodeOverridesInCode, type CodeOverrideRef } from '../../generation/code-override-gen';
import { updateVariantTextInCode } from '../../generation/generator-crud';
import { bindTextVariableForVariantInCode, createConditionalVariableInCode } from '../../features/variable-ops';
import { convertToMotionLinkInCode } from '../../generation/generator-attrs';
import { CSS_NEUTRAL_FALLBACK, setConditionalStyleInCode, updateVariantStyleInCode } from '../../generation/generator-styles';
import { updateVariantEntryTransition } from '../../generation/generator-motion-transition';
import { ensureMotionTag } from '../../generation/generator-motion-scroll';
import { ensureNamedImport, generate, setTagAttr } from '../../generation/generator-utils';
import { findFirstElementByDataId, parseJSX } from '../../parsing/ast-utils';
import { addConnectionToCode, rebuildConnections } from '../../variants/connection-config';
import { forwardEventPropsToComponentRoot } from '../../variants/event-prop-forwarding';
import { parseVariantConfig, serializeVariantConfig, type VariantConfig } from '../../variants/variant-config';
import { sourceStateNames } from './interactions';
import { mapSourceConnections } from './interactions';
import { activeSourceCodeOverride, resolveSourceNode, sourceRecord, sourceVariableKey, sourceVariables } from './source-graph';
import { mapSourceStyles, sourceStyleValue, type SourceMappingContext } from './styles';
import { mapSourceText } from './text';
import { emitSourceScene } from './scene';
import { applySourceInstances } from './scene-instances';
import { nativeCollectionSlug, sourceCollectionId } from './cms';
import { resolveSourceBinding, emitSourceQueryInCode } from './bindings';
import type { NativeCodeComponentRef } from './code-components';
import type { NativeCompileResult, ResolvedSourceNode, SourceGraph, SourceProperties } from './types';

export function nativeComponentName(identity: Record<string, string>, sourceId: string): string {
  if (!identity[sourceId]) throw new Error(`Missing component identity ${sourceId}`);
  return nodeIdToVarNameCapitalised(identity[sourceId]).replace(/_/g, '');
}
export function nativePropName(identity: Record<string, string>, scopeId: string, id: string): string {
  const target = identity[sourceVariableKey(scopeId, id)];
  if (!target) throw new Error(`Missing variable identity ${scopeId}:${id}`);
  return `prop${nodeIdToVarNameCapitalised(target)}`;
}

function valueExpression(value: unknown, node: ResolvedSourceNode, context: SourceMappingContext, property: string, identity?: Record<string, string>): string {
  if (identity && context.graph && sourceRecord(value)?.type === 'variableReference') {
    const binding = resolveSourceBinding(value, { graph: context.graph, identity, nodeId: node.sourceId });
    if (binding.kind === 'field') return `${binding.itemVar}.${binding.fieldId}`;
    if (binding.kind === 'variable') return binding.name;
    throw new Error(`Unsupported expression binding ${binding.kind} on ${node.sourceId}`);
  }
  const mapped = sourceStyleValue(value, node, context, property);
  if (mapped === undefined) throw new Error(`Unresolved ${property} on ${node.sourceId}`);
  const binding = /^\{([A-Za-z_$][\w$]*)\}$/.exec(mapped);
  return binding ? binding[1] : JSON.stringify(mapped);
}
function transitionSpec(value: unknown): Record<string, string> | undefined {
  const transition = sourceRecord(value);
  if (!transition) return;
  if (transition.type === false) return { duration: '0' };
  if (!['tween', 'spring'].includes(String(transition.type))) throw new Error('Unsupported variant transition type');
  const output: Record<string, string> = { type: String(transition.type) };
  const keys = transition.type === 'spring'
    ? transition.durationBasedSpring ? ['duration', 'bounce', 'delay'] : ['stiffness', 'damping', 'mass', 'delay']
    : ['duration', 'delay'];
  for (const key of keys) if (typeof transition[key] === 'number') output[key] = String(transition[key]);
  if (transition.type === 'tween' && transition.ease !== undefined) {
    if (Array.isArray(transition.ease) && transition.ease.length === 4 && transition.ease.every(item => typeof item === 'number' && Number.isFinite(item))) output.ease = JSON.stringify(transition.ease);
    else if (typeof transition.ease === 'string') output.ease = transition.ease;
    else throw new Error('Unsupported variant easing');
  }
  if (typeof transition.stagger === 'number' && transition.stagger !== 0) throw new Error('Source stagger requires the motion emitter');
  return output;
}

/** Build the canonical shell, then use native transforms for states and links. */
export function emitNativeComponents(graph: SourceGraph, identity: Record<string, string>, options: Pick<SourceMappingContext, 'assets'> & { overrides?: Readonly<Record<string, CodeOverrideRef>>; codeComponents?: Readonly<Record<string, NativeCodeComponentRef>>; routes?: Readonly<Record<string, string>> } = {}): NativeCompileResult {
  trace.fn('framer-native.emitNativeComponents', { components: graph.byKind.get('SmartComponentNode')?.length ?? 0 });
  const result: NativeCompileResult = { files: [], createdIds: [], identity, diagnostics: [...graph.diagnostics] };
  if (result.diagnostics.length) return result;
  for (const scopeId of graph.byKind.get('SmartComponentNode') ?? []) {
    if (!graph.reachable.has(scopeId)) continue;
    const componentDiagnostics: NativeCompileResult['diagnostics'] = [];
    try {
      const scope = graph.nodes.get(scopeId)!;
      const model = { graph, scopeId };
      const names = sourceStateNames(model, identity);
      const primaryId = Object.keys(names).find(id => names[id] === 'default')!;
      const name = nativeComponentName(identity, scopeId);
      const variables = sourceVariables(graph, scopeId).map(variable => variable.type === 'controlReference' && variable.expectedType === 'file' ? { ...variable, type: 'file' } : variable);
      const variableValues = Object.fromEntries(variables.map(variable => [`${scopeId}:${variable.id}`, `{${nativePropName(identity, scopeId, String(variable.id))}}`]));
      const context: SourceMappingContext = { graph, diagnostics: componentDiagnostics, variables: variableValues, ...options };
      const visibilityFor = (node: ResolvedSourceNode) => {
        if (!sourceRecord(node.properties.visible)) return;
        const binding = resolveSourceBinding(node.properties.visible, { graph, identity, nodeId: node.sourceId });
        if (binding.kind !== 'variable' || binding.providerId !== scopeId || binding.valueType !== 'boolean') throw new Error(`Visibility binding on ${node.sourceId} requires its native adapter`);
        return binding;
      };
      const stylesFor = (node: ResolvedSourceNode, parent?: ResolvedSourceNode) => {
        const styleNode = visibilityFor(node) ? { ...node, properties: { ...node.properties, visible: true } } : node;
        const styles = mapSourceStyles(styleNode, { ...context, parent });
        if (node.kind === 'RichTextNode') Object.assign(styles, mapSourceText(node, context).styles);
        if (parent && ['stack', 'grid'].includes(String(parent.properties.layout)) && !['absolute', 'fixed'].includes(styles.position)) {
          styles.order = String(parent.children.indexOf(node.sourceId));
          if (parent.properties.layout === 'stack') {
            styles.flex = styles.flexGrow ? `${styles.flexGrow} ${styles.flexShrink ?? '1'} ${styles.flexBasis ?? '0px'}` : '0 0 auto';
            delete styles.flexGrow; delete styles.flexShrink; delete styles.flexBasis;
          }
        }
        return styles;
      };
      const { jsx: body, sourceIds, nested, codeInstances, links, slots } = emitSourceScene(graph, identity, primaryId, context, {
        stylesFor, expressionFor: (value, node, property) => valueExpression(value, node, context, property, identity), codeComponents: options.codeComponents,
      });
      const cssImageProps = new Set<string>();
      const renderedStates = sourceIds.flatMap(id => [resolveSourceNode(graph, id), ...scope.children.filter(state => state !== primaryId).map(state => resolveSourceNode(graph, id, state))]);
      for (const node of renderedStates) {
        const ref = sourceRecord(node.properties.fillImage);
        if (node.properties.fillEnabled === true && node.properties.fillType === 'image' && ref?.type === 'variableReference' && ref.providerId === scopeId && typeof ref.id === 'string') {
          if (!variables.some(variable => variable.id === ref.id && variable.type === 'image')) throw new Error(`Image fill on ${node.sourceId} does not reference an image prop`);
          cssImageProps.add(ref.id);
        }
      }
      const assertImageDomain = (value: unknown) => {
        const ref = sourceRecord(value);
        if (ref?.type === 'variableReference' && ref.providerId === scopeId && cssImageProps.has(String(ref.id))) throw new Error(`Image prop ${String(ref.id)} is used both as a CSS value and as a plain URL; a native image-domain adapter is required`);
        if (Array.isArray(value)) value.forEach(assertImageDomain);
        else if (ref) Object.values(ref).forEach(assertImageDomain);
      };
      for (const node of renderedStates) for (const [key, value] of Object.entries(node.properties)) if (!['fillImage', 'children', 'replicaInfo'].includes(key)) assertImageDomain(value);
      const created = buildCreatedMaster({ name, props: [], from: identity[primaryId], variants: Object.values(names).filter(value => value !== 'default').map(name => ({ name })) }, { sourceCode: `"use client"; export default function Source(){return (${body});}` });
      if ('error' in created) throw new Error(created.error);
      let code = created.masterCode;
      const states: VariantConfig[] = scope.children.map(id => {
        const raw = graph.nodes.get(id)!.raw;
        const replica = sourceRecord(raw.replicaInfo);
        const gesture = raw.gesture;
        return {
          name: names[id], label: String(raw.name ?? names[id]), x: Number(raw.left ?? 0), y: Number(raw.top ?? 0), isPrimary: id === primaryId,
          ...(gesture === 'hover' || gesture === 'pressed' ? { interactionType: gesture, parentVariant: names[String(replica?.inheritsFrom ?? replica?.master)] } : {}),
        };
      });
      code = code.replace(/const variantConfig\s*=\s*\[[\s\S]*?\];/, serializeVariantConfig(states));
      code = code.replace(/\/\*\* @name [\s\S]*?\*\//, `/** @name ${JSON.stringify(String(scope.raw.name ?? name)).replace(/\*\//g, '*\\/')} */`);
      const ast = parseJSX(code);
      if (!ast) throw new Error('Native master did not parse');
      const fn = ast.program.body.find(statement => t.isFunctionDeclaration(statement) && statement.id?.name === name);
      if (!t.isFunctionDeclaration(fn) || !t.isObjectPattern(fn.params[0]) || !t.isTSTypeAnnotation(fn.params[0].typeAnnotation) || !t.isTSTypeLiteral(fn.params[0].typeAnnotation.typeAnnotation)) throw new Error('Native master signature missing');
      const params = fn.params[0], types = fn.params[0].typeAnnotation.typeAnnotation;
      const propTypes: Record<string, string> = { string: 'plainText', number: 'number', boolean: 'toggle', color: 'color', image: 'image', link: 'link', eventhandler: 'event', file: 'file', collectionreference: 'reference' };
      for (const variable of variables) {
        const sourceType = String(variable.type), type = propTypes[sourceType];
        if (!type) throw new Error(`Variable ${String(variable.id)} type ${sourceType} requires a native data adapter`);
        const prop = nativePropName(identity, scopeId, String(variable.id));
        let initial = variable.initialValue ?? (sourceType === 'boolean' ? false : sourceType === 'number' ? 0 : '');
        if (sourceType === 'collectionreference') {
          const collectionId = sourceCollectionId(variable.dataIdentifier);
          const collection = graph.nodes.get(collectionId);
          if (collection?.kind !== 'CollectionNode' || !identity[collectionId]) throw new Error(`Missing prop reference collection ${collectionId}`);
          if (initial !== '') {
            if (typeof initial !== 'string' || !collection.children.includes(initial) || !identity[initial]) throw new Error(`Missing prop reference record ${String(initial)}`);
            initial = identity[initial];
          }
        }
        if ((sourceType === 'image' || sourceType === 'file') && typeof initial === 'string' && initial) {
          if (!options.assets?.[initial]) throw new Error(`Missing asset default for ${String(variable.id)}`);
          initial = options.assets[initial];
        }
        if (sourceType === 'image' && cssImageProps.has(String(variable.id)) && initial) initial = `url(${initial})`;
        const parameter = sourceType === 'eventhandler' ? t.identifier(prop) : t.assignmentPattern(t.identifier(prop), t.valueToNode(initial) as t.Expression);
        params.properties.push(t.objectProperty(t.identifier(prop), parameter, false, true));
        const tsType = sourceType === 'eventhandler' ? t.tsFunctionType(null, [], t.tsTypeAnnotation(t.tsVoidKeyword())) : sourceType === 'number' ? t.tsNumberKeyword() : sourceType === 'boolean' ? t.tsBooleanKeyword() : t.tsStringKeyword();
        const member = t.tsPropertySignature(t.identifier(prop), t.tsTypeAnnotation(tsType)); member.optional = true; types.members.push(member);
      }
      if (slots.length) {
        if (slots.length > 1) throw new Error('Multiple source slots require named native slot props');
        params.properties.push(t.objectProperty(t.identifier('children'), t.identifier('children'), false, true));
        const member = t.tsPropertySignature(t.identifier('children'), t.tsTypeAnnotation(t.tsTypeReference(t.tsQualifiedName(t.identifier('React'), t.identifier('ReactNode'))))); member.optional = true; types.members.push(member);
      }
      code = applySourceInstances(generate(ast).code, { jsx: body, sourceIds, nested, codeInstances, links, slots }, graph, identity, options.assets);
      for (const variable of variables) {
        const prop = nativePropName(identity, scopeId, String(variable.id));
        code = setPropTypeInCode(code, prop, propTypes[String(variable.type)]);
        code = setPropLabelInCode(code, prop, String(variable.name ?? variable.id));
        if (variable.type === 'collectionreference') code = setPropReferenceCollectionInCode(code, prop, nativeCollectionSlug(identity, sourceCollectionId(variable.dataIdentifier)));
      }
      // Native metadata is JSON in comments; escape the delimiter without changing decoded labels.
      code = code.replace(/(\/\*\* @propMeta )([\s\S]*?)( \*\/)/, (_all, before, json, after) => before + json.replace(/\*\//g, '*\\/') + after);
      code = ensureNamedImport(ensureMotionTag(code, identity[primaryId]), 'framer-motion', ['motion']);
      for (const id of links) {
        const node = resolveSourceNode(graph, id);
        code = convertToMotionLinkInCode(code, identity[id]);
        const pageLink = sourceRecord(node.properties.link);
        const route = pageLink?.type === 'webPage' && typeof pageLink.webPageId === 'string' ? options.routes?.[pageLink.webPageId] : undefined;
        if (pageLink?.type === 'webPage' && !route) throw new Error(`Destination route unavailable for source page ${String(pageLink.webPageId)}`);
        code = setTagAttr(code, identity[id], 'href', `{${route ? JSON.stringify(route) : valueExpression(node.properties.link, node, context, 'link')}}`);
        if (node.properties.linkOpenInNewTab !== undefined) code = setTagAttr(code, identity[id], 'target', `{${valueExpression(node.properties.linkOpenInNewTab, node, context, 'linkOpenInNewTab')} ? '_blank' : '_self'}`);
      }
      for (const id of sourceIds) {
        const base = resolveSourceNode(graph, id);
        const parentId = typeof base.properties.parentid === 'string' && sourceIds.includes(base.properties.parentid) ? base.properties.parentid : undefined;
        const baseStyles = stylesFor(base, parentId ? resolveSourceNode(graph, parentId) : undefined);
        let changed = false;
        for (const stateId of scope.children.filter(id => id !== primaryId)) {
          const state = resolveSourceNode(graph, id, stateId);
          for (const property of ['link', 'linkOpenInNewTab']) if (JSON.stringify(state.properties[property]) !== JSON.stringify(base.properties[property])) throw new Error(`Per-state ${property} on ${id} requires its native adapter`);
          if ((sourceRecord(base.properties.visible) || sourceRecord(state.properties.visible)) && JSON.stringify(base.properties.visible) !== JSON.stringify(state.properties.visible)) throw new Error(`Per-state visibility binding on ${id} requires its native adapter`);
          if (base.properties.dataIdentifier !== undefined) {
            for (const property of ['dataIdentifier', 'collectionFilters', 'collectionFiltersOperator', 'collectionOrder', 'collectionReverse', 'collectionStartOffset', 'collectionLimit', 'collectionPaginationPageSize']) {
              if (JSON.stringify(state.properties[property]) !== JSON.stringify(base.properties[property])) throw new Error(`Per-state query ${property} on ${id} requires its native adapter`);
            }
          }
          const override = (node: ResolvedSourceNode) => activeSourceCodeOverride(node.properties) ?? '';
          if (override(state) !== override(base)) throw new Error(`Per-state code override replacement on ${id} requires its native adapter`);
          if (base.kind === 'CodeComponentNode') {
            const controls = new Set([...Object.keys(base.properties), ...Object.keys(state.properties)].filter(key => key.startsWith('$control__')));
            if ([...controls].some(key => JSON.stringify(base.properties[key]) !== JSON.stringify(state.properties[key]))) {
              throw new Error(`Per-state instance controls on ${id} require their native conditional-prop adapter`);
            }
            if (state.properties.codeComponentIdentifier !== base.properties.codeComponentIdentifier) throw new Error(`Per-state instance master replacement on ${id} requires its native adapter`);
          }
          const styles = stylesFor(state, parentId ? resolveSourceNode(graph, parentId, stateId) : undefined);
          const delta: Record<string, string> = {};
          for (const key of new Set([...Object.keys(baseStyles), ...Object.keys(styles)])) if (styles[key] !== baseStyles[key]) {
            const mapped = styles[key] ?? CSS_NEUTRAL_FALLBACK[key] ?? 'initial';
            delta[key] = /^\{([A-Za-z_$][\w$]*)\}$/.test(mapped) ? `var:${mapped.slice(1, -1)}` : mapped === 'transparent' ? TRANSPARENT_FILL : mapped;
          }
          if (id === primaryId) delete delta.position;
          if (Object.keys(delta).length) {
            changed = true;
            for (const key of Object.keys(delta)) if (PROJECTION_STYLE_PROPS.has(key) || ['fontFamily', 'fontFeatureSettings', 'fontVariationSettings'].includes(key)) {
              code = setConditionalStyleInCode(code, identity[id], key, names[stateId], delta[key]);
              delete delta[key];
            }
            if (Object.keys(delta).length) code = updateVariantStyleInCode(code, identity[id], names[stateId], normalizeTransparent(delta));
          }
        }
        if (changed) {
          let hasVariants = false;
          const ast = parseJSX(code);
          if (ast) findFirstElementByDataId(ast, identity[id], (_path, element) => {
            hasVariants = element.openingElement.attributes.some(attribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'variants' }));
          });
          if (!hasVariants) code = updateVariantStyleInCode(code, identity[id], names[scope.children.find(id => id !== primaryId)!], { opacity: baseStyles.opacity ?? '1' });
          for (const stateId of scope.children) {
          const transition = transitionSpec(resolveSourceNode(graph, stateId).properties.variantTransition);
          if (transition) code = updateVariantEntryTransition(code, identity[id], names[stateId], transition);
          }
        }
        if (base.kind === 'RichTextNode') {
          const baseText = mapSourceText(base, context);
          for (const stateId of scope.children.filter(id => id !== primaryId)) {
            const text = mapSourceText(resolveSourceNode(graph, id, stateId), context);
            if (text.tag !== baseText.tag || JSON.stringify(text.attributes) !== JSON.stringify(baseText.attributes)) throw new Error(`Text tag or attributes change on ${id} requires a native per-state element adapter`);
            if (JSON.stringify(text.binding) === JSON.stringify(baseText.binding) && text.jsx === baseText.jsx) continue;
            if (text.binding) {
              const prop = valueExpression(text.binding, base, context, 'textContent');
              const variable = variables.find(variable => nativePropName(identity, scopeId, String(variable.id)) === prop);
              if (!variable || typeof variable.initialValue !== 'string') throw new Error(`Text binding ${prop} needs its native data adapter`);
              code = bindTextVariableForVariantInCode(code, identity[id], names[stateId], prop, variable.initialValue);
            } else code = updateVariantTextInCode(code, identity[id], names[stateId], text.jsx.includes('<') ? text.jsx : text.plainText);
          }
        }
        const callbackIds = new Map<string, string[]>();
        for (const stateId of scope.children) {
          const state = resolveSourceNode(graph, id, stateId === primaryId ? undefined : stateId);
          for (const [event, actions] of Object.entries(state.properties)) if (event !== 'onTap' && /^on[A-Z]/.test(event) && Array.isArray(actions) && actions.some(action => sourceRecord(action)?.actionIdentifier === 'framer/useTriggerEvent')) throw new Error(`Exposed ${event} on ${id} needs its native callback adapter`);
          for (const action of Array.isArray(state.properties.onTap) ? state.properties.onTap : []) {
            const a = sourceRecord(action);
            if (a?.actionIdentifier !== 'framer/useTriggerEvent') continue;
            const callbackId = sourceRecord(sourceRecord(a.controls)?.id)?.value;
            if (typeof callbackId !== 'string' || !variables.some(v => v.id === callbackId && v.type === 'eventhandler')) throw new Error(`Missing exposed event ${String(callbackId)}`);
            callbackIds.set(callbackId, [...(callbackIds.get(callbackId) ?? []), names[stateId]]);
          }
        }
        if (callbackIds.size > 1) throw new Error(`Multiple exposed events on ${id} require a native event composition adapter`);
        for (const [callbackId, states] of callbackIds) {
          const prop = nativePropName(identity, scopeId, callbackId);
          const expression = states.length === scope.children.length ? prop : `${states.map(state => `initialVariant === ${JSON.stringify(state)}`).join(' || ')} ? ${prop} : undefined`;
          code = setTagAttr(code, identity[id], 'onClick', `{${expression}}`);
        }
        const visibility = visibilityFor(base);
        if (visibility) {
          for (const stateId of scope.children.filter(stateId => stateId !== primaryId)) if (stylesFor(resolveSourceNode(graph, id, stateId), parentId ? resolveSourceNode(graph, parentId, stateId) : undefined).display !== baseStyles.display) throw new Error(`Per-state display with a visibility binding on ${id} requires its native adapter`);
          const variable = variables.find(variable => variable.id === visibility.sourceId)!;
          code = createConditionalVariableInCode(code, identity[id], 'display', visibility.name, baseStyles.display || 'block', 'none', variable.initialValue === true ? 'true' : 'false');
        }
      }
      for (const id of [...sourceIds].reverse()) {
        if (graph.nodes.get(id)?.raw.dataIdentifier === undefined) continue;
        const start = findJSXElementByDataId(code, identity[id]);
        const range = start >= 0 ? findClosingTag(code, start) : null;
        if (!range) throw new Error(`Missing native query container ${id}`);
        const template = code.slice(range.contentStart, range.closeTagStart).trim();
        code = emitSourceQueryInCode(code, identity[id], id, template, { graph, identity, nodeId: id });
      }
      const connections = mapSourceConnections(model, identity);
      for (const connection of connections) code = addConnectionToCode(code, connection.from, connection.to, connection.trigger, connection.delay, connection.sourceNode).code;
      // Rebuild retains the source pause flag as part of the native connection metadata.
      if (connections.length) code = rebuildConnections(code, connections);
      code = forwardEventPropsToComponentRoot(code);
      for (const id of sourceIds) {
        const node = resolveSourceNode(graph, id);
        const identifier = activeSourceCodeOverride(node.properties);
        if (!identifier) continue;
        const ref = options.overrides?.[identifier];
        if (!ref) throw new Error(`Original code override adapter required on ${id}: ${identifier}`);
        code = setCodeOverridesInCode(code, identity[id], [ref]);
      }
      if (parseVariantConfig(code).length !== scope.children.length) throw new Error('Native state count changed during generation');
      if (componentDiagnostics.length) throw new Error('Component has unresolved source semantics');
      result.files.push({ path: `components/${name}.tsx`, code });
      result.createdIds.push(identity[primaryId]);
    } catch (error) {
      result.diagnostics.push(...componentDiagnostics, { code: 'SOURCE_COMPONENT_UNSUPPORTED', sourceId: scopeId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
