import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { parseJSX, findFirstElementByDataId, traverse } from '../../parsing/ast-utils';
import { generate } from '../../generation/generator-utils';
import { checkFile } from '../../oracle/check-file';
import { oracleFileKind } from '../../oracle/file-kind';
import { parseCanvasConfig } from '../../project/canvas-config';
import { CSS_NEUTRAL_FALLBACK, updateContainerQueryStyle } from '../../generation/generator-styles';
import { normalizeTransparent } from '../../../shared/css-utils';
import { convertToMotionLinkInCode } from '../../generation/generator-attrs';
import { setTagAttr } from '../../generation/generator-utils';
import { sourceStaticLinkValue } from './links';
import { buildSourceGraph, allocateTargetIdentity, resolveSourceNode, sourceRecord } from './source-graph';
import { emitSourceScene } from './scene';
import { mapSourceStyles, type SourceMappingContext } from './styles';
import { emitNativeAssets, resolveUploadedNativeAssets } from './assets';
import { omitNativeSourceFeatures } from './omissions';
import type { NativeTargetContext } from './compile';
import type { NativeCompileResult } from './types';

const safeParentTags = new Set(['div', 'section', 'main', 'article', 'header', 'footer', 'aside', 'nav', 'ul', 'ol', 'li', 'form', 'motion.div', 'motion.section']);
const activeBehavior = /^(?:appearEffectEnabled|enterEffectEnabled|exitEffectEnabled|flowEffectEnabled|loopEffectEnabled|scrollEffectEnabled|codeOverrideEnabled|customCursorEnabled|isFormContainer)$/;

/** Static selected layers enter an existing native JSX parent as one candidate file. */
export function compileNativeSelectionPaste(input: unknown, target: NativeTargetContext): NativeCompileResult {
  trace.fn('framer-native.compileSelectionPaste', { filePath: target.filePath, parentNodeId: target.parentNodeId });
  const result: NativeCompileResult = { files: [], createdIds: [], identity: {}, diagnostics: [] };
  const path = target.filePath, parentId = target.parentNodeId;
  const before = path ? target.existingFiles.get(path) : undefined;
  if (!path || !parentId || !before || !/^(?:app\/(?:[^/]+\/)*page\.client\.tsx|components\/[^/]+\.tsx)$/.test(path)) {
    result.diagnostics.push({ code: 'NATIVE_PASTE_TARGET_INVALID', message: 'Paste requires an existing native canvas file and explicit parent node.' });
    return result;
  }
  try {
    const prepared = target.skipFeatures ? omitNativeSourceFeatures(input, target.skipFeatures) : undefined;
    result.omissions = prepared?.omissions;
    const graph = buildSourceGraph(prepared?.transfer ?? input);
    result.diagnostics.push(...graph.diagnostics);
    if (graph.transfer.context.mode !== 'selection' || !graph.renderRootIds.length) result.diagnostics.push({ code: 'NATIVE_PASTE_SOURCE_INVALID', message: 'Paste requires selected source layers.' });
    for (const id of graph.reachable) {
      const node = graph.nodes.get(id)!;
      if (!['FrameNode', 'RichTextNode'].includes(node.kind) || Object.entries(node.raw).some(([key, value]) => activeBehavior.test(key) && value === true || sourceRecord(value)?.type === 'variableReference')) {
        result.diagnostics.push({ code: 'NATIVE_PASTE_BEHAVIOR_ADAPTER_REQUIRED', sourceId: id, message: 'Selected layer has behavior or bindings that need the native paste adapter.' });
      }
      if (node.raw.link != null && node.raw.link !== '') {
        const ref = sourceRecord(node.raw.link);
        if (ref?.type === 'webPage') result.diagnostics.push({ code: 'NATIVE_PASTE_LINK_ROUTE_REQUIRED', sourceId: id, message: 'The destination route for this selected page link is unavailable.' });
        else {
          try {
            const href = sourceStaticLinkValue(node.raw.link);
            if (typeof href !== 'string' || !/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) || /[\u0000-\u0020]/.test(href)) throw new Error('Unsupported selected link');
          } catch (error) { result.diagnostics.push({ code: 'NATIVE_PASTE_LINK_ADAPTER_REQUIRED', sourceId: id, message: error instanceof Error ? error.message : String(error) }); }
        }
      } else if (node.raw.linkOpenInNewTab === true) result.diagnostics.push({ code: 'NATIVE_PASTE_LINK_ADAPTER_REQUIRED', sourceId: id, message: 'A selected link target has no link.' });
    }
    const selected = new Set(graph.reachable);
    const replicas = [...graph.nodes.values()].filter(node => {
      const info = sourceRecord(node.raw.replicaInfo);
      return Object.keys(sourceRecord(info?.overrides) ?? {}).some(id => selected.has(id));
    });
    const ast = parseJSX(before);
    if (!ast) throw new Error('Target source cannot be parsed');
    let parent: t.JSXElement | undefined;
    findFirstElementByDataId(ast, parentId, (_path, element) => { parent = element; });
    const parentTag = parent && generate(parent.openingElement.name).code;
    if (!parent || !parentTag || !safeParentTags.has(parentTag)) result.diagnostics.push({ code: 'NATIVE_PASTE_TARGET_INVALID', message: 'The insertion parent is missing or cannot hold children.' });
    if (result.diagnostics.length) return result;
    const reserved = new Set(target.existingFiles.keys());
    t.traverseFast(ast, node => {
      if (!t.isJSXAttribute(node) || !t.isJSXIdentifier(node.name, { name: 'data-id' }) || !t.isStringLiteral(node.value)) return;
      reserved.add(node.value.value);
    });
    const identity = result.identity = allocateTargetIdentity(graph, reserved);
    const assetResult = target.uploadedAssets ? resolveUploadedNativeAssets(graph, identity, target.uploadedAssets) : emitNativeAssets(graph, identity, target.assetPayloads ?? {});
    result.diagnostics.push(...assetResult.diagnostics);
    if (result.diagnostics.length) return result;
    const viewports = parseCanvasConfig(before)?.viewports ?? [];
    const primaryWidth = viewports.find(viewport => viewport.isPrimary)?.designWidth ?? viewports.find(viewport => viewport.isPrimary)?.width ?? 1200;
    const context: SourceMappingContext = { graph, diagnostics: result.diagnostics, assets: assetResult.assets, viewport: { width: primaryWidth } };
    const scenes = graph.renderRootIds.map(id => emitSourceScene(graph, identity, id, context, {
      stylesFor: (node, parent) => mapSourceStyles(node, { ...context, parent }),
      expressionFor: () => { throw new Error('Selected dynamic bindings require the native paste adapter'); },
    }));
    if (result.diagnostics.length) return result;
    const fragment = parseJSX(`const __framerPaste = <>${scenes.map(scene => scene.jsx).join('')}</>;`);
    let elements: t.JSXElement[] = [];
    if (fragment) traverse(fragment, { VariableDeclarator(path) {
      if (t.isIdentifier(path.node.id, { name: '__framerPaste' }) && t.isJSXFragment(path.node.init)) elements = path.node.init.children.filter(t.isJSXElement).map(element => t.cloneNode(element, true));
    } });
    if (elements.length !== scenes.length) throw new Error('Selected JSX could not be parsed');
    if (parent!.openingElement.selfClosing) {
      parent!.openingElement.selfClosing = false;
      parent!.closingElement = t.jsxClosingElement(t.cloneNode(parent!.openingElement.name, true));
    }
    parent!.children.push(...elements);
    let code = generate(ast).code;
    for (const scene of scenes) for (const id of scene.links) {
      const node = graph.nodes.get(id)!;
      const href = sourceStaticLinkValue(node.raw.link);
      code = convertToMotionLinkInCode(code, identity[id]);
      code = setTagAttr(code, identity[id], 'href', JSON.stringify(href));
      if (typeof node.raw.linkOpenInNewTab === 'boolean') code = setTagAttr(code, identity[id], 'target', JSON.stringify(node.raw.linkOpenInNewTab ? '_blank' : '_self'));
    }
    const parentOf = new Map<string, string>();
    for (const scene of scenes) for (const id of scene.sourceIds) for (const child of resolveSourceNode(graph, id).children) parentOf.set(child, id);
    for (const replica of replicas) {
      const info = sourceRecord(replica.raw.replicaInfo)!;
      const sourceWidth = replica.raw.width;
      const viewport = viewports.find(item => !item.isPrimary && (item.designWidth ?? item.width) === sourceWidth);
      if (typeof info.master !== 'string' || !selected.has(info.master) || !viewport) {
        result.diagnostics.push({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED', sourceId: replica.id, message: 'Selected responsive state has no matching destination breakpoint.' });
        continue;
      }
      for (const [id, rawOverride] of Object.entries(sourceRecord(info.overrides) ?? {})) {
        if (!selected.has(id)) continue;
        const override = sourceRecord(rawOverride);
        if (!override || Object.keys(override).some(key => key === 'children' || key === 'itemsOrder' || key === '_deleted')) {
          result.diagnostics.push({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED', sourceId: id, message: 'Selected responsive structure needs its native adapter.' });
          continue;
        }
        const base = resolveSourceNode(graph, id), state = resolveSourceNode(graph, id, replica.id);
        const parentId = parentOf.get(id);
        const baseParent = parentId ? resolveSourceNode(graph, parentId) : undefined;
        const stateParent = parentId ? resolveSourceNode(graph, parentId, replica.id) : undefined;
        const baseContext = { ...context, viewport: { width: primaryWidth }, parent: baseParent };
        const stateContext = { ...context, viewport: { width: Number(sourceWidth) }, parent: stateParent };
        const baseStyles = mapSourceStyles(base, baseContext);
        const styles = mapSourceStyles(state, stateContext);
        for (const [key, value] of Object.entries(override)) {
          if (JSON.stringify(value) === JSON.stringify(base.properties[key])) continue;
          const isolated = mapSourceStyles({ ...base, properties: { ...base.properties, [key]: value } }, baseContext);
          if (JSON.stringify(isolated) === JSON.stringify(baseStyles)) result.diagnostics.push({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED', sourceId: id, property: key, message: `Selected responsive ${key} needs its native adapter.` });
        }
        if (result.diagnostics.length) continue;
        const changes: Record<string, string> = {};
        for (const key of new Set([...Object.keys(baseStyles), ...Object.keys(styles)])) if (styles[key] !== baseStyles[key]) {
          let val = styles[key] ?? CSS_NEUTRAL_FALLBACK[key] ?? 'initial';
          if (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(key) && (val === 'auto' || val === 'none' || val === 'initial')) val = '';
          changes[key] = val;
        }
        if (Object.keys(changes).length) code = updateContainerQueryStyle(code, identity[id], viewport.width, normalizeTransparent(changes), { viewportWidths: viewports.map(item => item.width) });
      }
    }
    const kind = oracleFileKind(path, code);
    if (!kind) throw new Error('Target canvas kind is unavailable');
    const projected = new Set([...target.existingFiles.keys(), ...assetResult.files.map(file => file.path)]);
    result.diagnostics.push(...checkFile(code, { kind, path, projectFiles: projected }).map(violation => ({ code: violation.code, property: path, message: violation.message })));
    if (result.diagnostics.length) return result;
    result.files = [...assetResult.files, { path, code }];
    result.createdIds = [...new Set(scenes.flatMap(scene => scene.sourceIds.map(id => identity[id])))];
    trace.action('framer-native.selection-paste-compiled', { sourceRoots: scenes.length, createdIds: result.createdIds.length });
  } catch (error) {
    result.diagnostics.push({ code: 'NATIVE_PASTE_COMPILE_FAILED', message: error instanceof Error ? error.message : String(error) });
  }
  if (result.diagnostics.length) { result.files = []; result.createdIds = []; }
  return result;
}
