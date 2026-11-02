import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineSourceAdapter, resolveEditorSourceAdapter } from '../source-adapters.mjs';

function makeEngine() {
  const raw = { version: 128, root: { id: 'document', __class: 'RootNode', children: [
    { id: 'page', __class: 'WebPageNode', name: 'Page', children: [{ id: 'desktop', __class: 'FrameNode', children: [] }] },
    { id: 'master', __class: 'CanvasComponentNode', variables: [{ id: 'title', name: 'Title', type: 'string' }], children: [
      { id: 'variant', __class: 'FrameNode', isVariant: true, children: [] },
    ] },
  ] } };
  const loaded = new Set(['page']);
  const runtime = new Map(raw.root.children.map(n => [n.id, { id: n.id, isLoaded: () => loaded.has(n.id) }]));
  const tree = { root: { id: 'document', update: 3, children: [...runtime.values()] },
    get: id => runtime.get(id),
    toJS() { assert(loaded.has('master'), 'must load definitions before serialization'); return structuredClone(raw); },
  };
  return { name: 'VekterEngine', tree,
    stores: { treeStore: { remoteTreeVersion: 9, branchId: 'main' },
      projectStore: { projectId: 'project' }, scopeStore: { active: { id: 'page' } },
      selectionStore: { ids: ['desktop'] }, assetStore: { assetMap: { image: { id: 'image', url: 'https://example.com/image.png' } } } },
    async loadScopesThenProcess(scopes) { for (const scope of scopes) loaded.add(scope.id); },
  };
}

const href = () => 'https://framer.com/projects/Example--project-abc?node=page';

test('loads source scopes and retains exposed variable declarations and variant trees', async () => {
  const adapter = createEngineSourceAdapter(makeEngine(), { editorBuild: 'known', href });
  const scope = await adapter.readScope('page');
  assert.deepEqual(scope.dependencyIds, ['master', 'document']);
  await adapter.loadScopes(['master'], new AbortController().signal);
  const definitions = await adapter.readDefinitions(['page', 'master']);
  assert.equal(definitions[1].data.variables[0].name, 'Title');
  assert.equal(definitions[1].data.children[0].id, 'variant');
  assert.deepEqual(await adapter.readAssets(), [{ id: 'image', url: 'https://example.com/image.png' }]);
});

test('keeps the document root metadata and full serialized hierarchy', async () => {
  const adapter = createEngineSourceAdapter(makeEngine(), { editorBuild: 'known', href });
  assert.equal((await adapter.readScope('document')).loaded, true);
  await adapter.loadScopes(['master'], new AbortController().signal);
  const [document] = await adapter.readDefinitions(['document']);
  assert.equal(document.kind, 'RootNode');
  assert.deepEqual(document.data.children.map(n => n.id), ['page', 'master']);
});

test('reads Framer AssetMap.items instead of serializing its Map and hash internals', async () => {
  const engine = makeEngine();
  const asset = { key: 'images/original.png', name: 'Original.png', ownerTypes: ['project'], properties: { image: { width: 640, height: 480 } } };
  class AssetMap {
    assets = new Map([[asset.key, asset]]);
    _hash = 1;
    items() { return Array.from(this.assets.values()); }
  }
  engine.stores.assetStore.assetMap = new AssetMap();
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  assert.deepEqual(await adapter.readAssets(), [asset]);
});

test('keeps selected nested roots distinct from project export', async () => {
  const adapter = createEngineSourceAdapter(makeEngine(), { editorBuild: 'known', href });
  assert.deepEqual((await adapter.readContext({ mode: 'selection' })).rootIds, ['desktop']);
  assert.deepEqual((await adapter.readContext({ mode: 'project' })).rootIds, ['page', 'master']);
});

test('rejects another project or an unrecognized model instead of reading the wrong source', () => {
  assert.throws(() => createEngineSourceAdapter(makeEngine(), { editorBuild: 'known', href: () => 'https://framer.com/projects/Other--different-abc' }), /PROJECT_MISMATCH/);
  assert.throws(() => createEngineSourceAdapter({}, { editorBuild: 'known', href }), /ENGINE_UNAVAILABLE/);
});

test('rejects unsupported editor builds without importing a guessed module', async () => {
  await assert.rejects(resolveEditorSourceAdapter({ scriptUrls: ['https://app.framerstatic.com/web.UNKNOWN.mjs'], href,
    importModule() { throw new Error('must not import'); } }), /EDITOR_BUILD_UNSUPPORTED/);
});

test('reports the actual unsupported editor entry without URL queries or unrelated scripts', async () => {
  let imported = false;
  await assert.rejects(resolveEditorSourceAdapter({
    scriptUrls: ['https://app.framerstatic.com/web.NEWBUILD.mjs?private=value', 'https://example.com/private.js?token=secret'], href,
    importModule() { imported = true; },
  }), error => /EDITOR_BUILD_UNSUPPORTED/.test(error.message)
    && error.message.includes('https://app.framerstatic.com/web.NEWBUILD.mjs')
    && !error.message.includes('private') && !error.message.includes('secret'));
  assert.equal(imported, false);
});

test('distinguishes a missing editor entry from a detected unsupported editor version', async () => {
  await assert.rejects(resolveEditorSourceAdapter({ scriptUrls: ['https://example.com/unrelated.js'], href,
    importModule() { throw new Error('must not import'); } }), /EDITOR_BUILD_UNSUPPORTED.*No editor entry found/);
});

test('reports observed resource entries for diagnosis without selecting an unverified adapter', async () => {
  await assert.rejects(resolveEditorSourceAdapter({ scriptUrls: [], resourceUrls: ['https://app.framerstatic.com/web.NEWBUILD.mjs?private=value'], href,
    importModule() { throw new Error('must not import'); } }), error => error.message.includes('No editor entry found')
      && error.message.includes('Observed resources: https://app.framerstatic.com/web.NEWBUILD.mjs')
      && !error.message.includes('private'));
});

test('resolves asset URLs through the observed native helper rather than guessing a CDN', async () => {
  const engine = makeEngine();
  const calls = [];
  const adapter = await resolveEditorSourceAdapter({ scriptUrls: ['https://app.framerstatic.com/web.D7IYYINP.mjs'], href,
    async importModule(url) {
      calls.push(url);
      if (url.endsWith('chunk-VNJKMZPM.mjs')) return { Fc: engine };
      if (url.endsWith('chunk-ZNFBUDMT.mjs')) return { l: asset => `https://native.example/${asset.id}.png` };
      throw new Error(`Unexpected module ${url}`);
    },
  });
  assert.deepEqual(calls, ['https://app.framerstatic.com/chunk-VNJKMZPM.mjs', 'https://app.framerstatic.com/chunk-ZNFBUDMT.mjs']);
  assert.equal((await adapter.readAssets())[0].url, 'https://native.example/image.png');
});

test('reads the new editor through its verified singleton export and native image URL helper', async () => {
  const engine = makeEngine();
  engine.stores.assetStore.assetMap.image.mimeType = 'image/svg+xml';
  const calls = [];
  const adapter = await resolveEditorSourceAdapter({ scriptUrls: ['https://app.framerstatic.com/web.D5JMWQLK.mjs'], href,
    async importModule(url) {
      calls.push(url);
      if (url.endsWith('chunk-IIU4YMHS.mjs')) return { Ac: engine };
      if (url.endsWith('chunk-ZNFBUDMT.mjs')) return {
        l: () => 'https://native.example/assets/original.svg',
        j: () => 'https://native.example/images/original.svg',
      };
      throw new Error(`Unexpected module ${url}`);
    },
  });
  assert.equal((await adapter.readContext({ mode: 'page' })).editorBuild, 'https://app.framerstatic.com/web.D5JMWQLK.mjs');
  assert.deepEqual(calls, ['https://app.framerstatic.com/chunk-IIU4YMHS.mjs', 'https://app.framerstatic.com/chunk-ZNFBUDMT.mjs']);
  assert.deepEqual((await adapter.readAssets()).map(asset => [asset.url, asset.imageUrl]), [['https://native.example/assets/original.svg', 'https://native.example/images/original.svg']]);
});

test('does not add an image helper URL to ordinary downloadable files', async () => {
  const engine = makeEngine();
  engine.stores.assetStore.assetMap.image.mimeType = 'application/pdf';
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href,
    resolveAssetUrl: () => 'https://native.example/original.pdf',
    resolveAssetImageUrl() { throw new Error('Image helper must not process files'); },
  });
  assert.equal((await adapter.readAssets())[0].imageUrl, undefined);
});

test('keeps raster assets on their original file URL', async () => {
  const engine = makeEngine();
  engine.stores.assetStore.assetMap.image.mimeType = 'image/png';
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href,
    resolveAssetUrl: () => 'https://native.example/original.png',
    resolveAssetImageUrl() { throw new Error('Raster source must use the original file URL'); },
  });
  assert.equal((await adapter.readAssets())[0].url, 'https://native.example/original.png');
});

async function codeEngine() {
  const engine = makeEngine();
  await engine.loadScopesThenProcess([{ id: 'master' }]);
  const codeNode = { id: 'codeFile/original', __class: 'LocalModuleNode', save: { type: 'codeFile', name: 'Original.tsx', moduleId: 'module-a', saveId: 'save-a' }, children: [] };
  const originalSerialize = engine.tree.toJS.bind(engine.tree);
  engine.tree.toJS = () => { const raw = originalSerialize(); raw.root.children.push(codeNode); return raw; };
  engine.stores.modulesStore = {
    getTransientSave() { return null; },
    async getSourceContentForModuleSave(pointer) {
      assert.deepEqual(pointer, { moduleId: 'module-a', saveId: 'save-a' });
      return 'export function Original() { return null; }';
    },
  };
  return engine;
}

test('captures original code-file text via its saved source accessor and keeps the raw tree unchanged', async () => {
  const engine = await codeEngine();
  const before = engine.tree.toJS();
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  assert.deepEqual(await adapter.readCodeFiles(), [{ sourceId: 'codeFile/original', path: 'Original.tsx', moduleId: 'module-a', saveId: 'save-a', code: 'export function Original() { return null; }' }]);
  assert.deepEqual(engine.tree.toJS(), before);
});

test('does not substitute a compiled module or a stale saved file for unsaved code', async () => {
  const engine = await codeEngine();
  engine.stores.modulesStore.getTransientSave = () => ({ moduleId: 'module-a', saveId: 'unsaved' });
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  await assert.rejects(adapter.readCodeFiles(), /SOURCE_CODE_UNSAVED/);
});

test('detects a code edit while original source is being fetched', async () => {
  const engine = await codeEngine();
  let dirty = false;
  engine.stores.modulesStore.getTransientSave = () => dirty ? { saveId: 'unsaved' } : null;
  engine.stores.modulesStore.getSourceContentForModuleSave = async () => { dirty = true; return 'original'; };
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  const before = await adapter.readContext({ mode: 'project' });
  await assert.rejects(adapter.readCodeFiles(), /SOURCE_CODE_UNSAVED/);
  assert.notEqual((await adapter.readContext({ mode: 'project' })).revision, before.revision);
});

test('reads third-party original source at its pinned module/save without using compiled code', async () => {
  const engine = await codeEngine();
  const serialize = engine.tree.toJS.bind(engine.tree);
  engine.tree.toJS = () => {
    const raw = serialize();
    raw.root.children.push({ id: 'vendor-widget', __class: 'ExternalModuleNode', type: 'codeFile', codeComponentIdentifier: 'module:vendor-widget/pinned-save/Widget.tsx:Widget', children: [] });
    return raw;
  };
  const local = engine.stores.modulesStore.getSourceContentForModuleSave;
  engine.stores.modulesStore.getSourceContentForModuleSave = async pointer => {
    if (pointer.moduleId === 'module-a') return local(pointer);
    assert.deepEqual(pointer, { moduleId: 'vendor-widget', saveId: 'pinned-save' });
    return 'export function Widget(props) { return <div {...props} />; }';
  };
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  const files = await adapter.readCodeFiles();
  assert.deepEqual(files.find(file => file.sourceId === 'vendor-widget'), { sourceId: 'vendor-widget', moduleId: 'vendor-widget', saveId: 'pinned-save', path: 'Widget.tsx', code: 'export function Widget(props) { return <div {...props} />; }' });
});

test('reports unavailable third-party source instead of reading a compiled module', async () => {
  const engine = await codeEngine();
  engine.tree.toJS = () => ({ version: 128, root: { id: 'document', __class: 'RootNode', children: [{ id: 'vendor-widget', __class: 'ExternalModuleNode', type: 'codeFile', codeComponentIdentifier: 'module:vendor-widget/pinned-save/Widget.tsx:Widget', children: [] }] } });
  engine.stores.modulesStore.getSourceContentForModuleSave = async () => { throw new Error('source not accessible'); };
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  await assert.rejects(adapter.readCodeFiles(), error => error.sourceId === 'vendor-widget' && /SOURCE_CODE_UNAVAILABLE/.test(error.message));
});

test('does not require an unrelated private component when capturing another page', async () => {
  const engine = await codeEngine();
  const serialize = engine.tree.toJS.bind(engine.tree);
  engine.tree.toJS = () => {
    const raw = serialize();
    raw.root.children.push({ id: 'private-widget', __class: 'ExternalModuleNode', type: 'codeFile', codeComponentIdentifier: 'module:private-widget/pinned/Private.tsx:default', children: [] });
    return raw;
  };
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  await adapter.readContext({ mode: 'page' });
  assert.equal((await adapter.readCodeFiles()).length, 1);
});

test('follows a local master dependency to fetch a third-party source needed by the selected page', async () => {
  const engine = await codeEngine();
  const serialize = engine.tree.toJS.bind(engine.tree);
  engine.tree.toJS = () => {
    const raw = serialize();
    raw.root.children[0].children.push({ id: 'card', __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/master:default', children: [] });
    raw.root.children[1].children[0].children.push({ id: 'third-party', __class: 'CodeComponentNode', codeComponentIdentifier: 'module:vendor-widget/pinned/Widget.tsx:default', children: [] });
    raw.root.children.push({ id: 'vendor-widget', __class: 'ExternalModuleNode', type: 'codeFile', codeComponentIdentifier: 'module:vendor-widget/pinned/Widget.tsx:default', children: [] });
    return raw;
  };
  const local = engine.stores.modulesStore.getSourceContentForModuleSave;
  engine.stores.modulesStore.getSourceContentForModuleSave = async pointer => pointer.moduleId === 'module-a' ? local(pointer) : 'export default function Widget(props) { return <div {...props} />; }';
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  await adapter.readContext({ mode: 'page' });
  assert.equal((await adapter.readCodeFiles()).some(file => file.sourceId === 'vendor-widget'), true);
});

test('reads an active external override even when the source tree has no module descriptor', async () => {
  const engine = await codeEngine();
  const serialize = engine.tree.toJS.bind(engine.tree);
  engine.tree.toJS = () => {
    const raw = serialize();
    raw.root.children[0].children.push({ id: 'external-override-node', __class: 'FrameNode', children: [], codeOverrideEnabled: true, codeOverrideIdentifier: 'module:vendor/pinned/Override.js:withEffect' });
    return raw;
  };
  const local = engine.stores.modulesStore.getSourceContentForModuleSave;
  engine.stores.modulesStore.getSourceContentForModuleSave = async pointer => pointer.moduleId === 'module-a' ? local(pointer) : 'export function withEffect(Component) { return Component; }';
  const adapter = createEngineSourceAdapter(engine, { editorBuild: 'known', href });
  await adapter.readContext({ mode: 'page' });
  assert.deepEqual((await adapter.readCodeFiles()).find(file => file.sourceId === 'vendor'), { sourceId: 'vendor', moduleId: 'vendor', saveId: 'pinned', path: 'Override.js', code: 'export function withEffect(Component) { return Component; }' });
});
