import { trace } from '../../../shared/debug-trace';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { planNativeAssets } from './assets';
import { compileNativeTransfer } from './compile';
import { omitNativeSourceFeatures, type NativeSourceSkips } from './omissions';

export async function convertNativeImageToWebp(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/gif') throw new Error('ANIMATED_IMAGE_WEBP_ADAPTER_REQUIRED');
  if (blob.type === 'image/webp' || blob.type === 'image/svg+xml' || !blob.type.startsWith('image/')) return blob;
  if (blob.type === 'image/png') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = new DataView(bytes.buffer).getUint32(offset);
      if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'acTL') throw new Error('ANIMATED_IMAGE_WEBP_ADAPTER_REQUIRED');
      offset += length + 12;
    }
  }
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('IMAGE_WEBP_ENCODER_UNAVAILABLE');
    context.drawImage(image, 0, 0);
    const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value?.type === 'image/webp' ? resolve(value) : reject(new Error('IMAGE_WEBP_ENCODING_FAILED')), 'image/webp', 0.9));
    return encoded;
  } finally { image.close(); }
}

/** Upload once per source asset, then let the compiler bind every original reference. */
export async function uploadNativeTransferAssets(input: unknown, files: ReadonlyMap<string, string>, projectId: string, media: { fetchMediaBytes(url: string): Promise<Blob>; uploadAsset(id: string, file: File): Promise<string> }, encode = convertNativeImageToWebp, skips?: NativeSourceSkips, target?: { mode: 'create' | 'replace' | 'paste'; filePath?: string; parentNodeId?: string }): Promise<Record<string, string>> {
  const graph = buildSourceGraph(skips ? omitNativeSourceFeatures(input, skips).transfer : input), identity = allocateTargetIdentity(graph, new Set(files.keys()));
  const plan = planNativeAssets(graph, identity);
  if (plan.diagnostics.length) throw new Error(plan.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  const preflight = compileNativeTransfer(input, { existingFiles: files, mode: target?.mode ?? 'create', filePath: target?.filePath, parentNodeId: target?.parentNodeId, uploadedAssets: Object.fromEntries(plan.requests.map(request => [request.key, request.url])), skipFeatures: skips });
  if (preflight.diagnostics.length) throw new Error(preflight.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  const uploaded: Record<string, string> = {};
  for (const request of plan.requests) {
    const original = await media.fetchMediaBytes(request.url);
    if (original.type.split(';')[0] !== request.mimeType) throw new Error(`ASSET_CONTENT_TYPE_MISMATCH: ${request.key}`);
    const converted = await encode(original);
    const filename = request.path.split('/').pop()!.replace(/\.[^.]+$/, converted.type === 'image/webp' ? '.webp' : request.path.match(/\.[^.]+$/)![0]);
    const url = await media.uploadAsset(projectId, new File([converted], filename, { type: converted.type }));
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) throw new Error(`ASSET_UPLOAD_UNAVAILABLE: ${request.key}`);
    uploaded[request.key] = url;
    trace.action('framer-native.asset-uploaded', { key: request.key, mimeType: converted.type });
  }
  return uploaded;
}
