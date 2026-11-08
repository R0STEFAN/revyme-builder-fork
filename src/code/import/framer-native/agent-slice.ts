import { trace } from '../../../shared/debug-trace';
import { decodeNativeTransfer } from './decode';
import { allocateTargetIdentity, buildSourceGraph, resolveSourceNode, sourceRecord } from './source-graph';
import { mapSourceStyles, type SourceMappingContext } from './styles';
import { mapSourceText } from './text';
import { sourceTypographyTokens } from './typography';
import { sourceGoogleFontRequests } from './fonts';
import type { ResolvedSourceNode, SourceGraph, SourceProperties } from './types';

export interface FramerProjectSummary {
  provenance: {
    projectId: string;
    branchId: string;
    revision: string;
    editorBuild: string;
    scopeId: string;
    mode: string;
  };
  pages: Array<{ id: string; name: string; route: string; breakpoints: string[] }>;
  sections: Array<{ id: string; name: string; width?: number; height?: number; childCount: number }>;
  components: Array<{ id: string; name: string; variantCount: number; variants: string[] }>;
  tokens: { colors: number; typography: number; fonts: number };
  cms: Array<{ id: string; name: string; slug: string; itemCount: number }>;
  assets: { total: number; images: number; videos: number; fonts: number };
}

export interface FramerColorTokenInfo {
  id: string;
  name: string;
  sourceName: string;
  value: string;
  dark?: string;
}

export interface FramerTypographyTokenInfo {
  id: string;
  name: string;
  sourceName: string;
  fontSize?: string;
  lineHeight?: string;
  letterSpacing?: string;
  fontWeight?: string;
  fontFamily?: string;
  value?: string;
}

export interface FramerTransferTokens {
  colors: FramerColorTokenInfo[];
  typography: FramerTypographyTokenInfo[];
  googleFonts: Array<{ family: string; axes: Record<string, number> }>;
}

export interface FramerSemanticSlice {
  id: string;
  name: string;
  kind: string;
  tag: string;
  styles: Record<string, string>;
  text?: string;
  link?: { href: string; target?: string };
  media?: { type: 'image' | 'video' | 'vector'; url?: string; svg?: string };
  children: FramerSemanticSlice[];
}

export interface FramerCmsField {
  id: string;
  name: string;
  type: string;
}

export interface FramerCmsItem {
  id: string;
  slug: string;
  data: Record<string, unknown>;
}

export interface FramerCmsCollection {
  id: string;
  name: string;
  slug: string;
  fields: FramerCmsField[];
  items: FramerCmsItem[];
}

export interface FramerTransferCms {
  collections: FramerCmsCollection[];
}

function cleanStyles(styles: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined && value !== null && value !== '' && !key.startsWith('__')) {
      result[key] = value;
    }
  }
  return result;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function inferSemanticTag(node: ResolvedSourceNode, isRoot: boolean): string {
  const name = String(node.properties.name ?? '').toLowerCase();
  if (isRoot) return 'section';
  if (node.kind === 'RichTextNode') {
    if (name.includes('title') || name.includes('heading')) return 'h2';
    return 'p';
  }
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return 'button';
  if (name.includes('header') || name.includes('nav')) return 'header';
  if (name.includes('footer')) return 'footer';
  return 'div';
}

/** Summarize high-level structure and counts of a Framer export */
export function inspectNativeTransfer(input: unknown): FramerProjectSummary {
  trace.fn('agent-slice.inspectNativeTransfer');
  const transfer = decodeNativeTransfer(input);
  const graph = buildSourceGraph(transfer);

  const pages: FramerProjectSummary['pages'] = [];
  for (const id of graph.byKind.get('WebPageNode') ?? []) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const name = String(node.raw.name ?? 'Page');
    const route = String(node.raw.path ?? '/');
    const breakpoints = node.children.map(cid => String(graph.nodes.get(cid)?.raw.name ?? cid));
    pages.push({ id, name, route, breakpoints });
  }

  const components: FramerProjectSummary['components'] = [];
  for (const id of graph.byKind.get('SmartComponentNode') ?? []) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const name = String(node.raw.name ?? 'Component');
    const childFrames = node.children.map(cid => graph.nodes.get(cid)).filter(c => c && c.kind === 'FrameNode');
    const variants = childFrames.map(c => String(c?.raw.name ?? c?.id));
    components.push({
      id,
      name,
      variantCount: variants.length,
      variants,
    });
  }

  const sections: FramerProjectSummary['sections'] = [];
  for (const rootId of graph.renderRootIds) {
    const node = graph.nodes.get(rootId);
    if (!node || node.kind === 'SmartComponentNode' || node.kind === 'WebPageNode') continue;
    sections.push({
      id: rootId,
      name: String(node.raw.name ?? rootId),
      width: typeof node.raw.width === 'number' ? node.raw.width : undefined,
      height: typeof node.raw.height === 'number' ? node.raw.height : undefined,
      childCount: node.children.length,
    });
  }

  const cms: FramerProjectSummary['cms'] = [];
  for (const id of graph.byKind.get('CollectionNode') ?? []) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const name = String(node.raw.name ?? 'Collection');
    const items = node.children.filter(cid => graph.nodes.get(cid)?.kind === 'CollectionItemNode');
    cms.push({
      id,
      name,
      slug: slugify(name),
      itemCount: items.length,
    });
  }

  const colorCount = graph.byKind.get('ColorStyleTokenNode')?.length ?? 0;
  const typographyCount = graph.byKind.get('TextStylePresetNode')?.length ?? 0;
  const googleFonts = sourceGoogleFontRequests(graph).requests.length;

  const assets = transfer.assets ?? [];
  let images = 0, videos = 0, fontFiles = 0;
  for (const a of assets) {
    const mime = String(a.mimeType ?? '');
    if (mime.startsWith('image/')) images++;
    else if (mime.startsWith('video/')) videos++;
    else if (mime.includes('font') || String(a.url ?? '').match(/\.(woff2?|ttf|otf)$/)) fontFiles++;
  }

  return {
    provenance: {
      projectId: transfer.context.projectId,
      branchId: transfer.context.branchId,
      revision: transfer.context.revision,
      editorBuild: transfer.context.editorBuild,
      scopeId: transfer.context.scopeId,
      mode: transfer.context.mode,
    },
    pages,
    sections,
    components,
    tokens: {
      colors: colorCount,
      typography: typographyCount,
      fonts: googleFonts,
    },
    cms,
    assets: {
      total: assets.length,
      images,
      videos,
      fonts: fontFiles,
    },
  };
}

/** Extract design tokens (colors, typography presets, fonts) */
export function extractTransferTokens(input: unknown): FramerTransferTokens {
  trace.fn('agent-slice.extractTransferTokens');
  const transfer = decodeNativeTransfer(input);
  const graph = buildSourceGraph(transfer);
  const identity = allocateTargetIdentity(graph, new Set());

  const colors: FramerColorTokenInfo[] = [];
  for (const id of graph.byKind.get('ColorStyleTokenNode') ?? []) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const sourceName = String(node.raw.name ?? 'Color');
    const light = typeof node.raw.light === 'string' ? node.raw.light : '';
    const dark = typeof node.raw.dark === 'string' ? node.raw.dark : undefined;
    colors.push({
      id,
      name: `color-${identity[id] || slugify(sourceName)}`,
      sourceName,
      value: light,
      dark,
    });
  }

  const typography: FramerTypographyTokenInfo[] = [];
  for (const id of graph.byKind.get('TextStylePresetNode') ?? []) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const sourceName = String(node.raw.name ?? 'Typography');
    const raw = node.raw;
    typography.push({
      id,
      name: `typography-${identity[id] || slugify(sourceName)}`,
      sourceName,
      fontSize: typeof raw.fontSize === 'number' ? `${raw.fontSize}px` : raw.fontSize ? String(raw.fontSize) : undefined,
      lineHeight: typeof raw.lineHeight === 'number' ? `${raw.lineHeight}` : raw.lineHeight ? String(raw.lineHeight) : undefined,
      letterSpacing: typeof raw.letterSpacing === 'number' ? `${raw.letterSpacing}px` : raw.letterSpacing ? String(raw.letterSpacing) : undefined,
      fontWeight: raw.fontWeight ? String(raw.fontWeight) : undefined,
      fontFamily: raw.fontFamily ? String(raw.fontFamily) : undefined,
    });
  }

  const google = sourceGoogleFontRequests(graph).requests.map(r => ({
    family: r.family,
    axes: r.axes,
  }));

  return { colors, typography, googleFonts: google };
}

export interface SliceOptions {
  viewport?: 'desktop' | 'tablet' | 'phone';
  maxDepth?: number;
}

/** Extract a semantic, cleaned slice for a section or component */
export function extractTransferSlice(
  input: unknown,
  nodeId: string,
  options: SliceOptions = {}
): FramerSemanticSlice {
  trace.fn('agent-slice.extractTransferSlice', { nodeId });
  const transfer = decodeNativeTransfer(input);
  const graph = buildSourceGraph(transfer);
  const maxDepth = options.maxDepth ?? 10;

  const mappingContext: SourceMappingContext = {
    diagnostics: [],
    graph,
  };

  function buildSlice(currentId: string, depth: number, isRoot: boolean): FramerSemanticSlice {
    const node = graph.nodes.get(currentId);
    if (!node) {
      throw new Error(`FRAMER_NODE_NOT_FOUND: node ${currentId} does not exist in capture`);
    }

    // If node is SmartComponentNode, default to its first variant frame or base variant
    let targetNodeId = currentId;
    if (node.kind === 'SmartComponentNode') {
      const baseId = typeof node.raw.baseVariantId === 'string' ? node.raw.baseVariantId : node.children[0];
      if (baseId && graph.nodes.has(baseId)) {
        targetNodeId = baseId;
      }
    }

    const resolved = resolveSourceNode(graph, targetNodeId);
    const rawStyles = mapSourceStyles(resolved, mappingContext);
    const styles = cleanStyles(rawStyles);
    const name = String(node.raw.name ?? resolved.properties.name ?? node.kind);
    const tag = inferSemanticTag(resolved, isRoot);

    let text: string | undefined;
    if (resolved.kind === 'RichTextNode') {
      const nativeText = mapSourceText(resolved, mappingContext);
      text = nativeText.plainText;
      if (nativeText.styles) {
        Object.assign(styles, cleanStyles(nativeText.styles));
      }
    }

    const children: FramerSemanticSlice[] = [];
    if (depth < maxDepth && resolved.children && resolved.children.length > 0) {
      for (const childId of resolved.children) {
        if (graph.nodes.has(childId)) {
          children.push(buildSlice(childId, depth + 1, false));
        }
      }
    }

    return {
      id: currentId,
      name,
      kind: resolved.kind,
      tag,
      styles,
      text,
      children,
    };
  }

  return buildSlice(nodeId, 0, true);
}

/** Extract CMS collections, fields, and records */
export function extractTransferCms(input: unknown, collectionId?: string): FramerTransferCms {
  trace.fn('agent-slice.extractTransferCms', { collectionId });
  const transfer = decodeNativeTransfer(input);
  const graph = buildSourceGraph(transfer);

  const collectionIds = (graph.byKind.get('CollectionNode') ?? []).filter(id => {
    return collectionId ? id === collectionId : true;
  });

  const collections: FramerCmsCollection[] = [];
  for (const id of collectionIds) {
    const colNode = graph.nodes.get(id);
    if (!colNode) continue;
    const name = String(colNode.raw.name ?? 'Collection');
    const slug = slugify(name);

    // Read variables / schema fields
    const rawVariables = colNode.raw.variables ?? [];
    const fields: FramerCmsField[] = [];
    const varList = Array.isArray(rawVariables) ? rawVariables : Object.values(rawVariables);
    for (const v of varList) {
      const rec = sourceRecord(v);
      if (!rec || !rec.id) continue;
      fields.push({
        id: String(rec.id),
        name: String(rec.name ?? rec.id),
        type: String(rec.type ?? 'string'),
      });
    }

    // Read child items
    const items: FramerCmsItem[] = [];
    for (const childId of colNode.children) {
      const itemNode = graph.nodes.get(childId);
      if (!itemNode || itemNode.kind !== 'CollectionItemNode') continue;
      const raw = itemNode.raw;
      const itemSlug = String(raw.slug ?? raw.name ?? childId);
      const fieldData: Record<string, unknown> = {};
      for (const field of fields) {
        if (raw[field.id] !== undefined) {
          fieldData[field.id] = raw[field.id];
        } else if (raw[field.name] !== undefined) {
          fieldData[field.id] = raw[field.name];
        }
      }
      items.push({
        id: childId,
        slug: itemSlug,
        data: fieldData,
      });
    }

    collections.push({
      id,
      name,
      slug,
      fields,
      items,
    });
  }

  return { collections };
}
