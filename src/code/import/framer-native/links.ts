import { trace } from '../../../shared/debug-trace';
import { sourceRecord } from './source-graph';

/** Resolve editor page identities before binding a literal link or native link prop. */
export function sourceStaticLinkValue(value: unknown, routes?: Readonly<Record<string, string>>): unknown {
  const ref = sourceRecord(value);
  if (ref?.type === 'url') {
    if (Object.keys(ref).some(key => !['type', 'url', 'openInNewTab'].includes(key)) || typeof ref.url !== 'string' || /[\u0000-\u0020]/.test(ref.url)) throw new Error('Unsupported source URL link');
    const url = /^www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#]|$)/i.test(ref.url) ? `https://${ref.url}` : ref.url;
    if (!/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url)) throw new Error('Unsupported source URL link');
    return url;
  }
  if (ref?.type !== 'webPage') return value;
  trace.fn('framer-native.sourcePageLink', { pageId: ref.webPageId });
  if (Object.keys(ref).some(key => !['type', 'webPageId', 'hash'].includes(key))) throw new Error('Source page link parameters/section require their native adapter');
  const route = typeof ref.webPageId === 'string' ? routes?.[ref.webPageId] : undefined;
  if (!route || !/^\/(?!\/)/.test(route)) throw new Error(`Destination route unavailable for source page ${String(ref.webPageId)}`);
  if (route.includes('[slug]')) throw new Error('Source page link requires its dynamic record adapter');
  const hash = typeof ref.hash === 'string' && ref.hash ? `#${ref.hash}` : '';
  return `${route}${hash}`;
}
