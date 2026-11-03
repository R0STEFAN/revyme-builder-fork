import { trace } from '../../../shared/debug-trace';
import { TRANSPARENT_FILL } from '../../../shared/css-utils';
import type { OverlayConfig, OverlayTriggerConfig } from '../../../shared/types';
import { reattachPastedOverlayInCode, updateOverlayConfigInCode } from '../../generation/overlay-gen';
import { addCloseOverlayInCode } from '../../generation/close-overlay-gen';
import { nativePropName } from './components';
import { sourceStateNames } from './interactions';
import { isSourceCodeComponent, resolveSourceNode, sourceRecord, sourceVariables } from './source-graph';
import { sourceTransitionSpec } from './effects';
import type { SourceGraph } from './types';

export function sourceShowOverlayTarget(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 1) return;
  const action = sourceRecord(value[0]);
  if (action?.actionIdentifier !== 'framer/useShowOverlay') return;
  const controls = sourceRecord(action.controls), overlay = sourceRecord(controls?.overlay);
  if (!controls || Object.keys(controls).some(key => key !== 'overlay') || overlay?.type !== 'string' || typeof overlay.value !== 'string' || !overlay.value || Object.entries(sourceRecord(action.meta) ?? {}).some(([key, value]) => key !== 'delay' || value !== 0)) throw new Error('Unsupported overlay show action');
  return overlay.value;
}

/** Rebuild captured modal subtrees through the editor's ordinary overlay writer. */
export function applySourceOverlays(code: string, sourceIds: string[], graph: SourceGraph, identity: Record<string, string>, states: { sourceStateId: string; width: number }[], primaryWidth: number): { code: string; handled: Set<string> } {
  trace.fn('framer-native.applyOverlays', { nodes: sourceIds.length });
  const handled = new Set<string>(), triggers = new Map<string, { id: string; config: OverlayTriggerConfig }>();
  const overlays = sourceIds.filter(id => graph.nodes.get(id)!.kind === 'OverlayNode');
  const register = (target: string, id: string, property: string, config: OverlayTriggerConfig) => {
    if (!overlays.includes(target)) throw new Error(`Source overlay target ${target} is missing from the rendered scope`);
    if (triggers.has(target) || [...triggers.values()].some(trigger => trigger.id === id)) throw new Error(`Multiple overlay triggers on ${id} require their native composition adapter`);
    triggers.set(target, { id, config });
    handled.add(`${id}:${property}`);
  };
  for (const id of sourceIds) {
    const node = resolveSourceNode(graph, id);
    if (isSourceCodeComponent(node)) continue;
    for (const [key, value] of Object.entries(node.properties)) {
      if (key === 'onTap') {
        const target = sourceShowOverlayTarget(value);
        if (target) register(target, id, key, { targetId: identity[target], trigger: 'click', dismiss: 'outside' });
      }
      if (!key.startsWith('$control__') || node.kind !== 'CodeComponentNode') continue;
      const master = /^local-module:canvasComponent\/([^:]+):/.exec(String(node.properties.codeComponentIdentifier))?.[1];
      const prop = key.slice(10);
      if (!master || !sourceVariables(graph, master).some(variable => variable.id === prop && variable.type === 'eventhandler')) continue;
      const target = sourceShowOverlayTarget(sourceRecord(value)?.value);
      if (!target) continue;
      register(target, id, key, { targetId: identity[target], trigger: 'event', eventName: nativePropName(identity, master, prop), dismiss: 'outside' });
    }
  }
  for (const id of sourceIds) {
    const node = resolveSourceNode(graph, id);
    if (!isSourceCodeComponent(node) && node.properties.whileOpenEffectEnabled === true && ![...triggers.values()].some(trigger => trigger.id === id)) throw new Error(`Source overlay on-open effect on ${id} has no supported trigger`);
  }
  let result = code;
  for (const id of overlays) {
    const p = resolveSourceNode(graph, id).properties, trigger = triggers.get(id);
    if (!trigger) throw new Error(`Source overlay ${id} has no supported trigger`);
    let ancestor = p.parentid;
    const ancestors = new Set<string>();
    while (typeof ancestor === 'string' && !ancestors.has(ancestor)) {
      if (overlays.includes(ancestor)) throw new Error(`Nested source overlay ${id} requires its native stacking adapter`);
      ancestors.add(ancestor); ancestor = graph.nodes.get(ancestor)?.raw.parentid;
    }
    const known = new Set(['__class', 'id', 'parentid', 'children', 'name', 'visible', 'originalid', 'duplicatedFrom', 'isMaster', 'isExternalMaster', 'replicaInfo', 'zIndex', 'backdropDismissible', 'backdropFillEnabled', 'backdropFill', 'blockDocumentScrolling', 'backdropTransitionLocked', 'backdropEnterTransition', 'backdropExitTransition']);
    if (Object.keys(p).some(key => !known.has(key)) || p.visible === false || ['backdropDismissible', 'backdropFillEnabled', 'blockDocumentScrolling'].some(key => typeof p[key] !== 'boolean')) throw new Error(`Source overlay ${id} requires its native modal configuration adapter`);
    const triggerNode = resolveSourceNode(graph, trigger.id);
    for (const state of states) {
      const other = resolveSourceNode(graph, id, state.sourceStateId).properties;
      const sourceTrigger = resolveSourceNode(graph, trigger.id, state.sourceStateId).properties;
      for (const property of [...known].filter(key => key.startsWith('backdrop') || ['blockDocumentScrolling', 'visible', 'zIndex'].includes(key))) if (JSON.stringify(p[property]) !== JSON.stringify(other[property])) throw new Error(`Responsive overlay ${id} configuration requires its native adapter`);
      if (sourceTrigger.whileOpenEffectEnabled !== triggerNode.properties.whileOpenEffectEnabled) throw new Error(`Responsive overlay ${id} on-open activation requires its native adapter`);
    }
    const fill = p.backdropFillEnabled ? p.backdropFill === 'transparent' ? TRANSPARENT_FILL : p.backdropFill : TRANSPARENT_FILL;
    if (typeof fill !== 'string' || /['<>\r\n]/.test(fill) || p.zIndex !== undefined && (typeof p.zIndex !== 'number' || !Number.isFinite(p.zIndex))) throw new Error(`Invalid source overlay ${id} fill/stacking`);
    const config: OverlayConfig = { type: 'fixed', triggerId: identity[trigger.id], side: 'bottom', align: 'start', offsetX: 0, offsetY: 0, fill, dismissible: p.backdropDismissible as boolean, pageScroll: p.blockDocumentScrolling ? 'block' : 'auto', ...(p.zIndex === undefined ? {} : { zIndex: p.zIndex as number }), ...(typeof p.backdropTransitionLocked === 'boolean' ? { easingLinked: p.backdropTransitionLocked } : {}), enterTransition: sourceTransitionSpec(p.backdropEnterTransition), exitTransition: sourceTransitionSpec(p.backdropTransitionLocked ? p.backdropEnterTransition : p.backdropExitTransition) };
    result = reattachPastedOverlayInCode(result, identity[trigger.id], identity[id], config, trigger.config);
    if (triggerNode.properties.whileOpenEffectEnabled === true) {
      const master = /^local-module:canvasComponent\/([^:]+):/.exec(String(triggerNode.properties.codeComponentIdentifier))?.[1];
      const variant = master && sourceStateNames({ graph, scopeId: master }, identity)[String(triggerNode.properties.whileOpenEffectVariant)];
      if (!variant) throw new Error(`Missing overlay on-open variant on ${trigger.id}`);
      result = updateOverlayConfigInCode(result, identity[id], { onOpenVariant: variant }, null);
      for (const state of states) {
        const source = resolveSourceNode(graph, trigger.id, state.sourceStateId).properties;
        const target = sourceStateNames({ graph, scopeId: master! }, identity)[String(source.whileOpenEffectVariant)];
        if (!target) throw new Error(`Missing responsive overlay on-open variant on ${trigger.id}`);
        if (target !== variant) result = updateOverlayConfigInCode(result, identity[id], { onOpenVariant: target }, state.width, [], [primaryWidth, ...states.map(item => item.width)]);
      }
    }
  }
  for (const id of sourceIds) {
    const node = resolveSourceNode(graph, id);
    if (isSourceCodeComponent(node)) continue;
    const actions = node.properties.onTap;
    if (!Array.isArray(actions) || actions.length !== 1 || sourceRecord(actions[0])?.actionIdentifier !== 'framer/useDismissOverlay') continue;
    const action = sourceRecord(actions[0])!;
    if (Object.keys(sourceRecord(action.controls) ?? {}).length || Object.entries(sourceRecord(action.meta) ?? {}).some(([key, value]) => key !== 'delay' || value !== 0)) throw new Error(`Source overlay dismiss on ${id} requires its native action adapter`);
    let parent = node.properties.parentid;
    const seen = new Set<string>();
    while (typeof parent === 'string' && !overlays.includes(parent) && !seen.has(parent)) { seen.add(parent); parent = graph.nodes.get(parent)?.raw.parentid; }
    if (typeof parent !== 'string' || !overlays.includes(parent)) throw new Error(`Source overlay dismiss on ${id} has no enclosing overlay`);
    result = addCloseOverlayInCode(result, identity[id], 'click', identity[parent]);
    handled.add(`${id}:onTap`);
  }
  return { code: result, handled };
}
