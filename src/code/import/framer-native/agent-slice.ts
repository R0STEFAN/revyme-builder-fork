import { trace } from '../../../shared/debug-trace';
import { decodeNativeTransfer } from './decode';
import { allocateTargetIdentity, buildSourceGraph, resolveSourceNode, sourceRecord } from './source-graph';
import { mapSourceStyles, type SourceMappingContext } from './styles';
import { mapSourceText, mapSourceTypography } from './text';
import { sourcePageRoute } from './pages';
import { sourceTypographyTokens } from './typography';
import { sourceGoogleFontRequests } from './fonts';
import type { ResolvedSourceNode, SourceGraph, SourceProperties } from './types';

export interface FramerComponentRef {
  id: string;
  name: string;
}

export interface FramerProjectSummary {
  provenance: {
    projectId: string;
    branchId: string;
    revision: string;
    editorBuild: string;
    scopeId: string;
    mode: string;
  };
  pages: Array<{ id: string; name: string; route: string; breakpoints: string[]; components?: FramerComponentRef[] }>;
  sections: Array<{ id: string; name: string; width?: number; height?: number; childCount: number; components?: FramerComponentRef[] }>;
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
  media?: { type: 'image' | 'video' | 'vector'; url?: string; svg?: string; alt?: string };
  componentId?: string;
  componentName?: string;
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

function findUsedComponents(graph: SourceGraph, rootId: string): FramerComponentRef[] {
  const visited = new Set<string>();
  const comps = new Map<string, string>();

  function walk(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = graph.nodes.get(id);
    if (!node) return;

    if (node.kind === 'CodeComponentNode') {
      const codeCompId = String(node.raw.codeComponentIdentifier ?? '');
      const match = /^local-module:canvasComponent\/([^:]+):/.exec(codeCompId);
      if (match) {
        const compId = match[1];
        const master = graph.nodes.get(compId);
        comps.set(compId, String(master?.raw.name ?? compId));
      }
    }

    for (const childId of node.children) {
      walk(childId);
    }
  }

  walk(rootId);
  return Array.from(comps.entries()).map(([id, name]) => ({ id, name }));
}

function resolveAssetUrl(ref: unknown, assets: Array<{ key?: string; url?: string }>): string | undefined {
  if (!ref || typeof ref !== 'string') return undefined;
  if (ref.startsWith('http://') || ref.startsWith('https://')) return ref;
  const match = /data:framer\/asset-reference,([^.?]+)/.exec(ref);
  const key = match ? match[1] : ref;
  const found = assets.find(a => a.key === key || (a.key && key.includes(a.key)) || (a.url && a.url.includes(key)));
  return found?.url ?? (match ? `https://framerusercontent.com/assets/${match[1]}` : undefined);
}

function resolveLink(rawLink: unknown, graph: SourceGraph): { href: string; target?: string } | undefined {
  if (!rawLink) return undefined;
  if (typeof rawLink === 'string') {
    if (rawLink.startsWith('/') || rawLink.startsWith('http://') || rawLink.startsWith('https://') || rawLink.startsWith('mailto:') || rawLink.startsWith('tel:') || rawLink.startsWith('#')) {
      return { href: rawLink };
    }
    return undefined;
  }
  if (typeof rawLink === 'object' && rawLink !== null) {
    const obj = rawLink as any;
    if (obj.type === 'url' && typeof obj.url === 'string') {
      return { href: obj.url, target: obj.newTab ? '_blank' : undefined };
    }
    if (obj.type === 'webPage' && typeof obj.webPageId === 'string') {
      const pageNode = graph.nodes.get(obj.webPageId);
      if (pageNode) {
        try {
          const route = sourcePageRoute(graph, pageNode);
          return { href: route, target: obj.newTab ? '_blank' : undefined };
        } catch {
          const name = String(pageNode.raw.name ?? '').toLowerCase();
          return { href: name === 'home' ? '/' : `/${name || obj.webPageId}`, target: obj.newTab ? '_blank' : undefined };
        }
      }
      return { href: `/${obj.webPageId}` };
    }
  }
  return undefined;
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
    let route = String(node.raw.path ?? '/');
    try {
      route = sourcePageRoute(graph, node);
    } catch {
      // Fall back to raw path or /
    }
    const breakpoints = node.children.map(cid => String(graph.nodes.get(cid)?.raw.name ?? cid));
    pages.push({ id, name, route, breakpoints, components: findUsedComponents(graph, id) });
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
      components: findUsedComponents(graph, rootId),
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
    const mapped = mapSourceTypography(raw);

    const fontSize = typeof raw.fontSize === 'number'
      ? `${raw.fontSize}px`
      : (mapped.fontSize || (raw.fontSize ? String(raw.fontSize) : undefined));

    const lineHeight = mapped.lineHeight || (
      Array.isArray(raw.lineHeight) && raw.lineHeight.length === 2 && typeof raw.lineHeight[0] === 'number'
        ? (raw.lineHeight[1] === 'em' ? String(raw.lineHeight[0]) : `${raw.lineHeight[0]}${raw.lineHeight[1]}`)
        : typeof raw.lineHeight === 'number' ? String(raw.lineHeight) : undefined
    );

    const letterSpacing = mapped.letterSpacing || (
      Array.isArray(raw.letterSpacing) && raw.letterSpacing.length === 2 && typeof raw.letterSpacing[0] === 'number'
        ? `${raw.letterSpacing[0]}${raw.letterSpacing[1]}`
        : typeof raw.letterSpacing === 'number' ? `${raw.letterSpacing}px` : undefined
    );

    const fontFamily = mapped.fontFamily
      ? mapped.fontFamily.replace(/^"|"$/g, '')
      : (typeof raw.fontFamily === 'string' ? raw.fontFamily : undefined);

    const fontWeight = mapped.fontWeight || (raw.fontWeight ? String(raw.fontWeight) : undefined);

    typography.push({
      id,
      name: `typography-${identity[id] || slugify(sourceName)}`,
      sourceName,
      fontSize,
      lineHeight,
      letterSpacing,
      fontWeight,
      fontFamily,
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
  const assets = transfer.assets ?? [];

  const mappingContext: SourceMappingContext = {
    diagnostics: [],
    graph,
  };

  function buildSlice(
    currentId: string,
    depth: number,
    isRoot: boolean,
    parentVars = new Map<string, unknown>()
  ): FramerSemanticSlice {
    const node = graph.nodes.get(currentId);
    if (!node) {
      throw new Error(`FRAMER_NODE_NOT_FOUND: node ${currentId} does not exist in capture`);
    }

    let targetNodeId = currentId;
    let componentId: string | undefined;
    let componentName: string | undefined;
    const scopedVars = new Map<string, unknown>(parentVars);

    // If node is a CodeComponentNode pointing to a local SmartComponent
    if (node.kind === 'CodeComponentNode') {
      const codeId = String(node.raw.codeComponentIdentifier ?? '');
      const match = /^local-module:canvasComponent\/([^:]+):/.exec(codeId);
      if (match) {
        componentId = match[1];
        const master = graph.nodes.get(componentId);
        if (master) {
          componentName = String(master.raw.name ?? componentId);
          // 1. Populate master variables defaults
          if (Array.isArray(master.raw.variables)) {
            for (const v of master.raw.variables) {
              const record = sourceRecord(v);
              const varId = typeof record?.id === 'string' ? record.id : undefined;
              const varName = typeof record?.name === 'string' ? record.name : undefined;
              if (varId) scopedVars.set(varId, record?.initialValue);
              if (varName) scopedVars.set(varName, record?.initialValue);
            }
          }
          // 2. Override with instance controls
          for (const [k, val] of Object.entries(node.raw)) {
            if (k.startsWith('$control__')) {
              const varId = k.slice(10);
              const unwrapped = val && typeof val === 'object' && 'value' in val ? (val as any).value : val;
              if (unwrapped && typeof unwrapped === 'object' && (unwrapped as any).type === 'variableReference') {
                const resolvedRef = parentVars.get((unwrapped as any).id);
                scopedVars.set(varId, resolvedRef !== undefined ? resolvedRef : unwrapped);
              } else {
                scopedVars.set(varId, unwrapped);
              }
            }
          }
          // 3. Resolve target variant frame
          const rawVariant = node.raw.$control__variant;
          const variantControlValue = typeof rawVariant === 'object' && rawVariant !== null && 'value' in rawVariant
            ? (rawVariant as any).value
            : rawVariant;
          const variantVal = scopedVars.get('variant') ?? variantControlValue ?? master.raw.baseVariantId ?? master.children[0];
          const variantNode = (typeof variantVal === 'string' && graph.nodes.get(variantVal)) || graph.nodes.get(master.children[0]);
          if (variantNode) {
            targetNodeId = variantNode.id;
          }
        }
      }
    } else if (node.kind === 'SmartComponentNode') {
      const baseId = typeof node.raw.baseVariantId === 'string' ? node.raw.baseVariantId : node.children[0];
      if (baseId && graph.nodes.has(baseId)) {
        targetNodeId = baseId;
      }
      if (Array.isArray(node.raw.variables)) {
        for (const v of node.raw.variables) {
          const record = sourceRecord(v);
          const varId = typeof record?.id === 'string' ? record.id : undefined;
          const varName = typeof record?.name === 'string' ? record.name : undefined;
          if (varId) scopedVars.set(varId, record?.initialValue);
          if (varName) scopedVars.set(varName, record?.initialValue);
        }
      }
    } else if (node.kind === 'LayoutTemplateNode') {
      const desktopFrame = node.children.find(cid => {
        const c = graph.nodes.get(cid);
        return c?.raw.name === 'Desktop';
      }) ?? node.children[0];
      if (desktopFrame && graph.nodes.has(desktopFrame)) {
        targetNodeId = desktopFrame;
      }
    }

    const resolved = resolveSourceNode(graph, targetNodeId);
    const rawStyles = mapSourceStyles(resolved, mappingContext);
    if (targetNodeId !== currentId && node.kind === 'CodeComponentNode') {
      const resolvedInstance = resolveSourceNode(graph, currentId);
      const instanceStyles = mapSourceStyles(resolvedInstance, mappingContext);
      Object.assign(rawStyles, instanceStyles);
    }
    const styles = cleanStyles(rawStyles);

    const name = String(node.raw.name ?? resolved.properties.name ?? componentName ?? node.kind);
    const tag = inferSemanticTag(resolved, isRoot);

    // Resolve text
    let text: string | undefined;
    if (resolved.kind === 'RichTextNode') {
      const textContent = resolved.properties.textContent;
      if (textContent && typeof textContent === 'object' && (textContent as any).type === 'variableReference') {
        const vVal = scopedVars.get((textContent as any).id);
        if (typeof vVal === 'string') text = vVal;
      }
      if (!text) {
        const nativeText = mapSourceText(resolved, mappingContext);
        text = nativeText.plainText;
        if (nativeText.styles) {
          Object.assign(styles, cleanStyles(nativeText.styles));
        }
      }
    }
    if (!text && scopedVars.get('Label') && typeof scopedVars.get('Label') === 'string') {
      text = scopedVars.get('Label') as string;
    }

    // Resolve link
    let link: { href: string; target?: string } | undefined;
    for (const [k, v] of Object.entries(node.raw)) {
      if (k.startsWith('$control__') && v && typeof v === 'object') {
        const isLinkControl = (v as any).type === 'link';
        const unwrapped = 'value' in v ? (v as any).value : v;
        if (isLinkControl || (unwrapped && typeof unwrapped === 'object' && ((unwrapped as any).type === 'url' || (unwrapped as any).type === 'webPage'))) {
          const resolvedLink = resolveLink(unwrapped, graph);
          if (resolvedLink) {
            link = resolvedLink;
            break;
          }
        }
      }
    }
    if (!link && resolved.properties.link) {
      link = resolveLink(resolved.properties.link, graph);
    }

    // Resolve media (image / video)
    let media: FramerSemanticSlice['media'] | undefined;
    const fillImg = resolved.properties.fillImage ?? node.raw.fillImage;
    if (fillImg) {
      const ref = typeof fillImg === 'object' && fillImg !== null && (fillImg as any).type === 'variableReference'
        ? scopedVars.get((fillImg as any).id)
        : fillImg;
      const url = resolveAssetUrl(typeof ref === 'string' ? ref : (ref as any)?.value, assets);
      if (url) {
        media = {
          type: 'image',
          url,
          alt: String(resolved.properties.altAttribute ?? node.raw.altAttribute ?? ''),
        };
      }
    }
    if (!media) {
      for (const [k, v] of Object.entries(node.raw)) {
        if (k.startsWith('$control__') && v && typeof v === 'object' && (v as any).type === 'image') {
          const url = resolveAssetUrl((v as any).value, assets);
          if (url) {
            media = { type: 'image', url, alt: String((v as any).alt ?? '') };
            break;
          }
        }
      }
    }

    // Recurse children
    const children: FramerSemanticSlice[] = [];
    const childIds = resolved.children ?? [];
    if (depth < maxDepth && childIds.length > 0) {
      for (const childId of childIds) {
        if (graph.nodes.has(childId)) {
          children.push(buildSlice(childId, depth + 1, false, scopedVars));
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
      link,
      media,
      componentId,
      componentName,
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

      const fieldData: Record<string, unknown> = {};
      for (const field of fields) {
        const rawControl = raw[`$control__${field.id}`] ?? raw[field.id] ?? raw[field.name];
        const val = (rawControl && typeof rawControl === 'object' && 'value' in rawControl)
          ? (rawControl as any).value
          : rawControl;
        if (val !== undefined) {
          fieldData[field.id] = val;
          fieldData[field.name] = val;
        }
      }

      let itemSlug: string | undefined;
      for (const field of fields) {
        if (field.type === 'slug' || field.name.toLowerCase() === 'slug') {
          const val = fieldData[field.id] ?? fieldData[field.name];
          if (typeof val === 'string' && val.trim()) {
            itemSlug = val.trim();
            break;
          }
        }
      }
      if (!itemSlug) {
        itemSlug = String(raw.slug ?? raw.name ?? childId);
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
