import { describe, expect, it } from 'vitest';
import cms from './fixtures/captured-cms.json';
import components from './fixtures/captured-components.json';
import { allocateTargetIdentity, buildSourceGraph, sourceVariableKey } from './source-graph';
import { resolveSourceBinding, resolveSourceQuery } from './bindings';
import { nativePropName } from './components';

function context(extraDefinitions: { id: string; kind: string; data: Record<string, unknown> }[] = []) {
  const graph = buildSourceGraph({ ...cms, rootIds: [...cms.rootIds, 'ZfAw5qjTc', ...extraDefinitions.map(node => node.id)], definitions: [...cms.definitions, ...components.definitions, ...extraDefinitions] });
  return { graph, identity: allocateTargetIdentity(graph, new Set()) };
}
const provider = (id: string, collectionId: string, extra = {}) => ({ id, kind: 'FrameNode', data: { id, __class: 'FrameNode', children: [], dataIdentifier: `local-module:collection/${collectionId}:default`, ...extra } });

describe('source data bindings', () => {
  it.each([0, false, '', null])('preserves literal %s without replacing it with preview text', value => {
    expect(resolveSourceBinding(value, context())).toEqual({ kind: 'literal', value });
  });
  it('resolves the real nested Category provider to its native field and scope', () => {
    const ctx = context();
    const binding = resolveSourceBinding({ type: 'variableReference', providerId: 'xmUkU_AV5', id: 'nTU4ZCwmq' }, { ...ctx, nodeId: 'Raj6ATn3j' });
    expect(binding).toMatchObject({ kind: 'field', providerId: 'xmUkU_AV5', collectionId: 'DwP_tmnNO', fieldId: ctx.identity[sourceVariableKey('DwP_tmnNO', 'nTU4ZCwmq')] });
  });
  it('resolves a component reference variable by its centralized identity', () => {
    const ctx = context();
    expect(resolveSourceBinding({ type: 'variableReference', providerId: 'ZfAw5qjTc', id: 'Sj_xvP4fy' }, ctx)).toMatchObject({ kind: 'variable', providerId: 'ZfAw5qjTc', name: nativePropName(ctx.identity, 'ZfAw5qjTc', 'Sj_xvP4fy'), valueType: 'collectionreference' });
  });
  it('retains isSet as a typed transform instead of baking its current result', () => {
    const ctx = context([provider('list', 'E5RT5hQRC')]);
    const binding = resolveSourceBinding({ type: 'computedValue', outputType: 'boolean', startValue: { type: 'variableReference', providerId: 'list', id: 'rzoGppeEU' }, transforms: [{ type: 'valueTransform', name: 'isSet' }] }, ctx);
    expect(binding).toMatchObject({ kind: 'transform', name: 'isSet', input: { kind: 'field', valueType: 'file', fieldId: ctx.identity[sourceVariableKey('E5RT5hQRC', 'rzoGppeEU')] } });
  });
  it('maps the featured boolean filter and the dynamic category filter to separate native predicates', () => {
    const ctx = context([provider('featured', 'E5RT5hQRC', { collectionFilters: { filters: [{ itemKey: 'DBADIc0Pr', transforms: [] }] }, collectionLimit: 2 })]);
    expect(resolveSourceQuery('featured', ctx)).toMatchObject({ collectionId: 'E5RT5hQRC', limit: 2, predicates: [{ kind: 'transform', name: 'equals', input: { kind: 'field', fieldId: ctx.identity[sourceVariableKey('E5RT5hQRC', 'DBADIc0Pr')] }, argument: { kind: 'literal', value: true } }] });
    expect(resolveSourceQuery('xmUkU_AV5', ctx)).toMatchObject({ collectionId: 'DwP_tmnNO', predicates: [{ kind: 'transform', name: 'equals', input: { fieldId: '_id' }, argument: { kind: 'variable', providerId: 'ZfAw5qjTc' } }] });
  });
  it('does not confuse nested repeaters or permit an out-of-scope provider', () => {
    const ctx = context([provider('outer', 'E5RT5hQRC', { children: [{ id: 'inner', __class: 'FrameNode', dataIdentifier: 'local-module:collection/DwP_tmnNO:default', parentid: 'outer', children: [{ id: 'leaf', __class: 'RichTextNode', parentid: 'inner', children: [] }] }] }), provider('unrelated', 'E5RT5hQRC')]);
    const outer = resolveSourceBinding({ type: 'variableReference', providerId: 'outer', id: 'WzsCxsMgh' }, { ...ctx, nodeId: 'leaf' });
    const inner = resolveSourceBinding({ type: 'variableReference', providerId: 'inner', id: 'nTU4ZCwmq' }, { ...ctx, nodeId: 'leaf' });
    expect(outer.kind === 'field' && inner.kind === 'field' && outer.itemVar !== inner.itemVar).toBe(true);
    expect(() => resolveSourceBinding({ type: 'variableReference', providerId: 'unrelated', id: 'WzsCxsMgh' }, { ...ctx, nodeId: 'leaf' })).toThrow(/scope/i);
  });
  it('rejects a missing field, unknown transform or unavailable locale explicitly', () => {
    const ctx = context([provider('list', 'E5RT5hQRC')]);
    expect(() => resolveSourceBinding({ type: 'variableReference', providerId: 'list', id: 'absent' }, ctx)).toThrow(/field/i);
    expect(() => resolveSourceBinding({ type: 'computedValue', startValue: 'x', transforms: [{ name: 'futureTransform' }] }, ctx)).toThrow(/futureTransform/);
    expect(() => resolveSourceBinding({ type: 'variableReference', providerId: 'list', id: 'WzsCxsMgh' }, { ...ctx, locale: 'uk', defaultLocale: 'en' })).toThrow(/locale/i);
  });
  it.each([null, '', []])('keeps explicit empty reference %s in its native form', value => {
    expect(resolveSourceBinding(value, { ...context(), referenceCollectionId: 'DwP_tmnNO' })).toMatchObject({ kind: 'reference', rowId: value });
  });
});
