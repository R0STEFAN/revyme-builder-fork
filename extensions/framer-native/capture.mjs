function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
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
    const definitions = await abortable(adapter.readDefinitions(loadedIds), deadline);
    const returned = new Set(definitions.map(item => item.id));
    for (const id of loadedIds) if (!returned.has(id)) {
      diagnostics.push({ code: 'SOURCE_DEFINITION_NOT_SERIALIZED', sourceId: id, message: 'Loaded definition was omitted by the reader.' });
    }
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
