// context-menu-store.ts — Context menu + rename state.

import { atom } from 'jotai';

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
}

export const copiedElementStylesAtom = atom<CopiedElementStyles | null>(null);

/** Style keys that define element positioning/layout within its parent or canvas,
 *  which must NOT be transferred to another element when copying styles. */
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
]);

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

/** Prepare payload for pasting styles, clearing any conflicting fill layers on the target */
export function prepareStylesForPaste(
  copiedStyles: Record<string, string>,
  targetStyles?: Record<string, string>,
): Record<string, string> {
  const result = { ...copiedStyles };
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

