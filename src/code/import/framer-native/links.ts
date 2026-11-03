import { trace } from '../../../shared/debug-trace';
import { sourceRecord } from './source-graph';

/** Resolve editor page identities before binding a literal link or native link prop. */
export function sourceStaticLinkValue(value: unknown, routes?: Readonly<Record<string, string>>): unknown {
  const ref = sourceRecord(value);
  if (ref?.type !== 'webPage') return value;
  trace.fn('framer-native.sourcePageLink', { pageId: ref.webPageId });
  if (Object.keys(ref).some(key => !['type', 'webPageId'].includes(key))) throw new Error('Source page link parameters/section require their native adapter');
  const route = typeof ref.webPageId === 'string' ? routes?.[ref.webPageId] : undefined;
  if (!route || !/^\/(?!\/)/.test(route)) throw new Error(`Destination route unavailable for source page ${String(ref.webPageId)}`);
  if (route.includes('[slug]')) throw new Error('Source page link requires its dynamic record adapter');
  return route;
}
