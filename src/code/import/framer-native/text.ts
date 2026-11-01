import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { parseStyleString, toCamel } from '../../../shared/css-utils';
import { trace } from '../../../shared/debug-trace';
import { escapeJsxText } from '../../parsing/rich-text-runs';
import { resolveSourceNode, sourceRecord } from './source-graph';
import { mappingDiagnostic, sourceStyleValue, type SourceMappingContext } from './styles';
import type { ResolvedSourceNode, SourceProperties } from './types';

export interface NativeText {
  plainText: string;
  tag: string;
  /** Inner JSX of tag, never an executable source expression. */
  jsx: string;
  runs: { text: string; tag: string }[];
  styles: Record<string, string>;
  attributes: Record<string, string>;
  presetId?: string;
  binding?: SourceProperties;
}
const tags = new Set(['p', 'div', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'a', 'br', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li']);
const cssNames: Record<string, string> = {
  'font-family': 'fontFamily', 'font-size': 'fontSize', 'font-weight': 'fontWeight',
  'font-style': 'fontStyle', 'text-color': 'color', 'text-alignment': 'textAlign',
  'letter-spacing': 'letterSpacing', 'line-height': 'lineHeight', 'text-transform': 'textTransform',
  'text-decoration': 'textDecoration', 'text-stroke-color': 'WebkitTextStrokeColor',
  'text-stroke-width': 'WebkitTextStrokeWidth',
  'text-decoration-thickness': 'textDecorationThickness', 'font-open-type-features': 'fontFeatureSettings',
};

export function mapSourceTypography(p: SourceProperties): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [source, target] of Object.entries({ fontSize: 'fontSize', textColor: 'color', textAlignment: 'textAlign', textTransform: 'textTransform', textDecoration: 'textDecoration' })) {
    if (typeof p[source] === 'string') out[target] = p[source] as string;
  }
  for (const key of ['lineHeight', 'letterSpacing']) {
    const value = p[key];
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'string') out[key] = `${value[0]}${value[1]}`;
  }
  // The captured Google-font descriptor includes its explicit variation axes.
  if (typeof p.font === 'string' && p.font.startsWith('GF;') && p.font.includes('-variable-')) {
    out.fontFamily = JSON.stringify(p.font.slice(3).split('-variable-')[0]);
    const encoded = p.font.split('VF=')[1];
    if (encoded) {
      try {
        const axes = atob(encoded);
        if (/^"[a-zA-Z0-9]{4}" [-\d.]+(?:, "[a-zA-Z0-9]{4}" [-\d.]+)*$/.test(axes)) {
          out.fontVariationSettings = axes;
          const weight = /"wght" ([-\d.]+)/.exec(axes);
          if (weight) out.fontWeight = weight[1];
        }
      } catch { /* Invalid font data is diagnosed by the font asset emitter. */ }
    }
  }
  if (Array.isArray(p.openTypeFontFeatures) && p.openTypeFontFeatures.every(feature => typeof feature === 'string' && /^[a-zA-Z0-9]{4}$/.test(feature))) out.fontFeatureSettings = p.openTypeFontFeatures.map(feature => `"${feature}"`).join(', ');
  return out;
}

export function mapSourceText(node: ResolvedSourceNode, context: SourceMappingContext): NativeText {
  trace.fn('framer-native.mapSourceText', { sourceId: node.sourceId });
  const fragment = parseFragment(typeof node.properties.html === 'string' ? node.properties.html : '');
  const blocks = fragment.childNodes.filter(child => child.nodeName !== '#comment');
  const single = blocks.length === 1 && 'tagName' in blocks[0] ? blocks[0] : undefined;
  const output: NativeText = { tag: single && tags.has(single.tagName) ? single.tagName : 'div', plainText: '', jsx: '', runs: [], styles: {}, attributes: {} };
  const attributeStyle = (element: DefaultTreeAdapterTypes.Element) => {
    const attrs = Object.fromEntries(element.attrs.map(attr => [attr.name, attr.value]));
    let styles: Record<string, string> = {};
    if (attrs['data-styles-preset'] && context.graph?.nodes.has(attrs['data-styles-preset'])) styles = mapSourceTypography(resolveSourceNode(context.graph, attrs['data-styles-preset']).properties);
    for (const [key, value] of Object.entries(parseStyleString(attrs.style ?? ''))) {
      const target = key.startsWith('--framer-') ? cssNames[key.slice(9)] : toCamel(key);
      if (target) {
        const mapped = sourceStyleValue(value, node, context, key);
        if (mapped !== undefined) styles[target] = mapped;
      } else mappingDiagnostic(context, node, key, 'SOURCE_TEXT_STYLE_UNSUPPORTED');
    }
    return { attrs, styles };
  };
  const visit = (child: DefaultTreeAdapterTypes.ChildNode, parentTag: string): { jsx: string; text: string; inner?: string; attributes?: Record<string, string> } => {
    if (child.nodeName === '#text' && 'value' in child) {
      output.runs.push({ text: child.value, tag: parentTag });
      return { jsx: escapeJsxText(child.value), text: child.value };
    }
    if (!('tagName' in child)) return { jsx: '', text: '' };
    if (!tags.has(child.tagName)) {
      mappingDiagnostic(context, node, child.tagName, 'SOURCE_TEXT_TAG_UNSUPPORTED');
      return { jsx: '', text: '' };
    }
    const { attrs, styles } = attributeStyle(child);
    const rendered = child.childNodes.map(part => visit(part, child.tagName));
    const safeAttributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (['style', 'class', 'data-styles-preset'].includes(key)) continue;
      if (key === 'href') {
        if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value) && !value.startsWith('//')) safeAttributes.href = value;
        else mappingDiagnostic(context, node, 'href', 'SOURCE_TEXT_LINK_UNSUPPORTED');
      } else if (['target', 'rel', 'dir', 'title'].includes(key)) safeAttributes[key] = value;
      else mappingDiagnostic(context, node, key, 'SOURCE_TEXT_ATTRIBUTE_UNSUPPORTED');
    }
    const attributes = Object.entries(safeAttributes).map(([key, value]) => `${key}="${escapeJsxText(value).replace(/"/g, '&quot;')}"`);
    if (Object.keys(styles).length) attributes.push(`style={${JSON.stringify(styles)}}`);
    const opening = `<${child.tagName}${attributes.length ? ` ${attributes.join(' ')}` : ''}`;
    return child.tagName === 'br'
      ? { jsx: `${opening} />`, text: '\n' }
      : { jsx: `${opening}>${rendered.map(part => part.jsx).join('')}</${child.tagName}>`, inner: rendered.map(part => part.jsx).join(''), text: rendered.map(part => part.text).join(''), attributes: safeAttributes };
  };
  if (single && tags.has(single.tagName)) {
    const { attrs, styles } = attributeStyle(single);
    output.styles = styles; output.presetId = attrs['data-styles-preset'];
    // Visit the outer element too, so rejected attributes cannot hide there.
    const whole = visit(single, single.tagName);
    output.jsx = whole.inner ?? '';
    output.attributes = whole.attributes ?? {};
    output.plainText = whole.text;
  } else {
    const parts = blocks.map(child => visit(child, 'div'));
    output.jsx = parts.map(part => part.jsx).join('');
    output.plainText = parts.map(part => part.text).join('\n');
  }
  const binding = sourceRecord(node.properties.textContent);
  if (binding) output.binding = binding;
  return output;
}
