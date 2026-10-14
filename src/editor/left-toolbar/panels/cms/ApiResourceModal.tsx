// ApiResourceModal.tsx — Modal dialog for connecting and configuring external Headless CMS / REST API resources.
// Performs schema inference, proxy validation, and commits configuration to ProjectFS.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from '@/design-system/Modal';
import Button from '@/design-system/Button';
import { ToolInput, ToolSelect } from '@/editor/controls';
import { projectFS } from '@/code/project/project-fs';
import { saveCollectionSchema, saveCollectionData, slugify } from '@/code/project/cms-ops';
import {
  saveApiCollection,
  getApiCollection,
  setCmsMode,
  resolveEnvHeaders,
  buildApiRequestUrl,
  extractApiItems,
  detectApiItemsKey,
  type ApiCollectionConfig,
  type ApiProvider,
} from '@/code/project/cms-api-config';
import type { CollectionSchema, FieldDefinition } from '@/shared/types';
import { toast } from 'sonner';
import { trace } from '@/shared/debug-trace';

interface ApiResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSlug?: string;
  onSaved: (slug: string) => void;
}

const PROVIDER_OPTIONS: { value: ApiProvider; label: string }[] = [
  { value: 'directus', label: 'Directus' },
  { value: 'baserow', label: 'Baserow' },
  { value: 'strapi', label: 'Strapi' },
  { value: 'custom_rest', label: 'Custom REST API' },
];

/** Read .env.local from projectFS and parse KEY=VALUE pairs */
export function getEnvVariables(): Record<string, string> {
  const envRaw = projectFS.readFile('.env.local') || '';
  const result: Record<string, string> = {};
  for (const line of envRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      result[key] = val;
    }
  }
  return result;
}

export function formatFieldName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function inferFieldType(val: any, key: string): FieldDefinition['type'] {
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(T|\b)/.test(val)) return 'date';
    if (/\.(png|jpe?g|webp|gif|svg|avif)($|\?)/i.test(val)) return 'image';
    if (key.toLowerCase() === 'slug') return 'slug';
    if (val.includes('\n') || val.length > 80) return 'textarea';
    return 'text';
  }
  if (Array.isArray(val)) {
    if (val.length > 0 && typeof val[0] === 'string') return 'tags';
    return 'json';
  }
  if (val !== null && typeof val === 'object') {
    if (isLikelyImageField(key, val)) return 'image';
    if (isDirectusAsset(val)) return 'file';
    return 'json';
  }
  return 'text';
}

export function isDirectusAsset(val: any): boolean {
  if (!val || typeof val !== 'object') return false;
  if ('filename_disk' in val || 'filename_download' in val) return true;
  if ('id' in val && typeof val.type === 'string' && (val.type.startsWith('image/') || val.type.startsWith('video/') || val.type.startsWith('audio/') || val.type.includes('pdf'))) {
    return true;
  }
  return false;
}

export const TECHNICAL_ASSET_SUBFIELDS = new Set([
  'metadata',
  'filesize',
  'storage',
  'modified_on',
  'modified_by',
  'uploaded_on',
  'uploaded_by',
  'created_on',
  'created_by',
  'charset',
  'duration',
  'width',
  'height',
  'embed',
  'folder',
]);

export function isLikelyImageField(key: string, val: any): boolean {
  const lKey = key.toLowerCase();
  if (
    lKey.includes('img') ||
    lKey.includes('image') ||
    lKey.includes('photo') ||
    lKey.includes('picture') ||
    lKey.includes('avatar') ||
    lKey.includes('logo') ||
    lKey.includes('thumbnail') ||
    lKey.includes('cover')
  ) {
    return true;
  }
  if (val && typeof val === 'object') {
    if ('filename_disk' in val || 'filename_download' in val) return true;
    if (typeof val.type === 'string' && val.type.startsWith('image/')) return true;
    if (typeof val.mime_type === 'string' && val.mime_type.startsWith('image/')) return true;
    if (typeof val.url === 'string' && /\.(png|jpe?g|webp|gif|svg|avif)($|\?)/i.test(val.url)) return true;
  }
  return false;
}

/** Append key/value query parameters to a URL */
export function appendQueryParams(rawUrl: string, params: Array<{ key: string; value: string }>): string {
  if (!params || params.length === 0) return rawUrl;
  const valid = params.filter(p => p.key.trim().length > 0);
  if (valid.length === 0) return rawUrl;

  try {
    const urlObj = new URL(rawUrl);
    for (const p of valid) {
      urlObj.searchParams.set(p.key.trim(), p.value);
    }
    return urlObj.toString();
  } catch {
    const sep = rawUrl.includes('?') ? '&' : '?';
    const qs = valid.map(p => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`).join('&');
    return `${rawUrl}${sep}${qs}`;
  }
}

/** Infer CollectionSchema from an array of JSON objects */
export function inferSchemaFromItems(slug: string, name: string, items: any[]): CollectionSchema {
  const fieldsMap = new Map<string, FieldDefinition>();

  // Scan up to first 10 items to build schema
  const inspectItems = items.slice(0, 10);
  for (const item of inspectItems) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, val] of Object.entries(item)) {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        // Nested object (e.g. Directus file object, Strapi relation, author object)
        const isImg = isLikelyImageField(key, val);
        const isAsset = isImg || isDirectusAsset(val);
        const parentType: FieldDefinition['type'] = isImg ? 'image' : isAsset ? 'file' : 'json';
        if (!fieldsMap.has(key)) {
          fieldsMap.set(key, {
            id: key,
            name: formatFieldName(key),
            type: parentType,
          });
        } else if (isAsset && fieldsMap.get(key)!.type !== 'image' && fieldsMap.get(key)!.type !== 'file') {
          fieldsMap.get(key)!.type = parentType;
        }

        for (const [subKey, subVal] of Object.entries(val)) {
          if (isAsset && TECHNICAL_ASSET_SUBFIELDS.has(subKey.toLowerCase())) {
            continue;
          }
          const nestedId = `${key}.${subKey}`;
          if (!fieldsMap.has(nestedId)) {
            let subType = inferFieldType(subVal, subKey);
            if (subKey === 'filename_disk' || (typeof subVal === 'string' && /\.(png|jpe?g|webp|gif|svg|avif)($|\?)/i.test(subVal))) {
              subType = 'image';
            }
            if (typeof subVal === 'object' && subVal !== null) {
              subType = isLikelyImageField(subKey, subVal) ? 'image' : 'json';
            }
            fieldsMap.set(nestedId, {
              id: nestedId,
              name: `${formatFieldName(key)} → ${formatFieldName(subKey)}`,
              type: subType,
            });
          }
        }
        continue;
      }

      if (fieldsMap.has(key)) continue;

      fieldsMap.set(key, {
        id: key,
        name: formatFieldName(key),
        type: inferFieldType(val, key),
      });
    }
  }

  const fields = Array.from(fieldsMap.values());
  // Ensure title or name field is at top if present
  const titleIdx = fields.findIndex(f => f.id === 'title' || f.id === 'name');
  if (titleIdx > 0) {
    const [titleField] = fields.splice(titleIdx, 1);
    fields.unshift(titleField);
  }

  return {
    slug,
    name,
    fields,
  };
}

export function ApiResourceModal({
  isOpen,
  onClose,
  initialSlug,
  onSaved,
}: ApiResourceModalProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [provider, setProvider] = useState<ApiProvider>('directus');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [params, setParams] = useState<Array<{ key: string; value: string }>>([]);
  const [cacheMaxAge, setCacheMaxAge] = useState(14400);
  const [itemsKey, setItemsKey] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    items?: any[];
    rawJson?: any;
  } | null>(null);
  const [inferredSchema, setInferredSchema] = useState<CollectionSchema | null>(null);

  // Initialize from initialSlug if editing
  useEffect(() => {
    if (isOpen && initialSlug) {
      const existing = getApiCollection(initialSlug);
      if (existing) {
        setName(existing.name);
        setSlug(existing.slug);
        setProvider(existing.provider);
        setMethod(existing.method);
        setUrl(existing.url);
        setCacheMaxAge(existing.cacheMaxAge ?? 14400);
        setItemsKey(existing.itemsKey ?? '');
        setHeaders(
          Object.entries(existing.headers).map(([k, v]) => ({ key: k, value: v }))
        );
        if (existing.defaultParams) {
          setParams(
            Object.entries(existing.defaultParams).map(([k, v]) => ({ key: k, value: String(v) }))
          );
        } else {
          setParams([]);
        }
      }
    } else if (isOpen) {
      setName('');
      setSlug('');
      setProvider('directus');
      setMethod('GET');
      setUrl('');
      setCacheMaxAge(14400);
      setItemsKey('');
      setHeaders([{ key: 'Content-Type', value: 'application/json' }]);
      setParams([]);
      setTestResult(null);
      setInferredSchema(null);
    }
  }, [isOpen, initialSlug]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!initialSlug) {
      setSlug(slugify(val));
    }
  };

  // Smart URL parser: if user pastes URL with query params
  const handleUrlChange = (rawUrl: string) => {
    setUrl(rawUrl);
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        // If name is empty, auto-guess slug from URL path
        if (!name) {
          const segments = parsed.pathname.split('/').filter(Boolean);
          const last = segments[segments.length - 1];
          if (last) {
            const autoName = last.charAt(0).toUpperCase() + last.slice(1);
            setName(autoName);
            setSlug(slugify(autoName));
          }
        }
        // If query parameters are present in pasted URL, extract them
        if (parsed.searchParams.size > 0) {
          const extracted: Array<{ key: string; value: string }> = [];
          parsed.searchParams.forEach((val, key) => {
            extracted.push({ key, value: val });
          });
          setParams(prev => {
            const next = [...prev];
            for (const item of extracted) {
              const idx = next.findIndex(p => p.key === item.key);
              if (idx !== -1) {
                next[idx] = item;
              } else {
                next.push(item);
              }
            }
            return next;
          });
        }
      } catch {
        // Ignore invalid URL while typing
      }
    }
  };

  const handleAddHeader = () => {
    setHeaders(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(prev => prev.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', val: string) => {
    setHeaders(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleAddAuthPreset = (type: 'bearer' | 'baserow') => {
    const tokenEnvVar = `${(slug || 'API').toUpperCase()}_TOKEN`;
    const headerVal = type === 'bearer' ? `Bearer env:${tokenEnvVar}` : `Token env:${tokenEnvVar}`;
    setHeaders(prev => {
      const filtered = prev.filter(h => h.key.toLowerCase() !== 'authorization');
      return [...filtered, { key: 'Authorization', value: headerVal }];
    });
    toast.info(`Added Authorization header referencing env:${tokenEnvVar}`);
  };

  const handleAddParam = () => {
    setParams(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveParam = (index: number) => {
    setParams(prev => prev.filter((_, i) => i !== index));
  };

  const handleParamChange = (index: number, field: 'key' | 'value', val: string) => {
    setParams(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleAddFieldsPreset = () => {
    setParams(prev => {
      const existingIdx = prev.findIndex(p => p.key === 'fields');
      if (existingIdx !== -1) {
        const copy = [...prev];
        copy[existingIdx] = { key: 'fields', value: '*.*' };
        return copy;
      }
      return [...prev, { key: 'fields', value: '*.*' }];
    });
    toast.info('Added Directus fields: *.* query parameter');
  };

  // Test request via /api/proxy
  const handleTestConnection = async () => {
    if (!url) {
      toast.error('URL is required');
      return;
    }
    setTesting(true);
    setTestResult(null);
    const paramRecord = Object.fromEntries(
      params.filter(p => p.key.trim().length > 0).map(p => [p.key.trim(), p.value])
    );
    const testUrl = buildApiRequestUrl({ url, defaultParams: paramRecord } as ApiCollectionConfig);
    trace.action('api-resource:test-connection', { url: testUrl, method });

    try {
      const envVars = getEnvVariables();
      const headersRecord = Object.fromEntries(
        headers.filter(h => h.key.trim().length > 0).map(h => [h.key.trim(), h.value])
      );
      const resolvedHeaders = resolveEnvHeaders(headersRecord, envVars);

      const proxyRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: testUrl,
          method,
          headers: resolvedHeaders,
        }),
      });

      if (!proxyRes.ok) {
        throw new Error(`Upstream returned ${proxyRes.status} ${proxyRes.statusText}`);
      }

      const data = await proxyRes.json();
      const items = extractApiItems(data, itemsKey);
      const detectedKey = detectApiItemsKey(data, itemsKey);

      if (detectedKey && !itemsKey) {
        setItemsKey(detectedKey);
      }

      const effectiveSlug = slug || 'api_collection';
      const effectiveName = name || 'API Collection';
      const schema = inferSchemaFromItems(effectiveSlug, effectiveName, items);

      setInferredSchema(schema);
      setTestResult({
        success: true,
        message: `Loaded ${items.length} items. Inferred ${schema.fields.length} schema fields.`,
        items,
        rawJson: data,
      });
      toast.success(`Connected! Loaded ${items.length} items`);
    } catch (err: any) {
      trace.error('api-resource:test-error', { error: err.message });
      setTestResult({
        success: false,
        message: err.message || 'Failed to connect to API',
      });
      toast.error(err.message || 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveCollection = () => {
    const finalSlug = slug || slugify(name);
    if (!finalSlug) {
      toast.error('Slug or Name is required');
      return;
    }
    if (!url) {
      toast.error('Endpoint URL is required');
      return;
    }

    const headersRecord: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        headersRecord[h.key.trim()] = h.value.trim();
      }
    }

    const paramsRecord: Record<string, string> = {};
    for (const p of params) {
      if (p.key.trim()) {
        paramsRecord[p.key.trim()] = p.value.trim();
      }
    }

    const finalConfig: ApiCollectionConfig = {
      slug: finalSlug,
      name: name || finalSlug,
      provider,
      url,
      method,
      headers: headersRecord,
      defaultParams: Object.keys(paramsRecord).length > 0 ? paramsRecord : undefined,
      cacheMaxAge,
      itemsKey: itemsKey || undefined,
    };

    // 1. Commit config to _meta/cms-api-config.json
    saveApiCollection(finalSlug, finalConfig);
    setCmsMode('api');

    // 2. Save schema & preview data if inferred
    if (inferredSchema) {
      saveCollectionSchema(finalSlug, { ...inferredSchema, slug: finalSlug, name: name || finalSlug });
    }
    if (testResult?.items) {
      saveCollectionData(finalSlug, testResult.items);
    }

    toast.success(`API Collection "${finalConfig.name}" saved!`);
    onSaved(finalSlug);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Connect External API / CMS" width={820}>
      <div className="flex flex-col md:flex-row gap-6 p-4 text-xs text-[var(--text-primary)] max-h-[75vh] overflow-y-auto">
        {/* Left column: Request Configuration */}
        <div className="flex-1 flex flex-col gap-3 min-w-[320px]">
          <h4 className="font-semibold text-sm text-[var(--text-primary)] border-b border-[var(--border-light)] pb-1.5">
            Endpoint Configuration
          </h4>

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Name</label>
              <ToolInput
                value={name}
                onChange={handleNameChange}
                placeholder="e.g. Tattoos"
                text
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Slug</label>
              <ToolInput
                value={slug}
                onChange={setSlug}
                placeholder="e.g. tattoos"
                text
              />
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Provider</label>
              <ToolSelect
                value={provider}
                onChange={v => setProvider(v as ApiProvider)}
                options={PROVIDER_OPTIONS}
              />
            </div>
            <div className="w-24 flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Method</label>
              <ToolSelect
                value={method}
                onChange={v => setMethod(v as 'GET' | 'POST')}
                options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Endpoint URL</label>
            <ToolInput
              value={url}
              onChange={handleUrlChange}
              placeholder="https://api.example.com/items/tattoos"
              text
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Cache Max-Age (s)</label>
              <ToolInput
                value={String(cacheMaxAge)}
                onChange={v => setCacheMaxAge(Number(v) || 14400)}
                placeholder="14400"
                text
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Items Key</label>
              <ToolInput
                value={itemsKey}
                onChange={setItemsKey}
                placeholder="e.g. data or results"
                text
              />
            </div>
          </div>

          {/* Default Query Parameters Editor */}
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Default Query Parameters</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddFieldsPreset}
                  className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                >
                  + Directus fields (*.*)
                </button>
                <span className="text-[var(--text-disabled)]">•</span>
                <button
                  type="button"
                  onClick={handleAddParam}
                  className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer font-medium"
                >
                  + Add Param
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {params.length === 0 ? (
                <div className="text-[11px] text-[var(--text-disabled)] italic py-0.5">
                  No default query params (e.g. fields = *,img_file.*)
                </div>
              ) : (
                params.map((p, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input
                      type="text"
                      value={p.key}
                      onChange={e => handleParamChange(i, 'key', e.target.value)}
                      placeholder="Param Name (e.g. fields)"
                      className="w-2/5 bg-[var(--input-bg,rgba(255,255,255,0.05))] border border-[var(--border-light)] rounded px-1.5 py-1 text-[11px] text-[var(--text-primary)]"
                    />
                    <input
                      type="text"
                      value={p.value}
                      onChange={e => handleParamChange(i, 'value', e.target.value)}
                      placeholder="Value (e.g. *,img_file.*)"
                      className="flex-1 bg-[var(--input-bg,rgba(255,255,255,0.05))] border border-[var(--border-light)] rounded px-1.5 py-1 text-[11px] text-[var(--text-primary)] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveParam(i)}
                      className="text-[var(--text-disabled)] hover:text-red-400 p-1 cursor-pointer"
                      title="Remove Parameter"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Headers Editor */}
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">Headers</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleAddAuthPreset('bearer')}
                  className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                >
                  + Bearer
                </button>
                <span className="text-[var(--text-disabled)]">•</span>
                <button
                  type="button"
                  onClick={() => handleAddAuthPreset('baserow')}
                  className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                >
                  + Baserow
                </button>
                <span className="text-[var(--text-disabled)]">•</span>
                <button
                  type="button"
                  onClick={handleAddHeader}
                  className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer font-medium"
                >
                  + Add Header
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={h.key}
                    onChange={e => handleHeaderChange(i, 'key', e.target.value)}
                    placeholder="Header Name"
                    className="flex-1 bg-[var(--input-bg,rgba(255,255,255,0.05))] border border-[var(--border-light)] rounded px-1.5 py-1 text-[11px] text-[var(--text-primary)]"
                  />
                  <input
                    type="text"
                    value={h.value}
                    onChange={e => handleHeaderChange(i, 'value', e.target.value)}
                    placeholder="Value (e.g. Bearer env:TOKEN)"
                    className="flex-1 bg-[var(--input-bg,rgba(255,255,255,0.05))] border border-[var(--border-light)] rounded px-1.5 py-1 text-[11px] text-[var(--text-primary)] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveHeader(i)}
                    className="text-[var(--text-disabled)] hover:text-red-400 p-1 cursor-pointer"
                    title="Remove Header"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Preview & Diagnostics */}
        <div className="flex-1 flex flex-col gap-3 min-w-[320px] border-t md:border-t-0 md:border-l border-[var(--border-light)] md:pl-6">
          <div className="flex items-center justify-between border-b border-[var(--border-light)] pb-1.5">
            <h4 className="font-semibold text-sm text-[var(--text-primary)]">
              Data Preview & Schema
            </h4>
            <Button
              variant="secondary"
              onClick={handleTestConnection}
              disabled={testing || !url}
            >
              {testing ? 'Testing...' : 'Load Data / Test Connection'}
            </Button>
          </div>

          {testResult && (
            <div className={`p-2 rounded text-[11px] ${testResult.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
              {testResult.message}
            </div>
          )}

          {inferredSchema && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">
                Inferred Schema Fields ({inferredSchema.fields.length})
              </span>
              <div className="max-h-32 overflow-y-auto bg-[var(--dropdown-bg,rgba(0,0,0,0.3))] border border-[var(--border-light)] rounded p-1.5 flex flex-wrap gap-1">
                {inferredSchema.fields.map(f => (
                  <span
                    key={f.id}
                    className="px-1.5 py-0.5 rounded bg-[var(--chip-bg,rgba(255,255,255,0.08))] text-[10px] font-mono flex items-center gap-1"
                  >
                    <span className="text-[var(--text-primary)]">{f.name}</span>
                    <span className="text-[var(--accent)] text-[9px]">({f.type})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {testResult?.items && (
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-disabled)]">
                Sample Record (Raw Preview)
              </span>
              <pre className="max-h-48 overflow-y-auto bg-black/40 border border-[var(--border-light)] rounded p-2 text-[10px] font-mono text-[var(--text-secondary)] select-text">
                {JSON.stringify(testResult.items[0] ?? testResult.rawJson, null, 2)}
              </pre>
            </div>
          )}

          <div className="mt-auto pt-4 flex justify-end gap-2 border-t border-[var(--border-light)]">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveCollection} disabled={!url}>
              Save API Collection
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
