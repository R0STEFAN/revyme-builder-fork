// source-export.ts — the "Source code" export (a runnable Next.js project),
// assembled IN THE BROWSER for the standalone / open-source editor.
//
// Cloud builds get the zip from the backend (GET /api/export/source/:id,
// backend/src/services/export-project.ts). Standalone has no backend, but the
// editor already holds every file and the rest is static text — so this is a
// port of that service's source path, kept in step with it:
//   1. every ProjectFS file of MAIN, minus builder metadata (`_meta/`,
//      `_revyme/` — any top-level `_` segment);
//   2. marketplace components imported by URL are downloaded into
//      components/remote/ and the imports rewritten, so a vanilla `next build`
//      works offline (Turbopack refuses external http(s) modules);
//   3. the scaffold — package.json, next.config.mjs, tsconfig.json,
//      .gitignore only when the project doesn't ship its own; README always.
//
// Pure apart from the injectable module fetch. Zipping and downloading live in
// editor/header/export-project.ts.
//
// The scaffold targets Next 16 and was checked by exporting, `npm install`,
// `next build` and `next dev` (2026-09-30). Three differences from the
// backend's copy, which still carries them: no `eslint` key in next.config
// (unsupported in 16 — a warning on every run), no `next lint` script (the
// command was removed in 16), and the tsconfig values Next would otherwise
// rewrite on first run (`jsx: react-jsx`, `.next/dev/types`).

import * as t from '@babel/types';
import { parseJSX } from '../parsing/ast-utils';
import { generate } from '../generation/generator-utils';
import { healMissingOverlayEffectsInCode } from '../generation/overlay-gen';
import { PAGE_TRANSITIONS_SOURCE, PAGE_EFFECTS_RUNTIME_SOURCE } from '../generation/page-transitions-gen';
import { transformSiteFilesForNextFonts } from '../generation/next-font-gen';
import { getUploadSrcSet, inferImageSizes } from '@/shared/image-utils';
import { IMAGE_UTILS_TS, OPTIMIZE_IMAGES_SCRIPT } from '@/shared/image-export-constants';
import {
  ensureCmsDetailStaticParams,
  hasGenerateStaticParams,
  stripGenerateStaticParams,
} from './cms-seo';
import {
  detectPageCollectionQueries,
  injectCmsDatasetsIntoClientPage,
  orchestrateServerFetchForQueries,
  type DetectedCollectionQuery,
} from './cms-page-ops';
import { loadCmsProjectConfig, type ApiCollectionConfig } from './cms-api-config';
import { isLocaleRouteFile } from './locale-route-ops';
import { escapeRegExp } from '@/shared/regex-utils';

export {
  getUploadSrcSet,
  inferImageSizes,
  IMAGE_UTILS_TS,
  OPTIMIZE_IMAGES_SCRIPT,
  stripGenerateStaticParams,
  hasGenerateStaticParams,
  ensureCmsDetailStaticParams,
  detectPageCollectionQueries,
  injectCmsDatasetsIntoClientPage,
  orchestrateServerFetchForQueries,
};

/** Ensure import { getUploadSrcSet } from '@/lib/image-utils' is present in the AST */
export function ensureGetUploadSrcSetImport(ast: t.File): void {
  let hasImport = false;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== '@/lib/image-utils') continue;
    for (const spec of node.specifiers) {
      if (
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier' &&
        spec.imported.name === 'getUploadSrcSet'
      ) {
        hasImport = true;
      }
    }
  }
  if (!hasImport) {
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier('getUploadSrcSet'), t.identifier('getUploadSrcSet'))],
      t.stringLiteral('@/lib/image-utils'),
    );
    let lastImportIdx = -1;
    for (let i = 0; i < ast.program.body.length; i++) {
      if (ast.program.body[i].type === 'ImportDeclaration') lastImportIdx = i;
    }
    if (lastImportIdx >= 0) ast.program.body.splice(lastImportIdx + 1, 0, importDecl);
    else ast.program.body.unshift(importDecl);
  }
}

/**
 * Scan JSX code and automatically inject responsive srcSet and sizes into any
 * <img ...> and <motion.img ...> tags that reference uploads or dynamic CMS expressions.
 */
export function injectResponsiveImageSrcSets(code: string): string {
  if (!code.includes('<img') && !code.includes('<motion.img')) return code;

  const ast = parseJSX(code);
  if (!ast) return code;

  let touched = false;

  const checkAndInject = (opening: t.JSXOpeningElement) => {
    // Check if tag is img or motion.img
    const isImg =
      (t.isJSXIdentifier(opening.name) && opening.name.name === 'img') ||
      (t.isJSXMemberExpression(opening.name) &&
        t.isJSXIdentifier(opening.name.object) &&
        opening.name.object.name === 'motion' &&
        t.isJSXIdentifier(opening.name.property) &&
        opening.name.property.name === 'img');

    if (!isImg) return;

    // Check if element already has srcSet / srcset
    const hasSrcSet = opening.attributes.some(
      (attr) =>
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        attr.name.name.toLowerCase() === 'srcset',
    );
    if (hasSrcSet) return;

    // Find src attribute
    const srcAttrIdx = opening.attributes.findIndex(
      (attr) =>
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        attr.name.name === 'src',
    );
    if (srcAttrIdx === -1) return;

    const srcAttr = opening.attributes[srcAttrIdx] as t.JSXAttribute;
    if (!srcAttr.value) return;

    // Infer dimension for optimal sizes attribute
    let inferredWidth: string | number | null = null;
    let inferredMaxWidth: string | number | null = null;

    const styleAttr = opening.attributes.find(
      (attr) =>
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        attr.name.name === 'style',
    ) as t.JSXAttribute | undefined;

    if (
      styleAttr?.value &&
      t.isJSXExpressionContainer(styleAttr.value) &&
      t.isObjectExpression(styleAttr.value.expression)
    ) {
      for (const prop of styleAttr.value.expression.properties) {
        if (t.isObjectProperty(prop)) {
          const keyName = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
              ? prop.key.value
              : null;
          if (
            keyName === 'width' &&
            (t.isStringLiteral(prop.value) || t.isNumericLiteral(prop.value))
          ) {
            inferredWidth = prop.value.value;
          } else if (
            keyName === 'maxWidth' &&
            (t.isStringLiteral(prop.value) || t.isNumericLiteral(prop.value))
          ) {
            inferredMaxWidth = prop.value.value;
          }
        }
      }
    }

    if (inferredWidth === null) {
      const widthAttr = opening.attributes.find(
        (attr) =>
          t.isJSXAttribute(attr) &&
          t.isJSXIdentifier(attr.name) &&
          attr.name.name === 'width',
      ) as t.JSXAttribute | undefined;
      if (widthAttr?.value) {
        if (t.isStringLiteral(widthAttr.value)) inferredWidth = widthAttr.value.value;
        else if (t.isJSXExpressionContainer(widthAttr.value)) {
          if (
            t.isNumericLiteral(widthAttr.value.expression) ||
            t.isStringLiteral(widthAttr.value.expression)
          ) {
            inferredWidth = widthAttr.value.expression.value;
          }
        }
      }
    }

    const calculatedSizes = inferImageSizes({
      width: inferredWidth,
      maxWidth: inferredMaxWidth,
    });

    const sizesAttrIdx = opening.attributes.findIndex(
      (attr) =>
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        attr.name.name.toLowerCase() === 'sizes',
    );

    const applySizes = () => {
      if (sizesAttrIdx === -1) {
        opening.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('sizes'), t.stringLiteral(calculatedSizes)),
        );
      } else {
        const existing = opening.attributes[sizesAttrIdx] as t.JSXAttribute;
        if (
          t.isStringLiteral(existing.value) &&
          existing.value.value === '100vw' &&
          calculatedSizes !== '100vw'
        ) {
          existing.value = t.stringLiteral(calculatedSizes);
        }
      }
    };

    if (t.isStringLiteral(srcAttr.value)) {
      const srcVal = srcAttr.value.value.trim();
      const staticSrcSet = getUploadSrcSet(srcVal);
      if (staticSrcSet) {
        opening.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('srcSet'), t.stringLiteral(staticSrcSet)),
        );
        applySizes();
        touched = true;
      }
    } else if (t.isJSXExpressionContainer(srcAttr.value)) {
      const expr = srcAttr.value.expression;
      if (t.isStringLiteral(expr)) {
        const srcVal = expr.value.trim();
        const staticSrcSet = getUploadSrcSet(srcVal);
        if (staticSrcSet) {
          opening.attributes.push(
            t.jsxAttribute(t.jsxIdentifier('srcSet'), t.stringLiteral(staticSrcSet)),
          );
          applySizes();
          touched = true;
        }
      } else if (t.isExpression(expr) && !t.isJSXEmptyExpression(expr)) {
        // Dynamic expression e.g. item.photo or image
        ensureGetUploadSrcSetImport(ast);
        opening.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('srcSet'),
            t.jsxExpressionContainer(
              t.callExpression(t.identifier('getUploadSrcSet'), [t.cloneNode(expr)]),
            ),
          ),
        );
        applySizes();
        touched = true;
      }
    }
  };

  // Walk all elements in AST
  const walkNode = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement') {
      checkAndInject(node.openingElement);
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'tokens') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walkNode(c);
      } else if (child && typeof child === 'object') {
        walkNode(child);
      }
    }
  };

  walkNode(ast.program);

  if (!touched) return code;

  try {
    return generate(ast, { retainLines: false, concise: false }, code).code;
  } catch {
    return code;
  }
}

/**
 * Generates standard Next.js App Router route handler for app/api/cms/query/route.ts.
 * Enables client components to query paginated API items securely without exposing server secrets.
 */
export function buildCmsQueryRouteHandler(apiConfigs: Record<string, ApiCollectionConfig>): string {
  const sanitizedConfigs: Record<string, any> = {};
  for (const [slug, cfg] of Object.entries(apiConfigs)) {
    sanitizedConfigs[slug] = {
      url: cfg.url,
      method: cfg.method || 'GET',
      headers: cfg.headers || {},
      defaultParams: cfg.defaultParams || {},
      itemsKey: cfg.itemsKey,
      provider: cfg.provider || 'custom_rest',
    };
  }

  return `// AUTO-GENERATED by Revyme — server query relay route for API CMS pagination. Do not edit.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const API_COLLECTIONS: Record<string, {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, string>;
  itemsKey?: string;
  provider?: string;
}> = ${JSON.stringify(sanitizedConfigs, null, 2)};

function extractApiItems(responseJson: any, itemsKey?: string): any[] {
  if (!responseJson || typeof responseJson !== 'object') {
    return Array.isArray(responseJson) ? responseJson : [];
  }
  if (itemsKey) {
    if (Array.isArray(responseJson[itemsKey])) return responseJson[itemsKey];
    if (itemsKey.includes('.')) {
      const parts = itemsKey.split('.');
      let cur = responseJson;
      for (const part of parts) {
        if (!cur || typeof cur !== 'object') { cur = undefined; break; }
        cur = cur[part];
      }
      if (Array.isArray(cur)) return cur;
    }
  }
  if (Array.isArray(responseJson)) return responseJson;
  if (Array.isArray(responseJson.data)) return responseJson.data;
  if (Array.isArray(responseJson.results)) return responseJson.results;
  if (Array.isArray(responseJson.items)) return responseJson.items;
  return [];
}

function resolveHeader(val: string): string {
  return val
    .replace(/process\\.env\\.([A-Za-z0-9_]+)/g, (_, k) => process.env[k] || '')
    .replace(/env:([A-Za-z0-9_]+)/g, (_, k) => process.env[k] || '')
    .replace(/\\$([A-Za-z0-9_]+)/g, (_, k) => process.env[k] || '');
}

async function handleQuery(payload: {
  collection?: string;
  page?: number;
  limit?: number;
  offset?: number;
  params?: any;
}) {
  const { collection, page, limit, offset, params } = payload;
  if (!collection || !API_COLLECTIONS[collection]) {
    return NextResponse.json({ ok: false, error: 'Unknown or unconfigured collection' }, { status: 400 });
  }

  const config = API_COLLECTIONS[collection];
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      if (v) headers[k] = resolveHeader(v);
    }
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(config.url);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid collection URL' }, { status: 500 });
  }

  if (config.defaultParams) {
    for (const [k, v] of Object.entries(config.defaultParams)) {
      if (v !== undefined && v !== null && v !== '') {
        targetUrl.searchParams.set(k, String(v));
      }
    }
  }

  if (Array.isArray(params)) {
    for (const p of params) {
      if (p && p.key) {
        targetUrl.searchParams.set(p.key, String(p.value ?? ''));
      }
    }
  } else if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        targetUrl.searchParams.set(k, String(v));
      }
    }
  }

  const effectiveLimit = limit ?? 10;
  const provider = config.provider || 'custom_rest';

  if (provider === 'strapi') {
    targetUrl.searchParams.set('pagination[pageSize]', String(effectiveLimit));
    if (page !== undefined) targetUrl.searchParams.set('pagination[page]', String(page));
    else if (offset !== undefined) targetUrl.searchParams.set('pagination[start]', String(offset));
  } else if (provider === 'baserow') {
    targetUrl.searchParams.set('size', String(effectiveLimit));
    if (page !== undefined) targetUrl.searchParams.set('page', String(page));
    else if (offset !== undefined) targetUrl.searchParams.set('page', String(Math.floor(offset / effectiveLimit) + 1));
  } else if (provider === 'directus') {
    targetUrl.searchParams.set('limit', String(effectiveLimit));
    if (offset !== undefined) targetUrl.searchParams.set('offset', String(offset));
    else if (page !== undefined) targetUrl.searchParams.set('page', String(page));
  } else {
    targetUrl.searchParams.set('limit', String(effectiveLimit));
    if (offset !== undefined) targetUrl.searchParams.set('offset', String(offset));
    if (page !== undefined) targetUrl.searchParams.set('page', String(page));
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      method: config.method || 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'Upstream CMS returned ' + res.status }, { status: res.status });
    }

    const json = await res.json();
    const items = extractApiItems(json, config.itemsKey);

    let hasMore = items.length >= effectiveLimit;
    if (json && typeof json === 'object') {
      if (typeof json.count === 'number') {
        const currentCount = (offset !== undefined ? offset : ((page ?? 1) - 1) * effectiveLimit) + items.length;
        hasMore = currentCount < json.count;
      } else if (json.meta?.pagination?.total !== undefined) {
        const total = json.meta.pagination.total;
        const currentCount = (offset !== undefined ? offset : ((page ?? 1) - 1) * effectiveLimit) + items.length;
        hasMore = currentCount < total;
      } else if (json.meta?.filter_count !== undefined) {
        const total = json.meta.filter_count;
        const currentCount = (offset !== undefined ? offset : ((page ?? 1) - 1) * effectiveLimit) + items.length;
        hasMore = currentCount < total;
      }
    }
    if (items.length === 0) hasMore = false;

    return NextResponse.json({ ok: true, items, hasMore });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Upstream fetch failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return handleQuery(body);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON request' }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const collection = url.searchParams.get('collection') || '';
  const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
  const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;
  let params: any = undefined;
  const rawParams = url.searchParams.get('params');
  if (rawParams) {
    try { params = JSON.parse(rawParams); } catch {}
  }
  return handleQuery({ collection, page, limit, offset, params });
}
`;
}

export interface PrepareSiteFilesOptions {
  ssg?: boolean;
  buildMode?: 'dynamic' | 'hybrid' | 'static' | 'ssg';
}

/** Prepare a copy of persisted site files so older generated controllers work in builds. */
export function prepareSiteFiles(
  input: Record<string, string>,
  options?: PrepareSiteFilesOptions,
): Record<string, string> {
  let files = { ...input };

  const isDynamicMode = options?.ssg === false || options?.buildMode === 'dynamic';
  const isHybridMode = options?.ssg === true || options?.buildMode === 'hybrid' || options?.buildMode === 'ssg';

  // Load API collection configs if available
  let apiConfigs: Record<string, ApiCollectionConfig> = {};
  if (files['_meta/cms-api-config.json']) {
    try {
      const parsed = JSON.parse(files['_meta/cms-api-config.json']);
      if (parsed.apiCollections) apiConfigs = parsed.apiCollections;
    } catch {}
  }
  try {
    const projectConfig = loadCmsProjectConfig();
    if (projectConfig.apiCollections) {
      apiConfigs = { ...projectConfig.apiCollections, ...apiConfigs };
    }
  } catch {}

  // 1. Process client pages for arbitrary collection queries
  for (const [path, code] of Object.entries(files)) {
    if (
      (path.endsWith('/page.client.tsx') || path === 'app/page.client.tsx') &&
      code &&
      code.includes('data-query-config')
    ) {
      const queries = detectPageCollectionQueries(code);
      if (queries.length > 0) {
        const serverPath = path.replace(/page\.client\.tsx$/, 'page.tsx');
        if (files[serverPath]) {
          files[serverPath] = orchestrateServerFetchForQueries(files[serverPath], queries, apiConfigs);
          files[path] = injectCmsDatasetsIntoClientPage(code, queries);
        }
      }
    }
  }

  // 1b. Clean residual @/cms/<apiCollection>.json imports in client pages if server passes cmsDatasets or serverItems / serverItem
  for (const [path, code] of Object.entries(files)) {
    if (
      (path.endsWith('/page.client.tsx') || path === 'app/page.client.tsx') &&
      code
    ) {
      const serverPath = path.replace(/page\.client\.tsx$/, 'page.tsx');
      const serverCode = files[serverPath] || '';
      const hasServerDelivery = code.includes('cmsDatasets') || code.includes('serverItems') || code.includes('serverItem') ||
                                serverCode.includes('cmsDatasets') || serverCode.includes('items={items}') || serverCode.includes('item={item}');
      if (hasServerDelivery) {
        let updatedCode = code;
        for (const apiSlug of Object.keys(apiConfigs)) {
          const importRe = new RegExp(`import\\s+([A-Za-z0-9_$]+)\\s+from\\s+['"](?:@|\\.\\.)\\/cms\\/${escapeRegExp(apiSlug)}\\.json['"];?`, 'g');
          let m: RegExpExecArray | null;
          while ((m = importRe.exec(updatedCode)) !== null) {
            const fullImport = m[0];
            const importVar = m[1];
            const codeWithoutImport = updatedCode.replace(fullImport, '');
            const isVarUsed = new RegExp(`\\b${escapeRegExp(importVar)}\\b`).test(codeWithoutImport);
            if (isVarUsed) {
              updatedCode = updatedCode.replace(fullImport, `const ${importVar}: any[] = [];`);
            } else {
              updatedCode = updatedCode.replace(new RegExp(`\\n?\\s*${escapeRegExp(fullImport)}`), '');
            }
          }
        }
        if (updatedCode !== code) {
          files[path] = updatedCode;
        }
      }
    }
  }

  // 2. Standard prepareSiteFiles passes: page transitions, overlays, SSG vs Dynamic, etc.
  for (const [path, code] of Object.entries(files)) {
    if (/^app\/(?:.*\/)?page-transitions\.tsx$/.test(path) && code.includes('// @generated by Revyme — Page Effects controller. Do not edit.')) {
      files[path] = PAGE_TRANSITIONS_SOURCE;
    } else if (/^app\/(?:.*\/)?page-effects-runtime\.ts$/.test(path) && code.includes('// @generated by Revyme — Page Effects runtime helpers. Do not edit.')) {
      files[path] = PAGE_EFFECTS_RUNTIME_SOURCE;
    } else if (/^(app|components)\/.*\.(tsx|jsx)$/.test(path) && code.includes('data-overlay=')) {
      files[path] = healMissingOverlayEffectsInCode(code);
    }

    // Dynamic Mode: strip generateStaticParams from all server page files
    if (isDynamicMode && (path.endsWith('/page.tsx') || path === 'app/page.tsx') && files[path] && hasGenerateStaticParams(files[path])) {
      files[path] = stripGenerateStaticParams(files[path]);
    }

    // Hybrid SSG: inject generateStaticParams into CMS [slug] detail pages and locale route wrappers
    if (isHybridMode && /\/\[slug\]\/page\.tsx$/.test(path) && files[path]) {
      if (isLocaleRouteFile(path, files[path])) {
        files[path] = files[path].replace(
          /export\s*\{\s*default\s*\}\s*from/,
          'export { default, generateStaticParams } from',
        );
      } else {
        files[path] = ensureCmsDetailStaticParams(files[path]);
      }
    }

    // Server Component export guard: generateMetadata and metadata must never have 'use client'
    if (files[path] && (files[path].includes('generateMetadata') || files[path].includes('export const metadata') || files[path].includes('generateStaticParams'))) {
      files[path] = files[path].replace(/^(['"])use client\1;\s*\n?/m, '');
    }

    // Inject responsive image srcSet and sizes into all page and component JSX files
    if (files[path] && /\.(tsx|jsx)$/.test(path) && (files[path].includes('<img') || files[path].includes('<motion.img'))) {
      files[path] = injectResponsiveImageSrcSets(files[path]);
    }
  }

  // Transform Google Fonts @import into next/font/google loaders
  files = transformSiteFilesForNextFonts(files);

  // Provide lib/image-utils.ts and scripts/optimize-images.mjs for runtime / build resolution
  if (!files['lib/image-utils.ts']) {
    files['lib/image-utils.ts'] = IMAGE_UTILS_TS;
  }
  if (!files['scripts/optimize-images.mjs']) {
    files['scripts/optimize-images.mjs'] = OPTIMIZE_IMAGES_SCRIPT;
  }

  // Provide server query relay route handler if API collections exist
  if (Object.keys(apiConfigs).length > 0 && !files['app/api/cms/query/route.ts']) {
    files['app/api/cms/query/route.ts'] = buildCmsQueryRouteHandler(apiConfigs);
  }

  return files;
}

// ─── URL-import localization ────────────────────────────────────────────────

const URL_IMPORT_RE = /(['"])(https:\/\/assets\.revyme\.app\/components\/([A-Za-z0-9_-]+)@([a-f0-9]+)\.js)\1/g;

export type ModuleFetch = (url: string) => Promise<string>;

/** Browser fetch of a component bundle. An error / challenge page instead of
 *  the module would poison the build with a far-away "no default export". */
export const fetchModule: ModuleFetch = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  const text = await r.text();
  if (text.trimStart().startsWith('<')) throw new Error(`fetch ${url} -> HTML response, not a module`);
  return text;
};

export async function localizeUrlImports(
  files: Record<string, string>,
  fetchImpl: ModuleFetch = fetchModule,
): Promise<{ files: Record<string, string>; downloaded: string[]; failed: string[] }> {
  const localized = new Map<string, string>(); // url -> local path (or the url on failure)
  const extra: Record<string, string> = {};
  const downloaded: string[] = [];
  const failed: string[] = [];

  async function ensureLocal(url: string, name: string, hash: string): Promise<string> {
    const seen = localized.get(url);
    if (seen !== undefined) return seen;
    const local = `components/remote/${name}-${hash.slice(0, 8)}.js`;
    localized.set(url, local); // BEFORE recursing — cycle guard
    let content: string;
    try {
      content = await fetchImpl(url);
    } catch {
      // Unreachable: the import stays a URL — the export still works
      // everywhere except that one component.
      localized.set(url, url);
      failed.push(url);
      return url;
    }
    extra[local] = await rewrite(content);
    downloaded.push(local);
    return local;
  }

  async function rewrite(code: string): Promise<string> {
    const resolved = new Map<string, string>();
    for (const m of code.matchAll(URL_IMPORT_RE)) {
      const [, , url, name, hash] = m;
      if (!url || !name || !hash) continue;
      if (!resolved.has(url)) resolved.set(url, await ensureLocal(url, name, hash));
    }
    return code.replace(URL_IMPORT_RE, (full, q: string, url: string) => {
      const local = resolved.get(url);
      return local && local !== url ? `${q}@/${local}${q}` : full;
    });
  }

  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = /\.(tsx|jsx|ts|js|mjs)$/.test(path) && content.includes('assets.revyme.app/components/')
      ? await rewrite(content)
      : content;
  }
  return { files: { ...out, ...extra }, downloaded, failed };
}

// ─── The project ────────────────────────────────────────────────────────────

/** Top-level `_` segments are editor-internal (`_meta/`, `_revyme/`). */
export function isBuilderMetadataPath(path: string): boolean {
  return (path.split('/', 1)[0] ?? '').startsWith('_');
}

export function exportSlug(name: string | null | undefined): string {
  return (name || 'revyme-site')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'revyme-site';
}

export interface SourceExportOptions {
  /** Project name — the package name, the zip name, the README title. */
  name: string | null;
  /** `@revyme/runtime` semver range the project depends on. */
  runtimeRange: string;
  now?: Date;
  fetchImpl?: ModuleFetch;
  ssg?: boolean;
}

export interface SourceExport {
  files: Record<string, string>;
  filename: string;
  downloaded: string[];
  failed: string[];
}

/**
 * Detects sensitive environment files that must never be exported in the source zip.
 * Matches any .env variant (.env, .env.local, .env.production, .env.development.local, etc.)
 * but retains .env.example.
 */
export function isSecretEnvFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || normalized;
  if (filename === '.env.example') return false;
  return /(^|\/)\.env(\..+)?$/.test(normalized) || /^\.env(\..+)?$/.test(filename);
}

/** Generate .env.example documenting referenced environment variables without leaking secret values. */
export function generateEnvExample(files: Record<string, string>): string | null {
  const envKeys = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (isSecretEnvFile(path)) {
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          if (key) envKeys.add(key);
        }
      }
    }
  }
  for (const content of Object.values(files)) {
    const matches = content.matchAll(/process\.env\.([A-Za-z0-9_]+)/g);
    for (const m of matches) {
      if (m[1] && m[1] !== 'NODE_ENV') envKeys.add(m[1]);
    }
    const envMatches = content.matchAll(/env:([A-Za-z0-9_]+)/g);
    for (const m of envMatches) {
      if (m[1]) envKeys.add(m[1]);
    }
  }
  if (envKeys.size === 0) return null;
  return Array.from(envKeys).sort().map((k) => `${k}=your_${k.toLowerCase()}_here`).join('\n') + '\n';
}

export async function buildSourceExport(input: Record<string, string>, opts: SourceExportOptions): Promise<SourceExport> {
  const { files: localized, downloaded, failed } = await localizeUrlImports(
    prepareSiteFiles(input, { ssg: opts.ssg }),
    opts.fetchImpl ?? fetchModule,
  );

  // Load API collection configs to identify API preview cache files
  let apiConfigs: Record<string, ApiCollectionConfig> = {};
  if (input['_meta/cms-api-config.json']) {
    try {
      const parsed = JSON.parse(input['_meta/cms-api-config.json']);
      if (parsed.apiCollections) apiConfigs = parsed.apiCollections;
    } catch {}
  }
  try {
    const projectConfig = loadCmsProjectConfig();
    if (projectConfig.apiCollections) {
      apiConfigs = { ...projectConfig.apiCollections, ...apiConfigs };
    }
  } catch {}

  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(localized)) {
    if (isBuilderMetadataPath(path) || isSecretEnvFile(path)) continue;

    // Prune API preview cache JSON if no non-metadata exported file references it
    const cmsMatch = path.match(/^cms\/([^/]+)\.json$/);
    if (cmsMatch) {
      const colSlug = cmsMatch[1];
      if (apiConfigs[colSlug]) {
        const isReferenced = Object.entries(localized).some(([p, c]) => {
          if (p === path || isBuilderMetadataPath(p) || isSecretEnvFile(p)) return false;
          return c.includes(`cms/${colSlug}.json`) || c.includes(`cms/${colSlug}`);
        });
        if (!isReferenced) {
          continue;
        }
      }
    }

    files[path] = content;
  }
  const slug = exportSlug(opts.name);
  if (!localized['package.json']) files['package.json'] = buildPackageJson(slug, opts.runtimeRange, opts.now ?? new Date());
  if (!localized['next.config.mjs'] && !localized['next.config.js']) files['next.config.mjs'] = NEXT_CONFIG;
  if (!localized['tsconfig.json']) files['tsconfig.json'] = TSCONFIG;
  files['README.md'] = buildReadme(opts.name || 'Revyme project');
  if (!localized['.gitignore']) files['.gitignore'] = GITIGNORE;
  if (!localized['scripts/optimize-images.mjs']) files['scripts/optimize-images.mjs'] = OPTIMIZE_IMAGES_SCRIPT;
  if (!localized['lib/image-utils.ts']) files['lib/image-utils.ts'] = IMAGE_UTILS_TS;

  if (!files['.env.example']) {
    const envExample = generateEnvExample(input);
    if (envExample) files['.env.example'] = envExample;
  }

  return { files, filename: `${slug}.zip`, downloaded, failed };
}

// ─── Scaffold (mirrors backend/src/services/export-project.ts) ──────────────

export function buildPackageJson(name: string, runtimeRange: string, now: Date): string {
  return JSON.stringify({
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      'optimize-images': 'node scripts/optimize-images.mjs',
      prebuild: 'npm run optimize-images',
    },
    // The same runtime surface the deploy scaffold uses, so `npm install &&
    // npm run dev` just works off-platform. Never GSAP: its licence forbids
    // it in a visual website builder like Revyme.
    dependencies: {
      react: '^19',
      'react-dom': '^19',
      next: '^16',
      'framer-motion': '^12',
      'next-themes': 'latest',
      'next-intl': 'latest',
      '@revyme/runtime': runtimeRange,
      'perfect-freehand': '^1.2',
      // The generated Smooth Scroll controller imports Lenis.
      lenis: '^1.3.26',
    },
    devDependencies: {
      typescript: '^5',
      '@types/react': '^19',
      '@types/react-dom': '^19',
      '@types/node': '^20',
      sharp: '^0.35.5',
    },
    revyme: {
      exportedAt: now.toISOString(),
    },
  }, null, 2);
}

export const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Builder-generated code is runtime-correct but not always type-pristine
  // (e.g. a duplicate style key from an editing session — last one wins at
  // runtime). Don't let type nits fail a site build off-platform.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
`;

export const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'react-jsx',
    incremental: true,
    // The editor's generated code imports `@/...` — keep the alias.
    paths: { '@/*': ['./*'] },
    plugins: [{ name: 'next' }],
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'],
  exclude: ['node_modules'],
}, null, 2);

export const GITIGNORE = `# Dependencies
node_modules
/.pnp
.pnp.js

# Build output
/.next
/out
/build
/dist

# Env
.env*.local

# Misc
.DS_Store
*.log
`;

export function buildReadme(name: string): string {
  return `# ${name}

Exported from [Revyme](https://revyme.com).

## Quickstart

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deploy

This is a standard Next.js project. Deploy anywhere that supports Next.js
(Vercel, Netlify, AWS, your own host).

## What's inside

- \`app/\` — page routes (Next.js App Router)
- \`components/\` — your component library
- \`public/\` — static assets

Made with Revyme.
`;
}
