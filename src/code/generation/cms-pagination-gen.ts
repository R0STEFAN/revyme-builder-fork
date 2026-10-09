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
import { findTagClose, insertAfterLastImportLine } from './generator-utils';
import {
  findJSXElementByDataId,
  findClosingTag,
  COLLECTION_MAP_CALL_RE,
  extractCollectionSlug,
  findCollectionChainHead,
} from './cms-gen';
import { insertConstIntoEnclosingFn, listConfigVar } from './cms-responsive-gen';
import { ensureTextNodeNowrap } from './label-nowrap';

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
export function readPaginationMarker(
  code: string,
  parentId: string,
): { mode: PaginationMode; perPage: number } | null {
  const elStart = findJSXElementByDataId(code, parentId);
  if (elStart === -1) return null;
  const tagClose = findTagClose(code, elStart);
  if (tagClose === -1) return null;
  const m = /data-pagination="(loadMore|infinite):(\d+)"/.exec(code.slice(elStart, tagClose));
  if (!m) return null;
  return { mode: m[1] as PaginationMode, perPage: parseInt(m[2], 10) };
}
const setterFor = (v: string) => 'set' + v.charAt(0).toUpperCase() + v.slice(1);

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
  if (code.includes(LOADMORE_IMPORT)) return code;
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
  if (code.includes(SPINNER_IMPORT)) return code;
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
  opts: { mode: PaginationMode; perPage: number },
): string {
  const { mode, perPage } = opts;
  trace.fn('cms-pagination:set', { parentId, mode, perPage });

  // Start clean so re-applying a different mode doesn't stack scaffolds.
  const working = removePaginationInCode(code, parentId);

  const elStart = findJSXElementByDataId(working, parentId);
  if (elStart === -1) { trace.error('cms-pagination:set', { message: 'list not found', parentId }); return code; }
  const closing = findClosingTag(working, elStart);
  if (!closing) { trace.error('cms-pagination:set', { message: 'no closing tag', parentId }); return code; }

  const content = working.slice(closing.contentStart, closing.closeTagStart);
  const mapRe = new RegExp(COLLECTION_MAP_CALL_RE.source, 'g');
  const mapMatch = mapRe.exec(content);
  if (!mapMatch) { trace.error('cms-pagination:set', { message: 'no .map()', parentId }); return code; }
  // Handles BOTH the inline chain AND the responsive `__applyListConfig(slug, cfg)`
  // head (findCollectionChainHead returns null on the latter → pagination silently bailed).
  const slug = extractCollectionSlug(content, mapMatch.index);
  if (!slug) { trace.error('cms-pagination:set', { message: 'no chain head', parentId }); return code; }
  const filteredExpr = extractFilteredCollectionExpr(content, mapMatch.index, slug);

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
    newContent += `\n      {${stateVar} < ${filteredExpr}.length && <${LOADMORE_COMPONENT_NAME} data-id="loadmore-${parentId}" data-pagination-ui="true" onLoadMore={() => ${setter}((c) => c + ${perPage})} />}\n    `;
  } else {
    // Infinite scroll: the sentinel is the IntersectionObserver target AND shows
    // the animated Spinner loader while more rows can load (hidden once exhausted).
    const refVar = stateVar + 'Ref';
    // `alignSelf: center` keeps the sentinel from STRETCHING to the list width
    // (flex column default) — otherwise its full-width box made the spinner's
    // hit-area swallow hovers/clicks across the whole list. Now it hugs the
    // spinner and centres itself.
    newContent += `\n      {${stateVar} < ${filteredExpr}.length && <div ref={${refVar}} data-id="sentinel-${parentId}" data-pagination-ui="true" style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center', padding: '12px' }}><${SPINNER_COMPONENT_NAME} data-id="spinner-${parentId}" /></div>}\n    `;
  }

  let result = working.slice(0, closing.contentStart) + newContent + working.slice(closing.closeTagStart);

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
export function removePaginationInCode(code: string, parentId: string): string {
  const stateVar = paginationStateVar(parentId);
  const setter = setterFor(stateVar);
  const refVar = stateVar + 'Ref';
  let result = code;

  // Strip the data-pagination attr.
  result = result.replace(new RegExp(`\\s*data-pagination="[^"]*"`), '');
  // Strip the Load More COMPONENT instance block (`{cond && <LoadMore .../>}`).
  result = result.replace(new RegExp(`\\s*\\{${stateVar} < [\\s\\S]*?&& <${LOADMORE_COMPONENT_NAME} data-id="loadmore-${parentId}"[\\s\\S]*?/>\\}`), '');
  // (legacy) Strip an old raw-button Load More block, if any remains.
  result = result.replace(new RegExp(`\\s*\\{${stateVar} < [\\s\\S]*?&& <button data-id="loadmore-${parentId}"[\\s\\S]*?</button>\\}`), '');
  // Strip the infinite-scroll sentinel+Spinner block (`{cond && <div ref>...<Spinner/></div>}`).
  result = result.replace(new RegExp(`\\s*\\{${stateVar} < [\\s\\S]*?&& <div ref=\\{${refVar}\\} data-id="sentinel-${parentId}"[\\s\\S]*?</div>\\}`), '');
  // (legacy) Strip an old self-closing sentinel div, if any remains.
  result = result.replace(new RegExp(`\\s*<div ref=\\{${refVar}\\} data-id="sentinel-${parentId}"[^>]*/>`), '');
  // Drop the LoadMore + Spinner imports if no instance of each remains.
  result = pruneLoadMoreImport(result);
  result = pruneSpinnerImport(result);
  // Collapse `.slice(0, stateVar)` back out of the chain (global — duplicates).
  result = result.replace(new RegExp(`\\.slice\\(0, ${stateVar}\\)`, 'g'), '');

  // Remove the hooks. Match by IDENTIFIER (not the emitted spacing) and GLOBALLY,
  // so a babel-reformatted body (`{const el` instead of `{ const el`) and any
  // ACCUMULATED DUPLICATES (e.g. a `c+1` and a stale `c+3` observer) are all
  // stripped. The previous brittle, single-shot, space-exact regexes silently
  // failed after a reformat → duplicate observers piled up; and a partial
  // `removeHook` left `(N);` residue (babel then simplified it to a stray `N;`).
  result = result.replace(new RegExp(`\\n?\\s*const \\[${stateVar}, ${setter}\\] = useState\\([^)]*\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*const ${refVar} = useRef\\([^)]*\\);`, 'g'), '');
  result = result.replace(new RegExp(`\\n?\\s*useEffect\\(\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?${refVar}\\.current[\\s\\S]*?\\}\\s*,\\s*\\[\\]\\s*\\);`, 'g'), '');

  // Heal stray bare-number expression-statements left by the OLD buggy removal
  // (`removeHook` left `(N);` → babel → `N;`, accumulating a `;2;3;3;…` trail).
  // A `;` immediately followed by one-or-more bare integer statements is never
  // legitimate code, so collapse the run back to a single `;`.
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
  const hooks: string[] = [];
  const grab = (re: RegExp) => { const m = code.match(re); if (m) hooks.push(m[0]); };
  grab(new RegExp(`const ${listConfigVar(containerId)} = useResponsiveListConfig\\([\\s\\S]*?\\);`));
  grab(new RegExp(`const \\[${stateVar}, ${setter}\\] = useState\\([^)]*\\);`));
  grab(new RegExp(`const ${refVar} = useRef\\([^)]*\\);`));
  grab(new RegExp(`useEffect\\(\\(\\) => \\{[\\s\\S]*?${refVar}[\\s\\S]*?\\}, \\[\\]\\);`));
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
