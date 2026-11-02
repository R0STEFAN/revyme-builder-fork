// A minified export is meaningful only for the editor build observed with it.
const EDITOR_BUILDS = Object.freeze({
  'https://app.framerstatic.com/web.D7IYYINP.mjs': {
    engineModule: 'https://app.framerstatic.com/chunk-VNJKMZPM.mjs', engineExport: 'Fc', treeVersion: 128,
    assetModule: 'https://app.framerstatic.com/chunk-ZNFBUDMT.mjs', assetUrlExport: 'l',
  },
  'https://app.framerstatic.com/web.D5JMWQLK.mjs': {
    engineModule: 'https://app.framerstatic.com/chunk-IIU4YMHS.mjs', engineExport: 'Ac', treeVersion: 128,
    assetModule: 'https://app.framerstatic.com/chunk-ZNFBUDMT.mjs', assetUrlExport: 'l', assetImageUrlExport: 'j',
  },
});

const ASSET_MODULE = 'https://app.framerstatic.com/chunk-ZNFBUDMT.mjs';

async function discoverCompatibleBuild(entry, fetchModuleText) {
  if (!fetchModuleText) return;
  let source;
  try { source = await fetchModuleText(entry); } catch { return; }
  if (typeof source !== 'string' || source.length > 2_000_000) return;
  // Only static imports at the beginning of the actual active editor entry are
  // candidates: they already ran as part of the page, and no other chunk is loaded.
  const imports = [], pattern = /\s*import\s*(?:\{([^}]*)\}\s*from\s*)?["'](https:\/\/app\.framerstatic\.com\/chunk-[A-Za-z0-9_-]+\.mjs)["']\s*;?/gy;
  let match, end = 0;
  while ((match = pattern.exec(source))) { imports.push({ bindings: match[1] ?? '', url: match[2] }); end = pattern.lastIndex; }
  if (!imports.some(item => item.url === ASSET_MODULE)) return;
  const body = source.slice(end);
  const candidates = [];
  for (const item of imports) for (const binding of item.bindings.split(',')) {
    const names = /^\s*([\w$]+)\s+as\s+([\w$]+)\s*$/.exec(binding);
    if (!names) continue;
    const local = names[2].replace(/[$]/g, '\\$&');
    if (new RegExp(`\\b${local}\\.stores\\.projectStore\\b`).test(body) && new RegExp(`\\b${local}\\.loadScopesThenProcess\\s*\\(`).test(body)) candidates.push({ engineModule: item.url, engineExport: names[1] });
  }
  if (candidates.length !== 1) return;
  return { ...candidates[0], treeVersion: 128, assetModule: ASSET_MODULE, assetUrlExport: 'l', assetImageUrlExport: 'j', discovered: true };
}

export async function resolveEditorSourceAdapter({ scriptUrls, resourceUrls = [], href, importModule, fetchModuleText }) {
  const active = scriptUrls.filter(url => /^https:\/\/app\.framerstatic\.com\/web\.[A-Za-z0-9_-]+\.mjs$/.test(url));
  const entry = active.length === 1 ? active[0] : undefined;
  const build = entry && (EDITOR_BUILDS[entry] ?? await discoverCompatibleBuild(entry, fetchModuleText));
  if (!build) {
    const editorEntries = urls => [...new Set(urls.flatMap(value => {
      try {
        const url = new URL(value);
        return url.origin === 'https://app.framerstatic.com' && /^\/web\.[A-Za-z0-9_-]+\.mjs$/.test(url.pathname)
          ? [url.origin + url.pathname] : [];
      } catch { return []; }
    }))];
    const scripts = editorEntries(scriptUrls), resources = editorEntries(resourceUrls);
    throw new Error(`EDITOR_BUILD_UNSUPPORTED: ${scripts.length ? `Detected editor: ${scripts.join(', ')}.` : 'No editor entry found in document scripts.'} Observed resources: ${resources.join(', ') || 'none'}. Verified adapter: ${Object.keys(EDITOR_BUILDS).join(', ')}.`);
  }
  const exports = await importModule(build.engineModule);
  const assetExports = await importModule(build.assetModule);
  if (build.discovered && exports[build.engineExport]?.name !== 'VekterEngine') throw new Error('ENGINE_UNAVAILABLE: Discovered engine does not match the expected source model.');
  if (typeof assetExports[build.assetUrlExport] !== 'function') throw new Error('ASSET_RESOLVER_UNAVAILABLE: The verified native URL helper is unavailable.');
  if (build.assetImageUrlExport && typeof assetExports[build.assetImageUrlExport] !== 'function') throw new Error('ASSET_RESOLVER_UNAVAILABLE: The native image URL helper is unavailable.');
  return createEngineSourceAdapter(exports[build.engineExport], { editorBuild: entry, href, treeVersion: build.treeVersion, resolveAssetUrl: assetExports[build.assetUrlExport], resolveAssetImageUrl: assetExports[build.assetImageUrlExport] });
}

export function createEngineSourceAdapter(engine, { editorBuild, href, treeVersion = 128, resolveAssetUrl, resolveAssetImageUrl }) {
  if (!engine?.stores?.projectStore || !engine?.stores?.treeStore || !engine?.stores?.scopeStore
    || typeof engine.tree?.toJS !== 'function' || typeof engine.tree?.get !== 'function'
    || typeof engine.loadScopesThenProcess !== 'function') {
    throw new Error('ENGINE_UNAVAILABLE: The editor does not expose the expected read model.');
  }
  function checkProject() {
    const url = new URL(href());
    const id = engine.stores.projectStore.projectId;
    if (url.origin !== 'https://framer.com' || typeof id !== 'string'
      || !(url.pathname.includes(`--${id}-`) || url.pathname.endsWith(`--${id}`))) {
      throw new Error('PROJECT_MISMATCH: The source engine does not belong to the current project URL.');
    }
  }
  checkProject();
  let capturedCodeIds = [];
  let codeRootIds;
  const scopeIds = () => Array.from(engine.tree.root.children || [], node => node.id);
  const revision = () => {
    const dirty = capturedCodeIds.filter(id => engine.stores.modulesStore?.getTransientSave?.(id)).sort();
    return `${engine.stores.treeStore.remoteTreeVersion}:${engine.tree.root.update}${dirty.length ? `:unsaved:${dirty.join(',')}` : ''}`;
  };
  let cachedRevision, index;
  function sourceIndex() {
    const current = revision();
    if (current === cachedRevision && index) return index;
    const raw = engine.tree.toJS();
    if (raw.version !== treeVersion || !raw.root) throw new Error('SOURCE_TREE_VERSION_UNSUPPORTED: Unexpected source serialization.');
    const next = new Map(), queue = [raw.root];
    for (let offset = 0; offset < queue.length; offset++) {
      const node = queue[offset];
      if (!node || typeof node.id !== 'string' || typeof node.__class !== 'string') throw new Error('SOURCE_NODE_INVALID: Missing native source identity.');
      if (next.has(node.id)) throw new Error(`SOURCE_NODE_DUPLICATE: ${node.id}`);
      next.set(node.id, node);
      if (next.size > 100000) throw new Error('SOURCE_CAPTURE_LIMIT: More than 100000 source nodes');
      if (Array.isArray(node.children)) queue.push(...node.children);
    }
    cachedRevision = current;
    index = next;
    return index;
  }
  return {
    async readContext(request) {
      checkProject();
      const stores = engine.stores;
      const scopeId = stores.scopeStore.active?.id;
      const mode = request.mode;
      const rootIds = mode === 'project' ? scopeIds()
        : mode === 'selection' ? [...stores.selectionStore.ids] : [scopeId];
      codeRootIds = [...rootIds];
      if (!scopeId || rootIds.length === 0) throw new Error('SOURCE_SELECTION_EMPTY: Open a page/component or select layers.');
      return { projectId: stores.projectStore.projectId, branchId: String(stores.treeStore.branchId),
        revision: revision(), editorBuild, scopeId, mode, rootIds };
    },
    async readScope(id) {
      const node = id === engine.tree.root.id ? engine.tree.root : engine.tree.get(id);
      if (!node) return null;
      const loaded = typeof node.isLoaded === 'function' ? node.isLoaded() : node.loaded !== false;
      // Capture source declarations as well as render roots. The converter selects
      // the requested graph closure; unrelated definitions never become page output.
      return { id, loaded, dependencyIds: [...scopeIds(), engine.tree.root.id].filter(other => other !== id) };
    },
    async loadScopes(ids, signal) {
      signal.throwIfAborted();
      const nodes = ids.map(id => engine.tree.get(id)).filter(Boolean);
      await engine.loadScopesThenProcess(nodes);
      cachedRevision = undefined;
      index = undefined;
      signal.throwIfAborted();
    },
    async readDefinitions(ids) {
      checkProject();
      const source = sourceIndex();
      return ids.flatMap(id => {
        const data = source.get(id);
        return data ? [{ id, kind: data.__class, data }] : [];
      });
    },
    async readAssets() {
      const map = engine.stores.assetStore?.assetMap;
      if (!map) return [];
      const values = typeof map.items === 'function' ? map.items()
        : map instanceof Map ? Array.from(map.values()) : Object.values(map);
      return JSON.parse(JSON.stringify(Array.from(values, asset => ({ ...asset,
        ...(resolveAssetUrl ? { url: resolveAssetUrl(asset) } : {}),
        ...(resolveAssetImageUrl && asset.mimeType === 'image/svg+xml' ? { imageUrl: resolveAssetImageUrl(asset) } : {}),
      }))));
    },
    async readCodeFiles() {
      checkProject();
      const codeNodes = [...sourceIndex().values()].filter(node => node.__class === 'LocalModuleNode' && node.save?.type === 'codeFile');
      capturedCodeIds = codeNodes.map(node => node.id);
      const store = engine.stores.modulesStore, result = [];
      for (const node of codeNodes) {
        const fail = message => { throw Object.assign(new Error(message), { sourceId: node.id }); };
        if (typeof store?.getSourceContentForModuleSave !== 'function' || typeof store.getTransientSave !== 'function') fail('SOURCE_CODE_UNAVAILABLE: The original source accessor is unavailable.');
        const save = node.save;
        if (![save.moduleId, save.saveId, save.name].every(value => typeof value === 'string' && value)) fail('SOURCE_CODE_UNAVAILABLE: The original file save pointer is incomplete.');
        if (store.getTransientSave(node.id)) fail('SOURCE_CODE_UNSAVED: Wait for the original code file to finish saving, then capture again.');
        // This accessor reads files.source, not files.module / moduleContent.
        const code = await store.getSourceContentForModuleSave({ moduleId: save.moduleId, saveId: save.saveId });
        if (store.getTransientSave(node.id)) fail('SOURCE_CODE_UNSAVED: The original code changed while it was being read.');
        if (typeof code !== 'string') fail('SOURCE_CODE_UNAVAILABLE: The original file is not text.');
        result.push({ sourceId: node.id, path: save.name, moduleId: save.moduleId, saveId: save.saveId, code });
      }
      const requiredExternal = new Set();
      const requiredOverrides = new Map();
      if (codeRootIds) {
        const source = sourceIndex(), visited = new Set(), pending = [...codeRootIds];
        const scan = value => {
          if (Array.isArray(value)) { value.forEach(scan); return; }
          if (!value || typeof value !== 'object' || value.__class === 'ExternalModuleNode' || value.__class === 'LocalModuleNode') return;
          if (value.__class === 'WebPageNode') scan({ inheritedTemplate: source.get(value.parentid)?.layoutTemplateIdentifier });
          if (value.type === 'variableReference' && typeof value.providerId === 'string') pending.push(value.providerId);
          for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string') {
              const local = /^local-module:(?:canvasComponent|layoutTemplate)\/([^:]+):/.exec(item);
              if (local) pending.push(local[1]);
              if (key === 'master' || key === 'inheritsFrom') pending.push(item);
              const remote = (key === 'codeComponentIdentifier' || key === 'codeOverrideIdentifier') && /^module:([^/]+)\//.exec(item);
              if (remote) requiredExternal.add(remote[1]);
              if (key === 'codeOverrideIdentifier' && value.codeOverrideEnabled === true && remote) {
                const previous = requiredOverrides.get(remote[1]);
                if (previous && previous.slice(0, previous.lastIndexOf(':')) !== item.slice(0, item.lastIndexOf(':'))) throw new Error(`SOURCE_CODE_UNAVAILABLE: Multiple pinned versions require separate source resolution for ${remote[1]}.`);
                requiredOverrides.set(remote[1], item);
              }
            } else scan(item);
          }
        };
        while (pending.length) {
          const id = pending.pop();
          if (visited.has(id)) continue;
          visited.add(id); scan(source.get(id));
        }
      }
      const external = [...sourceIndex().values()].filter(node => node.__class === 'ExternalModuleNode' && node.type === 'codeFile' && (!codeRootIds || requiredExternal.has(node.id)));
      for (const [id, identifier] of requiredOverrides) {
        const descriptor = external.find(node => node.id === id);
        if (!descriptor) external.push({ id, codeComponentIdentifier: identifier });
        else if (String(descriptor.codeComponentIdentifier).split(':').slice(0, -1).join(':') !== identifier.split(':').slice(0, -1).join(':')) throw Object.assign(new Error(`SOURCE_CODE_UNAVAILABLE: Conflicting pinned source pointers for ${id}.`), { sourceId: id });
      }
      for (const node of external) {
        const fail = message => { throw Object.assign(new Error(message), { sourceId: node.id }); };
        const match = /^module:([^/]+)\/([^/]+)\/([^:]+):[A-Za-z_$][\w$]*$/.exec(String(node.codeComponentIdentifier));
        if (!match || match[1] !== node.id) fail('SOURCE_CODE_UNAVAILABLE: The third-party source save pointer is incomplete.');
        if (typeof store?.getSourceContentForModuleSave !== 'function') fail('SOURCE_CODE_UNAVAILABLE: The original source accessor is unavailable.');
        let code;
        try { code = await store.getSourceContentForModuleSave({ moduleId: match[1], saveId: match[2] }); }
        catch { fail(`SOURCE_CODE_UNAVAILABLE: Original third-party source is not accessible for ${node.id} at ${match[2]}.`); }
        if (typeof code !== 'string') fail('SOURCE_CODE_UNAVAILABLE: The original third-party file is not text.');
        result.push({ sourceId: node.id, path: match[3], moduleId: match[1], saveId: match[2], code });
      }
      return result;
    },
  };
}
