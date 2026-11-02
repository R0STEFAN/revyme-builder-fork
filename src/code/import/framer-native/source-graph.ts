import { trace } from '../../../shared/debug-trace';
import { simpleHash } from '../../../shared/hash-utils';
import { decodeNativeTransfer } from './decode';
import type { ResolvedSourceNode, SourceGraph, SourceNode, SourceProperties, SourceReference } from './types';

// Observed model v128 classes, including non-rendering document declarations.
const supportedKinds = new Set([
  'RootNode', 'FrameNode', 'RichTextNode', 'CodeComponentNode', 'SmartComponentNode',
  'WebPageNode', 'LayoutTemplateNode', 'SlotNode', 'OverlayNode',
  'FormPlainTextInputNode', 'FormSelectNode', 'CollectionNode', 'CollectionItemNode',
  'TextStylePresetNode', 'ColorStyleTokenNode', 'LocalModuleNode', 'ExternalModuleNode',
  'EntityReferenceNode', 'EntityFolderNode', 'RouteSegmentNode',
  'ExternalModulesListNode', 'ContentManagementNode', 'ColorStyleTokenListNode',
  'LocalModulesListNode', 'RouteSegmentRootNode', 'PresetsListNode', 'ErrorListNode',
  'CustomCodeScopeNode', 'AssetsEntityTypeRootNode',
]);

export function sourceRecord(value: unknown): SourceProperties | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as SourceProperties : undefined;
}

export function isSourceCodeComponent(node: { kind: string; properties?: SourceProperties; raw?: SourceProperties }): boolean {
  return node.kind === 'CodeComponentNode' && !String((node.properties ?? node.raw)?.codeComponentIdentifier ?? '').startsWith('local-module:canvasComponent/');
}

/** Framer can enable the picker without assigning any override. */
export function activeSourceCodeOverride(properties: SourceProperties): string | undefined {
  const identifier = properties.codeOverrideIdentifier;
  if (properties.codeOverrideEnabled !== true || identifier == null || identifier === '') return;
  return String(identifier);
}

/** Field IDs are scoped; a component and a collection may reuse a source ID. */
export function sourceVariableKey(scopeId: string, id: string): string {
  return JSON.stringify([scopeId, id]);
}

export function sourceAssetKey(key: string): string {
  return JSON.stringify(['asset', key, 'file']);
}

export function sourceCodeExportKey(identifier: string): string {
  return JSON.stringify(['code-export', identifier]);
}

export function sourceCodeComponentIdentifiers(graph: SourceGraph): Set<string> {
  const identifiers = new Set<string>();
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    const object = sourceRecord(value);
    if (!object) return;
    const identifier = object.codeComponentIdentifier;
    if (typeof identifier === 'string' && !identifier.startsWith('local-module:canvasComponent/')) identifiers.add(identifier);
    for (const [key, item] of Object.entries(object)) if (key !== 'children') scan(item);
  };
  for (const id of graph.reachable) {
    const node = graph.nodes.get(id)!;
    if (!['ExternalModuleNode', 'LocalModuleNode'].includes(node.kind)) scan(node.raw);
  }
  return identifiers;
}

export function sourceCodeOverrideIdentifiers(graph: SourceGraph): Set<string> {
  const identifiers = new Set<string>();
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    const object = sourceRecord(value);
    if (!object) return;
    const identifier = activeSourceCodeOverride(object);
    if (identifier?.startsWith('module:')) identifiers.add(identifier);
    for (const [key, item] of Object.entries(object)) if (key !== 'children') scan(item);
  };
  for (const id of graph.reachable) if (!isSourceCodeComponent(graph.nodes.get(id)!)) scan(graph.nodes.get(id)!.raw);
  return identifiers;
}

export function sourceVariables(graph: SourceGraph, scopeId: string): SourceProperties[] {
  const value = requiredNode(graph, scopeId).raw.variables ?? [];
  const entries = Array.isArray(value) ? value.map(item => [undefined, item] as const) : Object.entries(sourceRecord(value) ?? {});
  const seen = new Set<string>();
  return entries.map(([key, item]) => {
    const record = sourceRecord(item);
    const id = record?.id ?? key;
    if (!record || typeof id !== 'string' || !id || seen.has(id)) throw new Error(`FRAMER_SOURCE_INVALID: invalid/duplicate variable in ${scopeId}`);
    seen.add(id);
    return { ...record, id };
  });
}

/** Image props bound to fills use Revyme's whole CSS background-image value. */
export function sourceCssImageVariables(graph: SourceGraph, scopeId: string): Set<string> {
  const scope = graph.nodes.get(scopeId), result = new Set<string>();
  if (!scope) throw new Error(`Missing source image scope ${scopeId}`);
  for (const state of scope.children) {
    const seen = new Set<string>();
    const replicaState = sourceRecord(graph.nodes.get(state)?.raw.replicaInfo) ? state : undefined;
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = resolveSourceNode(graph, id, replicaState);
      const ref = sourceRecord(node.properties.fillImage);
      if (node.properties.fillEnabled === true && node.properties.fillType === 'image' && ref?.type === 'variableReference' && ref.providerId === scopeId && typeof ref.id === 'string') result.add(ref.id);
      if (!isSourceCodeComponent(node)) node.children.forEach(walk);
    };
    walk(state);
  }
  return result;
}

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  const object = sourceRecord(value);
  if (object) return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJSON(object[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function readReferences(node: SourceNode): SourceReference[] {
  const result: SourceReference[] = [];
  const add = (targetId: string, property: string, optional = false) => {
    const existing = result.find(ref => ref.targetId === targetId && ref.property === property);
    if (existing) existing.optional = existing.optional && optional;
    else result.push({ targetId, property, optional });
  };
  const scan = (value: unknown, property: string, field = property) => {
    if (typeof value === 'string') {
      // A module identifier points to an original scope, never a compiled URL.
      const module = /^local-module:(canvasComponent|layoutTemplate|collection)\/([^:]+):/.exec(value);
      if (module) add(module[2], property);
      const codeFile = !isSourceCodeComponent(node) && /^local-module:(codeFile\/[^:]+):/.exec(value);
      if (codeFile) add(codeFile[1], property);
      const externalCode = !isSourceCodeComponent(node) && field === 'codeComponentIdentifier' && /^module:([^/]+)\/[^/]+\/[^:]+:/.exec(value);
      if (externalCode) add(externalCode[1], property);
      for (const match of value.matchAll(/var\(--token-([^,\s)]+)\s*([,)])/g)) add(match[1], property, match[2] === ',');
      if (field === 'baseVariantId') add(value, property);
      if (field === 'html') for (const match of value.matchAll(/data-styles-preset=["']([^"']+)["']/g)) add(match[1], property);
    } else if (Array.isArray(value)) {
      value.forEach(item => scan(item, property, field));
    } else {
      const object = sourceRecord(value);
      if (!object) return;
      if (object.type === 'variableReference' && typeof object.providerId === 'string') add(object.providerId, property);
      for (const [key, item] of Object.entries(object)) {
        if (key === 'children' || key === 'renamedIds') continue;
        if (property === 'replicaInfo' && (key === 'master' || key === 'inheritsFrom') && typeof item === 'string') add(item, `replicaInfo.${key}`);
        scan(item, property ? `${property}.${key}` : key, key);
      }
    }
  };
  for (const [key, value] of Object.entries(node.raw)) if (key !== 'children' && key !== 'renamedIds' && !(isSourceCodeComponent(node) && (key.startsWith('$control__') || key.startsWith('codeOverride') || /^on[A-Z]/.test(key)))) scan(value, key);
  return result;
}

export function buildSourceGraph(input: unknown): SourceGraph {
  const transfer = decodeNativeTransfer(input);
  trace.fn('framer-native.buildSourceGraph', { definitions: transfer.definitions.length, mode: transfer.context.mode });
  const nodes = new Map<string, SourceNode>();
  const index = (value: unknown) => {
    const raw = sourceRecord(value);
    if (!raw || typeof raw.id !== 'string' || typeof raw.__class !== 'string') throw new Error('FRAMER_SOURCE_INVALID: malformed node');
    const previous = nodes.get(raw.id);
    if (previous) {
      if (stableJSON(previous.raw) !== stableJSON(raw)) throw new Error(`FRAMER_SOURCE_INVALID: conflicting declaration ${raw.id}`);
      return;
    }
    const children = raw.children === undefined ? [] : raw.children;
    if (!Array.isArray(children)) throw new Error(`FRAMER_SOURCE_INVALID: invalid children ${raw.id}`);
    const childIds = children.map(child => {
      if (typeof child === 'string') return child;
      const record = sourceRecord(child);
      if (typeof record?.id !== 'string') throw new Error(`FRAMER_SOURCE_INVALID: malformed child of ${raw.id}`);
      return record.id;
    });
    if (new Set(childIds).size !== childIds.length) throw new Error(`FRAMER_SOURCE_INVALID: duplicate child of ${raw.id}`);
    nodes.set(raw.id, { id: raw.id, kind: raw.__class, raw, children: childIds });
    for (const child of children) if (typeof child !== 'string') index(child);
  };
  transfer.definitions.forEach(definition => index(definition.data));
  const byKind = new Map<string, string[]>();
  const references = new Map<string, SourceReference[]>();
  for (const node of nodes.values()) {
    byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node.id]);
    references.set(node.id, readReferences(node));
  }
  for (const node of nodes.values()) {
    if (node.kind !== 'WebPageNode' || node.raw.layoutTemplateIdentifierOverride !== undefined) continue;
    const seen = new Set<string>();
    let parent = nodes.get(String(node.raw.parentid));
    while (parent && parent.kind !== 'RootNode' && !seen.has(parent.id)) {
      seen.add(parent.id); parent = nodes.get(String(parent.raw.parentid));
    }
    if (parent?.kind === 'RootNode' && parent.raw.layoutTemplateIdentifier !== undefined) {
      const inherited = readReferences({ ...node, raw: { layoutTemplateIdentifier: parent.raw.layoutTemplateIdentifier } });
      references.get(node.id)!.push(...inherited);
    }
  }
  const diagnostics = [...transfer.diagnostics];
  if (!transfer.complete) diagnostics.push({ code: 'SOURCE_CAPTURE_INCOMPLETE', message: 'The editor capture is incomplete.' });
  const reachable = new Set<string>();
  const pending = [...transfer.rootIds];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    const node = nodes.get(id);
    if (!node) {
      diagnostics.push({ code: 'SOURCE_REFERENCE_MISSING', sourceId: id, message: `Missing render root ${id}.` });
      continue;
    }
    reachable.add(id);
    if (!supportedKinds.has(node.kind)) diagnostics.push({ code: 'SOURCE_KIND_UNSUPPORTED', sourceId: id, property: '__class', message: `Unsupported editor class ${node.kind}; raw properties retained.` });
    const dependencies: SourceReference[] = [...(isSourceCodeComponent(node) ? [] : node.children.map(targetId => ({ targetId, property: 'children' }))), ...references.get(id)!];
    for (const ref of dependencies) {
      if (!nodes.has(ref.targetId)) {
        if (!ref.optional) diagnostics.push({ code: 'SOURCE_REFERENCE_MISSING', sourceId: id, property: ref.property, message: `Missing source dependency ${ref.targetId}.` });
      }
      else pending.push(ref.targetId);
    }
  }
  trace.action('framer-native.graphBuilt', { nodes: nodes.size, reachable: reachable.size, diagnostics: diagnostics.length });
  const declarationKinds = new Set(['WebPageNode', 'SmartComponentNode', 'LayoutTemplateNode']);
  const renderRootIds = transfer.rootIds.filter(id => {
    const kind = nodes.get(id)?.kind;
    return kind && (declarationKinds.has(kind) || !kind.endsWith('ListNode') && ![
      'RootNode', 'ContentManagementNode', 'LocalModuleNode', 'ExternalModuleNode',
      'RouteSegmentRootNode', 'CustomCodeScopeNode', 'AssetsEntityTypeRootNode',
    ].includes(kind));
  });
  return { transfer, nodes, byKind, references, renderRootIds, reachable, diagnostics };
}

function requiredNode(graph: SourceGraph, id: string): SourceNode {
  const node = graph.nodes.get(id);
  if (!node) throw new Error(`FRAMER_SOURCE_INVALID: missing node ${id}`);
  return node;
}

function applyOverride(properties: SourceProperties, value: unknown): SourceProperties {
  const override = sourceRecord(value);
  if (!override) return { ...properties };
  const result = { ...properties, ...override };
  if (override._deleted !== undefined) {
    if (!Array.isArray(override._deleted) || !override._deleted.every(key => typeof key === 'string')) throw new Error('FRAMER_SOURCE_INVALID: invalid _deleted');
    for (const key of override._deleted) delete result[key as string];
  }
  delete result._deleted;
  return result;
}

/** Resolve one source node in a variant/breakpoint without expanding instances. */
export function resolveSourceNode(graph: SourceGraph, id: string, stateId?: string): ResolvedSourceNode {
  trace.fn('framer-native.resolveSourceNode', { id, stateId });
  const resolving = new Set<string>();
  const resolve = (nodeId: string, state?: string): ResolvedSourceNode => {
    const key = JSON.stringify([nodeId, state]);
    if (resolving.has(key)) throw new Error(`FRAMER_SOURCE_INVALID: inheritance cycle at ${nodeId}`);
    resolving.add(key);
    try {
      const node = requiredNode(graph, nodeId);
      const replica = sourceRecord(node.raw.replicaInfo);
      if (!state && typeof replica?.master === 'string') return resolve(replica.master, nodeId);
      let result: ResolvedSourceNode;
      if (state) {
        const stateNode = requiredNode(graph, state);
        const info = sourceRecord(stateNode.raw.replicaInfo);
        if (!info || typeof info.master !== 'string') {
          if (nodeId === state) return resolve(nodeId);
          throw new Error(`FRAMER_SOURCE_INVALID: ${state} is not a replica state`);
        }
        const pending = [info.master];
        const descendants = new Set<string>();
        while (pending.length) {
          const child = pending.pop()!;
          if (descendants.has(child)) continue;
          descendants.add(child);
          pending.push(...requiredNode(graph, child).children);
        }
        if (!descendants.has(nodeId)) throw new Error(`FRAMER_SOURCE_INVALID: ${nodeId} is outside state ${state}'s master subtree`);
        const parentState = typeof info.inheritsFrom === 'string' && info.inheritsFrom !== info.master ? info.inheritsFrom : undefined;
        result = resolve(nodeId, parentState);
        const overrides = sourceRecord(info.overrides);
        result = { ...result, properties: applyOverride(result.properties, overrides?.[result.sourceId]), provenance: [...result.provenance, state] };
        if (nodeId === info.master) result = { ...result, id: state };
      } else {
        const { id: _id, __class: _kind, children: _children, replicaInfo: _replica, ...properties } = node.raw;
        result = { id: nodeId, sourceId: nodeId, kind: node.kind, properties: { ...properties }, children: [...node.children], provenance: [nodeId] };
      }
      if (result.properties.itemsOrder !== undefined) {
        const order = result.properties.itemsOrder;
        if (!Array.isArray(order) || !order.every(child => typeof child === 'string') || new Set(order).size !== order.length) throw new Error(`FRAMER_SOURCE_INVALID: invalid itemsOrder ${nodeId}`);
        const unknown = order.find(child => !result.children.includes(child));
        if (unknown) throw new Error(`FRAMER_SOURCE_INVALID: unknown ordered child ${unknown} of ${nodeId}`);
        result.children = [...order as string[], ...result.children.filter(child => !order.includes(child))];
      }
      return result;
    } finally {
      resolving.delete(key);
    }
  };
  return resolve(id, stateId);
}

/** All emitters use this single, label-independent identity allocation. */
export function allocateTargetIdentity(graph: SourceGraph, existingPaths: ReadonlySet<string>): Record<string, string> {
  trace.fn('framer-native.allocateTargetIdentity', { nodes: graph.reachable.size, existingPaths: existingPaths.size });
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const used = new Set([...existingPaths].map(path => normalize(path.split('/').pop()!.replace(/\.[^.]+$/, ''))));
  const identity: Record<string, string> = Object.create(null);
  const entries = [...graph.reachable].map(id => ({ id, field: false, slug: false }));
  for (const identifier of new Set([...sourceCodeComponentIdentifiers(graph), ...sourceCodeOverrideIdentifiers(graph)])) {
    const id = sourceCodeExportKey(identifier);
    if (graph.nodes.has(id)) throw new Error(`FRAMER_SOURCE_INVALID: code/node identity collision ${id}`);
    entries.push({ id, field: false, slug: false });
  }
  const assetKeys = new Set(graph.transfer.assets.map(asset => asset.key).filter((key): key is string => typeof key === 'string' && !!key));
  for (const key of assetKeys) {
    const id = sourceAssetKey(key);
    if (graph.nodes.has(id)) throw new Error(`FRAMER_SOURCE_INVALID: asset/node identity collision ${id}`);
    entries.push({ id, field: false, slug: false });
  }
  for (const scopeId of graph.reachable) for (const variable of sourceVariables(graph, scopeId)) {
    const id = sourceVariableKey(scopeId, String(variable.id));
    if (graph.nodes.has(id)) throw new Error(`FRAMER_SOURCE_INVALID: field/node identity collision ${id}`);
    entries.push({ id, field: true, slug: graph.nodes.get(scopeId)!.kind === 'CollectionNode' && variable.type === 'slug' });
  }
  for (const { id, field, slug } of entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (slug) { identity[id] = '_slug'; continue; }
    const hash = simpleHash(`${graph.transfer.context.projectId}:${id}`).replace('-', 'n');
    const stem = field ? `field${hash}` : `framer-${hash}`;
    let candidate = stem;
    for (let suffix = 2; used.has(normalize(candidate)); suffix++) candidate = `${stem}${field ? '_' : '-'}${suffix}`;
    used.add(normalize(candidate));
    identity[id] = candidate;
  }
  // Native template roots and outlets have canonical, file-scoped identities.
  for (const id of graph.byKind.get('LayoutTemplateNode') ?? []) {
    if (!graph.reachable.has(id)) continue;
    const primary = graph.nodes.get(id)!.raw.baseVariantId;
    if (typeof primary === 'string' && graph.nodes.has(primary)) identity[primary] = 'root';
    const walk = (nodeId: string) => {
      const node = graph.nodes.get(nodeId)!;
      if (node.kind === 'SlotNode') identity[nodeId] = 'children-slot';
      node.children.forEach(walk);
    };
    graph.nodes.get(id)!.children.forEach(walk);
  }
  return identity;
}
