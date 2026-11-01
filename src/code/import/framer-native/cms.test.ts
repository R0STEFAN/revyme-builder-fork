import { describe, expect, it } from 'vitest';
import fixture from './fixtures/captured-cms.json';
import { allocateTargetIdentity, buildSourceGraph, sourceVariableKey } from './source-graph';
import { emitNativeCms, nativeCollectionSlug } from './cms';
import type { CollectionItem, CollectionSchema } from '../../../shared/types';

function assetMap(value: unknown, result: Record<string, string> = {}): Record<string, string> {
  if (typeof value === 'string' && value.startsWith('data:framer/asset-reference,')) result[value] = `/assets/${value.split(',')[1].split('?')[0]}`;
  else if (Array.isArray(value)) value.forEach(item => assetMap(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => assetMap(item, result));
  return result;
}
function compile(input: unknown = fixture) {
  const graph = buildSourceGraph(input), identity = allocateTargetIdentity(graph, new Set());
  return { graph, identity, result: emitNativeCms(graph, identity, { assets: assetMap(input) }) };
}
function rows(files: { path: string; code: string }[], slug: string): CollectionItem[] {
  return JSON.parse(files.find(file => file.path === `cms/${slug}.json`)!.code);
}
function schema(files: { path: string; code: string }[], slug: string): CollectionSchema {
  return JSON.parse(files.find(file => file.path === `cms/${slug}.schema.json`)!.code);
}

describe('automatic native CMS conversion', () => {
  it('emits all three collections and 20 records with all 31 references resolved', () => {
    const { graph, identity, result } = compile();
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(6);
    const ids = graph.byKind.get('CollectionNode')!;
    expect(ids.map(id => rows(result.files, nativeCollectionSlug(identity, id)).length)).toEqual([6, 6, 8]);
    let references = 0;
    for (const collectionId of ids) {
      const slug = nativeCollectionSlug(identity, collectionId);
      const fields = schema(result.files, slug).fields;
      for (const item of rows(result.files, slug)) for (const field of fields) {
        if (field.type !== 'reference' && field.type !== 'multi-reference') continue;
        const targets = field.type === 'multi-reference' ? item[field.id] ?? [] : item[field.id] ? [item[field.id]] : [];
        for (const target of targets) {
          references++;
          expect(rows(result.files, field.referenceCollection!).some(row => row._id === target)).toBe(true);
        }
      }
    }
    expect(references).toBe(31);
  });
  it('preserves explicit slugs, dates, false values and defaults; visible=false does not mean draft', () => {
    const { graph, identity, result } = compile();
    for (const id of graph.byKind.get('CollectionNode')!) {
      const collection = graph.nodes.get(id)!;
      const slug = nativeCollectionSlug(identity, id), data = rows(result.files, slug);
      for (const sourceId of collection.children) {
        const source = graph.nodes.get(sourceId)!.raw, item = data.find(row => row._id === identity[sourceId])!;
        expect(item._createdAt).toBe(source.createdAt);
        expect(item._updatedAt).toBe(source.updatedAt);
        expect(item._status).toBe('published');
        expect(item._slug).not.toBe('');
      }
    }
    const fields = schema(result.files, nativeCollectionSlug(identity, 'E5RT5hQRC')).fields;
    expect(fields.find(field => field.id === identity[sourceVariableKey('E5RT5hQRC', 'DBADIc0Pr')])?.defaultValue).toBe(false);
    expect(fields.find(field => field.id === identity[sourceVariableKey('E5RT5hQRC', 'bbxSFmOa_')])?.defaultValue).toBe('2025');
    expect(fields.some(field => field.type === 'slug')).toBe(false); // Native system _slug is edited by the CMS itself.
  });
  it('retains divider declarations and legacy control data as source provenance rather than inventing fields', () => {
    const { identity, result } = compile();
    const slug = nativeCollectionSlug(identity, 'E5RT5hQRC');
    const nativeSchema = JSON.parse(result.files.find(file => file.path === `cms/${slug}.schema.json`)!.code);
    expect(nativeSchema._framerSource.variables.filter((field: { type: string }) => field.type === 'divider')).toHaveLength(2);
    expect(nativeSchema.fields.some((field: { type: string }) => field.type === 'divider')).toBe(false);
    expect(rows(result.files, slug)[0]._framerSource.$control__HFVxWhkEG.value).toBe(8);
  });
  it('keeps explicit empty/null references and draft status without creating replacement values', () => {
    const copy = JSON.parse(JSON.stringify(fixture));
    const item = copy.definitions[0].data.children[0].children[0];
    item.$control__vIMaCfMOH.value = null;
    item.$control__U6zTElDqO.value = [];
    item.isDraft = true;
    const { identity, result } = compile(copy);
    const first = rows(result.files, nativeCollectionSlug(identity, 'E5RT5hQRC'))[0];
    expect(first[identity[sourceVariableKey('E5RT5hQRC', 'vIMaCfMOH')]]).toBeNull();
    expect(first[identity[sourceVariableKey('E5RT5hQRC', 'U6zTElDqO')]]).toEqual([]);
    expect(first._status).toBe('draft');
  });
  it('rejects a broken reference atomically and leaves the input untouched', () => {
    const copy = JSON.parse(JSON.stringify(fixture));
    copy.definitions[0].data.children[0].children[0].$control__vIMaCfMOH.value = 'missing-record';
    const before = JSON.stringify(copy);
    const { result } = compile(copy);
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_CMS_INVALID' })]));
    expect(JSON.stringify(copy)).toBe(before);
  });
  it('does not invent asset URLs or localized data that were not supplied by a source adapter', () => {
    const graph = buildSourceGraph(fixture), identity = allocateTargetIdentity(graph, new Set());
    expect(emitNativeCms(graph, identity).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_CMS_INVALID' })]));
    expect(emitNativeCms(graph, identity, { assets: assetMap(fixture), locale: 'uk', defaultLocale: 'en' }).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_CMS_LOCALE_UNAVAILABLE' })]));
  });
  it('uses the same rules after all collection/field/row IDs and collection names are replaced', () => {
    const original = JSON.parse(JSON.stringify(fixture));
    const identifiers = new Map<string, string>();
    const collect = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') { const object = value as Record<string, unknown>; if (typeof object.id === 'string' && !identifiers.has(object.id)) identifiers.set(object.id, `replacement${identifiers.size}`); Object.values(object).forEach(collect); }
    };
    collect(original.definitions);
    const rename = (value: unknown): unknown => {
      if (typeof value === 'string') return identifiers.get(value) ?? value.replace(/local-module:collection\/([^:]+):/g, (_match, id) => `local-module:collection/${identifiers.get(id) ?? id}:`);
      if (Array.isArray(value)) return value.map(rename);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.startsWith('$control__') ? `$control__${identifiers.get(key.slice(10)) ?? key.slice(10)}` : key, rename(item)]));
      return value;
    };
    const renamed = rename(original) as typeof original;
    renamed.definitions[0].data.children.forEach((collection: { name: string }, index: number) => collection.name = `Колекція ${index}`);
    const { graph, identity, result } = compile(renamed);
    expect(result.diagnostics).toEqual([]);
    expect(graph.byKind.get('CollectionNode')!.map(id => rows(result.files, nativeCollectionSlug(identity, id)).length)).toEqual([6, 6, 8]);
  });
});
