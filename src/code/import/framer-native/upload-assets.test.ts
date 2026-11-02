import { expect, it, vi } from 'vitest';
import { convertNativeImageToWebp, uploadNativeTransferAssets } from './upload-assets';
import { compileNativeTransfer } from './compile';

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
