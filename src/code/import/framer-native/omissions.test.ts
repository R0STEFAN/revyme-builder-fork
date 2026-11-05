import { expect, it } from 'vitest';
import { buildSourceGraph } from './source-graph';
import { omitNativeSourceFeatures } from './omissions';

function capturedPage() {
  const filter = { itemKey: 'category', transforms: [{ name: 'equals', value: { type: 'variableReference', providerId: 'works', id: 'categoryVar' } }] };
  const data = { id: 'works', __class: 'WebPageNode', baseVariantId: 'desktop', variables: [{ id: 'categoryVar', name: 'Category', type: 'collectionreference', optional: true, dataIdentifier: 'local-module:collection/categories:default' }], children: [
    { id: 'desktop', __class: 'FrameNode', width: 1200, widthType: 0, children: [
      { id: 'list', __class: 'FrameNode', parentid: 'desktop', dataIdentifier: 'local-module:collection/posts:default', collectionFilters: { filters: [filter] }, children: [] },
      { id: 'cursor', __class: 'FrameNode', parentid: 'desktop', customCursorType: 'component', customCursorSmartComponentId: 'missing-cursor', children: [] },
    ] },
  ] };
  return { format: 'revyme.framer.native', version: 1, context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'works', mode: 'page' }, complete: true, diagnostics: [], rootIds: ['works'], definitions: [data, { id: 'posts', __class: 'CollectionNode', variables: [], children: [] }, { id: 'categories', __class: 'CollectionNode', variables: [], children: [] }].map(node => ({ id: node.id, kind: node.__class, data: node })), assets: [] };
}

it('omits only the user-approved filter and cursor, reports each, and keeps the captured source intact', () => {
  const original = capturedPage(), before = JSON.stringify(original);
  expect((original.definitions[0].data as any).children[0].children[1].customCursorSmartComponentId).toBe('missing-cursor');
  const { transfer, omissions } = omitNativeSourceFeatures(original, { pageReferenceFilters: true, customCursors: true });
  expect(JSON.stringify(original)).toBe(before);
  expect(buildSourceGraph(transfer).diagnostics).toEqual([]);
  const page = transfer.definitions[0].data as any;
  expect(page.variables).toEqual([]);
  expect(page.children[0].children[0].collectionFilters.filters).toEqual([]);
  expect(page.children[0].children[1].customCursorType).toBeUndefined();
  expect(omissions.map(item => item.property)).toEqual(expect.arrayContaining(['collectionFilters', 'variables.categoryVar', 'customCursor']));
});

it('refuses to drop a page variable that also drives live content', () => {
  const source = capturedPage(), page = source.definitions[0].data as any;
  page.children[0].children.push({ id: 'label', __class: 'RichTextNode', textContent: { type: 'variableReference', providerId: 'works', id: 'categoryVar' }, children: [] });
  expect(() => omitNativeSourceFeatures(source, { pageReferenceFilters: true })).toThrow(/active uses outside/);
});
