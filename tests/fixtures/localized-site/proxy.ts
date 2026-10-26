import { NextRequest, NextResponse } from 'next/server';
import { isSystemOrAssetPath } from './lib/revyme-locale-routing';

const DEFAULT_LOCALE = 'uk';
const LOCALES = ['uk', 'en'];

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Bypass assets and API routes
  if (isSystemOrAssetPath(pathname)) {
    return NextResponse.next();
  }

  // 2. Canonical redirect: /uk/gallery -> /gallery (308 Permanent)
  if (pathname === `/${DEFAULT_LOCALE}` || pathname.startsWith(`/${DEFAULT_LOCALE}/`)) {
    const stripped = pathname === `/${DEFAULT_LOCALE}` ? '/' : pathname.slice(DEFAULT_LOCALE.length + 1);
    const targetUrl = new URL(`${stripped}${search}`, request.url);
    return NextResponse.redirect(targetUrl, 308);
  }

  // 3. Allow explicitly requested secondary locales to proceed directly to their route
  for (const loc of LOCALES) {
    if (loc === DEFAULT_LOCALE) continue;
    if (pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)) {
      return NextResponse.next();
    }
  }

  // 4. Default language rewrite: /gallery -> /uk/gallery
  const rewritePath = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  const rewriteUrl = new URL(`${rewritePath}${search}`, request.url);
  return NextResponse.rewrite(rewriteUrl);
}

export const middleware = proxy;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
