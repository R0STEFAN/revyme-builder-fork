// cms-pagination-gen.ts — Collection List pagination (Load More / Infinite Scroll).
//
// Deploy-correct PLAIN REACT: a `visibleCount` useState drives `.slice(0, visibleCount)`
// on the list; a Load More button (or an IntersectionObserver sentinel) bumps it. The
// connection is purely that shared state var — no special component/event type (see the
// brainstorm in project_collection_list_pagination memory). A `data-pagination`
// attribute on the list container is the round-trip marker the parser reads back.
//
// Source = deploy reality: useState/useRef/useEffect are emitted into the page function
// body; `syncImports` (mutation flush) pulls in the React hook imports.

import { trace } from '@/shared/debug-trace';
import { escapeRegExp } from '@/shared/regex-utils';
import { projectFS } from '../project/project-fs';
import { findTagClose, insertAfterLastImportLine, ensureNamedImport } from './generator-utils';
import {
  findJSXElementByDataId,
  findClosingTag,
  COLLECTION_MAP_CALL_RE,
  extractCollectionSlug,
  findCollectionChainHead,
} from './cms-gen';
import { insertConstIntoEnclosingFn, listConfigVar } from './cms-responsive-gen';
import { ensureTextNodeNowrap } from './label-nowrap';
import { getApiCollection } from '../project/cms-api-config';

export type PaginationMode = 'loadMore' | 'infinite';

/** The shared "Load More" component master path + display/internal name. Pagination
 *  (loadMore mode) injects ONE instance of this per list. */
export const LOADMORE_COMPONENT_NAME = 'LoadMore';
const LOADMORE_COMPONENT_PATH = 'components/LoadMore.tsx';

/** The shared "Spinner" component master path + name. Pagination (infinite mode)
 *  injects ONE instance of this per list — a conic-gradient ring loader with a
 *  continuous LOOP rotation (design-tool parity). */
export const SPINNER_COMPONENT_NAME = 'Spinner';
export const SPINNER_COMPONENT_PATH = 'components/Spinner.tsx';

/** The deploy-correct Load More COMPONENT master (design-tool parity). A motion.button
 *  with an EVENT-TYPE prop `onLoadMore` (`@propMeta type:"event"`) fired on click —
 *  the instance supplies `onLoadMore={() => setVisibleCount(c => c + N)}`, so clicking
 *  reveals the next page. Single `default` variant for now; Loading/Hidden variants +
 *  the Loading-State control are a follow-up increment. */
export function buildLoadMoreComponentCode(): string {
  // Structured EXACTLY like a normal Frame + Text master (a motion.div container
  // with a motion.p text child carrying the standard text-node styles) — NOT a
  // button with bare text, which doesn't resolve/render in the component pipeline.
  // The click handler is the event-type prop `onLoadMore` on the container.
  return `'use client';

/** @name "Load More" */
/** @propMeta {"onLoadMore":{"type":"event","label":"Load More"}} */
import React from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

const variantConfig = [{ name: 'default', label: 'Load More', x: 0, y: 0, isPrimary: true }];

function ${LOADMORE_COMPONENT_NAME}({ style, initialVariant = 'default', onLoadMore, ...rest }: { style?: React.CSSProperties; initialVariant?: string; [key: string]: any; }) {
  return <LayoutGroup>
    <motion.div layout={true} data-id="loadmore-root" {...rest} data-name="Load More" onClick={onLoadMore} style={{
      position: 'relative',
      width: 'min-content',
      height: 'min-content',
      padding: '10px 20px',
      backgroundColor: '#1f2937',
      borderRadius: '8px',
      cursor: 'pointer',
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      ...style
    }}>
    <motion.p layout={true} data-id="loadmore-label" data-name="Text" style={{
        fontSize: '14px',
        whiteSpace: 'nowrap',
        color: '#ffffff',
        fontFamily: 'Inter, sans-serif',
        fontWeight: '500',
        lineHeight: '1.2',
        overflowWrap: 'break-word',
        position: 'relative',
        flex: '0 0 auto',
        margin: 0
      }}>
      Load More
    </motion.p>
  </motion.div>
    </LayoutGroup>;
}

export default withResponsiveProps(${LOADMORE_COMPONENT_NAME});
`;
}

/** Deterministic, unique-per-list state var name (`vis<SanitizedId>`). */
export function paginationStateVar(listId: string): string {
  const s = listId.replace(/[^a-zA-Z0-9]/g, '');
  return 'vis' + s.charAt(0).toUpperCase() + s.slice(1);
}

/** Read the `data-pagination="<mode>:<perPage>"` marker off a collection list's
 *  opening tag. Returns null when the list isn't paginated. Used to RE-APPLY
 *  pagination after a source change (so the sentinel guard + IntersectionObserver
 *  `<slug>.length` references regenerate against the NEW slug instead of crashing
 *  on the old one). */
/** Read the `data-pagination="<mode>:<perPage>"` marker off a collection list's
 *  opening tag. Returns null when the list isn't paginated. Used to RE-APPLY
 *  pagination after a source change (so the sentinel guard + IntersectionObserver
 *  `<slug>.length` references regenerate against the NEW slug instead of crashing
 *  on the old one). */
export function readPaginationMarker(
  code: string,
  parentId: string,
): { mode: PaginationMode; perPage: number; isRemote?: boolean } | null {
  const elStart = findJSXElementByDataId(code, parentId);
  if (elStart === -1) return null;
  const tagClose = findTagClose(code, elStart);
  if (tagClose === -1) return null;
  const tagSlice = code.slice(elStart, tagClose);
  const m = /data-pagination="(loadMore|infinite):(\d+)"/.exec(tagSlice);
  if (!m) return null;
  const isRemote = /data-remote-pagination="true"/.test(tagSlice) || /data-query-config=/.test(tagSlice);
  return { mode: m[1] as PaginationMode, perPage: parseInt(m[2], 10), ...(isRemote ? { isRemote: true } : {}) };
}
const setterFor = (v: string) => 'set' + v.charAt(0).toUpperCase() + v.slice(1);

export function toPascalCase(id: string): string {
  const parts = id.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/**
 * Detects whether a collection list is remote (belongs to an API collection or has data-query-config).
 */
export function isRemoteCollectionList(
  code: string,
  parentId: string,
  opts?: { isRemote?: boolean; queryConfig?: any },
  slug?: string,
): boolean {
  if (opts?.isRemote !== undefined) return opts.isRemote;
  if (opts?.queryConfig) return true;
  const elStart = findJSXElementByDataId(code, parentId);
  if (elStart === -1) return false;
  const tagClose = findTagClose(code, elStart);
  if (tagClose === -1) return false;
  const tagSlice = code.slice(elStart, tagClose);
  if (tagSlice.includes('data-query-config') || tagSlice.includes('data-remote-pagination="true"')) return true;
  if (slug) {
    try {
      const col = getApiCollection(slug);
      if (col && col.url) return true;
    } catch {}
  }
  return false;
}

/** Remove ORPHANED pagination hooks — `useState`/`useRef`/`useEffect` for a
 *  `vis*` state var that is no longer SLICED by any `.map()` chain (i.e. its
 *  collection list was deleted, but its body hooks were left behind). Those
 *  orphans keep referencing the deleted list's slug (e.g. `advisors.length`)
 *  which may no longer be imported → "advisors is not defined". A `vis*` var is
 *  LIVE iff some `.slice(0, <var>)` still references it. Idempotent. */
export function pruneOrphanedPaginationHooks(code: string): string {
  let result = code;
  const declRe = /const \[(vis[A-Za-z0-9]+), set[A-Za-z0-9]+\] = useState\([^)]*\);/g;
  const orphans: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(code)) !== null) {
    const stateVar = m[1];
    if (!new RegExp(`\\.slice\\(0,\\s*${stateVar}\\)`).test(code)) orphans.push(stateVar);
  }
  for (const stateVar of orphans) {
    const refVar = stateVar + 'Ref';
    result = result.replace(new RegExp(`\\n?\\s*const \\[${stateVar}, set[A-Za-z0-9]+\\] = useState\\([^)]*\\);`, 'g'), '');
    result = result.replace(new RegExp(`\\n?\\s*const ${refVar} = useRef\\([^)]*\\);`, 'g'), '');
    result = result.replace(new RegExp(`\\n?\\s*useEffect\\(\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${refVar}\\.current[\\s\\S]*?\\}\\s*,\\s*\\[\\]\\s*\\);`, 'g'), '');
    trace.action('cms-pagination:prune-orphan', { stateVar });
  }

  // Remote pagination orphans: itemsVar without any .map() reference
  const remoteDeclRe = /const \[(items[A-Za-z0-9]+), setItems[A-Za-z0-9]+\] = useState\([^)]*\);/g;
  const remoteOrphans: string[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = remoteDeclRe.exec(code)) !== null) {
    const itemsVar = rm[1];
    if (!new RegExp(`\\b${itemsVar}\\b.*\\.map\\(`).test(code)) remoteOrphans.push(itemsVar);
  }
  for (const itemsVar of remoteOrphans) {
    const capitalId = itemsVar.slice('items'.length);
    const parentId = capitalId.charAt(0).toLowerCase() + capitalId.slice(1);
    result = removePaginationInCode(result, parentId);
    trace.action('cms-pagination:prune-remote-orphan', { itemsVar });
  }

  return result;
}

/** Insert a hook line right after the default-export page function's opening brace
 *  (idempotent — skips if the exact line is already present). */
function ensureHook(code: string, parentId: string, hookLine: string): string {
  if (code.includes(hookLine)) return code;
  // Inject at the top of the function body ENCLOSING the list element. Reuses the
  // responsive system's helper so it works for BOTH a page (`export default function
  // Page()`) AND a design-component master (`function Name(...)` + a separate
  // `export default withResponsiveProps(Name)`). The old `export default function`
  // match returned the code UNCHANGED inside a component → the `visX` useState was
  // never declared → `ReferenceError: visX is not defined` at runtime.
  return insertConstIntoEnclosingFn(code, parentId, hookLine);
}

const LOADMORE_IMPORT = `import ${LOADMORE_COMPONENT_NAME} from '@/components/LoadMore';`;

/** Add `import LoadMore from '@/components/LoadMore'` after the last import (idempotent). */
function ensureLoadMoreImport(code: string): string {
  if (code.includes(LOADMORE_IMPORT) || new RegExp(`\\bimport\\s+(?:\\{\\s*${LOADMORE_COMPONENT_NAME}\\s*\\}|${LOADMORE_COMPONENT_NAME})\\s+from`).test(code)) return code;
  return insertAfterLastImportLine(code, LOADMORE_IMPORT) ?? code;
}

/** Remove the LoadMore import — only when NO `<LoadMore` instance remains. */
function pruneLoadMoreImport(code: string): string {
  if (new RegExp(`<${LOADMORE_COMPONENT_NAME}\\b`).test(code)) return code; // still used
  return code.replace(new RegExp(`\\n?${escapeRegExp(LOADMORE_IMPORT)}\\n?`), '\n');
}

/** Write the shared Load More component master to ProjectFS if it doesn't exist yet.
 *  Side-effecting — call from the mutation handler (not the pure code transforms). */
export function ensureLoadMoreComponentFile(): void {
  const existing = projectFS.readFile(LOADMORE_COMPONENT_PATH);
  // Write if absent, OR upgrade an OLD auto-generated version to the current shape.
  // Detection: it's ours (has the loadmore-root data-id) but lacks the current
  // `width: 'min-content'` marker — covers the bare-text button version AND the
  // earlier div+p `width: 'auto'` version (which didn't fit its text). A
  // user-customized component (no loadmore-root) is left untouched.
  const isOldAutoGen = existing != null
    && existing.includes('data-id="loadmore-root"')
    && !existing.includes("width: 'min-content'");
  if (existing != null && !isOldAutoGen) {
    // In-place patch for the current shape (keeps the user's own styling):
    // the root is `width: 'min-content'`, so a label that may wrap collapses
    // to its longest word and "Load More" stacks one word per line. The label
    // never wraps (2026-09-08).
    const patched = ensureLoadMoreLabelNowrap(existing);
    if (patched !== existing) {
      projectFS.writeFile(LOADMORE_COMPONENT_PATH, patched);
      trace.action('cms-pagination:ensureLoadMoreComponentFile', { path: LOADMORE_COMPONENT_PATH, patched: 'label-nowrap' });
    }
    return;
  }
  projectFS.writeFile(LOADMORE_COMPONENT_PATH, buildLoadMoreComponentCode());
  trace.action('cms-pagination:ensureLoadMoreComponentFile', { path: LOADMORE_COMPONENT_PATH, upgraded: isOldAutoGen });
}

/** Load More label never wraps — see label-nowrap.ts. */
export function ensureLoadMoreLabelNowrap(code: string): string {
  return ensureTextNodeNowrap(code, 'loadmore-label');
}

/** The deploy-correct Spinner COMPONENT master (design-tool parity). A conic-gradient
 *  ring (radial-mask cuts the centre so it reads as a ring) with a rounded leading
 *  cap, spun by a continuous framer-motion LOOP (`animate rotate: 360`, infinite
 *  linear). Plain CSS + motion — no external mask asset — so it deploys as-is. */
export function buildSpinnerComponentCode(): string {
  return `'use client';

/** @name "Spinner" */
/* @spinner-gen v4 */
import React from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

const variantConfig = [{ name: 'default', label: 'Spinner', x: 0, y: 0, isPrimary: true }];

function ${SPINNER_COMPONENT_NAME}({ style, initialVariant = 'default', ...rest }: { style?: React.CSSProperties; initialVariant?: string; [key: string]: any; }) {
  return <LayoutGroup>
    <motion.div layout={true} data-id="spinner-root" {...rest} data-name="Spinner" style={{
      position: 'relative',
      width: '20px',
      height: '20px',
      flex: '0 0 auto',
      WebkitMaskImage: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
      maskImage: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
      ...style
    }}>
    <motion.div data-id="spinner-conic" data-name="Conic" animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: 1 }} style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: 'conic-gradient(rgba(153, 153, 153, 0) 18deg, #999999 342deg)'
      }}>
      <motion.div layout={true} data-id="spinner-round" data-name="Round" style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '2px',
          height: '4px',
          borderRadius: '1px',
          backgroundColor: '#999999'
        }}></motion.div>
    </motion.div>
  </motion.div>
    </LayoutGroup>;
}

export default withResponsiveProps(${SPINNER_COMPONENT_NAME});
`;
}

const SPINNER_IMPORT = `import ${SPINNER_COMPONENT_NAME} from '@/components/Spinner';`;

/** Add `import Spinner from '@/components/Spinner'` after the last import (idempotent). */
function ensureSpinnerImport(code: string): string {
  if (code.includes(SPINNER_IMPORT) || new RegExp(`\\bimport\\s+(?:\\{\\s*${SPINNER_COMPONENT_NAME}\\s*\\}|${SPINNER_COMPONENT_NAME})\\s+from`).test(code)) return code;
  return insertAfterLastImportLine(code, SPINNER_IMPORT) ?? code;
}

/** Remove the Spinner import — only when NO `<Spinner` instance remains. */
function pruneSpinnerImport(code: string): string {
  if (new RegExp(`<${SPINNER_COMPONENT_NAME}\\b`).test(code)) return code; // still used
  return code.replace(new RegExp(`\\n?${escapeRegExp(SPINNER_IMPORT)}\\n?`), '\n');
}

/** Write the shared Spinner component master to ProjectFS if it doesn't exist yet.
 *  Side-effecting — call from the mutation handler (not the pure code transforms). */
export function ensureSpinnerComponentFile(): void {
  const existing = projectFS.readFile(SPINNER_COMPONENT_PATH);
  // Write if absent, OR upgrade ANY old auto-generated version (ours = has the
  // spinner-root data-id) that predates the current `@spinner-gen` version. v4:
  // the Conic is `position: relative; width/height: 100%` (fills the root in
  // flow) instead of `position: absolute; inset: 0` — an absolute Conic resolved
  // its inset against the wrong ancestor on canvas (the whole collection list),
  // so its hit-area swallowed list hovers even though the mask clipped the
  // VISUAL to 20px. Bump the version token whenever the shape changes.
  const isOldAutoGen = existing != null
    && existing.includes('data-id="spinner-root"')
    && !existing.includes('@spinner-gen v4');
  if (existing != null && !isOldAutoGen) return;
  projectFS.writeFile(SPINNER_COMPONENT_PATH, buildSpinnerComponentCode());
  trace.action('cms-pagination:ensureSpinnerComponentFile', { path: SPINNER_COMPONENT_PATH, upgraded: isOldAutoGen });
}

/** Find the matching closing paren for an opening paren at openIdx. */
function findMatchingParenForward(str: string, openIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === inString && str[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Strip .sort(...) segment from an inline expression if present, as sorting doesn't change array length. */
function stripSortFromChain(expr: string): string {
  const sortIdx = expr.indexOf('.sort(');
  if (sortIdx === -1) return expr;
  const openParen = sortIdx + '.sort'.length;
  const closeParen = findMatchingParenForward(expr, openParen);
  if (closeParen !== -1) {
    return (expr.slice(0, sortIdx) + expr.slice(closeParen + 1)).trim();
  }
  return expr;
}

/** Extract the collection expression preceding .slice() / .map() so pagination guards
 *  can check filtered items length rather than raw collection size. */
export function extractFilteredCollectionExpr(content: string, mapDotIdx: number, fallbackSlug: string): string {
  const sliceMatch = /\.slice\(\s*0\s*,\s*[^)]+\)\s*$/.exec(content.slice(0, mapDotIdx));
  const chainEnd = sliceMatch ? sliceMatch.index : mapDotIdx;

  const applyIdx = content.lastIndexOf('__applyListConfig(', mapDotIdx);
  if (applyIdx >= 0 && applyIdx < chainEnd) {
    const expr = content.slice(applyIdx, chainEnd).trim();
    if (expr) return expr;
  }

  const head = findCollectionChainHead(content, mapDotIdx);
  if (head && head.slugStart < chainEnd) {
    let expr = content.slice(head.slugStart, chainEnd).trim();
    expr = stripSortFromChain(expr);
    if (expr) return expr;
  }

  return fallbackSlug;
}

/**
 * Enable/replace pagination on the collection list `parentId`.
 *  - rewrites the chain's `.slice(...)` to `.slice(0, <stateVar>)` (or inserts it before `.map(`);
 *  - stamps `data-pagination="<mode>:<perPage>"` on the list container;
 *  - injects the Load More button (loadMore) or an IntersectionObserver sentinel (infinite);
 *  - emits the `visibleCount` useState (+ useRef/useEffect for infinite) in the page body.
 */
export function setPaginationInCode(
  code: string,
  parentId: string,
  opts: { mode: PaginationMode; perPage: number; isRemote?: boolean; queryConfig?: any },
): string {
  const { mode, perPage } = opts;
  trace.fn('cms-pagination:set', { parentId, mode, perPage });

  const loadMoreId = `loadmore-${parentId}`;
  const sentinelId = `sentinel-${parentId}`;
  const existingLoadMoreIdx = code.indexOf(`data-id="${loadMoreId}"`);
  const existingSentinelIdx = code.indexOf(`data-id="${sentinelId}"`);
  const initialElStart = findJSXElementByDataId(code, parentId);
  const initialClosing = initialElStart !== -1 ? findClosingTag(code, initialElStart) : null;
  const isInsideInitialParent = (idx: number) => Boolean(initialClosing && initialClosing.contentStart !== -1 && idx > initialClosing.contentStart && idx < initialClosing.closeTagStart);
  const loadMoreWasOutside = existingLoadMoreIdx !== -1 && !isInsideInitialParent(existingLoadMoreIdx);
  const sentinelWasOutside = existingSentinelIdx !== -1 && !isInsideInitialParent(existingSentinelIdx);

  const wasRemote = Boolean(opts?.isRemote || isRemoteCollectionList(code, parentId, opts));

  // Start clean so re-applying a different mode doesn't stack scaffolds.
  // Preserve external UI if the mode matches (so moved buttons stay where the user put them)
  const working = removePaginationInCode(code, parentId, {
    preserveExternalUi: (mode === 'loadMore' && loadMoreWasOutside) || (mode === 'infinite' && sentinelWasOutside),
  });

  const elStart = findJSXElementByDataId(working, parentId);
  if (elStart === -1) { trace.error('cms-pagination:set', { message: 'list not found', parentId }); return code; }
  const closing = findClosingTag(working, elStart);
  if (!closing) { trace.error('cms-pagination:set', { message: 'no closing tag', parentId }); return code; }

  const content = working.slice(closing.contentStart, closing.closeTagStart);
  const mapRe = new RegExp(COLLECTION_MAP_CALL_RE.source, 'g');
  const mapMatch = mapRe.exec(content);
  if (!mapMatch) { trace.error('cms-pagination:set', { message: 'no .map()', parentId }); return code; }
  const openingTag = working.slice(elStart, closing.contentStart);
  let slug = extractCollectionSlug(content, mapMatch.index);
  if (!slug) {
    const cmsMatch = content.slice(0, mapMatch.index).match(/\bcmsDatasets\b[\s\S]*?\|\|\s*([a-zA-Z0-9_]+)\s*\)/);
    if (cmsMatch) {
      slug = cmsMatch[1];
    }
  }
  if (!slug) {
    const queryConfigMatch = openingTag.match(/data-query-config=(?:'\{[\s\S]*?"source"\s*:\s*"([^"]+)"[\s\S]*?\}'|"\{[\s\S]*?\\"source\\"\s*:\s*\\"([^\\"]+)\\"[\s\S]*?\}")/);
    if (queryConfigMatch) {
      slug = queryConfigMatch[1] || queryConfigMatch[2];
    }
  }
  if (!slug && opts?.queryConfig?.source) {
    slug = opts.queryConfig.source;
  }
  if (!slug) { trace.error('cms-pagination:set', { message: 'no chain head', parentId }); return code; }
  const filteredExpr = extractFilteredCollectionExpr(content, mapMatch.index, slug);

  const isRemote = wasRemote || isRemoteCollectionList(working, parentId, opts, slug);

  if (isRemote) {
    const capitalId = toPascalCase(parentId);
    const itemsVar = 'items' + capitalId;
    const setItemsVar = 'setItems' + capitalId;
    const pageVar = 'page' + capitalId;
    const setPageVar = 'setPage' + capitalId;
    const hasMoreVar = 'hasMore' + capitalId;
    const setHasMoreVar = 'setHasMore' + capitalId;
    const loadingVar = 'loading' + capitalId;
    const setLoadingVar = 'setLoading' + capitalId;
    const errorVar = 'error' + capitalId;
    const setErrorVar = 'setError' + capitalId;
    const abortRef = 'abort' + capitalId + 'Ref';
    const sentinelRef = 'sentinel' + capitalId + 'Ref';
    const loadMoreFn = 'loadMore' + capitalId;
    const retryFn = 'retry' + capitalId;

    let initialExpr = filteredExpr;
    if (!initialExpr || initialExpr === itemsVar || initialExpr.startsWith('items')) {
      initialExpr = slug;
    }
    const cmsDatasetMatch = content.slice(0, mapMatch.index).match(/\((cmsDatasets\?\.\[[^\]]+\][^)]*)\)/);
    if (cmsDatasetMatch) {
      initialExpr = cmsDatasetMatch[0];
    }

    const beforeMap = content.slice(0, mapMatch.index);
    let newContent: string;
    if (cmsDatasetMatch && typeof cmsDatasetMatch.index === 'number') {
      const matchStart = cmsDatasetMatch.index;
      const matchEnd = matchStart + cmsDatasetMatch[0].length;
      newContent = beforeMap.slice(0, matchStart) + itemsVar + beforeMap.slice(matchEnd) + content.slice(mapMatch.index);
    } else {
      const head = findCollectionChainHead(content, mapMatch.index);
      if (head) {
        newContent = content.slice(0, head.slugStart) + itemsVar + content.slice(head.slugEnd);
      } else if (beforeMap.endsWith(initialExpr)) {
        newContent = beforeMap.slice(0, beforeMap.length - initialExpr.length) + itemsVar + content.slice(mapMatch.index);
      } else {
        newContent = content.replace(initialExpr, itemsVar);
      }
    }

    const sliceBeforeMap = /\.slice\(\s*0\s*,\s*[^)]+\)\s*(?=\.map\()/;
    newContent = newContent.replace(sliceBeforeMap, '');

    if (mode === 'loadMore') {
      if (!loadMoreWasOutside) {
        newContent += `\n      {${hasMoreVar} && <${LOADMORE_COMPONENT_NAME} data-id="loadmore-${parentId}" data-pagination-ui="true" onLoadMore={${loadMoreFn}} />}\n    `;
      }
    } else {
      if (!sentinelWasOutside) {
        newContent += `\n      {${hasMoreVar} && <div ref={${sentinelRef}} data-id="sentinel-${parentId}" data-pagination-ui="true" style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center', padding: '12px' }}><${SPINNER_COMPONENT_NAME} data-id="spinner-${parentId}" /></div>}\n    `;
      }
    }

    let result = working.slice(0, closing.contentStart) + newContent + working.slice(closing.closeTagStart);

    if (loadMoreWasOutside && mode === 'loadMore') {
      result = result.replace(
        new RegExp(`(\\{\\s*)[a-zA-Z0-9_.]+\\s*(&&\\s*<${LOADMORE_COMPONENT_NAME}\\b[^>]*?data-id="loadmore-${parentId}")`),
        `$1${hasMoreVar} $2`,
      );
      result = result.replace(
        new RegExp(`(<${LOADMORE_COMPONENT_NAME}\\b[^>]*?data-id="loadmore-${parentId}"[^>]*?onLoadMore=\\{)[^}]+(\\})`),
        `$1${loadMoreFn}$2`,
      );
    }

    const tagClose = findTagClose(result, elStart);
    if (tagClose !== -1 && !/data-pagination=/.test(result.slice(elStart, tagClose))) {
      result = result.slice(0, tagClose) + ` data-pagination="${mode}:${perPage}" data-remote-pagination="true"` + result.slice(tagClose);
    }

    let queryParamsPayload = '';
    let resolvedQueryConfig = opts?.queryConfig;
    if (!resolvedQueryConfig) {
      const jsonMatch = openingTag.match(/data-query-config=\{JSON\.stringify\(([\s\S]*?)\)\}/);
      if (jsonMatch) {
        try { resolvedQueryConfig = JSON.parse(jsonMatch[1]); } catch {}
      } else {
        const attrMatch = openingTag.match(/data-query-config=(?:'([\s\S]*?)'|"([\s\S]*?)")/);
        if (attrMatch) {
          try { resolvedQueryConfig = JSON.parse(attrMatch[1] || attrMatch[2]); } catch {}
        }
      }
    }
    if (resolvedQueryConfig?.params && Array.isArray(resolvedQueryConfig.params) && resolvedQueryConfig.params.length > 0) {
      const entries = resolvedQueryConfig.params.map((p: any) => {
        if (p.isExpression && p.value) {
          const safeVal = String(p.value).replace(/\bparams\.([a-zA-Z0-9_]+)/g, 'params?.$1');
          return `{ key: ${JSON.stringify(p.key)}, value: ${safeVal} }`;
        }
        return `{ key: ${JSON.stringify(p.key)}, value: ${JSON.stringify(p.value ?? '')} }`;
      });
      queryParamsPayload = `, params: [${entries.join(', ')}]`;
    }

    const hookLines: string[] = [];
    if (queryParamsPayload.includes('params?.')) {
      result = ensureNamedImport(result, 'next/navigation', ['useParams']);
      result = result.replace(/\n?\s*const\s+params\s*=\s*useParams\s*\(\s*\);?/g, '');
      hookLines.push('const params = useParams();');
    }

    hookLines.push(
      `const [${itemsVar}, ${setItemsVar}] = useState(() => (Array.isArray(${initialExpr}) ? ${initialExpr}.slice(0, ${perPage}) : []));`,
      `const [${pageVar}, ${setPageVar}] = useState(1);`,
      `const [${hasMoreVar}, ${setHasMoreVar}] = useState(() => (Array.isArray(${initialExpr}) ? ${initialExpr}.length > ${perPage} : true));`,
      `const [${loadingVar}, ${setLoadingVar}] = useState(false);`,
      `const [${errorVar}, ${setErrorVar}] = useState(null);`,
      `const ${abortRef} = useRef(null);`,
    );
    if (mode === 'infinite') {
      hookLines.push(`const ${sentinelRef} = useRef(null);`);
    }
    hookLines.push(
      `useEffect(() => { ${setItemsVar}(Array.isArray(${initialExpr}) ? ${initialExpr}.slice(0, ${perPage}) : []); ${setPageVar}(1); ${setHasMoreVar}(Array.isArray(${initialExpr}) ? ${initialExpr}.length > ${perPage} : true); ${setErrorVar}(null); }, [${initialExpr}]);`,
      `const ${loadMoreFn} = useCallback(async () => { if (${loadingVar} || !${hasMoreVar}) return; ${abortRef}.current?.abort(); const ctrl = new AbortController(); ${abortRef}.current = ctrl; ${setLoadingVar}(true); ${setErrorVar}(null); try { const nextPage = ${pageVar} + 1; const res = await fetch('/api/cms/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: '${slug}', page: nextPage, limit: ${perPage}, offset: (nextPage - 1) * ${perPage}${queryParamsPayload} }), signal: ctrl.signal }); if (!res.ok) throw new Error('Failed to load more items'); const data = await res.json(); if (data.ok && Array.isArray(data.items)) { ${setItemsVar}((prev: any[]) => { const existingIds = new Set(prev.map((it: any) => it.id ?? it._id ?? it.slug ?? it._slug)); const newItems = data.items.filter((it: any) => { const id = it.id ?? it._id ?? it.slug ?? it._slug; return id != null ? !existingIds.has(id) : true; }); return [...prev, ...newItems]; }); ${setPageVar}(nextPage); ${setHasMoreVar}(Boolean(data.hasMore ?? (data.items.length >= ${perPage}))); } else { ${setHasMoreVar}(false); } } catch (err: any) { if (err.name !== 'AbortError') ${setErrorVar}(err.message || 'Error loading more'); } finally { ${setLoadingVar}(false); } }, [${loadingVar}, ${hasMoreVar}, ${pageVar}]);`,
      `const ${retryFn} = ${loadMoreFn};`,
    );
    if (mode === 'infinite') {
      hookLines.push(
        `useEffect(() => { const el = ${sentinelRef}.current; if (!el) return; const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) { ${loadMoreFn}(); } }); io.observe(el); return () => io.disconnect(); }, [${loadMoreFn}]);`,
      );
    }

    for (const line of [...hookLines].reverse()) {
      result = ensureHook(result, parentId, line);
    }

    if (mode === 'loadMore') result = ensureLoadMoreImport(result);
    if (mode === 'infinite') result = ensureSpinnerImport(result);

    trace.action('cms-pagination:set:remote:done', { parentId, mode, perPage, itemsVar });
    return result;
  }

  // --- Local pagination path ---
  const stateVar = paginationStateVar(parentId);
  const setter = setterFor(stateVar);

  // 1. slice(0, stateVar) right before .map() — replace an existing slice or insert.
  let newContent: string;
  const sliceBeforeMap = /\.slice\(\s*0\s*,\s*[^)]+\)\s*(?=\.map\()/;
  if (sliceBeforeMap.test(content)) {
    newContent = content.replace(sliceBeforeMap, `.slice(0, ${stateVar})`);
  } else {
    newContent = content.slice(0, mapMatch.index) + `.slice(0, ${stateVar})` + content.slice(mapMatch.index);
  }

  // 2. Scaffold appended as the last child of the list container.
  //   loadMore → a <LoadMore> COMPONENT instance whose event prop `onLoadMore`
  //     is the page setter (design-tool parity: a real component, not a raw button);
  //   infinite → an IntersectionObserver sentinel <div>.
  //
  // Guard condition checks filteredExpr.length (not raw unfiltered slug.length)
  // so the button/sentinel hides when all items matching active filters/sort are displayed.
  if (mode === 'loadMore') {
    if (!loadMoreWasOutside) {
      newContent += `\n      {${stateVar} < ${filteredExpr}.length && <${LOADMORE_COMPONENT_NAME} data-id="loadmore-${parentId}" data-pagination-ui="true" onLoadMore={() => ${setter}((c) => c + ${perPage})} />}\n    `;
    }
  } else {
    if (!sentinelWasOutside) {
      // Infinite scroll: the sentinel is the IntersectionObserver target AND shows
      // the animated Spinner loader while more rows can load (hidden once exhausted).
      const refVar = stateVar + 'Ref';
      // `alignSelf: center` keeps the sentinel from STRETCHING to the list width
      // (flex column default) — otherwise its full-width box made the spinner's
      // hit-area swallow hovers/clicks across the whole list. Now it hugs the
      // spinner and centres itself.
      newContent += `\n      {${stateVar} < ${filteredExpr}.length && <div ref={${refVar}} data-id="sentinel-${parentId}" data-pagination-ui="true" style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center', padding: '12px' }}><${SPINNER_COMPONENT_NAME} data-id="spinner-${parentId}" /></div>}\n    `;
    }
  }

  let result = working.slice(0, closing.contentStart) + newContent + working.slice(closing.closeTagStart);

  if (loadMoreWasOutside && mode === 'loadMore') {
    result = result.replace(
      new RegExp(`(<${LOADMORE_COMPONENT_NAME}\\b[^>]*?data-id="loadmore-${parentId}"[^>]*?onLoadMore=\\{)(?:\\(\\)\\s*=>\\s*set[A-Za-z0-9]+\\(\\([a-z]\\)\\s*=>\\s*[a-z]\\s*\\+\\s*\\d+\\)|[a-zA-Z0-9_]+)(\\})`),
      `$1() => ${setter}((c) => c + ${perPage})$2`,
    );
  }

  // 3. data-pagination marker on the opening tag (positions before contentStart are
  // unchanged so far — do this BEFORE any top-of-file/body insertion shifts them).
  const tagClose = findTagClose(result, elStart);
  if (tagClose !== -1 && !/data-pagination=/.test(result.slice(elStart, tagClose))) {
    result = result.slice(0, tagClose) + ` data-pagination="${mode}:${perPage}"` + result.slice(tagClose);
  }

  // 4. Hooks in the enclosing function body (page OR design-component master).
  result = ensureHook(result, parentId, `const [${stateVar}, ${setter}] = useState(${perPage});`);
  if (mode === 'infinite') {
    const refVar = stateVar + 'Ref';
    result = ensureHook(result, parentId, `const ${refVar} = useRef(null);`);
    result = ensureHook(result, parentId, `useEffect(() => { const el = ${refVar}.current; if (!el) return; const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) ${setter}((c) => Math.min(c + ${perPage}, ${slug}.length)); }); io.observe(el); return () => io.disconnect(); }, []);`);
  }

  // 5. LoadMore component import LAST (inserts at top → shifts positions, so all
  // offset-based edits above are already done). Without it the page references an
  // undefined identifier and validation blocks every later edit.
  if (mode === 'loadMore') result = ensureLoadMoreImport(result);
  if (mode === 'infinite') result = ensureSpinnerImport(result);

  trace.action('cms-pagination:set:done', { parentId, mode, perPage, stateVar });
  return result;
}

/** Remove pagination from the list `parentId` — strips the marker, scaffold, the
 *  `.slice(0, <stateVar>)`, and the hooks. Idempotent (no-op if not paginated). */
export function removePaginationInCode(code: string, parentId: string, opts?: { preserveExternalUi?: boolean }): string {
  const stateVar = paginationStateVar(parentId);
  const setter = setterFor(stateVar);
  const refVar = stateVar + 'Ref';
  const capitalId = toPascalCase(parentId);
  const itemsVar = 'items' + capitalId;
  const setItemsVar = 'setItems' + capitalId;
  const pageVar = 'page' + capitalId;
  const setPageVar = 'setPage' + capitalId;
  const hasMoreVar = 'hasMore' + capitalId;
  const setHasMoreVar = 'setHasMore' + capitalId;
  const loadingVar = 'loading' + capitalId;
  const setLoadingVar = 'setLoading' + capitalId;
  const errorVar = 'error' + capitalId;
  const setErrorVar = 'setError' + capitalId;
  const abortRef = 'abort' + capitalId + 'Ref';
  const sentinelRef = 'sentinel' + capitalId + 'Ref';
  const loadMoreFn = 'loadMore' + capitalId;
  const retryFn = 'retry' + capitalId;

  let result = code;

  const elStart = findJSXElementByDataId(code, parentId);
  const closing = elStart !== -1 ? findClosingTag(code, elStart) : null;
  const isInsideParent = (idx: number) => Boolean(closing && closing.contentStart !== -1 && idx > closing.contentStart && idx < closing.closeTagStart);
  const loadMoreIdx = code.indexOf(`data-id="loadmore-${parentId}"`);
  const sentinelIdx = code.indexOf(`data-id="sentinel-${parentId}"`);
  const preserveLoadMore = Boolean(opts?.preserveExternalUi && loadMoreIdx !== -1 && !isInsideParent(loadMoreIdx));
  const preserveSentinel = Boolean(opts?.preserveExternalUi && sentinelIdx !== -1 && !isInsideParent(sentinelIdx));

  // Find initialExpr from itemsVar declaration if present
  let initialExpr: string | null = null;
  const prefixRe = new RegExp(`const\\s*\\[${itemsVar},\\s*${setItemsVar}\\]\\s*=\\s*useState(?:<[^>]*>)?\\(\\(\\)\\s*=>\\s*\\(?Array\\.isArray\\(`);
  const match = prefixRe.exec(result);
  if (match) {
    const argStart = match.index + match[0].length;
    let depth = 1;
    let i = argStart;
    while (i < result.length && depth > 0) {
      const ch = result[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) {
        const raw = result.slice(argStart, i).trim();
        if (raw && raw !== itemsVar && !raw.startsWith('items')) {
          initialExpr = raw;
        }
        break;
      }
      i++;
    }
  }
  if (!initialExpr && elStart !== -1) {
    const tagClose = findTagClose(result, elStart);
    if (tagClose !== -1) {
      const opening = result.slice(elStart, tagClose);
      const queryConfigMatch = opening.match(/data-query-config=(?:'\{[\s\S]*?"source"\s*:\s*"([^"]+)"[\s\S]*?\}'|"\{[\s\S]*?\\"source\\"\s*:\s*\\"([^\\"]+)\\"[\s\S]*?\}")/);
      if (queryConfigMatch) {
        const s = queryConfigMatch[1] || queryConfigMatch[2];
        if (s && s !== itemsVar && !s.startsWith('items')) {
          initialExpr = s;
        }
      }
    }
  }
  if (!initialExpr) {
    const importRegex = /import\s+([a-zA-Z0-9_]+)\s+from\s+['"](?:@\/cms\/|\.\/cms\/|\.\.\/cms\/|cms\/)([^'"]+)\.json['"]/g;
    const cmsImports: string[] = [];
    let im: RegExpExecArray | null;
    while ((im = importRegex.exec(result)) !== null) {
      cmsImports.push(im[1]);
    }
    if (cmsImports.length === 1) {
      initialExpr = cmsImports[0];
    }
  }

  // Strip the data-pagination and data-remote-pagination attrs.
  result = result.replace(/\s*data-remote-pagination="[^"]*"/g, '');
  result = result.replace(/\s*data-pagination="[^"]*"/g, '');

  if (!preserveLoadMore) {
    // Strip the Load More COMPONENT instance block (`{cond && <LoadMore .../>}`).
    result = result.replace(new RegExp(`\\s*\\{${stateVar} < [\\s\\S]*?&& <${LOADMORE_COMPONENT_NAME} data-id="loadmore-${parentId}"[\\s\\S]*?/>\\}`), '');
    result = result.replace(new RegExp(`\\s*\\{${hasMoreVar}\\s*&&\\s*<${LOADMORE_COMPONENT_NAME} data-id="loadmore-${parentId}"[\\s\\S]*?/>\\}`), '');
    // (legacy) Strip an old raw-button Load More block, if any remains.
    result = result.replace(new RegExp(`\\s*\\{${stateVar} < [\\s\\S]*?&& <button data-id="loadmore-${parentId}"[\\s\\S]*?</button>\\}`), '');
    result = pruneLoadMoreImport(result);
  }

  if (!preserveSentinel) {
    // Strip the infinite-scroll sentinel+Spinner block (`{cond && <div ref>...<Spinner/></div>}`).
    result = result.replace(new RegExp(`\\s*\\{${stateVar} < [\\s\\S]*?&& <div ref=\\{${refVar}\\} data-id="sentinel-${parentId}"[\\s\\S]*?</div>\\}`), '');
    result = result.replace(new RegExp(`\\s*\\{${hasMoreVar}\\s*&&\\s*<div ref=\\{${sentinelRef}\\} data-id="sentinel-${parentId}"[\\s\\S]*?</div>\\}`), '');
    // (legacy) Strip an old self-closing sentinel div, if any remains.
    result = result.replace(new RegExp(`\\s*<div ref=\\{${refVar}\\} data-id="sentinel-${parentId}"[^>]*/>`), '');
    result = result.replace(new RegExp(`\\s*<div ref=\\{${sentinelRef}\\} data-id="sentinel-${parentId}"[^>]*/>`), '');
    result = pruneSpinnerImport(result);
  }
  // Collapse `.slice(0, stateVar)` back out of the chain (global — duplicates).
  result = result.replace(new RegExp(`\\.slice\\(0, ${stateVar}\\)`, 'g'), '');

  // Remove the local hooks.
  result = result.replace(new RegExp(`\\n?\\s*const \\[${stateVar}, ${setter}\\] = useState\\([^)]*\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const ${refVar} = useRef\\([^)]*\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*useEffect\\(\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${refVar}\\.current[\\s\\S]*?\\}\\s*,\\s*\\[\\]\\s*\\);`, 'g'), '');

  // Remove remote hooks BEFORE restoring mapping head!
  result = result.replace(new RegExp(`\\n?\\s*const \\[${itemsVar}, ${setItemsVar}\\] = useState\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const \\[${pageVar}, ${setPageVar}\\] = useState\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const \\[${hasMoreVar}, ${setHasMoreVar}\\] = useState\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const \\[${loadingVar}, ${setLoadingVar}\\] = useState\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const \\[${errorVar}, ${setErrorVar}\\] = useState\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const ${abortRef} = useRef\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const ${sentinelRef} = useRef\\([\\s\\S]*?\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*useEffect\\(\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${setItemsVar}[\\s\\S]*?\\},\\s*\\[[\\s\\S]*?\\]\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const ${loadMoreFn} = useCallback\\([\\s\\S]*?\\},\\s*\\[[\\s\\S]*?\\]\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const ${retryFn} = [^;]+;`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*useEffect\\(\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${sentinelRef}[\\s\\S]*?\\},\\s*\\[[\\s\\S]*?\\]\\);`, 'g'), '');

  // Restore mapping head if itemsVar was used
  if (initialExpr) {
    result = result.replace(new RegExp(`\\b${itemsVar}\\b`, 'g'), initialExpr);
  }

  // Heal stray bare-number expression-statements left by the OLD buggy removal.
  result = result.replace(/;(?:\s*\d+;)+/g, ';');

  return result;
}

/** When `nodeId` is a pagination UI node the editor generated for a list —
 *  the Load More instance (`loadmore-<listId>`), the infinite-scroll sentinel
 *  (`sentinel-<listId>`) or its Spinner (`spinner-<listId>`) — return the list
 *  id, else null. Deleting one of these must tear down the WHOLE pagination
 *  (guard expression, `.slice`, hooks, imports): a plain element strip leaves
 *  `{vis < blog.length && }` behind — a parse error that blocks the delete
 *  (2026-09-08). Tag-verified: the id shape alone is not proof (a user can
 *  name a frame `loadmore-x`), so the element must carry
 *  `data-pagination-ui="true"` or, for the spinner, sit inside such a sentinel. */
export function paginationUiParentId(code: string, nodeId: string): string | null {
  const m = /^(loadmore|sentinel|spinner)-(.+)$/.exec(nodeId);
  if (!m) return null;
  const listId = m[2];
  const check = (id: string): boolean => {
    const idx = code.indexOf(`data-id="${id}"`);
    if (idx === -1) return false;
    const tagStart = code.lastIndexOf('<', idx);
    const tagEnd = findTagClose(code, tagStart);
    if (tagStart === -1 || tagEnd === -1) return false;
    return code.slice(tagStart, tagEnd).includes('data-pagination-ui="true"');
  };
  if (m[1] === 'spinner') return check(`sentinel-${listId}`) ? listId : null;
  return check(nodeId) ? listId : null;
}

/** The body hooks a paginated list owns — `const [visX, setVisX] = useState(N)`,
 *  the infinite-scroll `useRef` + IntersectionObserver `useEffect`, and the
 *  responsive `listCfgX = useResponsiveListConfig(…)` const — verbatim, in
 *  declaration order. Used when the list MOVES to another function body (Make
 *  Component): the JSX carries `.slice(0, visX)` and the Load More guard, so the
 *  hooks must follow or the master crashes "visX is not defined" (2026-09-08). */
export function collectPaginationHooks(code: string, containerId: string): string[] {
  const stateVar = paginationStateVar(containerId);
  const setter = setterFor(stateVar);
  const refVar = stateVar + 'Ref';
  const capitalId = toPascalCase(containerId);
  const itemsVar = 'items' + capitalId;
  const setItemsVar = 'setItems' + capitalId;
  const pageVar = 'page' + capitalId;
  const setPageVar = 'setPage' + capitalId;
  const hasMoreVar = 'hasMore' + capitalId;
  const setHasMoreVar = 'setHasMore' + capitalId;
  const loadingVar = 'loading' + capitalId;
  const setLoadingVar = 'setLoading' + capitalId;
  const errorVar = 'error' + capitalId;
  const setErrorVar = 'setError' + capitalId;
  const abortRef = 'abort' + capitalId + 'Ref';
  const sentinelRef = 'sentinel' + capitalId + 'Ref';
  const loadMoreFn = 'loadMore' + capitalId;
  const retryFn = 'retry' + capitalId;

  const hooks: string[] = [];
  const grab = (re: RegExp) => { const m = code.match(re); if (m) hooks.push(m[0].trim()); };
  grab(new RegExp(`const ${listConfigVar(containerId)} = useResponsiveListConfig\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const \\[${stateVar}, ${setter}\\] = useState\\([^)]*\\);`));
  grab(new RegExp(`const ${refVar} = useRef\\([^)]*\\);`));
  grab(new RegExp(`useEffect\\(\\(\\) => \\{[\\s\\S]*?${refVar}[\\s\\S]*?\\}, \\[\\]\\);`));

  // Remote hooks
  grab(new RegExp(`const \\[${itemsVar}, ${setItemsVar}\\] = useState\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const \\[${pageVar}, ${setPageVar}\\] = useState\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const \\[${hasMoreVar}, ${setHasMoreVar}\\] = useState\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const \\[${loadingVar}, ${setLoadingVar}\\] = useState\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const \\[${errorVar}, ${setErrorVar}\\] = useState\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const ${abortRef} = useRef\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const ${sentinelRef} = useRef\\([\\s\\S]*?\\);`));
  grab(new RegExp(`useEffect\\(\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${setItemsVar}[\\s\\S]*?\\},\\s*\\[[\\s\\S]*?\\]\\);`));
  grab(new RegExp(`const ${loadMoreFn} = useCallback\\([\\s\\S]*?\\},\\s*\\[[\\s\\S]*?\\]\\);`));
  grab(new RegExp(`const ${retryFn} = [^;]+;`));
  grab(new RegExp(`useEffect\\(\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${sentinelRef}[\\s\\S]*?\\},\\s*\\[[\\s\\S]*?\\]\\);`));

  return hooks;
}

/** Every `data-pagination` container id inside `jsx`. */
export function paginatedContainerIds(jsx: string): string[] {
  const out: string[] = [];
  const re = /<[A-Za-z][^>]*?\bdata-pagination="(?:loadMore|infinite):\d+"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsx)) !== null) {
    const idM = /\bdata-id="([^"]+)"/.exec(m[0]);
    if (idM && !out.includes(idM[1])) out.push(idM[1]);
  }
  return out;
}

/** Load-time heal: an existing Load More master (any gen) gets the nowrap label. */
export function migrateLoadMoreLabelNowrap(): void {
  const existing = projectFS.readFile(LOADMORE_COMPONENT_PATH);
  if (existing == null || !existing.includes('data-id="loadmore-root"')) return;
  const healed = ensureLoadMoreLabelNowrap(existing);
  if (healed === existing) return;
  projectFS.writeFile(LOADMORE_COMPONENT_PATH, healed);
  trace.action('cms-pagination:migrated-loadmore-label-nowrap', { path: LOADMORE_COMPONENT_PATH });
}
