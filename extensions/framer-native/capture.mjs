function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function missingProjectCursors(definitions) {
  const nodes = new Map(), roots = definitions.map(item => item.data);
  const index = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (typeof value.id === 'string' && typeof value.__class === 'string') nodes.set(value.id, value);
    if (Array.isArray(value.children)) value.children.forEach(index);
  };
  roots.forEach(index);
  const missing = new Set();
  const scan = value => {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (!value || typeof value !== 'object') return;
    if (value.__class === 'CodeComponentNode' && !String(value.codeComponentIdentifier ?? '').startsWith('local-module:canvasComponent/')) return;
    if (value.customCursorType === 'component' && typeof value.customCursorSmartComponentId === 'string' && value.customCursorSmartComponentId && !nodes.has(value.customCursorSmartComponentId)) missing.add(value.customCursorSmartComponentId);
    const master = /^local-module:canvasComponent\/([^:]+):/.exec(String(value.codeComponentIdentifier ?? ''))?.[1];
    const variables = master && nodes.get(master)?.variables;
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('$control__') && Array.isArray(variables) && !variables.some(variable => variable?.id === key.slice(10))) continue;
      if (key === 'replicaInfo' && item && typeof item === 'object' && item.overrides && typeof item.overrides === 'object') {
        scan({ ...item, overrides: undefined });
        for (const [id, override] of Object.entries(item.overrides)) {
          const target = nodes.get(id);
          if (target?.__class === 'CodeComponentNode' && override && typeof override === 'object') scan({ __class: target.__class, codeComponentIdentifier: target.codeComponentIdentifier, ...override });
          else scan(override);
        }
        continue;
      }
      scan(item);
    }
  };
  roots.forEach(scan);
  return [...missing];
}

/** Only the adapter reads Framer. The capture protocol cannot mutate its document. */
export async function captureNativeTransfer(adapter, request, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  deadline.throwIfAborted();
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    const context = await abortable(adapter.readContext(request), deadline);
    const rootIds = request.rootIds?.length ? [...request.rootIds] : context.rootIds?.length ? [...context.rootIds] : [context.scopeId];
    const queue = [...rootIds], seen = new Set(), loadedIds = [], diagnostics = [];
    let definitions;
    do {
      while (queue.length > 0) {
        deadline.throwIfAborted();
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        if (seen.size > 100000) throw new Error('SOURCE_CAPTURE_LIMIT: More than 100000 definitions');
        let scope = await abortable(adapter.readScope(id), deadline);
        if (!scope) {
          diagnostics.push({ code: 'SOURCE_DEPENDENCY_MISSING', sourceId: id, message: 'Referenced source definition is missing.' });
          continue;
        }
        if (!scope.loaded) {
          await abortable(adapter.loadScopes([id], deadline), deadline);
          scope = await abortable(adapter.readScope(id), deadline);
        }
        if (!scope?.loaded) {
          diagnostics.push({ code: 'SOURCE_SCOPE_NOT_LOADED', sourceId: id, message: 'Source definition did not finish loading.' });
          continue;
        }
        loadedIds.push(id);
        queue.push(...scope.dependencyIds);
      }
      definitions = await abortable(adapter.readDefinitions(loadedIds), deadline);
      if (request.mode === 'project') queue.push(...missingProjectCursors(definitions).filter(id => !seen.has(id)));
    } while (queue.length > 0);
    const returned = new Set(definitions.map(item => item.id));
    for (const id of loadedIds) if (!returned.has(id)) {
      diagnostics.push({ code: 'SOURCE_DEFINITION_NOT_SERIALIZED', sourceId: id, message: 'Loaded definition was omitted by the reader.' });
    }
    if (request.mode === 'project') for (const id of missingProjectCursors(definitions)) if (!diagnostics.some(item => item.sourceId === id)) diagnostics.push({ code: 'SOURCE_DEPENDENCY_MISSING', sourceId: id, message: 'Assigned cursor component is missing from the source capture.' });
    const assets = await abortable(adapter.readAssets(loadedIds), deadline);
    let codeFiles = [];
    if (adapter.readCodeFiles) {
      try { codeFiles = await abortable(adapter.readCodeFiles(loadedIds), deadline); }
      catch (error) {
        deadline.throwIfAborted();
        diagnostics.push({ code: 'SOURCE_CODE_UNAVAILABLE', ...(error?.sourceId ? { sourceId: error.sourceId } : {}), message: String(error?.message ?? error) });
      }
    }
    const after = await abortable(adapter.readContext(request), deadline);
    result = { format: 'revyme.framer.native', version: 1, context, rootIds, definitions, assets, codeFiles,
      complete: diagnostics.length === 0, diagnostics };
    if (['projectId', 'branchId', 'revision', 'scopeId'].every(key => after[key] === context[key])) return result;
  }
  return { ...result, complete: false, diagnostics: [...result.diagnostics,
    { code: 'SOURCE_CHANGED_DURING_CAPTURE', message: 'The source project changed during every capture attempt.' }] };
}
