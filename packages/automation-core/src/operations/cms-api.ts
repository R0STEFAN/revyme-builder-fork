// packages/automation-core/src/operations/cms-api.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  CMS_API_CONFIG_PATH,
  type ApiCollectionConfig,
  type CmsProjectConfig,
  type CmsImageOptimizationConfig,
  type ApiProvider,
  loadCmsProjectConfig,
  saveCmsProjectConfig,
  getApiCollection,
  resolveEnvHeaders,
  buildApiRequestUrl,
  extractApiItems,
  detectApiItemsKey,
} from '@/code/project/cms-api-config';
import {
  updateCollectionQueryConfig,
  updateCollectionListConfigInCode,
} from '@/code/generation/cms-gen';
import {
  addSearchFieldInCode,
  setSearchInputVariableInCode,
  SEARCH_FIELD_PLACEHOLDER,
} from '@/code/generation/cms-search-field-gen';
import {
  parsePageVariables,
  addPageVariableInCode,
} from '@/code/features/page-variables';
import { syncPageVariableHooks } from '@/code/generation/page-variables-gen';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { getCollectionSchema } from '@/code/project/cms-ops';
import { trace } from '@/shared/debug-trace';
import type { CollectionQueryConfig } from '@/shared/types';

export const apiProviderSchema = z.enum(['directus', 'baserow', 'strapi', 'custom_rest']);

export const cmsImageOptimizationSchema = z.object({
  enabled: z.boolean(),
  engine: z.enum(['directus', 'cloudflare', 'custom']),
  quality: z.number().min(1).max(100).optional(),
  format: z.enum(['webp', 'avif', 'auto']).optional(),
  widths: z.array(z.number()).optional(),
  cloudflareZoneUrl: z.string().optional(),
  customPattern: z.string().optional(),
});

export const apiCollectionConfigSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  provider: apiProviderSchema,
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  defaultParams: z.record(z.string(), z.string()).optional(),
  cacheMaxAge: z.number().int().nonnegative().optional().default(14400),
  revalidateTtl: z.number().int().nonnegative().optional(),
  itemsKey: z.string().optional(),
  idField: z.string().optional(),
  slugField: z.string().optional(),
  imageOptimization: cmsImageOptimizationSchema.optional(),
  sampleResponse: z.unknown().optional(),
});

export const collectionQueryParamSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  isExpression: z.boolean().optional(),
});

export const collectionQueryConfigSchema = z.object({
  isApiMode: z.boolean().optional(),
  params: z.array(collectionQueryParamSchema),
});

/** Helper to read project CMS config from snapshot or projectFS */
export function readCmsApiConfig(snapshot?: Snapshot): CmsProjectConfig {
  const content = snapshot?.files.get(CMS_API_CONFIG_PATH) ?? projectFS.readFile(CMS_API_CONFIG_PATH);
  if (!content) {
    return { mode: 'local', apiCollections: {} };
  }
  try {
    const parsed = JSON.parse(content);
    return {
      mode: parsed.mode === 'api' ? 'api' : 'local',
      apiCollections:
        typeof parsed.apiCollections === 'object' && parsed.apiCollections !== null
          ? parsed.apiCollections
          : {},
    };
  } catch {
    return { mode: 'local', apiCollections: {} };
  }
}

/** Helper to write project CMS config to projectFS and create a FileChange */
export function writeCmsApiConfig(config: CmsProjectConfig): FileChange {
  const content = JSON.stringify(config, null, 2);
  projectFS.writeFile(CMS_API_CONFIG_PATH, content);
  return {
    path: CMS_API_CONFIG_PATH,
    beforeHash: null,
    content,
  };
}

/** Recursively detect nested array paths in unknown JSON structures up to depth 5 */
export function findNestedArrayKey(obj: any, currentPath = '', depth = 0): string | undefined {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;

  const preferred = ['data', 'results', 'items', 'records', 'articles', 'posts'];
  for (const p of preferred) {
    if (obj[p] !== undefined) {
      const fullPath = currentPath ? `${currentPath}.${p}` : p;
      if (Array.isArray(obj[p])) return fullPath;
      if (obj[p] && typeof obj[p] === 'object') {
        const found = findNestedArrayKey(obj[p], fullPath, depth + 1);
        if (found) return found;
      }
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    if (preferred.includes(k)) continue;
    const fullPath = currentPath ? `${currentPath}.${k}` : k;
    if (Array.isArray(v)) return fullPath;
    if (v && typeof v === 'object') {
      const found = findNestedArrayKey(v, fullPath, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

/** Redact sensitive credentials and tokens in URL query strings */
export function redactUrl(urlStr: string): string {
  try {
    const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlStr);
    const urlObj = new URL(urlStr, 'http://localhost');
    if (urlObj.password) {
      urlObj.password = '[REDACTED]';
    }
    const sensitiveParam = /(?:key|token|secret|auth|password|pwd|api[-_]?key|client[-_]?secret|access[-_]?token)/i;
    for (const [k] of Array.from(urlObj.searchParams.entries())) {
      if (sensitiveParam.test(k)) {
        urlObj.searchParams.set(k, '[REDACTED]');
      }
    }
    const formatted = isAbsolute ? urlObj.toString() : `${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
    return formatted.replace(/%5BREDACTED%5D/g, '[REDACTED]');
  } catch {
    return urlStr;
  }
}

/** Redact sensitive headers (Authorization, Api-Key, Tokens, Cookies) */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const sensitiveHeader = /(?:authorization|bearer|token|secret|key|cookie|password)/i;
  for (const [k, v] of Object.entries(headers)) {
    if (sensitiveHeader.test(k)) {
      if (/^bearer\s+/i.test(v)) {
        result[k] = 'Bearer [REDACTED]';
      } else {
        result[k] = '[REDACTED]';
      }
    } else if (/^bearer\s+/i.test(v)) {
      result[k] = 'Bearer [REDACTED]';
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ─── 1. cms.api.mode.get ────────────────────────────────────────────────────────

export const cmsApiModeGetOperation: Operation<
  Record<string, never>,
  { mode: 'local' | 'api' }
> = {
  name: 'cms.api.mode.get',
  description: 'Get project CMS operating mode (local vs api)',
  category: 'cms-api',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const config = readCmsApiConfig(snapshot);
    trace.fn('cms-api:mode:get', { mode: config.mode });
    return { mode: config.mode };
  },
};

// ─── 2. cms.api.mode.set ────────────────────────────────────────────────────────

export const cmsApiModeSetOperation: Operation<
  { mode: 'local' | 'api' },
  { mode: 'local' | 'api'; changes: FileChange[] }
> = {
  name: 'cms.api.mode.set',
  description: 'Set project CMS operating mode (local vs api)',
  category: 'cms-api',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    mode: z.enum(['local', 'api']),
  }),
  async execute(snapshot, input) {
    const config = readCmsApiConfig(snapshot);
    config.mode = input.mode;
    const change = writeCmsApiConfig(config);
    trace.action('cms-api:mode:set', { mode: input.mode });
    return { mode: config.mode, changes: [change] };
  },
};

// ─── 3. cms.api.collection.list ─────────────────────────────────────────────────

export const cmsApiCollectionListOperation: Operation<
  Record<string, never>,
  { collections: Record<string, ApiCollectionConfig> }
> = {
  name: 'cms.api.collection.list',
  description: 'List all configured external API collections',
  category: 'cms-api',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const config = readCmsApiConfig(snapshot);
    trace.fn('cms-api:collection:list', { count: Object.keys(config.apiCollections).length });
    return { collections: config.apiCollections };
  },
};

// ─── 4. cms.api.collection.get ──────────────────────────────────────────────────

export const cmsApiCollectionGetOperation: Operation<
  { slug: string },
  { collection: ApiCollectionConfig }
> = {
  name: 'cms.api.collection.get',
  description: 'Get configuration for an external API collection by slug',
  category: 'cms-api',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    slug: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const config = readCmsApiConfig(snapshot);
    if (!Object.prototype.hasOwnProperty.call(config.apiCollections, input.slug)) {
      throw new Error(`Collection "${input.slug}" not found`);
    }
    const collection = config.apiCollections[input.slug];
    trace.fn('cms-api:collection:get', { slug: input.slug });
    return { collection };
  },
};

export type ApiCollectionSetInput = {
  slug: string;
  name: string;
  provider: ApiProvider;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  defaultParams?: Record<string, string>;
  cacheMaxAge?: number;
  revalidateTtl?: number;
  itemsKey?: string;
  idField?: string;
  slugField?: string;
  imageOptimization?: CmsImageOptimizationConfig;
  sampleResponse?: unknown;
};

// ─── 5. cms.api.collection.set ──────────────────────────────────────────────────

export const cmsApiCollectionSetOperation: Operation<
  ApiCollectionSetInput,
  { slug: string; collection: ApiCollectionConfig; changes: FileChange[] }
> = {
  name: 'cms.api.collection.set',
  description: 'Create or update configuration for an external API collection',
  category: 'cms-api',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: apiCollectionConfigSchema as any,
  async execute(snapshot, input) {
    const parsed = apiCollectionConfigSchema.parse(input);
    let itemsKey = parsed.itemsKey;
    if (!itemsKey && parsed.sampleResponse !== undefined) {
      itemsKey =
        detectApiItemsKey(parsed.sampleResponse) ??
        findNestedArrayKey(parsed.sampleResponse);
    }

    const collection: ApiCollectionConfig = {
      slug: parsed.slug,
      name: parsed.name,
      provider: parsed.provider,
      url: parsed.url,
      method: parsed.method ?? 'GET',
      headers: parsed.headers ?? {},
      ...(parsed.defaultParams !== undefined ? { defaultParams: parsed.defaultParams } : {}),
      cacheMaxAge: parsed.cacheMaxAge ?? 14400,
      ...(parsed.revalidateTtl !== undefined ? { revalidateTtl: parsed.revalidateTtl } : {}),
      ...(itemsKey !== undefined ? { itemsKey } : {}),
      ...(parsed.idField !== undefined ? { idField: parsed.idField } : {}),
      ...(parsed.slugField !== undefined ? { slugField: parsed.slugField } : {}),
      ...(parsed.imageOptimization !== undefined ? { imageOptimization: parsed.imageOptimization } : {}),
    };

    const config = readCmsApiConfig(snapshot);
    config.apiCollections[parsed.slug] = collection;
    const change = writeCmsApiConfig(config);
    trace.action('cms-api:collection:set', { slug: parsed.slug, provider: parsed.provider, url: parsed.url });

    return {
      slug: parsed.slug,
      collection,
      changes: [change],
    };
  },
};

// ─── 6. cms.api.collection.delete ───────────────────────────────────────────────

export const cmsApiCollectionDeleteOperation: Operation<
  { slug: string },
  { slug: string; changes: FileChange[] }
> = {
  name: 'cms.api.collection.delete',
  description: 'Delete an external API collection configuration',
  category: 'cms-api',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    slug: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const config = readCmsApiConfig(snapshot);
    if (!Object.prototype.hasOwnProperty.call(config.apiCollections, input.slug)) {
      throw new Error(`Collection "${input.slug}" not found`);
    }
    delete config.apiCollections[input.slug];
    const change = writeCmsApiConfig(config);
    trace.action('cms-api:collection:delete', { slug: input.slug });
    return { slug: input.slug, changes: [change] };
  },
};

// ─── 7. cms.api.detectItemsKey ──────────────────────────────────────────────────

export const cmsApiDetectItemsKeyOperation: Operation<
  { responseData: unknown; explicitKey?: string },
  { itemsKey?: string; itemCount: number; sampleItem?: unknown }
> = {
  name: 'cms.api.detectItemsKey',
  description: 'Detect array items key and structure from API response data',
  category: 'cms-api',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    responseData: z.unknown(),
    explicitKey: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let key: string | undefined = input.explicitKey;

    if (!key) {
      key = detectApiItemsKey(input.responseData);
      if (!key && input.responseData && typeof input.responseData === 'object' && !Array.isArray(input.responseData)) {
        key = findNestedArrayKey(input.responseData);
      }
    }

    const items = extractApiItems(input.responseData, key);
    trace.fn('cms-api:detectItemsKey', { detectedKey: key, count: items.length });

    return {
      itemsKey: key,
      itemCount: items.length,
      sampleItem: items[0],
    };
  },
};

// ─── 8. cms.api.fetch ───────────────────────────────────────────────────────────

export const cmsApiFetchOperation: Operation<
  {
    slug: string;
    queryParams?: Record<string, string>;
    envVars?: Record<string, string>;
    timeoutMs?: number;
  },
  {
    ok: boolean;
    status: number;
    url: string;
    items: unknown[];
    totalCount?: number;
    redactedHeaders: Record<string, string>;
  }
> = {
  name: 'cms.api.fetch',
  description: 'Execute external API CMS fetch with env header resolution and credential redaction',
  category: 'cms-api',
  kind: 'service',
  permit: 'read',
  environment: 'service',
  ownerTask: 'T17',
  inputSchema: z.object({
    slug: z.string().min(1),
    queryParams: z.record(z.string(), z.string()).optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional().default(10000),
  }) as any,
  async execute(snapshot, input, context) {
    const config = readCmsApiConfig(snapshot);
    if (!Object.prototype.hasOwnProperty.call(config.apiCollections, input.slug)) {
      throw new Error(`Collection "${input.slug}" not found`);
    }
    const collection = config.apiCollections[input.slug];

    const resolvedHeaders = resolveEnvHeaders(collection.headers, input.envVars);
    const redactedHeaders = redactHeaders(resolvedHeaders);
    const requestUrl = buildApiRequestUrl(collection, input.queryParams);
    const redactedUrl = redactUrl(requestUrl);

    const timeout = input.timeoutMs ?? 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    if (context?.signal) {
      if (context.signal.aborted) {
        controller.abort();
      } else {
        context.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      const res = await fetch(requestUrl, {
        method: collection.method ?? 'GET',
        headers: resolvedHeaders,
        signal: controller.signal,
      });

      if (!res.ok) {
        trace.error('cms-api:fetch:error-status', { status: res.status, url: redactedUrl });
        return {
          ok: false,
          status: res.status,
          url: redactedUrl,
          items: [],
          redactedHeaders,
        };
      }

      const json = await res.json();
      const items = extractApiItems(json, collection.itemsKey);
      const totalCount =
        typeof (json as any)?.meta?.total_count === 'number'
          ? (json as any).meta.total_count
          : typeof (json as any)?.count === 'number'
          ? (json as any).count
          : typeof (json as any)?.total === 'number'
          ? (json as any).total
          : items.length;

      trace.action('cms-api:fetch:success', { count: items.length, status: res.status, url: redactedUrl });

      return {
        ok: true,
        status: res.status,
        url: redactedUrl,
        items,
        totalCount,
        redactedHeaders,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        throw new Error(`Request to ${redactedUrl} timed out after ${timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
};

// ─── 9. cms.api.queryConfig.set ─────────────────────────────────────────────────

export const cmsApiQueryConfigSetOperation: Operation<
  {
    filePath: string;
    nodeId: string;
    queryConfig: CollectionQueryConfig | null;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'cms.api.queryConfig.set',
  description: 'Set data-query-config on a collection list container node',
  category: 'cms-api',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    queryConfig: collectionQueryConfigSchema.nullable(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.filePath) ?? projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`Target file "${input.filePath}" not found`);
    }

    const updatedCode = updateCollectionQueryConfig(code, input.nodeId, input.queryConfig);
    projectFS.writeFile(input.filePath, updatedCode);

    trace.action('cms-api:queryConfig:set', { filePath: input.filePath, nodeId: input.nodeId });

    return {
      nodeId: input.nodeId,
      changes: [
        {
          path: input.filePath,
          beforeHash: null,
          content: updatedCode,
        },
      ],
    };
  },
};

// ─── 10. cms.api.searchField.add ────────────────────────────────────────────────

export const cmsApiSearchFieldAddOperation: Operation<
  {
    filePath: string;
    nodeId: string;
    field: string;
    placeholder?: string;
  },
  {
    list: string;
    field: string;
    inputFrame: string;
    variable: string;
    queryParam: string;
    changes: FileChange[];
  }
> = {
  name: 'cms.api.searchField.add',
  description: 'Insert styled search container and input before collection list with contains filter',
  category: 'cms-api',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    field: z.string().min(1),
    placeholder: z.string().optional().default(SEARCH_FIELD_PLACEHOLDER),
  }) as any,
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.filePath) ?? projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const listNode = nodes.get(input.nodeId);
    if (!listNode) {
      throw new Error(`Collection list node "${input.nodeId}" not found in "${input.filePath}"`);
    }
    if (!listNode.collectionList) {
      throw new Error(`Node "${input.nodeId}" is not a collection list`);
    }

    const collectionSlug = listNode.collectionList.source;
    let schema = getCollectionSchema(collectionSlug);
    if (!schema) {
      const schemaPath = `cms/${collectionSlug}.schema.json`;
      const rawSchema = snapshot.files.get(schemaPath) ?? projectFS.readFile(schemaPath);
      if (rawSchema) {
        try {
          schema = JSON.parse(rawSchema);
        } catch {}
      }
    }
    let fieldLabel = input.field;

    if (schema) {
      const fieldDef = schema.fields?.find((f) => f.id === input.field);
      if (!fieldDef) {
        throw new Error(
          `Field "${input.field}" not found in collection "${collectionSlug}". Available fields: ${schema.fields?.map((f) => f.id).join(', ')}`,
        );
      }
      const searchCompatibleTypes = ['text', 'textarea', 'slug', 'tags'];
      if (!searchCompatibleTypes.includes(fieldDef.type)) {
        throw new Error(
          `Field "${input.field}" is of type "${fieldDef.type}", which cannot be searched. Only text fields (${searchCompatibleTypes.join(', ')}) are supported.`,
        );
      }
      fieldLabel = fieldDef.name || input.field;
    }

    const existingGroup = listNode.collectionList.filterGroup;
    if (existingGroup?.filters?.some((f) => f.valueSource === 'searchField' && f.field === input.field)) {
      throw new Error(`Collection list "${input.nodeId}" already has a search field on "${input.field}"`);
    }

    const pascal = input.field
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const takenVars = new Set([
      ...(parsePageVariables(code)?.variables ?? []).map((v) => v.name),
      ...[...code.matchAll(/data-search-field="([^"]+)"/g)].map((m) => m[1]),
    ]);
    let varName = `search${pascal || 'Field'}`;
    for (let n = 2; takenVars.has(varName); n++) varName = `search${pascal || 'Field'}${n}`;

    let frameId = `search-${input.nodeId}-${input.field}`;
    for (let n = 2; code.includes(`data-id="${frameId}"`); n++) frameId = `search-${input.nodeId}-${input.field}-${n}`;

    const usedParams = new Set(
      (parsePageVariables(code)?.variables ?? []).map((v) => v.queryParam).filter(Boolean) as string[],
    );
    const paramBase = input.field.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'search';
    let queryParam = paramBase;
    for (let n = 2; usedParams.has(queryParam); n++) queryParam = `${paramBase}-${n}`;

    const isComponent = input.filePath.startsWith('components/');

    let nextCode = addSearchFieldInCode(
      code,
      input.nodeId,
      varName,
      frameId,
      fieldLabel,
      input.placeholder ?? SEARCH_FIELD_PLACEHOLDER,
      isComponent,
      queryParam,
    );

    const filters = [
      ...(existingGroup?.filters ?? []),
      {
        field: input.field,
        operator: 'contains' as const,
        value: '',
        valueSource: 'searchField' as const,
        valueVar: varName,
      },
    ];

    nextCode = updateCollectionListConfigInCode(
      nextCode,
      input.nodeId,
      { combinator: existingGroup?.combinator ?? 'and', filters },
      listNode.collectionList.sort,
      listNode.collectionList.limit ?? undefined,
      listNode.collectionList.offset ?? undefined,
    );

    projectFS.writeFile(input.filePath, nextCode);
    trace.action('cms-api:searchField:add', {
      nodeId: input.nodeId,
      field: input.field,
      frameId,
      varName,
    });

    return {
      list: input.nodeId,
      field: input.field,
      inputFrame: frameId,
      variable: varName,
      queryParam,
      changes: [
        {
          path: input.filePath,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// ─── 11. cms.api.searchField.setVariable ────────────────────────────────────────

export const cmsApiSearchFieldSetVariableOperation: Operation<
  {
    filePath: string;
    inputId: string;
    varName: string;
    createVar?: boolean;
  },
  {
    inputId: string;
    varName: string;
    changes: FileChange[];
  }
> = {
  name: 'cms.api.searchField.setVariable',
  description: 'Re-bind search input element to a page variable',
  category: 'cms-api',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T17',
  inputSchema: z.object({
    filePath: z.string().min(1),
    inputId: z.string().min(1),
    varName: z.string().min(1),
    createVar: z.boolean().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.filePath) ?? projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`Target file "${input.filePath}" not found`);
    }

    if (input.createVar) {
      const vars = parsePageVariables(code)?.variables ?? [];
      if (!vars.some((v) => v.name === input.varName)) {
        code = addPageVariableInCode(code, { name: input.varName, type: 'text', default: '' });
      }
    }

    code = setSearchInputVariableInCode(code, input.inputId, input.varName);
    code = syncPageVariableHooks(code);

    projectFS.writeFile(input.filePath, code);
    trace.action('cms-api:searchField:setVariable', { inputId: input.inputId, varName: input.varName });

    return {
      inputId: input.inputId,
      varName: input.varName,
      changes: [
        {
          path: input.filePath,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// ─── Self-Registration ──────────────────────────────────────────────────────────

defaultRegistry.register(cmsApiModeGetOperation);
defaultRegistry.register(cmsApiModeSetOperation);
defaultRegistry.register(cmsApiCollectionListOperation);
defaultRegistry.register(cmsApiCollectionGetOperation);
defaultRegistry.register(cmsApiCollectionSetOperation);
defaultRegistry.register(cmsApiCollectionDeleteOperation);
defaultRegistry.register(cmsApiDetectItemsKeyOperation);
defaultRegistry.register(cmsApiFetchOperation);
defaultRegistry.register(cmsApiQueryConfigSetOperation);
defaultRegistry.register(cmsApiSearchFieldAddOperation);
defaultRegistry.register(cmsApiSearchFieldSetVariableOperation);

// Aliases for compatibility with alternative naming conventions
defaultRegistry.registerAlias('cms.api.collection.remove', 'cms.api.collection.delete');
defaultRegistry.registerAlias('cms.api.detect', 'cms.api.detectItemsKey');
defaultRegistry.registerAlias('cms.api.search.add', 'cms.api.searchField.add');
defaultRegistry.registerAlias('cms.api.query.set', 'cms.api.queryConfig.set');
