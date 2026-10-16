// preview-api-query.ts — API query executor and dataset cache for the in-house preview sandbox.
// Detects query configs in routed pages, executes queries across the postMessage bridge
// to parent PreviewOverlay, maintains per-node / per-source datasets, and supports
// dynamic route transitions without full page reloads.

import * as React from 'react';
import type { CollectionQueryConfig } from '@/shared/types';
import {
  evaluateParamExpression,
  evaluateQueryParamExpressions,
} from '@/code/project/cms-api-config';

export { evaluateParamExpression, evaluateQueryParamExpressions };

export interface DetectedQuery {
  listId: string;
  source: string;
  queryConfig: CollectionQueryConfig;
}

export interface PendingQuery {
  listId: string;
  source: string;
  queryKey: string;
  routeParams: Record<string, string>;
  url: string;
}

export interface QueryStatus {
  loading: boolean;
  error: string | null;
}

// ─── Balanced JSX Tag Helpers ────────────────────────────────────────────────

/**
 * Find the closing `>` of a JSX opening tag, taking string literals and braces into account.
 */
export function findTagClose(code: string, startIdx: number): number {
  let braceDepth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = startIdx; i < code.length; i++) {
    const ch = code[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      braceDepth--;
      continue;
    }

    if (ch === '>' && braceDepth === 0) return i;
  }
  return -1;
}

/**
 * Finds the index of the matching `</tagName>` closing tag by balancing tag depth.
 * Correctly accounts for nested tags of the same name and self-closing tags.
 */
export function findMatchingCloseTagIndex(code: string, tagName: string, fromIdx: number): number {
  const openPattern = `<${tagName}`;
  const closePattern = `</${tagName}>`;
  let depth = 1;
  let searchFrom = fromIdx;

  while (depth > 0 && searchFrom < code.length) {
    const nextOpen = code.indexOf(openPattern, searchFrom);
    const nextClose = code.indexOf(closePattern, searchFrom);
    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = code[nextOpen + openPattern.length];
      if (after === ' ' || after === '>' || after === '/' || after === '\n' || after === '\r' || after === '\t') {
        const gt = findTagClose(code, nextOpen + openPattern.length);
        if (gt === -1) return -1;
        // Not self-closing -> increment depth
        if (code[gt - 1] !== '/') {
          depth++;
        }
        searchFrom = gt + 1;
      } else {
        searchFrom = nextOpen + openPattern.length;
      }
    } else {
      depth--;
      if (depth === 0) return nextClose;
      searchFrom = nextClose + closePattern.length;
    }
  }

  return -1;
}

// ─── Query Param Evaluation & Key Building ───────────────────────────────────

/** Stable query cache key based on collection source and resolved query parameters. */
export function buildPreviewQueryKey(source: string, resolvedParams: Record<string, string>): string {
  const sortedPairs = Object.entries(resolvedParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${source}?${sortedPairs}`;
}

// ─── Query Config Detection ──────────────────────────────────────────────────

/**
 * Extracts collection list containers with `data-query-config` from a component/page TSX source.
 * Identifies the list node ID, the source collection slug, and the parsed query configuration.
 * Uses balanced tag matching so nested tags of the same type do not truncate the container slice.
 */
export function detectCollectionQueries(code: string): DetectedQuery[] {
  if (!code || !code.includes('data-query-config')) return [];
  const queries: DetectedQuery[] = [];

  // Map imported CMS variables: import <varName> from '@/cms/<slug>.json';
  const importMap = new Map<string, string>();
  const importRegex = /import\s+([a-zA-Z0-9_]+)\s+from\s+['"](?:@\/cms\/|\.\/cms\/|\.\.\/cms\/|cms\/)([^'"]+)\.json['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    importMap.set(match[1], match[2]);
  }

  const tagStartRegex = /<([a-zA-Z0-9_-]+)\s+([^>]*data-query-config[^>]*)>/g;
  while ((match = tagStartRegex.exec(code)) !== null) {
    const tagName = match[1];
    const attrs = match[2];
    const openTagEnd = tagStartRegex.lastIndex;

    const idMatch = attrs.match(/data-id=["']([^"']+)["']/);
    const listId = idMatch ? idMatch[1] : '';
    if (!listId) continue;

    let queryConfig: CollectionQueryConfig | null = null;
    const jsonStringifyMatch = attrs.match(/data-query-config=\{JSON\.stringify\(([\s\S]*?)\)\}/);
    if (jsonStringifyMatch) {
      const rawPayload = jsonStringifyMatch[1].trim();
      try {
        queryConfig = JSON.parse(rawPayload);
      } catch {
        try {
          const evalFn = new Function(`return (${rawPayload});`);
          queryConfig = evalFn();
        } catch {
          /* ignore parse failure */
        }
      }
    } else {
      const attrMatch = attrs.match(/data-query-config=(?:\{(['"`])([\s\S]*?)\1\}|["'](\{[\s\S]*?\})["'])/);
      if (attrMatch) {
        const raw = attrMatch[2] || attrMatch[3];
        try {
          queryConfig = JSON.parse(raw);
        } catch {
          /* ignore parse failure */
        }
      }
    }

    if (!queryConfig) continue;

    // Use balanced close tag matching instead of naive indexOf
    const closeIndex = findMatchingCloseTagIndex(code, tagName, openTagEnd);
    const innerContent = closeIndex !== -1 ? code.slice(openTagEnd, closeIndex) : code.slice(openTagEnd);

    let source = (queryConfig as any).source || '';
    if (!source) {
      const mapMatch = innerContent.match(/\{([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+(?:\([^)]*\))?)*\s*\.map\(/);
      if (mapMatch) {
        const varName = mapMatch[1];
        source = importMap.get(varName) || '';
        if (!source && varName.startsWith('items')) {
          const stateMatch = code.match(
            new RegExp(`const\\s*\\[${varName},[^\\]]*\\]\\s*=\\s*(?:React\\.)?useState[\\s\\S]*?(?:;|\\n\\s*(?:const|let|var|function|return|\\/\\/))`)
          );
          if (stateMatch) {
            for (const [vName, colSlug] of importMap.entries()) {
              if (new RegExp(`\\b${vName}\\b`).test(stateMatch[0])) {
                source = colSlug;
                break;
              }
            }
          }
        }
        if (!source && !varName.startsWith('items')) {
          source = varName;
        }
      }
    }
    if (!source) {
      for (const [varName, colSlug] of importMap.entries()) {
        if (new RegExp(`\\b${varName}\\b[\\s\\S]*?\\.map\\(`).test(innerContent)) {
          source = colSlug;
          break;
        }
      }
    }
    if (!source && importMap.size === 1) {
      source = [...importMap.values()][0];
    }

    if (source) {
      queries.push({ listId, source, queryConfig });
    }
  }

  return queries;
}

/**
 * Wraps collection list mapping expressions inside collection containers so that they
 * evaluate against the resolved preview dataset if available:
 * `{tattoos.map(...)` -> `{((typeof __getPreviewData === 'function' && __getPreviewData('tattoos', 'tattoos-grid')) || tattoos).map(...)`
 * Uses balanced tag matching so nested child elements of the same tag type do not terminate the container early.
 */
export function wrapCollectionListMapping(code: string, queries?: DetectedQuery[]): string {
  const detected = queries ?? detectCollectionQueries(code);
  if (!detected || detected.length === 0) return code;

  let result = code;
  for (const { listId, source } of detected) {
    const idAttr = `data-id="${listId}"`;
    const idIdx = result.indexOf(idAttr);
    if (idIdx === -1) continue;

    const elStart = result.lastIndexOf('<', idIdx);
    if (elStart === -1) continue;
    const tagClose = findTagClose(result, elStart + 1);
    if (tagClose === -1 || result[tagClose - 1] === '/') continue;

    const tagMatch = result.slice(elStart + 1).match(/^([a-zA-Z0-9_-]+)/);
    if (!tagMatch) continue;
    const tagName = tagMatch[1];

    // Balanced close tag matching: skip nested same-type tags (e.g. nested <div>)
    const closeIdx = findMatchingCloseTagIndex(result, tagName, tagClose + 1);
    if (closeIdx === -1) continue;

    const inner = result.slice(tagClose + 1, closeIdx);
    const pagMatch = result.slice(elStart, tagClose).match(/data-pagination="(?:loadMore|infinite):(\d+)"/);
    if (pagMatch) {
      const limit = parseInt(pagMatch[1], 10);
      const itemsMatch = inner.match(/\{items([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+(?:\([^)]*\))?)*\s*\.map\(/);
      if (itemsMatch) {
        const capitalId = itemsMatch[1];
        const hasMoreVar = 'hasMore' + capitalId;
        const setHasMoreVar = 'setHasMore' + capitalId;

        const hasMoreUseStateRe = new RegExp(`const\\s*\\[\\s*${hasMoreVar}\\s*,\\s*${setHasMoreVar}\\s*\\]\\s*=\\s*(React\\.)?useState(?:<[^>]*>)?\\s*\\([^)]*\\);?`);
        result = result.replace(
          hasMoreUseStateRe,
          (_match, reactPrefix) => `const [${hasMoreVar}, ${setHasMoreVar}] = ${reactPrefix || ''}useState(() => (Array.isArray(${source}) ? ${source}.length > ${limit} : true));`
        );

        const setHasMoreRe = new RegExp(`(${setHasMoreVar}\\s*\\()\\s*(?:true|Array\\.isArray\\([\\s\\S]*?\\)\\s*\\?\\s*[\\s\\S]*?\\.length\\s*(?:>=|>)\\s*\\d+\\s*:\\s*true)\\s*(\\))`, 'g');
        result = result.replace(
          setHasMoreRe,
          `$1Array.isArray(${source}) ? ${source}.length > ${limit} : true$2`
        );
      }
    }
    const targetSource = pagMatch ? source : `${source}|items[a-zA-Z0-9_]+`;
    const mapRegex = new RegExp(`(\\{\\s*)(${targetSource})(\\s*(?:\\.[a-zA-Z0-9_]+(?:\\([^)]*\\))?)*\\s*\\.map\\()`, 'g');
    if (!mapRegex.test(inner)) continue;

    const wrappedInner = inner.replace(
      mapRegex,
      `$1((typeof __getPreviewData === 'function' && __getPreviewData('${source}', '${listId}')) || $2)$3`,
    );

    result = result.slice(0, tagClose + 1) + wrappedInner + result.slice(closeIdx);
  }

  return result;
}

// ─── Datasets & Status Store ─────────────────────────────────────────────────

export const previewDatasets: Map<string, any[]> = new Map();
export const previewDatasetStatus: Map<string, QueryStatus> = new Map();
export const activePendingQueries: Map<string, PendingQuery> = new Map();

const listeners = new Set<() => void>();

export function subscribePreviewQueries(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function getPreviewDataset(source: string, listId?: string): any[] | undefined {
  if (listId && previewDatasets.has(listId)) {
    return previewDatasets.get(listId);
  }
  if (previewDatasets.has(source)) {
    return previewDatasets.get(source);
  }
  return undefined;
}

export function setPreviewDataset(key: string, data: any[]): void {
  previewDatasets.set(key, data);
}

export function getPreviewQueryStatus(listIdOrSource: string): QueryStatus {
  return previewDatasetStatus.get(listIdOrSource) ?? { loading: false, error: null };
}

export function setPreviewQueryStatus(key: string, status: QueryStatus): void {
  previewDatasetStatus.set(key, status);
}

export function clearPreviewDatasets(): void {
  previewDatasets.clear();
  previewDatasetStatus.clear();
  activePendingQueries.clear();
}

// ─── Query Dispatch & Results ────────────────────────────────────────────────

export function dispatchApiQuery(args: {
  source: string;
  queryConfig: CollectionQueryConfig;
  routeParams: Record<string, string>;
  url: string;
  listId?: string;
  targetWindow?: Window;
}): string {
  const { source, queryConfig, routeParams, url, listId } = args;
  const requestId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Evaluated in the preview iframe (user code runtime sandbox)
  const resolvedParams = evaluateQueryParamExpressions(queryConfig, routeParams);
  const queryKey = buildPreviewQueryKey(source, resolvedParams);

  activePendingQueries.set(requestId, {
    listId: listId || '',
    source,
    queryKey,
    routeParams,
    url,
  });

  if (listId) {
    setPreviewQueryStatus(listId, { loading: true, error: null });
  }
  setPreviewQueryStatus(source, { loading: true, error: null });

  const win = args.targetWindow || (typeof window !== 'undefined' ? window.parent : null);
  if (win) {
    try {
      win.postMessage(
        {
          type: 'preview:fetch-api-query',
          requestId,
          source,
          queryConfig,
          routeParams,
          resolvedParams, // Send already-evaluated strings so parent frame avoids new Function
          url,
        },
        '*',
      );
    } catch {
      /* ignore postMessage error */
    }
  }

  return requestId;
}

export function handleApiQueryResult(result: {
  requestId: string;
  data: any[] | null;
  error: string | null;
}): boolean {
  const pending = activePendingQueries.get(result.requestId);
  if (!pending) return false;
  activePendingQueries.delete(result.requestId);

  const { listId, source, queryKey } = pending;

  if (result.error) {
    if (listId) {
      setPreviewQueryStatus(listId, { loading: false, error: result.error });
    }
    setPreviewQueryStatus(source, { loading: false, error: result.error });
    notifyListeners();
    return true;
  }

  const items = Array.isArray(result.data) ? result.data : [];
  if (listId) {
    setPreviewDataset(listId, items);
    setPreviewQueryStatus(listId, { loading: false, error: null });
  }
  setPreviewDataset(source, items);
  setPreviewDataset(queryKey, items);
  setPreviewQueryStatus(source, { loading: false, error: null });

  notifyListeners();
  return true;
}

/** Hook for client components or preview runtime to read active collection items. */
export function usePreviewCollectionData(source: string, listId?: string): any[] | undefined {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    return subscribePreviewQueries(() => setTick((t) => t + 1));
  }, []);
  return getPreviewDataset(source, listId);
}

export interface RouteQuerySyncResult {
  neededQueries: Array<{
    query: DetectedQuery;
    queryKey: string;
    resolvedParams: Record<string, string>;
  }>;
}

/**
 * Synchronously synchronizes query datasets for the active route before rendering.
 * 1. For each collection query on the active files:
 *    - Resolves parameters against current route params.
 *    - Looks up the cached dataset by queryKey.
 *    - If cached: immediately updates listId and source datasets, loading = false.
 *    - If not cached: clears stale listId data so previous route data never leaks, loading = true.
 * 2. Returns the list of queries that still need network dispatch.
 */
export function syncActiveRouteQueries(
  files: Map<string, string>,
  activeFilePaths: string[],
  routeParams: Record<string, string>,
  url: string,
): RouteQuerySyncResult {
  const neededQueries: Array<{
    query: DetectedQuery;
    queryKey: string;
    resolvedParams: Record<string, string>;
  }> = [];

  for (const filePath of activeFilePaths) {
    const content = files.get(filePath);
    if (!content) continue;
    const queries = detectCollectionQueries(content);
    for (const q of queries) {
      const resolvedParams = evaluateQueryParamExpressions(q.queryConfig, routeParams);
      const queryKey = buildPreviewQueryKey(q.source, resolvedParams);
      const cached = previewDatasets.get(queryKey);
      if (cached !== undefined) {
        setPreviewDataset(q.listId, cached);
        setPreviewDataset(q.source, cached);
        setPreviewQueryStatus(q.listId, { loading: false, error: null });
        setPreviewQueryStatus(q.source, { loading: false, error: null });
      } else {
        // Evict stale dataset from a previous route so it cannot leak or invert
        setPreviewDataset(q.listId, []);
        setPreviewDataset(q.source, []);
        setPreviewQueryStatus(q.listId, { loading: true, error: null });
        setPreviewQueryStatus(q.source, { loading: true, error: null });
        neededQueries.push({ query: q, queryKey, resolvedParams });
      }
    }
  }

  return { neededQueries };
}

