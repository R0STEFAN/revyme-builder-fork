// context-menu-store.ts — Context menu + rename state.

import { atom } from 'jotai';
import { BORDER_INLINE_KEYS } from '@/editor/ui/border-utils';
import {
  parseShadowEntries,
  formatShadowEntries,
  mergeFilterWithDropShadows,
  extractNonShadowFilter,
} from '@/editor/ui/shadow-utils';
import {
  MOTION_TRANSFORM_PROPS,
  MOTION_VISUAL_TRANSFORM_PROPS,
  motionPropsToCSSTransform,
  cssTransformToMotionProps,
} from '@/shared/motion-transform';

export interface ContextMenuState {
  show: boolean;
  x: number;
  y: number;
  nodeId: string | null;
  /** True when the right-click landed on a VIEWPORT HEADER — the menu's
   *  node operations (Make Component, Cut, Delete, …) don't apply to a
   *  viewport, so they all disable. Without this flag the menu would
   *  resurrect the current selection via its `menu.nodeId || selectedId`
   *  fallback and happily offer to cut it. */
  viewportHeader?: boolean;
}

export const contextMenuAtom = atom<ContextMenuState>({
  show: false,
  x: 0,
  y: 0,
  nodeId: null,
});

/** Set to a nodeId to activate inline rename in the layers panel */
export const renamingNodeIdAtom = atom<string | null>(null);

// ─── Element Styles Clipboard ──────────────────────────────────────────────

export interface CopiedElementStyles {
  styles: Record<string, string>;
  sourceNodeId: string;
  sourceNodeName?: string;
  /** Border ::after overlay rule body when the source border renders in overlay mode (solid or gradient). */
  borderOverlayCSS?: string | null;
  /** Canonical composed CSS transform string, regardless of source storage format. */
  transformCSS?: string;
  /** True if the source node had an explicit border (inline or overlay). */
  hasBorder?: boolean;
  /** True if the source node had an explicit shadow (boxShadow or drop-shadow). */
  hasShadow?: boolean;
}

export const copiedElementStylesAtom = atom<CopiedElementStyles | null>(null);

/** Style keys that define element positioning/layout within its parent or canvas,
 *  or transform properties that travel through canonical transform conversion. */
export const EXCLUDED_STYLE_KEYS = new Set([
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'order',
  'zIndex',
  'gridColumn',
  'gridRow',
  'gridArea',
  // Transform & motion transform props travel via transformCSS
  'transform',
  ...MOTION_TRANSFORM_PROPS,
]);

/** Check if a style set or border overlay contains any active border */
export function hasAnyBorder(styles: Record<string, string> | undefined, borderOverlayCSS?: string | null): boolean {
  if (borderOverlayCSS && borderOverlayCSS.trim().length > 0) return true;
  if (!styles) return false;
  for (const k of BORDER_INLINE_KEYS) {
    const val = styles[k];
    if (val && val !== 'none' && val !== '0' && val !== '0px') return true;
  }
  for (const k of Object.keys(styles)) {
    if (k.startsWith('--border-')) {
      const val = styles[k];
      if (val && val !== '0' && val !== '0px') return true;
    }
  }
  return false;
}

/** Check if a style set contains any active shadow (box-shadow or drop-shadow) */
export function hasAnyShadow(styles: Record<string, string> | undefined): boolean {
  if (!styles) return false;
  const bs = styles.boxShadow;
  if (bs && bs !== 'none' && bs.trim().length > 0) return true;
  const f = styles.filter;
  if (f && /drop-shadow\(/i.test(f)) return true;
  return false;
}

/** Extract canonical visual transform CSS string (rotate, scale, skew) */
export function extractVisualTransformCSS(styles: Record<string, string> | undefined): string {
  if (!styles) return '';
  const visualMotion: Record<string, string> = {};
  for (const k of Object.keys(styles)) {
    if (MOTION_VISUAL_TRANSFORM_PROPS.has(k) && styles[k] !== undefined && styles[k] !== '') {
      visualMotion[k] = styles[k];
    }
  }
  if (Object.keys(visualMotion).length > 0) {
    const css = motionPropsToCSSTransform(visualMotion);
    if (css) return css;
  }
  const raw = (styles.transform ?? '').trim();
  if (raw && raw !== 'none') {
    const parsed = cssTransformToMotionProps(raw);
    const onlyVisual: Record<string, string> = {};
    for (const k of Object.keys(parsed)) {
      if (MOTION_VISUAL_TRANSFORM_PROPS.has(k) && parsed[k] !== undefined && parsed[k] !== '') {
        onlyVisual[k] = parsed[k];
      }
    }
    const css = motionPropsToCSSTransform(onlyVisual);
    if (css) return css;
  }
  return '';
}

/** Extract all transferable visual & typography styles from a node's styles */
export function extractCopyableStyles(styles: Record<string, string> | undefined): Record<string, string> {
  if (!styles) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(styles)) {
    if (EXCLUDED_STYLE_KEYS.has(key)) continue;
    if (val === undefined || val === '') continue;
    result[key] = val;
  }
  return result;
}

/** Prepare payload for pasting styles, applying full-clear contracts for fills, borders, shadows, and transform format */
export function prepareStylesForPaste(
  copied: CopiedElementStyles | Record<string, string>,
  targetStyles?: Record<string, string>,
  opts?: { isMotionTarget?: boolean },
): Record<string, string> {
  const copiedStyles = ('styles' in copied && typeof copied.styles === 'object' && copied.styles !== null)
    ? copied.styles
    : (copied as Record<string, string>);
  const borderOverlayCSS = 'borderOverlayCSS' in copied ? copied.borderOverlayCSS : undefined;
  const transformCSS = 'transformCSS' in copied ? copied.transformCSS : undefined;
  const hasBorder = 'hasBorder' in copied ? copied.hasBorder : undefined;
  const hasShadow = 'hasShadow' in copied ? copied.hasShadow : undefined;

  const result: Record<string, string> = { ...copiedStyles };

  // 1. Fill layer conflict resolution
  const hasCopiedFill = 'backgroundColor' in copiedStyles || 'background' in copiedStyles || 'backgroundImage' in copiedStyles;
  if (hasCopiedFill && targetStyles) {
    if ('backgroundImage' in targetStyles && !('backgroundImage' in copiedStyles)) {
      result.backgroundImage = '';
    }
    if ('background' in targetStyles && !('background' in copiedStyles)) {
      result.background = '';
    }
    if ('backgroundColor' in targetStyles && !('backgroundColor' in copiedStyles)) {
      result.backgroundColor = '';
    }
  }

  // 2. Border Full-Clear Contract
  const sourceHasBorder = hasBorder ?? hasAnyBorder(copiedStyles, borderOverlayCSS);
  const targetHasBorder = hasAnyBorder(targetStyles);
  if (!sourceHasBorder && targetHasBorder) {
    // Clear standard shorthand/longhands
    result.border = '';
    result.borderWidth = '';
    result.borderColor = '';
    result.borderStyle = '';
    if (targetStyles) {
      for (const k of BORDER_INLINE_KEYS) {
        if (targetStyles[k]) result[k] = '';
      }
      for (const k of Object.keys(targetStyles)) {
        if (k.startsWith('--border-')) result[k] = '';
      }
    }
  } else if (borderOverlayCSS) {
    // Overlay border mode: clear inline border keys on target
    for (const k of BORDER_INLINE_KEYS) {
      result[k] = '';
    }
    const pos = targetStyles?.position;
    if (!pos || pos === 'static') {
      result.position = 'relative';
    }
  } else if (sourceHasBorder) {
    // Inline border mode: clear leftover overlay variables on target
    if (targetStyles) {
      for (const k of Object.keys(targetStyles)) {
        if (k.startsWith('--border-')) result[k] = '';
      }
    }
  }

  // 3. Shadow Full-Clear Contract & Merging
  const sourceHasShadow = hasShadow ?? hasAnyShadow(copiedStyles);
  if (!sourceHasShadow) {
    if (targetStyles?.boxShadow) {
      result.boxShadow = '';
    }
    if (targetStyles?.filter && /drop-shadow\(/i.test(targetStyles.filter)) {
      result.filter = extractNonShadowFilter(targetStyles.filter);
    }
  } else {
    if (!('boxShadow' in copiedStyles) && targetStyles?.boxShadow) {
      result.boxShadow = '';
    }
    const copiedDropShadow = copiedStyles.filter
      ? formatShadowEntries(parseShadowEntries('', copiedStyles.filter)).dropShadowFilter
      : '';
    if (copiedDropShadow) {
      result.filter = mergeFilterWithDropShadows(targetStyles?.filter ?? '', copiedDropShadow);
    } else if (targetStyles?.filter && /drop-shadow\(/i.test(targetStyles.filter)) {
      result.filter = extractNonShadowFilter(targetStyles.filter);
    }
  }

  // 4. Transform format conversion
  if (transformCSS) {
    if (opts?.isMotionTarget) {
      const motion = cssTransformToMotionProps(transformCSS);
      result.transform = '';
      for (const k of MOTION_VISUAL_TRANSFORM_PROPS) {
        if (k in motion && motion[k] !== undefined) {
          result[k] = motion[k];
        } else if (targetStyles && targetStyles[k]) {
          result[k] = '';
        }
      }
    } else {
      result.transform = transformCSS;
      for (const k of MOTION_VISUAL_TRANSFORM_PROPS) {
        if (targetStyles && targetStyles[k]) {
          result[k] = '';
        }
      }
    }
  }

  return result;
}

/** Resolve effective styles for a node considering active variant overrides */
export function resolveEffectiveStyles(
  node: { styles?: Record<string, string>; motionVariants?: Record<string, Record<string, string>> | null } | null | undefined,
  activeVariant?: string | null,
): Record<string, string> {
  if (!node) return {};
  let result = { ...(node.styles ?? {}) };
  if (node.motionVariants) {
    const defaultEntry = node.motionVariants['default'];
    if (defaultEntry && Object.keys(defaultEntry).length > 0) {
      result = { ...result, ...defaultEntry };
    }
    if (activeVariant && activeVariant !== 'default' && node.motionVariants[activeVariant]) {
      const variantStyles = node.motionVariants[activeVariant];
      if (variantStyles && Object.keys(variantStyles).length > 0) {
        result = { ...result, ...variantStyles };
      }
    }
  }
  return result;
}

