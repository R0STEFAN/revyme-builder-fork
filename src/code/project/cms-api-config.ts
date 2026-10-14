// cms-api-config.ts — Configuration and storage for External API / Headless CMS collections.
// Stored in _meta/cms-api-config.json in ProjectFS.

import { projectFS } from './project-fs';
import { triggerAutosave } from '@/backend/autosave';
import { trace } from '@/shared/debug-trace';

export const CMS_API_CONFIG_PATH = '_meta/cms-api-config.json';

export type ApiProvider = 'directus' | 'baserow' | 'strapi' | 'custom_rest';

export interface ApiCollectionConfig {
  slug: string;
  name: string;
  provider: ApiProvider;
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>; // e.g. { Authorization: "Bearer env:DIRECTUS_TOKEN" }
  defaultParams?: Record<string, string>; // e.g. { fields: "*.*", user_field_names: "true" }
  cacheMaxAge?: number; // in seconds, default: 14400 (4 hours)
  itemsKey?: string; // e.g. "data" for Directus/Strapi, "results" for Baserow
  idField?: string;
  slugField?: string;
}

export interface CmsProjectConfig {
  mode: 'local' | 'api';
  apiCollections: Record<string, ApiCollectionConfig>;
}

const DEFAULT_CONFIG: CmsProjectConfig = {
  mode: 'local',
  apiCollections: {},
};

/** Load the project CMS mode and API collection configurations from _meta/cms-api-config.json */
export function loadCmsProjectConfig(): CmsProjectConfig {
  try {
    const raw = projectFS.readFile(CMS_API_CONFIG_PATH);
    if (!raw) return { ...DEFAULT_CONFIG, apiCollections: {} };
    const parsed = JSON.parse(raw);
    const mode = parsed.mode === 'api' ? 'api' : 'local';
    const apiCollections = (typeof parsed.apiCollections === 'object' && parsed.apiCollections !== null)
      ? parsed.apiCollections
      : {};
    trace.fn('cms-api-config:loadCmsProjectConfig', { mode, collectionCount: Object.keys(apiCollections).length });
    return { mode, apiCollections };
  } catch (err: any) {
    trace.error('cms-api-config:loadCmsProjectConfig', { error: err?.message });
    return { ...DEFAULT_CONFIG, apiCollections: {} };
  }
}

/** Save CMS configuration to _meta/cms-api-config.json */
export function saveCmsProjectConfig(config: CmsProjectConfig): void {
  trace.fn('cms-api-config:saveCmsProjectConfig', { mode: config.mode, collections: Object.keys(config.apiCollections) });
  projectFS.writeFile(CMS_API_CONFIG_PATH, JSON.stringify(config, null, 2));
  triggerAutosave();
}

/** Retrieve an API collection configuration by slug */
export function getApiCollection(slug: string): ApiCollectionConfig | null {
  const config = loadCmsProjectConfig();
  if (config.mode !== 'api') return null;
  return config.apiCollections[slug] ?? null;
}

/** Save or update an API collection configuration */
export function saveApiCollection(slug: string, apiConfig: ApiCollectionConfig): void {
  const config = loadCmsProjectConfig();
  config.apiCollections[slug] = apiConfig;
  saveCmsProjectConfig(config);
}

/** Remove an API collection configuration */
export function removeApiCollection(slug: string): void {
  const config = loadCmsProjectConfig();
  if (config.apiCollections[slug]) {
    delete config.apiCollections[slug];
    saveCmsProjectConfig(config);
  }
}

/** Set the CMS operation mode ('local' | 'api') */
export function setCmsMode(mode: 'local' | 'api'): void {
  const config = loadCmsProjectConfig();
  if (config.mode !== mode) {
    config.mode = mode;
    saveCmsProjectConfig(config);
  }
}

/**
 * Resolves env references in headers.
 * Supports:
 * - env:TOKEN
 * - process.env.TOKEN
 * - $TOKEN
 * E.g. "Bearer env:AUDIT_TOKEN" -> "Bearer " + envVars.AUDIT_TOKEN
 */
export function resolveEnvHeaders(
  headers: Record<string, string> | undefined,
  envVars: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const env = envVars || {};

  for (const [key, value] of Object.entries(headers)) {
    if (!key.trim() || value === undefined || value === null) continue;
    const val = String(value);

    // Single-pass replacement avoids treating resolved values containing '$' as further variable references
    result[key] = val.replace(/(?:process\.env\.|env:|\$)([A-Za-z0-9_]+)/g, (_, name) => env[name] ?? '');
  }

  return result;
}

/**
 * Canonical URL builder for API CMS collections.
 * Merges apiConfig.defaultParams and queryParams safely without duplicating query string delimiters.
 */
export function buildApiRequestUrl(
  apiConfig: ApiCollectionConfig,
  queryParams?: Record<string, string>,
): string {
  const rawUrl = apiConfig.url || '';
  try {
    const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl);
    const urlObj = new URL(rawUrl, typeof location !== 'undefined' ? location.origin : 'http://localhost');

    if (apiConfig.defaultParams) {
      for (const [k, v] of Object.entries(apiConfig.defaultParams)) {
        if (v !== undefined && v !== null && v !== '') {
          urlObj.searchParams.set(k, String(v));
        }
      }
    }
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== '') {
          urlObj.searchParams.set(k, String(v));
        }
      }
    }

    if (isAbsolute) {
      return urlObj.toString();
    } else {
      return `${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
    }
  } catch {
    const [base, existingQuery] = rawUrl.split('?');
    const params = new URLSearchParams(existingQuery || '');
    if (apiConfig.defaultParams) {
      for (const [k, v] of Object.entries(apiConfig.defaultParams)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
    }
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }
}

/**
 * Extracts items safely from root array or configured itemsKey, data, results, items.
 * Returns [] if empty, preserving empty array distinction from null/error.
 */
export function extractApiItems(responseJson: any, itemsKey?: string): any[] {
  if (!responseJson || typeof responseJson !== 'object') {
    return Array.isArray(responseJson) ? responseJson : [];
  }

  if (itemsKey) {
    if (Array.isArray(responseJson[itemsKey])) {
      return responseJson[itemsKey];
    }
    if (itemsKey.includes('.')) {
      const parts = itemsKey.split('.');
      let cur = responseJson;
      for (const part of parts) {
        if (!cur || typeof cur !== 'object') {
          cur = undefined;
          break;
        }
        cur = cur[part];
      }
      if (Array.isArray(cur)) return cur;
    }
  }

  if (Array.isArray(responseJson)) {
    return responseJson;
  }
  if (Array.isArray(responseJson.data)) {
    return responseJson.data;
  }
  if (Array.isArray(responseJson.results)) {
    return responseJson.results;
  }
  if (Array.isArray(responseJson.items)) {
    return responseJson.items;
  }

  return [];
}

/**
 * Detects which key contains the array of items in an API response if not already configured.
 */
export function detectApiItemsKey(responseJson: any, explicitKey?: string): string | undefined {
  if (!responseJson || typeof responseJson !== 'object') return undefined;
  if (explicitKey && Array.isArray(responseJson[explicitKey])) return explicitKey;
  if (Array.isArray(responseJson)) return undefined;
  if (Array.isArray(responseJson.data)) return 'data';
  if (Array.isArray(responseJson.results)) return 'results';
  if (Array.isArray(responseJson.items)) return 'items';
  return undefined;
}

