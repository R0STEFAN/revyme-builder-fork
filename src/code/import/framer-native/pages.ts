import { trace } from '../../../shared/debug-trace';
import { checkFile } from '../../oracle/check-file';
import { setTagAttr } from '../../generation/generator-utils';
import { convertToMotionLinkInCode } from '../../generation/generator-attrs';
import { setCodeOverridesInCode, type CodeOverrideRef } from '../../generation/code-override-gen';
import { activeSourceCodeOverride, isSourceCodeComponent, sourceRecord, sourceVariables, resolveSourceNode } from './source-graph';
import { mapSourceStyles, type SourceMappingContext } from './styles';
import { mapSourceText } from './text';
import { sourceViewports, applyNativeResponsive } from './responsive';
import { emitSourceScene } from './scene';
import { applySourceInstances } from './scene-instances';
import { emitSourceQueryInCode, resolveSourceBinding } from './bindings';
import { nativeCollectionSlug, sourceCollectionId } from './cms';
import { buildCmsDetailServerWrapper } from '../../project/cms-seo';
import { findJSXElementByDataId, findClosingTag } from '../../generation/cms-gen';
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
    for (const id of ids) {
      active = id;
      const page = graph.nodes.get(id)!, document = documentFor(graph, page);
      const isTemplate = page.kind === 'LayoutTemplateNode';
      const isDetail = !isTemplate && page.raw.dataIdentifier !== undefined;
      if (isDetail && !result.routes[id]?.endsWith('/[slug]')) throw new Error('Source CMS page requires its native page-context adapter');
      if (isDetail && Object.keys(sourceRecord(page.raw.webMetadata) ?? {}).length) throw new Error('Source CMS page metadata requires its native per-record adapter');
      const collection = isDetail ? nativeCollectionSlug(identity, sourceCollectionId(page.raw.dataIdentifier)) : undefined;
      if (sourceVariables(graph, id).length) throw new Error(`Source ${isTemplate ? 'template' : 'page'} variables require their native declaration adapter`);
      const templateIdentifier = page.raw.layoutTemplateIdentifierOverride !== undefined ? page.raw.layoutTemplateIdentifierOverride : document?.raw.layoutTemplateIdentifier;
      let group = isTemplate ? groups.get(id) : undefined;
      if (!isTemplate && templateIdentifier !== undefined) {
        const match = typeof templateIdentifier === 'string' && /^local-module:layoutTemplate\/([^:]+):default$/.exec(templateIdentifier);
        if (!match || !groups.has(match[1])) throw new Error(`Source page template ${String(templateIdentifier)} is unavailable`);
        group = groups.get(match[1]);
      }
      if (!isTemplate && document?.raw.globalPageEffect) throw new Error('Source global page effects require their native runtime adapter');
      const viewports = sourceViewports(graph, id), primary = viewports[0].sourceStateId;
      if (resolveSourceNode(graph, primary).sourceId !== primary) throw new Error('A larger replica breakpoint requires its native baseline adapter');
      const context: SourceMappingContext = { graph, diagnostics: [], assets: options.assets, viewport: { width: viewports[0].designWidth! } };
      const stylesFor = (node: ResolvedSourceNode, ctx: SourceMappingContext) => {
        const styles = mapSourceStyles(node, ctx);
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
          throw new Error('Source page text requires its native binding adapter');
        },
      });
      if (isTemplate ? scene.slots.length !== 1 : scene.slots.length !== 0) throw new Error('A native template requires one children slot; pages cannot own template slots');
      const signature = isTemplate ? 'LayoutClient({ children }: { children: React.ReactNode })' : isDetail ? 'Page({ item: serverItem }: { item?: any } = {})' : 'Page()';
      const jsx = isTemplate ? scene.jsx : `<div data-id="root"${isDetail ? " key={String(params?.slug ?? '')}" : ''} style={{position:'relative',width:'100%'}}>${scene.jsx}</div>`;
      const detailSetup = isDetail ? `/** @cmsPage { "collection": "${collection}", "kind": "detail" } */\nimport { useParams } from 'next/navigation';\nimport { useLocale } from 'next-intl';\nimport { localizeRows } from '@revyme/runtime';\nimport rows from '@/cms/${collection}.json';\n` : '';
      const detailBody = isDetail ? 'const params = useParams(); const locale = useLocale(); const rawItem = serverItem ?? (rows.find(row => row._slug === params?.slug) ?? rows[0]); const item = rawItem ? (localizeRows([rawItem], locale)[0] || rawItem) : undefined; if (!item) return null; ' : '';
      let code = `"use client";\nimport React from 'react';\n${detailSetup}export default function ${signature} { ${detailBody}return ${jsx}; }`;
      code = applySourceInstances(code, scene, graph, identity, options.assets);
      for (const nodeId of scene.sourceIds) {
        const node = resolveSourceNode(graph, nodeId);
        if (!isSourceCodeComponent(node)) for (const [property, value] of Object.entries(node.properties)) if (/^on[A-Z]/.test(property) && Array.isArray(value) && value.length) throw new Error(`Source page action ${property} requires its native adapter`);
        const override = isSourceCodeComponent(node) ? undefined : activeSourceCodeOverride(node.properties);
        if (override) {
          const ref = options.overrides?.[override];
          if (!ref) throw new Error(`Source page override ${override} is unavailable`);
          code = setCodeOverridesInCode(code, identity[nodeId], [ref]);
        }
        for (const viewport of viewports.slice(1)) {
          const state = resolveSourceNode(graph, nodeId, viewport.sourceStateId);
          const semanticProperties = new Set(['link', 'linkOpenInNewTab', 'visible', 'htmlTag', 'dataIdentifier', 'collectionFilters', 'collectionOrder', 'collectionLimit', 'collectionOffset', 'collectionReverse', 'codeComponentIdentifier', 'codeOverrideIdentifier', 'codeOverrideEnabled']);
          if (isSourceCodeComponent(node)) for (const key of ['link', 'linkOpenInNewTab', 'codeComponentIdentifier', 'codeOverrideIdentifier', 'codeOverrideEnabled']) semanticProperties.delete(key);
          else for (const key of [...Object.keys(node.properties), ...Object.keys(state.properties)]) if (key.startsWith('$control__') || /^on[A-Z]/.test(key)) semanticProperties.add(key);
          for (const property of semanticProperties) if (JSON.stringify(state.properties[property]) !== JSON.stringify(node.properties[property])) throw new Error(`Responsive ${property} on ${nodeId} requires its native adapter`);
          if (node.kind === 'RichTextNode') {
            const base = mapSourceText(node, context), text = mapSourceText(state, context);
            if (base.tag !== text.tag || base.jsx !== text.jsx || JSON.stringify(base.binding) !== JSON.stringify(text.binding) || JSON.stringify(base.attributes) !== JSON.stringify(text.attributes)) throw new Error(`Responsive text content on ${nodeId} requires its native text adapter`);
          }
        }
      }
      for (const nodeId of scene.links) {
        const node = resolveSourceNode(graph, nodeId);
        const pageLink = sourceRecord(node.properties.link);
        let href = typeof node.properties.link === 'string' ? node.properties.link : pageLink?.type === 'webPage' && typeof pageLink.webPageId === 'string' ? result.routes[pageLink.webPageId] : undefined;
        if (typeof href !== 'string') throw new Error(`Source link on ${nodeId} requires its native route adapter`);
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
        const defaults = Object.fromEntries(['title', 'description'].flatMap(key => typeof globalMeta?.[key] === 'string' ? [[key, globalMeta[key]]] : []));
        result.files.push({ path, code }, { path: `${folder}/page.tsx`, code: buildCmsDetailServerWrapper({ collection: collection!, defaults, apiConfig: null }) });
        result.createdIds.push(...scene.sourceIds.map(id => identity[id]));
        continue;
      }
      const pageMeta = sourceRecord(page.raw.webMetadata), globalMeta = sourceRecord(document?.raw.webMetadata);
      const metadata = { title: pageMeta?.title ?? globalMeta?.title ?? page.raw.name ?? 'Page', ...(typeof (pageMeta?.description ?? globalMeta?.description) === 'string' ? { description: pageMeta?.description ?? globalMeta?.description } : {}) };
      const fields = Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
      if (typeof pageMeta?.noIndex === 'boolean') fields.push(`robots: { index: ${!pageMeta.noIndex} }`);
      result.files.push({ path, code }, { path: `${folder}/page.tsx`, code: `import PageClient from './page.client';\nexport const metadata = { ${fields.join(', ')} };\nexport default function Page(){ return <PageClient />; }\n` });
      result.createdIds.push(...scene.sourceIds.map(id => identity[id]));
    }
  } catch (error) {
    result.diagnostics.push({ code: 'SOURCE_PAGE_UNSUPPORTED', sourceId: active, message: error instanceof Error ? error.message : String(error) });
  }
  if (result.diagnostics.length) { result.files = []; result.createdIds = []; result.routes = {}; }
  return result;
}
