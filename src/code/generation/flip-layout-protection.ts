// flip-layout-protection.ts — Counter-scale protection for Framer Motion FLIP
// containers inside Design Components.
//
// Why this exists:
//   Revyme animates variant layout changes (`height`, `width`, `flexDirection`,
//   in-flow `AnimatePresence`) via Framer Motion FLIP (`layout={true}`).
//   FLIP scales a resizing container using CSS `transform: scaleX(...) scaleY(...)`.
//   Inside a scaling `layout={true}` ancestor, plain HTML elements (`div`, `img`,
//   `p`) and `motion.*` children that lack a `layout` prop do NOT participate
//   in Framer Motion's projection tree, so they do not receive inverse scale
//   correction — headers crush vertically, images stretch, and only children
//   that happen to carry `layout` (like an AnimatePresence pill) stay 1:1.
//
// Fix:
//   Whenever a Design Component has at least one scaling `layout` node (`layout`
//   / `layout={true}` / `layout="size"`):
//   1. Wrap the component's returned JSX root in `<LayoutGroup>` (if absent).
//   2. Promote plain structural/content children inside scaling FLIP containers
//      (and siblings along a resizing spine) to `<motion.* layout="position">`,
//      so Framer Motion keeps them un-distorted (1:1) and anchored in place.

import { parseJSX } from '../parsing/ast-utils';
import { findVariantRootId } from '@/shared/variant-root';
import { CONDITIONAL_LAYOUT_PROPS } from '@/shared/constants';
import * as t from '@babel/types';
import _traverse, { type NodePath } from '@babel/traverse';
import _generate from '@babel/generator';

function unwrapDefault<T>(mod: unknown): T {
  const first = typeof mod === 'function' ? mod : (mod as any)?.default;
  return (typeof first === 'function' ? first : first?.default) as T;
}

const traverse = unwrapDefault<typeof _traverse>(_traverse);
const generate = unwrapDefault<typeof _generate>(_generate);

const PROMOTABLE_HTML_TAGS = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'button', 'ul', 'ol', 'li', 'figure', 'figcaption', 'label',
]);

const PASSTHROUGH_WRAPPERS = new Set(['AnimatePresence', 'LayoutGroup', 'MotionConfig']);
const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'g', 'defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient',
  'stop', 'use', 'symbol', 'tspan', 'text',
]);

function getElementTagInfo(el: t.JSXElement): { raw: string; isMotion: boolean; base: string } | null {
  const name = el.openingElement.name;
  if (t.isJSXIdentifier(name)) {
    return { raw: name.name, isMotion: false, base: name.name };
  }
  if (
    t.isJSXMemberExpression(name) &&
    t.isJSXIdentifier(name.object, { name: 'motion' }) &&
    t.isJSXIdentifier(name.property)
  ) {
    return { raw: `motion.${name.property.name}`, isMotion: true, base: name.property.name };
  }
  return null;
}

function getLayoutAttr(el: t.JSXElement): t.JSXAttribute | undefined {
  return el.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'layout' }),
  );
}

function isScalingLayoutElement(el: t.JSXElement): boolean {
  const attr = getLayoutAttr(el);
  if (!attr) return false;
  if (attr.value === null || attr.value === undefined) return true; // shorthand `layout`
  if (t.isStringLiteral(attr.value)) {
    return attr.value.value !== 'position';
  }
  if (t.isJSXExpressionContainer(attr.value)) {
    const expr = attr.value.expression;
    if (t.isBooleanLiteral(expr)) return expr.value;
    if (t.isStringLiteral(expr)) return expr.value !== 'position';
    // Expressions such as `style?.position === 'fixed' ? 'size' : true` scale dynamically.
    return !t.isJSXEmptyExpression(expr);
  }
  return false;
}

function hasConditionalSizeStyle(el: t.JSXElement): boolean {
  const styleAttr = el.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'style' }),
  );
  if (!styleAttr || !t.isJSXExpressionContainer(styleAttr.value)) return false;
  const expr = styleAttr.value.expression;
  if (!t.isObjectExpression(expr)) return false;
  return expr.properties.some(
    (prop) =>
      t.isObjectProperty(prop) &&
      t.isIdentifier(prop.key) &&
      CONDITIONAL_LAYOUT_PROPS.has(prop.key.name) &&
      t.isConditionalExpression(prop.value),
  );
}

/** Collect direct JSXElement children, unwrapping transparent wrappers and JSX conditionals. */
function collectDirectChildElements(children: t.JSXElement['children']): t.JSXElement[] {
  const out: t.JSXElement[] = [];

  const visitExpr = (expr: t.Expression | t.JSXEmptyExpression) => {
    if (t.isJSXElement(expr)) {
      const info = getElementTagInfo(expr);
      if (info && !info.isMotion && PASSTHROUGH_WRAPPERS.has(info.base)) {
        out.push(...collectDirectChildElements(expr.children));
      } else {
        out.push(expr);
      }
      return;
    }
    if (t.isParenthesizedExpression(expr)) {
      visitExpr(expr.expression);
      return;
    }
    if (t.isLogicalExpression(expr)) {
      visitExpr(expr.left);
      visitExpr(expr.right);
      return;
    }
    if (t.isConditionalExpression(expr)) {
      visitExpr(expr.consequent);
      visitExpr(expr.alternate);
    }
  };

  for (const child of children) {
    if (t.isJSXElement(child)) {
      const info = getElementTagInfo(child);
      if (info && !info.isMotion && PASSTHROUGH_WRAPPERS.has(info.base)) {
        out.push(...collectDirectChildElements(child.children));
      } else {
        out.push(child);
      }
    } else if (t.isJSXFragment(child)) {
      out.push(...collectDirectChildElements(child.children));
    } else if (t.isJSXExpressionContainer(child)) {
      visitExpr(child.expression);
    }
  }
  return out;
}

function subtreeHasScalingResize(el: t.JSXElement): boolean {
  for (const child of collectDirectChildElements(el.children)) {
    if (isScalingLayoutElement(child) && hasConditionalSizeStyle(child)) return true;
    if (subtreeHasScalingResize(child)) return true;
  }
  return false;
}

function treeHasScalingLayout(root: t.JSXElement): boolean {
  if (isScalingLayoutElement(root)) return true;
  return collectDirectChildElements(root.children).some(treeHasScalingLayout);
}

function unwrapReturnJSX(node: t.Expression | null | undefined): t.JSXElement | null {
  let cur = node ?? null;
  while (cur && t.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur && t.isJSXElement(cur) ? cur : null;
}

function hasLayoutGroupAncestorOrSelf(el: t.JSXElement, rootId: string): boolean {
  const check = (cur: t.JSXElement): boolean => {
    const info = getElementTagInfo(cur);
    if (info && !info.isMotion && info.base === 'LayoutGroup') return true;
    const idAttr = cur.openingElement.attributes.find(
      (a): a is t.JSXAttribute =>
        t.isJSXAttribute(a) &&
        t.isJSXIdentifier(a.name, { name: 'data-id' }) &&
        t.isStringLiteral(a.value, { value: rootId }),
    );
    if (idAttr) return false;
    return collectDirectChildElements(cur.children).some(check);
  };
  return check(el);
}

function promoteToLayoutPosition(el: t.JSXElement): boolean {
  const info = getElementTagInfo(el);
  if (!info) return false;
  if (SVG_TAGS.has(info.base)) return false;
  if (!PROMOTABLE_HTML_TAGS.has(info.base)) return false;
  if (getLayoutAttr(el)) return false;
  if (hasConditionalSizeStyle(el)) return false;

  if (!info.isMotion) {
    const motionName = t.jsxMemberExpression(t.jsxIdentifier('motion'), t.jsxIdentifier(info.base));
    el.openingElement.name = motionName;
    if (el.closingElement) {
      el.closingElement.name = t.cloneNode(motionName);
    }
  }
  el.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier('layout'), t.stringLiteral('position')),
  );
  return true;
}

function ensureFramerMotionImports(ast: t.File, needed: Set<string>): boolean {
  if (needed.size === 0) return false;
  let existingImport: t.ImportDeclaration | null = null;
  for (const stmt of ast.program.body) {
    if (t.isImportDeclaration(stmt) && stmt.source.value === 'framer-motion') {
      existingImport = stmt;
      break;
    }
  }

  let updated = false;
  if (existingImport) {
    const present = new Set(
      existingImport.specifiers
        .filter((s): s is t.ImportSpecifier => t.isImportSpecifier(s))
        .map((s) => (t.isIdentifier(s.imported) ? s.imported.name : s.imported.value)),
    );
    for (const name of needed) {
      if (!present.has(name)) {
        existingImport.specifiers.push(t.importSpecifier(t.identifier(name), t.identifier(name)));
        updated = true;
      }
    }
    return updated;
  }

  const specifiers = [...needed].map((name) =>
    t.importSpecifier(t.identifier(name), t.identifier(name)),
  );
  const decl = t.importDeclaration(specifiers, t.stringLiteral('framer-motion'));
  // Place after any directive/leading imports so formatting remains idiomatic.
  let insertIdx = 0;
  while (
    insertIdx < ast.program.body.length &&
    t.isImportDeclaration(ast.program.body[insertIdx])
  ) {
    insertIdx++;
  }
  ast.program.body.splice(insertIdx, 0, decl);
  return true;
}

/**
 * Protect structural/content children inside scaling `layout={true}` FLIP
 * containers of a Design Component so headers and media stay 1:1 and stationary
 * while an ancestor or sibling expands/collapses.
 */
export function ensureFlipLayoutCounterScale(code: string): string {
  if (!/\bvariantConfig\b/.test(code) || !/\blayout\b/.test(code)) return code;

  const rootId = findVariantRootId(code);
  if (!rootId) return code;

  let ast: t.File | null = null;
  try {
    ast = parseJSX(code);
  } catch {
    return code;
  }
  if (!ast) return code;

  let targetReturnPath: NodePath<t.ReturnStatement> | null = null;
  traverse(ast, {
    JSXElement(path) {
      if (targetReturnPath) return;
      const hasRootId = path.node.openingElement.attributes.some(
        (a) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name, { name: 'data-id' }) &&
          t.isStringLiteral(a.value, { value: rootId }),
      );
      if (!hasRootId) return;
      const fnReturn = path.findParent((p) => p.isReturnStatement()) as NodePath<t.ReturnStatement> | null;
      if (fnReturn) {
        targetReturnPath = fnReturn;
        path.stop();
      }
    },
  });

  if (!targetReturnPath) return code;
  const returnStmt = (targetReturnPath as NodePath<t.ReturnStatement>).node;
  const rootEl = unwrapReturnJSX(returnStmt.argument);
  if (!rootEl || !treeHasScalingLayout(rootEl)) return code;

  let changed = false;
  const neededImports = new Set<string>();

  const walk = (el: t.JSXElement) => {
    const info = getElementTagInfo(el);
    if (info && SVG_TAGS.has(info.base)) return;

    const protectChildren = isScalingLayoutElement(el) || subtreeHasScalingResize(el);
    const children = collectDirectChildElements(el.children);

    for (const child of children) {
      if (protectChildren && !isScalingLayoutElement(child)) {
        if (promoteToLayoutPosition(child)) {
          changed = true;
          neededImports.add('motion');
        }
      }
      walk(child);
    }
  };

  walk(rootEl);

  if (!hasLayoutGroupAncestorOrSelf(rootEl, rootId)) {
    const lgEl = t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier('LayoutGroup'), [], false),
      t.jsxClosingElement(t.jsxIdentifier('LayoutGroup')),
      [t.jsxText('\n      '), rootEl, t.jsxText('\n    ')],
      false,
    );
    returnStmt.argument = lgEl;
    neededImports.add('LayoutGroup');
    changed = true;
  }

  if (ensureFramerMotionImports(ast, neededImports)) {
    changed = true;
  }

  if (!changed) return code;
  return generate(ast, { retainLines: true, jsescOption: { minimal: true } }).code;
}
