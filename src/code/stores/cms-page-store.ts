// cms-page-store.ts — Atoms for CMS detail-page editor mode.
//
// Two pieces of editor-only state:
//   - `cmsPageMetaAtom`     — derives the @cmsPage annotation from the
//     active file's code (collection + kind). Null on regular pages.
//   - `previewSlugAtom`     — per-file map of the slug currently being
//     previewed in the editor. Detail pages render ONE item at a time;
//     this controls which one. Defaults to the first item.

import { atom } from 'jotai';
// LIVE code, not the stable mirror: the mirror lags ~450ms BY CONTRACT
// (useStableAtomSync defers so undo visuals beat the parser cascade) — and
// riding it made the slug breadcrumb + detail-page bindings pop in half a
// second AFTER a page switch. The annotation-substring cache below keeps the
// live subscription cheap: per-keystroke code changes never touch the
// @cmsPage block, so the atom re-emits only when the block itself changes.
import { codeAtom } from './store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { collectionDataAtom } from './cms-store';
import { parseCmsPageMeta, type CmsPageMeta } from '@/code/project/cms-page-ops';
import { trace } from '@/shared/debug-trace';

/**
 * Parsed @cmsPage annotation for the active file. Null when:
 *   - the file isn't a CMS detail/index page, OR
 *   - the annotation is malformed (the parser logs to trace.error)
 */
const CMS_PAGE_BLOCK_RE = /\/\*\*\s*@cmsPage\s*\{[\s\S]*?\}\s*\*\//;
let _metaSrc: string | null | undefined;
let _metaResult: CmsPageMeta | null = null;
export const cmsPageMetaAtom = atom<CmsPageMeta | null>((get) => {
  const code = get(codeAtom);
  if (!code) return null;
  // Same-reference cache keyed on the annotation block text — a live-code
  // subscription otherwise re-parses (and re-notifies subscribers with a
  // fresh object) on EVERY edit/drag frame even though the annotation is
  // untouched.
  const src = code.match(CMS_PAGE_BLOCK_RE)?.[0] ?? null;
  if (src === _metaSrc) return _metaResult;
  _metaSrc = src;
  _metaResult = src ? parseCmsPageMeta(code) : null;
  trace.fn('cms-page-store:meta', { kind: _metaResult?.kind ?? null, collection: _metaResult?.collection ?? null });
  return _metaResult;
});

/**
 * Per-file preview-slug mapping. We key by file path because each detail
 * page can be designed against a different "active" item independently.
 * Editing /articles/[slug] with `post-1` previewed shouldn't affect a
 * later visit to /authors/[slug] which might be previewing a different
 * person.
 */
export const previewSlugByFileAtom = atom<Map<string, string>>(new Map());

/**
 * Per-slug-page "where did I come from" map (slugPageFile → referrerFile).
 * Recorded when the user navigates INTO a `[slug]` detail page, so the slug
 * breadcrumb can lead with an [origin page] segment to go back to. In-memory
 * (resets on reload) — the breadcrumb falls back to the slug page's PARENT
 * route (`getSlugPageParentFile`) when there's no recorded referrer.
 */
export const slugPageReferrerByFileAtom = atom<Map<string, string>>(new Map());

/**
 * Convenience — the slug currently previewed for the ACTIVE file. Falls
 * back to the first item's slug in the relevant collection so a freshly-
 * opened detail page renders something instead of an empty template.
 */
export const activePreviewSlugAtom = atom<string | null>((get) => {
  const meta = get(cmsPageMetaAtom);
  if (meta?.kind !== 'detail') return null;
  const filePath = get(activeFilePathAtom);
  const explicit = get(previewSlugByFileAtom).get(filePath);
  if (explicit) return explicit;
  // Fallback to the first item in the collection — matches the runtime
  // `find(...) ?? collection[0]` fallback in the generated page so the
  // canvas matches what a user would see if they visited the bare URL.
  const items = get(collectionDataAtom).get(meta.collection) ?? [];
  return items[0]?._slug ?? null;
});

/**
 * The actual item record being previewed. Resolves to null when no detail
 * page is active or no items exist.
 */
export const activePreviewItemAtom = atom<Record<string, any> | null>((get) => {
  const meta = get(cmsPageMetaAtom);
  if (meta?.kind !== 'detail') return null;
  const slug = get(activePreviewSlugAtom);
  if (!slug) return null;
  const items = get(collectionDataAtom).get(meta.collection) ?? [];
  return items.find(i => i._slug === slug) ?? items[0] ?? null;
});

/**
 * Extract dynamic parameter names from a file path.
 * E.g. 'app/gallery/[category]/[place]/page.client.tsx' → ['category', 'place']
 * E.g. 'app/articles/[slug]/page.tsx' → ['slug']
 * E.g. 'app/[...slug]/page.tsx' → ['slug']
 */
export function extractRouteParamNames(filePath: string): string[] {
  if (!filePath) return [];
  const matches = Array.from(filePath.matchAll(/\[(?:\.\.\.)?([a-zA-Z0-9_-]+)\]/g));
  return Array.from(new Set(matches.map(m => m[1])));
}

const ROUTE_PARAMS_STORAGE_KEY = 'revyme_preview_route_params';
const ROUTE_PARAMS_HISTORY_KEY = 'revyme_route_param_history';

function loadSavedRouteParams(): Map<string, Record<string, string>> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(ROUTE_PARAMS_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Map(parsed);
    } else if (parsed && typeof parsed === 'object') {
      return new Map(Object.entries(parsed));
    }
  } catch {}
  return new Map();
}

function saveRouteParamsToStorage(map: Map<string, Record<string, string>>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ROUTE_PARAMS_STORAGE_KEY, JSON.stringify(Array.from(map.entries())));
  } catch {}
}

function loadRouteParamHistory(): Record<string, string[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ROUTE_PARAMS_HISTORY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {}
  return {};
}

function saveRouteParamHistoryToStorage(history: Record<string, string[]>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ROUTE_PARAMS_HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

const _previewRouteParamsByFileBaseAtom = atom<Map<string, Record<string, string>>>(loadSavedRouteParams());

/**
 * Per-file preview route parameters mapping.
 * Keyed by file path -> Record<paramName, value>.
 */
export const previewRouteParamsByFileAtom = atom(
  (get) => get(_previewRouteParamsByFileBaseAtom),
  (get, set, update: Map<string, Record<string, string>> | ((prev: Map<string, Record<string, string>>) => Map<string, Record<string, string>>)) => {
    const current = get(_previewRouteParamsByFileBaseAtom);
    const next = typeof update === 'function' ? update(current) : update;
    saveRouteParamsToStorage(next);
    set(_previewRouteParamsByFileBaseAtom, next);
  }
);

const _routeParamHistoryBaseAtom = atom<Record<string, string[]>>(loadRouteParamHistory());

/**
 * History of previously entered test values per parameter.
 * Keyed by paramName -> string[] (most recent first).
 */
export const routeParamHistoryAtom = atom(
  (get) => get(_routeParamHistoryBaseAtom),
  (get, set, update: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>)) => {
    const current = get(_routeParamHistoryBaseAtom);
    const next = typeof update === 'function' ? update(current) : update;
    saveRouteParamHistoryToStorage(next);
    set(_routeParamHistoryBaseAtom, next);
  }
);

/**
 * Push a value into history for a route parameter.
 */
export const recordRouteParamHistoryAtom = atom(
  null,
  (get, set, { param, value }: { param: string; value: string }) => {
    const val = value.trim();
    if (!val || !param) return;
    const current = get(routeParamHistoryAtom);
    const list = current[param] ? [...current[param]] : [];
    const filtered = list.filter(v => v.toLowerCase() !== val.toLowerCase());
    const updated = [val, ...filtered].slice(0, 20); // keep up to 20 recent
    const next = { ...current, [param]: updated };
    set(routeParamHistoryAtom, next);
  }
);

/**
 * Remove a specific value from history for a route parameter.
 */
export const removeRouteParamHistoryAtom = atom(
  null,
  (get, set, { param, value }: { param: string; value: string }) => {
    if (!param || !value) return;
    const current = get(routeParamHistoryAtom);
    const list = current[param] ? current[param].filter(v => v !== value) : [];
    const next = { ...current, [param]: list };
    set(routeParamHistoryAtom, next);
  }
);

export interface ParamSuggestion {
  value: string;
  name: string;
  source: string;
  isHistory?: boolean;
}

/**
 * Returns suggestions for a given route param from CMS collections.
 */
export function getCmsSuggestionsForParam(
  param: string,
  allData: Map<string, any[]>,
): ParamSuggestion[] {
  const candidateSlugs = [
    param,
    param + 's',
    param + 'es',
    param.endsWith('y') ? param.slice(0, -1) + 'ies' : '',
    param === 'place' || param === 'placement' ? 'placements' : '',
    param === 'category' ? 'categories' : '',
  ].filter(Boolean);

  const seen = new Set<string>();
  const suggestions: ParamSuggestion[] = [];

  for (const cs of candidateSlugs) {
    if (allData.has(cs)) {
      const items = allData.get(cs) || [];
      for (const item of items) {
        const val = String(item?.slug ?? item?._slug ?? item?.id ?? '').trim();
        if (!val || seen.has(val.toLowerCase())) continue;
        seen.add(val.toLowerCase());
        const name = String(item?.name ?? item?.title ?? item?.seoTitle ?? '').trim();
        suggestions.push({
          value: val,
          name: name && name !== val ? name : '',
          source: cs,
        });
      }
    }
  }

  return suggestions;
}

const EMPTY_ROUTE_PARAMS: Record<string, string> = Object.freeze({});
let _lastParamsFilePath = '';
let _lastParamsJson = '';
let _lastParamsResult: Record<string, string> = EMPTY_ROUTE_PARAMS;

/**
 * Preview route params for the active file.
 * Automatically extracts param names and falls back to smart preview values
 * (e.g. 'men' for category, 'chest' for place/placement) or active preview slug for 'slug'.
 */
export const activePreviewRouteParamsAtom = atom<Record<string, string>>((get) => {
  const filePath = get(activeFilePathAtom);
  const paramNames = extractRouteParamNames(filePath);
  if (paramNames.length === 0) return EMPTY_ROUTE_PARAMS;

  const fileParams = get(previewRouteParamsByFileAtom).get(filePath) || {};
  const activeSlug = get(activePreviewSlugAtom);
  const allData = get(collectionDataAtom);
  const result: Record<string, string> = {};

  for (const name of paramNames) {
    if (fileParams[name] !== undefined) {
      result[name] = fileParams[name];
    } else if (name === 'slug' && activeSlug) {
      result[name] = activeSlug;
    } else {
      // Find candidate collection by param name
      const candidateSlugs = [
        name,
        name + 's',
        name + 'es',
        name.endsWith('y') ? name.slice(0, -1) + 'ies' : '',
        name === 'place' || name === 'placement' ? 'placements' : '',
        name === 'category' ? 'categories' : '',
      ].filter(Boolean);

      let foundSlug = '';
      for (const cs of candidateSlugs) {
        if (allData.has(cs)) {
          const items = allData.get(cs) || [];
          if (items.length > 0) {
            foundSlug = items[0]?.slug ?? items[0]?._slug ?? String(items[0]?.id ?? '');
            break;
          }
        }
      }

      if (foundSlug) {
        result[name] = foundSlug;
      } else if (name === 'category') {
        result[name] = 'men';
      } else if (name === 'place' || name === 'placement') {
        result[name] = 'noga';
      } else {
        result[name] = '';
      }
    }
  }

  const json = JSON.stringify(result);
  if (filePath === _lastParamsFilePath && json === _lastParamsJson) {
    return _lastParamsResult;
  }
  _lastParamsFilePath = filePath;
  _lastParamsJson = json;
  _lastParamsResult = Object.freeze(result);
  return _lastParamsResult;
});



