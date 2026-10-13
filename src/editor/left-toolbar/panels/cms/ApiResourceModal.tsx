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

/** Infer CollectionSchema from an array of JSON objects */
export function inferSchemaFromItems(slug: string, name: string, items: any[]): CollectionSchema {
  const fieldsMap = new Map<string, FieldDefinition>();

  // Scan up to first 10 items to build schema
  const inspectItems = items.slice(0, 10);
  for (const item of inspectItems) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, val] of Object.entries(item)) {
      if (fieldsMap.has(key)) continue;

      let type: FieldDefinition['type'] = 'text';
      if (typeof val === 'number') {
        type = 'number';
      } else if (typeof val === 'boolean') {
        type = 'boolean';
      } else if (typeof val === 'string') {
        if (/^\d{4}-\d{2}-\d{2}(T|\b)/.test(val)) {
          type = 'date';
        } else if (/\.(png|jpe?g|webp|gif|svg|avif)($|\?)/i.test(val)) {
          type = 'image';
        } else if (key.toLowerCase() === 'slug') {
          type = 'slug';
        } else if (val.includes('\n') || val.length > 80) {
          type = 'textarea';
        }
      }

      const formattedName = key
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      fieldsMap.set(key, {
        id: key,
        name: formattedName,
        type,
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
    // If name is empty, auto-guess slug from URL path
    if (!name && rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        if (last) {
          const autoName = last.charAt(0).toUpperCase() + last.slice(1);
          setName(autoName);
          setSlug(slugify(autoName));
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

  // Test request via /api/proxy
  const handleTestConnection = async () => {
    if (!url) {
      toast.error('URL is required');
      return;
    }
    setTesting(true);
    setTestResult(null);
    trace.action('api-resource:test-connection', { url, method });

    try {
      const envVars = getEnvVariables();
      const resolvedHeaders: Record<string, string> = {};
      for (const h of headers) {
        if (!h.key.trim()) continue;
        let val = h.value;
        const envMatch = val.match(/env:([A-Za-z0-9_]+)/);
        if (envMatch) {
          const envVarName = envMatch[1];
          const actualVal = envVars[envVarName] || '';
          val = val.replace(`env:${envVarName}`, actualVal);
        }
        resolvedHeaders[h.key] = val;
      }

      const proxyRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          method,
          headers: resolvedHeaders,
        }),
      });

      if (!proxyRes.ok) {
        throw new Error(`Upstream returned ${proxyRes.status} ${proxyRes.statusText}`);
      }

      const data = await proxyRes.json();
      let items: any[] = [];
      let detectedKey = itemsKey;

      if (detectedKey && Array.isArray(data[detectedKey])) {
        items = data[detectedKey];
      } else if (Array.isArray(data)) {
        items = data;
      } else if (Array.isArray(data.data)) {
        items = data.data;
        detectedKey = 'data';
      } else if (Array.isArray(data.results)) {
        items = data.results;
        detectedKey = 'results';
      } else if (Array.isArray(data.items)) {
        items = data.items;
        detectedKey = 'items';
      }

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

    const finalConfig: ApiCollectionConfig = {
      slug: finalSlug,
      name: name || finalSlug,
      provider,
      url,
      method,
      headers: headersRecord,
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
