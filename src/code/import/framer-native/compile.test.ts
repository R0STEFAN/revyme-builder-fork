import { expect, it } from 'vitest';
import { compileNativeTransfer } from './compile';
import { parseJSXToNodes } from '../../parsing/parser';
import type { NativeTransfer } from './types';
import { framerImportSubmitOperation, framerImportSubmitInputSchema } from '../../../../packages/automation-core/src/operations/framer-import';
import { createOperationContext, createSnapshot } from '../../../../packages/automation-core/src/session';
import { parseMetadataFromCode } from '../../generation/metadata-gen';
import { buildCmsDetailServerWrapper, parseCmsSeoExpressions } from '../../project/cms-seo';
import { nativeCollectionSlug, nativeFieldId } from './cms';
import { decomposeLoopInCode, getLoopAnimate } from '../../generation/generator-motion-loop';
import { nativePropName } from './components';
import { parsePresetTokens } from '../../generation/preset-gen';

function transfer(): NativeTransfer {
  const master = { id: 'card', __class: 'SmartComponentNode', baseVariantId: 'card-base', variables: [], children: [{ id: 'card-base', __class: 'FrameNode', width: 200, widthType: 0, heightType: 2, children: [{ id: 'label', __class: 'RichTextNode', html: '<p>Original text</p>', children: [] }] }] };
  const page = { id: 'home', __class: 'WebPageNode', parentid: 'document', baseVariantId: 'desktop', children: [{ id: 'desktop', __class: 'FrameNode', name: 'Desktop', width: 1200, widthType: 0, heightType: 2, children: [{ id: 'instance', __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/card:default', children: [], width: 200, widthType: 0, heightType: 2 }] }] };
  const document = { id: 'document', __class: 'RootNode', homePageNodeId: 'home', children: [] };
  return { format: 'revyme.framer.native', version: 1, context: { projectId: 'automatic', branchId: 'main', revision: 'source-1', editorBuild: 'fixture', scopeId: 'home', mode: 'page' }, complete: true, diagnostics: [], rootIds: ['home'], definitions: [page, master, document].map(data => ({ id: data.id, kind: data.__class, data })), assets: [] };
}
it('connects source Google families and exact axes through native imports without uploading font files', async () => {
  const source = transfer();
  const frame = (source.definitions[1].data.children as any[])[0];
  frame.children[0].html = '<p data-styles-preset="type">Google type</p>';
  source.definitions.push({ id: 'type', kind: 'TextStylePresetNode', data: { id: 'type', __class: 'TextStylePresetNode', font: 'GF;Zalando Sans-variable-regularVF=IndkdGgiIDEwMCwgIndnaHQiIDQ1MA==', fontBold: 'GF;Zalando Sans-900', children: [] } });
  const result = compileNativeTransfer(source, { mode: 'create', existingFiles: new Map() });
  expect(result.diagnostics).toEqual([]);
  const css = result.files.find(file => file.path === 'app/globals.css')!;
  expect(css.code).toContain('family=Zalando+Sans:wdth,wght@100,450');
  expect(css.code).toContain('family=Zalando+Sans:wght@900');
  expect(css.code).not.toContain('@font-face');
  expect(result.files.some(file => /\.(woff2?|ttf|otf)$/.test(file.path))).toBe(false);
  const target = { projectId: 'destination', branchId: 'main' };
  const input = { files: result.files, mode: 'create' as const, target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true as const, context: source.context, rootIds: source.rootIds } };
  expect(framerImportSubmitInputSchema.safeParse(input).success).toBe(true);
  expect((await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), input, createOperationContext())).diagnostics).toEqual([]);
});
it('imports original uploaded font faces through a canonical native globals patch', async () => {
  const source = transfer();
  const frame = (source.definitions[1].data.children as any[])[0];
  frame.children[0].html = '<p style="font-family: Zalando Sans; font-weight: 450; font-variation-settings: &quot;wdth&quot; 100">Original font</p>';
  Object.assign(frame, { fillEnabled: true, fillType: 'color', fillColor: 'var(--token-ink, #000)' });
  source.definitions.push({ id: 'ink', kind: 'ColorStyleTokenNode', data: { id: 'ink', __class: 'ColorStyleTokenNode', children: [], light: '#000' } });
  const fontFaces = [{ family: 'Zalando Sans', url: '/api/uploads/original.woff2', weight: 450, style: 'normal' as const, ext: 'woff2' as const }];
  const globals = ':root { --color-brand: #fff; }';
  const existingFiles = new Map([['app/globals.css', globals]]);
  const result = compileNativeTransfer(source, { mode: 'create', existingFiles, fontFaces });
  expect(result.diagnostics).toEqual([]);
  const css = result.files.find(file => file.path === 'app/globals.css')!;
  expect(parsePresetTokens(css.code)).toContainEqual(expect.objectContaining({ name: 'color-brand', value: '#fff' }));
  expect(css.code).toContain('/api/uploads/original.woff2');
  expect(css.colorTokens).toHaveLength(1);
  const text = parseJSXToNodes(result.files.find(file => file.path.startsWith('components/'))!.code).get(result.identity.label)!;
  expect(text.styles.fontFamily).toBe(JSON.stringify(css.fontFaces![0].family));
  expect(text.styles.fontWeight).toBe('450');
  expect(text.styles.fontVariationSettings).toBe('"wdth" 100');
  const target = { projectId: 'destination', branchId: 'main' };
  const input = { files: result.files, mode: 'create' as const, target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true as const, context: source.context, rootIds: source.rootIds } };
  expect(framerImportSubmitInputSchema.safeParse(input).success).toBe(true);
  expect((await framerImportSubmitOperation.execute(createSnapshot(target, 0, Object.fromEntries(existingFiles)), input, createOperationContext())).diagnostics).toEqual([]);
  const altered = { ...input, files: result.files.map(file => file.path === 'app/globals.css' ? { ...file, code: file.code + 'body {display:none}' } : file) };
  await expect(framerImportSubmitOperation.execute(createSnapshot(target, 0, Object.fromEntries(existingFiles)), altered, createOperationContext())).rejects.toThrow(/PATCH/);
  expect(compileNativeTransfer(source, { mode: 'create', existingFiles }).diagnostics).toContainEqual(expect.objectContaining({ code: 'SOURCE_FONT_ADAPTER_REQUIRED' }));
  const repeated = compileNativeTransfer(source, { mode: 'create', existingFiles: new Map([['app/globals.css', css.code]]), fontFaces });
  expect(repeated.diagnostics).toEqual([]);
  expect(repeated.files.find(file => file.path === 'app/globals.css')!.fontFaces![0].family).not.toBe(css.fontFaces![0].family);
});
it('imports source color tokens into native presets while retaining existing globals', async () => {
  const source = transfer();
  const frame = (source.definitions[1].data.children as any[])[0];
  Object.assign(frame, { fillEnabled: true, fillType: 'color', fillColor: 'var(--token-palette, rgb(0, 0, 0))' });
  frame.children[0].html = '<p>var(--token-palette, red)</p>';
  source.definitions.push({ id: 'palette', kind: 'ColorStyleTokenNode', data: { id: 'palette', __class: 'ColorStyleTokenNode', children: [], name: 'Ink', light: 'rgb(20, 30, 40)', dark: 'rgb(220, 230, 240)' } });
  const globals = ':root {\n  --color-existing: #aabbcc;\n}\nbody { margin: 0; }\n';
  const existingFiles = new Map([['app/globals.css', globals]]);
  const result = compileNativeTransfer(source, { mode: 'create', existingFiles });
  expect(result.diagnostics).toEqual([]);
  const css = result.files.find(file => file.path === 'app/globals.css')!;
  const token = parsePresetTokens(css.code).find(item => item.name !== 'color-existing')!;
  expect(token.value).toBe('rgb(20, 30, 40)');
  expect(css.code).toContain('body { margin: 0; }');
  expect(css.code).toContain('rgb(220, 230, 240)');
  expect(result.files.find(file => file.path.startsWith('components/'))!.code).toContain(`var(--${token.name},`);
  expect(parseJSXToNodes(result.files.find(file => file.path.startsWith('components/'))!.code).get(result.identity.label)?.textContent).toBe('var(--token-palette, red)');
  const target = { projectId: 'destination', branchId: 'main' };
  const input = { files: result.files, mode: 'create' as const, target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true as const, context: source.context, rootIds: source.rootIds } };
  expect((await framerImportSubmitOperation.execute(createSnapshot(target, 0, Object.fromEntries(existingFiles)), input, createOperationContext())).diagnostics).toEqual([]);
  const tampered = { ...input, files: result.files.map(file => file.path === 'app/globals.css' ? { ...file, code: file.code + 'body { display: none; }' } : file) };
  await expect(framerImportSubmitOperation.execute(createSnapshot(target, 0, Object.fromEntries(existingFiles)), tampered, createOperationContext())).rejects.toThrow(/TOKEN_PATCH/);
  const again = compileNativeTransfer(source, { mode: 'create', existingFiles: new Map([['app/globals.css', css.code]]) });
  expect(again.diagnostics).toEqual([]);
  expect(parsePresetTokens(again.files.find(file => file.path === 'app/globals.css')!.code)).toHaveLength(3);
});

it('converts an instance image override into the native CSS image prop domain', () => {
  const source = transfer(), asset = 'data:framer/asset-reference,photo.png';
  const master = source.definitions[1].data;
  master.variables = [{ id: 'photo', type: 'image', initialValue: '' }];
  const child = (master.children as any[])[0].children[0];
  Object.assign(child, { __class: 'FrameNode', fillEnabled: true, fillType: 'image', fillImage: { type: 'variableReference', providerId: 'card', id: 'photo' } });
  delete child.html;
  (source.definitions[0].data.children as any[])[0].children[0].$control__photo = { type: 'image', value: asset };
  source.assets = [{ key: 'photo', extension: '.png', mimeType: 'image/png', url: 'https://example.com/photo.png' }];
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create', assetPayloads: { photo: 'data:image/png;base64,iVBORw0KGgo=' } });
  expect(result.diagnostics).toEqual([]);
  const client = result.files.find(file => file.path === 'app/page.client.tsx')!;
  const assetFile = result.files.find(file => file.path.startsWith('public/assets/'))!;
  expect(parseJSXToNodes(client.code).get(result.identity.instance)?.attrs[nativePropName(result.identity, 'card', 'photo')]).toBe(`url(${assetFile.path.slice(6)})`);
});

it('compiles a complete native candidate deterministically without mutating source or destination', async () => {
  const source = transfer(), before = JSON.stringify(source);
  const existingFiles = new Map([['app/page.client.tsx', 'existing Home'], ['app/page.tsx', 'existing wrapper']]);
  const compiled = compileNativeTransfer(source, { existingFiles, mode: 'create' });
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.files).toHaveLength(3);
  expect(compiled.files.some(file => existingFiles.has(file.path))).toBe(false);
  expect(compileNativeTransfer(source, { existingFiles, mode: 'create' })).toEqual(compiled);
  expect(JSON.stringify(source)).toBe(before);
  expect([...existingFiles.values()]).toEqual(['existing Home', 'existing wrapper']);
  const target = { projectId: 'destination', branchId: 'main' };
  const result = await framerImportSubmitOperation.execute(createSnapshot(target, 0, Object.fromEntries(existingFiles)), {
    files: compiled.files, mode: 'create', target, expectedRevision: 0,
    sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds },
  }, createOperationContext());
  expect(result.diagnostics).toEqual([]);
  expect(result.changes).toHaveLength(3);
});

it('compiles source page references inside a master to the imported page route', () => {
  const source = transfer(), master = source.definitions[1].data;
  const frame = (master.children as Record<string, any>[])[0];
  frame.children[0].link = { type: 'webPage', webPageId: 'home' };
  const result = compileNativeTransfer(source, { existingFiles: new Map([['app/page.client.tsx', 'existing']]), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  const page = result.files.find(file => file.path.endsWith('/page.client.tsx'))!;
  const masterFile = result.files.find(file => file.path.startsWith('components/'))!;
  expect(parseJSXToNodes(masterFile.code).get(result.identity.label)?.attrs.href).toBe('/' + page.path.split('/')[1]);
});

it('returns no partial files if any required original asset or behavior is unavailable', () => {
  const source = transfer();
  const page = source.definitions[0].data;
  (page.children as Record<string, unknown>[])[0].masks = [{ maskType: 'image', maskImage: 'data:framer/asset-reference,missing.svg' }];
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.files).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'ASSET_DEFINITION_MISSING' }));
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ property: 'masks' }));
});
it('imports an original image mask as editable native styling with the original asset', async () => {
  const source = transfer(), frame = (source.definitions[0].data.children as Record<string, any>[])[0];
  const mask = 'data:framer/asset-reference,mask.png';
  frame.masks = [{ maskType: 'image', maskImage: mask, maskImageResize: 'cover', maskMode: 'alpha', maskPosition: 'center', maskRepeat: 'no-repeat', maskComposite: 'add' }];
  source.assets = [{ key: 'mask', extension: '.png', mimeType: 'image/png', url: 'https://example.com/mask.png' }];
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create', assetPayloads: { mask: 'data:image/png;base64,iVBORw0KGgo=' } });
  expect(result.diagnostics).toEqual([]);
  const asset = result.files.find(file => file.path.startsWith('public/assets/'))!;
  const client = result.files.find(file => file.path === 'app/page.client.tsx')!;
  const styles = parseJSXToNodes(client.code).get(result.identity.desktop)!.styles;
  expect(styles.maskImage).toBe(`url("${asset.path.slice('public'.length)}")`);
  expect(styles.maskSize).toBe('cover');
  const target = { projectId: 'destination', branchId: 'main' };
  const submitted = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: result.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext());
  expect(submitted.changes).toHaveLength(result.files.length);
});
it('imports a simple source rotation loop as an editable native motion effect', async () => {
  const source = transfer(), frame = (source.definitions[0].data.children as Record<string, any>[])[0];
  frame.children.push({ id: 'spinner', __class: 'FrameNode', parentid: 'desktop', children: [], loopEffectEnabled: true, loopEffectRotate: 360, loopEffectRepeatType: 'loop', loopEffectRepeatDelay: 0, loopEffectTransition: { type: 'tween', duration: 1, delay: 0, ease: [0, 0, 1, 1] } });
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  const client = result.files.find(file => file.path === 'app/page.client.tsx')!;
  const decomposed = decomposeLoopInCode(client.code, result.identity.spinner);
  expect(getLoopAnimate(decomposed, result.identity.spinner)).toMatchObject({ props: { rotate: '360' }, trans: { duration: '1', repeat: 'Infinity', ease: 'linear' } });
  const target = { projectId: 'destination', branchId: 'main' };
  const submitted = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: result.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext());
  expect(submitted.changes).toHaveLength(result.files.length);
  frame.children[1].rotation = 45;
  expect(compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' }).diagnostics).toContainEqual(expect.objectContaining({ property: 'loopEffectEnabled' }));
});

it('reports unsupported paste context and malformed captures without touching a destination', () => {
  expect(compileNativeTransfer(transfer(), { existingFiles: new Map(), mode: 'paste' })).toMatchObject({ files: [], diagnostics: [expect.objectContaining({ code: 'NATIVE_TARGET_ADAPTER_REQUIRED' })] });
  expect(compileNativeTransfer({}, { existingFiles: new Map(), mode: 'create' })).toMatchObject({ files: [], diagnostics: [expect.objectContaining({ code: 'SOURCE_CAPTURE_INVALID' })] });
});
it.each(['metadata', 'font', 'token'])('does not report a complete candidate while required %s semantics are missing', kind => {
  const source = transfer();
  if (kind === 'metadata') source.definitions[2].data.webMetadata = { language: 'uk' };
  const frame = (source.definitions[1].data.children as Record<string, any>[])[0];
  if (kind === 'token') Object.assign(frame, { fillEnabled: true, fillType: 'color', fillColor: 'var(--token-theme, red)' });
  if (kind === 'font') frame.children[0].html = '<p style="font-family: Custom Font">Original text</p>';
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.files).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: kind === 'metadata' ? 'SOURCE_METADATA_ADAPTER_REQUIRED' : kind === 'font' ? 'SOURCE_FONT_ADAPTER_REQUIRED' : 'SOURCE_TOKEN_ADAPTER_REQUIRED' }));
});
it('preserves a page no-index setting in native metadata and sitemap detection', async () => {
  const source = transfer();
  source.definitions[0].data.webMetadata = { title: 'Private page', noIndex: true };
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  const server = result.files.find(file => file.path === 'app/page.tsx')!.code;
  expect(server).toMatch(/robots:\s*\{\s*index:\s*false/);
  expect(parseMetadataFromCode(server)).toMatchObject({ title: 'Private page', robots: { index: false } });
  const target = { projectId: 'destination', branchId: 'main' };
  const submitted = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: result.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext());
  expect(submitted.diagnostics).toEqual([]);
});
it('rejects an invalid no-index value instead of changing search visibility', () => {
  const source = transfer();
  source.definitions[0].data.webMetadata = { noIndex: 'true' };
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.files).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SOURCE_METADATA_ADAPTER_REQUIRED' }));
});
it('keeps an explicit indexable page indexable when the destination defaults to no-index', () => {
  const source = transfer();
  source.definitions[0].data.webMetadata = { noIndex: false };
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  expect(parseMetadataFromCode(result.files.find(file => file.path === 'app/page.tsx')!.code)).toMatchObject({ robots: { index: true } });
});
it('imports a CMS detail route with live record bindings into a native page pair', async () => {
  const source = transfer(), page = source.definitions[0].data;
  source.definitions[2].data.homePageNodeId = 'elsewhere';
  source.definitions[2].data.webMetadata = { title: 'Site title', description: 'Site description' };
  page.pagePath = '/articles/:slugField';
  page.dataIdentifier = 'local-module:collection/articles:default';
  const frame = (page.children as Record<string, any>[])[0];
  frame.parentid = 'home';
  frame.children = [{ id: 'detail-title', __class: 'RichTextNode', parentid: 'desktop', children: [], html: '<h1>Preview</h1>', textContent: { type: 'variableReference', providerId: 'home', id: 'titleField' } }];
  const collection = { id: 'articles', __class: 'CollectionNode', name: 'Articles', variables: [{ id: 'slugField', type: 'slug' }, { id: 'titleField', name: 'Title', type: 'string' }], children: [{ id: 'row', __class: 'CollectionItemNode', parentid: 'articles', children: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', '$control__slugField': { value: 'first' }, '$control__titleField': { value: 'First article' } }] };
  source.definitions.push({ id: collection.id, kind: collection.__class, data: collection });
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  const client = result.files.find(file => file.path === 'app/articles/[slug]/page.client.tsx')!;
  const server = result.files.find(file => file.path === 'app/articles/[slug]/page.tsx')!;
  expect(client.code).toContain('"kind": "detail"');
  expect(client.code).toContain(`"collection": "${nativeCollectionSlug(result.identity, 'articles')}"`);
  expect(parseJSXToNodes(client.code).get(result.identity['detail-title'])?.binding?.field).toBe(nativeFieldId(result.identity, 'articles', 'titleField'));
  expect(server.code).toContain('generateMetadata');
  expect(server.code).toContain('Site title');
  const relocated = compileNativeTransfer(source, { existingFiles: new Map([['app/articles/[record]/page.client.tsx', 'existing']]), mode: 'create' });
  expect(relocated.diagnostics).toEqual([]);
  expect(relocated.files.some(file => /app\/[^/]+\/articles\/\[slug\]\/page\.client\.tsx$/.test(file.path))).toBe(true);
  const target = { projectId: 'destination', branchId: 'main' };
  const submitted = await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: result.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext());
  expect(submitted.changes).toHaveLength(result.files.length);
  const changed = result.files.map(file => file.path === server.path ? { ...file, code: file.code + '\nconsole.log("injected");' } : file);
  await expect(framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: changed, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext())).rejects.toThrow(/WRAPPER_INVALID/);
  const mismatch = result.files.map(file => file.path === client.path ? { ...file, code: file.code.replace(`"collection": "${nativeCollectionSlug(result.identity, 'articles')}"`, '"collection": "other"') } : file);
  await expect(framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: mismatch, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext())).rejects.toThrow(/WRAPPER_INVALID/);
  page.webMetadata = { title: '{{titleField}} article' };
  const dynamicSeo = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(dynamicSeo.diagnostics).toEqual([]);
  const seoServer = dynamicSeo.files.find(file => file.path === server.path)!;
  const titleExpression = parseCmsSeoExpressions(seoServer.code).title!;
  expect(new Function('item', `return (${titleExpression});`)({ [nativeFieldId(dynamicSeo.identity, 'articles', 'titleField')]: 'First' })).toBe('First article');
  expect((await framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: dynamicSeo.files, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext())).diagnostics).toEqual([]);
  const malicious = buildCmsDetailServerWrapper({ collection: nativeCollectionSlug(result.identity, 'articles'), defaults: { title: 'Site title', description: 'Site description' }, expressions: { title: 'process.env.SECRET' }, apiConfig: null });
  const unsafeFiles = dynamicSeo.files.map(file => file.path === server.path ? { ...file, code: malicious } : file);
  await expect(framerImportSubmitOperation.execute(createSnapshot(target, 0, {}), { files: unsafeFiles, mode: 'create', target, expectedRevision: 0, sourceManifest: { format: source.format, version: source.version, complete: true, context: source.context, rootIds: source.rootIds } }, createOperationContext())).rejects.toThrow(/WRAPPER_INVALID/);
  page.webMetadata = { title: '{{missingField}} article' };
  expect(compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' }).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('metadata') }));
  delete page.webMetadata;
  frame.children[0].link = { type: 'webPage', webPageId: 'home' };
  expect(compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' }).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('dynamic') }));
  delete frame.children[0].link;
  frame.children.push({ id: 'detail-spinner', __class: 'FrameNode', parentid: 'desktop', children: [], loopEffectEnabled: true, loopEffectRotate: 360, loopEffectRepeatType: 'loop', loopEffectTransition: { type: 'tween', duration: 1, delay: 0, ease: [0, 0, 1, 1] } });
  expect(compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' }).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('hook-order') }));
});
it('imports a code component as a labeled editable placeholder even without original code', () => {
  const source = transfer(), identifier = 'module:vendor/pinned/Widget.tsx:Widget';
  const frame = (source.definitions[0].data.children as Record<string, any>[])[0];
  frame.children[0].codeComponentIdentifier = identifier;
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  const page = result.files.find(file => file.path === 'app/page.client.tsx')!;
  const node = parseJSXToNodes(page.code).get(result.identity.instance)!;
  expect(node.type).toBe('div');
  expect(node.name).toContain('Заглушка');
  expect(node.styles.width).toBe('200px');
  expect(result.files.some(file => file.path.startsWith('components/'))).toBe(false);
});
it('does not require custom code, controls, nested slots or overrides behind a placeholder', () => {
  const source = transfer(), frame = (source.definitions[0].data.children as Record<string, any>[])[0];
  Object.assign(frame.children[0], { codeComponentIdentifier: 'local-module:codeFile/missing:Widget', '$control__image': { value: 'data:framer/asset-reference,missing.png' }, codeOverrideEnabled: true, codeOverrideIdentifier: 'local-module:codeFile/unavailable:Effect', onTap: [{ actionIdentifier: 'unsupported' }], children: [{ id: 'opaque-child', __class: 'UnknownNode', children: [] }] });
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toEqual([]);
  const page = result.files.find(file => file.path === 'app/page.client.tsx')!;
  expect(parseJSXToNodes(page.code).get(result.identity.instance)?.name).toContain('Заглушка');
  expect(page.code).not.toContain('opaque-child');
});
it('reports a source-only declaration with no importable content instead of a successful empty import', () => {
  const source = transfer();
  const data = { id: 'empty', __class: 'LocalModulesListNode', children: [] };
  source.rootIds = [data.id]; source.definitions = [{ id: data.id, kind: data.__class, data }];
  const result = compileNativeTransfer(source, { existingFiles: new Map(), mode: 'create' });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SOURCE_EMPTY_IMPORT' }));
});
it('blocks an unadapted link prop default after namespacing instead of linking back to the existing Home', () => {
  const source = transfer(), master = source.definitions[1].data;
  master.variables = [{ id: 'destination', type: 'link', initialValue: '/' }];
  const frame = (master.children as Record<string, any>[])[0];
  frame.children[0].link = { type: 'variableReference', providerId: 'card', id: 'destination' };
  const result = compileNativeTransfer(source, { existingFiles: new Map([['app/page.client.tsx', 'existing Home']]), mode: 'create' });
  expect(result.files).toEqual([]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SOURCE_LINK_ADAPTER_REQUIRED' }));
});
