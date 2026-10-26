// mcp-reference.ts — Helpers to build and format element reference metadata for MCP AI agents.
import type { CanvasNode } from '@/code/parsing/parser';
import { isComponentFilePath } from '@/code/project/active-file-store';

export interface BuildMcpReferenceOptions {
  activeFilePath?: string | null;
  targetNodeId?: string | null;
  selectedIds?: string[];
  nodes?: Map<string, CanvasNode> | null;
  viewportHeader?: boolean;
  viewportId?: string | null;
  activeVariant?: string | null;
  interactingViewportId?: string | null;
}

export interface McpReferenceNode {
  nodeId: string;
  name?: string;
  type?: string;
  componentFile?: string;
  variant?: string;
  textContent?: string;
  href?: string;
  src?: string;
}

export interface McpReference {
  filePath: string;
  nodeId?: string;
  name?: string;
  type?: string;
  componentFile?: string;
  variant?: string;
  viewport?: string;
  textContent?: string;
  href?: string;
  src?: string;
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

/**
 * Builds an MCP reference object containing all pertinent file, node,
 * component, variant, and viewport data needed for an AI agent to target
 * this element deterministically.
 */
export function buildMcpReference(opts: BuildMcpReferenceOptions): McpReference {
  const filePath = opts.activeFilePath?.trim() || 'app/page.client.tsx';
  const isComponent = isComponentFilePath(filePath);
  const nodes = opts.nodes;

  const getNode = (id: string | null | undefined): CanvasNode | null => {
    if (!id || !nodes) return null;
    return nodes.get(id) ?? null;
  };

  // Case 1: Viewport or Variant Header right-click
  if (opts.viewportHeader) {
    const rootNode = getNode('root');
    const headerVp = opts.viewportId?.trim();
    if (isComponent) {
      const variantName = headerVp || opts.activeVariant || 'default';
      return {
        filePath,
        nodeId: 'root',
        name: rootNode?.name || 'Component Root',
        type: rootNode?.type || 'div',
        variant: variantName,
      };
    } else {
      const viewportName = headerVp || opts.interactingViewportId || 'desktop';
      return {
        filePath,
        nodeId: 'root',
        name: rootNode?.name || 'Page Root',
        type: rootNode?.type || 'div',
        viewport: viewportName,
      };
    }
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
      if (n?.componentFile) item.componentFile = n.componentFile;
      if (n?.attrs?.initialVariant) item.variant = n.attrs.initialVariant;
      const text = sanitizeText(n?.textContent);
      if (text) item.textContent = text;
      if (n?.attrs?.href) item.href = n.attrs.href;
      if (n?.attrs?.src) item.src = n.attrs.src;
      return item;
    });

    const res: McpReference = {
      filePath,
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
    nodeId: effectiveId,
  };

  if (node?.name) res.name = node.name;
  if (node?.type) res.type = node.type;
  if (node?.componentFile) res.componentFile = node.componentFile;

  if (isComponent) {
    res.variant = opts.activeVariant || 'default';
  } else {
    if (node?.attrs?.initialVariant) {
      res.variant = node.attrs.initialVariant;
    }
    res.viewport = opts.interactingViewportId || 'desktop';
  }

  const text = sanitizeText(node?.textContent);
  if (text) res.textContent = text;
  if (node?.attrs?.href) res.href = node.attrs.href;
  if (node?.attrs?.src) res.src = node.attrs.src;

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
