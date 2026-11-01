const MAX_BYTES = 50 * 1024 * 1024;
const MODES = new Set(['selection', 'component', 'page', 'project']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message) {
  const error = new Error(`FRAMER_TRANSFER_INVALID: ${message}`);
  error.code = 'FRAMER_TRANSFER_INVALID';
  throw error;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512; }

/** Validate before conversion; native clipboard/provenance is untrusted input. */
export function decodeNativeTransfer(input) {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES || new TextEncoder().encode(input).byteLength > MAX_BYTES) fail('size limit exceeded');
    try { value = JSON.parse(input); } catch { fail('invalid JSON'); }
  }
  const ancestors = new WeakSet();
  let bytes = 0;
  const encoder = new TextEncoder();
  function inspect(node, depth) {
    if (depth > 256) fail('depth limit exceeded');
    if (typeof node === 'string') bytes += encoder.encode(node).byteLength + 2;
    else if (node === null || typeof node === 'boolean') bytes += 5;
    else if (typeof node === 'number' && Number.isFinite(node)) bytes += String(node).length;
    else if (typeof node !== 'object') fail('only JSON values are supported');
    else {
      if (!Array.isArray(node) && !record(node)) fail('nonplain data');
      if (ancestors.has(node)) fail('cycle in input');
      ancestors.add(node);
      for (const key of Object.keys(node)) {
        if (FORBIDDEN_KEYS.has(key)) fail('prototype keys are forbidden');
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor || !('value' in descriptor)) fail('accessors are forbidden');
        bytes += encoder.encode(key).byteLength + 4;
        inspect(descriptor.value, depth + 1);
      }
      ancestors.delete(node);
    }
    if (bytes > MAX_BYTES) fail('size limit exceeded');
  }
  inspect(value, 0);
  if (!record(value) || value.format !== 'revyme.framer.native' || value.version !== 1) fail('unsupported format or version');
  const { context, rootIds, definitions, assets, complete, diagnostics } = value;
  if (!record(context) || !MODES.has(context.mode)) fail('invalid scope mode');
  for (const key of ['projectId', 'branchId', 'revision', 'editorBuild', 'scopeId']) {
    if (!validId(context[key])) fail(`invalid context.${key}`);
  }
  if (!Array.isArray(definitions) || definitions.length > 100000) fail('invalid definition count');
  const ids = new Set();
  for (const definition of definitions) {
    if (!record(definition) || !validId(definition.id) || !validId(definition.kind) || !record(definition.data)) fail('invalid definition');
    if (definition.data.id !== definition.id) fail('definition identity mismatch');
    if (ids.has(definition.id)) fail('duplicate definition');
    ids.add(definition.id);
  }
  if (!Array.isArray(rootIds) || rootIds.length === 0 || rootIds.some(id => !validId(id) || !ids.has(id))
    || new Set(rootIds).size !== rootIds.length) fail('missing or duplicate root');
  if (!Array.isArray(assets) || assets.some(asset => !record(asset))) fail('invalid assets');
  if (value.codeFiles !== undefined) {
    if (!Array.isArray(value.codeFiles) || value.codeFiles.length > 10000) fail('invalid code sources');
    const codeIds = new Set();
    for (const file of value.codeFiles) {
      if (!record(file) || !['sourceId', 'path', 'moduleId', 'saveId'].every(key => validId(file[key])) || typeof file.code !== 'string' || codeIds.has(file.sourceId)) fail('invalid/duplicate code source');
      codeIds.add(file.sourceId);
    }
  }
  if (typeof complete !== 'boolean' || !Array.isArray(diagnostics)) fail('invalid completeness');
  for (const diagnostic of diagnostics) {
    if (!record(diagnostic) || !validId(diagnostic.code) || typeof diagnostic.message !== 'string'
      || (diagnostic.sourceId !== undefined && !validId(diagnostic.sourceId))) fail('invalid diagnostic');
  }
  return value;
}
