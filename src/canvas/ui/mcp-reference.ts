// mcp-reference.ts — Helpers to build and format element reference metadata for MCP AI agents.
import type { CanvasNode } from '@/code/parsing/parser';
import { isComponentFilePath } from '@/code/project/active-file-store';

/** Subset of computed CSS properties useful to an AI agent when inline styles
 *  alone omit inherited colors, typography, or layout context. */
export const MCP_COMPUTED_STYLE_PROPS = [
  'display',
  'position',
  'flexDirection',
  'gap',
  'padding',
  'backgroundColor',
  'color',
  'border',
  'borderRadius',
  'fontSize',
  'fontWeight',
  'boxShadow',
  'opacity',
] as const;

const MAX_CHILDREN_SUMMARY = 15;

export interface McpRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface McpChildSummary {
  nodeId: string;
  type: string;
  name?: string;
}

export interface McpNodeBindings {
  styleVariables?: Record<string, string>;
  textVariable?: string;
  textExpression?: string;
  hrefExpression?: string;
  srcExpression?: string;
  ariaLabelExpression?: string;
  translationKey?: string;
}

export interface BuildMcpReferenceOptions {
  activeFilePath?: string | null;
  targetNodeId?: string | null;
  selectedIds?: string[];
  nodes?: Map<string, CanvasNode> | null;
  viewportHeader?: boolean;
  viewportId?: string | null;
  activeVariant?: string | null;
  interactingViewportId?: string | null;
  branchId?: string | null;
  getRect?: (nodeId: string) => { x: number; y: number; width: number; height: number } | null;
  getComputedStyles?: (nodeId: string, props: readonly string[]) => Record<string, string>;
}

export interface McpReferenceNode {
  nodeId: string;
  name?: string;
  type?: string;
  parentId?: string;
  componentFile?: string;
  insideComponentInstance?: boolean;
  isComponentRoot?: boolean;
  isMotionElement?: boolean;
  variant?: string;
  textContent?: string;
  href?: string;
  src?: string;
  rect?: McpRect;
  styles?: Record<string, string>;
  bindings?: McpNodeBindings;
}

export interface McpReference {
  filePath: string;
  branch?: string;
  nodeId?: string;
  name?: string;
  type?: string;
  parentId?: string;
  children?: McpChildSummary[];
  childrenTotal?: number;
  componentFile?: string;
  insideComponentInstance?: boolean;
  isComponentRoot?: boolean;
  isMotionElement?: boolean;
  variant?: string;
  viewport?: string;
  textContent?: string;
  href?: string;
  src?: string;
  rect?: McpRect;
  styles?: Record<string, string>;
  computed?: Record<string, string>;
  bindings?: McpNodeBindings;
  selectedNodeIds?: string[];
  count?: number;
  nodes?: McpReferenceNode[];
}

function sanitizeText(txt?: string | null): string | undefined {
  if (!txt) return undefined;
  const clean = txt.trim().replace(/\s+/g, ' ');
  if (!clean) return undefined;
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
}

function roundRect(raw: { x: number; y: number; width: number; height: number } | null | undefined): McpRect | undefined {
  if (!raw) return undefined;
  const { x, y, width, height } = raw;
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function cleanInlineStyles(styles?: Record<string, string> | null): Record<string, string> | undefined {
  if (!styles) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(styles)) {
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isTrivialComputedValue(prop: string, val: string): boolean {
  const v = val.trim();
  if (!v) return true;
  if (prop === 'boxShadow' && v === 'none') return true;
  if (prop === 'opacity' && v === '1') return true;
  if (prop === 'borderRadius' && v === '0px') return true;
  if (prop === 'padding' && v === '0px') return true;
  if (prop === 'gap' && v === 'normal') return true;
  if (prop === 'backgroundColor' && (v === 'transparent' || v === 'rgba(0, 0, 0, 0)')) return true;
  if (prop === 'border' && v.startsWith('0px none')) return true;
  return false;
}

function cleanComputedStyles(
  raw: Record<string, string> | null | undefined,
  inlineStyles?: Record<string, string>,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || isTrivialComputedValue(k, v)) continue;
    // Skip exact duplicates already shown in inline `styles`.
    if (inlineStyles && inlineStyles[k] === v) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function extractBindings(node: CanvasNode): McpNodeBindings | undefined {
  const out: McpNodeBindings = {};
  if (node.styleVariables && Object.keys(node.styleVariables).length > 0) {
    out.styleVariables = { ...node.styleVariables };
  }
  if (node.textVariable) out.textVariable = node.textVariable;
  if (node.textExpression) out.textExpression = node.textExpression;
  if (node.hrefExpression) out.hrefExpression = node.hrefExpression;
  if (node.srcExpression) out.srcExpression = node.srcExpression;
  if (node.ariaLabelExpression) out.ariaLabelExpression = node.ariaLabelExpression;
  if (node.translationKey) out.translationKey = node.translationKey;
  return Object.keys(out).length > 0 ? out : undefined;
}

function summarizeChildren(
  node: CanvasNode,
  nodes?: Map<string, CanvasNode> | null,
): { children?: McpChildSummary[]; childrenTotal?: number } {
  if (!node.children || node.children.length === 0) return {};
  const list: McpChildSummary[] = node.children.slice(0, MAX_CHILDREN_SUMMARY).map((cid) => {
    const child = nodes?.get(cid);
    const entry: McpChildSummary = { nodeId: cid, type: child?.type || 'unknown' };
    if (child?.name && child.name !== cid && child.name !== child.type) entry.name = child.name;
    return entry;
  });
  return {
    children: list,
    ...(node.children.length > MAX_CHILDREN_SUMMARY ? { childrenTotal: node.children.length } : {}),
  };
}

function safeGetRect(opts: BuildMcpReferenceOptions, id: string): McpRect | undefined {
  if (!opts.getRect) return undefined;
  try {
    return roundRect(opts.getRect(id));
  } catch {
    return undefined;
  }
}

function safeGetComputed(
  opts: BuildMcpReferenceOptions,
  id: string,
  inlineStyles?: Record<string, string>,
): Record<string, string> | undefined {
  if (!opts.getComputedStyles) return undefined;
  try {
    return cleanComputedStyles(opts.getComputedStyles(id, MCP_COMPUTED_STYLE_PROPS), inlineStyles);
  } catch {
    return undefined;
  }
}

function populateCommonNodeFields(
  target: McpReferenceNode,
  node: CanvasNode,
  opts: BuildMcpReferenceOptions,
): void {
  if (node.parentId) target.parentId = node.parentId;
  if (node.componentFile) target.componentFile = node.componentFile;
  if (node.componentInstanceId != null) target.insideComponentInstance = true;
  if (node.isComponentRoot) target.isComponentRoot = true;
  if (node.isMotionElement) target.isMotionElement = true;
  const text = sanitizeText(node.textContent);
  if (text) target.textContent = text;
  if (node.attrs?.href) target.href = node.attrs.href;
  if (node.attrs?.src) target.src = node.attrs.src;
  const rect = safeGetRect(opts, target.nodeId);
  if (rect) target.rect = rect;
  const styles = cleanInlineStyles(node.styles);
  if (styles) target.styles = styles;
  const bindings = extractBindings(node);
  if (bindings) target.bindings = bindings;
}

/**
 * Builds an MCP reference object containing all pertinent file, node,
 * component, variant, viewport, layout, and style data needed for an AI agent
 * to act on this element deterministically in one turn.
 */
export function buildMcpReference(opts: BuildMcpReferenceOptions): McpReference {
  const filePath = opts.activeFilePath?.trim() || 'app/page.client.tsx';
  const isComponent = isComponentFilePath(filePath);
  const nodes = opts.nodes;
  const branch = opts.branchId && opts.branchId !== 'main' ? opts.branchId : undefined;

  const getNode = (id: string | null | undefined): CanvasNode | null => {
    if (!id || !nodes) return null;
    return nodes.get(id) ?? null;
  };

  // Case 1: Viewport or Variant Header right-click
  if (opts.viewportHeader) {
    const rootNode = getNode('root');
    const headerVp = opts.viewportId?.trim();
    const res: McpReference = isComponent
      ? {
          filePath,
          ...(branch ? { branch } : {}),
          nodeId: 'root',
          name: rootNode?.name || 'Component Root',
          type: rootNode?.type || 'div',
          variant: headerVp || opts.activeVariant || 'default',
        }
      : {
          filePath,
          ...(branch ? { branch } : {}),
          nodeId: 'root',
          name: rootNode?.name || 'Page Root',
          type: rootNode?.type || 'div',
          viewport: headerVp || opts.interactingViewportId || 'desktop',
        };
    if (rootNode) {
      const { children, childrenTotal } = summarizeChildren(rootNode, nodes);
      if (children) res.children = children;
      if (childrenTotal !== undefined) res.childrenTotal = childrenTotal;
      const styles = cleanInlineStyles(rootNode.styles);
      if (styles) res.styles = styles;
    }
    return res;
  }

  // Case 2: Multi-selection
  const selectedIds = opts.selectedIds ?? [];
  const targetId = opts.targetNodeId;
  const isMulti = selectedIds.length > 1 && (!targetId || selectedIds.includes(targetId));

  if (isMulti) {
    const list: McpReferenceNode[] = selectedIds.map((id) => {
      const n = getNode(id);
      const item: McpReferenceNode = {
        nodeId: id,
        name: n?.name || id,
        type: n?.type || 'unknown',
      };
      if (n) {
        populateCommonNodeFields(item, n, opts);
        if (n.attrs?.initialVariant) item.variant = n.attrs.initialVariant;
      } else {
        const rect = safeGetRect(opts, id);
        if (rect) item.rect = rect;
      }
      return item;
    });

    const res: McpReference = {
      filePath,
      ...(branch ? { branch } : {}),
      selectedNodeIds: selectedIds,
      count: selectedIds.length,
      nodes: list,
    };
    if (isComponent) {
      res.variant = opts.activeVariant || 'default';
    } else {
      res.viewport = opts.interactingViewportId || 'desktop';
    }
    return res;
  }

  // Case 3: Single target node (or fallback to root)
  const effectiveId = targetId || (selectedIds.length > 0 ? selectedIds[0] : null) || 'root';
  const node = getNode(effectiveId);

  const res: McpReference = {
    filePath,
    ...(branch ? { branch } : {}),
    nodeId: effectiveId,
  };

  if (node?.name) res.name = node.name;
  if (node?.type) res.type = node.type;

  if (isComponent) {
    res.variant = opts.activeVariant || 'default';
  } else {
    if (node?.attrs?.initialVariant) {
      res.variant = node.attrs.initialVariant;
    }
    res.viewport = opts.interactingViewportId || 'desktop';
  }

  if (node) {
    const common: McpReferenceNode = { nodeId: effectiveId };
    populateCommonNodeFields(common, node, opts);
    if (common.parentId) res.parentId = common.parentId;
    if (common.componentFile) res.componentFile = common.componentFile;
    if (common.insideComponentInstance) res.insideComponentInstance = true;
    if (common.isComponentRoot) res.isComponentRoot = true;
    if (common.isMotionElement) res.isMotionElement = true;
    if (common.textContent) res.textContent = common.textContent;
    if (common.href) res.href = common.href;
    if (common.src) res.src = common.src;
    if (common.rect) res.rect = common.rect;
    if (common.styles) res.styles = common.styles;
    if (common.bindings) res.bindings = common.bindings;

    const { children, childrenTotal } = summarizeChildren(node, nodes);
    if (children) res.children = children;
    if (childrenTotal !== undefined) res.childrenTotal = childrenTotal;

    const computed = safeGetComputed(opts, effectiveId, common.styles);
    if (computed) res.computed = computed;
  } else {
    const rect = safeGetRect(opts, effectiveId);
    if (rect) res.rect = rect;
    const computed = safeGetComputed(opts, effectiveId);
    if (computed) res.computed = computed;
  }

  return res;
}

/** Formats MCP reference metadata as pretty-printed JSON */
export function formatMcpReference(ref: McpReference): string {
  return JSON.stringify(ref, null, 2);
}

/** Copies text to the system clipboard with browser execCommand fallback */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to document.execCommand
  }

  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }
  return false;
}
