import { describe, expect, it } from 'vitest';
import fixture from './fixtures/captured-components.json';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { mapSourceConnections, sourceStateNames } from './interactions';

describe('original component interaction graph', () => {
  it.each([false, true])('maps a pressed gesture with hover sibling %s through native interaction edges', withHover => {
    const data = { id: 'button', __class: 'SmartComponentNode', baseVariantId: 'base', children: [
      { id: 'base', __class: 'FrameNode', children: [] },
      ...(withHover ? [{ id: 'hover', __class: 'FrameNode', gesture: 'hover', children: [], replicaInfo: { master: 'base', overrides: {} } }] : []),
      { id: 'pressed', __class: 'FrameNode', gesture: 'pressed', children: [], replicaInfo: { master: 'base', overrides: {} } },
    ] };
    const graph = buildSourceGraph({ ...fixture, rootIds: ['button'], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set());
    const edges = mapSourceConnections({ graph, scopeId: 'button' }, identity);
    const parent = withHover ? identity.hover : 'default';
    expect(edges).toContainEqual({ from: parent, to: identity.pressed, trigger: 'clickStart' });
    expect(edges).toContainEqual({ from: identity.pressed, to: parent, trigger: 'click' });
    expect(edges).toHaveLength(withHover ? 4 : 2);
  });
  it('preserves every edge in the six-state Underline source, including delayed resets', () => {
    const graph = buildSourceGraph(fixture), identity = allocateTargetIdentity(graph, new Set());
    const names = sourceStateNames({ graph, scopeId: 'f03DgVEM5' }, identity);
    expect(names.q7dmakjiW).toBe('default');
    expect(new Set(Object.values(names)).size).toBe(6);
    const edges = mapSourceConnections({ graph, scopeId: 'f03DgVEM5' }, identity);
    expect(edges).toHaveLength(8);
    expect(edges.filter(edge => edge.trigger === 'afterDelay')).toEqual(expect.arrayContaining([
      expect.objectContaining({ delay: 0.3, pauseOffscreen: true }),
      expect.objectContaining({ delay: 0.6, pauseOffscreen: true }),
    ]));
  });
  it('keeps the five-state Project Card click, leave and reset graph', () => {
    const graph = buildSourceGraph(fixture), identity = allocateTargetIdentity(graph, new Set());
    const edges = mapSourceConnections({ graph, scopeId: 'ZfAw5qjTc' }, identity);
    expect(Object.keys(sourceStateNames({ graph, scopeId: 'ZfAw5qjTc' }, identity))).toHaveLength(5);
    expect(edges).toHaveLength(4);
    expect(edges).toEqual(expect.arrayContaining([expect.objectContaining({ trigger: 'click' }), expect.objectContaining({ trigger: 'mouseLeave' }), expect.objectContaining({ trigger: 'afterDelay', delay: 0.6 })]));
  });
  it('binds a child event to that child and rejects a missing target instead of losing the edge', () => {
    const copy = JSON.parse(JSON.stringify(fixture));
    const component = copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data;
    const child = component.children[0].children[0];
    child.onTap = [{ actionIdentifier: 'framer/useSetVariant', controls: { variantId: { value: 'yre4NRiTU' } } }];
    const graph = buildSourceGraph(copy), identity = allocateTargetIdentity(graph, new Set());
    const edges = mapSourceConnections({ graph, scopeId: component.id }, identity);
    expect(edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'default', trigger: 'click', sourceNode: identity[child.id] })]));
    child.onTap[0].controls.variantId.value = 'missing';
    expect(() => mapSourceConnections({ graph: buildSourceGraph(copy), scopeId: component.id }, identity)).toThrow(/missing.*target/i);
  });
  it('rejects unknown actions explicitly', () => {
    const copy = JSON.parse(JSON.stringify(fixture));
    copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data.children[0].onTap = [{ actionIdentifier: 'framer/futureAction' }];
    const graph = buildSourceGraph(copy);
    expect(() => mapSourceConnections({ graph, scopeId: 'f03DgVEM5' }, allocateTargetIdentity(graph, new Set()))).toThrow(/futureAction/);
  });
  it('turns an implicit source hover gesture into native enter/leave connections', () => {
    const copy = JSON.parse(JSON.stringify(fixture));
    copy.rootIds = ['f03DgVEM5'];
    const scope = copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data;
    scope.children = scope.children.slice(0, 2);
    scope.children[0].onMouseEnter = scope.children[0].onMouseLeave = scope.children[0].onTap = [];
    const hover = scope.children[1];
    hover.gesture = 'hover'; hover.replicaInfo.inheritsFrom = scope.children[0].id;
    hover.replicaInfo.overrides[scope.children[0].id].onAppear = [];
    const graph = buildSourceGraph(copy), identity = allocateTargetIdentity(graph, new Set());
    expect(mapSourceConnections({ graph, scopeId: scope.id }, identity)).toEqual([
      { from: 'default', to: identity[hover.id], trigger: 'mouseEnter' },
      { from: identity[hover.id], to: 'default', trigger: 'mouseLeave' },
    ]);
  });
});
