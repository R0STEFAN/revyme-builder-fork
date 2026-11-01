import { trace } from '../../../shared/debug-trace';
import type { Connection, ConnectionTrigger } from '../../variants/connection-config';
import { resolveSourceNode, sourceRecord } from './source-graph';
import type { SourceGraph } from './types';

export interface SourceComponent { graph: SourceGraph; scopeId: string }
export function sourceStateNames(component: SourceComponent, identity: Record<string, string>): Record<string, string> {
  const scope = component.graph.nodes.get(component.scopeId);
  if (!scope || scope.kind !== 'SmartComponentNode') throw new Error(`FRAMER_COMPONENT_INVALID: missing component ${component.scopeId}`);
  const primary = typeof scope.raw.baseVariantId === 'string' ? scope.raw.baseVariantId : scope.children[0];
  if (!primary || !scope.children.includes(primary)) throw new Error(`FRAMER_COMPONENT_INVALID: missing primary state ${component.scopeId}`);
  return Object.fromEntries(scope.children.map(id => {
    if (!identity[id]) throw new Error(`FRAMER_COMPONENT_INVALID: missing state identity ${id}`);
    return [id, id === primary ? 'default' : identity[id]];
  }));
}
const triggers: Record<string, ConnectionTrigger> = {
  onTap: 'click', onTapStart: 'clickStart', onMouseEnter: 'mouseEnter',
  onMouseLeave: 'mouseLeave', onAppear: 'afterDelay',
};

export function mapSourceConnections(component: SourceComponent, identity: Record<string, string>): Connection[] {
  trace.fn('framer-native.mapSourceConnections', { scopeId: component.scopeId });
  const names = sourceStateNames(component, identity);
  const result: Connection[] = [];
  const { graph } = component;
  for (const [stateId, from] of Object.entries(names)) {
    const root = resolveSourceNode(graph, stateId);
    const walk = (id: string) => {
      const node = resolveSourceNode(graph, id, stateId === root.sourceId ? undefined : stateId);
      for (const [event, value] of Object.entries(node.properties)) {
        if (!/^on[A-Z]/.test(event) || !Array.isArray(value) || value.length === 0) continue;
        if (!triggers[event]) throw new Error(`FRAMER_ACTION_UNSUPPORTED: ${event} on ${id}`);
        for (const raw of value) {
          const action = sourceRecord(raw);
          if (!action) throw new Error(`FRAMER_ACTION_INVALID: ${event} on ${id}`);
          // Event forwarding is emitted separately as a native callback prop.
          if (action.actionIdentifier === 'framer/useTriggerEvent') continue;
          if (action.actionIdentifier !== 'framer/useSetVariant') throw new Error(`FRAMER_ACTION_UNSUPPORTED: ${String(action.actionIdentifier)} on ${id}`);
          const controls = sourceRecord(action.controls);
          const type = sourceRecord(controls?.type)?.value ?? 'set';
          if (type !== 'set') throw new Error(`FRAMER_ACTION_UNSUPPORTED: variant ${String(type)} on ${id}`);
          const target = sourceRecord(controls?.variantId)?.value;
          if (typeof target !== 'string' || !names[target]) throw new Error(`FRAMER_ACTION_INVALID: missing variant target ${String(target)} on ${id}`);
          const delay = sourceRecord(action.meta)?.delay;
          if (delay !== undefined && (typeof delay !== 'number' || delay < 0 || !Number.isFinite(delay))) throw new Error(`FRAMER_ACTION_INVALID: delay on ${id}`);
          const connection: Connection = { from, to: names[target], trigger: triggers[event] };
          if (typeof delay === 'number') connection.delay = delay;
          if (id !== root.sourceId) connection.sourceNode = identity[id];
          if (event === 'onAppear') connection.pauseOffscreen = sourceRecord(controls?.pauseOffscreen)?.value !== false;
          result.push(connection);
        }
      }
      node.children.forEach(walk);
    };
    walk(root.sourceId);
  }
  for (const [stateId, to] of Object.entries(names)) {
    const raw = graph.nodes.get(stateId)!.raw;
    if (!raw.gesture) continue;
    if (raw.gesture !== 'hover') throw new Error(`FRAMER_ACTION_UNSUPPORTED: gesture ${String(raw.gesture)} on ${stateId} requires its native interaction adapter`);
    const replica = sourceRecord(raw.replicaInfo);
    const parent = names[String(replica?.inheritsFrom ?? replica?.master)];
    if (!parent) throw new Error(`FRAMER_ACTION_INVALID: missing gesture parent on ${stateId}`);
    const edges: Connection[] = [{ from: parent, to, trigger: 'mouseEnter' }, { from: to, to: parent, trigger: 'mouseLeave' }];
    for (const edge of edges) {
      const existing = result.find(candidate => candidate.from === edge.from && candidate.trigger === edge.trigger && !candidate.sourceNode);
      if (existing && existing.to !== edge.to) throw new Error(`FRAMER_ACTION_UNSUPPORTED: gesture/action conflict on ${stateId}`);
      if (!existing) result.push(edge);
    }
  }
  return result;
}
