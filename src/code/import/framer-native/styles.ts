import { normalizeTransparent } from '../../../shared/css-utils';
import { trace } from '../../../shared/debug-trace';
import { simulatedVpHeight } from '../../../shared/responsive-units';
import { sourceRecord } from './source-graph';
import { sourceFlowEffect, sourceRotationLoop, sourceMountEffects } from './effects';
import { parseSourceGoogleFont } from './fonts';
import type { ResolvedSourceNode, SourceGraph, TransferDiagnostic } from './types';

export interface SourceMappingContext {
  diagnostics: TransferDiagnostic[];
  graph?: SourceGraph;
  typographyIdentity?: Record<string, string>;
  parent?: ResolvedSourceNode;
  viewport?: { width: number; height?: number };
  /** Values may be canonical whole-value `{prop}` expressions. */
  variables?: Record<string, string | number | boolean>;
  assets?: Record<string, string>;
  /** The page adapter binds this image field after emitting the editable JSX tree. */
  cmsImageField?: (value: unknown, node: ResolvedSourceNode) => boolean;
  supportedLoops?: boolean;
  supportedMountEffects?: boolean;
  supportedFlowEffects?: boolean;
  supportedForms?: boolean;
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
  const mount = context.supportedMountEffects && sourceMountEffects(p);
  // These are active source behaviors, not decorative metadata; never drop them.
  for (const key of ['enterEffectEnabled', 'exitEffectEnabled', 'appearEffectEnabled', 'loopEffectEnabled', 'styleAppearEffectEnabled', 'flowEffectEnabled', 'isFormContainer']) {
    if (p[key] === true && !(key === 'loopEffectEnabled' && context.supportedLoops && sourceRotationLoop(p)) && !(mount && ['enterEffectEnabled', 'exitEffectEnabled', 'styleAppearEffectEnabled'].includes(key)) && !(key === 'flowEffectEnabled' && context.supportedFlowEffects && sourceFlowEffect(p)) && !(key === 'isFormContainer' && context.supportedForms && node.kind === 'FrameNode')) mappingDiagnostic(context, node, key, 'SOURCE_BEHAVIOR_ADAPTER_REQUIRED');
  }
  for (const key of ['boxShadows', 'pageEffects']) {
    if (Array.isArray(p[key]) && p[key].length) mappingDiagnostic(context, node, key, 'SOURCE_BEHAVIOR_ADAPTER_REQUIRED');
  }
  if (p.customCursorType === 'component' && p.customCursorSmartComponentId) mappingDiagnostic(context, node, 'customCursorSmartComponentId', 'SOURCE_BEHAVIOR_ADAPTER_REQUIRED');
  const result: Record<string, string> = { boxSizing: 'border-box', position: 'relative', display: 'block' };
  if (Array.isArray(p.masks) && p.masks.length) {
    const mask = p.masks.length === 1 ? sourceRecord(p.masks[0]) : undefined;
    const url = typeof mask?.maskImage === 'string' ? context.assets?.[mask.maskImage] : undefined;
    const maskKeys = new Set(['id', 'maskType', 'maskImage', 'maskImageResize', 'maskMode', 'maskPosition', 'maskRepeat', 'maskComposite', 'maskConicGradient', 'maskLinearGradient', 'maskRadialGradient']);
    if (mask?.maskType === 'image' && Object.keys(mask).every(key => maskKeys.has(key)) && mask.maskMode === 'alpha' && mask.maskImageResize === 'cover' && mask.maskPosition === 'center' && mask.maskRepeat === 'no-repeat' && mask.maskComposite === 'add' && url) {
      result.maskImage = result.WebkitMaskImage = `url(${JSON.stringify(url)})`;
      result.maskSize = 'cover'; result.maskPosition = 'center'; result.maskRepeat = 'no-repeat';
    } else mappingDiagnostic(context, node, 'masks', 'SOURCE_BEHAVIOR_ADAPTER_REQUIRED');
  }
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
    if (outOfFlow && p.left == null && p.right == null && (p.widthType === 1 || p.width === 1)) {
      result.left = '0px';
    }
  }
  if (p.position === 'sticky' && p.positionStickyTop != null) set('top', px(p.positionStickyTop));
  for (const axis of ['width', 'height'] as const) {
    const type = p[`${axis}Type`], size = p[axis];
    const main = parent?.layout === 'stack' && (axis === 'width' ? parent.stackDirection === 'horizontal' : parent.stackDirection !== 'horizontal');
    if (parent?.layout === 'grid' && (axis === 'width' ? p.gridItemFillCellWidth : p.gridItemFillCellHeight)) {
      result[axis] = '100%';
    } else if (type === 0) set(axis, px(size));
    else if (type === 1 && typeof size === 'number') result[axis] = `${size * 100}%`;
    else if (type === 2) {
      result[axis] = axis === 'height' ? 'auto' : 'fit-content';
      if (axis === 'height' && typeof size === 'number' && size > 0 && size <= 4 && p.minHeight == null) {
        result.minHeight = `${size}px`;
      }
    }
    else if (type === 3 && typeof size === 'number') {
      if (main && !outOfFlow) {
        result.flexGrow = String(size); result.flexShrink = '1'; result.flexBasis = '0px';
        result[axis === 'width' ? 'minWidth' : 'minHeight'] = '0px';
      } else result[axis] = `${size * 100}%`;
    } else if (type === 4 && typeof size === 'number') result[axis] = `${size * 100}${axis === 'width' ? 'vw' : 'vh'}`;
    else if (type === 5) {
      const ratio = typeof p.fillImagePixelWidth === 'number' && typeof p.fillImagePixelHeight === 'number' && p.fillImagePixelHeight > 0 ? p.fillImagePixelWidth / p.fillImagePixelHeight : p.aspectRatio;
      if (typeof ratio === 'number' && ratio > 0) { result.aspectRatio = String(ratio); result[axis] = 'auto'; }
      else if (axis === 'height' && p.fillEnabled === true && p.fillType === 'image' && context.cmsImageField?.(p.fillImage, node)) result.height = 'auto';
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
  for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) if (p[key] != null) {
    const raw = p[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = `${raw}px`;
    else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      const vpMatch = /^(\d*\.?\d+)(vw|vh)$/i.exec(trimmed);
      if (trimmed === '0' || /^\d*\.?\d+(?:px|%)$/.test(trimmed)) result[key] = trimmed;
      else if (vpMatch) {
        const basis = vpMatch[2].toLowerCase() === 'vw' ? context.viewport?.width : (context.viewport?.height ?? (context.viewport?.width ? simulatedVpHeight(context.viewport.width) : undefined));
        if (basis && basis > 0) result[key] = `${Number(((Number(vpMatch[1]) / 100) * basis).toFixed(2))}px`;
        else mappingDiagnostic(context, node, key);
      } else mappingDiagnostic(context, node, key);
    } else mappingDiagnostic(context, node, key);
  }
  if (typeof p.aspectRatio === 'number' && p.aspectRatio > 0) result.aspectRatio = String(p.aspectRatio);
  if (p.paddingPerSide) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) set(`padding${side}`, px(p[`padding${side}`]));
  } else set('padding', px(p.padding));
  if (p.radiusPerCorner) {
    for (const corner of ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']) set(`border${corner}Radius`, px(p[`radius${corner}`]));
  } else if (p.radius != null || p.radiusTopLeft != null) {
    const radius = p.radius ?? p.radiusTopLeft;
    if (!(node.kind === 'CodeComponentNode' && radius === 0)) set('borderRadius', p.radiusIsRelative && typeof radius === 'number' ? `${radius * 100}%` : px(radius));
  }
  if (p.fillEnabled === true) {
    if (p.fillType === 'color') set('backgroundColor', value('fillColor'));
    else if (p.fillType === 'image') {
      const boundImage = context.cmsImageField?.(p.fillImage, node) === true;
      const image = boundImage ? undefined : value('fillImage');
      const url = image && context.assets?.[image];
      const binding = image && /^\{[A-Za-z_$][\w$]*\}$/.test(image);
      if (url || binding || boundImage) {
        result.backgroundImage = boundImage ? 'none' : url ? `url(${JSON.stringify(url)})` : image!;
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
  const transforms: string[] = [];
  if (p.rotation) transforms.push(`rotate(${p.rotation}deg)`);
  if (p.scale !== undefined && p.scale !== 1) {
    const scale = value('scale');
    if (scale !== undefined) transforms.push(`scale(${scale})`);
  }
  if (transforms.length) result.transform = transforms.join(' ');
  if (node.kind === 'FormPlainTextInputNode' || node.kind === 'FormSelectNode') {
    result.outline = 'none';
    if (node.kind === 'FormPlainTextInputNode' && p.formTextInputType === 'textarea') result.resize = 'vertical';
    set('color', value('formInputFontColor'));
    set('fontSize', px(p.formInputFontSize));
    if (typeof p.formInputFontLineHeight === 'number' && Number.isFinite(p.formInputFontLineHeight)) {
      const unit = typeof p.formInputFontLineHeightUnit === 'string' ? p.formInputFontLineHeightUnit : 'em';
      if (unit === 'em') result.lineHeight = String(p.formInputFontLineHeight);
      else if (unit === '%') result.lineHeight = String(p.formInputFontLineHeight / 100);
      else if (unit === 'px' && result.fontSize?.endsWith('px') && parseFloat(result.fontSize) > 0) result.lineHeight = String(p.formInputFontLineHeight / parseFloat(result.fontSize));
      else result.lineHeight = `${p.formInputFontLineHeight}${unit}`;
    }
    if (typeof p.formInputFontLetterSpacing === 'number' && Number.isFinite(p.formInputFontLetterSpacing) && typeof p.formInputFontLetterSpacingUnit === 'string') {
      result.letterSpacing = `${p.formInputFontLetterSpacing}${p.formInputFontLetterSpacingUnit}`;
    }
    if (typeof p.formInputFontStyle === 'string') result.fontStyle = p.formInputFontStyle;
    if (typeof p.formInputFontWeight === 'number' && Number.isFinite(p.formInputFontWeight) || typeof p.formInputFontWeight === 'string') result.fontWeight = String(p.formInputFontWeight);
    if (typeof p.formInputFontFamily === 'string' && p.formInputFontFamily) result.fontFamily = JSON.stringify(p.formInputFontFamily);
    if (p.formInputFontSelector !== undefined) {
      const font = typeof p.formInputFontSelector === 'string' ? parseSourceGoogleFont(p.formInputFontSelector, p.formInputVariationAxes) : undefined;
      if (font) {
        result.fontFamily = JSON.stringify(font.family);
        result.fontWeight = String(font.axes.wght);
        if (font.axes.ital === 1) result.fontStyle = 'italic';
        const extraAxes = Object.entries(font.axes).filter(([axis]) => axis !== 'wght' && axis !== 'ital');
        if (extraAxes.length) result.fontVariationSettings = extraAxes.map(([axis, axisValue]) => `"${axis}" ${axisValue}`).join(', ');
      } else if (typeof p.formInputFontSelector !== 'string' || p.formInputFontSelector.startsWith('GF;') || !result.fontFamily) {
        mappingDiagnostic(context, node, 'formInputFontSelector', 'SOURCE_FONT_ADAPTER_REQUIRED');
      }
    }
  }
  if (p.userSelect !== undefined) set('userSelect', value('userSelect'));
  if (p.cursor !== undefined) set('cursor', value('cursor'));
  else if (Array.isArray(p.onTap) && p.onTap.length > 0) result.cursor = 'pointer';
  if (p.visible === false) result.display = 'none';
  else if (p.visible !== undefined && p.visible !== true) {
    const visible = value('visible');
    if (visible !== 'true') mappingDiagnostic(context, node, 'visible', 'SOURCE_VISIBILITY_BINDING_REQUIRED');
  }
  return normalizeTransparent(result);
}

export function sourceFormControlPseudoStyles(node: ResolvedSourceNode, context: SourceMappingContext): { placeholder?: Record<string, string>; focus?: Record<string, string> } {
  const p = node.properties;
  const value = (key: string) => sourceStyleValue(p[key], node, context, key);
  let placeholder: Record<string, string> | undefined;
  if (node.kind === 'FormPlainTextInputNode' && p.formInputPlaceholderColor !== undefined) {
    const color = value('formInputPlaceholderColor');
    if (color) placeholder = normalizeTransparent({ color });
  }
  let focus: Record<string, string> | undefined;
  if ((node.kind === 'FormPlainTextInputNode' || node.kind === 'FormSelectNode') && p.formInputFocusedBorderColor !== undefined) {
    const color = value('formInputFocusedBorderColor');
    if (color) {
      const raw: Record<string, string> = {};
      if (p.formInputFocusedBorderPerSide === true) {
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) raw[`border${side}`] = `${px(p[`formInputFocusedBorder${side}`]) ?? '0px'} ${p.formInputFocusedBorderStyle ?? 'solid'} ${color}`;
      } else raw.border = `${px(p.formInputFocusedBorderWidth) ?? '1px'} ${p.formInputFocusedBorderStyle ?? 'solid'} ${color}`;
      focus = normalizeTransparent(raw);
    }
  }
  return { ...(placeholder ? { placeholder } : {}), ...(focus ? { focus } : {}) };
}
