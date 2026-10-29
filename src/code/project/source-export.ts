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
import { getUploadSrcSet, inferImageSizes, getCmsImageSrcSet, isSignedImageUrl } from '@/shared/image-utils';
import { IMAGE_UTILS_TS, OPTIMIZE_IMAGES_SCRIPT } from '@/shared/image-export-constants';
import {
  ensureCmsDetailStaticParams,
  ensureDynamicRouteStaticParams,
  discoverDynamicRouteParams,
  hasGenerateStaticParams,
  stripGenerateStaticParams,
} from './cms-seo';
import {
  detectPageCollectionQueries,
  injectCmsDatasetsIntoClientPage,
  orchestrateServerFetchForQueries,
  repairLegacyDetailBindings,
  repairBareAltAttributes,
  type DetectedCollectionQuery,
} from './cms-page-ops';
import { loadCmsProjectConfig, type ApiCollectionConfig, type CmsImageOptimizationConfig } from './cms-api-config';
import { parseCmsPageMeta } from './cms-page-meta';
import { isLocaleRouteFile } from './locale-route-ops';
import { prepareLocalizedSiteFiles } from './localized-site-export';
import { escapeRegExp } from '@/shared/regex-utils';
import { generateSitemapCode, type SitemapRoute, type SitemapCmsCollection } from '../generation/sitemap-gen';
import { generateRobotsCode, type RobotsGeneratorInput } from '../generation/robots-gen';
import {
  generateLlmsRouteCode,
  generateLlmsFullRouteCode,
  type LlmsPageItem,
  type LlmsCmsCollection,
  type LlmsRouteGeneratorInput,
} from '../generation/llms-gen';
import { parseMetadataFromCode } from '../generation/metadata-gen';

export {
  getUploadSrcSet,
  inferImageSizes,
  IMAGE_UTILS_TS,
  OPTIMIZE_IMAGES_SCRIPT,
  stripGenerateStaticParams,
  hasGenerateStaticParams,
  ensureCmsDetailStaticParams,
  ensureDynamicRouteStaticParams,
  discoverDynamicRouteParams,
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

/** Ensure import { getCmsImageSrcSet } from '@/lib/image-utils' is present in the AST */
export function ensureCmsImageUtilsImport(ast: t.File): void {
  let hasImport = false;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== '@/lib/image-utils') continue;
    for (const spec of node.specifiers) {
      if (
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier' &&
        spec.imported.name === 'getCmsImageSrcSet'
      ) {
        hasImport = true;
      }
    }
  }
  if (!hasImport) {
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier('getCmsImageSrcSet'), t.identifier('getCmsImageSrcSet'))],
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
export function injectResponsiveImageSrcSets(
  code: string,
  apiConfigs?: Record<string, Partial<ApiCollectionConfig>>,
): string {
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

    const handleSrcString = (srcVal: string) => {
      const staticSrcSet = getUploadSrcSet(srcVal);
      if (staticSrcSet) {
        opening.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('srcSet'), t.stringLiteral(staticSrcSet)),
        );
        applySizes();
        touched = true;
        return;
      }

      if ((srcVal.startsWith('http://') || srcVal.startsWith('https://')) && apiConfigs) {
        let matchedOpt: CmsImageOptimizationConfig | undefined;
        try {
          const srcOrigin = new URL(srcVal).origin;
          for (const cfg of Object.values(apiConfigs)) {
            if (cfg.imageOptimization?.enabled) {
              if (cfg.url && new URL(cfg.url).origin === srcOrigin) {
                matchedOpt = cfg.imageOptimization;
                break;
              }
              if (!matchedOpt) matchedOpt = cfg.imageOptimization;
            }
          }
        } catch {}

        if (matchedOpt) {
          const remoteSrcSet = getCmsImageSrcSet(srcVal, matchedOpt);
          if (remoteSrcSet) {
            opening.attributes.push(
              t.jsxAttribute(t.jsxIdentifier('srcSet'), t.stringLiteral(remoteSrcSet)),
            );
            applySizes();
            touched = true;
            return;
          }
        }
      }
    };

    if (t.isStringLiteral(srcAttr.value)) {
      handleSrcString(srcAttr.value.value.trim());
    } else if (t.isJSXExpressionContainer(srcAttr.value)) {
      const expr = srcAttr.value.expression;
      if (t.isStringLiteral(expr)) {
        handleSrcString(expr.value.trim());
      } else if (t.isExpression(expr) && !t.isJSXEmptyExpression(expr)) {
        // Dynamic expression e.g. item.photo or image
        const activeOpt = Object.values(apiConfigs || {}).find(
          (c) => c.imageOptimization?.enabled,
        )?.imageOptimization;

        if (activeOpt) {
          ensureCmsImageUtilsImport(ast);
          opening.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier('srcSet'),
              t.jsxExpressionContainer(
                t.callExpression(t.identifier('getCmsImageSrcSet'), [
                  t.cloneNode(expr),
                  t.valueToNode(activeOpt),
                ]),
              ),
            ),
          );
          applySizes();
          touched = true;
        } else {
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
      defaultQueryParams: cfg.defaultQueryParams || [],
      itemsKey: cfg.itemsKey,
      provider: cfg.provider || 'custom_rest',
      revalidateTtl: cfg.revalidateTtl,
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
  defaultQueryParams?: Array<{ key: string; value: string; isExpression?: boolean }>;
  itemsKey?: string;
  provider?: string;
  revalidateTtl?: number;
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
  lang?: string;
  routeParams?: Record<string, string>;
}) {
  const { collection, page, limit, offset, params, lang, routeParams } = payload;
  if (!collection || !API_COLLECTIONS[collection]) {
    return NextResponse.json({ ok: false, error: 'Unknown or unconfigured collection' }, { status: 400 });
  }

  if (lang && !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(lang)) {
    return NextResponse.json({ ok: false, error: 'Invalid language code' }, { status: 400 });
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

  if (Array.isArray(config.defaultQueryParams)) {
    const exprContext = { ...(routeParams || {}), ...(lang ? { lang } : {}) };
    for (const p of config.defaultQueryParams) {
      if (!p.key) continue;
      let val: any = p.value;
      if (p.isExpression) {
        try {
          const fn = new Function('params', 'with({ params }) { return (' + p.value + '); }');
          val = fn(exprContext);
        } catch {
          val = '';
        }
      }
      if (val !== undefined && val !== null && val !== '') {
        targetUrl.searchParams.set(p.key, String(val));
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
    targetUrl.searchParams.set('meta', '*');
    targetUrl.searchParams.set('limit', String(effectiveLimit + 1));
    if (offset !== undefined) targetUrl.searchParams.set('offset', String(offset));
    else if (page !== undefined) targetUrl.searchParams.set('page', String(page));
  } else {
    targetUrl.searchParams.set('limit', String(effectiveLimit + 1));
    if (offset !== undefined) targetUrl.searchParams.set('offset', String(offset));
    if (page !== undefined) targetUrl.searchParams.set('page', String(page));
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      method: config.method || 'GET',
      headers,
      next: { revalidate: config.revalidateTtl ?? 60 },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'Upstream CMS returned ' + res.status }, { status: res.status });
    }

    const json = await res.json();
    let items = extractApiItems(json, config.itemsKey);

    let hasMore = items.length > effectiveLimit;
    if (items.length > effectiveLimit) {
      items = items.slice(0, effectiveLimit);
    }
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

/**
 * Generates on-demand cache revalidation route for app/api/revalidate/route.ts.
 * Allows CMS webhooks to trigger instantaneous cache purging.
 */
export function buildCmsRevalidateRouteHandler(): string {
  return `// AUTO-GENERATED by Revyme — On-demand revalidation handler for live CMS updates. Do not edit.
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('x-revalidate-secret');
  const expectedSecret = process.env.REVALIDATION_SECRET || 'revyme-revalidate-token';

  if (secret !== expectedSecret) {
    return NextResponse.json({ message: 'Invalid secret token' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { path, tag, collection } = body;

    if (path) {
      revalidatePath(path);
      return NextResponse.json({ revalidated: true, path, now: Date.now() });
    }

    if (tag) {
      revalidateTag(tag);
      return NextResponse.json({ revalidated: true, tag, now: Date.now() });
    }

    if (collection) {
      revalidatePath('/', 'layout');
      return NextResponse.json({ revalidated: true, collection, now: Date.now() });
    }

    // Fallback: revalidate layout
    revalidatePath('/', 'layout');
    return NextResponse.json({ revalidated: true, fallback: true, now: Date.now() });
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Revalidation failed' }, { status: 500 });
  }
}
`;
}

/**
 * Locate the opening brace index of the primary component function body.
 * Accurately handles:
 * - `export default function ComponentName(...) {`
 * - `export default function(...) {`
 * - `export default withResponsiveProps(ComponentName);` where `function ComponentName(...) {` is defined
 * - `export default ComponentName;`
 * - `const ComponentName = (...) => { ... }; export default withResponsiveProps(ComponentName);`
 * - Correctly skips helper functions and subcomponents (like `MotionLinkBase`) that precede the main component.
 */
export function findComponentBodyInsertionIndex(code: string): number {
  try {
    const ast = parseJSX(code);
    if (ast) {
      let exportIdent: string | null = null;
      let directFunctionBody: any = null;

      for (const node of ast.program.body) {
        if (t.isExportDefaultDeclaration(node)) {
          const decl = node.declaration;
          if (t.isFunctionDeclaration(decl) || t.isFunctionExpression(decl) || t.isArrowFunctionExpression(decl)) {
            directFunctionBody = decl.body;
            break;
          } else if (t.isIdentifier(decl)) {
            exportIdent = decl.name;
          } else if (t.isCallExpression(decl)) {
            const firstArg = decl.arguments[0];
            if (firstArg) {
              if (t.isIdentifier(firstArg)) {
                exportIdent = firstArg.name;
              } else if (t.isFunctionExpression(firstArg) || t.isArrowFunctionExpression(firstArg)) {
                directFunctionBody = firstArg.body;
                break;
              }
            }
          }
        }
      }

      if (directFunctionBody && (directFunctionBody as any).start != null) {
        if (t.isBlockStatement(directFunctionBody)) {
          return (directFunctionBody as any).start + 1;
        }
      }

      if (exportIdent) {
        for (const node of ast.program.body) {
          if (t.isFunctionDeclaration(node) && node.id && node.id.name === exportIdent) {
            if (node.body && (node.body as any).start != null) {
              return (node.body as any).start + 1;
            }
          }
          if (t.isVariableDeclaration(node)) {
            for (const d of node.declarations) {
              if (t.isIdentifier(d.id) && d.id.name === exportIdent && d.init) {
                if (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init)) {
                  if (t.isBlockStatement(d.init.body) && (d.init.body as any).start != null) {
                    return (d.init.body as any).start + 1;
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch {}

  // Fallback: regex scan targeting the exported identifier
  const exportName = code.match(/export\s+default\s+function\s+([A-Za-z0-9_$]+)/)?.[1]
    ?? code.match(/export\s+default\s+(?:withResponsiveProps|memo|React\.memo)?\s*\(\s*([A-Za-z0-9_$]+)\s*\)/)?.[1]
    ?? code.match(/export\s+default\s+([A-Za-z0-9_$]+)\s*;/)?.[1];

  const startRe = exportName
    ? new RegExp(`function\\s+${exportName}\\s*\\(`)
    : /export\s+default\s+function\s*[\w$]*\s*\(/;

  const m = startRe.exec(code);
  if (m) {
    let i = m.index + m[0].length - 1;
    let depth = 0;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    while (i < code.length && code[i] !== '{') i++;
    if (i < code.length && code[i] === '{') return i + 1;
  }

  // Last-resort fallback: first function starting with a capital letter (PascalCase component)
  const compMatch = code.match(/function\s+([A-Z]\w*)\s*\(/);
  if (compMatch && compMatch.index !== undefined) {
    let i = compMatch.index + compMatch[0].length - 1;
    let depth = 0;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    while (i < code.length && code[i] !== '{') i++;
    if (i < code.length && code[i] === '{') return i + 1;
  }

  return -1;
}

/**
 * Adapt component CMS imports (@/cms/<slug>.json) into live /api/cms/query relay calls.
 * In Dynamic Mode: imports are stripped and component fetches via POST /api/cms/query.
 * In Hybrid SSG Mode: static import serves as initial SWR state, refreshed via POST /api/cms/query.
 */
export function adaptComponentCmsQueries(
  code: string,
  apiConfigs: Record<string, ApiCollectionConfig>,
  isDynamic: boolean,
): string {
  if (!code.includes('/cms/') || Object.keys(apiConfigs).length === 0) return code;

  let updatedCode = code;
  const injectedHooks: string[] = [];

  for (const apiSlug of Object.keys(apiConfigs)) {
    const importRe = new RegExp(
      `import\\s+([A-Za-z0-9_$]+)\\s+from\\s+['"](?:@|\\.\\.)\\/cms\\/${escapeRegExp(apiSlug)}\\.json['"];?`,
      'g',
    );
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(updatedCode)) !== null) {
      const fullImport = match[0];
      const importVar = match[1];
      if (importVar.endsWith('Initial')) {
        continue;
      }
      const capVar = importVar.charAt(0).toUpperCase() + importVar.slice(1);

      if (updatedCode.includes(`const [${importVar}, set${capVar}] = React.useState`)) {
        continue;
      }

      if (isDynamic) {
        // Strip static JSON import
        updatedCode = updatedCode.replace(fullImport, '');
        injectedHooks.push(
          `  const [${importVar}, set${capVar}] = React.useState<any[]>([]);\n` +
          `  React.useEffect(() => {\n` +
          `    fetch('/api/cms/query', {\n` +
          `      method: 'POST',\n` +
          `      headers: { 'Content-Type': 'application/json' },\n` +
          `      body: JSON.stringify({ collection: '${apiSlug}' }),\n` +
          `      cache: 'no-store',\n` +
          `    })\n` +
          `      .then((res) => res.json())\n` +
          `      .then((data) => {\n` +
          `        if (data && data.ok && Array.isArray(data.items)) set${capVar}(data.items);\n` +
          `      })\n` +
          `      .catch(() => {});\n` +
          `  }, []);`,
        );
      } else {
        // Hybrid SWR: retain initial static data, refresh in background
        const initialVar = `${importVar}Initial`;
        updatedCode = updatedCode.replace(
          fullImport,
          `import ${initialVar} from '@/cms/${apiSlug}.json';`,
        );
        injectedHooks.push(
          `  const [${importVar}, set${capVar}] = React.useState<any[]>(${initialVar});\n` +
          `  React.useEffect(() => {\n` +
          `    fetch('/api/cms/query', {\n` +
          `      method: 'POST',\n` +
          `      headers: { 'Content-Type': 'application/json' },\n` +
          `      body: JSON.stringify({ collection: '${apiSlug}' }),\n` +
          `    })\n` +
          `      .then((res) => res.json())\n` +
          `      .then((data) => {\n` +
          `        if (data && data.ok && Array.isArray(data.items)) set${capVar}(data.items);\n` +
          `      })\n` +
          `      .catch(() => {});\n` +
          `  }, []);`,
        );
      }
    }
  }

  if (injectedHooks.length === 0) return code;

  // Ensure 'use client' is present
  if (!updatedCode.includes("'use client'") && !updatedCode.includes('"use client"')) {
    updatedCode = `'use client';\n${updatedCode}`;
  }

  // Ensure React is imported
  if (!/\bimport\s+.*?\bReact\b.*?from\s+['"]react['"]/.test(updatedCode)) {
    updatedCode = `import React from 'react';\n${updatedCode}`;
  }

  // Inject hooks into default export or primary component function
  const insertPos = findComponentBodyInsertionIndex(updatedCode);
  if (insertPos !== -1) {
    updatedCode =
      updatedCode.slice(0, insertPos) +
      '\n' +
      injectedHooks.join('\n') +
      '\n' +
      updatedCode.slice(insertPos);
  }

  return updatedCode;
}

/**
 * Injects differentiated prefetching:
 * - Primary Navigation & Header <Link> tags receive prefetch={true}.
 * - Repeating collection links (e.g. data-cms-nav="row", data-cms-card) receive intent prefetch on hover.
 */
export function injectDifferentiatedLinkPrefetch(code: string, filePath: string): string {
  if (!code.includes('<Link') && !code.includes('<MotionLink')) return code;

  const ast = parseJSX(code);
  if (!ast) return code;

  let touched = false;
  const isNavFile = /navbar|header|nav|menu/i.test(filePath);

  const checkLink = (opening: t.JSXOpeningElement, inNavAncestor: boolean, inRepeaterAncestor: boolean) => {
    const isLinkTag =
      (t.isJSXIdentifier(opening.name) && opening.name.name === 'Link') ||
      (t.isJSXIdentifier(opening.name) && opening.name.name === 'MotionLink');

    if (!isLinkTag) return;

    // Check if this link has data-cms-nav or is inside repeater
    const hasCmsNav = opening.attributes.some(
      (a) =>
        t.isJSXAttribute(a) &&
        t.isJSXIdentifier(a.name) &&
        (a.name.name === 'data-cms-nav' || a.name.name === 'data-cms-card' || a.name.name === 'data-cms-item'),
    );

    const isRepeater = hasCmsNav || inRepeaterAncestor;

    // Check explicit data-prefetch attribute
    const prefetchAttrIdx = opening.attributes.findIndex(
      (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'data-prefetch',
    );
    let explicitPrefetch: string | null = null;
    if (prefetchAttrIdx !== -1) {
      const attr = opening.attributes[prefetchAttrIdx] as t.JSXAttribute;
      if (t.isStringLiteral(attr.value)) {
        explicitPrefetch = attr.value.value;
      }
    }

    const setPrefetchProp = (val: boolean) => {
      const prefetchIdx = opening.attributes.findIndex(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'prefetch',
      );
      if (prefetchIdx === -1) {
        opening.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('prefetch'), t.jsxExpressionContainer(t.booleanLiteral(val))),
        );
        touched = true;
      } else {
        const existing = opening.attributes[prefetchIdx] as t.JSXAttribute;
        if (
          !t.isJSXExpressionContainer(existing.value) ||
          !t.isBooleanLiteral(existing.value.expression) ||
          existing.value.expression.value !== val
        ) {
          existing.value = t.jsxExpressionContainer(t.booleanLiteral(val));
          touched = true;
        }
      }
    };

    const injectSafeHoverPrefetch = () => {
      const hasOnMouseEnter = opening.attributes.some(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'onMouseEnter',
      );
      if (!hasOnMouseEnter) {
        const parsed = parseJSX(
          '<a onMouseEnter={(e) => { const href = e.currentTarget.getAttribute("href"); const router = typeof window !== "undefined" ? (window.__revyme_router || window.router) : null; if (href && router && router.prefetch) router.prefetch(href, { kind: "full" }); }} />',
        );
        if (parsed) {
          const attr = (parsed.program.body[0] as any).expression.openingElement.attributes[0];
          opening.attributes.push(attr);
          touched = true;
        }
      }
    };

    const hasResponsivePrefetch = opening.attributes.some(
      (a) =>
        t.isJSXAttribute(a) &&
        t.isJSXIdentifier(a.name) &&
        (a.name.name === 'data-prefetch-tablet' || a.name.name === 'data-prefetch-mobile'),
    );

    if (explicitPrefetch === 'off' && !hasResponsivePrefetch) {
      setPrefetchProp(false);
    } else if (hasResponsivePrefetch) {
      setPrefetchProp(false);
      injectSafeHoverPrefetch();
    } else if (explicitPrefetch === 'viewport') {
      setPrefetchProp(true);
    } else if (explicitPrefetch === 'intent') {
      setPrefetchProp(false);
      injectSafeHoverPrefetch();
    } else if (isNavFile || inNavAncestor) {
      setPrefetchProp(true);
    } else if (isRepeater) {
      setPrefetchProp(false);
      if (prefetchAttrIdx === -1) {
        opening.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('data-prefetch'), t.stringLiteral('intent')),
        );
        touched = true;
      }
      injectSafeHoverPrefetch();
    }
  };

  const walk = (node: any, inNav: boolean, inRepeater: boolean) => {
    if (!node || typeof node !== 'object') return;

    let currentNav = inNav;
    let currentRepeater = inRepeater;

    if (node.type === 'JSXElement') {
      const opening = node.openingElement;
      const tagName = t.isJSXIdentifier(opening.name) ? opening.name.name.toLowerCase() : '';
      if (tagName === 'nav' || tagName === 'header') {
        currentNav = true;
      }
      const hasNavAttr = opening.attributes.some(
        (a: any) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name) &&
          (a.name.name === 'data-nav' ||
            (a.name.name === 'data-name' &&
              t.isStringLiteral(a.value) &&
              (a.value.value === 'Navbar' || a.value.value === 'Header'))),
      );
      if (hasNavAttr) currentNav = true;

      checkLink(opening, currentNav, currentRepeater);
    } else if (node.type === 'CallExpression') {
      // Check for .map(...) which creates repeater rows
      if (
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === 'map'
      ) {
        currentRepeater = true;
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'tokens') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c, currentNav, currentRepeater);
      } else if (child && typeof child === 'object') {
        walk(child, currentNav, currentRepeater);
      }
    }
  };

  walk(ast.program, isNavFile, false);

  if (!touched) return code;

  try {
    return generate(ast, { retainLines: false, concise: false }, code).code;
  } catch {
    return code;
  }
}

/**
 * Automatically discovers static routes and CMS dynamic collections, and ensures
 * zero-config `app/sitemap.ts`, `app/robots.ts`, `app/llms.txt/route.ts`,
 * and `app/llms-full.txt/route.ts` are present.
 */
export function ensureSeoAndAiDiscoveryFiles(
  files: Record<string, string>,
  apiConfigs: Record<string, ApiCollectionConfig> = {},
): Record<string, string> {
  const result = { ...files };

  // 1. Gather locales if i18n/config.json exists
  let locales: string[] = [];
  let defaultLocale = 'en';
  if (files['i18n/config.json']) {
    try {
      const parsed = JSON.parse(files['i18n/config.json']);
      if (Array.isArray(parsed.locales)) {
        locales = parsed.locales
          .map((l: any) => (typeof l === 'string' ? l : l.code))
          .filter(Boolean);
      }
      if (parsed.defaultLocale) defaultLocale = parsed.defaultLocale;
    } catch {}
  }

  // 2. Discover static and dynamic routes from app/**/page.client.tsx and app/**/page.tsx
  const routeDirs = new Set<string>();
  for (const p of Object.keys(files)) {
    if (
      p.startsWith('app/') &&
      !p.startsWith('app/api/') &&
      !p.startsWith('app/llms') &&
      !p.startsWith('app/[lang]/')
    ) {
      if (isLocaleRouteFile(p, files[p])) continue;
      if (
        p.endsWith('/page.client.tsx') ||
        p.endsWith('/page.client.jsx') ||
        p === 'app/page.client.tsx' ||
        p === 'app/page.client.jsx' ||
        p.endsWith('/page.tsx') ||
        p === 'app/page.tsx'
      ) {
        const dir = p.replace(/^app\//, '').replace(/\/?page(\.client)?\.(tsx|jsx)$/, '');
        routeDirs.add(dir);
      }
    }
  }

  // Find site title & description from app/layout.tsx
  let siteTitle = 'Revyme Site';
  let siteDescription = 'Built with Revyme Website Builder';
  const layoutCode = files['app/layout.tsx'] || files['app/layout.jsx'] || '';
  if (layoutCode) {
    const tMatch = layoutCode.match(/title:\s*['"`]([^'"`]+)['"`]/);
    if (tMatch) siteTitle = tMatch[1];
    const dMatch = layoutCode.match(/description:\s*['"`]([^'"`]+)['"`]/);
    if (dMatch) siteDescription = dMatch[1];
  }

  // Available local collections & api collections
  const localCollections = new Set<string>();
  for (const p of Object.keys(files)) {
    if (p.startsWith('cms/') && p.endsWith('.json') && !p.endsWith('.schema.json')) {
      localCollections.add(p.replace(/^cms\//, '').replace(/\.json$/, ''));
    }
  }
  const allCollectionSlugs = new Set([...localCollections, ...Object.keys(apiConfigs)]);

  const staticRoutes: SitemapRoute[] = [];
  const cmsCollections: SitemapCmsCollection[] = [];
  const keyPages: LlmsPageItem[] = [];
  const llmsCollections: LlmsCmsCollection[] = [];

  for (const dir of Array.from(routeDirs).sort()) {
    const rawSegments = dir ? dir.split('/') : [];
    // Ignore route groups like (main) or (auth)
    const cleanSegments = rawSegments.filter((s) => Boolean(s) && !/^\(.*\)$/.test(s));
    const isDynamic = cleanSegments.some((s) => /^\[.*\]$/.test(s));

    if (!isDynamic) {
      const urlPath = '/' + cleanSegments.join('/');
      const formattedUrl = urlPath === '/' ? '/' : urlPath;

      // Check noindex in server or client code
      const serverCode = files[`app/${dir ? dir + '/' : ''}page.tsx`] || '';
      const clientCode = files[`app/${dir ? dir + '/' : ''}page.client.tsx`] || '';
      const isNoIndex =
        /robots:\s*\{\s*index:\s*false/.test(serverCode) ||
        /noindex:\s*true/.test(serverCode) ||
        /robots:\s*\{\s*index:\s*false/.test(clientCode);

      if (!isNoIndex) {
        staticRoutes.push({
          url: formattedUrl,
          priority: formattedUrl === '/' ? 1.0 : 0.8,
          changeFrequency: formattedUrl === '/' ? 'daily' : 'monthly',
        });
      }

      const pageTitle =
        formattedUrl === '/'
          ? siteTitle
          : cleanSegments[cleanSegments.length - 1]
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());

      keyPages.push({
        title: pageTitle,
        path: formattedUrl,
      });
    } else {
      // Dynamic route, e.g. blog/[slug] or category/[category]
      const prefixSegments = cleanSegments.slice(0, cleanSegments.length - 1);
      const routePrefix = '/' + prefixSegments.join('/');
      const lastSeg = cleanSegments[cleanSegments.length - 1];
      const paramName = lastSeg.replace(/^\[+/, '').replace(/\]+$/, '');

      // Identify corresponding collection
      const serverCode = files[`app/${dir ? dir + '/' : ''}page.tsx`] || '';
      const clientCode = files[`app/${dir ? dir + '/' : ''}page.client.tsx`] || '';

      let matchedCol: string | null = null;

      // 1. Check explicit @cmsPage annotation in client or server code
      const cmsMeta = parseCmsPageMeta(clientCode) || parseCmsPageMeta(serverCode);
      if (cmsMeta && allCollectionSlugs.has(cmsMeta.collection)) {
        matchedCol = cmsMeta.collection;
      }

      // 2. Check server wrapper (page.tsx) which imports the primary collection for this detail route
      if (!matchedCol && serverCode) {
        const serverImportMatch = serverCode.match(/from\s+['"][^'"]*cms\/([^'"\/]+)\.json['"]/);
        if (serverImportMatch && allCollectionSlugs.has(serverImportMatch[1])) {
          matchedCol = serverImportMatch[1];
        } else {
          for (const col of allCollectionSlugs) {
            if (
              serverCode.includes(`apiCollections['${col}']`) ||
              serverCode.includes(`apiCollections["${col}"]`) ||
              serverCode.includes(`getApiCollection('${col}')`) ||
              serverCode.includes(`getApiCollection("${col}")`) ||
              serverCode.includes(`static params for ${col}:`)
            ) {
              matchedCol = col;
              break;
            }
          }
        }
      }

      // 3. Check URL segment matching against collection slugs
      if (!matchedCol) {
        const candidates = [
          paramName,
          paramName + 's',
          paramName + 'es',
          paramName.endsWith('y') ? paramName.slice(0, -1) + 'ies' : null,
          prefixSegments[prefixSegments.length - 1],
          prefixSegments[prefixSegments.length - 1]
            ? prefixSegments[prefixSegments.length - 1] + 's'
            : null,
          prefixSegments[prefixSegments.length - 1]
            ? prefixSegments[prefixSegments.length - 1] + 'es'
            : null,
          prefixSegments[prefixSegments.length - 1] &&
          prefixSegments[prefixSegments.length - 1].endsWith('y')
            ? prefixSegments[prefixSegments.length - 1].slice(0, -1) + 'ies'
            : null,
          prefixSegments[prefixSegments.length - 1] === 'blog' ? 'posts' : null,
          prefixSegments[prefixSegments.length - 1] === 'blog' ? 'articles' : null,
        ].filter(Boolean) as string[];

        for (const cand of candidates) {
          if (allCollectionSlugs.has(cand)) {
            matchedCol = cand;
            break;
          }
        }
      }

      // 4. Check client code imports (only if not matched by @cmsPage, server wrapper, or URL candidates)
      if (!matchedCol && clientCode) {
        for (const col of allCollectionSlugs) {
          if (
            clientCode.includes(`cms/${col}.json`) ||
            clientCode.includes(`apiCollections['${col}']`) ||
            clientCode.includes(`apiCollections["${col}"]`)
          ) {
            matchedCol = col;
            break;
          }
        }
      }

      // 5. Fallback: if only 1 collection exists, match it
      if (!matchedCol && allCollectionSlugs.size === 1) {
        matchedCol = Array.from(allCollectionSlugs)[0];
      }

      if (matchedCol) {
        const alreadyAdded = cmsCollections.some(
          (c) => c.collection === matchedCol && c.routePrefix === routePrefix,
        );
        if (!alreadyAdded) {
          const apiConfig = apiConfigs[matchedCol];
          cmsCollections.push({
            collection: matchedCol,
            routePrefix: routePrefix || '/',
            paramName,
            slugField: 'slug',
            priority: 0.7,
            changeFrequency: 'weekly',
            apiConfig: apiConfig
              ? {
                  endpoint: apiConfig.url,
                  itemsPath: apiConfig.itemsKey,
                  headers: apiConfig.headers,
                }
              : undefined,
          });

          llmsCollections.push({
            collectionSlug: matchedCol,
            routePrefix: routePrefix || '/',
            titleField: 'title',
            descriptionField: 'excerpt',
            slugField: 'slug',
          });
        }
      }
    }
  }

  // 3. Ensure app/sitemap.ts exists
  if (!result['app/sitemap.ts'] && !result['app/sitemap.js']) {
    if (!staticRoutes.some((r) => r.url === '/')) {
      staticRoutes.unshift({ url: '/', priority: 1.0, changeFrequency: 'daily' });
    }
    result['app/sitemap.ts'] = generateSitemapCode({
      staticRoutes,
      cmsCollections,
      locales,
      defaultLocale,
    });
  }

  // 4. Ensure app/robots.ts exists
  if (!result['app/robots.ts'] && !result['app/robots.js'] && !result['public/robots.txt']) {
    let robotsConfig: RobotsGeneratorInput = {
      mode: 'allow_all',
      aiBots: {
        gptBot: true,
        claudeBot: true,
        perplexityBot: true,
        googleExtended: true,
      },
    };
    if (result['_meta/robots.json']) {
      try {
        const parsed = JSON.parse(result['_meta/robots.json']);
        robotsConfig = { ...robotsConfig, ...parsed };
      } catch {}
    }
    result['app/robots.ts'] = generateRobotsCode(robotsConfig);
  }

  // 5. Ensure app/llms.txt/route.ts and app/llms-full.txt/route.ts exist
  if (!result['app/llms.txt/route.ts']) {
    let llmsConfig: LlmsRouteGeneratorInput = {
      siteTitle,
      siteDescription,
      keyPages,
      cmsCollections: llmsCollections,
    };
    if (result['_meta/llms.json']) {
      try {
        const parsed = JSON.parse(result['_meta/llms.json']);
        llmsConfig = { ...llmsConfig, ...parsed };
      } catch {}
    }
    result['app/llms.txt/route.ts'] = generateLlmsRouteCode(llmsConfig);
  }

  if (!result['app/llms-full.txt/route.ts']) {
    let llmsConfig: LlmsRouteGeneratorInput = {
      siteTitle,
      siteDescription,
      keyPages,
      cmsCollections: llmsCollections,
    };
    if (result['_meta/llms.json']) {
      try {
        const parsed = JSON.parse(result['_meta/llms.json']);
        llmsConfig = { ...llmsConfig, ...parsed };
      } catch {}
    }
    result['app/llms-full.txt/route.ts'] = generateLlmsFullRouteCode(llmsConfig);
  }

  return result;
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

    // Hybrid SSG: inject generateStaticParams into all dynamic routes and locale route wrappers
    if (isHybridMode && (path.endsWith('/page.tsx') || path === 'app/page.tsx') && /\[[a-zA-Z0-9_.-]+\]/.test(path) && files[path]) {
      if (isLocaleRouteFile(path, files[path])) {
        files[path] = files[path].replace(
          /export\s*\{\s*default\s*\}\s*from/,
          'export { default, generateStaticParams } from',
        );
      } else {
        files[path] = ensureDynamicRouteStaticParams({
          routePath: path,
          serverCode: files[path],
          allFiles: files,
          apiConfigs,
        });
      }
    }

    // Server Component export guard: generateMetadata and metadata must never have 'use client'
    if (files[path] && (files[path].includes('generateMetadata') || files[path].includes('export const metadata') || files[path].includes('generateStaticParams'))) {
      files[path] = files[path].replace(/^(['"])use client\1;\s*\n?/m, '');
    }

    // Ensure metadataBase is set on root layout metadata to prevent Next.js build-time metadataBase warnings
    if ((path === 'app/layout.tsx' || path.endsWith('/layout.tsx')) && files[path] && files[path].includes('export const metadata') && !files[path].includes('metadataBase')) {
      files[path] = files[path].replace(
        /export const metadata = \{/,
        "export const metadata = {\n  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),",
      );
    }

    // Clean and protect CMS bindings & bare attributes across all pages and components
    if (files[path] && /\.(tsx|jsx)$/.test(path)) {
      let updated = files[path];
      if (updated.includes('<img') && /\balt\b(?!\s*=)/.test(updated)) {
        updated = repairBareAltAttributes(updated);
      }
      if (updated.includes('{item.') || updated.includes('{item?.') || updated.includes('img_file.metadata')) {
        updated = repairLegacyDetailBindings(updated);
      }
      if (updated !== files[path]) {
        files[path] = updated;
      }
    }

    // Differentiated Link prefetching: navigation links get prefetch={true}, repeater links get intent prefetch
    if (files[path] && /\.(tsx|jsx)$/.test(path) && (files[path].includes('<Link') || files[path].includes('<MotionLink'))) {
      files[path] = injectDifferentiatedLinkPrefetch(files[path], path);
    }

    // Adapt component CMS queries: convert static @/cms/*.json imports to live /api/cms/query relay
    if (files[path] && path.startsWith('components/') && /\.(tsx|jsx)$/.test(path)) {
      files[path] = adaptComponentCmsQueries(files[path], apiConfigs, isDynamicMode);
    }

    // Inject responsive image srcSet and sizes into all page and component JSX files
    if (files[path] && /\.(tsx|jsx)$/.test(path) && (files[path].includes('<img') || files[path].includes('<motion.img'))) {
      files[path] = injectResponsiveImageSrcSets(files[path], apiConfigs);
    }
  }

  // Transform Google Fonts @import into next/font/google loaders
  files = transformSiteFilesForNextFonts(files);

  // Ensure SEO (sitemap, robots) and AI discovery (llms.txt) files exist
  files = ensureSeoAndAiDiscoveryFiles(files, apiConfigs);

  // Deterministic publish-time localization pass
  files = prepareLocalizedSiteFiles(files);

  // Provide lib/image-utils.ts and scripts/optimize-images.mjs for runtime / build resolution
  if (!files['lib/image-utils.ts']) {
    files['lib/image-utils.ts'] = IMAGE_UTILS_TS;
  }
  if (!files['scripts/optimize-images.mjs']) {
    files['scripts/optimize-images.mjs'] = OPTIMIZE_IMAGES_SCRIPT;
  }

  // Provide server query relay route handler & on-demand revalidation route if API collections exist
  if (Object.keys(apiConfigs).length > 0) {
    if (!files['app/api/cms/query/route.ts']) {
      files['app/api/cms/query/route.ts'] = buildCmsQueryRouteHandler(apiConfigs);
    }
    if (!files['app/api/revalidate/route.ts']) {
      files['app/api/revalidate/route.ts'] = buildCmsRevalidateRouteHandler();
    }
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
  const clean = path.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
  return (clean.split('/', 1)[0] ?? '').startsWith('_');
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
