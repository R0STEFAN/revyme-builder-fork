import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { parseJSX } from '../../parsing/ast-utils';
import { checkFile } from '../../oracle/check-file';
import { oracleFileKind } from '../../oracle/file-kind';
import { parsePropMeta } from '../../components/prop-meta';
import { buildSourceGraph, allocateTargetIdentity, isSourceCodeComponent, sourceRecord } from './source-graph';
import { planNativeAssets, emitNativeAssets, resolveUploadedNativeAssets } from './assets';
import { emitNativeCms } from './cms';
import { emitNativeComponents } from './components';
import { emitNativeCodeOverrides } from './code-adapters';
import { emitNativeCodeComponents } from './code-components';
import { emitNativePages, sourcePageRoute } from './pages';
import type { NativeCompileResult, SourceGraph, SourceNode } from './types';
import { applyFramerColorTokens, type FramerColorToken } from '../../generation/framer-token-gen';
import { applyFramerTypographyTokens } from '../../generation/framer-typography-gen';
import { sourceTypographyTokens } from './typography';
import { renameCustomPropertyInText } from '../../generation/preset-refs-gen';
import { generate } from '../../generation/generator-utils';
import { applyFramerFontFaces } from '../../generation/framer-font-gen';
import type { WorkspaceFontFaceSpec } from '../../project/preset-ops';
import { addGoogleFontImportsToCss } from '../../../shared/google-font-import';
import { sourceGoogleFontRequests } from './fonts';
import { ensureCursorPortalInLayout, hasNativeCursorPortal } from '../../generation/cursor-gen';
import { ensureSmoothScrollInLayout, SMOOTH_SCROLL_CONTROLLER_PATH, SMOOTH_SCROLL_DATA_PATH } from '../../generation/smooth-scroll-layout';
import { SMOOTH_SCROLL_CONTROLLER_SOURCE } from '../../generation/smooth-scroll-gen';
import { normalizeSmoothScroll, parseSmoothScroll, serializeSmoothScroll, setSmoothScrollForRoutesInMap, type SmoothScrollConfig } from '../../project/smooth-scroll-config';
import { parseSiteConfigFromCode, updateMetadataInCode, updateSiteConfigInCode } from '../../generation/metadata-gen';
import { updateNativeFavicon } from './favicon';
import { omitNativeSourceFeatures, type NativeSourceSkips } from './omissions';
import { resolveMissingSourceTokenFallbacks } from './token-fallback';
import { compileNativeSelectionPaste } from './paste-selection';

export interface NativeTargetContext {
  existingFiles: ReadonlyMap<string, string>;
  mode: 'create' | 'replace' | 'paste';
  filePath?: string;
  parentNodeId?: string;
  assetPayloads?: Readonly<Record<string, string>>;
  uploadedAssets?: Readonly<Record<string, string>>;
  fontFaces?: readonly WorkspaceFontFaceSpec[];
  skipFeatures?: NativeSourceSkips;
  tolerant?: boolean;
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
  if (target.mode === 'paste') return compileNativeSelectionPaste(input, target);
  if (target.mode === 'replace') {
    const path = target.filePath;
    if (!path || !/^app\/(?:[^/]+\/)*page\.client\.tsx$/.test(path) || !target.existingFiles.has(path)) {
      result.diagnostics.push({ code: 'NATIVE_REPLACE_TARGET_INVALID', message: 'Replace requires an existing native page client file.' });
      return result;
    }
    try {
      const prepared = target.skipFeatures ? omitNativeSourceFeatures(input, target.skipFeatures).transfer : input;
      const source = buildSourceGraph(prepared);
      if (source.transfer.context.mode !== 'page' || source.renderRootIds.length !== 1 || source.nodes.get(source.renderRootIds[0])?.kind !== 'WebPageNode') {
        result.diagnostics.push({ code: 'NATIVE_REPLACE_SOURCE_INVALID', message: 'Replace requires exactly one captured source page.' });
        return result;
      }
    } catch (error) {
      result.diagnostics.push({ code: 'SOURCE_CAPTURE_INVALID', message: error instanceof Error ? error.message : String(error) });
      return result;
    }
    const wrapper = path.replace(/page\.client\.tsx$/, 'page.tsx');
    const virtualExisting = new Map(target.existingFiles);
    virtualExisting.delete(path);
    virtualExisting.delete(wrapper);
    const candidate = compileNativeTransfer(input, { ...target, mode: 'create', existingFiles: virtualExisting });
    if (candidate.diagnostics.length) return candidate;
    if (!candidate.files.some(file => file.path === path) || !candidate.files.some(file => file.path === wrapper)) {
      return { ...result, omissions: candidate.omissions, diagnostics: [{ code: 'NATIVE_REPLACE_ROUTE_MISMATCH', message: `Source route does not match ${path}.` }] };
    }
    return candidate;
  }
  if (target.mode !== 'create') {
    result.diagnostics.push({ code: 'NATIVE_TARGET_ADAPTER_REQUIRED', message: `The ${target.mode} target requires its native placement/CAS adapter.` });
    return result;
  }
  let graph: SourceGraph;
  try {
    const prepared = target.skipFeatures ? omitNativeSourceFeatures(input, target.skipFeatures) : undefined;
    if (prepared) result.omissions = prepared.omissions;
    graph = buildSourceGraph(prepared?.transfer ?? input);
  }
  catch (error) {
    result.diagnostics.push({ code: 'SOURCE_CAPTURE_INVALID', message: error instanceof Error ? error.message : String(error) });
    return result;
  }
  result.diagnostics = [...graph.diagnostics];
  try {
    const paths = new Set(target.existingFiles.keys());
    const identityPaths = new Set(paths);
    for (const match of (target.existingFiles.get('app/globals.css') ?? '').matchAll(/--color-([a-z0-9-]+)/g)) identityPaths.add(`__tokens__/${match[1]}.css`);
    const identity = result.identity = allocateTargetIdentity(graph, identityPaths);
    const colorNames = Object.fromEntries((graph.byKind.get('ColorStyleTokenNode') ?? []).filter(id => graph.reachable.has(id)).map(id => [id, `color-${identity[id]}`]));
    for (const id of graph.renderRootIds) {
      if (!['WebPageNode', 'SmartComponentNode', 'LayoutTemplateNode', 'CollectionNode'].includes(graph.nodes.get(id)!.kind)) result.diagnostics.push({ code: 'SOURCE_ROOT_ADAPTER_REQUIRED', sourceId: id, message: 'This source root requires its native placement adapter.' });
    }
    for (const id of graph.reachable) {
      const node = graph.nodes.get(id)!;
      const metadata = sourceRecord(node.raw.webMetadata);
      if (node.kind === 'WebPageNode' && typeof metadata?.noIndexSite === 'boolean') trace.action('framer-native.skipSiteIndexFlag', { sourceId: id, value: metadata.noIndexSite });
      for (const [metadataKey] of Object.entries(metadata ?? {}).filter(([key, value]) => !['title', 'description'].includes(key) && !(node.kind === 'WebPageNode' && ['noIndex', 'noIndexSite'].includes(key) && typeof value === 'boolean') && !(['WebPageNode', 'RootNode'].includes(node.kind) && key === 'socialImage' && (typeof value === 'string' || (node.kind === 'WebPageNode' && typeof value === 'object' && value !== null && (value as any).type === 'variableReference'))) && !(node.kind === 'RootNode' && ['favicon', 'faviconDark', 'appleTouchIcon'].includes(key) && typeof value === 'string' && graph.transfer.context.mode === 'project') && !(node.kind === 'RootNode' && key === 'reducedMotion' && typeof value === 'boolean') && !(node.kind === 'RootNode' && key === 'translatePagePaths' && value === false) && !(node.kind === 'RootNode' && key === 'language' && (graph.transfer.context.mode === 'project' || destinationLanguageMatches(target.existingFiles.get('app/layout.tsx'), value))))) result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', sourceId: id, property: `webMetadata.${metadataKey}`, message: 'Source metadata beyond supported page fields needs its native metadata adapter.' });
    }
    // Document metadata is inherited without importing all sibling pages.
    if (graph.byKind.get('WebPageNode')?.some(id => graph.reachable.has(id))) for (const id of graph.byKind.get('RootNode') ?? []) {
      const metadata = sourceRecord(graph.nodes.get(id)!.raw.webMetadata);
      for (const [metadataKey] of Object.entries(metadata ?? {}).filter(([key, value]) => !['title', 'description'].includes(key) && !(key === 'socialImage' && typeof value === 'string') && !(['favicon', 'faviconDark', 'appleTouchIcon'].includes(key) && typeof value === 'string' && graph.transfer.context.mode === 'project') && !(key === 'reducedMotion' && typeof value === 'boolean') && !(key === 'translatePagePaths' && value === false) && !(key === 'language' && (graph.transfer.context.mode === 'project' || destinationLanguageMatches(target.existingFiles.get('app/layout.tsx'), value))))) result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', sourceId: id, property: `webMetadata.${metadataKey}`, message: 'Inherited source document settings need their native metadata adapter.' });
    }
    if (!target.tolerant && result.diagnostics.length) return result;
    const fatalInit = result.diagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID');
    if (fatalInit.length) return result;
    const originals = target.uploadedAssets ? resolveUploadedNativeAssets(graph, identity, target.uploadedAssets) : emitNativeAssets(graph, identity, target.assetPayloads ?? {});
    const assets = target.uploadedAssets ? originals : planNativeAssets(graph, identity);
    const overrides = emitNativeCodeOverrides(graph, identity);
    const codeComponents = emitNativeCodeComponents(graph, identity, { skipUnsupported: true });
    const cms = emitNativeCms(graph, identity, { assets: assets.assets, colorNames });
    const reducedMotion = (graph.byKind.get('RootNode') ?? []).some(id => sourceRecord(graph.nodes.get(id)!.raw.webMetadata)?.reducedMotion === true);
    const options = { assets: assets.assets, overrides: overrides.overrides, codeComponents: codeComponents.components };
    const pages = emitNativePages(graph, identity, { ...options, existingPaths: paths });
    const components = emitNativeComponents(graph, identity, { ...options, routes: pages.routes });
    if (components.files.some(file => /\bwithCursor\s*\(/.test(file.code)) || pages.files.some(file => /\bwithCursor\s*\(/.test(file.code))) {
      const original = target.existingFiles.get('app/layout.tsx');
      const updated = original === undefined ? undefined : ensureCursorPortalInLayout(original);
      if (!updated || !hasNativeCursorPortal(updated)) result.diagnostics.push({ code: 'SOURCE_CURSOR_PORTAL_REQUIRED', message: 'Component cursors require a valid native root layout and cursor portal.' });
      else if (updated !== original) result.files.push({ path: 'app/layout.tsx', code: updated, baseCode: original, cursorPortal: true });
    }
    const smoothScrollNodes = [...graph.reachable]
      .map(id => graph.nodes.get(id))
      .filter((node): node is SourceNode => {
        if (!node || !isSourceCodeComponent(node)) return false;
        const identifier = String(node.raw.codeComponentIdentifier ?? '');
        const name = typeof node.raw.name === 'string' && node.raw.name ? node.raw.name : identifier.split(':').pop() || '';
        return /SmoothScroll/i.test(identifier) || /^Smooth\s*Scroll$/i.test(name);
      });
    if (smoothScrollNodes.length > 0 && Object.keys(pages.routes).length > 0) {
      const node = smoothScrollNodes[0];
      const unwrap = (key: string) => {
        const ctrl = sourceRecord(node.raw[`$control__${key}`]);
        return ctrl && 'value' in ctrl ? ctrl.value : node.raw[key];
      };
      const intensity = unwrap('intensity');
      const smoothTouch = unwrap('smoothTouch') ?? unwrap('syncTouch');
      const orientation = unwrap('orientation') ?? unwrap('direction');
      const smoothScrollCfg: SmoothScrollConfig = normalizeSmoothScroll({
        enabled: unwrap('enabled') !== false,
        intensity: typeof intensity === 'number' ? intensity : 12,
        smoothWheel: unwrap('smoothWheel') !== false,
        smoothTouch: smoothTouch === true,
        orientation: orientation === 'horizontal' ? 'horizontal' : 'vertical',
        infinite: unwrap('infinite') === true,
      });
      const existingScrollData = target.existingFiles.get(SMOOTH_SCROLL_DATA_PATH);
      const nextScrollMap = setSmoothScrollForRoutesInMap(
        parseSmoothScroll(existingScrollData),
        Object.values(pages.routes),
        smoothScrollCfg,
      );
      const nextScrollData = serializeSmoothScroll(nextScrollMap);
      if (nextScrollData !== existingScrollData) {
        result.files.push({
          path: SMOOTH_SCROLL_DATA_PATH,
          code: nextScrollData,
          ...(existingScrollData !== undefined ? { baseCode: existingScrollData } : {}),
        });
      }
      const existingController = target.existingFiles.get(SMOOTH_SCROLL_CONTROLLER_PATH);
      if (existingController !== SMOOTH_SCROLL_CONTROLLER_SOURCE) {
        result.files.push({
          path: SMOOTH_SCROLL_CONTROLLER_PATH,
          code: SMOOTH_SCROLL_CONTROLLER_SOURCE,
          ...(existingController !== undefined ? { baseCode: existingController } : {}),
        });
      }
      const originalLayout = target.existingFiles.get('app/layout.tsx');
      if (originalLayout !== undefined) {
        const priorLayout = result.files.find(file => file.path === 'app/layout.tsx');
        const baseLayout = priorLayout?.code ?? originalLayout;
        const updatedLayout = ensureSmoothScrollInLayout(baseLayout);
        if (updatedLayout !== baseLayout) {
          if (priorLayout) {
            priorLayout.code = updatedLayout;
            priorLayout.smoothScroll = true;
          } else {
            result.files.push({
              path: 'app/layout.tsx',
              code: updatedLayout,
              baseCode: originalLayout,
              smoothScroll: true,
            });
          }
        }
      }
    }
    if (graph.transfer.context.mode === 'project' && graph.byKind.get('WebPageNode')?.some(id => graph.reachable.has(id))) {
      const roots = (graph.byKind.get('RootNode') ?? []).map(id => sourceRecord(graph.nodes.get(id)!.raw.webMetadata));
      const rootMeta = roots[0];
      if (rootMeta) {
        const original = target.existingFiles.get('app/layout.tsx'), prior = result.files.find(file => file.path === 'app/layout.tsx');
        let code = prior?.code ?? original;
        let faviconUrl: string | undefined;
        let faviconDarkUrl: string | undefined;
        let socialImageUrl: string | undefined;
        let siteTitle: string | undefined;
        let siteDescription: string | undefined;
        let siteLanguage: string | undefined;

        if (rootMeta.favicon !== undefined || rootMeta.faviconDark !== undefined) {
          const ref = rootMeta.favicon;
          const url = typeof ref === 'string' ? assets.assets[ref] : undefined;
          const darkRef = rootMeta.faviconDark;
          const darkUrl = typeof darkRef === 'string' ? assets.assets[darkRef] : undefined;
          if (!url || (darkRef !== undefined && !darkUrl) || original === undefined) {
            result.diagnostics.push({ code: 'SOURCE_FAVICON_ADAPTER_REQUIRED', message: 'The source favicon or native root metadata cannot be safely updated.' });
          } else {
            faviconUrl = url;
            faviconDarkUrl = darkUrl;
          }
        }

        if (rootMeta.socialImage !== undefined) {
          const ref = rootMeta.socialImage;
          const url = typeof ref === 'string' ? assets.assets[ref] : undefined;
          if (!url) {
            result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', message: 'The source social image cannot be safely updated.' });
          } else {
            socialImageUrl = url;
          }
        }

        if (typeof rootMeta.title === 'string' && rootMeta.title.trim()) siteTitle = rootMeta.title;
        if (typeof rootMeta.description === 'string' && rootMeta.description.trim()) siteDescription = rootMeta.description;
        if (typeof rootMeta.language === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(rootMeta.language)) siteLanguage = rootMeta.language;

        const hasMetadataToUpdate = faviconUrl !== undefined || socialImageUrl !== undefined || siteTitle !== undefined || siteDescription !== undefined || siteLanguage !== undefined;

        if (hasMetadataToUpdate && code !== undefined && !result.diagnostics.some(d => d.code === 'SOURCE_FAVICON_ADAPTER_REQUIRED' || d.code === 'SOURCE_METADATA_ADAPTER_REQUIRED')) {
          if (siteTitle !== undefined || siteDescription !== undefined || socialImageUrl !== undefined) {
            code = updateMetadataInCode(code, {
              ...(siteTitle !== undefined ? { title: siteTitle } : {}),
              ...(siteDescription !== undefined ? { description: siteDescription } : {}),
              ...(socialImageUrl !== undefined ? { openGraph: { images: [socialImageUrl] } } : {}),
            });
          }
          if (faviconUrl) {
            const patched = updateNativeFavicon(code, faviconUrl, faviconDarkUrl);
            if (patched) code = patched;
            else result.diagnostics.push({ code: 'SOURCE_FAVICON_ADAPTER_REQUIRED', message: 'The source favicon or native root metadata cannot be safely updated.' });
          }
          if (siteLanguage !== undefined) {
            code = updateSiteConfigInCode(code, { language: siteLanguage });
          }

          if (code !== original) {
            if (prior) {
              prior.code = code;
              if (faviconUrl) prior.favicon = faviconUrl;
              if (faviconDarkUrl) prior.faviconDark = faviconDarkUrl;
              if (siteTitle !== undefined) prior.siteTitle = siteTitle;
              if (siteDescription !== undefined) prior.siteDescription = siteDescription;
              if (socialImageUrl !== undefined) prior.socialImage = socialImageUrl;
              if (siteLanguage !== undefined) prior.siteLanguage = siteLanguage;
            } else {
              result.files.push({
                path: 'app/layout.tsx',
                code,
                baseCode: original,
                ...(faviconUrl ? { favicon: faviconUrl } : {}),
                ...(faviconDarkUrl ? { faviconDark: faviconDarkUrl } : {}),
                ...(siteTitle !== undefined ? { siteTitle } : {}),
                ...(siteDescription !== undefined ? { siteDescription } : {}),
                ...(socialImageUrl !== undefined ? { socialImage: socialImageUrl } : {}),
                ...(siteLanguage !== undefined ? { siteLanguage } : {}),
              });
            }
          }
        }
      }
    }
    const relocatedRoutes = new Map(Object.entries(pages.routes).map(([id, route]) => [sourcePageRoute(graph, graph.nodes.get(id)!), route] as const).filter(([before, after]) => before !== after));
    for (const emitted of [originals, overrides, codeComponents, cms, components, pages]) {
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
    const typography = sourceTypographyTokens(graph, identity);
    result.diagnostics.push(...typography.diagnostics);
    const typographyTokens = typography.tokens.map(token => {
      let value = token.value;
      if (token.name.endsWith('-font')) {
        const family = /^"([^"]+)"$/.exec(value)?.[1];
        if (family && fontNames.has(family)) value = JSON.stringify(fontNames.get(family));
      }
      for (const [id, name] of Object.entries(colorNames)) value = renameCustomPropertyInText(value, `token-${id}`, name, true);
      return { ...token, value: resolveMissingSourceTokenFallbacks(value) };
    });
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
        if (t.isStringLiteral(node)) {
          const before = node.value;
          for (const [id, name] of Object.entries(colorNames)) node.value = renameCustomPropertyInText(node.value, `token-${id}`, name, true);
          node.value = resolveMissingSourceTokenFallbacks(node.value).replace(/var\(\s*--token-[a-zA-Z0-9-]+\s*\)/g, 'inherit');
          changed ||= before !== node.value;
        } else if (t.isTemplateElement(node)) {
          const before = node.value.raw;
          for (const [id, name] of Object.entries(colorNames)) {
            node.value.raw = renameCustomPropertyInText(node.value.raw, `token-${id}`, name, true);
            if (node.value.cooked != null) node.value.cooked = renameCustomPropertyInText(node.value.cooked, `token-${id}`, name, true);
          }
          node.value.raw = resolveMissingSourceTokenFallbacks(node.value.raw).replace(/var\(\s*--token-[a-zA-Z0-9-]+\s*\)/g, 'inherit');
          if (node.value.cooked != null) node.value.cooked = resolveMissingSourceTokenFallbacks(node.value.cooked).replace(/var\(\s*--token-[a-zA-Z0-9-]+\s*\)/g, 'inherit');
          changed ||= before !== node.value.raw;
        }
      });
      if (ast && changed) file.code = generate(ast).code;
    }
    if (colorTokens.length || typographyTokens.length || fontFaces.length || google.requests.length) {
      const before = target.existingFiles.get('app/globals.css');
      const code = addGoogleFontImportsToCss(applyFramerFontFaces(applyFramerTypographyTokens(applyFramerColorTokens(before ?? '', colorTokens), typographyTokens), fontFaces), google.requests);
      result.files.push({ path: 'app/globals.css', code, ...(before === undefined ? {} : { baseCode: before }), ...(colorTokens.length ? { colorTokens } : {}), ...(typographyTokens.length ? { typographyTokens } : {}), ...(fontFaces.length ? { fontFaces } : {}), ...(google.requests.length ? { googleFonts: google.requests } : {}) });
    }
    const assetPaths = 'requests' in assets && Array.isArray((assets as any).requests) ? ((assets as any).requests as Array<{ path: string }>).map(r => r.path) : [];
    const projected = new Set([...paths, ...result.files.map(file => file.path), ...assetPaths]), emittedPaths = new Set<string>();
    const isLayoutPatch = (file: typeof result.files[number]) =>
      file.path === 'app/layout.tsx' && (
        file.cursorPortal === true ||
        file.smoothScroll === true ||
        file.favicon !== undefined ||
        file.faviconDark !== undefined ||
        file.siteTitle !== undefined ||
        file.siteDescription !== undefined ||
        file.socialImage !== undefined ||
        file.siteLanguage !== undefined
      );
    const isTokenPatch = (file: typeof result.files[number]) =>
      file.path === 'app/globals.css' && !!(file.colorTokens || file.typographyTokens || file.fontFaces || file.googleFonts);
    const isSmoothScrollPatch = (file: typeof result.files[number]) =>
      file.path === SMOOTH_SCROLL_DATA_PATH || file.path === SMOOTH_SCROLL_CONTROLLER_PATH;
    for (const file of result.files) {
      if ((paths.has(file.path) && !isTokenPatch(file) && !isLayoutPatch(file) && !isSmoothScrollPatch(file)) || emittedPaths.has(file.path)) result.diagnostics.push({ code: 'NATIVE_PATH_CONFLICT', property: file.path, message: `Import would overwrite or duplicate ${file.path}.` });
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
        if ((t.isStringLiteral(node) && /var\(--token-/.test(node.value)) || (t.isTemplateElement(node) && /var\(--token-/.test(node.value.raw))) result.diagnostics.push({ code: 'SOURCE_TOKEN_ADAPTER_REQUIRED', property: file.path, message: 'Source design tokens need their native preset adapter.' });
        if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name, { name: 'href' })) {
          const value = t.isJSXExpressionContainer(node.value) ? node.value.expression : node.value;
          if (t.isStringLiteral(value)) checkLink(value.value);
        }
        if (t.isAssignmentPattern(node) && t.isIdentifier(node.left) && linkProps.has(node.left.name) && t.isStringLiteral(node.right)) checkLink(node.right.value);
        if (!t.isObjectProperty(node) || !(t.isIdentifier(node.key, { name: 'fontFamily' }) || t.isStringLiteral(node.key, { value: 'fontFamily' })) || !t.isStringLiteral(node.value)) return;
        const families = node.value.value.split(',').map(family => family.trim().replace(/^["']|["']$/g, ''));
        const system = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'inherit']);
        if (families.some(family => !system.has(family) && !fontFaces.some(face => face.family === family) && !google.requests.some(font => font.family === family) && !typographyTokens.some(token => token.name.endsWith('-font') && family === `var(--${token.name})`))) result.diagnostics.push({ code: 'SOURCE_FONT_ADAPTER_REQUIRED', property: file.path, message: `Font registration is required for ${node.value.value}.` });
      });
    }
  } catch (error) {
    result.diagnostics.push({ code: 'NATIVE_COMPILE_FAILED', message: error instanceof Error ? error.message : String(error) });
  }
  if (!result.files.length && !result.diagnostics.length) result.diagnostics.push({ code: 'SOURCE_EMPTY_IMPORT', message: 'The source closure contains no supported importable content.' });
  result.diagnostics = [...new Map(result.diagnostics.map(item => [JSON.stringify(item), item])).values()];
  result.createdIds = [...new Set(result.createdIds)];
  if (target.tolerant) {
    const fatalErrors = result.diagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID' || d.code === 'NATIVE_COMPILE_FAILED');
    if (fatalErrors.length) { result.files = []; result.createdIds = []; }
  } else if (result.diagnostics.length) {
    result.files = []; result.createdIds = [];
  }
  trace.action('framer-native.compiled', { files: result.files.length, diagnostics: result.diagnostics.length });
  return result;
}
