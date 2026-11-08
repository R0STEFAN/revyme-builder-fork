import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { nodeIdToVarNameCapitalised } from '../../../shared/id-utils';
import { PROJECTION_STYLE_PROPS } from '../../../shared/constants';
import { cssTransformToMotionProps } from '../../../shared/motion-transform';
import { normalizeTransparent, TRANSPARENT_FILL } from '../../../shared/css-utils';
import { setPropLabelInCode, setPropTypeInCode, setPropReferenceCollectionInCode } from '../../components/prop-meta';
import { buildCreatedMaster } from '../../generation/create-component-gen';
import { findJSXElementByDataId, findClosingTag } from '../../generation/cms-gen';
import { setCodeOverridesInCode, type CodeOverrideRef } from '../../generation/code-override-gen';
import { setMotionPropScopedValue } from '../../generation/generator-motion-props';
import { updateVariantTextInCode } from '../../generation/generator-crud';
import { bindTextVariableForVariantInCode, createConditionalVariableInCode } from '../../features/variable-ops';
import { convertToMotionLinkInCode } from '../../generation/generator-attrs';
import { CSS_NEUTRAL_FALLBACK, setConditionalStyleInCode, updateVariantStyleInCode } from '../../generation/generator-styles';
import { updateVariantEntryTransition, updateMotionConfigTransition, formatTransitionObj } from '../../generation/generator-motion-transition';
import { ensureMotionTag } from '../../generation/generator-motion-scroll';
import { addComponentCursorInCode, ensureCursorOptsForwardInCode, cursorOptsPropName } from '../../generation/cursor-gen';
import { ensureNamedImport, generate, setTagAttr } from '../../generation/generator-utils';
import { findFirstElementByDataId, parseJSX } from '../../parsing/ast-utils';
import { addConnectionToCode, rebuildConnections } from '../../variants/connection-config';
import { forwardEventPropsToComponentRoot } from '../../variants/event-prop-forwarding';
import { parseVariantConfig, serializeVariantConfig, type VariantConfig } from '../../variants/variant-config';
import { sourceStateNames } from './interactions';
import { mapSourceConnections } from './interactions';
import { activeSourceCodeOverride, isSourceCodeComponent, resolveSourceNode, sourceRecord, sourceVariableKey, sourceVariables, sourceCssImageVariables } from './source-graph';
import { mapSourceStyles, sourceStyleValue, type SourceMappingContext } from './styles';
import { mapSourceText } from './text';
import { emitSourceScene } from './scene';
import { applySourceInstances } from './scene-instances';
import { sourceStaticLinkValue } from './links';
import { setVariantAttrInCode } from '../../generation/responsive-attrs-gen';
import { setVariantVisibilityInCode } from '../../generation/variant-visibility-gen';
import { wrapInFitSVGInCode } from '../../generation/fit-text-gen';
import { setConditionalInstanceProp, setConditionalInstancePropVarInCode } from '../../components/instance-prop-overrides';
import { nativeCollectionSlug, sourceCollectionId } from './cms';
import { resolveSourceBinding, emitSourceQueryInCode } from './bindings';
import { applySourceRotationLoop, assertLoopOutsideSourceList, sourceRotationLoop, sourceTransitionSpec, sourceMountEffects, applySourceMountEffects } from './effects';
import type { NativeCodeComponentRef } from './code-components';
import type { NativeCompileResult, ResolvedSourceNode, SourceGraph, SourceProperties } from './types';

function normalizeNodeInlineTransformInCode(code: string, dataId: string): string {
  const ast = parseJSX(code);
  if (!ast) return code;
  let changed = false;
  findFirstElementByDataId(ast, dataId, (_path, el) => {
    const styleAttr = el.openingElement.attributes.find(
      (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'style' }),
    );
    if (!styleAttr || !t.isJSXExpressionContainer(styleAttr.value) || !t.isObjectExpression(styleAttr.value.expression)) return;
    const props = styleAttr.value.expression.properties;
    const idx = props.findIndex(
      p => t.isObjectProperty(p) && (t.isIdentifier(p.key, { name: 'transform' }) || t.isStringLiteral(p.key, { value: 'transform' })) && t.isStringLiteral(p.value) && /\b(rotate|scale|skew)/i.test(p.value.value),
    );
    if (idx === -1) return;
    const prop = props[idx] as t.ObjectProperty;
    const raw = (prop.value as t.StringLiteral).value;
    const motion = cssTransformToMotionProps(raw);
    const entries = Object.entries(motion);
    if (!entries.length) return;
    const replacements = entries.map(([k, v]) =>
      t.objectProperty(t.identifier(k), /^-?\d+(?:\.\d+)?$/.test(v) ? t.numericLiteral(Number(v)) : t.stringLiteral(v)),
    );
    props.splice(idx, 1, ...replacements);
    changed = true;
  });
  if (!changed) return code;
  return ensureMotionTag(generate(ast).code, dataId);
}

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
  const unwrapped = sourceRecord(value) && 'value' in (value as object) ? (value as any).value : value;
  const target = unwrapped !== undefined ? unwrapped : value;
  if (identity && context.graph && sourceRecord(target)?.type === 'variableReference') {
    const binding = resolveSourceBinding(target, { graph: context.graph, identity, nodeId: node.sourceId });
    if (binding.kind === 'field') return `${binding.itemVar}.${binding.fieldId}`;
    if (binding.kind === 'variable') return binding.name;
    throw new Error(`Unsupported expression binding ${binding.kind} on ${node.sourceId}`);
  }
  const mapped = sourceStyleValue(target, node, context, property);
  if (mapped === undefined) throw new Error(`Unresolved ${property} on ${node.sourceId}`);
  const binding = /^\{([A-Za-z_$][\w$]*)\}$/.exec(mapped);
  return binding ? binding[1] : JSON.stringify(mapped);
}

/** Build the canonical shell, then use native transforms for states and links. */
export function emitNativeComponents(graph: SourceGraph, identity: Record<string, string>, options: Pick<SourceMappingContext, 'assets'> & { overrides?: Readonly<Record<string, CodeOverrideRef>>; codeComponents?: Readonly<Record<string, NativeCodeComponentRef>>; routes?: Readonly<Record<string, string>> } = {}): NativeCompileResult {
  trace.fn('framer-native.emitNativeComponents', { components: graph.byKind.get('SmartComponentNode')?.length ?? 0 });
  const result: NativeCompileResult = { files: [], createdIds: [], identity, diagnostics: [...graph.diagnostics] };
  const fatalErrors = result.diagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID' || d.code === 'SOURCE_CAPTURE_INCOMPLETE');
  if (fatalErrors.length) return result;
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
      const variableValues = Object.fromEntries(variables.map(variable => [
        `${scopeId}:${variable.id}`,
        variable.type === 'padding' || variable.type === 'borderradius'
          ? String(variable.initialValue ?? '0px')
          : `{${nativePropName(identity, scopeId, String(variable.id))}}`,
      ]));
      const context: SourceMappingContext = { graph, typographyIdentity: identity, diagnostics: componentDiagnostics, variables: variableValues, supportedLoops: true, supportedMountEffects: true, supportedFlowEffects: true, supportedForms: true, supportedCustomCursors: true, ...options };
      const isComputedVisibility = (node: ResolvedSourceNode) => {
        if (!sourceRecord(node.properties.visible)) return false;
        const b = resolveSourceBinding(node.properties.visible, { graph, identity, nodeId: node.sourceId });
        return b.kind === 'transform' && b.name === 'isSet' && b.input.kind === 'variable' && b.input.providerId === scopeId;
      };
      const visibilityFor = (node: ResolvedSourceNode) => {
        if (!sourceRecord(node.properties.visible)) return;
        let binding = resolveSourceBinding(node.properties.visible, { graph, identity, nodeId: node.sourceId });
        if (binding.kind === 'transform' && binding.name === 'isSet' && binding.input.kind === 'variable' && binding.input.providerId === scopeId) return;
        let negated = false;
        if (binding.kind === 'transform' && binding.name === 'negate') {
          negated = true;
          binding = binding.input;
        }
        if (binding.kind !== 'variable' || binding.providerId !== scopeId || binding.valueType !== 'boolean') return undefined;
        return { ...binding, negated };
      };
      const walkTree = (id: string): string[] => [id, ...resolveSourceNode(graph, id).children.flatMap(walkTree)];
      const hasInFlowVariantVisibility = walkTree(primaryId).some(id => {
        if (id === primaryId) return false;
        const hiddenCount = scope.children.filter(state => resolveSourceNode(graph, id, state === primaryId ? undefined : state).properties.visible === false).length;
        if (hiddenCount === 0 || hiddenCount === scope.children.length) return false;
        const pos = resolveSourceNode(graph, id).properties.position;
        return pos !== 'absolute' && pos !== 'fixed';
      });
      const stylesFor = (node: ResolvedSourceNode, parent?: ResolvedSourceNode) => {
        const styleNode = visibilityFor(node) || isComputedVisibility(node) || node.properties.visible === false ? { ...node, properties: { ...node.properties, visible: true } } : node;
        const styles = mapSourceStyles(styleNode, { ...context, parent });
        if (node.kind === 'RichTextNode') Object.assign(styles, mapSourceText(node, context).styles);
        const vb = sourceRecord(node.properties.textFitViewBoxSize);
        if (vb && typeof vb.width === 'number' && vb.width > 0) {
          const maxFs = parseFloat(styles.fontSize) || (typeof vb.height === 'number' && vb.height > 0 ? vb.height : 48);
          styles.fontSize = `${maxFs}px`;
          styles.width = '100%';
          styles.maxWidth = '100%';
        }
        if (parent && ['stack', 'grid'].includes(String(parent.properties.layout)) && !['absolute', 'fixed'].includes(styles.position)) {
          styles.order = String(parent.children.indexOf(node.sourceId));
          if (parent.properties.layout === 'stack') {
            styles.flex = styles.flexGrow ? `${styles.flexGrow} 0 ${styles.flexBasis ?? '0px'}` : '0 0 auto';
            delete styles.flexGrow; delete styles.flexShrink; delete styles.flexBasis;
          }
        }
        if (node.sourceId === primaryId && styles.aspectRatio) {
          delete styles.aspectRatio;
          if (!styles.width || styles.width === 'auto') {
            styles.width = `${typeof node.properties.width === 'number' && node.properties.width > 0 ? node.properties.width : 200}px`;
          }
          if (!styles.height || styles.height === 'auto') {
            styles.height = `${typeof node.properties.height === 'number' && node.properties.height > 0 ? node.properties.height : 200}px`;
          }
        }
        if (node.sourceId === primaryId && styles.height && /^\d+(?:\.\d+)?px$/.test(styles.height)) {
          if (!styles.minHeight) styles.minHeight = styles.height;
          if (hasInFlowVariantVisibility) styles.height = 'auto';
        }
        return styles;
      };
      const hasPerStateTextChange = (node: ResolvedSourceNode) => {
        if (node.kind !== 'RichTextNode') return false;
        const baseText = mapSourceText(node, context);
        return scope.children.some(stateId => {
          if (stateId === primaryId) return false;
          const text = mapSourceText(resolveSourceNode(graph, node.sourceId, stateId), context);
          return JSON.stringify(text.binding) !== JSON.stringify(baseText.binding) || text.jsx !== baseText.jsx;
        });
      };
      const { jsx: rawBody, sourceIds, nested, codeInstances, links, slots } = emitSourceScene(graph, identity, primaryId, context, {
        stylesFor,
        expressionFor: (value, node, property) => valueExpression(value, node, context, property, identity),
        codeComponents: options.codeComponents,
        plainTextFor: hasPerStateTextChange,
        assets: options.assets,
      });
      const body = rawBody.replace(/<Link\b/g, '<a').replace(/<\/Link>/g, '</a>');
      if (sourceIds.some(id => graph.nodes.get(id)!.kind === 'OverlayNode')) throw new Error('Source design-master overlay requires its native state-scope adapter');
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
      for (const node of renderedStates) for (const [key, value] of Object.entries(node.properties)) if (!['fillImage', 'children', 'replicaInfo'].includes(key) && !(isSourceCodeComponent(node) && key.startsWith('$control__'))) assertImageDomain(value);
      const created = buildCreatedMaster({ name, props: [], from: identity[primaryId], variants: Object.values(names).filter(value => value !== 'default').map(name => ({ name })) }, { sourceCode: `"use client"; export default function Source(){return (${body});}` });
      if ('error' in created) throw new Error(created.error);
      let code = created.masterCode;
      const textDirections: Array<{ nodeId: string; variant: string; value: string | null; base: string }> = [];
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
      const propTypes: Record<string, string> = { string: 'plainText', number: 'number', boolean: 'toggle', color: 'color', image: 'image', link: 'link', eventhandler: 'event', file: 'file', collectionreference: 'reference', customcursor: 'componentCursor', padding: 'plainText', borderradius: 'plainText', border: 'plainText', enum: 'plainText', vectorsetitem: 'plainText', array: 'plainText', controlReference: 'plainText' };
      for (const variable of variables) {
        const sourceType = String(variable.type), type = propTypes[sourceType];
        if (!type) throw new Error(`Variable ${String(variable.id)} type ${sourceType} requires a native data adapter`);
        const prop = nativePropName(identity, scopeId, String(variable.id));
        let initial = variable.initialValue ?? (sourceType === 'boolean' ? false : sourceType === 'number' ? 0 : '');
        if (sourceType === 'link') {
          initial = sourceStaticLinkValue(initial, options.routes) as typeof initial;
        } else if (sourceType === 'border') {
          const b = sourceRecord(initial);
          if (b) initial = `${b.borderWidth ?? b.borderTop ?? 1}px ${b.borderStyle ?? 'solid'} ${b.borderColor ?? 'transparent'}`;
        } else if (sourceType === 'vectorsetitem') {
          const vs = sourceRecord(initial);
          if (vs) initial = String(vs.identifier ?? '');
        } else if (sourceType === 'array' || (typeof initial === 'object' && initial !== null)) {
          initial = '';
        }
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
          initial = options.assets?.[initial] ?? initial ?? '';
        }
        if (sourceType === 'image' && cssImageProps.has(String(variable.id)) && initial) initial = `url(${initial})`;
        if (sourceType === 'customcursor' && variable.initialValue != null && variable.initialValue !== '') {
          trace.action('framer-native.skipCursorDefault', { id: variable.id });
        }
        const parameter = sourceType === 'eventhandler' ? t.identifier(prop) : t.assignmentPattern(t.identifier(prop), sourceType === 'customcursor' ? t.arrowFunctionExpression([], t.nullLiteral()) : t.valueToNode(initial) as t.Expression);
        params.properties.push(t.objectProperty(t.identifier(prop), parameter, false, true));
        const tsType = sourceType === 'eventhandler' ? t.tsFunctionType(null, [], t.tsTypeAnnotation(t.tsVoidKeyword())) : sourceType === 'customcursor' ? t.tsTypeReference(t.tsQualifiedName(t.identifier('React'), t.identifier('ComponentType'))) : sourceType === 'number' ? t.tsNumberKeyword() : sourceType === 'boolean' ? t.tsBooleanKeyword() : t.tsStringKeyword();
        const member = t.tsPropertySignature(t.identifier(prop), t.tsTypeAnnotation(tsType)); member.optional = true; types.members.push(member);
        if (sourceType === 'customcursor') { const opts = t.tsPropertySignature(t.identifier(cursorOptsPropName(prop)), t.tsTypeAnnotation(t.tsAnyKeyword())); opts.optional = true; types.members.push(opts); }
      }
      if (slots.length) {
        if (slots.length > 1) throw new Error('Multiple source slots require named native slot props');
        params.properties.push(t.objectProperty(t.identifier('children'), t.identifier('children'), false, true));
        const member = t.tsPropertySignature(t.identifier('children'), t.tsTypeAnnotation(t.tsTypeReference(t.tsQualifiedName(t.identifier('React'), t.identifier('ReactNode'))))); member.optional = true; types.members.push(member);
      }
      code = applySourceInstances(generate(ast).code, { jsx: body, sourceIds, nested, codeInstances, links, slots }, graph, identity, options.assets, { routes: options.routes, componentScopeId: scopeId });
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
        code = setTagAttr(code, identity[id], 'href', `{${valueExpression(sourceStaticLinkValue(node.properties.link, options.routes), node, context, 'link')}}`);
        if (node.properties.linkOpenInNewTab !== undefined) code = setTagAttr(code, identity[id], 'target', `{${valueExpression(node.properties.linkOpenInNewTab, node, context, 'linkOpenInNewTab')} ? '_blank' : '_self'}`);
      }
      for (const match of code.matchAll(/<a\b[^>]*\bdata-id="([^"]+)"[^>]*\bhref=/g)) {
        code = convertToMotionLinkInCode(code, match[1]);
      }
      for (const id of sourceIds) {
        const base = resolveSourceNode(graph, id);
        const parentId = typeof base.properties.parentid === 'string' && sourceIds.includes(base.properties.parentid) ? base.properties.parentid : undefined;
        const baseStyles = stylesFor(base, parentId ? resolveSourceNode(graph, parentId) : undefined);
        let changed = false, hasLayoutPropChange = false;
        for (const stateId of scope.children.filter(id => id !== primaryId)) {
          const state = resolveSourceNode(graph, id, stateId);
          if (!isSourceCodeComponent(base)) for (const property of ['link', 'linkOpenInNewTab']) {
            const baseLink = base.properties[property];
            const stateLink = state.properties[property];
            if (JSON.stringify(stateLink) !== JSON.stringify(baseLink)) {
              if (sourceRecord(baseLink)?.type === 'webPage' && sourceRecord(stateLink)?.type === 'webPage' && (baseLink as any).webPageId !== (stateLink as any).webPageId) {
                throw new Error(`Per-state ${property} on ${id} requires its native adapter`);
              }
              trace.action('framer-native.skipPerStateProp', { property, id });
            }
          }
          if ((sourceRecord(base.properties.visible) || sourceRecord(state.properties.visible)) && JSON.stringify(base.properties.visible) !== JSON.stringify(state.properties.visible)) {
            trace.action('framer-native.skipPerStateVisibility', { id });
          }
          if (base.properties.dataIdentifier !== undefined) {
            for (const property of ['dataIdentifier', 'collectionFilters', 'collectionFiltersOperator', 'collectionOrder', 'collectionReverse', 'collectionStartOffset', 'collectionLimit', 'collectionPaginationPageSize']) {
              if (JSON.stringify(state.properties[property]) !== JSON.stringify(base.properties[property])) throw new Error(`Per-state query ${property} on ${id} requires its native adapter`);
            }
          }
          const override = (node: ResolvedSourceNode) => activeSourceCodeOverride(node.properties) ?? '';
          if (!isSourceCodeComponent(base) && override(state) !== override(base)) throw new Error(`Per-state code override replacement on ${id} requires its native adapter`);
          if (base.kind === 'CodeComponentNode' && !isSourceCodeComponent(base)) {
            if (state.properties.codeComponentIdentifier !== base.properties.codeComponentIdentifier) throw new Error(`Per-state instance master replacement on ${id} requires its native adapter`);
            const childMaster = /^local-module:canvasComponent\/([^:]+):/.exec(String(base.properties.codeComponentIdentifier))?.[1];
            if (!childMaster) throw new Error(`Missing design master for ${id}`);
            const childName = nativeComponentName(identity, childMaster);
            const childVariables = sourceVariables(graph, childMaster);
            const controls = new Set([...Object.keys(base.properties), ...Object.keys(state.properties)].filter(key => key.startsWith('$control__')));
            for (const key of controls) {
              if (JSON.stringify(base.properties[key]) === JSON.stringify(state.properties[key])) continue;
              const sourceProp = key.slice(10), raw = sourceRecord(state.properties[key])?.value;
              if (sourceProp === 'variant') {
                const target = sourceStateNames({ graph, scopeId: childMaster }, identity)[String(raw)];
                if (!target) throw new Error(`Missing per-state child variant ${String(raw)} on ${id}`);
                code = setConditionalInstanceProp(code, identity[id], childName, 'initialVariant', names[stateId], target);
                continue;
              }
              const variable = childVariables.find(variable => variable.id === sourceProp);
              if (!variable) { trace.action('framer-native.skipDeletedInstanceProp', { sourceId: id, childMaster, prop: sourceProp }); continue; }
              if (variable.type === 'eventhandler') {
                if (Array.isArray(raw) && raw.every(a => sourceRecord(a)?.actionIdentifier === 'framer/useSetVariant')) continue;
                throw new Error(`Per-state ${String(variable.type)} on ${id} requires its native callback adapter`);
              }
              if (variable.type === 'customcursor') throw new Error(`Per-state ${String(variable.type)} on ${id} requires its native callback adapter`);
              const prop = nativePropName(identity, childMaster, sourceProp);
              const resolvedRaw = variable.type === 'link' && sourceRecord(raw)?.type !== 'variableReference' && sourceRecord(raw)?.type !== 'computedValue'
                ? sourceStaticLinkValue(raw, options.routes)
                : raw;
              const binding = resolveSourceBinding(resolvedRaw, { graph, identity, nodeId: id, ...(variable.type === 'collectionreference' ? { referenceCollectionId: sourceCollectionId(variable.dataIdentifier) } : {}) });
              if (binding.kind === 'variable') {
                code = setConditionalInstancePropVarInCode(code, identity[id], childName, prop, names[stateId], binding.name, String(sourceRecord(base.properties[key])?.value ?? variable.initialValue ?? ''));
                continue;
              }
              if (binding.kind !== 'literal' && binding.kind !== 'reference') throw new Error(`Per-state ${sourceProp} on ${id} requires its native conditional-prop adapter`);
              let mapped = binding.kind === 'reference' ? binding.rowId : binding.value;
              if (variable.type === 'link') mapped = sourceStaticLinkValue(mapped, options.routes);
              if ((variable.type === 'image' || variable.type === 'file') && typeof mapped === 'string' && mapped.startsWith('data:framer/asset-reference,')) mapped = options.assets?.[mapped];
              if (mapped === undefined || mapped !== null && !['string', 'number', 'boolean'].includes(typeof mapped)) throw new Error(`Per-state ${sourceProp} on ${id} requires its native value adapter`);
              if (variable.type === 'image' && sourceCssImageVariables(graph, childMaster).has(sourceProp) && mapped) mapped = `url(${mapped})`;
              code = setConditionalInstanceProp(code, identity[id], childName, prop, names[stateId], String(mapped ?? ''));
            }
          }
          const styles = stylesFor(state, parentId ? resolveSourceNode(graph, parentId, stateId) : undefined);
          const delta: Record<string, string> = {};
          for (const key of new Set([...Object.keys(baseStyles), ...Object.keys(styles)])) if (styles[key] !== baseStyles[key]) {
            if (key === 'transform' && (/\b(rotate|scale|skew)/i.test(baseStyles.transform ?? '') || /\b(rotate|scale|skew)/i.test(styles.transform ?? ''))) {
              const baseMotion = cssTransformToMotionProps(baseStyles.transform ?? '');
              const stateMotion = cssTransformToMotionProps(styles.transform ?? '');
              for (const mk of new Set([...Object.keys(baseMotion), ...Object.keys(stateMotion)])) {
                const neutral = mk.startsWith('scale') ? '1' : '0';
                const bVal = baseMotion[mk] ?? neutral;
                const sVal = stateMotion[mk] ?? neutral;
                if (sVal !== bVal) delta[mk] = sVal;
              }
              continue;
            }
            let mapped = styles[key] ?? CSS_NEUTRAL_FALLBACK[key] ?? 'initial';
            if (key === 'boxShadow' && (mapped === 'none' || mapped === 'initial')) mapped = '0 0 0 rgba(0, 0, 0, 0)';
            if (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key) && (mapped === 'auto' || mapped === 'none' || mapped === 'initial')) mapped = '';
            delta[key] = /^\{([A-Za-z_$][\w$]*)\}$/.test(mapped) ? `var:${mapped.slice(1, -1)}` : mapped === 'transparent' ? TRANSPARENT_FILL : mapped;
          }
          if (id === primaryId) delete delta.position;
          if (Object.keys(delta).length) {
            changed = true;
            const isAbsolute = baseStyles.position === 'absolute' || baseStyles.position === 'fixed' || styles.position === 'absolute' || styles.position === 'fixed';
            for (const key of Object.keys(delta)) {
              const isNonTweenable = PROJECTION_STYLE_PROPS.has(key)
                || ['fontFamily', 'fontFeatureSettings', 'fontVariationSettings'].includes(key)
                || ['position', 'order', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'zIndex', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key)
                || (isAbsolute && (delta[key] === 'auto' || baseStyles[key] === 'auto' || ['left', 'top', 'right', 'bottom'].includes(key)));
              if (isNonTweenable) {
                if (PROJECTION_STYLE_PROPS.has(key) || ['left', 'top', 'right', 'bottom', 'position', 'order', 'flex', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key)) {
                  hasLayoutPropChange = true;
                }
                code = setConditionalStyleInCode(code, identity[id], key, names[stateId], delta[key]);
                delete delta[key];
              }
            }
            if (Object.keys(delta).length) {
              if (/\b(rotate|scale|skew)/i.test(baseStyles.transform ?? '')) {
                code = normalizeNodeInlineTransformInCode(code, identity[id]);
              }
              code = updateVariantStyleInCode(code, identity[id], names[stateId], normalizeTransparent(delta));
            }
          }
        }
        if (hasLayoutPropChange) {
          code = ensureMotionTag(code, identity[id]);
          code = setTagAttr(code, identity[id], 'layout', '{true}');
        }
        if (base.kind === 'RichTextNode') {
          const baseText = mapSourceText(base, context);
          for (const stateId of scope.children.filter(id => id !== primaryId)) {
            const text = mapSourceText(resolveSourceNode(graph, id, stateId), context);
            const attributes = new Set([...Object.keys(text.attributes), ...Object.keys(baseText.attributes)]);
            if (text.tag !== baseText.tag || [...attributes].some(key => key !== 'dir' && text.attributes[key] !== baseText.attributes[key])) throw new Error(`Text tag or attributes change on ${id} requires a native per-state element adapter`);
            if (text.attributes.dir !== baseText.attributes.dir) textDirections.push({ nodeId: identity[id], variant: names[stateId], value: text.attributes.dir ?? null, base: baseText.attributes.dir ?? '' });
            if (JSON.stringify(text.binding) === JSON.stringify(baseText.binding) && text.jsx === baseText.jsx) continue;
            if (text.binding) {
              const prop = valueExpression(text.binding, base, context, 'textContent');
              const variable = variables.find(variable => nativePropName(identity, scopeId, String(variable.id)) === prop);
              if (!variable || typeof variable.initialValue !== 'string') throw new Error(`Text binding ${prop} needs its native data adapter`);
              code = bindTextVariableForVariantInCode(code, identity[id], names[stateId], prop, variable.initialValue);
            } else code = updateVariantTextInCode(code, identity[id], names[stateId], text.plainText);
          }
        }
        const eventAttrMap: Record<string, string> = { onTap: 'onClick', onMouseEnter: 'onMouseEnter', onMouseLeave: 'onMouseLeave' };
        for (const [sourceEvent, jsxEvent] of Object.entries(eventAttrMap)) {
          const callbackIds = new Map<string, string[]>();
          for (const stateId of scope.children) {
            const state = resolveSourceNode(graph, id, stateId === primaryId ? undefined : stateId);
            if (isSourceCodeComponent(state)) continue;
            if (sourceEvent === 'onTap') {
              for (const [event, actions] of Object.entries(state.properties)) if (!eventAttrMap[event] && /^on[A-Z]/.test(event) && Array.isArray(actions) && actions.some(action => sourceRecord(action)?.actionIdentifier === 'framer/useTriggerEvent')) throw new Error(`Exposed ${event} on ${id} needs its native callback adapter`);
            }
            for (const action of Array.isArray(state.properties[sourceEvent]) ? state.properties[sourceEvent] : []) {
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
            code = setTagAttr(code, identity[id], jsxEvent, `{${expression}}`);
          }
        }
        const visibility = visibilityFor(base);
        if (visibility) {
          for (const stateId of scope.children.filter(stateId => stateId !== primaryId)) {
            try {
              if (stylesFor(resolveSourceNode(graph, id, stateId), parentId ? resolveSourceNode(graph, parentId, stateId) : undefined).display !== baseStyles.display) {
                trace.action('framer-native.skipPerStateDisplayMismatch', { id });
              }
            } catch {}
          }
          const variable = variables.find(variable => variable.id === visibility.sourceId)!;
          const truthy = visibility.negated ? 'none' : (baseStyles.display || 'block');
          const falsy = visibility.negated ? (baseStyles.display || 'block') : 'none';
          code = createConditionalVariableInCode(code, identity[id], 'display', visibility.name, truthy, falsy, variable.initialValue === true ? 'true' : 'false');
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
      for (const direction of textDirections) code = setVariantAttrInCode(code, direction.nodeId, direction.variant, 'dir', direction.value, direction.base);
      code = forwardEventPropsToComponentRoot(code);
      for (const id of sourceIds) {
        const node = resolveSourceNode(graph, id);
        if (isSourceCodeComponent(node)) continue;
        const cursor = sourceRecord(node.properties.customCursorType);
        if (cursor) {
          const binding = resolveSourceBinding(cursor, { graph, identity, nodeId: id });
          if (binding.kind !== 'variable' || binding.providerId !== scopeId || binding.valueType !== 'customcursor') throw new Error(`Cursor on ${id} requires its native component adapter`);
          for (const state of scope.children.filter(state => state !== primaryId)) {
            if (JSON.stringify(resolveSourceNode(graph, id, state).properties.customCursorType) !== JSON.stringify(node.properties.customCursorType)) {
              trace.action('framer-native.skipPerStateCursor', { id });
            }
          }
          code = addComponentCursorInCode(code, identity[id], { componentName: binding.name });
          code = ensureCursorOptsForwardInCode(code, binding.name);
        } else if (node.properties.customCursorType === 'component' && typeof node.properties.customCursorSmartComponentId === 'string') {
          const compId = node.properties.customCursorSmartComponentId;
          if (graph.nodes.has(compId)) {
            const compName = nativeComponentName(identity, compId);
            code = addComponentCursorInCode(code, identity[id], {
              componentName: compName,
              componentImportPath: `@/components/${compName}`,
            });
          }
        }
        const identifier = activeSourceCodeOverride(node.properties);
        if (!identifier) continue;
        const ref = options.overrides?.[identifier];
        if (!ref) {
          if (identifier.includes('withPress') || identifier.includes('Press')) {
            code = setMotionPropScopedValue(code, identity[id], 'whileTap', { scale: '0.97' });
          } else {
            result.diagnostics.push({ code: 'SOURCE_COMPONENT_UNSUPPORTED', sourceId: scopeId, message: `Original code override adapter required on ${id}: ${identifier}` });
            trace.action('framer-native.skipUnsupportedCodeOverride', { id, identifier });
          }
          continue;
        }
        code = setCodeOverridesInCode(code, identity[id], [ref]);
      }
      for (const id of sourceIds) {
        const node = resolveSourceNode(graph, id);
        if (isSourceCodeComponent(node)) continue;
        const spec = sourceRotationLoop(node.properties);
        for (const state of scope.children.filter(state => state !== primaryId)) if (JSON.stringify(sourceRotationLoop(resolveSourceNode(graph, id, state).properties)) !== JSON.stringify(spec)) throw new Error(`Per-state loop on ${id} requires its native adapter`);
        if (spec) {
          if (!['FrameNode', 'RichTextNode'].includes(node.kind)) throw new Error(`Loop on source component ${id} requires its native adapter`);
          assertLoopOutsideSourceList(graph, id);
          code = applySourceRotationLoop(code, identity[id], spec);
        }
        const mount = sourceMountEffects(node.properties);
        if (mount) {
          code = applySourceMountEffects(code, identity[id], mount);
        }
      }
      for (const id of sourceIds) {
        const hidden = scope.children.filter(state => resolveSourceNode(graph, id, state === primaryId ? undefined : state).properties.visible === false).map(state => names[state]);
        if (!hidden.length) continue;
        if (id === primaryId) throw new Error('Source root visibility requires its native component lifecycle adapter');
        const baseNode = resolveSourceNode(graph, id);
        if (hidden.length === scope.children.length) {
          if (baseNode.kind === 'CodeComponentNode' && !isSourceCodeComponent(baseNode)) {
            code = setVariantVisibilityInCode(code, identity[id], hidden, [...Object.values(names), '__hidden__']);
          } else {
            code = updateVariantStyleInCode(code, identity[id], 'default', { display: 'none' });
          }
          continue;
        }
        code = setVariantVisibilityInCode(code, identity[id], hidden, Object.values(names));
        code = setTagAttr(code, identity[primaryId], 'layout', '{true}');
      }
      for (const id of sourceIds) {
        const base = resolveSourceNode(graph, id);
        const rawTransform = stylesFor(base).transform ?? '';
        if (/\b(rotate|scale|skew)/i.test(rawTransform)) {
          const tagRe = new RegExp(`<[^>]*\\bdata-id="${identity[id]}"[^>]*>`);
          const tagMatch = tagRe.exec(code)?.[0] ?? '';
          if (/\b(scale|skew)/i.test(rawTransform) || /\bvariants=/.test(tagMatch) || /\blayout\b/.test(tagMatch)) {
            code = normalizeNodeInlineTransformInCode(code, identity[id]);
          }
        }
        if (base.kind === 'RichTextNode') {
          const vb = sourceRecord(base.properties.textFitViewBoxSize);
          if (vb && typeof vb.width === 'number' && vb.width > 0) {
            const baseStyles = stylesFor(base);
            const maxFs = parseFloat(baseStyles.fontSize) || (typeof vb.height === 'number' && vb.height > 0 ? vb.height : 48);
            code = wrapInFitSVGInCode(code, identity[id], {
              width: vb.width,
              height: typeof vb.height === 'number' && vb.height > 0 ? vb.height : 218,
              fontSize: maxFs,
            });
          }
        }
      }
      const variantTransitions: Record<string, Record<string, string>> = {};
      for (const stateId of scope.children) {
        const trans = sourceTransitionSpec(resolveSourceNode(graph, stateId).properties.variantTransition);
        if (trans) variantTransitions[names[stateId]] = trans;
      }
      const nonDefaultTransitions = Object.entries(variantTransitions).filter(([variantName]) => variantName !== 'default');
      const variantVar = code.includes('const [variant, setVariant]') ? 'variant' : code.includes('initialVariant') ? 'initialVariant' : null;
      if (nonDefaultTransitions.length > 0 && variantVar) {
        const defaultTrans = variantTransitions['default'] ? formatTransitionObj(variantTransitions['default']) : '{ duration: 0 }';
        const motionConfigExpr = nonDefaultTransitions
          .map(([variantName, trans]) => `${variantVar} === '${variantName}' ? ${formatTransitionObj(trans)}`)
          .concat([defaultTrans])
          .join(' : ');
        code = updateMotionConfigTransition(code, null, motionConfigExpr);
      } else if (variantTransitions['default']) {
        code = updateMotionConfigTransition(code, null, formatTransitionObj(variantTransitions['default']));
      }
      if (parseVariantConfig(code).length !== scope.children.length) throw new Error('Native state count changed during generation');
      const fatalCompErrors = componentDiagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID');
      if (fatalCompErrors.length) throw new Error('Component has fatal source errors');
      if (code.includes('RevymeSplitText')) code = ensureNamedImport(code, '@revyme/runtime', ['RevymeSplitText']);
      result.files.push({ path: `components/${name}.tsx`, code });
      result.createdIds.push(identity[primaryId]);
    } catch (error) {
      result.diagnostics.push(...componentDiagnostics, { code: 'SOURCE_COMPONENT_UNSUPPORTED', sourceId: scopeId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const folderMap = new Map<string, { id: string; name: string; parentId: null; children: string[] }>();
  const rootOrder: string[] = [];
  for (const scopeId of graph.byKind.get('SmartComponentNode') ?? []) {
    if (!graph.reachable.has(scopeId)) continue;
    const node = graph.nodes.get(scopeId)!;
    const rawName = typeof node.raw.name === 'string' ? node.raw.name : '';
    const compName = nativeComponentName(identity, scopeId);
    const filePath = `components/${compName}.tsx`;
    if (!result.files.some(f => f.path === filePath)) continue;
    if (rawName.includes('/')) {
      const parts = rawName.split('/');
      const folderName = parts[0].trim();
      const folderId = `fld-${folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (!folderMap.has(folderId)) {
        folderMap.set(folderId, {
          id: folderId,
          name: folderName,
          parentId: null,
          children: [],
        });
        rootOrder.push(folderId);
      }
      folderMap.get(folderId)!.children.push(filePath);
    } else {
      rootOrder.push(filePath);
    }
  }
  if (folderMap.size > 0) {
    result.files.push({
      path: '_meta/component-folders.json',
      code: JSON.stringify({ version: 1, rootOrder, folders: [...folderMap.values()] }, null, 2) + '\n',
    });
  }
  return result;
}
