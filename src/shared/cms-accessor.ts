// cms-accessor.ts — Canonical item identity, pure nested accessors, and dataset key helpers.
// Supports both local CMS items (_id, _slug, _status) and API CMS items (id, slug, custom fields).

import type { CollectionItem, ApiItem, CmsItem, CmsQueryResult } from './types';

export type { CollectionItem, ApiItem, CmsItem, CmsQueryResult };

export interface DatasetKeyParams {
  project?: string;
  branch?: string;
  page?: string;
  listNodeId?: string;
  queryHash?: string;
  params?: Record<string, any> | string;
}

/**
 * Pure safe nested-value accessor supporting dot notation ('author.name')
 * and bracket/array notation ('items[0].name'). Safe against null and undefined.
 */
export function getNestedValue(obj: any, path: string | string[]): any {
  if (obj == null) return undefined;
  if (!path) return obj;

  if (Array.isArray(path)) {
    let current = obj;
    for (const seg of path) {
      if (current == null) return undefined;
      current = current[seg];
    }
    return current;
  }

  if (typeof path !== 'string') return undefined;

  // Direct property check if property key literally exists (e.g. obj['author.name'])
  if (typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, path)) {
    return obj[path];
  }

  // Parse path with dot and bracket notation: e.g. "a.b", "a[0].b", "a[0][1]"
  const normalized = path.replace(/\[(\w+)\]/g, '.$1');
  const segments = normalized.split('.').filter(Boolean);

  let current = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    current = current[seg];
  }
  return current;
}

/**
 * Returns canonical record identifier.
 * Priority: custom idField -> _id -> id -> _slug -> slug.
 */
export function getItemRecordId(
  item: Record<string, any> | undefined | null,
  idField?: string,
): string | number | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const custom = idField ? (item[idField] ?? getNestedValue(item, idField)) : undefined;
  const val = (custom != null && custom !== '')
    ? custom
    : (item._id ?? item.id ?? item._slug ?? item.slug);
  return val != null ? val : undefined;
}

/**
 * Returns canonical route slug.
 * Priority: custom slugField -> _slug -> slug -> id -> _id -> ''.
 * Local items continue to respect _slug first, while API items without _slug resolve slug.
 */
export function getItemSlug(
  item: Record<string, any> | undefined | null,
  slugField?: string,
): string {
  if (!item || typeof item !== 'object') return '';
  const custom = slugField ? (item[slugField] ?? getNestedValue(item, slugField)) : undefined;
  const val = (custom != null && custom !== '')
    ? custom
    : (item._slug ?? item.slug ?? item.id ?? item._id ?? '');
  return val != null ? String(val) : '';
}

/**
 * Returns human-readable display label.
 * Priority: custom labelField -> title -> name -> label -> headline -> header -> getItemSlug(item) -> String(getItemRecordId(item)) -> ''.
 */
export function getItemDisplayLabel(
  item: Record<string, any> | undefined | null,
  labelField?: string,
): string {
  if (!item || typeof item !== 'object') return '';
  const custom = labelField ? (item[labelField] ?? getNestedValue(item, labelField)) : undefined;
  if (custom != null && custom !== '') return String(custom);

  const title = item.title ?? item.name ?? item.label ?? item.headline ?? item.header;
  if (title != null && title !== '') return String(title);

  const textKey = Object.keys(item).find(
    (k) => !k.startsWith('_') && k !== 'id' && typeof item[k] === 'string' && (item[k] as string).trim(),
  );
  if (textKey && item[textKey]) return String(item[textKey]);

  const slug = getItemSlug(item);
  if (slug) return slug;

  const recordId = getItemRecordId(item);
  if (recordId != null && recordId !== '') return String(recordId);

  return '';
}

/**
 * Deterministic dataset identity key builder.
 * Combines project, branch, page, listNodeId, queryHash, and sorted params into a canonical key.
 */
export function buildDatasetKey(options: DatasetKeyParams): string {
  const {
    project = '',
    branch = '',
    page = '',
    listNodeId = '',
    queryHash = '',
    params,
  } = options;

  let serializedParams = '';
  if (params != null) {
    if (typeof params === 'string') {
      serializedParams = params;
    } else if (typeof params === 'object') {
      const sortedKeys = Object.keys(params).sort();
      const sortedObj: Record<string, any> = {};
      for (const k of sortedKeys) {
        sortedObj[k] = params[k];
      }
      serializedParams = JSON.stringify(sortedObj);
    }
  }

  return [project, branch, page, listNodeId, queryHash, serializedParams].join(':');
}
