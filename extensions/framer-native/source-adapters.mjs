// A minified export is meaningful only for the editor build observed with it.
const EDITOR_BUILDS = Object.freeze({
  'https://app.framerstatic.com/web.D7IYYINP.mjs': {
    engineModule: 'https://app.framerstatic.com/chunk-VNJKMZPM.mjs', engineExport: 'Fc', treeVersion: 128,
  },
});

export async function resolveEditorSourceAdapter({ scriptUrls, href, importModule }) {
  const entry = scriptUrls.find(url => EDITOR_BUILDS[url]);
  if (!entry) throw new Error('EDITOR_BUILD_UNSUPPORTED: This Framer editor build has no verified source adapter.');
  const build = EDITOR_BUILDS[entry];
  const exports = await importModule(build.engineModule);
  return createEngineSourceAdapter(exports[build.engineExport], { editorBuild: entry, href, treeVersion: build.treeVersion });
}

export function createEngineSourceAdapter(engine, { editorBuild, href, treeVersion = 128 }) {
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
  const scopeIds = () => Array.from(engine.tree.root.children || [], node => node.id);
  const revision = () => `${engine.stores.treeStore.remoteTreeVersion}:${engine.tree.root.update}`;
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
      return JSON.parse(JSON.stringify(values));
    },
  };
}
