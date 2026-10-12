// convert-to-image-gen.ts — Convert div with backgroundImage to img element.
//
// Supports two modes:
// 1. 'replace' (default): converts <div> (or <motion.div>) directly to self-closing
//    <img ... /> (or <motion.img ... />), extracting the image URL from style.backgroundImage,
//    mapping backgroundSize -> objectFit, backgroundPosition -> objectPosition, setting
//    display: 'block', and stripping background-* CSS properties.
// 2. 'nested-background': keeps container <div> (with position: relative, overflow: hidden),
//    removes the url() from backgroundImage (preserving gradients if multi-layer), and inserts
//    an absolute-positioned <img ... /> child as the first child of the container.

import * as t from '@babel/types';
import { parseJSX, findFirstElementByDataId, findAttribute } from '../parsing/ast-utils';
import { generate } from './generator-utils';
import { trace } from '@/shared/debug-trace';

/** Extract URL from a CSS url(...) string. */
function extractUrlFromString(str: string): string | null {
  const match = str.match(/url\(\s*(?:'([^']*)'|"([^"]*)"|([^)]*))\s*\)/i);
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? match[3] ?? '';
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

/** Split top-level comma-separated CSS background layers (respecting parens and quotes). */
function splitCssLayers(value: string): string[] {
  const layers: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote && value[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

type ExtractedImage =
  | { type: 'string'; url: string }
  | { type: 'expr'; expr: t.Expression };

/** Extract image URL or dynamic expression from an AST property value. */
function extractUrlFromAst(node: t.Node): ExtractedImage | null {
  if (t.isStringLiteral(node)) {
    const raw = extractUrlFromString(node.value);
    if (raw) return { type: 'string', url: raw };
    if (/^(https?:\/\/|\/|data:)/i.test(node.value.trim())) {
      return { type: 'string', url: node.value.trim() };
    }
    return { type: 'string', url: node.value };
  }

  if (t.isTemplateLiteral(node)) {
    // Check if any quasi ends with url( or url(" or url('
    for (let i = 0; i < node.quasis.length; i++) {
      const q = node.quasis[i].value.raw;
      if (/url\(['"]?$/i.test(q.trim())) {
        if (i < node.expressions.length && t.isExpression(node.expressions[i])) {
          return { type: 'expr', expr: t.cloneNode(node.expressions[i] as t.Expression) };
        }
      }
    }
    // Simple template literal like `url(${item.photo})`
    if (node.expressions.length === 1 && node.quasis[0]?.value.raw.toLowerCase().includes('url(')) {
      if (t.isExpression(node.expressions[0])) {
        return { type: 'expr', expr: t.cloneNode(node.expressions[0] as t.Expression) };
      }
    }
    // Static template literal without expressions
    if (node.expressions.length === 0) {
      const fullStr = node.quasis.map((q) => q.value.raw).join('');
      const raw = extractUrlFromString(fullStr);
      if (raw) return { type: 'string', url: raw };
      return { type: 'string', url: fullStr };
    }
    // Otherwise fallback to cloning the whole template literal expression
    return { type: 'expr', expr: t.cloneNode(node) };
  }

  if (t.isIdentifier(node) || t.isMemberExpression(node) || t.isCallExpression(node)) {
    return { type: 'expr', expr: t.cloneNode(node) };
  }

  if (t.isConditionalExpression(node)) {
    const consequent = extractUrlFromAst(node.consequent);
    const alternate = extractUrlFromAst(node.alternate);
    const consExpr: t.Expression =
      consequent?.type === 'expr' ? consequent.expr : t.stringLiteral(consequent?.url ?? '');
    const altExpr: t.Expression =
      alternate?.type === 'expr' ? alternate.expr : t.stringLiteral(alternate?.url ?? '');
    return {
      type: 'expr',
      expr: t.conditionalExpression(t.cloneNode(node.test), consExpr, altExpr),
    };
  }

  return null;
}

/** Get a style object property by name. */
function getStyleProperty(
  styleObj: t.ObjectExpression,
  key: string,
): { prop: t.ObjectProperty; index: number } | null {
  for (let i = 0; i < styleObj.properties.length; i++) {
    const p = styleObj.properties[i];
    if (t.isObjectProperty(p) && !p.computed) {
      const k = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : '';
      if (k === key) return { prop: p, index: i };
    }
  }
  return null;
}

/** Set or update a property in a style ObjectExpression. */
function setStyleProperty(styleObj: t.ObjectExpression, key: string, value: t.Expression): void {
  const existing = getStyleProperty(styleObj, key);
  if (existing) {
    existing.prop.value = value;
  } else {
    styleObj.properties.push(t.objectProperty(t.identifier(key), value));
  }
}

/** Remove a property from a style ObjectExpression by key name. */
function removeStyleProperty(styleObj: t.ObjectExpression, key: string): boolean {
  const existing = getStyleProperty(styleObj, key);
  if (existing) {
    styleObj.properties.splice(existing.index, 1);
    return true;
  }
  return false;
}


/** Set or add an attribute on an opening element (before style if possible). */
function setOrAddAttr(
  opening: t.JSXOpeningElement,
  name: string,
  value: t.JSXAttribute['value'],
): void {
  const existingIdx = opening.attributes.findIndex(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === name,
  );
  if (existingIdx !== -1) {
    (opening.attributes[existingIdx] as t.JSXAttribute).value = value;
    return;
  }
  const newAttr = t.jsxAttribute(t.jsxIdentifier(name), value);
  const styleIdx = opening.attributes.findIndex(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'style',
  );
  if (styleIdx !== -1) {
    opening.attributes.splice(styleIdx, 0, newAttr);
  } else {
    opening.attributes.push(newAttr);
  }
}

/**
 * Convert a div element with a background image to an img element in JSX code.
 *
 * @param code Source JSX/TSX code
 * @param nodeId The data-id of the element to convert
 * @param mode 'replace' (default) replaces the div with an <img> tag; 'nested-background'
 *             retains the container div and inserts an absolute <img> as its first child.
 */
export function convertDivToImageInCode(
  code: string,
  nodeId: string,
  mode: 'replace' | 'nested-background' = 'replace',
): string {
  trace.fn('generator.convertDivToImageInCode', { nodeId, mode });

  const ast = parseJSX(code);
  if (!ast) return code;

  let touched = false;

  findFirstElementByDataId(ast, nodeId, (path, element) => {
    const opening = element.openingElement;

    // Locate style attribute and its ObjectExpression
    const styleAttr = findAttribute(opening, 'style');
    let styleObj: t.ObjectExpression;
    if (
      styleAttr &&
      styleAttr.value?.type === 'JSXExpressionContainer' &&
      t.isObjectExpression(styleAttr.value.expression)
    ) {
      styleObj = styleAttr.value.expression;
    } else {
      styleObj = t.objectExpression([]);
      if (!styleAttr) {
        opening.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(styleObj)),
        );
      } else {
        styleAttr.value = t.jsxExpressionContainer(styleObj);
      }
    }

    // Locate background image / background property (or backgroundColor if containing url)
    const bgImageProp = getStyleProperty(styleObj, 'backgroundImage');
    const bgProp = getStyleProperty(styleObj, 'background');
    const bgColorProp = getStyleProperty(styleObj, 'backgroundColor');
    const targetBg =
      bgImageProp ??
      bgProp ??
      (bgColorProp &&
      (t.isTemplateLiteral(bgColorProp.prop.value) ||
        (t.isStringLiteral(bgColorProp.prop.value) &&
          bgColorProp.prop.value.value.includes('url(')))
        ? bgColorProp
        : null);

    // In nested-background mode, check if already converted
    if (mode === 'nested-background') {
      const alreadyHasChildImg = element.children.some(
        (c) =>
          t.isJSXElement(c) &&
          c.openingElement.attributes.some(
            (a) =>
              t.isJSXAttribute(a) &&
              t.isJSXIdentifier(a.name) &&
              a.name.name === 'data-id' &&
              t.isStringLiteral(a.value) &&
              a.value.value === `${nodeId}-img`,
          ),
      );
      if (alreadyHasChildImg && !targetBg) {
        // Already converted in nested mode and no new background to extract
        path.stop();
        return;
      }
    }

    // Extract image URL or dynamic expression
    let extracted: ExtractedImage | null = null;
    let isMultiLayer = false;
    let remainingGradientStr: string | null = null;

    if (targetBg) {
      const val = targetBg.prop.value;
      if (t.isStringLiteral(val)) {
        const layers = splitCssLayers(val.value);
        const urlLayers = layers.filter((l) => /url\(/i.test(l));
        const nonUrlLayers = layers.filter((l) => !/url\(/i.test(l));
        if (urlLayers.length > 0) {
          const u = extractUrlFromString(urlLayers[0]);
          if (u) extracted = { type: 'string', url: u };
        }
        if (nonUrlLayers.length > 0) {
          isMultiLayer = true;
          remainingGradientStr = nonUrlLayers.join(', ');
        }
      } else {
        extracted = extractUrlFromAst(val);
      }
    }

    // Read backgroundSize and backgroundPosition before clearing
    const bgSizeProp = getStyleProperty(styleObj, 'backgroundSize');
    const bgPosProp = getStyleProperty(styleObj, 'backgroundPosition');

    const objectFitExpr: t.Expression = bgSizeProp
      ? (t.cloneNode(bgSizeProp.prop.value) as t.Expression)
      : t.stringLiteral('cover');

    const objectPositionExpr: t.Expression = bgPosProp
      ? (t.cloneNode(bgPosProp.prop.value) as t.Expression)
      : t.stringLiteral('center');

    if (mode === 'nested-background') {
      // ─── NESTED BACKGROUND MODE ──────────────────────────────────────────────
      // 1. Container background cleanup
      if (isMultiLayer && remainingGradientStr && targetBg) {
        targetBg.prop.value = t.stringLiteral(remainingGradientStr);
      } else {
        removeStyleProperty(styleObj, 'backgroundImage');
        if (bgProp && extracted) {
          removeStyleProperty(styleObj, 'background');
        }
        removeStyleProperty(styleObj, 'backgroundRepeat');
        removeStyleProperty(styleObj, 'backgroundSize');
        removeStyleProperty(styleObj, 'backgroundPosition');
      }

      // 2. Container position & overflow
      const posProp = getStyleProperty(styleObj, 'position');
      if (!posProp) {
        setStyleProperty(styleObj, 'position', t.stringLiteral('relative'));
      } else if (t.isStringLiteral(posProp.prop.value)) {
        const v = posProp.prop.value.value;
        if (v !== 'absolute' && v !== 'fixed' && v !== 'relative' && v !== 'sticky') {
          posProp.prop.value = t.stringLiteral('relative');
        }
      }
      setStyleProperty(styleObj, 'overflow', t.stringLiteral('hidden'));

      // 3. Child <img> element styles:
      // style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
      //          objectFit: ..., objectPosition: ..., pointerEvents: 'none', zIndex: 0 }}
      const childStyleObj = t.objectExpression([
        t.objectProperty(t.identifier('position'), t.stringLiteral('absolute')),
        t.objectProperty(t.identifier('inset'), t.numericLiteral(0)),
        t.objectProperty(t.identifier('width'), t.stringLiteral('100%')),
        t.objectProperty(t.identifier('height'), t.stringLiteral('100%')),
        t.objectProperty(t.identifier('objectFit'), objectFitExpr),
        t.objectProperty(t.identifier('objectPosition'), objectPositionExpr),
        t.objectProperty(t.identifier('pointerEvents'), t.stringLiteral('none')),
        t.objectProperty(t.identifier('zIndex'), t.numericLiteral(0)),
      ]);

      const childAttrs: t.JSXAttribute[] = [
        t.jsxAttribute(t.jsxIdentifier('data-id'), t.stringLiteral(`${nodeId}-img`)),
        t.jsxAttribute(t.jsxIdentifier('data-name'), t.stringLiteral('Background Image')),
      ];

      if (extracted?.type === 'expr') {
        childAttrs.push(
          t.jsxAttribute(t.jsxIdentifier('src'), t.jsxExpressionContainer(extracted.expr)),
        );
      } else {
        const srcVal = extracted?.url ?? '';
        childAttrs.push(t.jsxAttribute(t.jsxIdentifier('src'), t.stringLiteral(srcVal)));
      }

      childAttrs.push(t.jsxAttribute(t.jsxIdentifier('alt'), t.stringLiteral('')));
      childAttrs.push(t.jsxAttribute(t.jsxIdentifier('loading'), t.stringLiteral('lazy')));
      childAttrs.push(t.jsxAttribute(t.jsxIdentifier('decoding'), t.stringLiteral('async')));
      childAttrs.push(
        t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(childStyleObj)),
      );

      const childImg = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier('img'), childAttrs, /* selfClosing */ true),
        null,
        [],
        /* selfClosing */ true,
      );

      // Check if child img already exists (idempotence)
      const existingChildIdx = element.children.findIndex(
        (c) =>
          t.isJSXElement(c) &&
          c.openingElement.attributes.some(
            (a) =>
              t.isJSXAttribute(a) &&
              t.isJSXIdentifier(a.name) &&
              a.name.name === 'data-id' &&
              t.isStringLiteral(a.value) &&
              a.value.value === `${nodeId}-img`,
          ),
      );

      if (existingChildIdx !== -1) {
        element.children[existingChildIdx] = childImg;
      } else {
        if (opening.selfClosing) {
          opening.selfClosing = false;
          element.closingElement = t.jsxClosingElement(t.cloneNode(opening.name));
          element.children = [childImg];
        } else {
          element.children.unshift(childImg);
        }
      }

      touched = true;
    } else {
      // ─── REPLACE MODE ────────────────────────────────────────────────────────
      // 1. Tag name update (div -> img, motion.div -> motion.img)
      if (t.isJSXMemberExpression(opening.name)) {
        if (t.isJSXIdentifier(opening.name.object) && opening.name.object.name === 'motion') {
          opening.name.property = t.jsxIdentifier('img');
        }
      } else if (t.isJSXIdentifier(opening.name)) {
        opening.name = t.jsxIdentifier('img');
      }

      // Convert to self-closing
      opening.selfClosing = true;
      element.closingElement = null;
      element.children = [];

      // 2. Attributes: src, alt, loading, decoding
      if (extracted?.type === 'expr') {
        setOrAddAttr(opening, 'src', t.jsxExpressionContainer(extracted.expr));
      } else {
        const srcVal = extracted?.url ?? '';
        setOrAddAttr(opening, 'src', t.stringLiteral(srcVal));
      }

      // Strip any leftover srcSet or sizes attribute
      opening.attributes = opening.attributes.filter(
        (a) =>
          !(
            t.isJSXAttribute(a) &&
            t.isJSXIdentifier(a.name) &&
            (a.name.name.toLowerCase() === 'srcset' || a.name.name.toLowerCase() === 'sizes')
          ),
      );

      const hasAlt = opening.attributes.some(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'alt',
      );
      if (!hasAlt) {
        setOrAddAttr(opening, 'alt', t.stringLiteral(''));
      }

      setOrAddAttr(opening, 'loading', t.stringLiteral('lazy'));
      setOrAddAttr(opening, 'decoding', t.stringLiteral('async'));

      // 3. Style cleanup and translation
      removeStyleProperty(styleObj, 'backgroundImage');
      if (bgProp && extracted) {
        removeStyleProperty(styleObj, 'background');
      }
      if (bgColorProp && targetBg === bgColorProp) {
        removeStyleProperty(styleObj, 'backgroundColor');
      }
      removeStyleProperty(styleObj, 'backgroundRepeat');
      removeStyleProperty(styleObj, 'backgroundSize');
      removeStyleProperty(styleObj, 'backgroundPosition');

      setStyleProperty(styleObj, 'objectFit', objectFitExpr);
      setStyleProperty(styleObj, 'objectPosition', objectPositionExpr);
      setStyleProperty(styleObj, 'display', t.stringLiteral('block'));

      touched = true;
    }

    path.stop();
  });

  if (!touched) return code;

  try {
    return generate(ast, { retainLines: false, concise: false }, code).code;
  } catch (err) {
    trace.error(
      'generator.convertDivToImageInCode:generate-failed',
      err instanceof Error ? err.message : String(err),
    );
    return code;
  }
}
