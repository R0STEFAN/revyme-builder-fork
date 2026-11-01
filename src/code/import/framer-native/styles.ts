import { normalizeTransparent } from '../../../shared/css-utils';
import { trace } from '../../../shared/debug-trace';
import { sourceRecord } from './source-graph';
import type { ResolvedSourceNode, SourceGraph, TransferDiagnostic } from './types';

export interface SourceMappingContext {
  diagnostics: TransferDiagnostic[];
  graph?: SourceGraph;
  parent?: ResolvedSourceNode;
  viewport?: { width: number; height?: number };
  /** Values may be canonical whole-value `{prop}` expressions. */
  variables?: Record<string, string | number | boolean>;
  assets?: Record<string, string>;
}

export function mappingDiagnostic(context: SourceMappingContext, node: ResolvedSourceNode, property: string, code = 'SOURCE_STYLE_UNSUPPORTED'): void {
  if (!context.diagnostics.some(d => d.code === code && d.sourceId === node.sourceId && d.property === property)) {
    context.diagnostics.push({ code, sourceId: node.sourceId, property, message: `Cannot map source ${property} on ${node.sourceId}.` });
  }
}

export function sourceStyleValue(value: unknown, node: ResolvedSourceNode, context: SourceMappingContext, property: string): string | undefined {
  if (typeof value === 'string') {
    // Framer embeds variable references in rich text CSS as well as objects.
    if (value.includes('--variable-reference-')) {
      for (const [key, replacement] of Object.entries(context.variables ?? {})) {
        const separator = key.indexOf(':');
        const provider = key.slice(0, separator), id = key.slice(separator + 1);
        if (value === `var(--variable-reference-${id}-${provider})`) return String(replacement);
      }
      mappingDiagnostic(context, node, property, 'SOURCE_VALUE_UNRESOLVED');
      return;
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') return String(value);
  const reference = sourceRecord(value);
  if (reference?.type === 'variableReference') {
    const key = `${reference.providerId}:${reference.id}`;
    if (Object.prototype.hasOwnProperty.call(context.variables ?? {}, key)) return String(context.variables![key]);
  }
  if (value !== null && value !== undefined) mappingDiagnostic(context, node, property, 'SOURCE_VALUE_UNRESOLVED');
}

const px = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${value}px` : typeof value === 'string' ? value : undefined;
const alignment = (value: unknown) => value === 'start' ? 'flex-start' : value === 'end' ? 'flex-end' : typeof value === 'string' ? value : undefined;

export function mapSourceStyles(node: ResolvedSourceNode, context: SourceMappingContext): Record<string, string> {
  trace.fn('framer-native.mapSourceStyles', { sourceId: node.sourceId });
  const p = node.properties;
  const result: Record<string, string> = { boxSizing: 'border-box', position: 'relative', display: 'block' };
  const set = (key: string, value: string | undefined) => { if (value !== undefined) result[key] = value; };
  const value = (key: string) => sourceStyleValue(p[key], node, context, key);
  const parent = context.parent?.properties;
  if (p.layout === 'stack') {
    result.display = 'flex';
    result.flexDirection = p.stackDirection === 'horizontal' ? 'row' : 'column';
    set('alignItems', alignment(p.stackAlignment));
    set('justifyContent', alignment(p.stackDistribution));
    result.flexWrap = p.stackWrapEnabled === true ? 'wrap' : 'nowrap';
  } else if (p.layout === 'grid') {
    result.display = 'grid';
    if (typeof p.gridColumnCount === 'number') result.gridTemplateColumns = `repeat(${p.gridColumnCount}, minmax(0, 1fr))`;
    else if (p.gridColumnCount === 'auto-fill' && px(p.gridColumnMinWidth)) result.gridTemplateColumns = `repeat(auto-fill, minmax(${px(p.gridColumnMinWidth)}, 1fr))`;
    else mappingDiagnostic(context, node, 'gridColumnCount');
    if (p.gridRowHeightType === 'fit') result.gridAutoRows = 'min-content';
    else if (p.gridRowHeightType === 'auto') result.gridAutoRows = 'auto';
    else if (p.gridRowHeightType === 'fixed') set('gridAutoRows', px(p.gridRowHeight));
    else if (p.gridRowHeightType === 'fraction') result.gridAutoRows = '1fr';
    else if (p.gridRowHeightType !== undefined) mappingDiagnostic(context, node, 'gridRowHeightType');
  } else if (p.layout != null) mappingDiagnostic(context, node, 'layout');
  if (p.layout === 'stack' || p.layout === 'grid') set('gap', px(p.gap));

  const outOfFlow = p.position === 'absolute' || p.position === 'fixed';
  if (outOfFlow || p.position === 'sticky') {
    result.position = String(p.position);
    for (const key of ['left', 'right', 'top', 'bottom']) if (p[key] !== null) set(key, px(p[key]));
  }
  for (const axis of ['width', 'height'] as const) {
    const type = p[`${axis}Type`], size = p[axis];
    const main = parent?.layout === 'stack' && (axis === 'width' ? parent.stackDirection === 'horizontal' : parent.stackDirection !== 'horizontal');
    if (type === 0) set(axis, px(size));
    else if (type === 1 && typeof size === 'number') result[axis] = `${size * 100}%`;
    else if (type === 2) result[axis] = 'min-content';
    else if (type === 3 && typeof size === 'number') {
      if (main && !outOfFlow) {
        result.flexGrow = String(size); result.flexShrink = '1'; result.flexBasis = '0px';
        result[axis === 'width' ? 'minWidth' : 'minHeight'] = '0px';
      } else result[axis] = `${size * 100}%`;
    } else if (type === 4 && typeof size === 'number') result[axis] = `${size * 100}${axis === 'width' ? 'vw' : 'vh'}`;
    else if (type === 5) {
      const ratio = typeof p.fillImagePixelWidth === 'number' && typeof p.fillImagePixelHeight === 'number' && p.fillImagePixelHeight > 0 ? p.fillImagePixelWidth / p.fillImagePixelHeight : p.aspectRatio;
      if (typeof ratio === 'number' && ratio > 0) { result.aspectRatio = String(ratio); result[axis] = 'auto'; }
      else mappingDiagnostic(context, node, `${axis}Type`);
    } else if (type !== undefined) mappingDiagnostic(context, node, `${axis}Type`);
  }
  if (!outOfFlow && parent?.layout === 'stack' && !result.flexGrow) result.flexShrink = '0';
  if (parent?.layout === 'grid') {
    if (typeof p.gridItemColumnSpan === 'number') result.gridColumn = `span ${p.gridItemColumnSpan}`;
    if (typeof p.gridItemRowSpan === 'number') result.gridRow = `span ${p.gridItemRowSpan}`;
    if (p.gridItemHorizontalAlignment) set('justifySelf', String(p.gridItemHorizontalAlignment));
    if (p.gridItemVerticalAlignment) set('alignSelf', String(p.gridItemVerticalAlignment));
  }
  for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) if (p[key] != null) set(key, px(p[key]));
  if (typeof p.aspectRatio === 'number' && p.aspectRatio > 0) result.aspectRatio = String(p.aspectRatio);
  if (p.paddingPerSide) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) set(`padding${side}`, px(p[`padding${side}`]));
  } else set('padding', px(p.padding));
  if (p.radiusPerCorner) {
    for (const corner of ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']) set(`border${corner}Radius`, px(p[`radius${corner}`]));
  } else if (p.radius != null || p.radiusTopLeft != null) {
    const radius = p.radius ?? p.radiusTopLeft;
    set('borderRadius', p.radiusIsRelative && typeof radius === 'number' ? `${radius * 100}%` : px(radius));
  }
  if (p.fillEnabled === true) {
    if (p.fillType === 'color') set('backgroundColor', value('fillColor'));
    else if (p.fillType === 'image') {
      const image = value('fillImage');
      const url = image && context.assets?.[image];
      if (url) {
        result.backgroundImage = `url(${JSON.stringify(url)})`;
        result.backgroundPosition = 'center'; result.backgroundRepeat = 'no-repeat';
        result.backgroundSize = p.fillImageResize === 'fit' ? 'contain' : 'cover';
      } else mappingDiagnostic(context, node, 'fillImage', 'SOURCE_ASSET_UNRESOLVED');
    } else if (['linear-gradient', 'radial-gradient', 'conic-gradient'].includes(String(p.fillType))) {
      const property = p.fillType === 'linear-gradient' ? 'fillLinearGradient' : p.fillType === 'radial-gradient' ? 'fillRadialGradient' : 'fillConicGradient';
      const gradient = sourceRecord(p[property]);
      if (gradient && Array.isArray(gradient.stops) && (gradient.alpha === undefined || gradient.alpha === 1)) {
        const stops = gradient.stops.map(stop => {
          const s = sourceRecord(stop);
          const color = s && sourceStyleValue(s.value, node, context, property);
          return color && typeof s?.position === 'number' ? `${color} ${s.position * 100}%` : undefined;
        });
        const x = typeof gradient.centerAnchorX === 'number' ? gradient.centerAnchorX * 100 : 50;
        const y = typeof gradient.centerAnchorY === 'number' ? gradient.centerAnchorY * 100 : 50;
        if (stops.every(Boolean)) {
          if (p.fillType === 'linear-gradient' && typeof gradient.angle === 'number') result.backgroundImage = `linear-gradient(${gradient.angle}deg, ${stops.join(', ')})`;
          else if (p.fillType === 'conic-gradient' && typeof gradient.angle === 'number') result.backgroundImage = `conic-gradient(from ${gradient.angle}deg at ${x}% ${y}%, ${stops.join(', ')})`;
          else if (p.fillType === 'radial-gradient' && typeof gradient.widthFactor === 'number' && typeof gradient.heightFactor === 'number') result.backgroundImage = `radial-gradient(ellipse ${gradient.widthFactor * 100}% ${gradient.heightFactor * 100}% at ${x}% ${y}%, ${stops.join(', ')})`;
          else mappingDiagnostic(context, node, property);
        } else mappingDiagnostic(context, node, property);
      } else mappingDiagnostic(context, node, property);
    } else mappingDiagnostic(context, node, 'fillType');
  }
  if (p.borderEnabled === true) {
    const color = value('borderColor');
    if (color) {
      if (p.borderPerSide) {
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) set(`border${side}`, `${px(p[`border${side}`]) ?? '0px'} ${p.borderStyle ?? 'solid'} ${color}`);
      } else result.border = `${px(p.borderWidth) ?? '0px'} ${p.borderStyle ?? 'solid'} ${color}`;
    }
  }
  if (p.overflow) result.overflow = p.overflow === 'clip' ? 'clip' : String(p.overflow);
  for (const key of ['opacity', 'zIndex']) if (p[key] !== undefined) set(key, value(key));
  if (p.blendingMode) result.mixBlendMode = String(p.blendingMode);
  if (p.rotation) result.transform = `rotate(${p.rotation}deg)`;
  if (p.visible === false) result.display = 'none';
  else if (p.visible !== undefined && p.visible !== true) {
    const visible = value('visible');
    if (visible !== 'true') mappingDiagnostic(context, node, 'visible', 'SOURCE_VISIBILITY_BINDING_REQUIRED');
  }
  return normalizeTransparent(result);
}
