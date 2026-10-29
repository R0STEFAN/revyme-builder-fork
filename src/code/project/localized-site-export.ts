// src/code/project/localized-site-export.ts — Deterministic publish-time localization pass
// Transforms authored project snapshot into an app/[lang] Next.js route tree with proxy rewrite.

import { parseJSX, normalizeBabelTraverse } from '../parsing/ast-utils';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { generate } from '../generation/generator-utils';
import { ensureLocaleHook } from '../generation/scoped-expr';
import { isSpecialOrExternalHref, isSystemOrAssetPath } from '@/shared/locale-routing';
import type { I18nConfig } from '@/shared/types';
import { filePathToSlug } from './active-file-store';
import { extractExportObject } from '../generation/metadata-gen';

const traverse = normalizeBabelTraverse(_traverse);

export const LOCALIZED_OUTPUT_MARKER = '@revyme-localized-output v1';

/**
 * Checks whether an app file should be moved under app/[lang]/
 */
function shouldMoveToLangTree(path: string): boolean {
  if (!path.startsWith('app/')) return false;

  // Keep API routes outside the language tree
  if (path.startsWith('app/api/')) return false;

  // Keep site-wide metadata endpoints outside the language tree
  if (
    path === 'app/robots.ts' ||
    path === 'app/robots.txt' ||
    path === 'app/sitemap.ts' ||
    path === 'app/sitemap.xml' ||
    path === 'app/manifest.ts' ||
    path === 'app/manifest.json' ||
    path === 'app/favicon.ico' ||
    path.startsWith('app/llms.txt/') ||
    path.startsWith('app/llms-full.txt/')
  ) {
    return false;
  }

  // Keep global CSS and Providers at root level of app/
  if (path === 'app/globals.css' || path === 'app/providers.tsx') {
    return false;
  }

  return true;
}

/**
 * Normalizes relative directory calculation
 */
function getDir(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash !== -1 ? filePath.slice(0, lastSlash) : '';
}

function computeRelativePath(fromDir: string, targetFile: string): string {
  const fromParts = fromDir ? fromDir.split('/') : [];
  const toParts = targetFile.split('/');

  // Find common prefix
  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common++;
  }

  const ups = fromParts.length - common;
  const upParts = Array(ups).fill('..');
  const downParts = toParts.slice(common);

  const res = [...upParts, ...downParts].join('/');
  return res.startsWith('.') ? res : `./${res}`;
}

/**
 * Resolves a relative import path to a project-root relative file path
 */
function resolveImportPath(importerDir: string, importSource: string): string {
  if (importSource.startsWith('@/')) {
    return importSource.slice(2);
  }
  if (!importSource.startsWith('.')) {
    return importSource; // package import (e.g. 'react')
  }

  const parts = importerDir ? importerDir.split('/') : [];
  const segs = importSource.split('/');

  for (const seg of segs) {
    if (seg === '.') continue;
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

/**
 * Retargets relative imports in a source file based on path movement map
 */
function retargetImports(
  code: string,
  oldPath: string,
  newPath: string,
  pathMap: Map<string, string>,
  allFiles: Set<string>,
): string {
  if (!code.includes('import') && !code.includes('export')) return code;

  let ast: t.File | null = null;
  try {
    ast = parseJSX(code);
  } catch {
    return code; // If unparseable, return unchanged
  }
  if (!ast) return code;

  const oldDir = getDir(oldPath);
  const newDir = getDir(newPath);
  let modified = false;

  traverse(ast, {
    ImportDeclaration(pathNode) {
      const source = pathNode.node.source.value;
      if (!source.startsWith('.')) return; // Don't touch package imports or @/ aliases

      const resolved = resolveImportPath(oldDir, source);
      // Determine what the target file path in the project is
      let matchedTarget: string | null = null;
      for (const ext of ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json']) {
        const candidate = `${resolved}${ext}`;
        if (allFiles.has(candidate)) {
          matchedTarget = candidate;
          break;
        }
      }

      if (!matchedTarget) return;

      // Where does that target file live now?
      const newTarget = pathMap.get(matchedTarget) ?? matchedTarget;

      // Compute new relative import from newDir to newTarget
      let newImport = computeRelativePath(newDir, newTarget);
      // Strip extension if original didn't have it (unless it was .css / .json)
      if (!source.endsWith('.css') && !source.endsWith('.json')) {
        newImport = newImport.replace(/\.(?:tsx|ts|jsx|js)$/, '');
      }

      if (newImport !== source) {
        pathNode.node.source.value = newImport;
        modified = true;
      }
    },
    ExportNamedDeclaration(pathNode) {
      if (!pathNode.node.source) return;
      const source = pathNode.node.source.value;
      if (!source.startsWith('.')) return;

      const resolved = resolveImportPath(oldDir, source);
      let matchedTarget: string | null = null;
      for (const ext of ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json']) {
        const candidate = `${resolved}${ext}`;
        if (allFiles.has(candidate)) {
          matchedTarget = candidate;
          break;
        }
      }

      if (!matchedTarget) return;
      const newTarget = pathMap.get(matchedTarget) ?? matchedTarget;
      let newImport = computeRelativePath(newDir, newTarget);
      if (!source.endsWith('.css') && !source.endsWith('.json')) {
        newImport = newImport.replace(/\.(?:tsx|ts|jsx|js)$/, '');
      }

      if (newImport !== source) {
        pathNode.node.source.value = newImport;
        modified = true;
      }
    },
    ExportAllDeclaration(pathNode) {
      const source = pathNode.node.source.value;
      if (!source.startsWith('.')) return;

      const resolved = resolveImportPath(oldDir, source);
      let matchedTarget: string | null = null;
      for (const ext of ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json']) {
        const candidate = `${resolved}${ext}`;
        if (allFiles.has(candidate)) {
          matchedTarget = candidate;
          break;
        }
      }

      if (!matchedTarget) return;
      const newTarget = pathMap.get(matchedTarget) ?? matchedTarget;
      let newImport = computeRelativePath(newDir, newTarget);
      if (!source.endsWith('.css') && !source.endsWith('.json')) {
        newImport = newImport.replace(/\.(?:tsx|ts|jsx|js)$/, '');
      }

      if (newImport !== source) {
        pathNode.node.source.value = newImport;
        modified = true;
      }
    },
  });

  return modified ? generate(ast).code : code;
}

/**
 * Transforms RootLayout into app/[lang]/layout.tsx
 */
function transformRootLayout(code: string, locales: readonly string[], defaultLocale: string): string {
  let updated = code;

  // 1. Remove unsupported route exports: `export const siteConfig` -> `const siteConfig`
  updated = updated.replace(/export\s+const\s+siteConfig\b/g, 'const siteConfig');

  // 2. Ensure notFound is imported from next/navigation
  if (!updated.includes('notFound')) {
    updated = `import { notFound } from 'next/navigation';\n${updated}`;
  } else if (!updated.includes("from 'next/navigation'") && !updated.includes('from "next/navigation"')) {
    updated = `import { notFound } from 'next/navigation';\n${updated}`;
  }

  // 3. Inject generateStaticParams
  const staticParamsFn = `
export function generateStaticParams() {
  return ${JSON.stringify(locales)}.map((lang) => ({ lang }));
}
`;

  // 4. Transform RootLayout component signature to async with Promise<{ lang: string }>
  // Replace: export default function RootLayout({ children }: { children: React.ReactNode })
  // with: RootLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> })
  const localesJson = JSON.stringify(locales);
  const layoutHeaderRegex = /export\s+default\s+(?:async\s+)?function\s+(?:RootLayout|Layout)\s*\([^)]*\)\s*\{/;

  const newLayoutHeader = `export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!${localesJson}.includes(lang)) {
    notFound();
  }`;

  if (layoutHeaderRegex.test(updated)) {
    updated = updated.replace(layoutHeaderRegex, newLayoutHeader);
  }

  // 5. Replace <Providers> with <Providers locale={lang}>
  updated = updated.replace(/<Providers(\s*>|\s+[^>]*>)/g, (match, tail) => {
    if (match.includes('locale=')) return match;
    return `<Providers locale={lang}${tail}`;
  });

  // 6. Ensure <html lang={lang}>
  if (/<html\b[^>]*\blang=/s.test(updated)) {
    updated = updated.replace(/(<html\b[^>]*\b)lang=(?:\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|'[^']*')/gs, '$1lang={lang}');
  } else {
    updated = updated.replace(/<html(\s|>)/, '<html lang={lang}$1');
  }

  return `${staticParamsFn}\n${updated}`;
}

/**
 * Generates proxy.ts for Next.js 16
 */
function buildProxySource(locales: readonly string[], defaultLocale: string): string {
  return `import { NextRequest, NextResponse } from 'next/server';
import { isSystemOrAssetPath } from './lib/revyme-locale-routing';

const DEFAULT_LOCALE = ${JSON.stringify(defaultLocale)};
const LOCALES = ${JSON.stringify(locales)};

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Bypass assets and API routes
  if (isSystemOrAssetPath(pathname)) {
    return NextResponse.next();
  }

  // 2. Canonical redirect: /${defaultLocale}/gallery -> /gallery (308 Permanent)
  if (pathname === \`/\${DEFAULT_LOCALE}\` || pathname.startsWith(\`/\${DEFAULT_LOCALE}/\`)) {
    const stripped = pathname === \`/\${DEFAULT_LOCALE}\` ? '/' : pathname.slice(DEFAULT_LOCALE.length + 1);
    const targetUrl = new URL(\`\${stripped}\${search}\`, request.url);
    return NextResponse.redirect(targetUrl, 308);
  }

  // 3. Allow explicitly requested secondary locales to proceed directly to their route
  for (const loc of LOCALES) {
    if (loc === DEFAULT_LOCALE) continue;
    if (pathname === \`/\${loc}\` || pathname.startsWith(\`/\${loc}/\`)) {
      return NextResponse.next();
    }
  }

  // 4. Default language rewrite: /gallery -> /${defaultLocale}/gallery internally
  const rewritePath = \`/\${DEFAULT_LOCALE}\${pathname === '/' ? '' : pathname}\`;
  const rewriteUrl = new URL(\`\${rewritePath}\${search}\`, request.url);
  return NextResponse.rewrite(rewriteUrl);
}

export const middleware = proxy;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
`;
}

/**
 * Generates lib/revyme-locale-routing.ts source to be embedded into the export
 */
function buildLocaleRoutingSource(defaultLocale: string, locales: readonly string[]): string {
  return `// lib/revyme-locale-routing.ts — Pure, isomorphic URL helpers for Revyme localized routing.

export const DEFAULT_LOCALE = ${JSON.stringify(defaultLocale)};
export const LOCALES = ${JSON.stringify(locales)} as const;

const ASSET_EXTENSION_RE = /\\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|woff2?|ttf|eot|otf|css|js|mjs|map|json|xml|txt|pdf|zip|gz|mp4|webm|ogg|mp3|wav)$/i;

export function stripLocale(pathname: string, locs: readonly string[] = LOCALES): string {
  if (!pathname || pathname === '/') return '/';
  const normalized = pathname.startsWith('/') ? pathname : \`/\${pathname}\`;
  for (const locale of locs) {
    if (normalized === \`/\${locale}\`) return '/';
    if (normalized.startsWith(\`/\${locale}/\`)) return normalized.slice(locale.length + 1);
  }
  return normalized;
}

export function localizePath(pathname: string, lang: string = DEFAULT_LOCALE, defaultLang: string = DEFAULT_LOCALE): string {
  const cleanPath = pathname ? (pathname.startsWith('/') ? pathname : \`/\${pathname}\`) : '/';
  if (lang === defaultLang) return cleanPath;
  if (cleanPath === '/') return \`/\${lang}\`;
  return \`/\${lang}\${cleanPath}\`;
}

export function isSpecialOrExternalHref(href: string): boolean {
  if (!href) return true;
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return true;
  if (/^(https?:|\\/\\/|mailto:|tel:|javascript:|blob:|data:)/i.test(trimmed)) return true;
  return false;
}

export function isSystemOrAssetPath(pathname: string): boolean {
  if (!pathname || pathname === '/') return false;
  if (pathname.startsWith('/api/') || pathname === '/api') return true;
  if (pathname.startsWith('/_next/') || pathname === '/_next') return true;
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml' || pathname === '/favicon.ico') return true;
  const lastSlash = pathname.lastIndexOf('/');
  const lastSegment = lastSlash !== -1 ? pathname.slice(lastSlash + 1) : pathname;
  if (ASSET_EXTENSION_RE.test(lastSegment)) return true;
  return false;
}

export type LinkHref = string | { pathname?: string; [key: string]: any };

export function localizeHref<T extends LinkHref>(
  href: T,
  activeLocale: string = DEFAULT_LOCALE,
  dl: string = DEFAULT_LOCALE,
  locs: readonly string[] = LOCALES,
): T {
  if (!href) return href;
  if (typeof href === 'object') {
    if (!href.pathname) return href;
    const localizedPath = localizeHref(href.pathname, activeLocale, dl, locs);
    return {
      ...href,
      pathname: typeof localizedPath === 'string' ? localizedPath : (localizedPath as any)?.pathname,
    };
  }
  const rawHref = String(href);
  if (isSpecialOrExternalHref(rawHref)) return href;
  const hashIdx = rawHref.indexOf('#');
  const pathAndQuery = hashIdx !== -1 ? rawHref.slice(0, hashIdx) : rawHref;
  const hash = hashIdx !== -1 ? rawHref.slice(hashIdx) : '';
  const queryIdx = pathAndQuery.indexOf('?');
  const rawPath = queryIdx !== -1 ? pathAndQuery.slice(0, queryIdx) : pathAndQuery;
  const search = queryIdx !== -1 ? pathAndQuery.slice(queryIdx) : '';
  if (isSystemOrAssetPath(rawPath)) return href;
  const barePath = stripLocale(rawPath, locs);
  const localizedPath = localizePath(barePath, activeLocale, dl);
  return \`\${localizedPath}\${search}\${hash}\` as T;
}
`;
}

function isInsideMotionLinkDecl(path: { findParent: (cb: (p: any) => boolean) => unknown }): boolean {
  return !!path.findParent((p: any) =>
    (p.isVariableDeclarator?.() && p.node?.id?.type === 'Identifier' && p.node.id.name === 'MotionLink') ||
    (p.isFunctionDeclaration?.() && p.node?.id?.type === 'Identifier' && p.node.id.name === 'MotionLinkBase') ||
    (p.isFunctionExpression?.() && p.node?.id?.type === 'Identifier' && p.node.id.name === 'MotionLinkBase')
  );
}

/**
 * Wraps <Link href="..."> and <MotionLink href="..."> with localizeHref(..., __activeLocale)
 */
function wrapNavLinksInCode(
  code: string,
  filePath: string,
  defaultLocale: string,
  locales: readonly string[],
): string {
  if (!code.includes('<Link') && !code.includes('<MotionLink')) {
    return code;
  }

  // Only client components have access to useLocale() / __activeLocale.
  // Server components receive params in Next.js and must not reference undefined __activeLocale.
  const isClient = code.includes("'use client'") || code.includes('"use client"');
  if (!isClient) {
    return code;
  }

  let ast: t.File | null = null;
  try {
    ast = parseJSX(code);
  } catch {
    return code;
  }
  if (!ast) return code;

  let changed = false;

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const tag = opening.name;
      const tagName =
        tag.type === 'JSXIdentifier'
          ? tag.name
          : tag.type === 'JSXMemberExpression'
          ? tag.property.name
          : null;

      if (tagName !== 'Link' && tagName !== 'MotionLink') return;

      // Skip internal <Link> rendered inside MotionLink declaration (scaffolding)
      if (isInsideMotionLinkDecl(path)) return;

      // Skip elements with data-no-vt (e.g. switcher links)
      if (
        opening.attributes.some(
          (a) => a.type === 'JSXAttribute' && a.name.name === 'data-no-vt'
        )
      ) {
        return;
      }

      const hrefAttr = opening.attributes.find(
        (a): a is t.JSXAttribute =>
          a.type === 'JSXAttribute' &&
          a.name.type === 'JSXIdentifier' &&
          a.name.name === 'href'
      );

      if (!hrefAttr || !hrefAttr.value) return;

      // Check if already wrapped with localizeHref
      if (hrefAttr.value.type === 'JSXExpressionContainer') {
        const expr = hrefAttr.value.expression;
        if (
          expr.type === 'CallExpression' &&
          expr.callee.type === 'Identifier' &&
          expr.callee.name === 'localizeHref'
        ) {
          return;
        }
        // Don't wrap if it's forwarding a prop named href
        if (expr.type === 'Identifier' && expr.name === 'href') {
          return;
        }
      }

      let innerExpr: t.Expression | null = null;
      if (hrefAttr.value.type === 'StringLiteral') {
        const raw = hrefAttr.value.value;
        if (isSpecialOrExternalHref(raw) || isSystemOrAssetPath(raw)) {
          return;
        }
        innerExpr = t.stringLiteral(raw);
      } else if (
        hrefAttr.value.type === 'JSXExpressionContainer' &&
        hrefAttr.value.expression.type !== 'JSXEmptyExpression'
      ) {
        innerExpr = hrefAttr.value.expression as t.Expression;
      }

      if (!innerExpr) return;

      hrefAttr.value = t.jsxExpressionContainer(
        t.callExpression(t.identifier('localizeHref'), [
          innerExpr,
          t.identifier('__activeLocale'),
        ])
      );
      changed = true;
    },
  });

  if (!changed) return code;

  let out = generate(ast).code;

  // Ensure import of localizeHref
  if (!out.includes('localizeHref')) {
    out = `import { localizeHref } from '@/lib/revyme-locale-routing';\n` + out;
  } else if (!/import\s*\{[^}]*\blocalizeHref\b[^}]*\}\s*from\s*['"]@\/lib\/revyme-locale-routing['"]/.test(out)) {
    const existing = out.match(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/revyme-locale-routing['"]/);
    if (existing && existing.index !== undefined) {
      out =
        out.slice(0, existing.index) +
        existing[0].replace(`{${existing[1]}}`, `{ ${existing[1].trim()}, localizeHref }`) +
        out.slice(existing.index + existing[0].length);
    } else {
      const firstImport = out.match(/^import[^\n]*\n/m);
      const at = firstImport && firstImport.index !== undefined ? firstImport.index : 0;
      out = out.slice(0, at) + `import { localizeHref } from '@/lib/revyme-locale-routing';\n` + out.slice(at);
    }
  }

  // Ensure locale hook if client component
  if (isClient) {
    out = ensureLocaleHook(out);
  }

  return out;
}

/**
 * Derives logical public route path from page file path.
 * e.g. 'app/page.tsx' -> '/'
 *      'app/gallery/page.tsx' -> '/gallery'
 *      'app/(site)/about/page.tsx' -> '/about'
 *      'app/blog/[slug]/page.tsx' -> '/blog/[slug]'
 */
export function pageFilePathToLogicalRoute(filePath: string): string {
  const stripped = filePath
    .replace(/^app\//, '')
    .replace(/\/page\.(tsx|jsx|js|ts)$/, '')
    .replace(/^page\.(tsx|jsx|js|ts)$/, '')
    .replace(/\([^)]+\)\//g, '')
    .replace(/\([^)]+\)$/, '');
  return stripped ? (stripped.startsWith('/') ? stripped : '/' + stripped) : '/';
}

interface TransformPageMetadataOptions {
  filePath: string;
  locales: readonly string[];
  defaultLocale: string;
  messagesByLocale: Record<string, Record<string, any>>;
}

/**
 * Transforms page metadata into an app/[lang] generateMetadata function
 * resolving localized canonical URL, reciprocal hreflang alternates, and
 * message-based _seo overrides per language.
 */
export function transformPageMetadata(
  code: string,
  opts: TransformPageMetadataOptions,
): string {
  const { filePath, locales, defaultLocale, messagesByLocale } = opts;
  const namespace = filePathToSlug(filePath);
  const logicalRoute = pageFilePathToLogicalRoute(filePath);

  // Check if any locale has _seo overrides for this page
  const seoOverrides: Record<string, any> = {};
  for (const loc of locales) {
    const override = messagesByLocale[loc]?.[namespace]?._seo;
    if (override && typeof override === 'object' && Object.keys(override).length > 0) {
      seoOverrides[loc] = override;
    }
  }

  const hasStaticMetadata = /export\s+const\s+metadata\b/.test(code);
  const hasGenerateMetadata = /export\s+async\s+function\s+generateMetadata\b/.test(code);

  // If no metadata is present on this page and no overrides exist, keep code unchanged
  if (!hasStaticMetadata && !hasGenerateMetadata && Object.keys(seoOverrides).length === 0) {
    return code;
  }

  let updated = code;

  if (hasStaticMetadata) {
    // Un-export the static metadata so we don't have conflicts with generateMetadata
    updated = updated.replace(/export\s+const\s+metadata\b/, 'const __authoredMetadata');
  } else if (hasGenerateMetadata) {
    // Rename existing generateMetadata to an un-exported local helper
    updated = updated.replace(
      /export\s+async\s+function\s+generateMetadata\b/,
      'async function __authoredGenerateMetadata',
    );
  }

  const overridesLiteral = JSON.stringify(seoOverrides, null, 2);
  const defaultLocLiteral = JSON.stringify(defaultLocale);
  const routeLiteral = JSON.stringify(logicalRoute);

  const genMetadataFn = `
// Generated localized metadata with canonical URL and reciprocal hreflangs
const __seoOverrides: Record<string, any> = ${overridesLiteral};

export async function generateMetadata(props: any = {}) {
  const resolvedParams = props?.params ? await props.params : undefined;
  const lang = resolvedParams?.lang || ${defaultLocLiteral};
  const overrides = __seoOverrides[lang] || {};
  const base = ${
    hasGenerateMetadata
      ? '(await __authoredGenerateMetadata(props)) || {}'
      : hasStaticMetadata
      ? '(typeof __authoredMetadata !== "undefined" ? __authoredMetadata : {})'
      : '{}'
  };

  let routePath = ${routeLiteral};
  if (resolvedParams) {
    for (const [k, v] of Object.entries(resolvedParams)) {
      if (k !== 'lang' && typeof v === 'string') {
        routePath = routePath.replace('[' + k + ']', v);
      }
    }
  }

  const getLocalizedPublicPath = (targetLocale: string) => {
    let baseCanonical = typeof base?.alternates?.canonical === 'string' ? base.alternates.canonical : '';
    let origin = '';
    if (baseCanonical.startsWith('http://') || baseCanonical.startsWith('https://')) {
      try {
        const u = new URL(baseCanonical);
        origin = u.origin;
        baseCanonical = u.pathname;
      } catch {}
    }
    if (!origin && typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SITE_URL) {
      const envUrl = process.env.NEXT_PUBLIC_SITE_URL.trim();
      if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
        origin = envUrl.replace(/\\/+$/, '');
      }
    }
    const rawPath = baseCanonical || routePath;
    const cleanPath = rawPath === '/' ? '' : rawPath.replace(/^\\/+/, '/');
    const localized = targetLocale === ${defaultLocLiteral}
      ? (cleanPath || '/')
      : ('/' + targetLocale + (cleanPath ? (cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath) : ''));
    return origin ? origin + localized : localized;
  };

  const canonical = getLocalizedPublicPath(lang);
  const alternatesLanguages: Record<string, string> = {
    ${locales
      .map(
        (l) => `${JSON.stringify(l)}: getLocalizedPublicPath(${JSON.stringify(l)}),`,
      )
      .join('\n    ')}
    'x-default': getLocalizedPublicPath(${defaultLocLiteral}),
  };

  return {
    ...base,
    title: overrides.title || base.title,
    description: overrides.description || base.description,
    openGraph: {
      ...base.openGraph,
      ...(overrides.ogTitle ? { title: overrides.ogTitle } : {}),
      ...(overrides.ogDescription ? { description: overrides.ogDescription } : {}),
      ...(overrides.ogImage ? { images: [overrides.ogImage] } : {}),
    },
    twitter: {
      ...base.twitter,
      ...(overrides.twitterTitle ? { title: overrides.twitterTitle } : {}),
      ...(overrides.twitterDescription ? { description: overrides.twitterDescription } : {}),
      ...(overrides.twitterImage ? { image: overrides.twitterImage } : {}),
      ...(overrides.twitterCard ? { card: overrides.twitterCard } : {}),
    },
    ...(overrides.robotsIndex !== undefined || overrides.robotsFollow !== undefined
      ? {
          robots: {
            ...base.robots,
            ...(overrides.robotsIndex !== undefined ? { index: overrides.robotsIndex } : {}),
            ...(overrides.robotsFollow !== undefined ? { follow: overrides.robotsFollow } : {}),
          },
        }
      : {}),
    alternates: {
      ...base.alternates,
      canonical,
      languages: alternatesLanguages,
    },
  };
}
`;

  return `${updated}\n${genMetadataFn}`;
}

/**
 * Main pure localization compiler pass
 */
export function prepareLocalizedSiteFiles(
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  // 1. Read i18n configuration
  let i18nConfig: I18nConfig | null = null;
  if (files['i18n/config.json']) {
    try {
      i18nConfig = JSON.parse(files['i18n/config.json']);
    } catch {}
  }

  // If no i18n config or single locale, retain standard output unchanged
  if (!i18nConfig || !i18nConfig.locales || i18nConfig.locales.length <= 1) {
    return { ...files };
  }

  const defaultLocale = i18nConfig.defaultLocale || 'en';
  const locales = i18nConfig.locales.map((l) => l.code);

  const messagesByLocale: Record<string, Record<string, any>> = {};
  for (const loc of locales) {
    const msgPath = `messages/${loc}.json`;
    if (files[msgPath]) {
      try {
        messagesByLocale[loc] = JSON.parse(files[msgPath]);
      } catch {}
    }
  }

  // Validate shared record slugs
  for (const [filePath, content] of Object.entries(files)) {
    if (filePath.startsWith('cms/') && filePath.endsWith('.json')) {
      const colSlug = filePath.replace(/^cms\//, '').replace(/\.json$/, '');
      try {
        const items = JSON.parse(content);
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item && item._i18n && typeof item._i18n === 'object') {
              for (const [locale, tr] of Object.entries(item._i18n)) {
                if (tr && typeof tr === 'object' && (tr as any)._slug && (tr as any)._slug !== item._slug) {
                  throw new Error(
                    `Localized record slug overrides are not supported in this release: collection "${colSlug}", item "${item._slug}" has _i18n[${locale}]._slug = "${(tr as any)._slug}". Use shared record slugs only.`
                  );
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err?.message?.includes('Localized record slug overrides are not supported')) {
          throw err;
        }
      }
    }
  }

  // 2. Idempotence: if already processed, return clean copy
  if (Object.values(files).some((code) => code.includes(LOCALIZED_OUTPUT_MARKER))) {
    return { ...files };
  }

  // 3. Prune legacy marker-owned @revyme-locale-route files from the output map
  const prunedInput: Record<string, string> = {};
  for (const [path, code] of Object.entries(files)) {
    if (code.includes('@revyme-locale-route')) {
      continue;
    }
    prunedInput[path] = code;
  }

  // 4. Build sourcePath -> outputPath map
  const pathMap = new Map<string, string>();
  const allSourceFiles = new Set(Object.keys(prunedInput));

  for (const path of allSourceFiles) {
    if (!shouldMoveToLangTree(path)) continue;

    // Check if path already starts with [lang]
    if (path.startsWith('app/[lang]/')) {
      pathMap.set(path, path);
      continue;
    }

    const subPath = path.slice('app/'.length);
    const newPath = `app/[lang]/${subPath}`;

    // Collision check: if both app/foo and app/[lang]/foo exist, reject
    if (allSourceFiles.has(newPath)) {
      throw new Error(`Localization export collision: both '${path}' and '${newPath}' define the same logical route.`);
    }

    pathMap.set(path, newPath);
  }

  // 5. Construct initial output files by moving paths and retargeting imports
  const output: Record<string, string> = {};

  for (const [path, code] of Object.entries(prunedInput)) {
    const newPath = pathMap.get(path);

    if (newPath) {
      // Path moved to app/[lang]/...
      let transformedCode = retargetImports(code, path, newPath, pathMap, allSourceFiles);

      // Special handling for RootLayout
      if (path === 'app/layout.tsx') {
        transformedCode = transformRootLayout(transformedCode, locales, defaultLocale);
      }

      // Special handling for Pages: metadata localization and alternate hreflangs
      const isPage = path === 'app/page.tsx' || (path.startsWith('app/') && path.endsWith('/page.tsx'));
      if (isPage) {
        transformedCode = transformPageMetadata(transformedCode, {
          filePath: path,
          locales,
          defaultLocale,
          messagesByLocale,
        });
      }

      output[newPath] = transformedCode;
    } else {
      // Path stayed in place (e.g. components/, lib/, app/globals.css, app/api/...)
      const transformedCode = retargetImports(code, path, path, pathMap, allSourceFiles);
      output[path] = transformedCode;
    }
  }

  // 6. Handle not-found.tsx
  // If app/not-found.tsx existed, it was moved to app/[lang]/not-found.tsx
  // We provide a root app/not-found.tsx wrapper for unhandled top-level 404s
  if (files['app/not-found.tsx'] && !output['app/not-found.tsx']) {
    output['app/not-found.tsx'] = `import React from 'react';
import { Providers } from './providers';
import AuthoredNotFound from './[lang]/not-found';

export default function GlobalNotFound() {
  return (
    <html lang=${JSON.stringify(defaultLocale)}>
      <body>
        <Providers locale=${JSON.stringify(defaultLocale)}>
          <AuthoredNotFound />
        </Providers>
      </body>
    </html>
  );
}
`;
  }

  // 7. Inject proxy.ts and lib/revyme-locale-routing.ts
  if (!output['proxy.ts']) {
    output['proxy.ts'] = buildProxySource(locales, defaultLocale);
  }
  if (!output['lib/revyme-locale-routing.ts']) {
    output['lib/revyme-locale-routing.ts'] = buildLocaleRoutingSource(defaultLocale, locales);
  }

  // 8. Wrap Nav Links in generated output .tsx files
  for (const [outputPath, code] of Object.entries(output)) {
    if (outputPath.endsWith('.tsx')) {
      output[outputPath] = wrapNavLinksInCode(code, outputPath, defaultLocale, locales);
    }
  }

  // 9. Mark output as localized
  output['app/[lang]/layout.tsx'] = `// ${LOCALIZED_OUTPUT_MARKER}\n${output['app/[lang]/layout.tsx']}`;

  return output;
}
