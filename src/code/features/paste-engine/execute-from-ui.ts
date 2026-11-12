// execute-from-ui.ts — UI convenience entry for the paste engine.
//
// Builds the engine's rich `PasteContext` params (container rect, interacting
// viewport, active file, viewport widths) from the editor's imperative state,
// then runs `executePaste` and applies the flush-before-select ordering.
// This is the ONE public convenience entry for UI call-sites (shortcuts,
// context menu, menu bar, canvas commands); the lower-level orchestrator at
// `paste-engine/paste` stays available for callers that build their own params.
//
// CROSS-PROJECT pastes take a detour here: the clipboard's component masters
// are shared to the CDN and linked (or materialized locally in standalone)
// BEFORE the nodes are written, so instance tags resolve in the target
// project instead of pasting as undefined identifiers. Same-project pastes
// stay fully synchronous.

import { toast } from 'sonner';
import type { CanvasNode } from '../../parsing/parser';
import { transformManager } from '@/canvas/transform';
import { getInteractingViewport, getActiveFilePath, findNodeComputedStyle } from '@/canvas/node-ops';
import { getViewportWidths } from '@/code/stores/viewport-store';
import { flushNow } from '@/code/mutation/mutation-queue';
import { trace } from '@/shared/debug-trace';
import {
  isCrossProjectPaste, stripExpandedInternals, linkClipboardComponents,
  ensureLocalComponentImports, applyTagRenames,
} from '@/cloud/components/cross-project-paste';
import { executePaste as engineExecutePaste } from './paste';
import { getClipboardData } from './copy';
import type { ClipboardData, PasteResult } from './types';

/**
 * Old executePaste signature — kept for back-compat with shortcuts.ts and
 * ContextMenu.tsx. The engine exposes a richer API at
 * `paste-engine.executePaste`; callers that need it should use that.
 *
 * `contentEl` and `handleNodeMouseDown` are accepted but ignored — the
 * engine now goes through the mutation queue, not direct DOM.
 */

// ─── UI follow-up hooks ──────────────────────────────────────────────────────
// This module has no React store access (the app runs under <Provider>), so
// Canvas registers the follow-ups that need atoms. Today: entering overlay
// edit mode on an overlay the paste just ATTACHED to the selection.
export interface PasteUiHooks { enterOverlayEdit?: (overlayId: string) => void }
let pasteUiHooks: PasteUiHooks | null = null;
export function setPasteUiHooks(hooks: PasteUiHooks | null): void { pasteUiHooks = hooks; }

export function executePaste(
  nodes: Map<string, CanvasNode>,
  contentEl: HTMLElement | null,
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
  _handleNodeMouseDown: (nodeId: string, e: MouseEvent) => void,
  options?: { forcePosition?: { x: number; y: number } },
): void {
  // Read container size for 'visible-center' math. We query
  // `[data-canvas-viewport]` (the outer wrapper that holds the iframe + grid)
  // — NOT `[data-content-root]`, which is a `display: none` anchor sized 0×0
  // and would make the engine fall back to the (100, 100) default position.
  // This was the "paste lands near origin" bug for no-selection pastes.
  const viewportEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
  const el = viewportEl ?? contentEl;
  const rect = el?.getBoundingClientRect();

  // Pull replica context from the imperative module-level state pushed by
  // Canvas.tsx via setStyleContext(). DO NOT use getDefaultStore() here —
  // the app uses <Provider> so the default store is empty.
  const { vpId: interactingVpId } = getInteractingViewport();
  const activeFilePath = getActiveFilePath();

  const runEngine = (overrideClipboard?: ClipboardData): PasteResult =>
    engineExecutePaste({
      selectedIds: selectedId ? [selectedId] : [],
      nodes,
      transform: transformManager.getTransform(),
      containerWidth: rect?.width,
      containerHeight: rect?.height,
      interactingVpId,
      viewportWidths: getViewportWidths(),
      activeFilePath,
      overrideClipboard,
      parentHasLayout: resolveParentHasLayout(nodes, selectedId ?? undefined, interactingVpId),
      forcePosition: options?.forcePosition,
    });

  // Mirror old behaviour: select the first newly-created node so the user
  // can immediately tweak it.
  //
  // CRITICAL: flush the mutation queue BEFORE setting selection. Otherwise
  // the PropertiesPanel sees `selectedId` set to a node that doesn't exist
  // in the parsed nodes map yet — it unmounts its content (panel "disappears")
  // and remounts on the next render after flush ("reappears"). The visible
  // result is a one-frame flash on every paste.
  const finish = (result: PasteResult, skipSuccessToast?: boolean): void => {
    if (!result.success) {
      toast.error(result.message || 'Paste failed');
      return;
    }
    if (result.success && result.createdIds.length > 0) {
      flushNow();
      setSelectedId(result.createdIds[0]);
      if (result.attachedOverlayId) {
        trace.action('paste:enter-overlay-edit', { overlayId: result.attachedOverlayId, hooked: !!pasteUiHooks?.enterOverlayEdit });
        pasteUiHooks?.enterOverlayEdit?.(result.attachedOverlayId);
      }
      if (!skipSuccessToast) {
        toast.success(`Pasted ${result.createdIds.length} element${result.createdIds.length > 1 ? 's' : ''}`);
      }
    }
  };

  const raw = getClipboardData();
  if (!raw) {
    // Empty/unparseable clipboard — let the engine surface its own toast.
    finish(runEngine());
    return;
  }

  // Select-all copies sweep a design instance's EXPANDED internals in as
  // individual roots (ids `instance:masterNode`) — drop them; the instance
  // tag carries everything.
  const data: ClipboardData = { ...raw, nodes: stripExpandedInternals(raw.nodes) };

  if (!isCrossProjectPaste(data)) {
    // Same project. Cross-PAGE pastes may still need the instances' import
    // lines in the target file (and two-standalone-projects pastes may need
    // the masters materialized) — both synchronous.
    let renames = new Map<string, string>();
    try {
      renames = ensureLocalComponentImports(data, activeFilePath);
    } catch (err) {
      trace.error('paste:ensure-local-imports-failed', err);
    }
    finish(runEngine({ ...data, nodes: applyTagRenames(data.nodes, renames) }));
    return;
  }

  // Cross-project: share (cloud) or materialize (standalone) every master,
  // inject the imports, THEN paste with the resolved tag names. Async — the
  // toast keeps the wait honest; content lands selected exactly like a
  // normal paste when the linking finishes.
  const count = data.components!.length;
  trace.action('paste:cross-project-start', { components: count, from: data.sourceProjectId });
  const tId = toast.loading(`Linking ${count} component${count === 1 ? '' : 's'}…`);
  void linkClipboardComponents(data, activeFilePath)
    .then((link) => {
      finish(runEngine({ ...data, nodes: applyTagRenames(data.nodes, link.tagRenames) }), true);
      if (link.failed.length > 0) {
        toast.error(`Pasted, but ${link.failed.length} component${link.failed.length === 1 ? '' : 's'} could not be linked: ${link.failed.join(', ')}`, { id: tId, duration: 6000 });
      } else if (link.linked > 0) {
        toast.success(`${link.linked} component${link.linked === 1 ? '' : 's'} linked from the source project`, { id: tId });
      } else {
        toast.success(`${link.materialized} component${link.materialized === 1 ? '' : 's'} copied into this project`, { id: tId });
      }
    })
    .catch((err) => {
      trace.error('paste:cross-project-failed', err);
      // Degrade to the old behavior rather than swallowing the paste.
      finish(runEngine(data));
      toast.error('Component linking failed — pasted without linking', { id: tId });
    });
}

/**
 * Does the selected node's PARENT lay its children out, ON THE VIEWPORT THE
 * USER IS EDITING?
 *
 * `node.styles.display` is the base style, and a frame added on one replica is
 * stored hidden there (`display: 'none'` plus a band rule that shows it as a
 * flex container) — so the base says "no layout" for a perfectly good flex
 * parent. Cmd+D on a flex child inside a mobile overlay then matched the
 * no-layout paste rule and produced an absolute node (user report 2026-09-18,
 * same root cause as the Add-Layout bug on those frames). The rendered
 * element's computed display is the truth; `undefined` when it can't be read,
 * which leaves the engine on its base-style fallback.
 */
export function resolveParentHasLayout(
  nodes: Map<string, CanvasNode>,
  selectedId: string | undefined,
  vpId: string,
): boolean | undefined {
  if (!selectedId) return undefined;
  const parentId = nodes.get(selectedId)?.parentId;
  if (!parentId) return undefined;
  const display = findNodeComputedStyle(parentId, vpId, 'display');
  if (!display) return undefined;
  return /^(inline-)?(flex|grid)$/.test(display);
}
