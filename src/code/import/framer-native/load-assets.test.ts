import { expect, it } from 'vitest';
import { loadNativeAssetPayloads } from './load-assets';

const requests = [{ key: 'image', url: 'https://example.com/image.png', mimeType: 'image/png', path: 'public/assets/image.png' }];
it('downloads original bytes with no account credentials and preserves their declared type', async () => {
  const result = await loadNativeAssetPayloads(requests, { fetch: async (_url, init) => {
    expect(init?.credentials).toBe('omit');
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  } });
  expect(result).toEqual({ image: 'data:image/png;base64,iVBORw==' });
});
it.each(['missing', 'wrong-type', 'canceled'])('never returns partial assets after %s', async kind => {
  const controller = new AbortController();
  if (kind === 'canceled') controller.abort();
  await expect(loadNativeAssetPayloads(requests, { signal: controller.signal, fetch: async () => kind === 'missing' ? new Response('', { status: 404 }) : new Response('invalid', { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow();
});
it('fails the whole download set when a later original is missing', async () => {
  let reads = 0;
  await expect(loadNativeAssetPayloads([...requests, { ...requests[0], key: 'second', url: 'https://example.com/missing.png' }], { fetch: async () => ++reads === 1 ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 }) })).rejects.toThrow('ASSET_DOWNLOAD_FAILED: second (404)');
  expect(reads).toBe(2);
});
