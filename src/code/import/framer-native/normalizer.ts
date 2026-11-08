// src/code/import/framer-native/normalizer.ts
import { trace } from '../../../shared/debug-trace';
import { decodeNativeTransfer } from './decode';
import {
  inspectNativeTransfer,
  extractTransferTokens,
  extractTransferCms,
  extractTransferComponent,
  extractTransferSlice,
  type FramerColorTokenInfo,
  type FramerTypographyTokenInfo,
  type FramerCmsCollection,
  type FramerComponentVariable,
  type FramerComponentVariant,
  type FramerComponentInteraction,
  type FramerSemanticSlice,
  type FramerComponentRef,
} from './agent-slice';

export interface RevymeTransferIR {
  format: 'revyme.ir.v1';
  version: 1;
  metadata: {
    projectId: string;
    branchId?: string;
    revision?: string;
    editorBuild?: string;
    mode?: string;
    timestamp: string;
  };
  tokens: {
    colors: FramerColorTokenInfo[];
    typography: FramerTypographyTokenInfo[];
    googleFonts: Array<{ family: string; axes: Record<string, number> }>;
  };
  cms: FramerCmsCollection[];
  components: Array<{
    id: string;
    name: string;
    defaultVariantId?: string;
    variables: FramerComponentVariable[];
    variants: FramerComponentVariant[];
    interactions: FramerComponentInteraction[];
    structure?: FramerSemanticSlice;
  }>;
  pages: Array<{
    id: string;
    name: string;
    route: string;
    breakpoints: string[];
    components?: FramerComponentRef[];
    structure?: FramerSemanticSlice;
  }>;
}

export function normalizeNativeTransfer(input: unknown): RevymeTransferIR {
  trace.fn('normalizer.normalizeNativeTransfer');
  const decoded = decodeNativeTransfer(input);
  const summary = inspectNativeTransfer(decoded);
  const tokens = extractTransferTokens(decoded);
  const cms = extractTransferCms(decoded);

  const components: RevymeTransferIR['components'] = [];
  for (const comp of summary.components) {
    try {
      const detail = extractTransferComponent(decoded, comp.id);
      let structure: FramerSemanticSlice | undefined;
      try {
        structure = extractTransferSlice(decoded, comp.id, { maxDepth: 6 });
      } catch {
        // Structure extraction fallback
      }
      components.push({
        ...detail,
        structure,
      });
    } catch (e: any) {
      trace.error('normalizer.componentError', { id: comp.id, error: e?.message });
    }
  }

  const pages: RevymeTransferIR['pages'] = [];
  for (const page of summary.pages) {
    try {
      let structure: FramerSemanticSlice | undefined;
      try {
        structure = extractTransferSlice(decoded, page.id, { maxDepth: 6 });
      } catch {
        // Structure extraction fallback
      }
      pages.push({
        id: page.id,
        name: page.name,
        route: page.route,
        breakpoints: page.breakpoints,
        components: page.components,
        structure,
      });
    } catch (e: any) {
      trace.error('normalizer.pageError', { id: page.id, error: e?.message });
    }
  }

  return {
    format: 'revyme.ir.v1',
    version: 1,
    metadata: {
      projectId: summary.provenance.projectId,
      branchId: summary.provenance.branchId,
      revision: summary.provenance.revision,
      editorBuild: summary.provenance.editorBuild,
      mode: summary.provenance.mode,
      timestamp: new Date().toISOString(),
    },
    tokens,
    cms: cms.collections,
    components,
    pages,
  };
}
