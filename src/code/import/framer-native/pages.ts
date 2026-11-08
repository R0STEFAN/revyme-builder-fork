import { trace } from '../../../shared/debug-trace';
import { cmsPropBindingExpression } from '../../../shared/cms-prop-bindings';
import { checkFile, isAgentBlockingOracleViolation } from '../../oracle/check-file';
import { setTagAttr, ensureNamedImport } from '../../generation/generator-utils';
import { wrapInFitSVGInCode } from '../../generation/fit-text-gen';
import { addComponentCursorInCode } from '../../generation/cursor-gen';
import { setGlideInCode } from '../../generation/glide-gen';
import { convertToMotionLinkInCode } from '../../generation/generator-attrs';
import { setCodeOverridesInCode, type CodeOverrideRef } from '../../generation/code-override-gen';
import { FORM_ROUTE_CONTENT, FORM_ROUTE_PATH, wireFormSubmitInCode } from '../../generation/form-gen';
import { formStateSetter, formStateVar, hasFormStateDeclaration, setFormStateMappingInCode, type FormStateMapping } from '../../generation/form-state-gen';
import { updatePseudoStyleInCode } from '../../generation/generator-styles';
import { activeSourceCodeOverride, isSourceCodeComponent, sourceRecord, sourceVariables, sourceVariableKey, resolveSourceNode } from './source-graph';
import { mapSourceStyles, sourceFormControlPseudoStyles, type SourceMappingContext } from './styles';
import { mapSourceText } from './text';
import { sourceViewports, applyNativeResponsive } from './responsive';
import { emitSourceScene } from './scene';
import { applySourceInstances } from './scene-instances';
import { applySourceOverlays } from './overlays';
import { sourceStaticLinkValue } from './links';
import { emitSourceQueryInCode, resolveSourceBinding } from './bindings';
import { nativeCollectionSlug, nativeFieldId, sourceCollectionId } from './cms';
import { buildCmsDetailServerWrapper } from '../../project/cms-seo';
import { serializePageEffects, type PageEffect } from '../../project/page-effects-config';
import { injectPageTransitionsInCode, PAGE_EFFECTS_RUNTIME_SOURCE, PAGE_TRANSITIONS_SOURCE } from '../../generation/page-transitions-gen';
import { wrapInstanceForPresence } from '../../generation/instance-presence-gen';
import { updateMotionPropInCode } from '../../generation/generator-motion-props';
import { updateScrollSpeedInCode } from '../../generation/generator-motion-scroll-fx';
import type { SerScope } from '../../generation/scoped-expr';
import { applySourceRotationLoop, assertLoopOutsideSourceList, sourceFlowEffect, sourceRotationLoop, sourceMountEffects, applySourceMountEffects, sourceGlobalPageEffect, sourceHoverEffect, sourceTapEffect, sourceScrollSpeed } from './effects';
import { bindFieldInCode, findJSXElementByDataId, findClosingTag, setStyleEntryInCode } from '../../generation/cms-gen';
import { nativeComponentName, nativePropName } from './components';
import { sourceInstanceStateName } from './interactions';
import { setResponsiveOverride, setResponsiveBindingOverride, transformAllResponsiveAttrs } from '../../components/instance-prop-overrides';
import { parseOverlayCalls, resolveOverlayConfigForWidth } from '../../parsing/overlay-parser';
import { stateVarName } from '../../generation/overlay-gen';
import { setTextOverrideInCode } from '../../generation/text-override-gen';
import { setPropLabelInCode, setPropTypeInCode } from '../../components/prop-meta';
import { createConditionalVariableInCode } from '../../features/variable-ops';
import { updateTemplatePropsInCode } from '../../features/template-props';
import { setTemplateRouteValueInCode } from '../../generation/template-route-gen';
import type { NativeCodeComponentRef } from './code-components';
import type { NativeCompileResult, ResolvedSourceNode, SourceGraph, SourceNode } from './types';

export interface NativePageOptions {
  existingPaths: ReadonlySet<string>;
  assets?: Record<string, string>;
  codeComponents?: Readonly<Record<string, NativeCodeComponentRef>>;
  overrides?: Readonly<Record<string, CodeOverrideRef>>;
  tolerant?: boolean;
  replaceHomePage?: boolean;
  overwrite?: boolean;
}
export interface NativePageResult extends NativeCompileResult { routes: Record<string, string> }

function documentFor(graph: SourceGraph, page: SourceNode): SourceNode | undefined {
  let id = page.raw.parentid;
  const seen = new Set<string>();
  while (typeof id === 'string' && !seen.has(id)) {
    seen.add(id);
    const node = graph.nodes.get(id);
    if (!node) throw new Error(`Source page context ${id} is missing`);
    if (node.kind === 'RootNode') return node;
    id = node.raw.parentid;
  }
}
export function sourcePageRoute(graph: SourceGraph, page: SourceNode): string {
  const segment = (graph.byKind.get('RouteSegmentNode') ?? []).map(id => graph.nodes.get(id)!).find(node => node.raw.webPageId === page.id);
  let route: unknown;
  if (segment) {
    const parts: string[] = [], seen = new Set<string>();
    let cursor: SourceNode | undefined = segment;
    while (cursor?.kind === 'RouteSegmentNode') {
      if (seen.has(cursor.id) || typeof cursor.raw.segment !== 'string') throw new Error('Invalid source route hierarchy');
      seen.add(cursor.id); parts.unshift(cursor.raw.segment);
      cursor = typeof cursor.raw.parentid === 'string' ? graph.nodes.get(cursor.raw.parentid) : undefined;
    }
    if (cursor?.kind !== 'RouteSegmentRootNode') throw new Error('Source route root is unavailable');
    route = '/' + parts.join('/');
  } else route = documentFor(graph, page)?.raw.homePageNodeId === page.id ? '/' : page.raw.pagePath;
  if (typeof route === 'string' && page.raw.dataIdentifier !== undefined) {
    const match = /^(\/(?:[\p{L}\p{N}_-]+\/)*):([\w-]+)$/u.exec(route);
    if (match) {
      let collectionId: string | undefined;
      try { collectionId = sourceCollectionId(page.raw.dataIdentifier); } catch { /* invalid source route is rejected below */ }
      const collection = collectionId ? graph.nodes.get(collectionId) : undefined;
      if (collectionId && collection?.kind === 'CollectionNode' && sourceVariables(graph, collectionId).some(variable => variable.type === 'slug' && variable.id === match[2])) return `${match[1]}[slug]`;
    }
  }
  if (typeof route !== 'string' || !/^\/(?:[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)?$/u.test(route)) throw new Error(`Source route requires a native route/CMS adapter: ${String(route)}`);
  return route;
}
const routeOfFile = (path: string) => path.replace(/^app\//, '/').replace(/\([^/]+\)\//g, '').replace(/\/(?:page\.client|page)\.tsx$/, '').replace(/\[[^/\]]+\]/g, '[slug]') || '/';

/** Static pages use the same original scene, bindings and native responsive writers. */
export function emitNativePages(graph: SourceGraph, identity: Record<string, string>, options: NativePageOptions): NativePageResult {
  trace.fn('framer-native.emitPages');
  const result: NativePageResult = { files: [], createdIds: [], identity, diagnostics: [...graph.diagnostics], routes: {} };
  const fatalErrors = result.diagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID');
  if (fatalErrors.length) return result;
  const pageIds = (graph.byKind.get('WebPageNode') ?? []).filter(id => graph.reachable.has(id)).sort();
  const templateIds = (graph.byKind.get('LayoutTemplateNode') ?? []).filter(id => graph.reachable.has(id)).sort();
  const ids = [...templateIds, ...pageIds];
  if (!ids.length) return result;
  let active: string | undefined;
  try {
    const originalRoutes = new Map(pageIds.map(id => [id, sourcePageRoute(graph, graph.nodes.get(id)!)]));
    if (new Set(originalRoutes.values()).size !== pageIds.length) throw new Error('Duplicate source page routes');
    const originalSet = new Set([...originalRoutes.values()].map(route => route.toLowerCase()));
    const used = new Set([...options.existingPaths].filter(path => /^app\/.+page(?:\.client)?\.tsx$|^app\/page(?:\.client)?\.tsx$/.test(path)).map(path => routeOfFile(path).toLowerCase()));
    if (options.replaceHomePage) used.delete('/');
    if (options.overwrite) used.clear();
    let prefix = '';
    const collides = (prefix: string) => (prefix !== '' && originalSet.has(prefix.toLowerCase())) || [...originalRoutes.values()].some(route => used.has((prefix + (route === '/' ? '' : route) || '/').toLowerCase()) || /^\/api(?:\/|$)/.test(prefix + route));
    if (collides(prefix)) {
      const baseId = pageIds.find(id => originalRoutes.get(id) === '/') ?? pageIds[0];
      prefix = `/${identity[baseId]}`;
      for (let suffix = 2; collides(prefix); suffix++) prefix = `/${identity[baseId]}-${suffix}`;
    }
    for (const [id, route] of originalRoutes) result.routes[id] = prefix + (route === '/' ? '' : route) || '/';
    const groups = new Map<string, string>();
    for (const id of templateIds) {
      let name = identity[id];
      if (!name) throw new Error(`Missing template identity ${id}`);
      for (let suffix = 2; (!options.overwrite && [...options.existingPaths].some(path => path.startsWith(`app/(${name})/`))) || [...groups.values()].includes(name); suffix++) name = `${identity[id]}-${suffix}`;
      groups.set(id, name);
    }
    const anchors = new Set<string>(), writtenAnchors = new Set<string>();
    const templateForPage = new Map<string, string>();
    for (const id of pageIds) {
      const page = graph.nodes.get(id)!;
      const identifier = page.raw.layoutTemplateIdentifierOverride !== undefined ? page.raw.layoutTemplateIdentifierOverride : documentFor(graph, page)?.raw.layoutTemplateIdentifier;
      if (identifier === undefined) continue;
      const match = typeof identifier === 'string' && /^local-module:layoutTemplate\/([^:]+):default$/.exec(identifier);
      if (!match || !groups.has(match[1])) throw new Error(`Source page template ${String(identifier)} is unavailable`);
      templateForPage.set(id, match[1]);
    }
    const sectionConsumers = new Set<string>(), scrollConsumers = new Set<string>(), sourceStrings: string[] = [];
    let hasActiveScrollVariant = false;
    const scanConsumers = (value: unknown, scrollTargets = false): void => {
      if (typeof value === 'string') { sourceStrings.push(value); return; }
      if (Array.isArray(value)) { value.forEach(item => scanConsumers(item, scrollTargets)); return; }
      const object = sourceRecord(value);
      if (!object) return;
      if (object.appearEffectEnabled === true) hasActiveScrollVariant = true;
      if (object.type === 'variableReference' && typeof object.providerId === 'string' && typeof object.id === 'string') {
        (scrollTargets ? scrollConsumers : sectionConsumers).add(sourceVariableKey(object.providerId, object.id));
      }
      for (const [key, item] of Object.entries(object)) if (key !== 'children') scanConsumers(item, scrollTargets || key === 'appearEffectScrollTargets');
    };
    for (const id of graph.reachable) {
      const node = graph.nodes.get(id)!;
      if (!isSourceCodeComponent(node)) scanConsumers(node.raw);
    }
    const propTypes: Record<string, string> = { string: 'plainText', number: 'number', boolean: 'toggle', color: 'color', link: 'link', scrollsectionref: 'section', controlReference: 'plainText', enum: 'plainText', padding: 'plainText', borderradius: 'plainText', image: 'image' };
    const templateValue = (providerId: string, variable: Record<string, unknown>, value: unknown): string | number | boolean => {
      const type = variable.type;
      if (value == null) value = type === 'boolean' ? false : type === 'number' ? 0 : '';
      if (type === 'boolean' && typeof value === 'boolean' || type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value as number | boolean;
      if (variable.type === 'controlReference' && variable.controlKey === 'variant') {
        const master = /^local-module:canvasComponent\/([^:]+):/.exec(String(variable.entityIdentifier ?? ''))?.[1];
        if (master && typeof value === 'string') {
          const variantName = sourceInstanceStateName({ graph, scopeId: master }, identity, value);
          if (variantName) return variantName;
        }
      }
      if (type === 'scrollsectionref' && value !== '') {
        const target = sourceRecord(value)?.target;
        if (typeof target !== 'string') throw new Error(`Invalid template section target ${String(target)}`);
        if (!graph.reachable.has(target)) {
          const key = sourceVariableKey(providerId, String(variable.id));
          // Replica overrides may inherit activation, so any active variant keeps this check conservative.
          if (!sectionConsumers.has(key) && !(hasActiveScrollVariant && scrollConsumers.has(key)) && !sourceStrings.some(text => text.includes(`--variable-reference-${String(variable.id)}-${providerId}`))) {
            trace.action('framer-native.skipInactiveSectionTarget', { providerId, variableId: variable.id, target });
            return '';
          }
          throw new Error(`Missing template section target ${target}`);
        }
        const id = resolveSourceNode(graph, target).sourceId;
        if (!identity[id]) throw new Error(`Missing native section identity ${target}`);
        anchors.add(id);
        return identity[id];
      }
      if (type === 'link') {
        const ref = sourceRecord(value);
        value = sourceStaticLinkValue(value, result.routes);
        if (typeof value === 'string') {
          if (!ref) for (const [pageId, route] of originalRoutes) if (value === route) { value = result.routes[pageId]; break; }
          if (!/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#|$)/i.test(String(value)) || String(value).includes('[slug]')) return '#';
        }
      }
      if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        throw new Error(`Invalid template boolean value for ${String(variable.id)}`);
      }
      if (['string', 'color', 'link', 'scrollsectionref', 'controlReference', 'enum'].includes(String(type)) && typeof value === 'string') return value;
      if (['padding', 'borderradius', 'image'].includes(String(type))) return typeof value === 'string' ? value : String(value ?? '');
      throw new Error(`Invalid template ${String(type)} value for ${String(variable.id)}`);
    };
    const templateProps = new Map(templateIds.map(id => [id, sourceVariables(graph, id).map(variable => {
      const type = propTypes[String(variable.type)] || 'plainText';
      return { variable, type, name: nativePropName(identity, id, String(variable.id)), initial: templateValue(id, variable, variable.initialValue) };
    })]));
    const pageProps = new Map<string, Record<string, string>>();
    for (const [pageId, templateId] of templateForPage) {
      active = pageId;
      const values: Record<string, string> = {};
      for (const prop of templateProps.get(templateId)!) {
        const control = sourceRecord(graph.nodes.get(pageId)!.raw[`$control__${String(prop.variable.id)}`]);
        if (!control || control.value == null) continue;
        const value = templateValue(templateId, prop.variable, control.value);
        if (value === prop.initial) continue;
        if (value === '') throw new Error(`Explicit empty template override ${String(prop.variable.id)} requires its native clear-value adapter`);
        values[prop.name] = String(value);
      }
      pageProps.set(pageId, values);
    }
    const templatePageEffects = new Map<string, PageEffect>();
    for (const pageId of pageIds) {
      active = pageId;
      const page = graph.nodes.get(pageId)!, document = documentFor(graph, page);
      if (Array.isArray(page.raw.pageEffects) && page.raw.pageEffects.length) {
        trace.action('framer-native.skipPageEffects', { pageId });
      }
      let effect: PageEffect | undefined;
      try {
        effect = sourceGlobalPageEffect(document?.raw.globalPageEffect);
      } catch {
        trace.action('framer-native.skipGlobalPageEffect');
      }
      if (!effect) continue;
      const templateId = templateForPage.get(pageId);
      if (!templateId) {
        trace.action('framer-native.skipGlobalPageEffectNoTemplate', { pageId });
        continue;
      }
      const prior = templatePageEffects.get(templateId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(effect)) {
        trace.action('framer-native.skipConflictingGlobalPageEffects', { pageId });
        continue;
      }
      templatePageEffects.set(templateId, effect);
    }
    let hasForms = false;
    for (const id of ids) {
      active = id;
      try {
      const page = graph.nodes.get(id)!, document = documentFor(graph, page);
      const isTemplate = page.kind === 'LayoutTemplateNode';
      const isDetail = !isTemplate && page.raw.dataIdentifier !== undefined;
      if (isDetail && !result.routes[id]?.endsWith('/[slug]')) throw new Error('Source CMS page requires its native page-context adapter');
      if (isDetail && Object.keys(sourceRecord(page.raw.webMetadata) ?? {}).some(key => !['title', 'description', 'socialImage', 'noIndexSite', 'noIndex'].includes(key))) throw new Error('Source CMS page metadata requires its native per-record adapter');
      const collection = isDetail ? nativeCollectionSlug(identity, sourceCollectionId(page.raw.dataIdentifier)) : undefined;
      if (!isTemplate && sourceVariables(graph, id).length) {
        trace.action('framer-native.skipPageVariables', { id, count: sourceVariables(graph, id).length });
      }
      const props = isTemplate ? templateProps.get(id)! : [];
      const group = isTemplate ? groups.get(id) : groups.get(templateForPage.get(id) ?? '');
      const viewports = sourceViewports(graph, id), primary = viewports[0].sourceStateId;
      if (resolveSourceNode(graph, primary).sourceId !== primary) throw new Error('A larger replica breakpoint requires its native baseline adapter');
      const variables = Object.fromEntries(props.map(prop => [`${id}:${String(prop.variable.id)}`, `{${prop.name}}`]));
      const imageFieldFor = (value: unknown, node: ResolvedSourceNode) => {
        if (isTemplate || sourceRecord(value)?.type !== 'variableReference') return;
        try {
          const binding = resolveSourceBinding(value, { graph, identity, nodeId: node.sourceId });
          if (binding.kind === 'field' && ['image', 'file'].includes(binding.valueType)) return binding;
        } catch {
          return undefined;
        }
      };
      const intrinsicImageFieldFor = (node: ResolvedSourceNode) => node.kind === 'FrameNode' && !node.children.length && node.properties.fillEnabled === true && node.properties.fillType === 'image' && node.properties.heightType === 5 && !(typeof node.properties.fillImagePixelWidth === 'number' && typeof node.properties.fillImagePixelHeight === 'number' && node.properties.fillImagePixelHeight > 0) && !(typeof node.properties.aspectRatio === 'number' && node.properties.aspectRatio > 0)
        ? imageFieldFor(node.properties.fillImage, node) : undefined;
      const context: SourceMappingContext = { graph, typographyIdentity: identity, diagnostics: [], variables, assets: options.assets, cmsImageField: (value, node) => Boolean(imageFieldFor(value, node)), supportedLoops: true, supportedMountEffects: true, supportedFlowEffects: true, supportedForms: true, supportedCustomCursors: true, viewport: { width: viewports[0].designWidth!, height: viewports[0].viewportHeight }, routes: result.routes };
      const visibilityFor = (node: ResolvedSourceNode) => {
        if (!sourceRecord(node.properties.visible)) return undefined;
        try {
          const binding = resolveSourceBinding(node.properties.visible, { graph, identity, nodeId: node.sourceId });
          if (isTemplate && binding.kind === 'variable' && binding.providerId === id && binding.valueType === 'boolean') return binding;
          if (!isTemplate && ((binding.kind === 'field' && binding.valueType === 'boolean') || (binding.kind === 'transform' && binding.name === 'isSet' && binding.input.kind === 'field'))) return binding;
        } catch {
          trace.action('framer-native.skipVisibilityBinding', { sourceId: node.sourceId });
        }
        return undefined;
      };
      const stylesFor = (node: ResolvedSourceNode, ctx: SourceMappingContext) => {
        const styles = mapSourceStyles(visibilityFor(node) ? { ...node, properties: { ...node.properties, visible: true } } : node, ctx);
        if (intrinsicImageFieldFor(node)) {
          delete styles.backgroundImage; delete styles.backgroundPosition; delete styles.backgroundRepeat; delete styles.backgroundSize;
          styles.objectFit = node.properties.fillImageResize === 'fit' ? 'contain' : 'cover';
        }
        if (node.kind === 'RichTextNode') Object.assign(styles, mapSourceText(node, ctx).styles);
        if (node.sourceId === primary) {
          styles.width = '100%'; styles.position = 'relative';
          if (isTemplate) {
            styles.height = 'auto';
            styles.minHeight = '100%';
            delete styles.overflow;
          }
          for (const key of ['left', 'right', 'top', 'bottom']) delete styles[key];
        } else if (ctx.parent && ['stack', 'grid'].includes(String(ctx.parent.properties.layout)) && !['absolute', 'fixed'].includes(styles.position)) {
          styles.order = String(ctx.parent.children.indexOf(node.sourceId));
          if (ctx.parent.properties.layout === 'stack') {
            styles.flex = styles.flexGrow ? `${styles.flexGrow} 0 ${styles.flexBasis ?? '0px'}` : '0 0 auto';
            delete styles.flexGrow; delete styles.flexShrink; delete styles.flexBasis;
          }
        }
        return styles;
      };
      const isNeverVisible = (node: ResolvedSourceNode) => {
        if (node.properties.visible !== false) return false;
        try {
          return viewports.slice(1).every(vp => {
            try {
              return resolveSourceNode(graph, node.sourceId, vp.sourceStateId).properties.visible === false;
            } catch {
              return true;
            }
          });
        } catch {
          return false;
        }
      };
      const scene = emitSourceScene(graph, identity, primary, context, {
        stylesFor: (node, parent) => stylesFor(node, { ...context, parent }),
        codeComponents: options.codeComponents,
        template: isTemplate,
        assets: options.assets,
        isNeverVisible,
        intrinsicImageFor: node => { const field = intrinsicImageFieldFor(node); return field ? `${field.itemVar}.${field.fieldId}` : undefined; },
        expressionFor: (value, node) => {
          const binding = resolveSourceBinding(value, { graph, identity, nodeId: node.sourceId });
          const expr = (b: import('./bindings').NativeBinding): string => {
            if (b.kind === 'field') {
              if (b.fieldId === 'repeater_item_count') {
                const staticText = typeof node.properties.html === 'string' ? node.properties.html.replace(/<[^>]+>/g, '').trim() : '';
                return JSON.stringify(staticText || '10');
              }
              return `${b.itemVar}.${b.fieldId.replace(/\./g, '?.')}`;
            }
            if (isTemplate && b.kind === 'variable' && b.providerId === id) return b.name;
            if (b.kind === 'transform') {
              if (b.name === 'prefix') return `${b.value ?? ''}{${expr(b.input)}}`;
              return expr(b.input);
            }
            if (b.kind === 'literal') return JSON.stringify(String(b.value ?? ''));
            if (b.kind === 'variable') return b.name;
            if (options.tolerant) return "''";
            throw new Error('Source page text requires its native binding adapter');
          };
          return expr(binding);
        },
      });
      if (isTemplate ? scene.slots.length !== 1 : scene.slots.length !== 0) throw new Error('A native template requires one children slot; pages cannot own template slots');
      const signature = isTemplate ? `LayoutClient({ children${props.map(prop => `, ${prop.name} = ${JSON.stringify(prop.initial)}`).join('')} }: { children: React.ReactNode${props.map(prop => `; ${prop.name}?: ${typeof prop.initial}`).join('')} })` : isDetail ? 'Page({ item: serverItem }: { item?: any } = {})' : 'Page()';
      const jsx = isTemplate ? scene.jsx : `<div data-id="root"${isDetail ? " key={String(params?.slug ?? '')}" : ''} style={{position:'relative',width:'100%'}}>${scene.jsx}</div>`;
      const detailSetup = isDetail ? `/** @cmsPage { "collection": "${collection}", "kind": "detail" } */\nimport { useParams } from 'next/navigation';\nimport { useLocale } from 'next-intl';\nimport { localizeRows } from '@revyme/runtime';\nimport rows from '@/cms/${collection}.json';\n` : '';
      const detailBody = isDetail ? 'const params = useParams(); const locale = useLocale(); const rawItem = serverItem ?? (rows.find(row => row._slug === params?.slug) ?? rows[0]); const item = rawItem ? (localizeRows([rawItem], locale)[0] || rawItem) : undefined; if (!item) return null; ' : '';
      const reducedMotion = sourceRecord(document?.raw.webMetadata)?.reducedMotion;
      const motionPolicy = typeof reducedMotion === 'boolean' ? reducedMotion ? 'user' : 'never' : undefined;
      const pageJsx = motionPolicy ? `<MotionConfig reducedMotion="${motionPolicy}">${jsx}</MotionConfig>` : jsx;
      const bodyPrefix = detailBody ? `${detailBody}\n  ` : '';
      let code = `"use client";\nimport React from 'react';\n${motionPolicy ? 'import { MotionConfig } from "framer-motion";\n' : ''}${detailSetup}export default function ${signature} {\n  ${bodyPrefix}return ${pageJsx};\n}`;
      for (const prop of props) {
        code = setPropTypeInCode(code, prop.name, prop.type);
        code = setPropLabelInCode(code, prop.name, String(prop.variable.name ?? prop.variable.id));
      }
      code = applySourceInstances(code, scene, graph, identity, options.assets, { allowOverlayEvents: true, routes: result.routes, tolerant: options.tolerant });
      const parentOf = new Map<string, string>();
      for (const nodeId of scene.sourceIds) for (const childId of resolveSourceNode(graph, nodeId).children) parentOf.set(childId, nodeId);
      const formSet = new Set(scene.forms);
      const enclosingFormFor = (nodeId: string): string | undefined => {
        let cursor = parentOf.get(nodeId);
        while (cursor) {
          if (formSet.has(cursor)) return cursor;
          cursor = parentOf.get(cursor);
        }
      };
      const formButtonPairs = [
        ['loading', 'formButtonPendingVariantEnabled', 'formButtonPendingVariant'],
        ['success', 'formButtonSuccessVariantEnabled', 'formButtonSuccessVariant'],
        ['error', 'formButtonErrorVariantEnabled', 'formButtonErrorVariant'],
        ['disabled', 'formButtonIncompleteVariantEnabled', 'formButtonIncompleteVariant'],
      ] as const;
      for (const controlId of scene.formControls) if (!enclosingFormFor(controlId)) throw new Error(`Form control ${controlId} must live inside a form container`);
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        if (formButtonPairs.some(([, enabledKey]) => node.properties[enabledKey] === true) && !enclosingFormFor(nodeId)) throw new Error(`Form submit button ${nodeId} must live inside a form container`);
      }
      for (const formId of scene.forms) {
        if (enclosingFormFor(formId)) throw new Error(`Nested form container ${formId} requires its native form adapter`);
        hasForms = true;
        const formNode = resolveSourceNode(graph, formId), formTargetId = identity[formId], stateVar = formStateVar(formTargetId);
        const submitButtonId = formNode.properties.formSubmitButtonId;
        if (submitButtonId != null && (typeof submitButtonId !== 'string' || enclosingFormFor(submitButtonId) !== formId)) throw new Error(`Form submit button ${String(submitButtonId)} on ${formId} is outside the form`);
        for (const nodeId of scene.sourceIds) {
          if (enclosingFormFor(nodeId) !== formId) continue;
          const buttonNode = resolveSourceNode(graph, nodeId);
          if (formButtonPairs.some(([, enabledKey]) => buttonNode.properties[enabledKey] === true)) {
            const master = scene.nested.get(nodeId);
            if (!master || sourceMountEffects(buttonNode.properties)) throw new Error(`Form submit button ${nodeId} requires its native form state adapter`);
            const baseVariant = sourceRecord(buttonNode.properties.$control__variant)?.value;
            if (baseVariant !== undefined && sourceInstanceStateName({ graph, scopeId: master }, identity, baseVariant) !== 'default') throw new Error(`Form submit button ${nodeId} idle variant requires its native form state adapter`);
            const mapping: FormStateMapping = {};
            for (const [stateKey, enabledKey, variantKey] of formButtonPairs) {
              if (buttonNode.properties[enabledKey] !== true) continue;
              const targetVariant = sourceInstanceStateName({ graph, scopeId: master }, identity, buttonNode.properties[variantKey]);
              if (!targetVariant) throw new Error(`Missing form button variant ${String(buttonNode.properties[variantKey])} on ${nodeId}`);
              mapping[stateKey] = targetVariant;
            }
            code = setFormStateMappingInCode(code, identity[nodeId], stateVar, mapping);
          } else if (nodeId === submitButtonId && buttonNode.kind === 'FrameNode' && buttonNode.properties.htmlTag === 'button') {
            code = setTagAttr(code, identity[nodeId], 'type', '"submit"');
          }
        }
        code = wireFormSubmitInCode(code, formTargetId, hasFormStateDeclaration(code, stateVar) ? formStateSetter(stateVar) : undefined);
      }
      if (isDetail && scene.sourceIds.some(id => graph.nodes.get(id)!.kind === 'OverlayNode')) throw new Error('Source CMS detail overlay requires its native hook-order adapter');
      const overlays = applySourceOverlays(code, scene.sourceIds, graph, identity, viewports.slice(1), viewports[0].width);
      code = overlays.code;
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        const compId = node.properties.customCursorSmartComponentId;
        if (node.properties.customCursorType === 'component' && typeof compId === 'string' && graph.nodes.has(compId)) {
          const compName = nativeComponentName(identity, compId);
          code = addComponentCursorInCode(code, identity[nodeId], {
            componentName: compName,
            componentImportPath: `@/components/${compName}`,
          });
        }
        if (!isSourceCodeComponent(node)) for (const [property, value] of Object.entries(node.properties)) if (/^on[A-Z]/.test(property) && Array.isArray(value) && value.length && !overlays.handled.has(`${nodeId}:${property}`)) {
          if (!options.tolerant) throw new Error(`Source page action ${property} requires its native adapter`);
        }
        const override = isSourceCodeComponent(node) ? undefined : activeSourceCodeOverride(node.properties);
        if (override) {
          const ref = options.overrides?.[override];
          if (!ref) throw new Error(`Source page override ${override} is unavailable`);
          code = setCodeOverridesInCode(code, identity[nodeId], [ref]);
        }
        for (const viewport of viewports.slice(1)) {
          const state = resolveSourceNode(graph, nodeId, viewport.sourceStateId);
          const semanticProperties = new Set(['link', 'linkOpenInNewTab', 'visible', 'htmlTag', 'dataIdentifier', 'collectionFilters', 'collectionOrder', 'collectionLimit', 'collectionOffset', 'collectionReverse', 'codeComponentIdentifier', 'codeOverrideIdentifier', 'codeOverrideEnabled', 'isFormContainer', 'formSubmitButtonId', 'formTextInputType', 'formInputName', 'formInputPlaceholder', 'formInputRequired', 'formInputValue', 'formSelectOptions', 'formInputPlaceholderColor', 'formInputFocusedBorderColor', 'formInputFocusedBorderWidth', 'formInputFocusedBorderStyle', 'formInputFocusedBorderPerSide', 'formInputFocusedBorderTop', 'formInputFocusedBorderRight', 'formInputFocusedBorderBottom', 'formInputFocusedBorderLeft', 'formButtonPendingVariantEnabled', 'formButtonPendingVariant', 'formButtonSuccessVariantEnabled', 'formButtonSuccessVariant', 'formButtonErrorVariantEnabled', 'formButtonErrorVariant', 'formButtonIncompleteVariantEnabled', 'formButtonIncompleteVariant']);
          if ([node.properties.visible, state.properties.visible].every(value => value === undefined || typeof value === 'boolean')) semanticProperties.delete('visible');
          if (isSourceCodeComponent(node)) for (const key of ['link', 'linkOpenInNewTab', 'codeComponentIdentifier', 'codeOverrideIdentifier', 'codeOverrideEnabled']) semanticProperties.delete(key);
          else for (const key of [...Object.keys(node.properties), ...Object.keys(state.properties)]) if (key.startsWith('$control__') || /^on[A-Z]/.test(key)) semanticProperties.add(key);
          if (node.kind === 'CodeComponentNode' && !isSourceCodeComponent(node)) {
            const master = /^local-module:canvasComponent\/([^:]+):/.exec(String(node.properties.codeComponentIdentifier))?.[1];
            if (master && JSON.stringify(state.properties.$control__variant) !== JSON.stringify(node.properties.$control__variant)) {
              const sourceVariant = sourceRecord(state.properties.$control__variant)?.value;
              let target = master && typeof sourceVariant === 'string' ? sourceInstanceStateName({ graph, scopeId: master }, identity, sourceVariant) : undefined;
              if (master && typeof sourceVariant === 'object' && sourceVariant !== null) {
                const compVal = sourceVariant as Record<string, unknown>;
                const transform = Array.isArray(compVal.transforms) ? sourceRecord(compVal.transforms[0]) : undefined;
                if (transform?.name === 'convertFromBoolean') {
                  const truthy = typeof transform.truthy === 'string' ? sourceInstanceStateName({ graph, scopeId: master }, identity, transform.truthy) : undefined;
                  const falsy = typeof transform.falsy === 'string' ? sourceInstanceStateName({ graph, scopeId: master }, identity, transform.falsy) : undefined;
                  const startRef = sourceRecord(compVal.startValue);
                  const startProp = startRef?.type === 'variableReference' && typeof startRef.id === 'string'
                    ? nativePropName(identity, String(startRef.providerId), startRef.id)
                    : undefined;
                  if (startProp && truthy && falsy) {
                    code = setResponsiveBindingOverride(code, identity[nodeId], nativeComponentName(identity, master), viewport.width, 'initialVariant', { kind: 'field', expr: `${startProp} ? ${JSON.stringify(truthy)} : ${JSON.stringify(falsy)}` });
                    semanticProperties.delete('$control__variant');
                    target = undefined;
                  } else if (falsy) {
                    target = falsy;
                  }
                }
              }
              if (target) {
                if (node.properties.whileOpenEffectEnabled === true) {
                  const overlay = parseOverlayCalls(code).find(item => item.config.triggerId === identity[nodeId]);
                  const open = overlay && resolveOverlayConfigForWidth(overlay.config, viewport.width).onOpenVariant;
                  if (!overlay || !open) throw new Error(`Responsive overlay variant on ${nodeId} requires its native composition adapter`);
                  code = setResponsiveBindingOverride(code, identity[nodeId], nativeComponentName(identity, master), viewport.width, 'initialVariant', { kind: 'field', expr: `${stateVarName(overlay.overlayId)} ? ${JSON.stringify(open)} : ${JSON.stringify(target)}` });
                } else code = setResponsiveOverride(code, identity[nodeId], nativeComponentName(identity, master), viewport.width, 'initialVariant', target, null);
              }
              semanticProperties.delete('$control__variant');
            }
            if (master) {
              const variables = sourceVariables(graph, master);
              for (const prop of [...semanticProperties]) {
                if (!prop.startsWith('$control__') || prop === '$control__variant') continue;
                const sourceProp = prop.slice(10);
                const variable = variables.find(v => v.id === sourceProp);
                if (!variable) {
                  semanticProperties.delete(prop);
                  continue;
                }
                const extractVal = (raw: unknown) => {
                  if (raw == null) return undefined;
                  const rec = sourceRecord(raw);
                  if (rec && 'value' in rec) return rec.value;
                  return raw;
                };
                const stateVal = extractVal(state.properties[prop]);
                const baseVal = extractVal(node.properties[prop]);
                if (stateVal !== undefined && JSON.stringify(stateVal) !== JSON.stringify(baseVal)) {
                  const propName = nativePropName(identity, master, sourceProp);
                  const strVal = typeof stateVal === 'object' ? JSON.stringify(stateVal) : String(stateVal);
                  const strBase = baseVal !== undefined ? (typeof baseVal === 'object' ? JSON.stringify(baseVal) : String(baseVal)) : null;
                  code = setResponsiveOverride(code, identity[nodeId], nativeComponentName(identity, master), viewport.width, propName, strVal, strBase);
                }
                semanticProperties.delete(prop);
              }
            }
          }
          for (const property of semanticProperties) if (JSON.stringify(state.properties[property]) !== JSON.stringify(node.properties[property])) {
            if (!options.tolerant) throw new Error(`Responsive ${property} on ${nodeId} requires its native adapter`);
          }
          if (node.kind === 'RichTextNode') {
            const base = mapSourceText(node, context), text = mapSourceText(state, context);
            if (base.tag === text.tag && !base.binding && !text.binding && (base.plainText !== text.plainText || base.jsx !== text.jsx)) {
              const allWidths = viewports.map(v => v.width);
              code = setTextOverrideInCode(code, identity[nodeId], viewport.width, viewports[0].width, text.plainText, allWidths);
              continue;
            }
            if (base.tag !== text.tag || base.jsx !== text.jsx || JSON.stringify(base.binding) !== JSON.stringify(text.binding) || JSON.stringify(base.attributes) !== JSON.stringify(text.attributes)) throw new Error(`Responsive text content on ${nodeId} requires its native text adapter`);
          }
        }
      }
      code = transformAllResponsiveAttrs(code, model => { model.bp = viewports.map(viewport => viewport.width).sort((a, b) => a - b); });
      const isRedundantAncestorLink = (nodeId: string): boolean => {
        const hasDescendantWithLink = (checkId: string): boolean => {
          const n = resolveSourceNode(graph, checkId);
          for (const childId of n.children) {
            const child = resolveSourceNode(graph, childId);
            if (scene.links.includes(childId)) return true;
            if (child.kind === 'CodeComponentNode') {
              const hasLinkProp = Object.values(child.properties).some(val => {
                const r = sourceRecord(val);
                return r?.type === 'link' || (r?.type === 'webPage' && typeof r?.webPageId === 'string');
              });
              if (hasLinkProp) return true;
            }
            if (hasDescendantWithLink(childId)) return true;
          }
          return false;
        };
        return hasDescendantWithLink(nodeId);
      };
      for (const nodeId of scene.links) {
        if (isRedundantAncestorLink(nodeId)) continue;
        const node = resolveSourceNode(graph, nodeId);
        const pageLink = sourceRecord(node.properties.link);
        if (isTemplate && pageLink?.type === 'variableReference') {
          const binding = resolveSourceBinding(node.properties.link, { graph, identity, nodeId });
          if (binding.kind !== 'variable' || binding.providerId !== id || binding.valueType !== 'link') throw new Error(`Template link on ${nodeId} requires its native variable adapter`);
          code = convertToMotionLinkInCode(code, identity[nodeId]);
          code = setTagAttr(code, identity[nodeId], 'href', `{${binding.name}}`);
          if (typeof node.properties.linkOpenInNewTab === 'boolean') code = setTagAttr(code, identity[nodeId], 'target', JSON.stringify(node.properties.linkOpenInNewTab ? '_blank' : '_self'));
          continue;
        }
        if (pageLink?.type === 'webPage' && pageLink.pathVariables !== undefined) {
          if (Object.keys(pageLink).some(key => !['type', 'webPageId', 'pathVariables'].includes(key)) || typeof pageLink.webPageId !== 'string') throw new Error('Source page link parameters/section require their native adapter');
          const targetPage = graph.nodes.get(pageLink.webPageId), targetRoute = result.routes[pageLink.webPageId];
          if (targetPage?.kind !== 'WebPageNode' || targetPage.raw.dataIdentifier === undefined || !targetRoute?.endsWith('/[slug]')) throw new Error(`Source page link on ${nodeId} requires a CMS detail route`);
          const targetCollectionId = sourceCollectionId(targetPage.raw.dataIdentifier);
          const entries = Object.entries(sourceRecord(pageLink.pathVariables) ?? {});
          if (entries.length !== 1) throw new Error(`Source page link parameters on ${nodeId} require their native adapter`);
          const [paramId, rawBinding] = entries[0];
          const binding = resolveSourceBinding(rawBinding, { graph, identity, nodeId });
          if (binding.kind !== 'field' || binding.collectionId !== targetCollectionId || binding.sourceId !== paramId || binding.valueType !== 'slug' || graph.nodes.get(binding.providerId)?.kind === 'WebPageNode') throw new Error(`Source page link binding on ${nodeId} requires its native adapter`);
          const prefix = targetRoute.slice(0, -'/[slug]'.length);
          code = convertToMotionLinkInCode(code, identity[nodeId]);
          code = setTagAttr(code, identity[nodeId], 'data-cms-nav', '"row"');
          code = setTagAttr(code, identity[nodeId], 'href', `{\`${prefix}/\${${binding.itemVar}?._slug ?? ''}\`}`);
          if (typeof node.properties.linkOpenInNewTab === 'boolean') code = setTagAttr(code, identity[nodeId], 'target', JSON.stringify(node.properties.linkOpenInNewTab ? '_blank' : '_self'));
          continue;
        }
        const resolvedLink = sourceStaticLinkValue(node.properties.link, result.routes);
        if (typeof resolvedLink !== 'string') throw new Error(`Source link on ${nodeId} requires its native route adapter`);
        let href: string = resolvedLink;
        if (typeof node.properties.link === 'string') for (const [pageId, route] of originalRoutes) if (href === route) { href = result.routes[pageId]; break; }
        if (href.includes('[slug]')) throw new Error(`Source link on ${nodeId} requires a dynamic record adapter`);
        code = convertToMotionLinkInCode(code, identity[nodeId]);
        code = setTagAttr(code, identity[nodeId], 'href', JSON.stringify(href));
        if (typeof node.properties.linkOpenInNewTab === 'boolean') code = setTagAttr(code, identity[nodeId], 'target', JSON.stringify(node.properties.linkOpenInNewTab ? '_blank' : '_self'));
      }
      for (const nodeId of [...scene.sourceIds].reverse()) if (graph.nodes.get(nodeId)!.raw.dataIdentifier !== undefined) {
        const rawNode = graph.nodes.get(nodeId)!.raw;
        const repId = rawNode.repeatedItemId;
        const repNode = typeof repId === 'string' && graph.nodes.has(repId) ? resolveSourceNode(graph, repId) : null;
        const isDummy = repNode && repNode.properties.visible === false && (!repNode.properties.width || repNode.properties.width === 0) && (!repNode.properties.height || repNode.properties.height === 0) && (!repNode.children || repNode.children.length === 0);
        if (isDummy) continue;

        let templateJSX: string | undefined;
        let templateTargetId: string | undefined;
        if (typeof repId === 'string' && identity[repId]) {
          const itemStart = findJSXElementByDataId(code, identity[repId]);
          if (itemStart !== -1) {
            const itemRange = findClosingTag(code, itemStart);
            if (itemRange) {
              templateJSX = code.slice(itemRange.tagStart, itemRange.closeTagEnd).trim();
              templateTargetId = identity[repId];
            }
          }
        }
        if (!templateJSX) {
          const range = findClosingTag(code, findJSXElementByDataId(code, identity[nodeId]));
          if (!range) throw new Error('Native list container is missing');
          templateJSX = code.slice(range.contentStart, range.closeTagStart).trim();
        }
        code = emitSourceQueryInCode(code, identity[nodeId], nodeId, templateJSX, { graph, identity, nodeId, tolerant: options.tolerant, assets: options.assets }, templateTargetId);
      }
      code = applyNativeResponsive(code, { graph, scopeId: id, context, stylesFor }, identity);
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        const baseImage = node.properties.fillEnabled === true && node.properties.fillType === 'image';
        const field = baseImage ? imageFieldFor(node.properties.fillImage, node) : undefined;
        for (const viewport of viewports.slice(1)) {
          const state = resolveSourceNode(graph, nodeId, viewport.sourceStateId);
          const stateImage = state.properties.fillEnabled === true && state.properties.fillType === 'image';
          const stateField = stateImage ? imageFieldFor(state.properties.fillImage, state) : undefined;
          if ((field || stateField) && (!field || !stateField || field.fieldId !== stateField.fieldId || Boolean(intrinsicImageFieldFor(node)) !== Boolean(intrinsicImageFieldFor(state)))) throw new Error(`Responsive CMS image on ${nodeId} requires its native binding adapter`);
        }
        if (!field) continue;
        code = bindFieldInCode(code, identity[nodeId], intrinsicImageFieldFor(node) ? 'src' : 'backgroundImage', field.fieldId, field.itemVar, field.valueType);
      }
      for (const controlId of scene.formControls) {
        const controlNode = resolveSourceNode(graph, controlId);
        const pseudo = sourceFormControlPseudoStyles(controlNode, context);
        if (pseudo.placeholder) code = updatePseudoStyleInCode(code, identity[controlId], 'placeholder', pseudo.placeholder);
        if (pseudo.focus) code = updatePseudoStyleInCode(code, identity[controlId], 'focus', pseudo.focus);
      }
      for (const nodeId of scene.sourceIds) {
        if (anchors.has(nodeId)) { code = setTagAttr(code, identity[nodeId], 'id', JSON.stringify(identity[nodeId])); writtenAnchors.add(nodeId); }
        const node = resolveSourceNode(graph, nodeId), binding = visibilityFor(node);
        if (!binding) continue;
        const display = stylesFor(node, context).display;
        for (const viewport of viewports.slice(1)) {
          try {
            if (stylesFor(resolveSourceNode(graph, nodeId, viewport.sourceStateId), context).display !== display) {
              trace.action('framer-native.skipResponsiveDisplayMismatch', { nodeId });
            }
          } catch {}
        }
        if (binding.kind === 'variable') {
          const prop = props.find(prop => prop.name === binding.name)!;
          code = createConditionalVariableInCode(code, identity[nodeId], 'display', prop.name, display || 'block', 'none', prop.initial === true ? 'true' : 'false');
        } else if (binding.kind === 'field' || (binding.kind === 'transform' && binding.name === 'isSet' && binding.input.kind === 'field')) {
          const field = binding.kind === 'field' ? binding : binding.input;
          if (field.kind !== 'field') throw new Error(`Missing visibility field on ${nodeId}`);
          const expr = binding.kind === 'field'
            ? `${field.itemVar}.${field.fieldId}`
            : `(${cmsPropBindingExpression(field.itemVar, { field: field.fieldId, transform: 'isSet' })})`;
          code = setStyleEntryInCode(code, identity[nodeId], 'display', `${expr} ? ${JSON.stringify(display || 'block')} : "none"`);
        }
      }
      if (isTemplate) for (const [pageId, templateId] of templateForPage) if (templateId === id) for (const [name, value] of Object.entries(pageProps.get(pageId)!)) code = setTemplateRouteValueInCode(code, result.routes[pageId], name, value, props.map(prop => prop.name));
      if (!isTemplate) code = updateTemplatePropsInCode(code, pageProps.get(id) ?? {});
      code = code.replace(/(\/\*\* @(?:propMeta|templateProps) )([\s\S]*?)( \*\/)/g, (_all, before, json, after) => before + json.replace(/\*\//g, '*\\/') + after);
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        const mount = sourceMountEffects(node.properties);
        const responsiveMounts: Array<{ width: number; spec: NonNullable<ReturnType<typeof sourceMountEffects>> }> = [];
        for (const viewport of viewports.slice(1)) {
          const viewportMount = sourceMountEffects(resolveSourceNode(graph, nodeId, viewport.sourceStateId).properties);
          if (Boolean(viewportMount) !== Boolean(mount)) throw new Error(`Responsive on-mount effect on ${nodeId} requires its native adapter`);
          if (viewportMount) {
            if (viewportMount.trigger !== mount?.trigger) throw new Error(`Responsive appearance trigger mismatch on ${nodeId} requires its native adapter`);
            responsiveMounts.push({ width: viewport.width, spec: viewportMount });
          }
        }
        if (mount) {
          if (node.properties.loopEffectEnabled === true) throw new Error(`On-mount effect composition on ${nodeId} requires its native adapter`);
          if (scene.nested.has(nodeId) || scene.codeInstances.has(nodeId)) {
            const wrapped = wrapInstanceForPresence(code, identity[nodeId]);
            code = wrapped.code; scene.optionIds.push(wrapped.contentId);
          }
          code = applySourceMountEffects(code, identity[nodeId], mount, responsiveMounts);
        }
        if (isSourceCodeComponent(node)) continue;
        const spec = sourceRotationLoop(node.properties);
        for (const viewport of viewports.slice(1)) if (JSON.stringify(sourceRotationLoop(resolveSourceNode(graph, nodeId, viewport.sourceStateId).properties)) !== JSON.stringify(spec)) {
          if (!options.tolerant) throw new Error(`Responsive loop on ${nodeId} requires its native adapter`);
        }
        if (spec) {
          if (isDetail) {
            if (!options.tolerant) throw new Error(`Loop on CMS detail page ${nodeId} requires its native hook-order adapter`);
          } else if (!['FrameNode', 'RichTextNode'].includes(node.kind)) {
            if (!options.tolerant) throw new Error(`Loop on source component ${nodeId} requires its native adapter`);
          } else {
            try {
              assertLoopOutsideSourceList(graph, nodeId);
              code = applySourceRotationLoop(code, identity[nodeId], spec);
            } catch (err) {
              if (!options.tolerant) throw err;
              context.diagnostics.push({ code: 'SOURCE_PAGE_UNSUPPORTED', sourceId: nodeId, message: err instanceof Error ? err.message : String(err) });
            }
          }
        }
        const flow = sourceFlowEffect(node.properties);
        for (const viewport of viewports.slice(1)) if (JSON.stringify(sourceFlowEffect(resolveSourceNode(graph, nodeId, viewport.sourceStateId).properties)) !== JSON.stringify(flow)) throw new Error(`Responsive flow effect on ${nodeId} requires its native adapter`);
        if (flow) {
          if (node.kind !== 'FrameNode' || mount || spec) throw new Error(`Flow effect composition on ${nodeId} requires its native adapter`);
          for (const childId of node.children) {
            const visibility = [resolveSourceNode(graph, childId).properties.visible, ...viewports.slice(1).map(viewport => resolveSourceNode(graph, childId, viewport.sourceStateId).properties.visible)];
            if (visibility.some(value => value === false)) throw new Error(`CSS-only child visibility with a flow effect on ${childId} requires its native adapter`);
          }
          code = setGlideInCode(code, identity[nodeId], flow);
        }
        const hover = sourceHoverEffect(node.properties);
        if (hover) {
          code = updateMotionPropInCode(code, identity[nodeId], 'whileHover', hover.props);
          if (hover.transition) {
            code = updateMotionPropInCode(code, identity[nodeId], 'transition', hover.transition);
          }
        }
        const tap = sourceTapEffect(node.properties);
        if (tap) {
          code = updateMotionPropInCode(code, identity[nodeId], 'whileTap', tap.props);
          if (tap.transition && !hover?.transition) {
            code = updateMotionPropInCode(code, identity[nodeId], 'transition', tap.transition);
          }
        }
        const speed = sourceScrollSpeed(node.properties);
        if (typeof speed === 'number') {
          const responsiveSpeeds: Array<{ scope: SerScope; speed: number }> = [];
          for (const viewport of viewports.slice(1)) {
            const vpSpeed = sourceScrollSpeed(resolveSourceNode(graph, nodeId, viewport.sourceStateId).properties);
            if (typeof vpSpeed === 'number' && vpSpeed !== speed) {
              responsiveSpeeds.push({ scope: { query: `(max-width: ${viewport.width}px)` }, speed: vpSpeed });
            }
          }
          code = updateScrollSpeedInCode(code, {
            nodeId: identity[nodeId],
            speed,
            ...(responsiveSpeeds.length ? { responsive: responsiveSpeeds } : {}),
          });
        }
      }
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        if (node.kind === 'RichTextNode') {
          const vb = sourceRecord(node.properties.textFitViewBoxSize);
          if (vb && typeof vb.width === 'number' && vb.width > 0) {
            const nodeStyles = stylesFor(node, context);
            const maxFs = parseFloat(nodeStyles.fontSize) || (typeof vb.height === 'number' && vb.height > 0 ? vb.height : 48);
            code = wrapInFitSVGInCode(code, identity[nodeId], {
              width: vb.width,
              height: typeof vb.height === 'number' && vb.height > 0 ? vb.height : 218,
              fontSize: maxFs,
            });
          }
        }
      }
      if (context.diagnostics.length) {
        result.diagnostics.push(...context.diagnostics);
        if (!options.tolerant) throw new Error('Unresolved source page semantics');
      }
      const pageEffect = isTemplate ? templatePageEffects.get(id) : undefined;
      if (pageEffect) code = injectPageTransitionsInCode(code);
      if (code.includes('RevymeSplitText')) code = ensureNamedImport(code, '@revyme/runtime', ['RevymeSplitText']);
      if (/<Link[\s>]/.test(code)) code = ensureNamedImport(code, 'next/link', [], { ensureDefault: 'Link' });
      const route = result.routes[id], folder = 'app' + (group ? `/(${group})` : '') + (isTemplate || route === '/' ? '' : route);
      const path = `${folder}/${isTemplate ? 'LayoutClient' : 'page.client'}.tsx`;
      const projectedPaths = new Set([path, ...[...groups.values()].map(group => `app/(${group})/LayoutClient.tsx`), ...[...templatePageEffects.keys()].flatMap(tid => { const g = groups.get(tid)!; return [`app/(${g})/page-effects.ts`, `app/(${g})/page-effects-runtime.ts`, `app/(${g})/page-transitions.tsx`]; })]);
      const violations = checkFile(code, { kind: isTemplate ? 'template' : 'page', path, projectFiles: projectedPaths });
      const blocking = violations.filter(v => v.tier === 3 || isAgentBlockingOracleViolation(v.code));
      if (blocking.length) throw new Error(`Native page validation: ${blocking.map(violation => `${violation.code} (${violation.message})`).join('; ')}`);
      if (isTemplate) {
        result.files.push({ path, code }, { path: `${folder}/layout.tsx`, code: "import LayoutClient from './LayoutClient';\nexport default function Layout({ children }: { children: React.ReactNode }) { return <LayoutClient>{children}</LayoutClient>; }\n" }, ...(pageEffect ? [{ path: `${folder}/page-effects.ts`, code: serializePageEffects({ __default: pageEffect, pages: {} }) }, { path: `${folder}/page-effects-runtime.ts`, code: PAGE_EFFECTS_RUNTIME_SOURCE }, { path: `${folder}/page-transitions.tsx`, code: PAGE_TRANSITIONS_SOURCE }] : []));
        result.createdIds.push(...scene.sourceIds.map(id => identity[id]), ...scene.optionIds);
        continue;
      }
      if (isDetail) {
        const globalMeta = sourceRecord(document?.raw.webMetadata);
        const defaults: Record<string, unknown> = Object.fromEntries(['title', 'description'].flatMap(key => typeof globalMeta?.[key] === 'string' ? [[key, globalMeta[key]]] : []));
        const pageMeta = sourceRecord(page.raw.webMetadata);
        if (typeof pageMeta?.noIndex === 'boolean') defaults.robotsIndex = !pageMeta.noIndex;
        const expressions: Record<string, string> = {};
        const collectionId = sourceCollectionId(page.raw.dataIdentifier);
        const socialImage = pageMeta?.socialImage ?? globalMeta?.socialImage;
        if (socialImage !== undefined) {
          if (typeof socialImage === 'string') {
            const image = options.assets?.[socialImage];
            if (!image) throw new Error(`Source social image on ${id} requires its native media adapter`);
            defaults.ogImage = image;
          } else if (typeof socialImage === 'object' && socialImage !== null && (socialImage as any).type === 'variableReference') {
            const varRef = socialImage as { id: string };
            const fieldId = nativeFieldId(identity, collectionId, varRef.id);
            expressions.ogImage = `item?.${fieldId} ?? ""`;
          }
        }
        for (const key of ['title', 'description']) {
          const value = pageMeta?.[key];
          if (value === undefined) continue;
          if (typeof value !== 'string') throw new Error(`Unsupported source CMS metadata ${key}`);
          const parts: string[] = [];
          let index = 0;
          for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
            const literal = value.slice(index, match.index);
            if (/[{}]/.test(literal)) throw new Error(`Unsupported source CMS metadata ${key}`);
            parts.push(JSON.stringify(literal));
            const variable = sourceVariables(graph, collectionId).find(item => item.id === match[1]);
            if (variable?.type !== 'string') throw new Error(`Unsupported source CMS metadata field ${match[1]}`);
            parts.push(`item?.${nativeFieldId(identity, collectionId, match[1])} ?? ""`);
            index = match.index! + match[0].length;
          }
          const tail = value.slice(index);
          if (/[{}]/.test(tail)) throw new Error(`Unsupported source CMS metadata ${key}`);
          if (!parts.length) defaults[key] = value;
          else { parts.push(JSON.stringify(tail)); expressions[key] = `[${parts.join(', ')}].join("")`; }
        }
        result.files.push({ path, code }, { path: `${folder}/page.tsx`, code: buildCmsDetailServerWrapper({ collection: collection!, defaults, expressions, apiConfig: null }) });
        result.createdIds.push(...scene.sourceIds.map(id => identity[id]), ...scene.optionIds);
        continue;
      }
      const pageMeta = sourceRecord(page.raw.webMetadata);
      const isProject = graph.transfer.context.mode === 'project';
      const globalMeta = isProject ? undefined : sourceRecord(document?.raw.webMetadata);
      const title = pageMeta?.title ?? globalMeta?.title ?? (isProject ? undefined : page.raw.name ?? 'Page');
      const description = pageMeta?.description ?? globalMeta?.description;
      const metadata: Record<string, unknown> = {};
      if (typeof title === 'string' && title.trim()) metadata.title = title;
      if (typeof description === 'string' && description.trim()) metadata.description = description;
      const fields = Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
      if (typeof pageMeta?.noIndex === 'boolean') fields.push(`robots: { index: ${!pageMeta.noIndex} }`);
      const socialImage = pageMeta?.socialImage ?? globalMeta?.socialImage;
      if (socialImage !== undefined) {
        const image = typeof socialImage === 'string' ? (options.assets?.[socialImage] ?? socialImage) : undefined;
        if (image) fields.push(`openGraph: { images: [${JSON.stringify(image)}] }`);
      }
      result.files.push({ path, code }, { path: `${folder}/page.tsx`, code: `import PageClient from './page.client';\nexport const metadata = { ${fields.join(', ')} };\nexport default function Page(){ return <PageClient />; }\n` });
      result.createdIds.push(...scene.sourceIds.map(id => identity[id]), ...scene.optionIds);
      } catch (pageError) {
        result.diagnostics.push({ code: 'SOURCE_PAGE_UNSUPPORTED', sourceId: id, message: pageError instanceof Error ? pageError.message : String(pageError) });
      }
    }
    if (hasForms && !options.existingPaths.has(FORM_ROUTE_PATH)) result.files.push({ path: FORM_ROUTE_PATH, code: FORM_ROUTE_CONTENT });
    if ([...anchors].some(id => !writtenAnchors.has(id))) {
      trace.action('framer-native.skipMissingAnchors', { missing: [...anchors].filter(id => !writtenAnchors.has(id)) });
    }
  } catch (error) {
    result.diagnostics.push({ code: 'SOURCE_PAGE_UNSUPPORTED', sourceId: active, message: error instanceof Error ? error.message : String(error) });
  }
  const fatal = result.diagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID');
  if (fatal.length) { result.files = []; result.createdIds = []; result.routes = {}; }
  return result;
}
