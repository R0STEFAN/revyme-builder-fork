import { trace } from '../../../shared/debug-trace';
import { isSourceCodeComponent, sourceAssetKey, sourceRecord } from './source-graph';
import type { NativeCompileResult, SourceGraph, TransferDiagnostic } from './types';

export interface NativeAssetRequest { key: string; url: string; mimeType: string; path: string }
export interface NativeAssetPlan {
  requests: NativeAssetRequest[];
  assets: Record<string, string>;
  diagnostics: TransferDiagnostic[];
}
export interface NativeAssetResult extends NativeCompileResult { assets: Record<string, string> }
const PREFIX = 'data:framer/asset-reference,';
const EXTENSION = /^\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp|mp4|webm|mov|mp3|wav|ogg|pdf|woff2?|ttf|otf)$/i;

/** Plan network reads separately; conversion itself performs no fetch or FS access. */
export function planNativeAssets(graph: SourceGraph, identity: Record<string, string>): NativeAssetPlan {
  trace.fn('framer-native.planAssets', { declarations: graph.transfer.assets.length });
  const result: NativeAssetPlan = { requests: [], assets: {}, diagnostics: [...graph.diagnostics] };
  if (result.diagnostics.length) return result;
  const references = new Set<string>();
  function scan(value: unknown, ignoreControls = false): void {
    if (typeof value === 'string' && value.startsWith(PREFIX)) references.add(value);
    else if (Array.isArray(value)) value.forEach(item => scan(item, ignoreControls));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (!(ignoreControls && key.startsWith('$control__'))) scan(item, ignoreControls);
  }
  for (const id of graph.reachable) {
    const node = graph.nodes.get(id)!;
    for (const [property, value] of Object.entries(node.raw)) if (property !== 'children' && !(isSourceCodeComponent(node) && property.startsWith('$control__'))) scan(value, isSourceCodeComponent(node));
  }
  const requested = new Set<string>();
  const diagnostic = (code: string, message: string) => result.diagnostics.push({ code, property: 'assets', message });
  for (const reference of [...references].sort()) {
    const filename = reference.slice(PREFIX.length).split('?')[0];
    const declarations = graph.transfer.assets.filter(asset => typeof asset.key === 'string' && typeof asset.extension === 'string' && `${asset.key}${asset.extension}` === filename);
    const asset = declarations[0];
    if (!asset) { diagnostic('ASSET_DEFINITION_MISSING', `No original asset descriptor for ${filename}`); continue; }
    const signature = (value: Record<string, unknown>) => JSON.stringify([value.key, value.extension, value.mimeType, value.url, value.imageUrl]);
    if (graph.transfer.assets.some(candidate => candidate.key === asset.key && signature(candidate) !== signature(asset))) {
      diagnostic('ASSET_DEFINITION_CONFLICT', `Conflicting original asset descriptors for ${filename}`); continue;
    }
    const { key, extension, mimeType } = asset;
    if (typeof key !== 'string' || typeof extension !== 'string' || !EXTENSION.test(extension) || typeof mimeType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) {
      diagnostic('ASSET_FORMAT_UNSUPPORTED', `The native asset format is unsupported for ${filename}`); continue;
    }
    let url: URL;
    const hasImageUrl = mimeType.startsWith('image/') && typeof asset.imageUrl === 'string';
    try { url = new URL(String(hasImageUrl ? asset.imageUrl : asset.url ?? '')); }
    catch { diagnostic('ASSET_URL_UNAVAILABLE', `Capture the native original URL for ${filename}`); continue; }
    if (url.protocol !== 'https:' || url.username || url.password) {
      diagnostic('ASSET_URL_UNAVAILABLE', `No usable native original URL for ${filename}`); continue;
    }
    // Reader 0.1.1 recorded the native FILE helper (X/l). SVG image sources
    // use L/i without bitmap sizing instead (verified against rendered mask
    // URLs in the original editor). This compatibility rule reproduces that
    // build's image helper using its captured service origin, never a guessed CDN.
    const properties = sourceRecord(asset.properties);
    if (!hasImageUrl && mimeType === 'image/svg+xml' && properties?.kind === 'image' && url.pathname === `/assets/${filename}`) {
      if (graph.transfer.context.editorBuild !== 'https://app.framerstatic.com/web.D7IYYINP.mjs' || url.search || !/^[A-Za-z0-9_-]+$/.test(key)) {
        diagnostic('ASSET_IMAGE_URL_UNAVAILABLE', `Capture the native image URL for ${filename}`); continue;
      }
      url = new URL(`/images/${filename}`, url.origin);
    }
    const target = identity[sourceAssetKey(key)];
    if (!target || !/^[a-z0-9-]+$/.test(target)) {
      diagnostic('ASSET_IDENTITY_MISSING', `No centrally allocated asset identity for ${filename}`); continue;
    }
    const path = `public/assets/${target}${extension.toLowerCase()}`;
    result.assets[reference] = path.slice('public'.length);
    if (!requested.has(key)) {
      result.requests.push({ key, url: url.href, mimeType, path });
      requested.add(key);
    }
  }
  if (result.diagnostics.length) { result.requests = []; result.assets = {}; }
  return result;
}

/** Emit native data-URL asset contents only after EVERY original payload is present. */
export function emitNativeAssets(graph: SourceGraph, identity: Record<string, string>, payloads: Readonly<Record<string, string>>): NativeAssetResult {
  trace.fn('framer-native.emitAssets', { payloads: Object.keys(payloads).length });
  const plan = planNativeAssets(graph, identity);
  const result: NativeAssetResult = { files: [], assets: plan.assets, identity, createdIds: [], diagnostics: [...plan.diagnostics] };
  if (result.diagnostics.length) return result;
  for (const request of plan.requests) {
    const code = payloads[request.key];
    if (code === undefined) {
      result.diagnostics.push({ code: 'ASSET_CONTENT_UNAVAILABLE', property: 'assets', message: `Original payload was not loaded for ${request.key}` });
      continue;
    }
    const data = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(code);
    if (!data || data[1] !== request.mimeType || data[2].length % 4 !== 0) {
      result.diagnostics.push({ code: 'ASSET_CONTENT_INVALID', property: 'assets', message: `Original payload type/encoding does not match ${request.key}` });
      continue;
    }
    result.files.push({ path: request.path, code });
  }
  if (result.diagnostics.length) { result.files = []; result.assets = {}; }
  return result;
}
