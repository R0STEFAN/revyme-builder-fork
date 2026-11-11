// vibe-models.ts — model catalog for the Vibe panel's model select.
//
// The authoritative list lives in the AI service (GET /api/freeform/models —
// the same catalog its turn endpoint validates against). This module fetches
// it once per session and falls back to a static mirror when the service is
// unreachable (standalone/self-host: the select still renders, the server
// clamps whatever id it receives, so a stale mirror is harmless).

import { trace } from '@/shared/debug-trace';

export interface VibeModel {
  /** OpenRouter model slug — sent verbatim in the freeform turn body. */
  id: string;
  label: string;
  vendor: 'anthropic' | 'openai' | 'google';
  tier: 'fast' | 'standard' | 'best';
}

const AI_SERVICE_URL = import.meta.env.VITE_AI_SERVICE_URL || 'http://localhost:8082';

/** Static mirror of the server catalog (ai-generator model-catalog.ts). */
export const FALLBACK_MODELS: VibeModel[] = [
  // Claude
  { id: 'claude-sonnet-4-6',             label: 'Claude Sonnet 4.6 (Thinking)', vendor: 'anthropic', tier: 'standard' },
  { id: 'claude-opus-4-6-thinking',      label: 'Claude Opus 4.6 (Thinking)',   vendor: 'anthropic', tier: 'best' },
  { id: 'anthropic/claude-sonnet-5',     label: 'Claude Sonnet 5',              vendor: 'anthropic', tier: 'standard' },
  { id: 'anthropic/claude-opus-5.5',     label: 'Claude Opus 5.5',              vendor: 'anthropic', tier: 'best' },
  { id: 'anthropic/claude-fable-5.1',    label: 'Claude Fable 5.1',             vendor: 'anthropic', tier: 'best' },
  // ChatGPT / OpenAI
  { id: 'gpt-oss-120b-medium',           label: 'GPT-OSS 120B (Medium)',        vendor: 'openai',    tier: 'standard' },
  { id: 'openai/gpt-6-sol',              label: 'GPT-6 Sol',                    vendor: 'openai',    tier: 'standard' },
  // Gemini / Google
  { id: 'gemini-3.8-flash-high',         label: 'Gemini 3.8 Flash (High)',      vendor: 'google',    tier: 'best' },
  { id: 'gemini-3.8-flash-medium',       label: 'Gemini 3.8 Flash (Medium)',    vendor: 'google',    tier: 'standard' },
  { id: 'gemini-3.8-flash-low',          label: 'Gemini 3.8 Flash (Low)',       vendor: 'google',    tier: 'fast' },
  { id: 'google/gemini-3.8-flash',       label: 'Gemini 3.8 Flash',             vendor: 'google',    tier: 'standard' },
];

export const FALLBACK_DEFAULT = 'anthropic/claude-sonnet-5';

/** Static mirror of the server's RETIRED_MODELS: a model that left the
 *  catalog → the one that replaced it (the server runs a saved old id on it). */
export const FALLBACK_RETIRED: Record<string, string> = {
  'google/gemini-2.5-flash': 'gemini-3.8-flash-low',
  'google/gemini-2.5-pro': 'gemini-3.8-flash-medium',
  'google/gemini-3.1-pro-preview': 'gemini-3.8-flash-high',
  'google/gemini-3.5-flash-lite': 'gemini-3.8-flash-low',
  'google/gemini-3.5-flash': 'gemini-3.8-flash-medium',
  'google/gemini-3.8-flash': 'gemini-3.8-flash-medium',
  'anthropic/claude-fable-5': 'anthropic/claude-fable-5.1',
  'anthropic/claude-opus-4.8': 'anthropic/claude-opus-5.5',
  'anthropic/claude-haiku-4.5': 'claude-sonnet-4-6',
  'openai/gpt-5.5': 'gpt-oss-120b-medium',
  'openai/gpt-5.3-codex': 'gpt-oss-120b-medium',
  'openai/gpt-5.4-mini': 'gpt-oss-120b-medium',
  'openai/gpt-6-luna': 'gpt-oss-120b-medium',
  'openai/gpt-6-astra': 'gpt-oss-120b-medium',
};

export const VENDOR_LABELS: Record<VibeModel['vendor'], string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  google: 'Gemini',
};

export interface VibeModelCatalog {
  models: VibeModel[];
  defaultModel: string;
  /** Retired id → its successor (what the server runs a saved old id on). */
  retired?: Record<string, string>;
}

let catalogCache = new Map<string, Promise<VibeModelCatalog>>();

/** Fetch the live catalog dynamically per agent; on failure return the static
 *  mirror WITHOUT caching, so a later open retries the service. */
export function fetchVibeModels(agent?: string, forceRefresh = false): Promise<VibeModelCatalog> {
  const cacheKey = (agent || 'all').toLowerCase();
  if (forceRefresh) {
    catalogCache.delete(cacheKey);
  }
  const existing = catalogCache.get(cacheKey);
  if (existing) return existing;

  const url = agent
    ? `${AI_SERVICE_URL}/api/agent/models?agent=${encodeURIComponent(agent)}`
    : `${AI_SERVICE_URL}/api/freeform/models`;

  const promise = (async () => {
    const urls = [
      agent ? `${AI_SERVICE_URL}/api/agent/models?agent=${encodeURIComponent(agent)}` : `${AI_SERVICE_URL}/api/freeform/models`,
    ];
    if (!AI_SERVICE_URL.includes('127.0.0.1:8082') && !AI_SERVICE_URL.includes('localhost:8082')) {
      urls.push(agent ? `http://127.0.0.1:8082/api/agent/models?agent=${encodeURIComponent(agent)}` : 'http://127.0.0.1:8082/api/freeform/models');
    }
    if (typeof window !== 'undefined' && window.location.origin && !urls.some((u) => u.startsWith(window.location.origin))) {
      urls.push(agent ? `${window.location.origin}/api/agent/models?agent=${encodeURIComponent(agent)}` : `${window.location.origin}/api/freeform/models`);
    }

    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (r.ok) {
          const d = (await r.json()) as { models?: VibeModel[]; defaultModel?: string; retired?: Record<string, string> };
          const models = Array.isArray(d.models) && d.models.length ? d.models : FALLBACK_MODELS;
          const catalog = { models, defaultModel: d.defaultModel || FALLBACK_DEFAULT, retired: d.retired ?? FALLBACK_RETIRED };
          trace.action('vibe-models:fetched', { agent: cacheKey, count: models.length, defaultModel: catalog.defaultModel, url: u });
          return catalog;
        }
      } catch {
        // try next fallback url
      }
    }
    return { models: FALLBACK_MODELS, defaultModel: FALLBACK_DEFAULT, retired: FALLBACK_RETIRED };
  })()
    .catch((err) => {
      trace.error('vibe-models:fetch-failed', { agent: cacheKey, err: String(err?.message ?? err) });
      catalogCache.delete(cacheKey); // retry next time — do not cache the failure
      return { models: FALLBACK_MODELS, defaultModel: FALLBACK_DEFAULT, retired: FALLBACK_RETIRED };
    });

  catalogCache.set(cacheKey, promise);
  return promise;
}

/** Test seam. */
export function resetVibeModelCache(): void {
  catalogCache.clear();
}

/** Display label for a model id — falls back to the slug tail so an id the
 *  catalog no longer lists still renders something readable. */
export function vibeModelLabel(id: string | undefined, models: VibeModel[]): string {
  if (!id) return models.find((m) => m.id === FALLBACK_DEFAULT)?.label ?? 'Default';
  const hit = models.find((m) => m.id === id);
  if (hit) return hit.label;
  const tail = id.split('/').pop() ?? id;
  return tail;
}

/** Group models by vendor in a stable vendor order for the select popup. */
export function groupByVendor(models: VibeModel[]): Array<{ vendor: VibeModel['vendor']; label: string; models: VibeModel[] }> {
  const order: VibeModel['vendor'][] = ['anthropic', 'openai', 'google'];
  return order
    .map((vendor) => ({ vendor, label: VENDOR_LABELS[vendor], models: models.filter((m) => m.vendor === vendor) }))
    .filter((g) => g.models.length > 0);
}
