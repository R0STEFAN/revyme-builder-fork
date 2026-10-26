// lib/revyme-locale-routing.ts — Pure, isomorphic URL helpers for Revyme localized routing.

const ASSET_EXTENSION_RE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|woff2?|ttf|eot|otf|css|js|mjs|map|json|xml|txt|pdf|zip|gz|mp4|webm|ogg|mp3|wav)$/i;

export function stripLocale(pathname: string, locales: readonly string[]): string {
  if (!pathname || pathname === '/') return '/';
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  for (const locale of locales) {
    if (normalized === `/${locale}`) return '/';
    if (normalized.startsWith(`/${locale}/`)) return normalized.slice(locale.length + 1);
  }
  return normalized;
}

export function localizePath(pathname: string, lang: string, defaultLang: string): string {
  const cleanPath = pathname ? (pathname.startsWith('/') ? pathname : `/${pathname}`) : '/';
  if (lang === defaultLang) return cleanPath;
  if (cleanPath === '/') return `/${lang}`;
  return `/${lang}${cleanPath}`;
}

export function isSpecialOrExternalHref(href: string): boolean {
  if (!href) return true;
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return true;
  if (/^(https?:|\/\/|mailto:|tel:|javascript:|blob:|data:)/i.test(trimmed)) return true;
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
  activeLocale: string,
  defaultLocale: string,
  locales: readonly string[],
): T {
  if (!href) return href;
  if (typeof href === 'object') {
    if (!href.pathname) return href;
    const localizedPath = localizeHref(href.pathname, activeLocale, defaultLocale, locales);
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
  const barePath = stripLocale(rawPath, locales);
  const localizedPath = localizePath(barePath, activeLocale, defaultLocale);
  return `${localizedPath}${search}${hash}` as T;
}
