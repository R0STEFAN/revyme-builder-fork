// expression-gen.ts — Code generator for dynamic text expressions and dynamic URLs (links).
// Pure string transforms: code in → code out.

import { trace } from '@/shared/debug-trace';
import { parse } from '@babel/parser';
import {
  findTagClose,
  findMatchingCloseTagIndex,
  insertAfterLastImportLine,
} from './generator-utils';
import { findJSXElementByDataId, findClosingTag, insertConstIntoEnclosingFn } from './cms-gen';

/**
 * Check if an element is located at module scope (e.g. inside `const canvasNodes = (<>...</>)`
 * or hoisted slot root `const cn_... = ...`) outside the `Page` or component function body.
 */
export function isNodeInModuleScope(code: string, nodeId: string): boolean {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) return false;

  const canvasNodesStart = code.indexOf('const canvasNodes');
  if (canvasNodesStart !== -1 && elStart > canvasNodesStart) {
    return true;
  }

  try {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    let inFn = false;
    let found = false;

    const walk = (node: any, currentInFn: boolean) => {
      if (!node || typeof node !== 'object') return;
      const isFn = node.type === 'FunctionDeclaration' ||
                   node.type === 'FunctionExpression' ||
                   node.type === 'ArrowFunctionExpression';
      const nextInFn = currentInFn || isFn;

      if (node.type === 'JSXOpeningElement') {
        const idAttr = node.attributes?.find(
          (a: any) => a.type === 'JSXAttribute' && a.name?.name === 'data-id' && a.value?.value === nodeId
        );
        if (idAttr) {
          inFn = nextInFn;
          found = true;
          return;
        }
      }

      for (const k of Object.keys(node)) {
        if (k === 'loc' || found) continue;
        const child = node[k];
        if (Array.isArray(child)) {
          for (const c of child) {
            walk(c, nextInFn);
            if (found) return;
          }
        } else if (child && typeof child === 'object') {
          walk(child, nextInFn);
          if (found) return;
        }
      }
    };

    walk(ast.program, false);
    if (found) return !inFn;
  } catch {
    // Fallback to position check
  }

  return canvasNodesStart !== -1 && elStart > canvasNodesStart;
}

/**
 * Ensure `useParams` from `next/navigation` is imported and called if expression references `params`.
 */
function ensureParamsHookIfUsed(code: string, nodeId: string, expression: string): string {
  if (!/\bparams\b/.test(expression)) return code;
  let result = code;
  if (!result.includes('useParams') || !result.includes("from 'next/navigation'")) {
    result = insertAfterLastImportLine(result, "import { useParams } from 'next/navigation';") ?? `import { useParams } from 'next/navigation';\n${result}`;
  }
  if (!/const\s+params\s*=\s*useParams\(\)/.test(result)) {
    result = insertConstIntoEnclosingFn(result, nodeId, 'const params = useParams();');
  }
  return result;
}

/**
 * Bind a text expression: replaces element's text content with `{expression}`.
 */
export function bindTextExpressionInCode(code: string, nodeId: string, expression: string): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) {
    trace.error('expression-gen:bindTextExpression', { message: 'Element not found', nodeId });
    return code;
  }

  const cleanExpr = expression.trim();

  // Module scope protection (Defect #21): if node is outside component scope (e.g. in canvasNodes)
  // and references item, do not inject live item that crashes module compilation.
  if (isNodeInModuleScope(code, nodeId) && /\bitem\b/.test(cleanExpr)) {
    const openTagEnd = findTagClose(code, elStart + 1);
    if (openTagEnd !== -1) {
      const tagSlice = code.slice(elStart, openTagEnd + 1);
      const strippedTag = stripAttrFromTag(tagSlice, 'data-dormant-text');
      const bindingAttr = `data-dormant-text="${cleanExpr.replace(/"/g, '&quot;')}"`;
      let newTagSlice: string;
      const insertIdx = strippedTag.length - 1;
      const closingChar = strippedTag[insertIdx];
      if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
        newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${bindingAttr} />`;
      } else {
        newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${bindingAttr}>`;
      }
      let result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
      const updatedClosing = findClosingTag(result, elStart);
      if (updatedClosing) {
        result = result.slice(0, updatedClosing.contentStart) + 'Text' + result.slice(updatedClosing.closeTagStart);
      }
      trace.action('expression-gen:bindTextExpression:dormant', { nodeId, expression: cleanExpr });
      return result;
    }
  }

  const closing = findClosingTag(code, elStart);
  if (!closing) {
    trace.error('expression-gen:bindTextExpression', { message: 'Cannot find closing tag', nodeId });
    return code;
  }

  const binding = `{${cleanExpr}}`;
  let result = code.slice(0, closing.contentStart) + binding + code.slice(closing.closeTagStart);
  result = ensureParamsHookIfUsed(result, nodeId, cleanExpr);

  trace.action('expression-gen:bindTextExpression:done', { nodeId, expression: cleanExpr });
  return result;
}

export function stripAttrFromTag(tag: string, attrName: string): string {
  const m = tag.match(new RegExp(`\\s+${attrName}=`));
  if (!m || m.index === undefined) return tag;
  const start = m.index;
  const valStart = start + m[0].length;
  const ch = tag[valStart];
  let end: number;
  if (ch === '"' || ch === "'") {
    end = tag.indexOf(ch, valStart + 1);
    if (end === -1) return tag;
    end += 1;
  } else if (ch === '{') {
    let depth = 0;
    end = valStart;
    for (; end < tag.length; end++) {
      if (tag[end] === '{') depth++;
      else if (tag[end] === '}' && --depth === 0) { end++; break; }
    }
  } else {
    const spaceIdx = tag.indexOf(' ', valStart);
    const closeIdx = tag.indexOf('>', valStart);
    end = (spaceIdx !== -1 && spaceIdx < closeIdx) ? spaceIdx : closeIdx;
    if (end === -1) end = tag.length;
  }
  return tag.slice(0, start) + tag.slice(end);
}

function stripHrefFromTag(tag: string): string {
  return stripAttrFromTag(tag, 'href');
}

/**
 * Bind an href expression: replaces or adds `href={expression}` on the element.
 */
export function bindHrefExpressionInCode(code: string, nodeId: string, expression: string): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) {
    trace.error('expression-gen:bindHrefExpression', { message: 'Element not found', nodeId });
    return code;
  }

  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd === -1) {
    trace.error('expression-gen:bindHrefExpression', { message: 'Cannot find tag close', nodeId });
    return code;
  }

  const tagSlice = code.slice(elStart, openTagEnd + 1);
  const cleanExpr = expression.trim();

  // Module scope protection (Defect #21): if node is outside component scope (e.g. in canvasNodes)
  // and references item, do not inject live item that crashes module compilation.
  if (isNodeInModuleScope(code, nodeId) && /\bitem\b/.test(cleanExpr)) {
    const strippedTag = stripAttrFromTag(stripHrefFromTag(tagSlice), 'data-dormant-href');
    const escaped = cleanExpr.replace(/"/g, '&quot;');
    const binding = `href="#" data-dormant-href="${escaped}"`;
    let newTagSlice: string;
    const insertIdx = strippedTag.length - 1;
    const closingChar = strippedTag[insertIdx];
    if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
      newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${binding} />`;
    } else {
      newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${binding}>`;
    }
    const result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
    trace.action('expression-gen:bindHrefExpression:dormant', { nodeId, expression: cleanExpr });
    return result;
  }

  const binding = `href={${cleanExpr}}`;

  const strippedTag = stripAttrFromTag(stripHrefFromTag(tagSlice), 'data-dormant-href');
  let newTagSlice: string;
  const insertIdx = strippedTag.length - 1;
  const closingChar = strippedTag[insertIdx];
  if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
    newTagSlice = strippedTag.slice(0, insertIdx - 1) + ` ${binding} />`;
  } else {
    newTagSlice = strippedTag.slice(0, insertIdx) + ` ${binding}>`;
  }

  let result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
  result = ensureParamsHookIfUsed(result, nodeId, cleanExpr);

  trace.action('expression-gen:bindHrefExpression:done', { nodeId, expression: cleanExpr });
  return result;
}

/**
 * Unbind a text expression: replaces element's `{expression}` text content with a static string.
 */
export function unbindTextExpressionInCode(code: string, nodeId: string, fallbackText = 'Text'): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) return code;

  // Strip data-dormant-text if present on opening tag
  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd !== -1) {
    const tagSlice = code.slice(elStart, openTagEnd + 1);
    const strippedTag = stripAttrFromTag(tagSlice, 'data-dormant-text');
    if (strippedTag !== tagSlice) {
      code = code.slice(0, elStart) + strippedTag + code.slice(openTagEnd + 1);
    }
  }

  const closing = findClosingTag(code, elStart);
  if (!closing) return code;

  const result = code.slice(0, closing.contentStart) + fallbackText + code.slice(closing.closeTagStart);
  trace.action('expression-gen:unbindTextExpression:done', { nodeId });
  return result;
}

/**
 * Unbind an href expression: replaces `href={expression}` with a static `href="..."`.
 */
export function unbindHrefExpressionInCode(code: string, nodeId: string, fallbackHref = '#'): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) return code;

  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd === -1) return code;

  const tagSlice = code.slice(elStart, openTagEnd + 1);
  const strippedTag = stripAttrFromTag(stripHrefFromTag(tagSlice), 'data-dormant-href');
  if (strippedTag === tagSlice) return code;

  const binding = `href="${fallbackHref}"`;
  let newTagSlice: string;
  const insertIdx = strippedTag.length - 1;
  const closingChar = strippedTag[insertIdx];
  if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
    newTagSlice = strippedTag.slice(0, insertIdx - 1) + ` ${binding} />`;
  } else {
    newTagSlice = strippedTag.slice(0, insertIdx) + ` ${binding}>`;
  }

  const result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
  trace.action('expression-gen:unbindHrefExpression:done', { nodeId });
  return result;
}

/**
 * Bind an image src expression: replaces or adds `src={expression}` on the element.
 */
export function bindSrcExpressionInCode(code: string, nodeId: string, expression: string): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) {
    trace.error('expression-gen:bindSrcExpression', { message: 'Element not found', nodeId });
    return code;
  }

  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd === -1) {
    trace.error('expression-gen:bindSrcExpression', { message: 'Cannot find tag close', nodeId });
    return code;
  }

  const tagSlice = code.slice(elStart, openTagEnd + 1);
  const cleanExpr = expression.trim();

  // Module scope protection (Defect #21): if node is outside component scope (e.g. in canvasNodes)
  // and references item, do not inject live item that crashes module compilation.
  if (isNodeInModuleScope(code, nodeId) && /\bitem\b/.test(cleanExpr)) {
    const strippedTag = stripAttrFromTag(stripAttrFromTag(tagSlice, 'src'), 'data-dormant-src');
    const escaped = cleanExpr.replace(/"/g, '&quot;');
    const binding = `src="" data-dormant-src="${escaped}"`;
    let newTagSlice: string;
    const insertIdx = strippedTag.length - 1;
    const closingChar = strippedTag[insertIdx];
    if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
      newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${binding} />`;
    } else {
      newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${binding}>`;
    }
    const result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
    trace.action('expression-gen:bindSrcExpression:dormant', { nodeId, expression: cleanExpr });
    return result;
  }

  const binding = `src={${cleanExpr}}`;

  const strippedTag = stripAttrFromTag(stripAttrFromTag(tagSlice, 'src'), 'data-dormant-src');
  let newTagSlice: string;
  const insertIdx = strippedTag.length - 1;
  const closingChar = strippedTag[insertIdx];
  if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
    newTagSlice = strippedTag.slice(0, insertIdx - 1) + ` ${binding} />`;
  } else {
    newTagSlice = strippedTag.slice(0, insertIdx) + ` ${binding}>`;
  }

  let result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
  result = ensureParamsHookIfUsed(result, nodeId, cleanExpr);

  trace.action('expression-gen:bindSrcExpression:done', { nodeId, expression: cleanExpr });
  return result;
}

/**
 * Unbind an image src expression: replaces `src={expression}` with a static `src="..."`.
 */
export function unbindSrcExpressionInCode(code: string, nodeId: string, fallbackSrc = ''): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) return code;

  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd === -1) return code;

  const tagSlice = code.slice(elStart, openTagEnd + 1);
  const strippedTag = stripAttrFromTag(stripAttrFromTag(tagSlice, 'src'), 'data-dormant-src');
  if (strippedTag === tagSlice) return code;

  let newTagSlice: string;
  if (!fallbackSrc) {
    newTagSlice = strippedTag;
  } else {
    const binding = `src="${fallbackSrc}"`;
    const insertIdx = strippedTag.length - 1;
    const closingChar = strippedTag[insertIdx];
    if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
      newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${binding} />`;
    } else {
      newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${binding}>`;
    }
  }

  const result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
  trace.action('expression-gen:unbindSrcExpression:done', { nodeId });
  return result;
}

/**
 * Bind an aria-label expression: replaces or adds `aria-label={expression}` on the element.
 */
export function bindAriaLabelExpressionInCode(code: string, nodeId: string, expression: string): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) {
    trace.error('expression-gen:bindAriaLabelExpression', { message: 'Element not found', nodeId });
    return code;
  }

  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd === -1) {
    trace.error('expression-gen:bindAriaLabelExpression', { message: 'Cannot find tag close', nodeId });
    return code;
  }

  const tagSlice = code.slice(elStart, openTagEnd + 1);
  const cleanExpr = expression.trim();

  // Module scope protection (Defect #21): if node is outside component scope (e.g. in canvasNodes)
  // and references item, do not inject live item that crashes module compilation.
  if (isNodeInModuleScope(code, nodeId) && /\bitem\b/.test(cleanExpr)) {
    const strippedTag = stripAttrFromTag(stripAttrFromTag(tagSlice, 'aria-label'), 'data-dormant-aria-label');
    const escaped = cleanExpr.replace(/"/g, '&quot;');
    const binding = `aria-label="" data-dormant-aria-label="${escaped}"`;
    let newTagSlice: string;
    const insertIdx = strippedTag.length - 1;
    const closingChar = strippedTag[insertIdx];
    if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
      newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${binding} />`;
    } else {
      newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${binding}>`;
    }
    const result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
    trace.action('expression-gen:bindAriaLabelExpression:dormant', { nodeId, expression: cleanExpr });
    return result;
  }

  const binding = `aria-label={${cleanExpr}}`;

  const strippedTag = stripAttrFromTag(stripAttrFromTag(tagSlice, 'aria-label'), 'data-dormant-aria-label');
  let newTagSlice: string;
  const insertIdx = strippedTag.length - 1;
  const closingChar = strippedTag[insertIdx];
  if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
    newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${binding} />`;
  } else {
    newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${binding}>`;
  }

  let result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
  result = ensureParamsHookIfUsed(result, nodeId, cleanExpr);

  trace.action('expression-gen:bindAriaLabelExpression:done', { nodeId, expression: cleanExpr });
  return result;
}

/**
 * Unbind an aria-label expression: replaces `aria-label={expression}` with a static `aria-label="..."` (or removes it if fallback is empty).
 */
export function unbindAriaLabelExpressionInCode(code: string, nodeId: string, fallbackAriaLabel = ''): string {
  const elStart = findJSXElementByDataId(code, nodeId);
  if (elStart === -1) return code;

  const openTagEnd = findTagClose(code, elStart + 1);
  if (openTagEnd === -1) return code;

  const tagSlice = code.slice(elStart, openTagEnd + 1);
  const strippedTag = stripAttrFromTag(stripAttrFromTag(tagSlice, 'aria-label'), 'data-dormant-aria-label');
  if (strippedTag === tagSlice) return code;

  let newTagSlice: string;
  if (!fallbackAriaLabel) {
    newTagSlice = strippedTag;
  } else {
    const binding = `aria-label="${fallbackAriaLabel}"`;
    const insertIdx = strippedTag.length - 1;
    const closingChar = strippedTag[insertIdx];
    if (closingChar === '>' && strippedTag[insertIdx - 1] === '/') {
      newTagSlice = strippedTag.slice(0, insertIdx - 1).trimEnd() + ` ${binding} />`;
    } else {
      newTagSlice = strippedTag.slice(0, insertIdx).trimEnd() + ` ${binding}>`;
    }
  }

  const result = code.slice(0, elStart) + newTagSlice + code.slice(openTagEnd + 1);
  trace.action('expression-gen:unbindAriaLabelExpression:done', { nodeId });
  return result;
}
