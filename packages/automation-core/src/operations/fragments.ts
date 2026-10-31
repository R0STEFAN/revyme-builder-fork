// packages/automation-core/src/operations/fragments.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes, type CanvasNode } from '@/code/parsing/parser';
import { addNodeInCode, updateNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { ensureNamedImport } from '@/code/generation/generator-utils';
import { SVG_SHAPE_TAGS } from '@/shared/constants';
import { ingestJSXNodes } from '../ingestion/jsx';
import { IdManager } from '../ingestion/ids';
import { IngestionReporter } from '../ingestion/report';
import type { IngestedNode } from '../ingestion/tree';
import { ensureComponentImport } from './components';
import { BUILT_IN_COMPONENTS } from '@/code/project/project-fs';

const FRAMEWORK_COMPONENTS: Record<string, { module: string; defaultSpec: string }> = {
  Link: { module: 'next/link', defaultSpec: 'Link' },
  Image: { module: 'next/image', defaultSpec: 'Image' },
};

function getTargetFile(snapshot: Snapshot, filePath?: string): { path: string; code: string } {
  let target = filePath;
  if (!target) {
    for (const key of snapshot.files.keys()) {
      if (key.endsWith('page.client.tsx') || key === 'page.client.tsx') {
        target = key;
        break;
      }
    }
    if (!target) {
      for (const key of snapshot.files.keys()) {
        if (key.endsWith('page.tsx') || key === 'page.tsx') {
          target = key;
          break;
        }
      }
    }
  }
  if (!target || !snapshot.files.has(target)) {
    throw new Error(`FILE_NOT_FOUND: Target file "${target || 'default page'}" not found in snapshot`);
  }
  return { path: target, code: snapshot.files.get(target)! };
}

function ensureFlowChildOrder(code: string, parentId: string): string {
  const nodes = parseJSXToNodes(code);
  const parent = nodes.get(parentId);
  const display = parent?.styles.display;
  if (!parent || !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display || '')) return code;

  const flowChildren = parent.children
    .map((childId) => nodes.get(childId))
    .filter((child): child is CanvasNode => !!child && child.styles.position !== 'absolute' && child.styles.position !== 'fixed');
  const explicitOrders = flowChildren
    .map((child) => Number(child.styles.order))
    .filter(Number.isFinite);
  let nextCode = code;
  let flowOrder = explicitOrders.length ? Math.max(...explicitOrders) + 1 : 0;
  for (const child of flowChildren) {
    if (child.styles.order === undefined || child.styles.order === '') {
      nextCode = updateNodeInCode(nextCode, child.id, { order: String(flowOrder) });
      flowOrder++;
    }
  }
  return nextCode;
}

/** Recursively collect all component tags used in the ingested tree */
function collectComponentTags(nodes: IngestedNode[]): Set<string> {
  const componentTags = new Set<string>();
  function walk(node: IngestedNode) {
    const firstChar = node.tag.charAt(0);
    if (firstChar >= 'A' && firstChar <= 'Z') {
      componentTags.add(node.tag);
    }
    // Also if <a> with href is used, it will be mapped to <Link>
    if (node.tag === 'a' && node.props?.href !== undefined) {
      componentTags.add('Link');
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  for (const n of nodes) {
    walk(n);
  }
  return componentTags;
}

/** Convert IngestedNode to generator AddNodeDef recursively */
function ingestedToNodeDef(node: IngestedNode): AddNodeDef {
  const styles: Record<string, string> = {};
  if (node.styles) {
    for (const [k, v] of Object.entries(node.styles)) {
      styles[k] = String(v);
    }
  }

  // Revyme Invariant: Newly inserted styled nodes must carry explicit position
  // to avoid dropping out of flow or leaking master absolute styles.
  const isSvgChild = SVG_SHAPE_TAGS.has(node.tag);
  if (!styles.position && !isSvgChild) {
    styles.position = 'relative';
  }

  // MINMAX_SIZE_UNIT: size panel min/max fields only accept concrete px or % values
  for (const dim of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
    if (styles[dim] && styles[dim].includes('var(--dp-spacing-max)')) {
      styles[dim] = styles[dim].replace(/var\(--dp-spacing-max\)/g, '1360px');
    }
  }

  const attrs: Record<string, string> = {};
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'data-id' || k === 'style' || k === 'data-name') continue;
      attrs[k] = String(v);
    }
  }

  // Pin absolute nodes explicitly per Oracle rule PIN_ABSOLUTE_NODE
  if (styles.position === 'absolute' && !attrs['data-pinned']) {
    attrs['data-pinned'] = 'true';
  }

  // Oracle PAGE_LINK_NOT_NEXTLINK: a navigating link on a page must be Next.js <Link>
  let tag = node.tag;
  if (tag === 'a' && (attrs.href !== undefined || node.props?.href !== undefined)) {
    tag = 'Link';
  }

  const children: AddNodeDef[] = [];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      children.push(ingestedToNodeDef(child));
    }
  }

  return {
    id: node.id,
    type: tag,
    name: node.name || (node.props?.['data-name'] as string) || (tag.charAt(0).toUpperCase() + tag.slice(1)),
    styles,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    textContent: node.text,
    children: children.length > 0 ? children : undefined,
  };
}

/** Collect all node IDs generated/used in the ingested tree */
function collectNodeIds(nodes: IngestedNode[]): string[] {
  const ids: string[] = [];
  function walk(n: IngestedNode) {
    ids.push(n.id);
    if (n.children) {
      for (const c of n.children) walk(c);
    }
  }
  for (const n of nodes) walk(n);
  return ids;
}

export const fragmentsInsertInputSchema = z.object({
  targetFile: z.string().optional().describe('Target page file path (defaults to page.client.tsx or primary page)'),
  filePath: z.string().optional().describe('Alias for targetFile'),
  parentId: z.string().min(1).describe('Parent node data-id to insert fragment into (e.g. "root")'),
  fragment: z.string().min(1).describe('JSX fragment string containing HTML tags and/or Design Components'),
  insertIndex: z.number().int().nonnegative().optional().describe('Zero-based child index to insert at (appends at end if omitted)'),
});

export const fragmentsInsertOperation: Operation<
  z.infer<typeof fragmentsInsertInputSchema>,
  {
    rootId: string;
    insertedIds: string[];
    targetFile: string;
    changes: FileChange[];
  }
> = {
  name: 'fragments.insert',
  description: 'Insert a semantic JSX fragment (HTML elements and/or Design Components) into a parent container on the canvas',
  category: 'fragments',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: fragmentsInsertInputSchema,
  async execute(snapshot, input) {
    const targetFilePath = input.targetFile || input.filePath;
    const { path, code: initialCode } = getTargetFile(snapshot, targetFilePath);
    let targetCode = initialCode;

    const existingNodes = parseJSXToNodes(targetCode);
    if (!existingNodes.has(input.parentId)) {
      throw new Error(`PARENT_NOT_FOUND: Parent node "${input.parentId}" not found in "${path}"`);
    }

    const idManager = new IdManager(existingNodes.keys());
    const reporter = new IngestionReporter();
    const ingestedNodes = ingestJSXNodes(input.fragment, idManager, {}, reporter);

    if (ingestedNodes.length === 0) {
      const issues = reporter.getIssues().map((i) => i.message).join('; ');
      throw new Error(`INVALID_FRAGMENT: Failed to parse JSX fragment. ${issues || 'No valid root JSX elements found.'}`);
    }

    const changes: FileChange[] = [];

    // Resolve component tags used inside the fragment
    const compTags = collectComponentTags(ingestedNodes);
    for (const tag of compTags) {
      // Check for Next.js framework components first
      if (FRAMEWORK_COMPONENTS[tag]) {
        const fw = FRAMEWORK_COMPONENTS[tag];
        targetCode = ensureNamedImport(targetCode, fw.module, [], { ensureDefault: fw.defaultSpec });
        continue;
      }

      const compPath = `components/${tag}.tsx`;
      const compExists = snapshot.files.has(compPath) || snapshot.files.has(`src/${compPath}`);

      if (!compExists) {
        const builtIn = BUILT_IN_COMPONENTS.find(([p]) => p === compPath);
        if (builtIn) {
          changes.push({
            path: builtIn[0],
            beforeHash: null,
            content: builtIn[1],
          });
        } else {
          throw new Error(
            `COMPONENT_NOT_FOUND: Component "<${tag}>" referenced in JSX fragment was not found in "components/". ` +
            `Create it first using "components.create" or "codeFiles.submit", or use standard HTML tags.`
          );
        }
      }

      targetCode = ensureComponentImport(targetCode, tag);
    }

    // Ensure framer-motion import if motion tags are present
    if (input.fragment.includes('<motion.')) {
      targetCode = ensureNamedImport(targetCode, 'framer-motion', ['motion']);
    }

    // Insert nodes sequentially into parent
    let currentIndex = input.insertIndex;
    for (const node of ingestedNodes) {
      const nodeDef = ingestedToNodeDef(node);
      targetCode = addNodeInCode(targetCode, input.parentId, nodeDef, currentIndex);
      if (currentIndex !== undefined) {
        currentIndex++;
      }
    }

    targetCode = ensureFlowChildOrder(targetCode, input.parentId);

    changes.unshift({
      path,
      beforeHash: null,
      content: targetCode,
    });

    return {
      rootId: ingestedNodes[0].id,
      insertedIds: collectNodeIds(ingestedNodes),
      targetFile: path,
      changes,
    };
  },
};

defaultRegistry.register(fragmentsInsertOperation);
defaultRegistry.registerAlias('fragment.insert', 'fragments.insert');
defaultRegistry.registerAlias('fragments.create', 'fragments.insert');
defaultRegistry.registerAlias('sections.insertFragment', 'fragments.insert');
