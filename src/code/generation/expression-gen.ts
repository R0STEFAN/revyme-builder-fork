// expression-gen.ts — Code generator for dynamic text expressions and dynamic URLs (links).
// Pure string transforms: code in → code out.

import { trace } from '@/shared/debug-trace';
import {
  findTagClose,
  findMatchingCloseTagIndex,
  insertAfterLastImportLine,
} from './generator-utils';
import { findJSXElementByDataId, findClosingTag, insertConstIntoEnclosingFn } from './cms-gen';

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

  const closing = findClosingTag(code, elStart);
  if (!closing) {
    trace.error('expression-gen:bindTextExpression', { message: 'Cannot find closing tag', nodeId });
    return code;
  }

  const cleanExpr = expression.trim();
  const binding = `{${cleanExpr}}`;
  let result = code.slice(0, closing.contentStart) + binding + code.slice(closing.closeTagStart);
  result = ensureParamsHookIfUsed(result, nodeId, cleanExpr);

  trace.action('expression-gen:bindTextExpression:done', { nodeId, expression: cleanExpr });
  return result;
}

function stripHrefFromTag(tag: string): string {
  const m = tag.match(/\s+href=/);
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
  const binding = `href={${cleanExpr}}`;

  const strippedTag = stripHrefFromTag(tagSlice);
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
  const strippedTag = stripHrefFromTag(tagSlice);
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
