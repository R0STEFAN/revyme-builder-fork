import { trace } from '../../../shared/debug-trace';
import { sourceRecord } from './source-graph';

/** Resolve editor page identities before binding a literal link or native link prop. */
export function sourceStaticLinkValue(value: unknown, routes?: Readonly<Record<string, string>>, options?: { tolerant?: boolean }): unknown {
  const ref = sourceRecord(value);
  if (ref?.type === 'url') {
    if (typeof ref.url !== 'string') throw new Error('Unsupported source URL link');
    let rawUrl = ref.url.trim();
    if (/^javascript:/i.test(rawUrl)) throw new Error('Unsupported source URL link');
    if (rawUrl.startsWith('tel:')) {
      rawUrl = rawUrl.replace(/\s+/g, '');
    }
    const url = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#]|$))/i.test(rawUrl) && !rawUrl.includes('://')
      ? `https://${rawUrl}`
      : rawUrl;
    if (!/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url)) {
      if (options?.tolerant) return `https://${url}`;
      throw new Error('Unsupported source URL link');
    }
    return url;
  }
  if (ref?.type !== 'webPage') return value;
  trace.fn('framer-native.sourcePageLink', { pageId: ref.webPageId });
  const route = typeof ref.webPageId === 'string' ? routes?.[ref.webPageId] : undefined;
  if (!route || !/^\/(?!\/)/.test(route)) throw new Error(`Destination route unavailable for source page ${String(ref.webPageId)}`);
  if (Object.keys(ref).some(key => !['type', 'webPageId', 'hash'].includes(key))) {
    if (options?.tolerant) return route.replace('/[slug]', '') || '/';
    throw new Error('Source page link parameters/section require their native adapter');
  }
  if (route.includes('[slug]')) {
    if (options?.tolerant) return route.replace('/[slug]', '') || '/';
    throw new Error('Source page link requires its dynamic record adapter');
  }
  const hash = typeof ref.hash === 'string' && ref.hash ? `#${ref.hash}` : '';
  return `${route}${hash}`;
}
