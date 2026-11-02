import { trace } from '../../../shared/debug-trace';
import { planNativeAssets, type NativeAssetRequest } from './assets';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';

export async function loadNativeTransferAssetPayloads(input: unknown, existingFiles: ReadonlyMap<string, string>, options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<Record<string, string>> {
  const graph = buildSourceGraph(input);
  const identity = allocateTargetIdentity(graph, new Set(existingFiles.keys()));
  const plan = planNativeAssets(graph, identity);
  if (plan.diagnostics.length) throw new Error(plan.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  return loadNativeAssetPayloads(plan.requests, options);
}

/** Browser-side transport; the pure compiler only consumes complete payloads. */
export async function loadNativeAssetPayloads(requests: readonly NativeAssetRequest[], options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<Record<string, string>> {
  const read = options.fetch ?? globalThis.fetch;
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  for (const request of requests) {
    options.signal?.throwIfAborted();
    if (seen.has(request.key)) throw new Error(`ASSET_REQUEST_CONFLICT: ${request.key}`);
    seen.add(request.key);
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`ASSET_URL_UNAVAILABLE: ${request.key}`);
    trace.action('framer-native.asset-read', { key: request.key });
    const response = await read(url.href, { signal: options.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`ASSET_DOWNLOAD_FAILED: ${request.key} (${response.status})`);
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mime !== request.mimeType.toLowerCase()) throw new Error(`ASSET_CONTENT_TYPE_MISMATCH: ${request.key}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    options.signal?.throwIfAborted();
    if (!bytes.length) throw new Error(`ASSET_CONTENT_EMPTY: ${request.key}`);
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    result[request.key] = `data:${request.mimeType};base64,${btoa(parts.join(''))}`;
  }
  return result;
}
