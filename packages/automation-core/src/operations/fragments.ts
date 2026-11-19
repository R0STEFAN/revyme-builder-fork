// packages/automation-core/src/operations/fragments.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes, type CanvasNode } from '@/code/parsing/parser';
import { addNodeInCode, updateNodeInCode, removeNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { ensureNamedImport } from '@/code/generation/generator-utils';
import { SVG_SHAPE_TAGS } from '@/shared/constants';
import { ingestJSXNodes } from '../ingestion/jsx';
import { IdManager } from '../ingestion/ids';
import { IngestionReporter } from '../ingestion/report';
import type { IngestedNode } from '../ingestion/tree';
import { ensureComponentImport } from './components';
import { BUILT_IN_COMPONENTS } from '@/code/project/project-fs';
import { parsePresetTokens } from '@/code/generation/preset-gen';
import { groupTypographyPresets, upsertTypographyResponsiveBlock, type TypoPreset } from './typography';

import { parseCanvasConfig, updateCanvasConfigInCode } from '@/code/project/canvas-config';
import { DEFAULT_VIEWPORTS } from './viewports';
import { VIEWPORT_GAP } from '@/shared/constants';
import { wireFormSubmitInCode, FORM_ROUTE_PATH, FORM_ROUTE_CONTENT } from '@/code/generation/form-gen';
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

function ensureFlowChildOrder(code: string, parentId: string, resequence = false): string {
  const nodes = parseJSXToNodes(code);
  const parent = nodes.get(parentId);
  const display = parent?.styles.display;
  if (!parent || !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display || '')) return code;

  const flowChildren = parent.children
    .map((childId) => nodes.get(childId))
    .filter((child): child is CanvasNode => !!child && child.styles.position !== 'absolute' && child.styles.position !== 'fixed');

  let nextCode = code;
  if (resequence) {
    flowChildren.forEach((child, idx) => {
      const targetOrder = String(idx);
      const existing = child.styles.order;
      const isPlainOrMissing = existing === undefined || existing === '' || /^-?\d+$/.test(existing);
      if (isPlainOrMissing && existing !== targetOrder) {
        nextCode = updateNodeInCode(nextCode, child.id, { order: targetOrder });
      }
    });
    return nextCode;
  }

  const explicitOrders = flowChildren
    .map((child) => Number(child.styles.order))
    .filter(Number.isFinite);
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

function resolvePresetForNode(
  node: IngestedNode,
  attrs: Record<string, string>,
  styles: Record<string, string>,
  presets: TypoPreset[]
): TypoPreset | null {
  if (presets.length === 0) return null;

  // 1. Explicit preset attributes: preset="...", data-typography-preset="...", typographyPreset="...", typography="..."
  const explicit =
    attrs['preset'] ||
    attrs['data-typography-preset'] ||
    attrs['typographyPreset'] ||
    attrs['typography'];
  if (explicit) {
    if (explicit.toLowerCase() === 'none') return null;
    const clean = explicit.replace(/^--/, '').replace(/^typo-/, '').trim();
    const found = presets.find((p) => p.name === clean);
    if (found) return found;
  }

  // 2. Check if styles already reference a preset var (--typo-<name>-font)
  const ff = styles.fontFamily || '';
  const match = ff.match(/var\(--typo-([a-zA-Z0-9_-]+)-font\)/);
  if (match) {
    const found = presets.find((p) => p.name === match[1]);
    if (found) return found;
  }

  // 3. Smart SSOT inference for semantic text tags when custom presets exist
  const tag = node.tag.toLowerCase();
  const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span']);
  if (TEXT_TAGS.has(tag)) {
    // Prefer custom presets over generic starter presets ('heading', 'body')
    const customPresets = presets.filter((p) => p.name !== 'heading' && p.name !== 'body');
    const candidatePool = customPresets.length > 0 ? customPresets : presets;

    // Spans with mono font or uppercase telemetry
    if (tag === 'span' && (styles.fontFamily?.includes('mono') || styles.textTransform === 'uppercase')) {
      const monoPreset = candidatePool.find(
        (p) => p.name.includes('mono') || p.name.includes('telemetry') || p.tag === 'span'
      );
      if (monoPreset) return monoPreset;
    }

    // Match by tag
    const tagMatches = candidatePool.filter((p) => p.tag === tag);
    if (tagMatches.length === 1) {
      return tagMatches[0];
    }
    if (tagMatches.length > 1) {
      if (styles.fontFamily) {
        const fontMatch = tagMatches.find(
          (p) => p.values.font === styles.fontFamily || styles.fontFamily.includes(p.name)
        );
        if (fontMatch) return fontMatch;
      }
      return tagMatches[0];
    }
  }

  return null;
}

/** Convert IngestedNode to generator AddNodeDef recursively */
function ingestedToNodeDef(
  node: IngestedNode,
  presets: TypoPreset[] = [],
  responsiveRulesMap: Map<string, string[]> = new Map()
): AddNodeDef {
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

  // Resolve and bind typography preset (SSOT)
  const matchedPreset = resolvePresetForNode(node, attrs, styles, presets);
  if (matchedPreset) {
    // Strip temporary preset attributes from node attrs
    delete attrs['preset'];
    delete attrs['data-typography-preset'];
    delete attrs['typographyPreset'];
    delete attrs['typography'];

    const cleanName = matchedPreset.name;
    styles.fontFamily = `var(--typo-${cleanName}-font)`;
    styles.fontSize = `var(--typo-${cleanName}-size)`;
    styles.fontWeight = `var(--typo-${cleanName}-weight)`;
    styles.color = `var(--typo-${cleanName}-color)`;
    styles.lineHeight = `var(--typo-${cleanName}-line-height)`;
    styles.letterSpacing = `var(--typo-${cleanName}-spacing)`;
    styles.textTransform = `var(--typo-${cleanName}-transform)`;
    styles.textDecoration = `var(--typo-${cleanName}-decoration)`;
    styles.textShadow = `var(--typo-${cleanName}-shadow)`;

    if (matchedPreset.values['stroke-width']) {
      styles.WebkitTextStrokeWidth = `var(--typo-${cleanName}-stroke-width)`;
      styles.WebkitTextStrokeColor = `var(--typo-${cleanName}-stroke-color)`;
      delete styles.WebkitTextStroke;
    }

    // Collect responsive tiers if present
    if (matchedPreset.responsiveTiers.md?.size || matchedPreset.responsiveTiers.sm?.size) {
      const minDefault = Number(matchedPreset.values['min-default'] || 1200);
      const minMd = Number(matchedPreset.values['min-md'] || 600);
      const rules: string[] = [];
      if (matchedPreset.responsiveTiers.md?.size) {
        rules.push(
          `@media (max-width: ${minDefault - 1}px) { [data-id="${node.id}"] { font-size: var(--typo-${cleanName}-size-md) !important; } }`
        );
      }
      if (matchedPreset.responsiveTiers.sm?.size) {
        rules.push(
          `@media (max-width: ${minMd - 1}px) { [data-id="${node.id}"] { font-size: var(--typo-${cleanName}-size-sm) !important; } }`
        );
      }
      if (rules.length > 0) {
        responsiveRulesMap.set(node.id, rules);
      }
    }
  }

  // Pin absolute nodes explicitly per Oracle rule PIN_ABSOLUTE_NODE
  if (styles.position === 'absolute' && !attrs['data-pinned']) {
    attrs['data-pinned'] = 'true';
  }

  // Ensure form elements satisfy Oracle rules (destination and field naming)
  const lowerTag = node.tag.toLowerCase();
  if (lowerTag === 'form' || lowerTag === 'motion.form') {
    if (!attrs['data-form']) {
      attrs['data-form'] = '{"sendTo":[{"id":"default","type":"email","recipient":"team@example.com","subject":"New Form Submission"}]}';
    }
  }

  if (
    lowerTag === 'input' ||
    lowerTag === 'textarea' ||
    lowerTag === 'select' ||
    lowerTag === 'motion.input' ||
    lowerTag === 'motion.textarea' ||
    lowerTag === 'motion.select'
  ) {
    if (!attrs['name']) {
      attrs['name'] = (node.props?.name as string) || (node.props?.type as string) || (node.props?.id as string) || 'field';
    }
  }

  // Oracle PAGE_LINK_NOT_NEXTLINK: a navigating link on a page must be Next.js <Link>
  let tag = node.tag;
  if (tag === 'a' && (attrs.href !== undefined || node.props?.href !== undefined)) {
    tag = 'Link';
  }

  const children: AddNodeDef[] = [];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      children.push(ingestedToNodeDef(child, presets, responsiveRulesMap));
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

/** Collect all form node IDs generated/used in the ingested tree */
function collectFormIds(nodes: IngestedNode[]): string[] {
  const formIds: string[] = [];
  function walk(n: IngestedNode) {
    const t = n.tag.toLowerCase();
    if (t === 'form' || t === 'motion.form') {
      formIds.push(n.id);
    }
    if (n.children) {
      for (const c of n.children) walk(c);
    }
  }
  for (const n of nodes) walk(n);
  return formIds;
}

export const fragmentsInsertInputSchema = z.object({
  targetFile: z.string().optional().describe('Target page file path (defaults to page.client.tsx or primary page)'),
  filePath: z.string().optional().describe('Alias for targetFile'),
  parentId: z.string().min(1).optional().describe('Parent container data-id to insert fragment into (e.g. "root"). Optional when targetId is provided.'),
  targetId: z.string().min(1).optional().describe('Reference node data-id for relative placement (used with "where").'),
  where: z.enum(['before', 'after', 'prepend', 'append', 'inside']).optional().describe('Placement relative to targetId (or inside parentId): "before" / "after" sibling of targetId, or "prepend" / "append" / "inside" container.'),
  fragment: z.string().min(1).describe('JSX fragment string containing HTML tags and/or Design Components. Standard CSS units (px, rem, em, %, clamp()) and native lists (ul/ol/li) are supported and auto-healed on ingestion.'),
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
  description: 'Insert a semantic JSX fragment (HTML elements and/or Design Components) into a container or relative to targetId ("before", "after", "prepend", "append", "inside"). Automatically mints data-ids and auto-heals inline styles for one-shot Oracle compliance.',
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

    let resolvedParentId: string;
    let insertBeforeId: string | undefined;
    let initialIndex: number | undefined = input.insertIndex;
    let needsResequence = false;

    if (input.targetId) {
      const targetNode = existingNodes.get(input.targetId);
      if (!targetNode) {
        throw new Error(`TARGET_NOT_FOUND: Target node "${input.targetId}" not found in "${path}"`);
      }
      const where = input.where ?? (input.parentId ? 'after' : 'inside');
      if (where === 'before' || where === 'after') {
        const parentId = targetNode.parentId || input.parentId;
        if (!parentId || !existingNodes.has(parentId)) {
          throw new Error(`PARENT_NOT_FOUND: Cannot insert "${where}" node "${input.targetId}" without a valid parent in "${path}"`);
        }
        resolvedParentId = parentId;
        const parentNode = existingNodes.get(parentId)!;
        const targetIdx = parentNode.children.indexOf(input.targetId);
        if (where === 'before') {
          insertBeforeId = input.targetId;
          initialIndex = undefined;
        } else {
          insertBeforeId =
            targetIdx !== -1 && targetIdx + 1 < parentNode.children.length
              ? parentNode.children[targetIdx + 1]
              : undefined;
          initialIndex = undefined;
        }
        needsResequence = true;
      } else if (where === 'prepend') {
        resolvedParentId = input.targetId;
        initialIndex = 0;
        needsResequence = true;
      } else {
        resolvedParentId = input.targetId;
        if (initialIndex !== undefined) needsResequence = true;
      }
    } else {
      if (!input.parentId) {
        throw new Error('PARENT_NOT_FOUND: Either "parentId" or "targetId" must be provided for fragments.insert');
      }
      if (!existingNodes.has(input.parentId)) {
        throw new Error(`PARENT_NOT_FOUND: Parent node "${input.parentId}" not found in "${path}"`);
      }
      if (input.where === 'before' || input.where === 'after') {
        throw new Error(`TARGET_REQUIRED: Placement "where: '${input.where}'" requires "targetId"`);
      }
      resolvedParentId = input.parentId;
      if (input.where === 'prepend') {
        initialIndex = 0;
        needsResequence = true;
      } else if (initialIndex !== undefined) {
        needsResequence = true;
      }
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

    const globalsCSS = snapshot.files.get('app/globals.css') ?? '';
    const typographyPresets = groupTypographyPresets(parsePresetTokens(globalsCSS));
    const responsiveRulesMap = new Map<string, string[]>();

    // Insert nodes sequentially into resolved parent
    let currentIndex = initialIndex;
    for (const node of ingestedNodes) {
      const nodeDef = ingestedToNodeDef(node, typographyPresets, responsiveRulesMap);
      targetCode = addNodeInCode(targetCode, resolvedParentId, nodeDef, currentIndex, insertBeforeId);
      if (currentIndex !== undefined) {
        currentIndex++;
      }
    }

    targetCode = ensureFlowChildOrder(targetCode, resolvedParentId, needsResequence);

    // Wire submit handlers on any inserted forms and ensure the relay route exists
    const formIds = collectFormIds(ingestedNodes);
    if (formIds.length > 0) {
      for (const fId of formIds) {
        targetCode = wireFormSubmitInCode(targetCode, fId);
      }
      if (!snapshot.files.has(FORM_ROUTE_PATH)) {
        changes.push({
          path: FORM_ROUTE_PATH,
          beforeHash: null,
          content: FORM_ROUTE_CONTENT,
        });
      }
    }

    if (responsiveRulesMap.size > 0) {
      for (const [nodeId, rules] of responsiveRulesMap.entries()) {
        targetCode = upsertTypographyResponsiveBlock(targetCode, nodeId, rules.join('\n'));
      }
    }

    // Ensure canvas declared viewports cover standard responsive breakpoints (tablet 810, mobile 390)
    // if the page includes responsive styles/rules.
    const canvas = parseCanvasConfig(targetCode);
    if (canvas && canvas.viewports && canvas.viewports.length > 0) {
      let viewports = [...canvas.viewports];
      let positions = { ...canvas.positions };
      let changed = false;

      for (const stdVp of DEFAULT_VIEWPORTS) {
        const exists = viewports.some(
          (v) =>
            v.id.toLowerCase() === stdVp.id.toLowerCase() ||
            v.label.toLowerCase() === stdVp.name.toLowerCase() ||
            v.width === stdVp.width ||
            v.designWidth === stdVp.width
        );
        if (!exists) {
          const rightmost = viewports.reduce((right, v) => {
            const pos = positions[v.id] ?? { x: 0, y: 0 };
            const renderedW = v.designWidth ?? v.width;
            return Math.max(right, pos.x + renderedW);
          }, 0);

          const added = {
            id: stdVp.id,
            label: stdVp.name,
            width: stdVp.width,
            isPrimary: false,
            order: Math.max(-1, ...viewports.map((v) => v.order ?? 0)) + 1,
            x: rightmost + VIEWPORT_GAP,
            y: 0,
          };
          viewports.push(added);
          positions[stdVp.id] = { x: added.x, y: added.y };
          changed = true;
        }
      }

      if (changed) {
        targetCode = updateCanvasConfigInCode(targetCode, { viewports, positions });
      }
    }

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

export const fragmentsReplaceInputSchema = z.object({
  targetFile: z.string().optional().describe('Target page file path (defaults to page.client.tsx or primary page)'),
  filePath: z.string().optional().describe('Alias for targetFile'),
  targetId: z.string().min(1).describe('Existing node data-id to atomically replace in place'),
  fragment: z.string().min(1).describe('Replacement JSX fragment string (HTML tags and/or Design Components). Auto-healed on ingestion.'),
});

export const fragmentsReplaceOperation: Operation<
  z.infer<typeof fragmentsReplaceInputSchema>,
  {
    rootId: string;
    insertedIds: string[];
    replacedId: string;
    targetFile: string;
    changes: FileChange[];
  }
> = {
  name: 'fragments.replace',
  description: 'Atomically replace an existing node (identified by targetId) in place with a new JSX fragment, preserving sibling position and cleaning up old node styles/hooks.',
  category: 'fragments',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: fragmentsReplaceInputSchema,
  async execute(snapshot, input, context) {
    const targetFilePath = input.targetFile || input.filePath;
    const { path, code: initialCode } = getTargetFile(snapshot, targetFilePath);
    const existingNodes = parseJSXToNodes(initialCode);
    const targetNode = existingNodes.get(input.targetId);

    if (!targetNode) {
      throw new Error(`TARGET_NOT_FOUND: Target node "${input.targetId}" not found in "${path}"`);
    }

    const parentId = targetNode.parentId;
    if (!parentId || !existingNodes.has(parentId)) {
      throw new Error(`PARENT_NOT_FOUND: Cannot replace root node "${input.targetId}" without a parent container in "${path}"`);
    }

    const insertResult = await fragmentsInsertOperation.execute(
      snapshot,
      {
        targetFile: path,
        parentId,
        targetId: input.targetId,
        where: 'before',
        fragment: input.fragment,
      },
      context
    );

    const updatedChanges = insertResult.changes.map((change) => {
      if (change.path !== path || change.content === null) return change;
      let nextContent = removeNodeInCode(change.content, input.targetId);
      nextContent = ensureFlowChildOrder(nextContent, parentId, true);
      return {
        ...change,
        content: nextContent,
      };
    });

    return {
      rootId: insertResult.rootId,
      insertedIds: insertResult.insertedIds,
      replacedId: input.targetId,
      targetFile: path,
      changes: updatedChanges,
    };
  },
};

defaultRegistry.register(fragmentsReplaceOperation);
defaultRegistry.registerAlias('fragment.replace', 'fragments.replace');
