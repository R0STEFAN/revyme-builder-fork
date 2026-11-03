import { describe, expect, it } from 'vitest';
import capturedUnderline from './fixtures/captured-underline.json';
import type { NativeTransfer } from '../../../shared/framer-transfer-envelope.mjs';
import { allocateTargetIdentity, buildSourceGraph, resolveSourceNode, sourceVariableKey } from './source-graph';

const node = (id: string, properties: Record<string, unknown> = {}) => ({
  id, __class: 'FrameNode', children: [], ...properties,
});
function transfer(...data: ReturnType<typeof node>[]): NativeTransfer {
  return {
    format: 'revyme.framer.native', version: 1,
    context: { projectId: 'test', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: data[0].id, mode: 'component' },
    rootIds: [data[0].id], assets: [], complete: true, diagnostics: [],
    definitions: data.map(data => ({ id: data.id, kind: data.__class, data })),
  };
}

describe('original editor source graph', () => {
  it('includes assigned design cursor masters and reports missing originals', () => {
    const source = transfer(node('page', { children: [node('button', { '$control__cursor': { type: 'customcursor', value: { customCursorType: 'component', customCursorSmartComponentId: 'cursor' } } })] }), node('cursor', { __class: 'SmartComponentNode' }));
    expect(buildSourceGraph(source).reachable.has('cursor')).toBe(true);
    source.definitions.pop();
    expect(buildSourceGraph(source).diagnostics).toContainEqual(expect.objectContaining({ code: 'SOURCE_REFERENCE_MISSING', message: expect.stringContaining('cursor') }));
  });
  it('ignores cursor references in deleted design-component controls', () => {
    const source = transfer(node('page', { children: [node('instance', { __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/card:default', '$control__deleted': { value: { customCursorType: 'component', customCursorSmartComponentId: 'missing' } } })] }), node('card', { __class: 'SmartComponentNode', variables: [] }));
    expect(buildSourceGraph(source).diagnostics).toEqual([]);
  });
  it('includes an inherited page template without pulling every sibling page into the closure', () => {
    const input = transfer(node('page', { __class: 'WebPageNode', parentid: 'document' }), node('document', { __class: 'RootNode', layoutTemplateIdentifier: 'local-module:layoutTemplate/template:default', children: [] }), node('template', { __class: 'LayoutTemplateNode', children: [node('slot', { __class: 'SlotNode' })] }), node('sibling', { __class: 'WebPageNode', parentid: 'document' }));
    const graph = buildSourceGraph(input);
    expect([...graph.reachable].sort()).toEqual(['page', 'slot', 'template']);
    expect(graph.diagnostics).toEqual([]);
  });
  it('materializes the real six-state capture without mutating the source', () => {
    const before = JSON.stringify(capturedUnderline);
    const graph = buildSourceGraph(capturedUnderline);
    const base = resolveSourceNode(graph, 'q7dmakjiW');
    const variant = resolveSourceNode(graph, 'yre4NRiTU');
    expect(base.children).toEqual(['uLUi_cY4A', 'MhIYRayaq']);
    expect(variant.children).toEqual(base.children);
    expect(resolveSourceNode(graph, 'tLD0ypvQg', 'yre4NRiTU').properties).toMatchObject({ width: 1, right: -10, position: 'absolute' });
    expect(variant.properties).not.toHaveProperty('isBreakpoint');
    expect(variant.provenance).toEqual(['q7dmakjiW', 'yre4NRiTU']);
    expect(JSON.stringify(capturedUnderline)).toBe(before);
  });

  it('keeps deletions and falsy overrides and applies child ordering', () => {
    const graph = buildSourceGraph(transfer(
      node('scope', { __class: 'SmartComponentNode', children: [
        node('base', { minHeight: 10, children: [node('first'), node('second')], visible: true }),
        node('phone', { originalid: 'base', replicaInfo: { master: 'base', overrides: {
          base: { _deleted: ['minHeight'], itemsOrder: ['second', 'first'], visible: false, opacity: 0, name: '' },
        } } }),
      ] }),
    ));
    const result = resolveSourceNode(graph, 'base', 'phone');
    expect(result.properties).not.toHaveProperty('minHeight');
    expect(result.properties).toMatchObject({ visible: false, opacity: 0, name: '' });
    expect(result.children).toEqual(['second', 'first']);
  });

  it('inherits gesture overrides through a replica variant', () => {
    const graph = buildSourceGraph(transfer(node('base', { children: [node('label', { opacity: 1, minWidth: 12 })] }),
      node('mobile', { replicaInfo: { master: 'base', overrides: { label: { opacity: 0.5 } } } }),
      node('pressed', { replicaInfo: { master: 'base', inheritsFrom: 'mobile', overrides: { label: { _deleted: ['minWidth'] } } } }),
    ));
    const result = resolveSourceNode(graph, 'label', 'pressed');
    expect(result.properties.opacity).toBe(0.5);
    expect(result.properties).not.toHaveProperty('minWidth');
    expect(result.provenance).toEqual(['label', 'mobile', 'pressed']);
  });

  it('coalesces matching nested declarations but rejects conflicting duplicates', () => {
    const child = node('child');
    const input = transfer(node('scope', { children: [child] }), child);
    expect(buildSourceGraph(input).nodes.size).toBe(2);
    input.definitions[1].data = { ...child, opacity: 0 };
    expect(() => buildSourceGraph(input)).toThrow(/conflicting.*child/i);
  });

  it('finds transitive component, collection and provider dependencies without exporting unrelated declarations', () => {
    const input = transfer(node('page', { __class: 'WebPageNode', children: [node('instance', {
      __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/card:default',
      '$control__label': { value: { type: 'variableReference', providerId: 'collection', id: 'title' } },
    })] }), node('card', { __class: 'SmartComponentNode', children: [node('nested', { codeComponentIdentifier: 'local-module:canvasComponent/link:default' })] }),
    node('link', { __class: 'SmartComponentNode' }), node('collection', { __class: 'CollectionNode', children: [node('row', { __class: 'CollectionItemNode' })] }), node('unrelated'));
    const graph = buildSourceGraph(input);
    expect([...graph.reachable].sort()).toEqual(['page', 'instance', 'card', 'nested', 'link', 'collection', 'row'].sort());
    expect(graph.renderRootIds).toEqual(['page']);
    expect(graph.diagnostics).toEqual([]);
  });

  it('terminates recursive references, but rejects cyclic replica inheritance', () => {
    const graph = buildSourceGraph(transfer(node('a', { dataIdentifier: 'local-module:collection/b:default' }), node('b', { dataIdentifier: 'local-module:collection/a:default' })));
    expect(graph.reachable.size).toBe(2);
    const cyclic = buildSourceGraph(transfer(node('a', { replicaInfo: { master: 'b', overrides: {} } }), node('b', { replicaInfo: { master: 'a', overrides: {} } })));
    expect(() => resolveSourceNode(cyclic, 'a')).toThrow(/inheritance cycle/i);
  });

  it('reports missing dependencies and unknown classes with their source IDs', () => {
    const graph = buildSourceGraph(transfer(node('unknown', { __class: 'FutureMeshNode', codeComponentIdentifier: 'local-module:canvasComponent/missing:default', customFlag: false })));
    expect(graph.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SOURCE_KIND_UNSUPPORTED', sourceId: 'unknown', property: '__class' }),
      expect.objectContaining({ code: 'SOURCE_REFERENCE_MISSING', sourceId: 'unknown', property: 'codeComponentIdentifier' }),
    ]));
    expect(resolveSourceNode(graph, 'unknown').properties.customFlag).toBe(false);
  });

  it('allocates stable IDs independent of labels, traversal order or existing path collisions', () => {
    const input = transfer(node('a', { name: 'Кнопка' }), node('b', { name: 'Кнопка' }), node('c', { name: '../../x' }));
    input.rootIds = ['a', 'b', 'c'];
    const graph = buildSourceGraph(input);
    const first = allocateTargetIdentity(graph, new Set());
    const again = allocateTargetIdentity(buildSourceGraph({ ...input, definitions: [...input.definitions].reverse() }), new Set());
    expect(again).toEqual(first);
    expect(new Set(Object.values(first)).size).toBe(3);
    expect(Object.values(first).every(id => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id))).toBe(true);
    expect(Object.values(first).every(id => /^[a-z][a-z0-9-]*$/.test(id))).toBe(true);
    const reserved = new Set([`src/components/${first.a}.tsx`]);
    expect(allocateTargetIdentity(graph, reserved).a).not.toBe(first.a);
    expect(allocateTargetIdentity(graph, reserved)).toEqual(allocateTargetIdentity(graph, reserved));
  });

  it('uses raw editor IDs rather than stale clipboard renamedIds', () => {
    const graph = buildSourceGraph(transfer(node('original', { renamedIds: { original: 'clipboard-copy' } })));
    expect(graph.nodes.has('clipboard-copy')).toBe(false);
    expect(resolveSourceNode(graph, 'original').sourceId).toBe('original');
  });

  it('requires only the typography presets actually used by the rich text', () => {
    const input = transfer(node('label', { __class: 'RichTextNode',
      html: '<p data-styles-preset="body">Text</p>', stylePresetParagraph: 'body', stylePresetHeading1: 'unused',
    }), node('body', { __class: 'TextStylePresetNode' }));
    expect(buildSourceGraph(input).diagnostics).toEqual([]);
    input.definitions[0].data.html = '<h1 data-styles-preset="missing">Text</h1>';
    expect(buildSourceGraph(input).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SOURCE_REFERENCE_MISSING', sourceId: 'label', property: 'html' }),
    ]));
  });

  it('separates project declarations from render roots', () => {
    const input = transfer(node('page', { __class: 'WebPageNode' }), node('collections', { __class: 'ContentManagementNode' }));
    input.rootIds.push('collections');
    expect(buildSourceGraph(input).renderRootIds).toEqual(['page']);
    expect(buildSourceGraph(input).reachable.has('collections')).toBe(true);
  });

  it('rejects applying a state to a node outside its master subtree', () => {
    const graph = buildSourceGraph(transfer(node('base'), node('replica', { replicaInfo: { master: 'base', overrides: {} } }), node('unrelated')));
    expect(() => resolveSourceNode(graph, 'unrelated', 'replica')).toThrow(/outside.*master/i);
  });

  it('includes referenced color tokens and original code module metadata in a component closure', () => {
    const graph = buildSourceGraph(transfer(node('component', {
      fillColor: 'var(--token-black, rgb(0, 0, 0))', codeOverrideIdentifier: 'local-module:codeFile/source:BackToTop',
    }), node('black', { __class: 'ColorStyleTokenNode' }), node('codeFile/source', { __class: 'LocalModuleNode' })));
    expect([...graph.reachable].sort()).toEqual(['component', 'black', 'codeFile/source'].sort());
  });

  it('allows a deleted color token with an explicit CSS fallback, but requires a token without fallback', () => {
    const graph = buildSourceGraph(transfer(node('fallback', { fillColor: 'var(--token-deleted, rgb(0, 0, 0))' })));
    expect(graph.diagnostics).toEqual([]);
    expect(resolveSourceNode(graph, 'fallback').properties.fillColor).toBe('var(--token-deleted, rgb(0, 0, 0))');
    expect(buildSourceGraph(transfer(node('required', { fillColor: 'var(--token-missing)' }))).diagnostics).toEqual([
      expect.objectContaining({ code: 'SOURCE_REFERENCE_MISSING', sourceId: 'required' }),
    ]);
  });
  it('includes typography dependencies introduced only inside replica overrides', () => {
    const input = transfer(node('base'), node('large', { replicaInfo: { master: 'base', overrides: { base: { html: '<p data-styles-preset="heading">Large</p>' } } } }), node('heading', { __class: 'TextStylePresetNode' }));
    input.rootIds = ['large'];
    expect(buildSourceGraph(input).reachable.has('heading')).toBe(true);
  });
  it('allocates scoped field and prop identifiers centrally and maps a CMS slug to its native system field', () => {
    const input = transfer(node('collection', { __class: 'CollectionNode', variables: [{ id: 'title', type: 'string' }, { id: 'slug', type: 'slug' }] }), node('component', { __class: 'SmartComponentNode', variables: [{ id: 'title', type: 'string' }] }));
    input.rootIds.push('component');
    const graph = buildSourceGraph(input), identity = allocateTargetIdentity(graph, new Set());
    const field = identity[sourceVariableKey('collection', 'title')];
    expect(field).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    expect(identity[sourceVariableKey('component', 'title')]).not.toBe(field);
    expect(identity[sourceVariableKey('collection', 'slug')]).toBe('_slug');
  });
});
