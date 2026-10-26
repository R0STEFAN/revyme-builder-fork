// src/shared/locale-routing.ts — Pure, isomorphic URL helpers for Revyme localized routing.
// Used at publish time, in proxy.ts, in generated Link wrappers, and by LocaleSwitcher.

/** Standard public asset extensions that should bypass locale routing */
const ASSET_EXTENSION_RE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|woff2?|ttf|eot|otf|css|js|mjs|map|json|xml|txt|pdf|zip|gz|mp4|webm|ogg|mp3|wav)$/i;

/**
 * Strips a configured leading language segment from a pathname.
 * e.g. '/en/gallery' -> '/gallery'
 *      '/en' -> '/'
 *      '/uk/about' -> '/about'
 *      '/enterprise' -> '/enterprise' (does NOT strip prefix if not a complete path segment)
 */
export function stripLocale(pathname: string, locales: readonly string[]): string {
  if (!pathname || pathname === '/') return '/';

  // Ensure leading slash
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;

  for (const locale of locales) {
    if (normalized === `/${locale}`) {
      return '/';
    }
    if (normalized.startsWith(`/${locale}/`)) {
      return normalized.slice(locale.length + 1);
    }
  }

  return normalized;
}

/**
 * Localizes a bare pathname for a target language.
 * Default language receives NO prefix (e.g. '/gallery').
 * Secondary language receives prefix (e.g. '/en/gallery').
 * Never adds a trailing slash except for root '/'.
 */
export function localizePath(pathname: string, lang: string, defaultLang: string): string {
  const cleanPath = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : '/';

  if (lang === defaultLang) {
    return cleanPath;
  }

  if (cleanPath === '/') {
    return `/${lang}`;
  }

  return `/${lang}${cleanPath}`;
}

/**
 * Checks if a string URL is external, a protocol scheme (mailto:, tel:), or anchor-only.
 */
export function isSpecialOrExternalHref(href: string): boolean {
  if (!href) return true;
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return true;
  if (/^(https?:|\/\/|mailto:|tel:|javascript:|blob:|data:)/i.test(trimmed)) return true;
  return false;
}

/**
 * Checks if a path is an API endpoint, Next.js internal, or a known static asset.
 */
export function isSystemOrAssetPath(pathname: string): boolean {
  if (!pathname || pathname === '/') return false;
  if (pathname.startsWith('/api/') || pathname === '/api') return true;
  if (pathname.startsWith('/_next/') || pathname === '/_next') return true;
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml' || pathname === '/favicon.ico') return true;

  // File extension check: only if last segment has a known asset extension
  const lastSlash = pathname.lastIndexOf('/');
  const lastSegment = lastSlash !== -1 ? pathname.slice(lastSlash + 1) : pathname;
  if (ASSET_EXTENSION_RE.test(lastSegment)) {
    return true;
  }

  return false;
}

export type LinkHref = string | { pathname?: string; [key: string]: any };

/**
 * Localizes an href for navigation on the published site.
 * Preserves query params, hash anchors, and Next.js Link objects.
 * Never double-prefixes already prefixed paths.
 */
export function localizeHref<T extends LinkHref>(
  href: T,
  activeLocale: string,
  defaultLocale: string = 'en',
  locales: readonly string[] = [defaultLocale, activeLocale].filter(Boolean),
): T {
  if (!href) return href;

  // Handle Next.js URL object: { pathname: '/gallery', query: { ... } }
  if (typeof href === 'object') {
    if (!href.pathname) return href;
    const localizedPath = localizeHref(href.pathname, activeLocale, defaultLocale, locales);
    return {
      ...href,
      pathname: typeof localizedPath === 'string' ? localizedPath : (localizedPath as any)?.pathname,
    };
  }

  const rawHref = String(href);

  // Ignore external URLs, mailto, tel, anchors
  if (isSpecialOrExternalHref(rawHref)) {
    return href;
  }

  // Split path from query and hash
  const hashIdx = rawHref.indexOf('#');
  const pathAndQuery = hashIdx !== -1 ? rawHref.slice(0, hashIdx) : rawHref;
  const hash = hashIdx !== -1 ? rawHref.slice(hashIdx) : '';

  const queryIdx = pathAndQuery.indexOf('?');
  const rawPath = queryIdx !== -1 ? pathAndQuery.slice(0, queryIdx) : pathAndQuery;
  const search = queryIdx !== -1 ? pathAndQuery.slice(queryIdx) : '';

  // Skip system routes and known public assets
  if (isSystemOrAssetPath(rawPath)) {
    return href;
  }

  // Strip existing locale if already present to prevent double prefixing
  const barePath = stripLocale(rawPath, locales);
  const localizedPath = localizePath(barePath, activeLocale, defaultLocale);

  return `${localizedPath}${search}${hash}` as T;
}
