import { describe, expect, it } from 'vitest';
import capture from './fixtures/captured-underline.json';
import { allocateTargetIdentity, buildSourceGraph, sourceAssetKey } from './source-graph';
import { emitNativeAssets, planNativeAssets } from './assets';

const image = 'data:framer/asset-reference,image-key.png?originalFilename=Photo.png&width=640&height=480';
const video = 'data:framer/asset-reference,video-key.mp4?originalFilename=Movie.mp4';
const imageData = 'data:image/png;base64,iVBORw0KGgo=';
const videoData = 'data:video/mp4;base64,AAAAAA==';
function source() {
  return { ...capture, rootIds: ['page'], definitions: [{ id: 'page', kind: 'WebPageNode', data: {
    id: 'page', __class: 'WebPageNode', children: [{ id: 'frame', __class: 'FrameNode', fillImage: image, children: [{ id: 'video', __class: 'CodeComponentNode', '$control__srcFile': { type: 'file', value: video }, children: [] }] }],
  } }], assets: [
    { key: 'image-key', extension: '.png', mimeType: 'image/png', name: 'Photo.png', url: 'https://native.example/assets/image-key.png' },
    { key: 'video-key', extension: '.mp4', mimeType: 'video/mp4', name: 'Movie.mp4', url: 'https://native.example/assets/video-key.mp4' },
    { key: 'unused', extension: '.jpg', mimeType: 'image/jpeg' },
  ] as Array<{ key: string; extension: string; mimeType: string; name?: string; url?: string }> };
}
function model(input = source(), existing = new Set<string>()) {
  const graph = buildSourceGraph(input), identity = allocateTargetIdentity(graph, existing);
  return { graph, identity };
}

describe('native Framer assets', () => {
  it('plans only referenced original assets and maps exact source URIs to centrally allocated paths', () => {
    const { graph, identity } = model();
    const plan = planNativeAssets(graph, identity);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.requests).toHaveLength(2);
    expect(plan.requests).toContainEqual({ key: 'image-key', url: 'https://native.example/assets/image-key.png', mimeType: 'image/png', path: `public/assets/${identity[sourceAssetKey('image-key')]}.png` });
    expect(plan.assets[image]).toBe(`/assets/${identity[sourceAssetKey('image-key')]}.png`);
    expect(plan.assets[video]).toBe(`/assets/${identity[sourceAssetKey('video-key')]}.mp4`);
    expect(plan.requests.some(request => request.key === 'unused')).toBe(false);
  });
  it('emits original binary payloads in the format understood by native project storage', () => {
    const { graph, identity } = model();
    const result = emitNativeAssets(graph, identity, { 'image-key': imageData, 'video-key': videoData });
    expect(result.diagnostics).toEqual([]);
    expect(result.files.map(file => file.code)).toEqual([imageData, videoData]);
    expect(result.files.every(file => file.path.startsWith('public/assets/'))).toBe(true);
  });
  it('rejects an absent URL or mismatched asset descriptor rather than constructing a CDN URL', () => {
    const input = source(); delete (input.assets[0] as { url?: string }).url;
    let ctx = model(input);
    expect(planNativeAssets(ctx.graph, ctx.identity).diagnostics).toContainEqual(expect.objectContaining({ code: 'ASSET_URL_UNAVAILABLE' }));
    input.assets = input.assets.filter(asset => asset.key !== 'image-key');
    ctx = model(input);
    expect(planNativeAssets(ctx.graph, ctx.identity).diagnostics).toContainEqual(expect.objectContaining({ code: 'ASSET_DEFINITION_MISSING' }));
  });
  it('rejects partial, wrong-MIME or malformed payloads without emitting any files', () => {
    const { graph, identity } = model();
    const payloads: Record<string, string>[] = [{ 'image-key': imageData }, { 'image-key': videoData, 'video-key': videoData }, { 'image-key': 'data:image/png;base64,not valid', 'video-key': videoData }];
    for (const payload of payloads) {
      const result = emitNativeAssets(graph, identity, payload);
      expect(result.files).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
  it('retains one file for a resource used with multiple source URI query strings', () => {
    const input = source();
    (input.definitions[0].data.children[0] as Record<string, unknown>).poster = image.replace('Photo.png', 'Other.png');
    const { graph, identity } = model(input);
    const plan = planNativeAssets(graph, identity);
    expect(plan.requests).toHaveLength(2);
    expect(plan.assets[image.replace('Photo.png', 'Other.png')]).toBe(plan.assets[image]);
  });
  it('is independent of names and ordering and avoids existing asset names', () => {
    const first = model(), a = planNativeAssets(first.graph, first.identity);
    const input = source(); input.assets.reverse(); input.assets.forEach(asset => { asset.name = 'renamed'; });
    const second = model(input);
    expect(planNativeAssets(second.graph, second.identity)).toEqual(a);
    const collision = model(source(), new Set([a.requests[0].path]));
    expect(planNativeAssets(collision.graph, collision.identity).requests[0].path).not.toBe(a.requests[0].path);
  });
  it('rejects conflicting duplicate asset metadata', () => {
    const input = source(); input.assets.push({ ...input.assets[0], url: 'https://other.example/different.png' });
    const { graph, identity } = model(input);
    expect(planNativeAssets(graph, identity).diagnostics).toContainEqual(expect.objectContaining({ code: 'ASSET_DEFINITION_CONFLICT' }));
  });
  it('uses the observed SVG mask image URL without bitmap resize parameters for reader 0.1.1', () => {
    const input = source();
    input.assets[0] = { key: 'mask', extension: '.svg', mimeType: 'image/svg+xml', url: 'https://native.example/assets/mask.svg', properties: { kind: 'image', image: { width: 20, height: 20 } } } as typeof input.assets[0];
    input.definitions[0].data.children[0].fillImage = 'data:framer/asset-reference,mask.svg';
    const { graph, identity } = model(input);
    expect(planNativeAssets(graph, identity).requests.find(request => request.key === 'mask')?.url).toBe('https://native.example/images/mask.svg');
  });
  it('does not map a second extension of the same key to a file that will never be emitted', () => {
    const input = source();
    input.assets.push({ ...input.assets[0], extension: '.jpg', mimeType: 'image/jpeg' });
    (input.definitions[0].data.children[0] as Record<string, unknown>).poster = image.replace('.png?', '.jpg?');
    const { graph, identity } = model(input);
    const plan = planNativeAssets(graph, identity);
    expect(plan.requests).toEqual([]);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'ASSET_DEFINITION_CONFLICT' }));
  });
});
