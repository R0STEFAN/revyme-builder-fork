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
