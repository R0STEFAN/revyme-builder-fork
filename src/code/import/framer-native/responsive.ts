import { normalizeTransparent } from '../../../shared/css-utils';
import { trace } from '../../../shared/debug-trace';
import type { ViewportConfig } from '../../../shared/types';
import { CSS_NEUTRAL_FALLBACK, updateContainerQueryStyle } from '../../generation/generator-styles';
import { updateCanvasConfigInCode } from '../../project/canvas-config';
import { isSourceCodeComponent, resolveSourceNode } from './source-graph';
import { mapSourceStyles, mappingDiagnostic, type SourceMappingContext } from './styles';
import type { ResolvedSourceNode, SourceGraph } from './types';

export interface SourceViewport extends ViewportConfig { sourceStateId: string }
export function sourceViewports(graph: SourceGraph, scopeId: string): SourceViewport[] {
  trace.fn('framer-native.sourceViewports', { scopeId });
  const scope = graph.nodes.get(scopeId);
  if (!scope) throw new Error(`FRAMER_SOURCE_INVALID: missing scope ${scopeId}`);
  const states = scope.children.map(id => resolveSourceNode(graph, id));
  states.sort((a, b) => Number(b.properties.width) - Number(a.properties.width));
  if (!states.length || states.some(state => typeof state.properties.width !== 'number' || state.properties.width <= 0)) throw new Error(`FRAMER_SOURCE_INVALID: invalid breakpoint widths in ${scopeId}`);
  if (new Set(states.map(state => state.properties.width)).size !== states.length) throw new Error(`FRAMER_SOURCE_INVALID: duplicate breakpoint widths in ${scopeId}`);
  return states.map((state, index) => ({
    sourceStateId: state.id, id: `framer-vp-${index}`, label: String(state.properties.name ?? `Breakpoint ${index + 1}`),
    width: index === 0 ? Number(state.properties.width) : Number(states[index - 1].properties.width) - 1,
    designWidth: Number(state.properties.width), isPrimary: index === 0, order: index,
    height: 'auto', x: Number(state.properties.left ?? 0), y: Number(state.properties.top ?? 0),
  }));
}

export function applyNativeResponsive(code: string, model: { graph: SourceGraph; scopeId: string; context: SourceMappingContext; stylesFor?: (node: ResolvedSourceNode, context: SourceMappingContext) => Record<string, string> }, identity: Record<string, string>): string {
  trace.fn('framer-native.applyNativeResponsive', { scopeId: model.scopeId });
  const { graph, context } = model;
  const viewports = sourceViewports(graph, model.scopeId);
  const positions = Object.fromEntries(viewports.map(viewport => {
    const source = graph.nodes.get(viewport.sourceStateId)!.raw;
    return [viewport.id, { x: Number(source.left ?? 0), y: Number(source.top ?? 0) }];
  }));
  let result = updateCanvasConfigInCode(code, { viewports, positions });
  const baseRoot = resolveSourceNode(graph, viewports[0].sourceStateId);
  const stylesFor = model.stylesFor ?? mapSourceStyles;
  const walk = (id: string, parentId?: string) => {
    const base = resolveSourceNode(graph, id);
    const baseParent = parentId ? resolveSourceNode(graph, parentId) : undefined;
    const baseStyles = stylesFor(base, { ...context, parent: baseParent, graph, viewport: { width: viewports[0].designWidth! } });
    for (const viewport of viewports.slice(1)) {
      const state = resolveSourceNode(graph, id, viewport.sourceStateId);
      const parent = parentId ? resolveSourceNode(graph, parentId, viewport.sourceStateId) : undefined;
      const styles = stylesFor(state, { ...context, graph, parent, viewport: { width: viewport.designWidth! } });
      const changes: Record<string, string> = {};
      for (const key of new Set([...Object.keys(baseStyles), ...Object.keys(styles)])) {
        if (styles[key] !== baseStyles[key]) changes[key] = styles[key] ?? CSS_NEUTRAL_FALLBACK[key] ?? 'initial';
      }
      if (parent && baseParent && parent.children.join(',') !== baseParent.children.join(',')) changes.order = String(parent.children.indexOf(id));
      if (Object.values(changes).some(value => /^\{/.test(value))) mappingDiagnostic(context, state, 'responsiveBinding', 'SOURCE_RESPONSIVE_BINDING_UNSUPPORTED');
      if (!identity[id]) mappingDiagnostic(context, state, 'identity', 'SOURCE_IDENTITY_MISSING');
      else if (Object.keys(changes).length) result = updateContainerQueryStyle(result, identity[id], viewport.width, normalizeTransparent(changes), { viewportWidths: viewports.map(v => v.width) });
    }
    if (!isSourceCodeComponent(base)) for (const child of base.children) walk(child, id);
  };
  walk(baseRoot.sourceId);
  return result;
}
