// preview-api-query.ts — API query executor and dataset cache for the in-house preview sandbox.
// Detects query configs in routed pages, executes queries across the postMessage bridge
// to parent PreviewOverlay, maintains per-node / per-source datasets, and supports
// dynamic route transitions without full page reloads.

import * as React from 'react';
import type { CollectionQueryConfig } from '@/shared/types';

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

// ─── Query Param Evaluation ──────────────────────────────────────────────────

/** Safely evaluate expression like `params.category` or `params.category || "all"` against route params. */
export function evaluateParamExpression(expr: string, params: Record<string, string>): string {
  if (!expr || !expr.trim()) return '';
  const trimmed = expr.trim();
  try {
    const fn = new Function('params', `with({ params }) { return (${trimmed}); }`);
    const val = fn(params || {});
    return val !== undefined && val !== null ? String(val) : '';
  } catch {
    const match = trimmed.match(/^params\.([a-zA-Z0-9_]+)$/);
    if (match && params && params[match[1]] !== undefined) {
      return String(params[match[1]]);
    }
    return '';
  }
}

/** Evaluate all parameters in a CollectionQueryConfig against current route parameters. */
export function evaluateQueryParamExpressions(
  queryConfig: CollectionQueryConfig | undefined,
  routeParams: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!queryConfig || !Array.isArray(queryConfig.params)) return result;
  for (const p of queryConfig.params) {
    if (!p.key) continue;
    if (p.isExpression) {
      result[p.key] = evaluateParamExpression(p.value, routeParams);
    } else {
      result[p.key] = p.value ?? '';
    }
  }
  return result;
}

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

  // Find tags with data-query-config
  // Handles both <tag ... data-id="..." ... data-query-config={...}> ... </tag>
  // and self-closing or multi-line configurations.
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

    // Search for the collection variable mapped inside this container
    // Find matching close tag or search next chunk of code
    const closeTagStr = `</${tagName}>`;
    const closeIndex = code.indexOf(closeTagStr, openTagEnd);
    const innerContent = closeIndex !== -1 ? code.slice(openTagEnd, closeIndex) : code.slice(openTagEnd, openTagEnd + 2000);

    let source = (queryConfig as any).source || '';
    if (!source) {
      const mapMatch = innerContent.match(/\{([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+)*\.map\(/);
      if (mapMatch) {
        const varName = mapMatch[1];
        source = importMap.get(varName) || varName;
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
    const tagClose = result.indexOf('>', idIdx);
    if (tagClose === -1) continue;

    // Search for close tag
    const tagMatch = result.slice(elStart + 1).match(/^([a-zA-Z0-9_-]+)/);
    if (!tagMatch) continue;
    const tagName = tagMatch[1];
    const closeTagStr = `</${tagName}>`;
    const elEnd = result.indexOf(closeTagStr, tagClose);
    if (elEnd === -1) continue;

    const inner = result.slice(tagClose + 1, elEnd);
    // Find `{<varName>(.filter|.sort|.slice)*.map(`
    // where varName maps to source or is equal to source
    const mapRegex = new RegExp(`(\\{\\s*)(${source})(\\s*(?:\\.[a-zA-Z0-9_]+\\([^)]*\\))*\\s*\\.map\\()`, 'g');
    if (!mapRegex.test(inner)) continue;

    const wrappedInner = inner.replace(
      mapRegex,
      `$1((typeof __getPreviewData === 'function' && __getPreviewData('${source}', '${listId}')) || $2)$3`,
    );

    result = result.slice(0, tagClose + 1) + wrappedInner + result.slice(elEnd);
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
