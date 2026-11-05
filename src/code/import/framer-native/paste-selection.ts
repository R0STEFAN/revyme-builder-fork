import * as t from '@babel/types';
import { trace } from '../../../shared/debug-trace';
import { parseJSX, findFirstElementByDataId, traverse } from '../../parsing/ast-utils';
import { generate } from '../../generation/generator-utils';
import { checkFile } from '../../oracle/check-file';
import { oracleFileKind } from '../../oracle/file-kind';
import { buildSourceGraph, allocateTargetIdentity, sourceRecord } from './source-graph';
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
      if (!['FrameNode', 'RichTextNode'].includes(node.kind) || Object.entries(node.raw).some(([key, value]) => activeBehavior.test(key) && value === true || key === 'link' && value != null && value !== '' || sourceRecord(value)?.type === 'variableReference')) {
        result.diagnostics.push({ code: 'NATIVE_PASTE_BEHAVIOR_ADAPTER_REQUIRED', sourceId: id, message: 'Selected layer has behavior or bindings that need the native paste adapter.' });
      }
    }
    const selected = new Set(graph.reachable);
    for (const node of graph.nodes.values()) {
      const info = sourceRecord(node.raw.replicaInfo);
      const overrides = sourceRecord(info?.overrides);
      if (overrides && Object.keys(overrides).some(id => selected.has(id))) result.diagnostics.push({ code: 'NATIVE_PASTE_RESPONSIVE_ADAPTER_REQUIRED', sourceId: node.id, message: 'Selected layer has responsive state overrides.' });
    }
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
    const context: SourceMappingContext = { graph, diagnostics: result.diagnostics, assets: assetResult.assets, viewport: { width: 1200 } };
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
    const code = generate(ast).code;
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
