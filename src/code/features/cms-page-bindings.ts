// cms-page-bindings.ts — Apply previewed-item data to a detail page's
// node tree at canvas-render time.
//
// Detail-page templates use JSX bindings like `{item.title}` /
// `<img src={item.cover}>` that the parser detects (when the file has
// `/** @cmsPage { kind: 'detail' } */`) and stores on each node as
// `binding`, `attrBindings`, `styleBindings` — same shape inline `.map()`
// templates use.
//
// This helper takes the parser's node map + the previewed item record and
// returns a NEW map where binding-bearing nodes are shallow-cloned with
// their `textContent` / `attrs` / `styles` substituted. Nodes without
// bindings are passed through by reference; cloning is per-node so
// switching previewed slugs is cheap.

import type { CanvasNode } from '../parsing/parser';
import { formatBoundStyleValue } from './cms-style-format';
import { trace } from '@/shared/debug-trace';

function getNestedValue(obj: Record<string, unknown> | null, path: string): unknown {
  if (!obj || !path) return undefined;
  if (path in obj) return (obj as any)[path];
  if (!path.includes('.')) return (obj as any)[path];
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function formatAttrValue(val: unknown): string {
  if (typeof val === 'object' && val !== null) {
    return (val as any).url || (val as any).src || (val as any).id || (val as any).filename_disk || '';
  }
  return String(val ?? '');
}

/**
 * Walk the node map and apply field substitutions for any node whose
 * parser-detected bindings reference fields present on `item`. Returns a
 * new Map; the input map is left untouched (Canvas re-renders on slug
 * change get the fresh substitution without mutating the parser cache).
 */
export function applyDetailPageBindings(
  nodes: Map<string, CanvasNode>,
  item: Record<string, unknown> | null,
): Map<string, CanvasNode> {
  if (!item) return nodes;
  const out = new Map(nodes);
  let mutatedCount = 0;

  for (const [id, node] of out) {
    let cloned: CanvasNode | null = null;

    // Text / single-attribute binding.
    if (node.binding) {
      const rawVal = getNestedValue(item, node.binding.field);
      if (rawVal !== undefined) {
        cloned = { ...node };
        if (node.binding.property === 'text') {
          cloned.textContent = String(rawVal ?? '');
        } else {
          cloned.attrs = { ...cloned.attrs, [node.binding.property]: formatAttrValue(rawVal) };
        }
      }
    }

    // Multi-attribute bindings (src + alt etc.).
    if (node.attrBindings) {
      for (const ab of node.attrBindings) {
        const rawVal = getNestedValue(item, ab.field);
        if (rawVal === undefined) continue;
        if (!cloned) cloned = { ...node };
        cloned.attrs = { ...cloned.attrs, [ab.property]: formatAttrValue(rawVal) };
      }
    }

    // Style bindings — `{ backgroundColor: item.bgColor }` etc.
    // For URL-bearing props (`backgroundImage`, `maskImage`, …) the JSON
    // holds a bare URL, but CSS needs `url(...)`; `formatBoundStyleValue`
    // wraps when needed. Same helper the Renderer uses for .map() ghosts so
    // detail-page substitution and per-item rendering stay byte-identical.
    if (node.styleBindings) {
      for (const sb of node.styleBindings) {
        const rawVal = getNestedValue(item, sb.field);
        if (rawVal === undefined) continue;
        const resolved = formatBoundStyleValue(sb.styleProp, (rawVal as any) ?? '');
        if (!cloned) cloned = { ...node };
        cloned.styles = { ...cloned.styles, [sb.styleProp]: resolved };
      }
    }

    // DORMANT bindings (`data-cms-orphan`). A node dragged onto the canvas of
    // its own detail page cannot keep a live `{item.field}` — `canvasNodes` is
    // module scope, where `item` is not declared — so the binding is stashed
    // and the row's value baked into the JSX as a literal. That literal is a
    // SNAPSHOT: editing the field left the canvas copy showing the old text
    // (report 2026-09-09). Painting the stash here makes the canvas follow the
    // field like every other bound node, while the source keeps the safe
    // literal. A field this page's item doesn't have is skipped, so a row
    // dragged out of a NESTED collection list stays on its baked value.
    if (node.orphanBindings) {
      for (const ob of node.orphanBindings) {
        const rawVal = getNestedValue(item, ob.field);
        if (rawVal === undefined) continue;
        if (!cloned) cloned = { ...node };
        if (ob.prop === '__text') {
          cloned.textContent = String(rawVal ?? '');
        } else if (ob.prop.startsWith('__style.')) {
          const cssProp = ob.prop.slice('__style.'.length);
          cloned.styles = { ...cloned.styles, [cssProp]: formatBoundStyleValue(cssProp, (rawVal as any) ?? '') };
        } else {
          cloned.attrs = { ...cloned.attrs, [ob.prop]: formatAttrValue(rawVal) };
        }
      }
    }

    if (cloned) {
      out.set(id, cloned);
      mutatedCount++;
    }
  }

  trace.fn('cms-page-bindings:apply', { mutatedCount, totalNodes: out.size });
  return out;
}
