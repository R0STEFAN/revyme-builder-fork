import { trace } from '../../../shared/debug-trace';
import { mapSourceTypography, nativeTypographyGroup, sourceTypographySuffixes } from './text';
import { sourceRecord } from './source-graph';
import type { SourceGraph, TransferDiagnostic } from './types';
import type { FramerTypographyToken } from '../../generation/framer-typography-gen';

/** One native Typography group per source master; replica states are handled separately. */
export function sourceTypographyTokens(graph: SourceGraph, identity: Record<string, string>): { tokens: FramerTypographyToken[]; diagnostics: TransferDiagnostic[] } {
  trace.fn('framer-native.sourceTypographyTokens', { count: graph.byKind.get('TextStylePresetNode')?.length ?? 0 });
  const tokens: FramerTypographyToken[] = [], diagnostics: TransferDiagnostic[] = [];
  for (const id of graph.byKind.get('TextStylePresetNode') ?? []) {
    if (!graph.reachable.has(id) || sourceRecord(graph.nodes.get(id)!.raw.replicaInfo)?.master) continue;
    const node = graph.nodes.get(id)!, group = nativeTypographyGroup(graph, identity, id);
    if (!identity[id]) { diagnostics.push({ code: 'SOURCE_TYPOGRAPHY_IDENTITY_MISSING', sourceId: id, message: 'Typography preset has no native identity.' }); continue; }
    const styles = mapSourceTypography(node.raw);
    if (!styles.fontFamily) { diagnostics.push({ code: 'SOURCE_TYPOGRAPHY_ADAPTER_REQUIRED', sourceId: id, message: 'Typography preset needs a native font.' }); continue; }
    const tag = node.raw.tag;
    if (typeof tag === 'string' && /^(?:p|h[1-6])$/.test(tag)) tokens.push({ name: `typo-${group}-tag`, value: tag });
    for (const [property, suffix] of Object.entries(sourceTypographySuffixes)) if (styles[property] !== undefined) tokens.push({ name: `typo-${group}-${suffix}`, value: styles[property].replace(/\s*\/\*[\s\S]*?\*\//g, '').trim() });
  }
  return { tokens, diagnostics };
}
