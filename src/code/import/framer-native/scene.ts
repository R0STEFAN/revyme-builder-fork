import { trace } from '../../../shared/debug-trace';
import { escapeJsxText } from '../../parsing/rich-text-runs';
import { serializeFormConfig } from '../../../editor/tools/FormTool/form-config';
import { isSourceCodeComponent, resolveSourceNode, sourceRecord } from './source-graph';
import { mapSourceText } from './text';
import type { SourceMappingContext } from './styles';
import type { NativeCodeComponentRef } from './code-components';
import type { ResolvedSourceNode, SourceGraph } from './types';

const frameTags = new Set(['div', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'article', 'figure', 'figcaption', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'ul', 'ol', 'li', 'a', 'label']);
const formTextInputTypes = new Set(['text', 'textarea', 'email', 'number', 'tel', 'url', 'date', 'time']);
const formContainerKeys = new Set(['isFormContainer', 'formSaveId', 'formSubmitButtonId']);

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
  forms: string[];
  formControls: string[];
  optionIds: string[];
}
export interface SourceSceneOptions {
  stylesFor(node: ResolvedSourceNode, parent?: ResolvedSourceNode): Record<string, string>;
  expressionFor(value: unknown, node: ResolvedSourceNode, property: string): string;
  codeComponents?: Readonly<Record<string, NativeCodeComponentRef>>;
  template?: boolean;
  intrinsicImageFor?: (node: ResolvedSourceNode) => string | undefined;
}

/** One source traversal for native page/template and design-master JSX. */
export function emitSourceScene(graph: SourceGraph, identity: Record<string, string>, rootId: string, context: SourceMappingContext, options: SourceSceneOptions): SourceScene {
  trace.fn('framer-native.emitScene', { rootId });
  const result: SourceScene = { jsx: '', sourceIds: [], nested: new Map(), codeInstances: new Map(), links: [], slots: [], forms: [], formControls: [], optionIds: [] };
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
    const intrinsicImage = options.intrinsicImageFor?.(node);
    if (intrinsicImage) {
      if (node.kind !== 'FrameNode' || node.children.length) throw new Error(`Intrinsic CMS image ${id} requires a leaf frame`);
      const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
      return `<img data-id="${targetId}"${label} src={${intrinsicImage}} style={${sourceStyleLiteral(styles)}} />`;
    }
    if (isSourceCodeComponent(node)) {
      const identifier = String(node.properties.codeComponentIdentifier ?? '');
      const name = typeof node.properties.name === 'string' && node.properties.name ? node.properties.name : identifier.split(':').pop() || 'Code component';
      if (identifier.endsWith(':Video') || name === 'Video') {
        const unwrapControl = (ctrl: unknown) => {
          const rec = sourceRecord(ctrl);
          return rec && 'value' in rec ? rec.value : ctrl;
        };
        const srcRaw = unwrapControl(node.properties.$control__srcFile ?? node.properties.$control__srcUrl ?? node.properties.$control__url ?? node.properties.$control__src);
        const posterRaw = unwrapControl(node.properties.$control__poster);
        const autoPlay = unwrapControl(node.properties.$control__autoPlay) ?? true;
        const loop = unwrapControl(node.properties.$control__loop) ?? true;
        const muted = unwrapControl(node.properties.$control__muted) ?? true;
        const playsInline = unwrapControl(node.properties.$control__playsInline) ?? true;
        const controls = unwrapControl(node.properties.$control__controls) ?? false;

        const formatAttr = (attr: string, rawVal: unknown) => {
          if (rawVal === undefined || rawVal === null || rawVal === '') return '';
          if (typeof rawVal === 'string') {
            return ` ${attr}=${JSON.stringify(rawVal)}`;
          }
          try {
            const expr = options.expressionFor(rawVal, node, attr);
            if (expr.startsWith('"')) return ` ${attr}=${expr}`;
            return ` ${attr}={${expr}}`;
          } catch {
            return '';
          }
        };

        const srcAttr = formatAttr('src', srcRaw);
        const posterAttr = formatAttr('poster', posterRaw);
        const boolAttrs: string[] = [];
        if (autoPlay === true || autoPlay === 'true') boolAttrs.push('autoPlay');
        if (loop === true || loop === 'true') boolAttrs.push('loop');
        if (muted === true || muted === 'true') boolAttrs.push('muted');
        if (playsInline === true || playsInline === 'true') boolAttrs.push('playsInline');
        if (controls === true || controls === 'true') boolAttrs.push('controls');

        if (node.properties.link !== undefined && node.properties.link !== null && node.properties.link !== '') result.links.push(id);
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const videoStyles = { objectFit: 'cover', ...styles };
        return `<video data-id="${targetId}"${label}${srcAttr}${posterAttr}${boolAttrs.map(a => ` ${a}`).join('')} style={${sourceStyleLiteral(videoStyles)}} />`;
      }
      const label = escapeJsxText(`Заглушка · ${name}`).replace(/"/g, '&quot;');
      return `<div data-id="${targetId}" data-name="${label}" style={${sourceStyleLiteral({ backgroundColor: '#eeeeee', ...styles })}}></div>`;
    }
    let tag = 'div', content = '', attributes = '';
    if (node.kind === 'RichTextNode') {
      const text = mapSourceText(node, context, targetId);
      if (text.blockIds?.length) result.optionIds.push(...text.blockIds);
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
    } else if (node.kind === 'OverlayNode') {
      content = node.children.map(child => emit(child, node)).join('\n');
    } else if (node.kind === 'FrameNode') {
      if (node.properties.isFormContainer === true) {
        if (!context.supportedForms || (node.properties.htmlTag != null && node.properties.htmlTag !== 'form') || Object.entries(node.properties).some(([key, value]) => key.startsWith('form') && value !== undefined && value !== false && !formContainerKeys.has(key))) {
          throw new Error(`Form container ${id} requires its native form adapter`);
        }
        tag = 'form';
        attributes = ` data-form='${serializeFormConfig({ sendTo: [] })}'`;
        result.forms.push(id);
      } else if (node.properties.htmlTag != null) {
        if (typeof node.properties.htmlTag !== 'string' || !frameTags.has(node.properties.htmlTag)) throw new Error(`Frame tag ${String(node.properties.htmlTag)} on ${id} requires its native adapter`);
        tag = node.properties.htmlTag;
      }
      content = node.children.map(child => emit(child, node)).join('\n');
    } else if (node.kind === 'FormPlainTextInputNode') {
      if (!context.supportedForms || node.children.length) throw new Error(`Form input ${id} requires its native form adapter`);
      const inputType = node.properties.formTextInputType;
      if (typeof inputType !== 'string' || !formTextInputTypes.has(inputType)) throw new Error(`Form input type ${String(inputType)} on ${id} requires its native form adapter`);
      const name = node.properties.formInputName;
      if (typeof name !== 'string' || !name.trim()) throw new Error(`Form input ${id} requires a non-empty name`);
      if (node.properties.formInputValue !== undefined && typeof node.properties.formInputValue !== 'string') throw new Error(`Form input value on ${id} requires its native form adapter`);
      if (node.properties.formInputPlaceholder !== undefined && typeof node.properties.formInputPlaceholder !== 'string') throw new Error(`Form input placeholder on ${id} requires its native form adapter`);
      if (node.properties.formInputRequired !== undefined && typeof node.properties.formInputRequired !== 'boolean') throw new Error(`Form input required flag on ${id} requires its native form adapter`);
      tag = inputType === 'textarea' ? 'textarea' : 'input';
      const attrs: string[] = [];
      if (tag === 'input') attrs.push(`type=${JSON.stringify(inputType)}`);
      attrs.push(`name=${JSON.stringify(name)}`);
      if (typeof node.properties.formInputPlaceholder === 'string' && node.properties.formInputPlaceholder !== '') attrs.push(`placeholder=${JSON.stringify(node.properties.formInputPlaceholder)}`);
      if (node.properties.formInputRequired === true) attrs.push('required="true"');
      if (typeof node.properties.formInputValue === 'string' && node.properties.formInputValue !== '') attrs.push(`defaultValue=${JSON.stringify(node.properties.formInputValue)}`);
      attributes = ` ${attrs.join(' ')}`;
      result.formControls.push(id);
    } else if (node.kind === 'FormSelectNode') {
      if (!context.supportedForms || node.children.length) throw new Error(`Form select ${id} requires its native form adapter`);
      const name = node.properties.formInputName;
      if (typeof name !== 'string' || !name.trim()) throw new Error(`Form select ${id} requires a non-empty name`);
      if (node.properties.formInputRequired !== undefined && typeof node.properties.formInputRequired !== 'boolean') throw new Error(`Form select required flag on ${id} requires its native form adapter`);
      if (node.properties.formInputValue !== undefined && typeof node.properties.formInputValue !== 'string') throw new Error(`Form select value on ${id} requires its native form adapter`);
      const rawOptions = node.properties.formSelectOptions;
      if (!Array.isArray(rawOptions) || !rawOptions.length) throw new Error(`Form select ${id} requires options`);
      const selectedValue = typeof node.properties.formInputValue === 'string' ? node.properties.formInputValue : '';
      let matchedSelection = selectedValue === '';
      const optionItems = rawOptions.map((rawOption, index) => {
        const option = sourceRecord(rawOption);
        if (option?.type !== 'option' || typeof option.id !== 'string' || typeof option.title !== 'string' || typeof option.value !== 'string' || (option.disabled !== undefined && typeof option.disabled !== 'boolean')) {
          throw new Error(`Form select option on ${id} requires its native form adapter`);
        }
        const selected = selectedValue !== '' && (option.id === selectedValue || option.value === selectedValue);
        if (selected) matchedSelection = true;
        const optionId = `${targetId}-option-${index + 1}`;
        result.optionIds.push(optionId);
        const optAttrs = [`value=${JSON.stringify(option.value)}`];
        if (option.disabled === true) optAttrs.push('disabled="true"');
        if (selected) optAttrs.push('selected="true"');
        return `<option data-id="${optionId}" ${optAttrs.join(' ')}>${escapeJsxText(option.title)}</option>`;
      });
      if (!matchedSelection) throw new Error(`Form select default value ${selectedValue} on ${id} is missing from options`);
      tag = 'select';
      const attrs = [`name=${JSON.stringify(name)}`];
      if (node.properties.formInputRequired === true) attrs.push('required="true"');
      attributes = ` ${attrs.join(' ')}`;
      content = optionItems.join('');
      result.formControls.push(id);
    }
    else throw new Error(`Unsupported source child ${node.kind} on ${id}`);
    if (node.properties.link !== undefined && node.properties.link !== null && node.properties.link !== '') result.links.push(id);
    const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
    return `<${tag} data-id="${targetId}"${label}${attributes} style={${sourceStyleLiteral(styles)}}>${content}</${tag}>`;
  };
  result.jsx = emit(rootId);
  return result;
}
