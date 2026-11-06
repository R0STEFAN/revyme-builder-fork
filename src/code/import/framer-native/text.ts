import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { parseStyleString, toCamel } from '../../../shared/css-utils';
import { trace } from '../../../shared/debug-trace';
import { escapeJsxText } from '../../parsing/rich-text-runs';
import { resolveSourceNode, sourceRecord } from './source-graph';
import { mappingDiagnostic, sourceStyleValue, type SourceMappingContext } from './styles';
import type { ResolvedSourceNode, SourceGraph, SourceProperties } from './types';
import { parseSourceGoogleFont } from './fonts';
import type { TextAnimConfig } from '../../../editor/tools/AnimationTool/motion/text-anim-presets';

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
  blockIds?: string[];
  textAnim?: TextAnimConfig;
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
export const sourceTypographySuffixes: Record<string, string> = { fontFamily: 'font', fontWeight: 'weight', color: 'color', textTransform: 'transform', textDecoration: 'decoration', textShadow: 'shadow', fontSize: 'size', letterSpacing: 'spacing', lineHeight: 'line-height', WebkitTextStrokeWidth: 'stroke-width', WebkitTextStrokeColor: 'stroke-color' };

export function nativeTypographyGroup(graph: SourceGraph, identity: Record<string, string>, sourceId: string): string {
  const master = sourceRecord(graph.nodes.get(sourceId)?.raw.replicaInfo)?.master;
  const id = typeof master === 'string' ? master : sourceId;
  const source = graph.nodes.get(id);
  const slug = String(source?.raw.name ?? 'text').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'text';
  const ident = String(identity[id] ?? '').replace(/^framer-/, '');
  if (!ident || ident === slug) return `framer-${slug}`;
  if (ident.startsWith(`${slug}-`)) return `framer-${ident}`;
  return `framer-${slug}-${ident}`;
}

function normalizeSourceLineHeight(styles: Record<string, string>): void {
  if (styles.lineHeight?.endsWith('em')) styles.lineHeight = styles.lineHeight.slice(0, -2);
  else if (styles.lineHeight?.endsWith('%')) styles.lineHeight = String(parseFloat(styles.lineHeight) / 100);
  else if (styles.lineHeight?.endsWith('px') && styles.fontSize?.endsWith('px') && parseFloat(styles.fontSize) > 0) styles.lineHeight = String(parseFloat(styles.lineHeight) / parseFloat(styles.fontSize));
}

export function mapSourceTypography(p: SourceProperties): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [source, target] of Object.entries({ fontSize: 'fontSize', textColor: 'color', textAlignment: 'textAlign', textTransform: 'textTransform', textDecoration: 'textDecoration' })) {
    if (typeof p[source] === 'string') out[target] = p[source] as string;
  }
  for (const key of ['lineHeight', 'letterSpacing']) {
    const value = p[key];
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'string') out[key] = `${value[0]}${value[1]}`;
  }
  normalizeSourceLineHeight(out);
  const font = typeof p.font === 'string' ? parseSourceGoogleFont(p.font) : undefined;
  if (font) {
    out.fontFamily = JSON.stringify(font.family);
    out.fontWeight = String(font.axes.wght);
    if (font.axes.ital === 1) out.fontStyle = 'italic';
    const extraAxes = Object.entries(font.axes).filter(([axis]) => axis !== 'wght' && axis !== 'ital');
    if (extraAxes.length) out.fontVariationSettings = extraAxes.map(([axis, value]) => `"${axis}" ${value}`).join(', ');
  }
  if (Array.isArray(p.openTypeFontFeatures) && p.openTypeFontFeatures.every(feature => typeof feature === 'string' && /^[a-zA-Z0-9]{4}$/.test(feature))) out.fontFeatureSettings = p.openTypeFontFeatures.map(feature => `"${feature}"`).join(', ');
  return out;
}

export function mapSourceTextEffect(p: SourceProperties): TextAnimConfig | undefined {
  if (p.textEffectEnabled !== true) return undefined;
  const tokenization = String(p.textEffectTokenization ?? 'word');
  const animationType: TextAnimConfig['animationType'] =
    tokenization === 'character' ? 'character' :
    tokenization === 'line' ? 'line' : 'word';
  const triggerStr = String(p.textEffectTrigger ?? 'onInView');
  const trigger: TextAnimConfig['trigger'] =
    triggerStr === 'onMount' ? 'appear' :
    triggerStr === 'onScroll' ? 'scroll' : 'view';

  const config: TextAnimConfig = { animationType, trigger };
  if (typeof p.textEffectOpacity === 'number') config.opacity = p.textEffectOpacity;
  if (typeof p.textEffectScale === 'number' && p.textEffectScale !== 1) config.scale = p.textEffectScale;
  if (typeof p.textEffectBlur === 'number' && p.textEffectBlur > 0) config.blur = p.textEffectBlur;
  if (typeof p.textEffectRotate === 'number' && p.textEffectRotate !== 0) config.rotateZ = p.textEffectRotate;
  if (typeof p.textEffectRotateX === 'number' && p.textEffectRotateX !== 0) config.rotateX = p.textEffectRotateX;
  if (typeof p.textEffectRotateY === 'number' && p.textEffectRotateY !== 0) config.rotateY = p.textEffectRotateY;
  if (typeof p.textEffectSkewX === 'number' && p.textEffectSkewX !== 0) config.skewX = p.textEffectSkewX;
  if (typeof p.textEffectSkewY === 'number' && p.textEffectSkewY !== 0) config.skewY = p.textEffectSkewY;
  if (typeof p.textEffectX === 'number' && p.textEffectX !== 0) config.x = p.textEffectX;
  if (typeof p.textEffectY === 'number' && p.textEffectY !== 0) config.y = p.textEffectY;
  if (typeof p.textEffectDelay === 'number' && p.textEffectDelay > 0) config.delay = p.textEffectDelay;
  if (p.textEffectReplay === true) config.replay = true;
  if (p.textEffectType === 'appear' && (typeof p.textEffectY === 'number' && p.textEffectY !== 0)) {
    config.mask = true;
  }
  const trans = sourceRecord(p.textEffectTransition);
  if (trans) {
    config.transition = {};
    if (trans.type === 'spring' || trans.type === 'tween') config.transition.type = trans.type;
    if (typeof trans.duration === 'number') config.transition.duration = trans.duration;
    if (typeof trans.delay === 'number') config.transition.delay = trans.delay;
    if (typeof trans.stiffness === 'number') config.transition.stiffness = trans.stiffness;
    if (typeof trans.damping === 'number') config.transition.damping = trans.damping;
    if (typeof trans.mass === 'number') config.transition.mass = trans.mass;
    if (Array.isArray(trans.ease) && trans.ease.length === 4) config.transition.ease = trans.ease as number[];
    else if (typeof trans.ease === 'string') config.transition.ease = trans.ease;
  }
  return config;
}

export function mapSourceText(node: ResolvedSourceNode, context: SourceMappingContext, targetId?: string): NativeText {
  trace.fn('framer-native.mapSourceText', { sourceId: node.sourceId });
  const fragment = parseFragment(typeof node.properties.html === 'string' ? node.properties.html : '');
  const blocks = fragment.childNodes.filter(child => child.nodeName !== '#comment');
  const single = blocks.length === 1 && 'tagName' in blocks[0] ? blocks[0] : undefined;
  const output: NativeText = { tag: single && tags.has(single.tagName) ? single.tagName : 'div', plainText: '', jsx: '', runs: [], styles: {}, attributes: {}, textAnim: mapSourceTextEffect(node.properties) };
  const attributeStyle = (element: DefaultTreeAdapterTypes.Element) => {
    const attrs = Object.fromEntries(element.attrs.map(attr => [attr.name, attr.value]));
    let styles: Record<string, string> = {};
    let presetStyles: Record<string, string> = {};
    if (attrs['data-styles-preset'] && context.graph) {
      if (context.graph.nodes.has(attrs['data-styles-preset'])) {
        presetStyles = mapSourceTypography(resolveSourceNode(context.graph, attrs['data-styles-preset']).properties);
        styles = { ...presetStyles };
      }
      else mappingDiagnostic(context, node, 'data-styles-preset', 'SOURCE_TYPOGRAPHY_MISSING');
    }
    const declarations = parseStyleString(attrs.style ?? '');
    for (const [key, value] of Object.entries(declarations)) {
      if (key === '--font-selector') {
        if (!styles.fontFamily && !declarations['--framer-font-family'] && !declarations['font-family']) mappingDiagnostic(context, node, key, 'SOURCE_FONT_ADAPTER_REQUIRED');
        continue;
      }
      const target = key.startsWith('--framer-') ? cssNames[key.slice(9)] : toCamel(key);
      if (target && !target.startsWith('-')) {
        const mapped = sourceStyleValue(value, node, context, key);
        if (mapped !== undefined) styles[target] = mapped;
      } else mappingDiagnostic(context, node, key, 'SOURCE_TEXT_STYLE_UNSUPPORTED');
    }
    normalizeSourceLineHeight(styles);
    const vb = sourceRecord(node.properties.textFitViewBoxSize);
    if (vb && typeof vb.width === 'number' && vb.width > 0) {
      const maxFs = parseFloat(styles.fontSize) || (typeof vb.height === 'number' && vb.height > 0 ? vb.height : 48);
      styles.fontSize = `${maxFs}px`;
      styles.width = '100%';
      styles.maxWidth = '100%';
    }
    if (context.graph && context.typographyIdentity && attrs['data-styles-preset']) {
      const sourceId = attrs['data-styles-preset'];
      const group = nativeTypographyGroup(context.graph, context.typographyIdentity, sourceId);
      const masterId = sourceRecord(context.graph.nodes.get(sourceId)?.raw.replicaInfo)?.master;
      const masterStyles = typeof masterId === 'string' && context.graph.nodes.has(masterId) ? mapSourceTypography(resolveSourceNode(context.graph, masterId).properties) : presetStyles;
      for (const [property, suffix] of Object.entries(sourceTypographySuffixes)) if (masterStyles[property] !== undefined && styles[property] === masterStyles[property]) styles[property] = `var(--typo-${group}-${suffix})`;
    }
    return { attrs, styles };
  };
  const visit = (child: DefaultTreeAdapterTypes.ChildNode, parentTag: string, blockId?: string): { jsx: string; text: string; inner?: string; attributes?: Record<string, string> } => {
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
    const attributes: string[] = [];
    if (blockId && child.tagName !== 'br') {
      output.blockIds = [...(output.blockIds ?? []), blockId];
      attributes.push(`data-id="${escapeJsxText(blockId).replace(/"/g, '&quot;')}"`);
    }
    for (const [key, value] of Object.entries(safeAttributes)) attributes.push(`${key}="${escapeJsxText(value).replace(/"/g, '&quot;')}"`);
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
    const parts = blocks.map((child, index) => visit(child, 'div', targetId ? `${targetId}-block-${index + 1}` : undefined));
    output.jsx = parts.map(part => part.jsx).join('');
    output.plainText = parts.map(part => part.text).join('\n');
  }
  const binding = sourceRecord(node.properties.textContent);
  if (binding) output.binding = binding;
  return output;
}
