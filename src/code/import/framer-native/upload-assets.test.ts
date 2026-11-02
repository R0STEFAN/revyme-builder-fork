import { expect, it, vi } from 'vitest';
import { convertNativeImageToWebp, uploadNativeTransferAssets } from './upload-assets';
import { compileNativeTransfer } from './compile';
import { nativeCollectionSlug, nativeFieldId } from './cms';
import { nativePropName } from './components';
import { parseJSXToNodes } from '../../parsing/parser';

const uri = 'data:framer/asset-reference,photo.png';
const source = { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'page', mode: 'page' }, rootIds: ['page'], assets: [{ key: 'photo', extension: '.png', mimeType: 'image/png', url: 'https://example.com/photo.png' }], definitions: [{ id: 'page', kind: 'WebPageNode', data: { id: 'page', __class: 'WebPageNode', pagePath: '/asset-test', baseVariantId: 'desktop', children: [{ id: 'desktop', __class: 'FrameNode', width: 1200, widthType: 0, children: [{ id: 'image', __class: 'FrameNode', parentid: 'desktop', width: 200, widthType: 0, height: 100, heightType: 0, fillEnabled: true, fillType: 'image', fillImage: uri, children: [] }] }] } }] };
it('uploads converted WebP once and binds the uploaded URL in the native page', async () => {
  let uploads = 0;
  const urls = await uploadNativeTransferAssets(source, new Map(), 'destination', {
    fetchMediaBytes: async url => { expect(url).toBe('https://example.com/photo.png'); return new Blob(['original'], { type: 'image/png' }); },
    uploadAsset: async (projectId, file) => { uploads++; expect(projectId).toBe('destination'); expect(file.name).toMatch(/\.webp$/); expect(file.type).toBe('image/webp'); return '/api/uploads/photo.webp'; },
  }, async () => new Blob(['webp'], { type: 'image/webp' }));
  expect(uploads).toBe(1);
  const result = compileNativeTransfer(source, { mode: 'create', existingFiles: new Map(), uploadedAssets: urls });
  expect(result.diagnostics).toEqual([]);
  expect(result.files.some(file => file.path.startsWith('public/assets/'))).toBe(false);
  expect(result.files.find(file => file.path.endsWith('page.client.tsx'))!.code).toContain('/api/uploads/photo.webp');
});
it('shares one uploaded image across page fills, component props and CMS defaults and rows', async () => {
  const input = structuredClone(source);
  const page = input.definitions[0].data;
  const master = { id: 'card', __class: 'SmartComponentNode', baseVariantId: 'card-base', variables: [{ id: 'picture', type: 'image', initialValue: uri }], children: [{ id: 'card-base', __class: 'FrameNode', width: 200, widthType: 0, height: 100, heightType: 0, fillEnabled: true, fillType: 'image', fillImage: { type: 'variableReference', providerId: 'card', id: 'picture' }, children: [] }] };
  (page.children[0].children as any[]).push({ id: 'instance', __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/card:default', $control__picture: { type: 'image', value: uri }, width: 200, widthType: 0, height: 100, heightType: 0, children: [] });
  const collection = { id: 'photos', __class: 'CollectionNode', name: 'Photos', variables: [{ id: 'slug', type: 'slug' }, { id: 'picture', type: 'image', initialValue: uri }], children: [{ id: 'photo-row', __class: 'CollectionItemNode', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', $control__slug: { value: 'first' }, $control__picture: { value: uri }, children: [] }] };
  input.rootIds.push('photos');
  input.definitions.push(...[master, collection].map(data => ({ id: data.id, kind: data.__class, data })) as any);
  let downloads = 0, uploads = 0;
  const urls = await uploadNativeTransferAssets(input, new Map(), 'destination', {
    fetchMediaBytes: async () => { downloads++; return new Blob(['original'], { type: 'image/png' }); },
    uploadAsset: async () => { uploads++; return '/api/uploads/shared.webp'; },
  }, async () => new Blob(['webp'], { type: 'image/webp' }));
  const result = compileNativeTransfer(input, { mode: 'create', existingFiles: new Map(), uploadedAssets: urls });
  expect(result.diagnostics).toEqual([]);
  expect([downloads, uploads]).toEqual([1, 1]);
  const nodes = parseJSXToNodes(result.files.find(file => file.path.endsWith('page.client.tsx'))!.code);
  expect(nodes.get(result.identity.image)!.styles.backgroundImage).toContain('/api/uploads/shared.webp');
  expect(nodes.get(result.identity.instance)!.attrs[nativePropName(result.identity, 'card', 'picture')]).toBe('url(/api/uploads/shared.webp)');
  const slug = nativeCollectionSlug(result.identity, 'photos'), field = nativeFieldId(result.identity, 'photos', 'picture');
  expect(JSON.parse(result.files.find(file => file.path === `cms/${slug}.json`)!.code)[0][field]).toBe('/api/uploads/shared.webp');
  expect(JSON.parse(result.files.find(file => file.path === `cms/${slug}.schema.json`)!.code).fields.find((item: { id: string }) => item.id === field).defaultValue).toBe('/api/uploads/shared.webp');
  expect(result.files.some(file => file.path.startsWith('public/assets/'))).toBe(false);
});
it('encodes at original dimensions with WebP and closes the decoded image', async () => {
  const close = vi.fn(), drawImage = vi.fn();
  vi.stubGlobal('createImageBitmap', async () => ({ width: 640, height: 480, close }));
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (callback: (blob: Blob) => void, type: string, quality: number) => { expect(type).toBe('image/webp'); expect(quality).toBe(0.9); callback(new Blob(['webp'], { type })); } };
  const create = vi.spyOn(document, 'createElement').mockReturnValue(canvas as any);
  try { expect((await convertNativeImageToWebp(new Blob(['jpeg'], { type: 'image/jpeg' }))).type).toBe('image/webp'); expect([canvas.width, canvas.height]).toEqual([640, 480]); expect(close).toHaveBeenCalledOnce(); }
  finally { create.mockRestore(); vi.unstubAllGlobals(); }
});
it('does not upload media when the source cannot be converted completely', async () => {
  let uploads = 0;
  await expect(uploadNativeTransferAssets({ ...source, complete: false }, new Map(), 'destination', { fetchMediaBytes: async () => { throw new Error('must not download'); }, uploadAsset: async () => { uploads++; return '/api/uploads/unexpected.webp'; } })).rejects.toThrow(/SOURCE_CAPTURE_INCOMPLETE/);
  expect(uploads).toBe(0);
});
it('keeps SVG vectors intact and refuses to flatten animated image formats', async () => {
  const svg = new Blob(['<svg/>'], { type: 'image/svg+xml' });
  expect(await convertNativeImageToWebp(svg)).toBe(svg);
  await expect(convertNativeImageToWebp(new Blob(['gif'], { type: 'image/gif' }))).rejects.toThrow(/ANIMATED_IMAGE_WEBP/);
});
