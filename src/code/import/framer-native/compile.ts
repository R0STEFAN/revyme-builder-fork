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

export interface NativeTargetContext {
  existingFiles: ReadonlyMap<string, string>;
  mode: 'create' | 'replace' | 'paste';
  assetPayloads?: Readonly<Record<string, string>>;
  uploadedAssets?: Readonly<Record<string, string>>;
  fontFaces?: readonly WorkspaceFontFaceSpec[];
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
  if (graph.diagnostics.length) { result.diagnostics = [...graph.diagnostics]; return result; }
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
      if (metadata && Object.entries(metadata).some(([key, value]) => !['title', 'description'].includes(key) && !(node.kind === 'WebPageNode' && key === 'noIndex' && typeof value === 'boolean'))) result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', sourceId: id, property: 'webMetadata', message: 'Source metadata beyond supported page fields needs its native metadata adapter.' });
    }
    // Document metadata is inherited without importing all sibling pages.
    if (graph.byKind.get('WebPageNode')?.some(id => graph.reachable.has(id))) for (const id of graph.byKind.get('RootNode') ?? []) {
      const metadata = sourceRecord(graph.nodes.get(id)!.raw.webMetadata);
      if (metadata && Object.keys(metadata).some(key => !['title', 'description'].includes(key))) result.diagnostics.push({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED', sourceId: id, property: 'webMetadata', message: 'Inherited source document settings need their native metadata adapter.' });
    }
    const originals = target.uploadedAssets ? resolveUploadedNativeAssets(graph, identity, target.uploadedAssets) : emitNativeAssets(graph, identity, target.assetPayloads ?? {});
    const assets = target.uploadedAssets ? originals : planNativeAssets(graph, identity);
    const overrides = emitNativeCodeOverrides(graph, identity);
    const cms = emitNativeCms(graph, identity, { assets: assets.assets, colorNames });
    const options = { assets: assets.assets, overrides: overrides.overrides };
    const pages = emitNativePages(graph, identity, { ...options, existingPaths: paths });
    const components = emitNativeComponents(graph, identity, { ...options, routes: pages.routes });
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
    if (colorTokens.length || fontFaces.length) {
      const before = target.existingFiles.get('app/globals.css');
      const code = applyFramerFontFaces(applyFramerColorTokens(before ?? '', colorTokens), fontFaces);
      result.files.push({ path: 'app/globals.css', code, ...(before === undefined ? {} : { baseCode: before }), ...(colorTokens.length ? { colorTokens } : {}), ...(fontFaces.length ? { fontFaces } : {}) });
    }
    const projected = new Set([...paths, ...result.files.map(file => file.path)]), emittedPaths = new Set<string>();
    for (const file of result.files) {
      if ((paths.has(file.path) && !(file.path === 'app/globals.css' && (file.colorTokens || file.fontFaces))) || emittedPaths.has(file.path)) result.diagnostics.push({ code: 'NATIVE_PATH_CONFLICT', property: file.path, message: `Import would overwrite or duplicate ${file.path}.` });
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
        if (families.some(family => !system.has(family) && !fontFaces.some(face => face.family === family))) result.diagnostics.push({ code: 'SOURCE_FONT_ADAPTER_REQUIRED', property: file.path, message: `Original font registration is required for ${node.value.value}.` });
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
