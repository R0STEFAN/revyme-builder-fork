// style-modified.ts — Detect whether a style property on a node is customized/modified (differs from default).
// Used by ControlLabel and style tools to visually highlight customized styles in the builder's accent color.

import type { CanvasNode } from '@/code/parsing/parser';
import type { UnifiedControlContextValue } from './unified/types';

/**
 * Known default values for CSS properties.
 * If a property's value matches one of these, it is considered uncustomized / default.
 */
const DEFAULT_VALUES: Record<string, Set<string>> = {
  opacity: new Set(['1', '1.0', '100%']),
  transform: new Set(['none']),
  border: new Set(['none', '0', '0px']),
  borderWidth: new Set(['0', '0px']),
  borderStyle: new Set(['none']),
  borderRadius: new Set(['0', '0px']),
  margin: new Set(['0', '0px']),
  padding: new Set(['0', '0px']),
  boxShadow: new Set(['none']),
  filter: new Set(['none', 'blur(0px)']),
  backdropFilter: new Set(['none', 'blur(0px)']),
  WebkitBackdropFilter: new Set(['none', 'blur(0px)']),
  overflow: new Set(['visible']),
  overflowX: new Set(['visible']),
  overflowY: new Set(['visible']),
  zIndex: new Set(['auto', '0']),
  pointerEvents: new Set(['auto']),
  userSelect: new Set(['auto']),
  mixBlendMode: new Set(['normal']),
  rotate: new Set(['0', '0deg']),
  scale: new Set(['1', '100%']),
  skew: new Set(['0', '0deg']),
  perspective: new Set(['0', '0px', 'none']),
  transformStyle: new Set(['flat']),
  backfaceVisibility: new Set(['visible']),
  clipPath: new Set(['none']),
  maskImage: new Set(['none']),
  WebkitMaskImage: new Set(['none']),
  backgroundColor: new Set(['transparent', 'rgba(0, 0, 0, 0)', 'rgba(0,0,0,0)', 'none']),
  background: new Set(['transparent', 'none']),
  backgroundImage: new Set(['none']),
  flexDirection: new Set(['row']),
  flexWrap: new Set(['nowrap']),
  alignItems: new Set(['stretch', 'normal']),
  justifyContent: new Set(['flex-start', 'start', 'normal']),
  gap: new Set(['0', '0px']),
  rowGap: new Set(['0', '0px']),
  columnGap: new Set(['0', '0px']),
  fontWeight: new Set(['400', 'normal']),
  fontStyle: new Set(['normal']),
  textDecoration: new Set(['none']),
  textDecorationLine: new Set(['none']),
  textTransform: new Set(['none']),
  letterSpacing: new Set(['normal', '0', '0px']),
  lineHeight: new Set(['normal']),
  textAlign: new Set(['left', 'start']),
  position: new Set(['relative', 'static']),
  WebkitTextStroke: new Set(['none', '0', '0px']),
  textShadow: new Set(['none']),
  width: new Set(['auto']),
  height: new Set(['auto']),
};

function isNonDefaultValue(prop: string, val: string | undefined): boolean {
  if (val === undefined || val === null) return false;
  const trimmed = val.trim();
  if (trimmed === '' || trimmed === 'inherit' || trimmed === 'initial' || trimmed === 'unset') return false;
  const defaults = DEFAULT_VALUES[prop];
  if (defaults && defaults.has(trimmed)) return false;
  return true;
}

/**
 * Check if a style property is customized/modified on the node or in the active context,
 * differing from unstyled / default values.
 */
export function isStyleModified(
  property: string,
  styles?: Record<string, string>,
  node?: CanvasNode | null,
  unifiedCtx?: UnifiedControlContextValue | null,
  label?: string,
): boolean {
  if (!property || property === '') return false;

  // 1. Variable bindings (component prop or page variable)
  if (node?.styleVariables?.[property]) return true;

  // 2. CMS bindings or dynamic bindings
  if ((node as unknown as { cmsBindings?: Record<string, unknown> })?.cmsBindings?.[property]) return true;

  // Gather all style sources
  const nodeStyles = node?.styles || {};
  const s: Record<string, string> = {
    ...nodeStyles,
    ...(styles || {}),
    ...(unifiedCtx?.allProps || {}),
  };

  // If unified context specifies a custom defaultValue (e.g. video objectFit="cover")
  const defVal = (unifiedCtx as unknown as { defaultValue?: string })?.defaultValue;
  if (defVal !== undefined && defVal !== '') {
    if (s[property]?.trim() === defVal.trim()) {
      return false;
    }
  }

  // 3. Compound properties & shorthands
  if (property === 'margin') {
    if (isNonDefaultValue('margin', s.margin)) return true;
    if (isNonDefaultValue('margin', s.marginTop)) return true;
    if (isNonDefaultValue('margin', s.marginRight)) return true;
    if (isNonDefaultValue('margin', s.marginBottom)) return true;
    if (isNonDefaultValue('margin', s.marginLeft)) return true;
    return false;
  }

  if (property === 'padding') {
    if (isNonDefaultValue('padding', s.padding)) return true;
    if (isNonDefaultValue('padding', s.paddingTop)) return true;
    if (isNonDefaultValue('padding', s.paddingRight)) return true;
    if (isNonDefaultValue('padding', s.paddingBottom)) return true;
    if (isNonDefaultValue('padding', s.paddingLeft)) return true;
    return false;
  }

  if (property === 'borderRadius') {
    if (isNonDefaultValue('borderRadius', s.borderRadius)) return true;
    if (isNonDefaultValue('borderRadius', s.borderTopLeftRadius)) return true;
    if (isNonDefaultValue('borderRadius', s.borderTopRightRadius)) return true;
    if (isNonDefaultValue('borderRadius', s.borderBottomRightRadius)) return true;
    if (isNonDefaultValue('borderRadius', s.borderBottomLeftRadius)) return true;
    return false;
  }

  if (property === 'border') {
    if (isNonDefaultValue('border', s.border)) return true;
    if (isNonDefaultValue('borderWidth', s.borderWidth)) return true;
    if (isNonDefaultValue('borderStyle', s.borderStyle)) return true;
    if (s.borderColor && s.borderColor.trim() !== '') return true;
    if (isNonDefaultValue('border', s.borderTop)) return true;
    if (isNonDefaultValue('border', s.borderRight)) return true;
    if (isNonDefaultValue('border', s.borderBottom)) return true;
    if (isNonDefaultValue('border', s.borderLeft)) return true;
    if (isNonDefaultValue('borderWidth', s.borderTopWidth)) return true;
    if (isNonDefaultValue('borderWidth', s.borderRightWidth)) return true;
    if (isNonDefaultValue('borderWidth', s.borderBottomWidth)) return true;
    if (isNonDefaultValue('borderWidth', s.borderLeftWidth)) return true;
    if (s.borderImage && s.borderImage.trim() !== 'none') return true;
    if (s.borderImageSource && s.borderImageSource.trim() !== 'none') return true;
    // Check overlay border in afterCSS
    if (node?.afterCSS && /border/i.test(node.afterCSS)) return true;
    return false;
  }

  if (property === 'gap') {
    if (isNonDefaultValue('gap', s.gap)) return true;
    if (isNonDefaultValue('rowGap', s.rowGap)) return true;
    if (isNonDefaultValue('columnGap', s.columnGap)) return true;
    return false;
  }

  if (property === 'overflow') {
    if (isNonDefaultValue('overflow', s.overflow)) return true;
    if (isNonDefaultValue('overflowX', s.overflowX)) return true;
    if (isNonDefaultValue('overflowY', s.overflowY)) return true;
    return false;
  }

  if (property === 'inset') {
    if (isNonDefaultValue('top', s.top)) return true;
    if (isNonDefaultValue('right', s.right)) return true;
    if (isNonDefaultValue('bottom', s.bottom)) return true;
    if (isNonDefaultValue('left', s.left)) return true;
    return false;
  }

  if (property === 'backgroundColor' || property === 'background') {
    if (isNonDefaultValue('backgroundColor', s.backgroundColor)) return true;
    if (isNonDefaultValue('background', s.background)) return true;
    if (isNonDefaultValue('backgroundImage', s.backgroundImage)) return true;
    return false;
  }

  if (property === 'transform') {
    if (isNonDefaultValue('transform', s.transform)) return true;
    if (isNonDefaultValue('rotate', s.rotate)) return true;
    if (isNonDefaultValue('scale', s.scale)) return true;
    if (isNonDefaultValue('skew', s.skew)) return true;
    return false;
  }

  if (property === 'backdropFilter') {
    if (isNonDefaultValue('backdropFilter', s.backdropFilter)) return true;
    if (isNonDefaultValue('WebkitBackdropFilter', s.WebkitBackdropFilter)) return true;
    return false;
  }

  if (property === 'maskImage' || property === 'WebkitMaskImage') {
    if (isNonDefaultValue('maskImage', s.maskImage)) return true;
    if (isNonDefaultValue('WebkitMaskImage', s.WebkitMaskImage)) return true;
    return false;
  }

  if (property === 'display') {
    // HideControl has label="Hide", where display: none means hidden (modified)
    if (label && /hide/i.test(label)) {
      return s.display === 'none';
    }
    // Layout display: flex or grid is modified
    if (s.display && !['', 'block', 'inline'].includes(s.display.trim())) {
      return true;
    }
    return false;
  }

  if (property === 'transition') {
    if (node?.motionProps?.transition && Object.keys(node.motionProps.transition).length > 0) {
      return true;
    }
    return false;
  }

  // 4. General check against known defaults or non-empty string
  return isNonDefaultValue(property, s[property]);
}
