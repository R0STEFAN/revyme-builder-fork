// heal-motion-tags.ts — self-heal JSX elements to `motion.<tag>` when animation props,
// gestures, variant connections, or layout morphs are detected.
//
// Native HTML elements (<div>, <button>, <span>, etc.) do NOT respond to Framer Motion
// gestures (whileHover, onTap, whileTap, whileInView, onHoverStart, etc.) and break variant
// propagation or layout transitions. This utility detects elements with animation attributes
// or active connection bindings and automatically transforms them to `motion.<tag>` while
// preserving exact formatting, whitespace, comments, and imports.

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { ensureNamedImport } from '@/code/generation/generator-utils';
import { parseConnections } from '@/shared/connection-parse';
import { findVariantRootId } from '@/shared/variant-root';
import { trace } from '@/shared/debug-trace';

/** Framer Motion attributes, gestures, event handlers, and layout props that require a motion.* element */
const MOTION_ATTRS = new Set([
  // Animation / Variants
  'animate',
  'initial',
  'exit',
  'variants',
  'transition',

  // Gestures
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'whileInView',

  // Motion event handlers
  'onHoverStart',
  'onHoverEnd',
  'onTap',
  'onTapStart',
  'onTapCancel',
  'onDrag',
  'onDragStart',
  'onDragEnd',
  'onViewportEnter',
  'onViewportLeave',
  'onAnimationStart',
  'onAnimationComplete',

  // Layout morphing & animations
  'layout',
  'layoutId',
  'layoutScroll',
  'layoutRoot',
  'layoutDependency',

  // Drag props
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
  'dragSnapToOrigin',
  'dragPropagation',
  'dragControls',
  'dragListener',

  // Explicit marker
  'data-motion',
]);

/** Native HTML/SVG tags that should never be converted to motion tags */
const NON_MOTION_TAGS = new Set([
  'style',
  'script',
  'head',
  'meta',
  'title',
  'defs',
]);

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Automatically converts plain HTML/SVG elements to `motion.<tag>` when animation
 * props, gestures, variant triggers, or connections are present.
 * Ensures `import { motion } from 'framer-motion'` is present when healing occurs.
 */
export function healMotionTags(code: string): { code: string; healedCount: number } {
  let ast: t.File | null = null;
  try {
    ast = parseJSX(code);
  } catch {
    return { code, healedCount: 0 };
  }
  if (!ast) return { code, healedCount: 0 };

  // Parse any connections declared in the component
  const connections = parseConnections(code);
  const sourceNodeIds = new Set<string>();
  let hasRootConnection = false;
  for (const c of connections) {
    if (c.sourceNode) {
      sourceNodeIds.add(c.sourceNode);
    } else {
      hasRootConnection = true;
    }
  }

  const rootId = hasRootConnection ? findVariantRootId(code) : null;

  const edits: Edit[] = [];
  let healedCount = 0;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const opening = path.node.openingElement;

      // Only lowercase native HTML/SVG tags are candidates for motion conversion
      if (!t.isJSXIdentifier(opening.name)) return;
      const tagName = opening.name.name;
      if (!/^[a-z]/.test(tagName) || NON_MOTION_TAGS.has(tagName)) return;

      const attrs = opening.attributes;

      // Find data-id if present
      let dataId: string | null = null;
      for (const attr of attrs) {
        if (
          t.isJSXAttribute(attr) &&
          t.isJSXIdentifier(attr.name) &&
          attr.name.name === 'data-id' &&
          t.isStringLiteral(attr.value)
        ) {
          dataId = attr.value.value;
          break;
        }
      }

      // Check Condition 1: Element has any motion/gesture/layout/drag attribute
      let needsMotion = false;
      for (const attr of attrs) {
        if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
          if (MOTION_ATTRS.has(attr.name.name)) {
            needsMotion = true;
            break;
          }
        }
      }

      // Check Condition 2: Element is targeted by a connection sourceNode
      if (!needsMotion && dataId && sourceNodeIds.has(dataId)) {
        needsMotion = true;
      }

      // Check Condition 3: Element is the component root and has a root-level connection
      if (!needsMotion && hasRootConnection) {
        if (dataId && rootId && dataId === rootId) {
          needsMotion = true;
        } else if (!rootId && path.parentPath.isReturnStatement()) {
          needsMotion = true;
        }
      }

      if (!needsMotion) return;

      if (typeof opening.name.start !== 'number' || typeof opening.name.end !== 'number') {
        return;
      }

      // Record edit for opening tag: <tag -> <motion.tag
      edits.push({
        start: opening.name.start,
        end: opening.name.end,
        text: `motion.${tagName}`,
      });

      // Record edit for closing tag if not self-closing: </tag> -> </motion.tag>
      const closing = path.node.closingElement;
      if (
        closing &&
        t.isJSXIdentifier(closing.name) &&
        closing.name.name === tagName &&
        typeof closing.name.start === 'number' &&
        typeof closing.name.end === 'number'
      ) {
        edits.push({
          start: closing.name.start,
          end: closing.name.end,
          text: `motion.${tagName}`,
        });
      }

      healedCount++;
    },
  });

  if (healedCount === 0 || edits.length === 0) {
    return { code, healedCount: 0 };
  }

  // Sort edits descending by start offset so replacements don't shift earlier positions
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }

  // Ensure motion is imported from framer-motion
  out = ensureNamedImport(out, 'framer-motion', ['motion']);

  trace.action('heal-motion-tags:healed', { healedCount });
  return { code: out, healedCount };
}
