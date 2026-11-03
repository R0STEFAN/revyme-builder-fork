// heal-data-ids.ts — self-heal JSX that lost its `data-id`.
//
// A component-instance tag without `data-id` gets a parse-time `auto_<n>` id
// that exists NOWHERE in the source — so every mutation that targets it
// (drag-out move, prop write, style write) silently no-ops: the imperative
// cache updates (layers show the change), then the next parse rebuilds from
// the unchanged code and everything snaps back (user report 2026-07-30:
// ZaPoKa dragged to canvas reverted on the next drag). Real-world source ends
// up in this state via attribute corruption (a `data-id="X"` split into a
// bare `data-` + `id="X"` was found in the wild) or hand-edited/AI code.
//
// The heal runs when a file becomes ACTIVE: every PascalCase instance tag
// missing `data-id` gets a freshly generated one (same `<Tag>-<gen>` shape
// the creators use), and corrupted bare `data-` attributes (`data-="true"`,
// `data- `) inside those tags are stripped. Wrapper tags that the parser
// treats as transparent (LayoutGroup / MotionConfig / AnimatePresence) are
// skipped — they never carry node ids. Lowercase tags are left alone: every
// builder flow stamps ids on those at creation, and blanket-stamping text
// spans / style tags would be wrong.

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { generateNodeId } from '@/shared/id-utils';
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { needsDataId, jsxTagName } from '@/code/oracle/checks/shared';
import { findTagClose } from '@/code/generation/generator-utils';
import { trace } from '@/shared/debug-trace';
import { PARSER_TRANSPARENT_TAGS } from './transparent-tags';

/** Parser-transparent wrappers — never node-bearing, never healed. A data-id
 *  that an earlier heal DID stamp on one (RevymeSplitText joined the list on
 *  2026-09-09) is stripped again: it is junk that made the forced-render
 *  integrity guard skip every render on the page. */
const TRANSPARENT_TAGS = PARSER_TRANSPARENT_TAGS;
const STAMPED_ID_RE = / data-id="[^"]*"/;

/** Attributes literally named `data-` — corruption remnants, never legitimate. */
const JUNK_ATTR_RE = / data-(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?(?=[\s/>])/g;

export function healMissingInstanceDataIds(code: string): { code: string; healed: number; strippedJunk: number } {
  let healed = 0;
  let strippedJunk = 0;
  let out = code;
  let searchFrom = 0;

  const TAG_RE = /<([A-Z][A-Za-z0-9]*)\b/g;
  // Re-scan from the current position after each edit (offsets shift).
  for (;;) {
    TAG_RE.lastIndex = searchFrom;
    const m = TAG_RE.exec(out);
    if (!m) break;
    const tagName = m[1];
    const tagStart = m.index;
    if (TRANSPARENT_TAGS.has(tagName)) {
      const tEnd = findTagClose(out, tagStart);
      if (tEnd !== -1) {
        const tc = out.slice(tagStart, tEnd + 1);
        if (STAMPED_ID_RE.test(tc)) {
          const cleaned = tc.replace(STAMPED_ID_RE, '');
          out = out.slice(0, tagStart) + cleaned + out.slice(tEnd + 1);
          strippedJunk++;
        }
      }
      searchFrom = tagStart + 1 + tagName.length;
      continue;
    }
    // The MotionLink declaration renders `<Link>`/`<div>` in its own body —
    // module scaffolding, never node-bearing. Stamping a data-id into it
    // (2026-08-26) mutated the canonical declaration line. The declaration
    // is single-line by construction, so "the tag's line starts the decl"
    // is a precise skip.
    {
      const lineStart = out.lastIndexOf('\n', tagStart) + 1;
      if (/^\s*const\s+MotionLink\s*=\s*motion\.create\(/.test(out.slice(lineStart, tagStart))) {
        searchFrom = tagStart + 1 + tagName.length;
        continue;
      }
    }
    const tagEnd = findTagClose(out, tagStart);
    if (tagEnd === -1) { searchFrom = tagStart + 1 + tagName.length; continue; }

    let tagContent = out.slice(tagStart, tagEnd + 1);

    // 1. Strip corrupted bare `data-` attributes inside this tag.
    const junkMatches = tagContent.match(JUNK_ATTR_RE);
    if (junkMatches && junkMatches.length > 0) {
      tagContent = tagContent.replace(JUNK_ATTR_RE, '');
      strippedJunk += junkMatches.length;
    }

    // 2. Stamp a data-id when missing. ` data-id="` with the attr-boundary
    //    space so `[data-id=` selectors in strings can't false-positive.
    if (!/ data-id="/.test(tagContent)) {
      const newId = generateNodeId(tagName);
      tagContent = `<${tagName} data-id="${newId}"` + tagContent.slice(1 + tagName.length);
      healed++;
    }

    if (tagContent !== out.slice(tagStart, tagEnd + 1)) {
      out = out.slice(0, tagStart) + tagContent + out.slice(tagEnd + 1);
    }
    searchFrom = tagStart + tagContent.length;
  }

  if (healed > 0 || strippedJunk > 0) {
    trace.action('heal-data-ids:healed', { healed, strippedJunk });
  }
  return { code: out, healed, strippedJunk };
}

export interface AutoInjectDataIdsOptions {
  isPage?: boolean;
}

function getTagPrefix(tag: string): string {
  const base = tag.startsWith('motion.') ? tag.slice('motion.'.length) : tag;
  const lower = base.toLowerCase();
  if (lower === 'button') return 'btn';
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].includes(lower)) return 'text';
  if (lower === 'section') return 'section';
  if (lower === 'header' || lower === 'nav') return 'nav';
  if (lower === 'footer') return 'footer';
  if (lower === 'img' || lower === 'image') return 'img';
  if (lower === 'a') return 'link';
  return lower.replace(/[^a-z0-9_-]/g, '') || 'frame';
}

/**
 * Automatically inject missing `data-id` attributes on all JSX elements that need them.
 * Preserves existing formatting, comments, and whitespace by applying string insertions
 * at exact AST token offsets.
 */
export function autoInjectMissingDataIds(
  code: string,
  options: AutoInjectDataIdsOptions = {}
): { code: string; injectedCount: number } {
  let ast: t.File | null = null;
  try {
    ast = parseJSX(code);
  } catch {
    return { code, injectedCount: 0 };
  }
  if (!ast) return { code, injectedCount: 0 };

  const insertions: Array<{ pos: number; text: string }> = [];
  let hasRootId = false;
  let rootCandidateOpening: any = null;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const opening = path.node.openingElement;
      const tag = jsxTagName(opening.name);
      const attrs = opening.attributes;

      const dataIdAttr = attrs.find(
        (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'data-id'
      );

      if (dataIdAttr && t.isStringLiteral(dataIdAttr.value) && dataIdAttr.value.value === 'root') {
        hasRootId = true;
      }

      if (!dataIdAttr && needsDataId(tag, path)) {
        const isOutermost = path.findParent((p) => p.isJSXElement()) == null;
        if (options.isPage && isOutermost && !hasRootId && !rootCandidateOpening) {
          rootCandidateOpening = opening;
        } else if (typeof opening.name.end === 'number') {
          const prefix = getTagPrefix(tag);
          const newId = generateNodeId(prefix);
          insertions.push({ pos: opening.name.end, text: ` data-id="${newId}"` });
        }
      }
    },
  });

  if (options.isPage && rootCandidateOpening && typeof rootCandidateOpening.name.end === 'number') {
    const rootId = hasRootId ? generateNodeId('frame') : 'root';
    insertions.push({ pos: rootCandidateOpening.name.end, text: ` data-id="${rootId}"` });
  }

  if (insertions.length === 0) {
    return { code, injectedCount: 0 };
  }

  // Sort descending by position so insertions don't alter earlier offsets
  insertions.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const ins of insertions) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }

  trace.action('heal-data-ids:auto-injected', { count: insertions.length });
  return { code: out, injectedCount: insertions.length };
}
