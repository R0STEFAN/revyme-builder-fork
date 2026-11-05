import { trace } from '../../../shared/debug-trace';
import { mapSourceTypography, nativeTypographyGroup, sourceTypographySuffixes } from './text';
import { sourceRecord } from './source-graph';
import type { SourceGraph, TransferDiagnostic } from './types';
import type { FramerTypographyToken } from '../../generation/framer-typography-gen';

/** One native Typography group per source master; replica states are handled separately. */
export function sourceTypographyTokens(graph: SourceGraph, identity: Record<string, string>): { tokens: FramerTypographyToken[]; diagnostics: TransferDiagnostic[] } {
  trace.fn('framer-native.sourceTypographyTokens', { count: graph.byKind.get('TextStylePresetNode')?.length ?? 0 });
  const tokens: FramerTypographyToken[] = [], diagnostics: TransferDiagnostic[] = [];
  const presetNodes = graph.byKind.get('TextStylePresetNode') ?? [];
  for (const id of presetNodes) {
    if (!graph.reachable.has(id) || sourceRecord(graph.nodes.get(id)!.raw.replicaInfo)?.master) continue;
    const node = graph.nodes.get(id)!, group = nativeTypographyGroup(graph, identity, id);
    if (!identity[id]) { diagnostics.push({ code: 'SOURCE_TYPOGRAPHY_IDENTITY_MISSING', sourceId: id, message: 'Typography preset has no native identity.' }); continue; }
    const styles = mapSourceTypography(node.raw);
    if (!styles.fontFamily) { diagnostics.push({ code: 'SOURCE_TYPOGRAPHY_ADAPTER_REQUIRED', sourceId: id, message: 'Typography preset needs a native font.' }); continue; }
    const tag = node.raw.tag;
    if (typeof tag === 'string' && /^(?:p|h[1-6])$/.test(tag)) tokens.push({ name: `typo-${group}-tag`, value: tag });
    for (const [property, suffix] of Object.entries(sourceTypographySuffixes)) if (styles[property] !== undefined) tokens.push({ name: `typo-${group}-${suffix}`, value: styles[property].replace(/\s*\/\*[\s\S]*?\*\//g, '').trim() });

    // Look for responsive replicas sharing this master
    const replicas = presetNodes
      .filter(repId => graph.reachable.has(repId) && sourceRecord(graph.nodes.get(repId)!.raw.replicaInfo)?.master === id)
      .map(repId => {
        const repNode = graph.nodes.get(repId)!;
        const overrides = sourceRecord(sourceRecord(repNode.raw.replicaInfo)?.overrides);
        const targetOverride = sourceRecord(overrides?.[id]);
        const bp = Number(targetOverride?.breakpointWidth ?? repNode.raw.breakpointWidth ?? 0);
        return { node: repNode, bpWidth: bp };
      })
      .sort((a, b) => b.bpWidth - a.bpWidth);

    if (replicas.length > 0) {
      const tabletBp = replicas.find(r => r.bpWidth > 810 && r.bpWidth <= 1200)?.bpWidth ?? 1200;
      const mobileBp = replicas.find(r => r.bpWidth <= 810)?.bpWidth ?? 810;
      tokens.push({ name: `typo-${group}-min-default`, value: String(tabletBp) });
      tokens.push({ name: `typo-${group}-min-md`, value: String(mobileBp) });

      const tablet = replicas.find(r => r.bpWidth > 810 && r.bpWidth <= 1200) ?? (replicas.length > 1 ? replicas[0] : undefined);
      const mobile = replicas.find(r => r.bpWidth <= 810) ?? replicas[replicas.length - 1];

      if (tablet) {
        const tabletStyles = mapSourceTypography(tablet.node.raw);
        if (tabletStyles.fontSize) tokens.push({ name: `typo-${group}-size-md`, value: tabletStyles.fontSize });
        if (tabletStyles.lineHeight) tokens.push({ name: `typo-${group}-line-height-md`, value: tabletStyles.lineHeight });
        if (tabletStyles.letterSpacing) tokens.push({ name: `typo-${group}-spacing-md`, value: tabletStyles.letterSpacing });
      }

      if (mobile && mobile !== tablet) {
        const mobileStyles = mapSourceTypography(mobile.node.raw);
        if (mobileStyles.fontSize) tokens.push({ name: `typo-${group}-size-sm`, value: mobileStyles.fontSize });
        if (mobileStyles.lineHeight) tokens.push({ name: `typo-${group}-line-height-sm`, value: mobileStyles.lineHeight });
        if (mobileStyles.letterSpacing) tokens.push({ name: `typo-${group}-spacing-sm`, value: mobileStyles.letterSpacing });
      }
    }
  }
  return { tokens, diagnostics };
}
