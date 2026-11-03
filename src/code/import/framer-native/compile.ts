import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { parseJSX } from '../../parsing/ast-utils';
import { checkFile } from '../../oracle/check-file';
import { oracleFileKind } from '../../oracle/file-kind';
import { parsePropMeta } from '../../components/prop-meta';
import { buildSourceGraph, allocateTargetIdentity, sourceRecord } from './source-graph';
import { planNativeAssets, emitNativeAssets, resolveUploadedNativeAssets } from './assets';
import { emitNativeCms } from './cms';
import { emitNativeComponents } from './components';
import { emitNativeCodeOverrides } from './code-adapters';
import { emitNativePages, sourcePageRoute } from './pages';
import type { NativeCompileResult, SourceGraph } from './types';
import { applyFramerColorTokens, type FramerColorToken } from '../../generation/framer-token-gen';
import { renameCustomPropertyInText } from '../../generation/preset-refs-gen';
import { generate } from '../../generation/generator-utils';
import { applyFramerFontFaces } from '../../generation/framer-font-gen';
import type { WorkspaceFontFaceSpec } from '../../project/preset-ops';
import { addGoogleFontImportsToCss } from '../../../shared/google-font-import';
import { sourceGoogleFontRequests } from './fonts';
import { ensureCursorPortalInLayout, hasNativeCursorPortal } from '../../generation/cursor-gen';
import { parseSiteConfigFromCode } from '../../generation/metadata-gen';
import { updateNativeFavicon } from './favicon';

export interface NativeTargetContext {
  existingFiles: ReadonlyMap<string, string>;
  mode: 'create' | 'replace' | 'paste';
  assetPayloads?: Readonly<Record<string, string>>;
  uploadedAssets?: Readonly<Record<string, string>>;
  fontFaces?: readonly WorkspaceFontFaceSpec[];
}

function destinationLanguageMatches(code: string | undefined, language: unknown): boolean {
  if (!code || typeof language !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) return false;
  const ast = parseJSX(code);
  if (!ast) return false;
  const values: Array<string | undefined> = [];
  t.traverseFast(ast, node => {
    if (!t.isJSXOpeningElement(node) || !t.isJSXIdentifier(node.name, { name: 'html' })) return;
    const attr = node.attributes.find(item => t.isJSXAttribute(item) && t.isJSXIdentifier(item.name, { name: 'lang' }));
    if (!t.isJSXAttribute(attr)) { values.push(undefined); return; }
    if (t.isStringLiteral(attr.value)) { values.push(attr.value.value); return; }
    const expr = t.isJSXExpressionContainer(attr.value) ? attr.value.expression : undefined;
    if (t.isLogicalExpression(expr, { operator: '||' }) && t.isMemberExpression(expr.left) && !expr.left.computed && t.isIdentifier(expr.left.object, { name: 'siteConfig' }) && t.isIdentifier(expr.left.property, { name: 'language' }) && t.isStringLiteral(expr.right)) values.push(parseSiteConfigFromCode(code).language || expr.right.value);
    else values.push(undefined);
  });
  return values.length === 1 && values[0] === language;
}

/** Pure candidate assembly. Only the native submit/plan pipeline may persist it. */
export function compileNativeTransfer(input: unknown, target: NativeTargetContext): NativeCompileResult {
  trace.fn('framer-native.compile', { mode: target.mode, existingFiles: target.existingFiles.size });
  const result: NativeCompileResult = { files: [], createdIds: [], identity: {}, diagnostics: [] };
  if (target.mode !== 'create') {
    result.diagnostics.push({ code: 'NATIVE_TARGET_ADAPTER_REQUIRED', message: `The ${target.mode} target requires its native placement/CAS adapter.` });
    return result;
  }
  let graph: SourceGraph;
  try { graph = buildSourceGraph(input); }
  catch (error) {
    result.diagnostics.push({ code: 'SOURCE_CAPTURE_INVALID', message: error instanceof Error ? error.message : String(error) });
    return result;
  }
  result.diagnostics = [...graph.diagnostics];
  try {
    const paths = new Set(target.existingFiles.keys());
    const identityPaths = new Set(paths);
    for (const match of (target.existingFiles.get('app/globals.css') ?? '').matchAll(/--color-(framer-[a-z0-9-]+)/g)) identityPaths.add(`__tokens__/${match[1]}.css`);
    const identity = result.identity = allocateTargetIdentity(graph, identityPaths);
    const colorNames = Object.fromEntries((graph.byKind.get('ColorStyleTokenNode') ?? []).filter(id => graph.reachable.has(id)).map(id => [id, `color-${identity[id]}`]));
    for (const id of graph.renderRootIds) {
      if (!['WebPageNode', 'SmartComponentNode', 'LayoutTemplateNode', 'CollectionNode'].includes(graph.nodes.get(id)!.kind)) result.diagnostics.push({ code: 'SOURCE_ROOT_ADAPTER_REQUIRED', sourceId: id, message: 'This source root requires its native placement adapter.' });
    }
    for (const id of graph.reachable) {
      const node = graph.nodes.get(id)!;
      const metadata = sourceRecord(node.raw.webMetadata);
      if (node.kind === 'WebPageNode' && typeof metadata?.noIndexSite === 'boolean') trace.action('framer-native.skipSiteIndexFlag', { sourceId: id, value: metadata.noIndexSite });
      for (const [metadataKey] of Object.entries(metadata ?? {}).filter(([key, value]) => !['title', 'description'].includes(key) && !(node.kind === 'WebPageNode' && ['noIndex', 'noIndexSite'].includes(key) && typeof value === 'boolean') && !(['WebPageNode', 'RootNode'].includes(node.kind) && key === 'socialImage' && typeof value === 'string') && !(node.kind === 'RootNode' && ['favicon', 'faviconDark'].includes(key) && typeof value === 'string' && graph.transfer.context.mode === 'project') && !(node.kind === 'RootNode' && key === 'reducedMotion' && typeof value === 'boolean') && !(node.kind === 'RootNode' && key === 'translatePagePaths' && value === false) && !(node.kind === 'RootNode' && key === 'language' && destinationLanguageMatches(target.existingFiles.get('app/layout.tsx'), value)))) result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', sourceId: id, property: `webMetadata.${metadataKey}`, message: 'Source metadata beyond supported page fields needs its native metadata adapter.' });
    }
    // Document metadata is inherited without importing all sibling pages.
    if (graph.byKind.get('WebPageNode')?.some(id => graph.reachable.has(id))) for (const id of graph.byKind.get('RootNode') ?? []) {
      const metadata = sourceRecord(graph.nodes.get(id)!.raw.webMetadata);
      for (const [metadataKey] of Object.entries(metadata ?? {}).filter(([key, value]) => !['title', 'description'].includes(key) && !(key === 'socialImage' && typeof value === 'string') && !(['favicon', 'faviconDark'].includes(key) && typeof value === 'string' && graph.transfer.context.mode === 'project') && !(key === 'reducedMotion' && typeof value === 'boolean') && !(key === 'translatePagePaths' && value === false) && !(key === 'language' && destinationLanguageMatches(target.existingFiles.get('app/layout.tsx'), value)))) result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', sourceId: id, property: `webMetadata.${metadataKey}`, message: 'Inherited source document settings need their native metadata adapter.' });
    }
    if (result.diagnostics.length) return result;
    const originals = target.uploadedAssets ? resolveUploadedNativeAssets(graph, identity, target.uploadedAssets) : emitNativeAssets(graph, identity, target.assetPayloads ?? {});
    const assets = target.uploadedAssets ? originals : planNativeAssets(graph, identity);
    const overrides = emitNativeCodeOverrides(graph, identity);
    const cms = emitNativeCms(graph, identity, { assets: assets.assets, colorNames });
    const reducedMotion = (graph.byKind.get('RootNode') ?? []).some(id => sourceRecord(graph.nodes.get(id)!.raw.webMetadata)?.reducedMotion === true);
    const options = { assets: assets.assets, overrides: overrides.overrides };
    const pages = emitNativePages(graph, identity, { ...options, existingPaths: paths });
    const components = emitNativeComponents(graph, identity, { ...options, routes: pages.routes });
    if (components.files.some(file => /\bwithCursor\s*\(/.test(file.code))) {
      if (reducedMotion) result.diagnostics.push({ code: 'SOURCE_REDUCED_MOTION_ADAPTER_REQUIRED', message: 'Component cursors require reduced-motion runtime support.' });
      const original = target.existingFiles.get('app/layout.tsx');
      const updated = original === undefined ? undefined : ensureCursorPortalInLayout(original);
      if (!updated || !hasNativeCursorPortal(updated)) result.diagnostics.push({ code: 'SOURCE_CURSOR_PORTAL_REQUIRED', message: 'Component cursors require a valid native root layout and cursor portal.' });
      else if (updated !== original) result.files.push({ path: 'app/layout.tsx', code: updated, baseCode: original, cursorPortal: true });
    }
    if (graph.transfer.context.mode === 'project' && graph.byKind.get('WebPageNode')?.some(id => graph.reachable.has(id))) {
      const roots = (graph.byKind.get('RootNode') ?? []).map(id => sourceRecord(graph.nodes.get(id)!.raw.webMetadata)).filter(metadata => metadata?.favicon !== undefined || metadata?.faviconDark !== undefined);
      const refs = roots.map(metadata => metadata?.favicon);
      if (refs.length) {
        const url = refs.length === 1 && typeof refs[0] === 'string' ? assets.assets[refs[0]] : undefined;
        const darkRef = roots[0]?.faviconDark, darkUrl = typeof darkRef === 'string' ? assets.assets[darkRef] : undefined;
        const original = target.existingFiles.get('app/layout.tsx'), prior = result.files.find(file => file.path === 'app/layout.tsx');
        const updated = original !== undefined && url && (darkRef === undefined || darkUrl) ? updateNativeFavicon(prior?.code ?? original, url, darkUrl) : undefined;
        if (!updated || !url || original === undefined) result.diagnostics.push({ code: 'SOURCE_FAVICON_ADAPTER_REQUIRED', message: 'The source favicon or native root metadata cannot be safely updated.' });
        else if (updated !== original) {
          if (prior) { prior.code = updated; prior.favicon = url; if (darkUrl) prior.faviconDark = darkUrl; }
          else result.files.push({ path: 'app/layout.tsx', code: updated, baseCode: original, favicon: url, ...(darkUrl ? { faviconDark: darkUrl } : {}) });
        }
      }
    }
    const relocatedRoutes = new Map(Object.entries(pages.routes).map(([id, route]) => [sourcePageRoute(graph, graph.nodes.get(id)!), route] as const).filter(([before, after]) => before !== after));
    for (const emitted of [originals, overrides, cms, components, pages]) {
      result.files.push(...emitted.files); result.createdIds.push(...emitted.createdIds); result.diagnostics.push(...emitted.diagnostics);
    }
    const colorTokens: FramerColorToken[] = [];
    for (const id of (graph.byKind.get('ColorStyleTokenNode') ?? []).filter(id => graph.reachable.has(id)).sort()) {
      const token = graph.nodes.get(id)!.raw;
      if (typeof token.light !== 'string' || token.dark != null && typeof token.dark !== 'string') { result.diagnostics.push({ code: 'SOURCE_TOKEN_ADAPTER_REQUIRED', sourceId: id, message: 'Source color token requires static light/dark colors.' }); continue; }
      const name = `color-${identity[id]}`;
      colorTokens.push({ name, value: token.light, ...(typeof token.dark === 'string' ? { dark: token.dark } : {}) });
    }
    const fontNames = new Map<string, string>();
    let fontIndex = 1;
    for (const family of [...new Set(target.fontFaces?.map(face => face.family))].sort()) {
      let alias: string;
      do { alias = `Framer ${identity[graph.renderRootIds[0]]} ${fontIndex++} ${family}`; }
      while ([...target.existingFiles.values()].some(code => code.includes(alias)));
      fontNames.set(family, alias);
    }
    const fontFaces = (target.fontFaces ?? []).map(face => ({ ...face, family: fontNames.get(face.family)! }));
    const google = sourceGoogleFontRequests(graph);
    result.diagnostics.push(...google.diagnostics);
    for (const file of result.files.filter(file => file.path.endsWith('.tsx'))) {
      const ast = parseJSX(file.code);
      let changed = false;
      if (ast) t.traverseFast(ast, node => {
        if (t.isObjectProperty(node) && (t.isIdentifier(node.key, { name: 'fontFamily' }) || t.isStringLiteral(node.key, { value: 'fontFamily' })) && t.isStringLiteral(node.value)) {
          const before = node.value.value;
          node.value.value = before.split(',').map(family => fontNames.has(family.trim().replace(/^["']|["']$/g, '')) ? JSON.stringify(fontNames.get(family.trim().replace(/^["']|["']$/g, ''))) : family).join(',');
          changed ||= before !== node.value.value;
        }
        if (!t.isStringLiteral(node)) return;
        const before = node.value;
        for (const [id, name] of Object.entries(colorNames)) node.value = renameCustomPropertyInText(node.value, `token-${id}`, name, true);
        changed ||= before !== node.value;
      });
      if (ast && changed) file.code = generate(ast).code;
    }
    if (colorTokens.length || fontFaces.length || google.requests.length) {
      const before = target.existingFiles.get('app/globals.css');
      const code = addGoogleFontImportsToCss(applyFramerFontFaces(applyFramerColorTokens(before ?? '', colorTokens), fontFaces), google.requests);
      result.files.push({ path: 'app/globals.css', code, ...(before === undefined ? {} : { baseCode: before }), ...(colorTokens.length ? { colorTokens } : {}), ...(fontFaces.length ? { fontFaces } : {}), ...(google.requests.length ? { googleFonts: google.requests } : {}) });
    }
    const projected = new Set([...paths, ...result.files.map(file => file.path)]), emittedPaths = new Set<string>();
    for (const file of result.files) {
      if ((paths.has(file.path) && !(file.path === 'app/globals.css' && (file.colorTokens || file.fontFaces || file.googleFonts)) && !(file.path === 'app/layout.tsx' && (file.cursorPortal || file.favicon))) || emittedPaths.has(file.path)) result.diagnostics.push({ code: 'NATIVE_PATH_CONFLICT', property: file.path, message: `Import would overwrite or duplicate ${file.path}.` });
      emittedPaths.add(file.path);
      const kind = oracleFileKind(file.path, file.code);
      if (!kind) continue;
      for (const violation of checkFile(file.code, { kind, path: file.path, projectFiles: projected })) result.diagnostics.push({ code: violation.code, property: file.path, message: violation.message });
      const ast = parseJSX(file.code);
      const linkProps = new Set(Object.entries(parsePropMeta(file.code)).filter(([, meta]) => meta.type === 'link').map(([name]) => name));
      const checkLink = (value: string) => {
        const pathname = value.split(/[?#]/)[0];
        if (relocatedRoutes.has(pathname)) result.diagnostics.push({ code: 'SOURCE_LINK_ADAPTER_REQUIRED', property: file.path, message: `Source link ${value} still targets a relocated route; its native link adapter is required.` });
      };
      if (ast) t.traverseFast(ast, node => {
        if (t.isStringLiteral(node) && /var\(--token-/.test(node.value)) result.diagnostics.push({ code: 'SOURCE_TOKEN_ADAPTER_REQUIRED', property: file.path, message: 'Source design tokens need their native preset adapter.' });
        if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name, { name: 'href' })) {
          const value = t.isJSXExpressionContainer(node.value) ? node.value.expression : node.value;
          if (t.isStringLiteral(value)) checkLink(value.value);
        }
        if (t.isAssignmentPattern(node) && t.isIdentifier(node.left) && linkProps.has(node.left.name) && t.isStringLiteral(node.right)) checkLink(node.right.value);
        if (!t.isObjectProperty(node) || !(t.isIdentifier(node.key, { name: 'fontFamily' }) || t.isStringLiteral(node.key, { value: 'fontFamily' })) || !t.isStringLiteral(node.value)) return;
        const families = node.value.value.split(',').map(family => family.trim().replace(/^["']|["']$/g, ''));
        const system = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'inherit']);
        if (families.some(family => !system.has(family) && !fontFaces.some(face => face.family === family) && !google.requests.some(font => font.family === family))) result.diagnostics.push({ code: 'SOURCE_FONT_ADAPTER_REQUIRED', property: file.path, message: `Font registration is required for ${node.value.value}.` });
      });
    }
  } catch (error) {
    result.diagnostics.push({ code: 'NATIVE_COMPILE_FAILED', message: error instanceof Error ? error.message : String(error) });
  }
  if (!result.files.length && !result.diagnostics.length) result.diagnostics.push({ code: 'SOURCE_EMPTY_IMPORT', message: 'The source closure contains no supported importable content.' });
  result.diagnostics = [...new Map(result.diagnostics.map(item => [JSON.stringify(item), item])).values()];
  result.createdIds = [...new Set(result.createdIds)];
  if (result.diagnostics.length) { result.files = []; result.createdIds = []; }
  trace.action('framer-native.compiled', { files: result.files.length, diagnostics: result.diagnostics.length });
  return result;
}
