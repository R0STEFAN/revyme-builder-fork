import { trace } from '../../../shared/debug-trace';
import { checkFile } from '../../oracle/check-file';
import { setTagAttr } from '../../generation/generator-utils';
import { convertToMotionLinkInCode } from '../../generation/generator-attrs';
import { setCodeOverridesInCode, type CodeOverrideRef } from '../../generation/code-override-gen';
import { activeSourceCodeOverride, isSourceCodeComponent, sourceRecord, sourceVariables, sourceVariableKey, resolveSourceNode } from './source-graph';
import { mapSourceStyles, type SourceMappingContext } from './styles';
import { mapSourceText } from './text';
import { sourceViewports, applyNativeResponsive } from './responsive';
import { emitSourceScene } from './scene';
import { applySourceInstances } from './scene-instances';
import { applySourceOverlays } from './overlays';
import { sourceStaticLinkValue } from './links';
import { emitSourceQueryInCode, resolveSourceBinding } from './bindings';
import { nativeCollectionSlug, nativeFieldId, sourceCollectionId } from './cms';
import { buildCmsDetailServerWrapper } from '../../project/cms-seo';
import { applySourceRotationLoop, assertLoopOutsideSourceList, sourceRotationLoop } from './effects';
import { findJSXElementByDataId, findClosingTag } from '../../generation/cms-gen';
import { nativeComponentName, nativePropName } from './components';
import { sourceInstanceStateName } from './interactions';
import { setResponsiveOverride, setResponsiveBindingOverride, transformAllResponsiveAttrs } from '../../components/instance-prop-overrides';
import { parseOverlayCalls, resolveOverlayConfigForWidth } from '../../parsing/overlay-parser';
import { stateVarName } from '../../generation/overlay-gen';
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
  if (result.diagnostics.length) return result;
  const pageIds = (graph.byKind.get('WebPageNode') ?? []).filter(id => graph.reachable.has(id)).sort();
  const templateIds = (graph.byKind.get('LayoutTemplateNode') ?? []).filter(id => graph.reachable.has(id)).sort();
  const ids = [...templateIds, ...pageIds];
  if (!ids.length) return result;
  let active: string | undefined;
  try {
    const originalRoutes = new Map(pageIds.map(id => [id, sourcePageRoute(graph, graph.nodes.get(id)!)]));
    if (new Set(originalRoutes.values()).size !== pageIds.length) throw new Error('Duplicate source page routes');
    const used = new Set([...options.existingPaths].filter(path => /^app\/.+page(?:\.client)?\.tsx$|^app\/page(?:\.client)?\.tsx$/.test(path)).map(path => routeOfFile(path).toLowerCase()));
    let prefix = '';
    const collides = (prefix: string) => [...originalRoutes.values()].some(route => used.has((prefix + (route === '/' ? '' : route) || '/').toLowerCase()) || /^\/api(?:\/|$)/.test(prefix + route));
    if (collides(prefix)) {
      prefix = `/${identity[pageIds[0]]}`;
      for (let suffix = 2; collides(prefix); suffix++) prefix = `/${identity[pageIds[0]]}-${suffix}`;
    }
    for (const [id, route] of originalRoutes) result.routes[id] = prefix + (route === '/' ? '' : route) || '/';
    const groups = new Map<string, string>();
    for (const id of templateIds) {
      let name = identity[id];
      if (!name) throw new Error(`Missing template identity ${id}`);
      for (let suffix = 2; [...options.existingPaths].some(path => path.startsWith(`app/(${name})/`)) || [...groups.values()].includes(name); suffix++) name = `${identity[id]}-${suffix}`;
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
    const propTypes: Record<string, string> = { string: 'plainText', number: 'number', boolean: 'toggle', color: 'color', link: 'link', scrollsectionref: 'section' };
    const templateValue = (providerId: string, variable: Record<string, unknown>, value: unknown): string | number | boolean => {
      const type = variable.type;
      if (value == null) value = type === 'boolean' ? false : type === 'number' ? 0 : '';
      if (type === 'boolean' && typeof value === 'boolean' || type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value as number | boolean;
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
          if (!/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#|$)/i.test(String(value)) || String(value).includes('[slug]')) throw new Error(`Unsupported template link ${String(value)}`);
        }
      }
      if (['string', 'color', 'link', 'scrollsectionref'].includes(String(type)) && typeof value === 'string') return value;
      throw new Error(`Invalid template ${String(type)} value for ${String(variable.id)}`);
    };
    const templateProps = new Map(templateIds.map(id => [id, sourceVariables(graph, id).map(variable => {
      const type = propTypes[String(variable.type)];
      if (!type) throw new Error(`Source template variable ${String(variable.id)} type ${String(variable.type)} requires its native adapter`);
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
    for (const id of ids) {
      active = id;
      const page = graph.nodes.get(id)!, document = documentFor(graph, page);
      const isTemplate = page.kind === 'LayoutTemplateNode';
      const isDetail = !isTemplate && page.raw.dataIdentifier !== undefined;
      if (isDetail && !result.routes[id]?.endsWith('/[slug]')) throw new Error('Source CMS page requires its native page-context adapter');
      if (isDetail && Object.keys(sourceRecord(page.raw.webMetadata) ?? {}).some(key => !['title', 'description', 'socialImage', 'noIndexSite', 'noIndex'].includes(key))) throw new Error('Source CMS page metadata requires its native per-record adapter');
      const collection = isDetail ? nativeCollectionSlug(identity, sourceCollectionId(page.raw.dataIdentifier)) : undefined;
      if (!isTemplate && sourceVariables(graph, id).length) throw new Error('Source page variables require their native declaration adapter');
      const props = isTemplate ? templateProps.get(id)! : [];
      const group = isTemplate ? groups.get(id) : groups.get(templateForPage.get(id) ?? '');
      if (!isTemplate && document?.raw.globalPageEffect) throw new Error('Source global page effects require their native runtime adapter');
      const viewports = sourceViewports(graph, id), primary = viewports[0].sourceStateId;
      if (resolveSourceNode(graph, primary).sourceId !== primary) throw new Error('A larger replica breakpoint requires its native baseline adapter');
      const variables = Object.fromEntries(props.map(prop => [`${id}:${String(prop.variable.id)}`, `{${prop.name}}`]));
      const context: SourceMappingContext = { graph, diagnostics: [], variables, assets: options.assets, supportedLoops: true, viewport: { width: viewports[0].designWidth! } };
      const visibilityFor = (node: ResolvedSourceNode) => {
        if (!sourceRecord(node.properties.visible)) return;
        const binding = resolveSourceBinding(node.properties.visible, { graph, identity, nodeId: node.sourceId });
        if (!isTemplate || binding.kind !== 'variable' || binding.providerId !== id || binding.valueType !== 'boolean') throw new Error(`Source visibility on ${node.sourceId} requires its native adapter`);
        return binding;
      };
      const stylesFor = (node: ResolvedSourceNode, ctx: SourceMappingContext) => {
        const styles = mapSourceStyles(visibilityFor(node) ? { ...node, properties: { ...node.properties, visible: true } } : node, ctx);
        if (node.kind === 'RichTextNode') Object.assign(styles, mapSourceText(node, ctx).styles);
        if (node.sourceId === primary) {
          styles.width = '100%'; styles.position = 'relative';
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
      const scene = emitSourceScene(graph, identity, primary, context, {
        stylesFor: (node, parent) => stylesFor(node, { ...context, parent }), codeComponents: options.codeComponents, template: isTemplate,
        expressionFor: (value, node) => {
          const binding = resolveSourceBinding(value, { graph, identity, nodeId: node.sourceId });
          if (binding.kind === 'field') return `${binding.itemVar}.${binding.fieldId}`;
          if (isTemplate && binding.kind === 'variable' && binding.providerId === id) return binding.name;
          throw new Error('Source page text requires its native binding adapter');
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
      let code = `"use client";\nimport React from 'react';\n${motionPolicy ? 'import { MotionConfig } from "framer-motion";\n' : ''}${detailSetup}export default function ${signature} { ${detailBody}return ${pageJsx}; }`;
      for (const prop of props) {
        code = setPropTypeInCode(code, prop.name, prop.type);
        code = setPropLabelInCode(code, prop.name, String(prop.variable.name ?? prop.variable.id));
      }
      code = applySourceInstances(code, scene, graph, identity, options.assets, { allowOverlayEvents: true, routes: result.routes });
      if (isDetail && scene.sourceIds.some(id => graph.nodes.get(id)!.kind === 'OverlayNode')) throw new Error('Source CMS detail overlay requires its native hook-order adapter');
      const overlays = applySourceOverlays(code, scene.sourceIds, graph, identity, viewports.slice(1), viewports[0].width);
      code = overlays.code;
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        if (!isSourceCodeComponent(node)) for (const [property, value] of Object.entries(node.properties)) if (/^on[A-Z]/.test(property) && Array.isArray(value) && value.length && !overlays.handled.has(`${nodeId}:${property}`)) throw new Error(`Source page action ${property} requires its native adapter`);
        const override = isSourceCodeComponent(node) ? undefined : activeSourceCodeOverride(node.properties);
        if (override) {
          const ref = options.overrides?.[override];
          if (!ref) throw new Error(`Source page override ${override} is unavailable`);
          code = setCodeOverridesInCode(code, identity[nodeId], [ref]);
        }
        for (const viewport of viewports.slice(1)) {
          const state = resolveSourceNode(graph, nodeId, viewport.sourceStateId);
          const semanticProperties = new Set(['link', 'linkOpenInNewTab', 'visible', 'htmlTag', 'dataIdentifier', 'collectionFilters', 'collectionOrder', 'collectionLimit', 'collectionOffset', 'collectionReverse', 'codeComponentIdentifier', 'codeOverrideIdentifier', 'codeOverrideEnabled']);
          if ([node.properties.visible, state.properties.visible].every(value => value === undefined || typeof value === 'boolean')) semanticProperties.delete('visible');
          if (isSourceCodeComponent(node)) for (const key of ['link', 'linkOpenInNewTab', 'codeComponentIdentifier', 'codeOverrideIdentifier', 'codeOverrideEnabled']) semanticProperties.delete(key);
          else for (const key of [...Object.keys(node.properties), ...Object.keys(state.properties)]) if (key.startsWith('$control__') || /^on[A-Z]/.test(key)) semanticProperties.add(key);
          if (node.kind === 'CodeComponentNode' && !isSourceCodeComponent(node) && JSON.stringify(state.properties.$control__variant) !== JSON.stringify(node.properties.$control__variant)) {
            const master = /^local-module:canvasComponent\/([^:]+):/.exec(String(node.properties.codeComponentIdentifier))?.[1];
            const sourceVariant = sourceRecord(state.properties.$control__variant)?.value;
            const target = master && sourceInstanceStateName({ graph, scopeId: master }, identity, sourceVariant);
            if (!master || !target) throw new Error(`Missing responsive component variant ${String(sourceVariant)} on ${nodeId}`);
            if (node.properties.whileOpenEffectEnabled === true) {
              const overlay = parseOverlayCalls(code).find(item => item.config.triggerId === identity[nodeId]);
              const open = overlay && resolveOverlayConfigForWidth(overlay.config, viewport.width).onOpenVariant;
              if (!overlay || !open) throw new Error(`Responsive overlay variant on ${nodeId} requires its native composition adapter`);
              code = setResponsiveBindingOverride(code, identity[nodeId], nativeComponentName(identity, master), viewport.width, 'initialVariant', { kind: 'field', expr: `${stateVarName(overlay.overlayId)} ? ${JSON.stringify(open)} : ${JSON.stringify(target)}` });
            } else code = setResponsiveOverride(code, identity[nodeId], nativeComponentName(identity, master), viewport.width, 'initialVariant', target, null);
            semanticProperties.delete('$control__variant');
          }
          for (const property of semanticProperties) if (JSON.stringify(state.properties[property]) !== JSON.stringify(node.properties[property])) throw new Error(`Responsive ${property} on ${nodeId} requires its native adapter`);
          if (node.kind === 'RichTextNode') {
            const base = mapSourceText(node, context), text = mapSourceText(state, context);
            if (base.tag !== text.tag || base.jsx !== text.jsx || JSON.stringify(base.binding) !== JSON.stringify(text.binding) || JSON.stringify(base.attributes) !== JSON.stringify(text.attributes)) throw new Error(`Responsive text content on ${nodeId} requires its native text adapter`);
          }
        }
      }
      code = transformAllResponsiveAttrs(code, model => { model.bp = viewports.map(viewport => viewport.width).sort((a, b) => a - b); });
      for (const nodeId of scene.links) {
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
        const range = findClosingTag(code, findJSXElementByDataId(code, identity[nodeId]));
        if (!range) throw new Error('Native list container is missing');
        code = emitSourceQueryInCode(code, identity[nodeId], nodeId, code.slice(range.contentStart, range.closeTagStart).trim(), { graph, identity, nodeId });
      }
      code = applyNativeResponsive(code, { graph, scopeId: id, context, stylesFor }, identity);
      for (const nodeId of scene.sourceIds) {
        if (anchors.has(nodeId)) { code = setTagAttr(code, identity[nodeId], 'id', JSON.stringify(identity[nodeId])); writtenAnchors.add(nodeId); }
        const node = resolveSourceNode(graph, nodeId), binding = visibilityFor(node);
        if (!binding) continue;
        const display = stylesFor(node, context).display;
        for (const viewport of viewports.slice(1)) if (stylesFor(resolveSourceNode(graph, nodeId, viewport.sourceStateId), context).display !== display) throw new Error(`Responsive display with a visibility binding on ${nodeId} requires its native adapter`);
        const prop = props.find(prop => prop.name === binding.name)!;
        code = createConditionalVariableInCode(code, identity[nodeId], 'display', prop.name, display || 'block', 'none', prop.initial === true ? 'true' : 'false');
      }
      if (isTemplate) for (const [pageId, templateId] of templateForPage) if (templateId === id) for (const [name, value] of Object.entries(pageProps.get(pageId)!)) code = setTemplateRouteValueInCode(code, result.routes[pageId], name, value, props.map(prop => prop.name));
      if (!isTemplate) code = updateTemplatePropsInCode(code, pageProps.get(id) ?? {});
      code = code.replace(/(\/\*\* @(?:propMeta|templateProps) )([\s\S]*?)( \*\/)/g, (_all, before, json, after) => before + json.replace(/\*\//g, '*\\/') + after);
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        if (isSourceCodeComponent(node)) continue;
        const spec = sourceRotationLoop(node.properties);
        for (const viewport of viewports.slice(1)) if (JSON.stringify(sourceRotationLoop(resolveSourceNode(graph, nodeId, viewport.sourceStateId).properties)) !== JSON.stringify(spec)) throw new Error(`Responsive loop on ${nodeId} requires its native adapter`);
        if (spec) {
          if (isDetail) throw new Error(`Loop on CMS detail page ${nodeId} requires its native hook-order adapter`);
          if (!['FrameNode', 'RichTextNode'].includes(node.kind)) throw new Error(`Loop on source component ${nodeId} requires its native adapter`);
          assertLoopOutsideSourceList(graph, nodeId);
          code = applySourceRotationLoop(code, identity[nodeId], spec);
        }
      }
      if (context.diagnostics.length) { result.diagnostics.push(...context.diagnostics); throw new Error('Unresolved source page semantics'); }
      const route = result.routes[id], folder = 'app' + (group ? `/(${group})` : '') + (isTemplate || route === '/' ? '' : route);
      const path = `${folder}/${isTemplate ? 'LayoutClient' : 'page.client'}.tsx`;
      const projectedPaths = new Set([path, ...[...groups.values()].map(group => `app/(${group})/LayoutClient.tsx`)]);
      const violations = checkFile(code, { kind: isTemplate ? 'template' : 'page', path, projectFiles: projectedPaths });
      if (violations.length) throw new Error(`Native page validation: ${violations.map(violation => violation.code).join(', ')}`);
      if (isTemplate) {
        result.files.push({ path, code }, { path: `${folder}/layout.tsx`, code: "import LayoutClient from './LayoutClient';\nexport default function Layout({ children }: { children: React.ReactNode }) { return <LayoutClient>{children}</LayoutClient>; }\n" });
        result.createdIds.push(...scene.sourceIds.map(id => identity[id]));
        continue;
      }
      if (isDetail) {
        const globalMeta = sourceRecord(document?.raw.webMetadata);
        const defaults: Record<string, unknown> = Object.fromEntries(['title', 'description'].flatMap(key => typeof globalMeta?.[key] === 'string' ? [[key, globalMeta[key]]] : []));
        const pageMeta = sourceRecord(page.raw.webMetadata);
        if (typeof pageMeta?.noIndex === 'boolean') defaults.robotsIndex = !pageMeta.noIndex;
        const socialImage = pageMeta?.socialImage ?? globalMeta?.socialImage;
        if (socialImage !== undefined) {
          const image = typeof socialImage === 'string' ? options.assets?.[socialImage] : undefined;
          if (!image) throw new Error(`Source social image on ${id} requires its native media adapter`);
          defaults.ogImage = image;
        }
        const expressions: Record<string, string> = {};
        const collectionId = sourceCollectionId(page.raw.dataIdentifier);
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
        result.createdIds.push(...scene.sourceIds.map(id => identity[id]));
        continue;
      }
      const pageMeta = sourceRecord(page.raw.webMetadata), globalMeta = sourceRecord(document?.raw.webMetadata);
      const metadata = { title: pageMeta?.title ?? globalMeta?.title ?? page.raw.name ?? 'Page', ...(typeof (pageMeta?.description ?? globalMeta?.description) === 'string' ? { description: pageMeta?.description ?? globalMeta?.description } : {}) };
      const fields = Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
      if (typeof pageMeta?.noIndex === 'boolean') fields.push(`robots: { index: ${!pageMeta.noIndex} }`);
      const socialImage = pageMeta?.socialImage ?? globalMeta?.socialImage;
      if (socialImage !== undefined) {
        const image = typeof socialImage === 'string' ? options.assets?.[socialImage] : undefined;
        if (!image) throw new Error(`Source social image on ${id} requires its native media adapter`);
        fields.push(`openGraph: { images: [${JSON.stringify(image)}] }`);
      }
      result.files.push({ path, code }, { path: `${folder}/page.tsx`, code: `import PageClient from './page.client';\nexport const metadata = { ${fields.join(', ')} };\nexport default function Page(){ return <PageClient />; }\n` });
      result.createdIds.push(...scene.sourceIds.map(id => identity[id]));
    }
    if ([...anchors].some(id => !writtenAnchors.has(id))) throw new Error('Source template section target is outside the emitted page/template scenes');
  } catch (error) {
    result.diagnostics.push({ code: 'SOURCE_PAGE_UNSUPPORTED', sourceId: active, message: error instanceof Error ? error.message : String(error) });
  }
  if (result.diagnostics.length) { result.files = []; result.createdIds = []; result.routes = {}; }
  return result;
}
