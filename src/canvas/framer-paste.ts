// framer-paste.ts — receive an "Import to Revyme" Framer clipboard.
//
// Reads Framer clipboard data (either from our Chrome extension with
// data-revyme-framer-import or standard Framer copy with data-framer-pasteboard / clean JSON),
// converts it to Revyme ClipboardData, and executes paste via the paste-engine.

import { useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { executePaste as engineExecutePaste } from '@/code/features/paste-engine';
import { convertFramerPayload } from '@/code/import/framer/convert';
import { transformManager } from './transform';
import { getInteractingViewport, getActiveFilePath, forceCanvasRender } from './node-ops';
import { getViewportWidths } from '@/code/stores/viewport-store';
import { selectedIdsAtom, nodesAtom, codeAtom } from '@/code/stores/store';
import { projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { activeFilePathAtom, isPageServerFile, getPageClientPath } from '@/code/project/active-file-store';
import { flushNow } from '@/code/mutation/mutation-queue';
import { loadGoogleFont } from '@/shared/font-loader';
import { ensureGoogleFontImport } from '@/code/project/preset-ops';
import { toast } from 'sonner';
import { trace } from '@/shared/debug-trace';
import type { CanvasNode } from '@/code/parsing/parser';

/** Read the clipboard and extract the Framer payload. */
export async function readFramerClipboard(): Promise<any | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return null;
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    trace.error('framer-paste:clipboard-read-failed', { error: String(err) });
    return null;
  }

  // 1. Check text/html flavor
  for (const item of items) {
    if (item.types.includes('text/html')) {
      try {
        const html = await (await item.getType('text/html')).text();

        // Custom marker from our extension (supports both data-revyme-framer-import and data-revyme-import)
        const revymeMatch = html.match(/data-revyme-framer-import="([^"]*)"/) || html.match(/data-revyme-import="([^"]*)"/);
        if (revymeMatch) {
          const decoded = decodeURIComponent(revymeMatch[1]);
          return JSON.parse(decoded);
        }

        // Standard Framer pasteboard
        const framerMatch = html.match(/data-framer-pasteboard="([^"]*)"/);
        if (framerMatch) {
          const unescaped = framerMatch[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          return JSON.parse(unescaped);
        }
      } catch (err) {
        trace.error('framer-paste:html-parse-failed', { error: String(err) });
      }
    }
  }

  // 2. Check text/plain flavor
  for (const item of items) {
    if (item.types.includes('text/plain')) {
      try {
        const text = await (await item.getType('text/plain')).text();
        if (text.startsWith('{')) {
          try {
            const parsed = JSON.parse(text);
            if (parsed?.revymeClipboard === 1 || parsed?.root?.children || parsed?.layers?.tree?.root || parsed?.version === 128) {
              return parsed;
            }
          } catch {}
        }
      } catch {
        // Not a JSON
      }
    }
  }

  return null;
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

export interface FramerImportBridgeRefs {
  nodesRef: { current: Map<string, CanvasNode> };
  selectedIdRef: { current: string | null };
  selectedIdsRef: { current: string[] };
  contentRef: { current: HTMLElement | null };
  setSelectedIds: (ids: string[]) => void;
  handleNodeMouseDown?: (nodeId: string, e: MouseEvent) => void;
}

let activeBridgeRefs: FramerImportBridgeRefs | null = null;

/** Hook mounted in Canvas.tsx to register window.__REVYME_IMPORT_FRAMER__ */
export function useFramerImportBridge(refs: FramerImportBridgeRefs): void {
  useEffect(() => {
    activeBridgeRefs = refs;

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'REVYME_IMPORT_FRAMER') {
        void handleFramerImport(e.data.payload);
      }
    };

    const handleCustomEvent = (e: CustomEvent) => {
      if (e.detail) {
        void handleFramerImport(e.detail);
      }
    };

    (window as any).__REVYME_IMPORT_FRAMER__ = handleFramerImport;
    window.addEventListener('message', handleMessage);
    window.addEventListener('revyme:import-framer', handleCustomEvent as EventListener);

    return () => {
      activeBridgeRefs = null;
      delete (window as any).__REVYME_IMPORT_FRAMER__;
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('revyme:import-framer', handleCustomEvent as EventListener);
    };
  }, [refs]);
}

export interface FramerImportBundleFile {
  path: string;
  content: string;
  kind?: 'page' | 'component' | 'template' | 'data';
}

export interface FramerImportBundle {
  files?: FramerImportBundleFile[];
}

/** Download remote Framer images and upload locally into the project via /api/upload. */
async function localizeRemoteImages(
  files: FramerImportBundleFile[],
  tsx?: string
): Promise<{ files: FramerImportBundleFile[]; tsx?: string }> {
  if (typeof fetch !== 'function') return { files, tsx };
  const urlRegex = /https:\/\/framerusercontent\.com\/images\/[a-zA-Z0-9_\-]+\.(?:png|jpg|jpeg|webp|svg|gif)/g;
  const foundUrls = new Set<string>();

  for (const f of files) {
    if (typeof f.content === 'string') {
      const matches = f.content.match(urlRegex);
      if (matches) for (const m of matches) foundUrls.add(m);
    }
  }
  if (tsx) {
    const matches = tsx.match(urlRegex);
    if (matches) for (const m of matches) foundUrls.add(m);
  }

  if (foundUrls.size === 0) return { files, tsx };

  const urlMap = new Map<string, string>();
  for (const remoteUrl of foundUrls) {
    try {
      const res = await fetch(remoteUrl);
      if (!res.ok) continue;
      const blob = await res.blob();
      const filename = remoteUrl.split('/').pop()?.split('?')[0] || `framer-asset-${Date.now()}.png`;

      const uploadRes = await fetch(`/api/upload?filename=${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      });

      if (uploadRes.ok) {
        const json = await uploadRes.json();
        if (json?.url) {
          urlMap.set(remoteUrl, json.url);
        }
      }
    } catch (err) {
      trace.error('framer-paste:localize-image-failed', { remoteUrl, error: String(err) });
    }
  }

  if (urlMap.size === 0) return { files, tsx };

  const updatedFiles = files.map((f) => {
    let content = f.content;
    for (const [remote, local] of urlMap.entries()) {
      content = content.split(remote).join(local);
    }
    return { ...f, content };
  });

  let updatedTsx = tsx;
  if (updatedTsx) {
    let res = updatedTsx;
    for (const [remote, local] of urlMap.entries()) {
      res = res.split(remote).join(local);
    }
    updatedTsx = res;
  }

  return { files: updatedFiles, tsx: updatedTsx };
}

/** Full receive flow: convert → load fonts → paste via the engine or replace page TSX */
export async function handleFramerImport(params: {
  mode?: 'paste' | 'replace';
  clipboard?: any;
  tsx?: string;
  payload?: any;
  bundle?: FramerImportBundle;
  files?: FramerImportBundleFile[];
}): Promise<boolean> {
  const store = getDefaultStore();
  let tsx = params.tsx || params.payload?.tsx || params.payload?.fullTsx || params.clipboard?.tsx;
  const mode = params.mode || (tsx && !params.clipboard && !params.payload ? 'replace' : 'paste');

  // For selection paste mode, resolve and validate clipboard nodes BEFORE writing any files
  let clipboardData: any = null;
  if (mode === 'paste') {
    if (params.clipboard?.revymeClipboard === 1 && params.clipboard.data) {
      clipboardData = params.clipboard.data;
    } else if (params.clipboard?.nodes) {
      clipboardData = params.clipboard;
    } else if (params.payload?.revymeClipboard === 1 && params.payload.data) {
      clipboardData = params.payload.data;
    } else if (params.payload?.nodes) {
      clipboardData = params.payload;
    } else if (params.payload) {
      clipboardData = convertFramerPayload(params.payload);
    }

    if (!clipboardData || !clipboardData.nodes || clipboardData.nodes.length === 0) {
      trace.action('framer-paste:no-nodes-refused');
      return false;
    }
  }

  const snapshotBefore = projectFS.getSnapshot();

  // Write any attached component or CMS data files to ProjectFS
  let incomingFiles = params.bundle?.files 
    || params.files 
    || params.payload?.bundle?.files 
    || params.payload?.files 
    || params.clipboard?.bundle?.files 
    || params.clipboard?.files 
    || params.clipboard?.data?.files 
    || params.payload?.data?.files;

  if (Array.isArray(incomingFiles) && incomingFiles.length > 0) {
    try {
      const localized = await localizeRemoteImages(incomingFiles, tsx);
      incomingFiles = localized.files;
      tsx = localized.tsx;
    } catch { /* proceed if localization fails */ }

    const now = new Date().toISOString();
    for (const f of incomingFiles) {
      if (f.path && f.content && !f.path.includes('app/page.')) {
        let contentToWrite = f.content;
        if (f.path.startsWith('cms/') && f.path.endsWith('.json') && !f.path.endsWith('.schema.json')) {
          try {
            const rawItems = JSON.parse(f.content);
            if (Array.isArray(rawItems)) {
              const normalized = rawItems.map((it: any, idx: number) => {
                const id = it._id || it.id || `item_${Date.now().toString(36)}_${idx}`;
                const s = it._slug || it.slug || (it.title ? String(it.title).toLowerCase().replace(/[^a-z0-9]/g, '-') : `item-${idx + 1}`);
                return {
                  ...it,
                  _id: id,
                  id,
                  _slug: s,
                  _status: it._status || 'published',
                  _createdAt: it._createdAt || now,
                  _updatedAt: it._updatedAt || now,
                };
              });
              contentToWrite = JSON.stringify(normalized, null, 2);
            }
          } catch { /* keep original content if parse fails */ }
        }
        projectFS.writeFile(f.path, contentToWrite);
      }
    }

    // Templated page routing: ONLY in 'replace' mode! Never remove Home in selection paste!
    if (mode === 'replace') {
      const templatedPage = incomingFiles.find((f: any) => f.path && f.path.startsWith('app/(') && f.path.endsWith('/page.client.tsx'));
      if (templatedPage) {
        if (projectFS.exists('app/page.client.tsx')) {
          projectFS.deleteFile('app/page.client.tsx');
        }
        if (projectFS.exists('app/page.tsx')) {
          projectFS.deleteFile('app/page.tsx');
        }
        projectFS.writeFile(templatedPage.path, templatedPage.content);
        const serverFile = incomingFiles.find((f: any) => f.path === templatedPage.path.replace(/\.client\.tsx$/, '.tsx'));
        if (serverFile) {
          projectFS.writeFile(serverFile.path, serverFile.content);
        }
        store.set(activeFilePathAtom, templatedPage.path);
        store.set(codeAtom, templatedPage.content);
      }
    }
    store.set(projectVersionAtom, (v) => v + 1);
  }

  // ─── Mode 1: Заміна коду сторінки на чистий Next.js JSX (.tsx) ───────────────
  if (mode === 'replace' && tsx) {
    const toastId = toast.loading('Заміна сторінки кодом з Framer…');
    try {
      flushNow();
      let pagePath = getActiveFilePath() || store.get(activeFilePathAtom) || 'app/page.tsx';
      let clientPath = isPageServerFile(pagePath) ? getPageClientPath(pagePath) : pagePath;

      // If a template route group exists, target the templated page
      const allProjectFiles = projectFS.listFiles();
      const layoutClientFile = allProjectFiles.find((f: string) => /^app\/\([^/]+\)\/LayoutClient\.tsx$/.test(f));
      if (layoutClientFile) {
        const routeGroupMatch = layoutClientFile.match(/^app\/(\([^/]+\))\//);
        if (routeGroupMatch) {
          const routeGroup = routeGroupMatch[1];
          if (projectFS.exists('app/page.client.tsx')) {
            projectFS.deleteFile('app/page.client.tsx');
          }
          if (projectFS.exists('app/page.tsx')) {
            projectFS.deleteFile('app/page.tsx');
          }
          clientPath = `app/${routeGroup}/page.client.tsx`;
          const serverPageCode = `import PageClient from './page.client';\n\nexport default function Page() {\n  return <PageClient />;\n}\n`;
          projectFS.writeFile(`app/${routeGroup}/page.tsx`, serverPageCode);
        }
      }

      let code = tsx;
      // Ensure canvas config header
      if (!code.includes('@canvas')) {
        const canonicalCanvas = '/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }, { "id": "tablet", "label": "Tablet", "width": 810, "height": "auto", "isPrimary": false, "order": 1 }, { "id": "mobile", "label": "Mobile", "width": 390, "height": "auto", "isPrimary": false, "order": 2 } ], "positions": { "desktop": { "x": 0, "y": 0 }, "tablet": { "x": 1360, "y": 0 }, "mobile": { "x": 2330, "y": 0 } } } */\n';
        code = code.replace(/^('use client';\s*)/, `$1\n${canonicalCanvas}\n`);
      }
      // Ensure data-id="root" on the root element
      if (!code.includes('data-id="root"')) {
        code = code.replace(/<([a-zA-Z0-9]+)\s+data-id="[^"]*"/, '<$1 data-id="root"');
      }

      projectFS.writeFile(clientPath, code);
      store.set(activeFilePathAtom, clientPath);
      store.set(codeAtom, code);
      store.set(projectVersionAtom, (v) => v + 1);
      flushNow();
      requestAnimationFrame(() => forceCanvasRender());

      toast.success('🎉 Сторінку успішно оновлено кодом із Framer!', { id: toastId });
      return true;
    } catch (err) {
      trace.error('framer-import:replace-failed', { error: String(err) });
      toast.error('Не вдалося замінити сторінку', { id: toastId });
      return false;
    }
  }

  // ─── Mode 2: Вставка вузлів на полотно/сторінку (як елементи) ─────────────────
  const toastId = toast.loading('Вставка елементів із Framer…');
  try {
    await nextTask();

    if (!clipboardData) {
      if (params.clipboard?.revymeClipboard === 1 && params.clipboard.data) {
        clipboardData = params.clipboard.data;
      } else if (params.clipboard?.nodes) {
        clipboardData = params.clipboard;
      } else if (params.payload?.revymeClipboard === 1 && params.payload.data) {
        clipboardData = params.payload.data;
      } else if (params.payload?.nodes) {
        clipboardData = params.payload;
      } else if (params.payload) {
        clipboardData = convertFramerPayload(params.payload);
      }
    }

    if (!clipboardData || !clipboardData.nodes || clipboardData.nodes.length === 0) {
      projectFS.loadSnapshot(snapshotBefore);
      toast.error('Не знайдено елементів для вставки', { id: toastId });
      return false;
    }

    toast.loading(`Розміщення ${clipboardData.nodes.length} елементів…`, { id: toastId });
    await nextTask();

    // Load any referenced fonts
    const families = new Set<string>();
    for (const n of clipboardData.nodes) {
      const fam = n.styles?.fontFamily;
      if (fam && fam !== 'sans-serif' && fam !== 'serif' && fam !== 'Inter') {
        families.add(fam);
      }
    }
    for (const fam of families) {
      void loadGoogleFont(fam);
      try { ensureGoogleFontImport(fam); } catch { /* no tokens file */ }
    }

    const viewportEl = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    const rect = viewportEl?.getBoundingClientRect();
    const { vpId: interactingVpId } = getInteractingViewport();

    const liveNodes = activeBridgeRefs?.nodesRef.current ?? store.get(nodesAtom);
    let selectedIds = activeBridgeRefs?.selectedIdsRef.current ?? store.get(selectedIdsAtom);

    // Якщо нічого не обрано, вставляємо в корінь сторінки (root), щоб не загубити елементи поза полотном!
    if ((!selectedIds || selectedIds.length === 0) && liveNodes.has('root')) {
      selectedIds = ['root'];
    }

    const result = engineExecutePaste({
      selectedIds,
      nodes: liveNodes,
      transform: transformManager.getTransform(),
      containerWidth: rect?.width,
      containerHeight: rect?.height,
      interactingVpId,
      viewportWidths: getViewportWidths(),
      activeFilePath: getActiveFilePath(),
      overrideClipboard: clipboardData,
    });

    trace.action('framer-paste:done', {
      success: result.success, created: result.createdIds.length,
    });

    if (result.success && result.createdIds.length > 0) {
      flushNow();
      if (activeBridgeRefs?.setSelectedIds) {
        activeBridgeRefs.setSelectedIds([result.createdIds[0]]);
      } else {
        store.set(selectedIdsAtom, [result.createdIds[0]]);
      }
      toast.success(`🎉 Успішно вставлено ${result.createdIds.length} елементів з Framer!`, { id: toastId });
      return true;
    } else {
      projectFS.loadSnapshot(snapshotBefore);
      toast.error(result.message || 'Помилка вставки елементів', { id: toastId });
      return false;
    }
  } catch (err) {
    projectFS.loadSnapshot(snapshotBefore);
    trace.error('framer-paste:failed', { error: String(err) });
    toast.error('Помилка імпорту з Framer', { id: toastId });
    return false;
  }
}

/** Legacy signature for shortcuts.ts Ctrl+V */
export async function handleFramerPaste(payload: any): Promise<boolean> {
  const bundle = payload?.bundle || payload?.data?.bundle;
  const files = payload?.files || payload?.data?.files || bundle?.files;
  const tsx = payload?.tsx || payload?.fullTsx || payload?.data?.tsx;
  return handleFramerImport({ mode: 'paste', payload, bundle, files, tsx });
}
