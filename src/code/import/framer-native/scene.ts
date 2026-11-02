import { trace } from '../../../shared/debug-trace';
import { escapeJsxText } from '../../parsing/rich-text-runs';
import { isSourceCodeComponent, resolveSourceNode } from './source-graph';
import { mapSourceText } from './text';
import type { SourceMappingContext } from './styles';
import type { NativeCodeComponentRef } from './code-components';
import type { ResolvedSourceNode, SourceGraph } from './types';

const frameTags = new Set(['div', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'article', 'figure', 'figcaption', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'ul', 'ol', 'li', 'a']);

export function sourceStyleLiteral(styles: Record<string, string>): string {
  return `{ ${Object.entries(styles).map(([key, value]) => {
    const binding = /^\{([A-Za-z_$][\w$]*)\}$/.exec(value);
    return `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${binding ? binding[1] : JSON.stringify(value)}`;
  }).join(', ')} }`;
}

export interface SourceScene {
  jsx: string;
  sourceIds: string[];
  nested: Map<string, string>;
  codeInstances: Map<string, NativeCodeComponentRef>;
  links: string[];
  slots: string[];
}
export interface SourceSceneOptions {
  stylesFor(node: ResolvedSourceNode, parent?: ResolvedSourceNode): Record<string, string>;
  expressionFor(value: unknown, node: ResolvedSourceNode, property: string): string;
  codeComponents?: Readonly<Record<string, NativeCodeComponentRef>>;
  template?: boolean;
}

/** One source traversal for native page/template and design-master JSX. */
export function emitSourceScene(graph: SourceGraph, identity: Record<string, string>, rootId: string, context: SourceMappingContext, options: SourceSceneOptions): SourceScene {
  trace.fn('framer-native.emitScene', { rootId });
  const result: SourceScene = { jsx: '', sourceIds: [], nested: new Map(), codeInstances: new Map(), links: [], slots: [] };
  const emit = (id: string, parent?: ResolvedSourceNode): string => {
    const node = resolveSourceNode(graph, id), targetId = identity[id];
    if (!targetId) throw new Error(`Missing node identity ${id}`);
    result.sourceIds.push(id);
    if (node.kind === 'SlotNode' && options.template) {
      if (parent?.sourceId !== rootId || node.properties.visible === false || node.children.length) throw new Error(`Template slot ${id} requires a native layout adapter`);
      result.slots.push(id);
      return '{children}';
    }
    const styles = options.stylesFor(node, parent);
    if (isSourceCodeComponent(node)) {
      const identifier = String(node.properties.codeComponentIdentifier ?? '');
      const name = typeof node.properties.name === 'string' && node.properties.name ? node.properties.name : identifier.split(':').pop() || 'Code component';
      const label = escapeJsxText(`Заглушка · ${name}`).replace(/"/g, '&quot;');
      return `<div data-id="${targetId}" data-name="${label}" style={${sourceStyleLiteral({ backgroundColor: '#eeeeee', ...styles })}}></div>`;
    }
    let tag = 'div', content = '', attributes = '';
    if (node.kind === 'RichTextNode') {
      const text = mapSourceText(node, context);
      tag = text.tag;
      attributes = Object.entries(text.attributes).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`).join('');
      content = text.binding ? `{${options.expressionFor(text.binding, node, 'textContent')}}` : text.jsx;
    } else if (node.kind === 'SlotNode') {
      result.slots.push(id); content = '{children}';
    } else if (node.kind === 'CodeComponentNode') {
      const identifier = String(node.properties.codeComponentIdentifier);
      const match = /^local-module:canvasComponent\/([^:]+):/.exec(identifier);
      if (match) result.nested.set(id, match[1]);
      content = node.children.map(child => emit(child, node)).join('\n');
    } else if (node.kind === 'FrameNode') {
      if (node.properties.htmlTag != null) {
        if (typeof node.properties.htmlTag !== 'string' || !frameTags.has(node.properties.htmlTag)) throw new Error(`Frame tag ${String(node.properties.htmlTag)} on ${id} requires its native adapter`);
        tag = node.properties.htmlTag;
      }
      content = node.children.map(child => emit(child, node)).join('\n');
    }
    else throw new Error(`Unsupported source child ${node.kind} on ${id}`);
    if (node.properties.link !== undefined && node.properties.link !== null && node.properties.link !== '') result.links.push(id);
    const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
    return `<${tag} data-id="${targetId}"${label}${attributes} style={${sourceStyleLiteral(styles)}}>${content}</${tag}>`;
  };
  result.jsx = emit(rootId);
  return result;
}
