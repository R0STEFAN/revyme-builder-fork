// MediaGalleryPanel.tsx — Media gallery with upload support.
// Cloud mode: uploads to R2 via /api/upload, lists existing uploads.
// Standalone mode: uses object URLs (session-only).
//
// Drop into canvas: tiles use the same toolbar-drag pipeline the Library
// and Insert panels use (`startToolbarDrag` + 5 px movement threshold +
// drop-line indicator + parent-highlight). No HTML5 dataTransfer + no
// click-to-copy-URL — that older flow was inconsistent with the rest
// of the editor (no drop preview, no parent insertion semantics).
//
// Deleting: hovering a tile reveals an × (top-right). Click → ConfirmModal →
// DELETE /api/upload. Shift+click multi-selects tiles; shift+DRAG sweeps a
// marquee over the grid (auto-scrolling at the edges) — the × on any
// selected tile then bulk-deletes the whole selection. Cloud-only (the
// standalone object URLs have no server object to delete).

import React, { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { CLOUD_ENABLED } from '@/shared/cloud-flag';
import { ToolSegmentedControl } from '@/editor/controls';
import { trace } from '@/shared/debug-trace';
import SectionLabel from '@/design-system/SectionLabel';
import { backend } from '@/backend';
import { getProjectId } from '@/backend/project-id';
import { startToolbarDrag } from '@/canvas/drag/toolbar-drag-bridge';
import { type ToolbarItem } from '@/canvas/drag/toolbar-item-config';
import { ConfirmModal } from '@/editor/overlays/settings-shared';
import { MULTI_SELECT_OUTLINE } from './LibraryPanel/shared/section-utils';
import { isSvgMediaUrl, prefetchSvgMarkup, getPrefetchedSvgMarkup, seedSvgMarkup, buildSvgMediaDragItem } from './media-svg-drop';
import {
  deriveUploadKey,
  keysInSweep,
  sweepAutoScrollStep,
  deleteConfirmMessage,
  rangeSelectKeys,
  toggleSelectAllKeys,
  getSelectionState,
  computeGridTileRects,
  type TileRect,
} from './media-gallery-utils';

const TAB_OPTIONS = [
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
];

interface UploadedFile {
  url: string;
  thumbnailUrl?: string;
  key?: string;
  size?: number;
  lastModified?: string;
}

/** 5 px movement threshold before a tile pointerdown is treated as a drag.
 *  Below this, releasing the pointer is treated as a click/selection. */
const MEDIA_DRAG_THRESHOLD_PX = 5;

/** Shared drag logic for media tiles. Mirrors LibraryPanel's
 *  `useComponentDrag` — kicks off `startToolbarDrag` once the
 *  cursor moves more than `MEDIA_DRAG_THRESHOLD_PX` from the
 *  pointerdown position. When released under the threshold, triggers
 *  `onTileClick`. */
export function makeMediaToolbarItem(url: string, kind: 'image' | 'video', ghostW = 200, ghostH = 150): ToolbarItem {
  return kind === 'image' ? {
    id: `media-image:${url}`,
    elementType: 'div',
    name: 'Image',
    defaultStyles: {
      width: '200px',
      height: '150px',
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    },
    ghostSize: { width: ghostW, height: ghostH },
  } : {
    id: `media-video:${url}`,
    elementType: 'video',
    name: 'Video',
    defaultStyles: {
      display: 'block',
      width: '320px',
      height: '240px',
      maxWidth: 'none',
      backgroundColor: '#1f2937',
    },
    defaultAttrs: { src: url, controls: '' },
    ghostSize: { width: ghostW, height: ghostH },
  };
}

/** Shared drag logic for media tiles. Mirrors LibraryPanel's
 *  `useComponentDrag` — kicks off `startToolbarDrag` once the
 *  cursor moves more than `MEDIA_DRAG_THRESHOLD_PX` from the
 *  pointerdown position. When released under the threshold, triggers
 *  `onTileClick`. */
function useMediaDrag(
  url: string,
  kind: 'image' | 'video',
  isSelected: boolean,
  getBatchItems?: () => ToolbarItem[] | undefined,
  onTileClick?: (e: PointerEvent) => void
) {
  return useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startEvent = e.nativeEvent;
    const tile = e.currentTarget as HTMLElement;
    const rect = tile.getBoundingClientRect();
    const ghostW = Math.round(rect.width)  || 200;
    const ghostH = Math.round(rect.height) || 150;
    const item: ToolbarItem = makeMediaToolbarItem(url, kind, ghostW, ghostH);
    if (isSelected && getBatchItems) {
      const batchItems = getBatchItems();
      if (batchItems && batchItems.length > 1) {
        const filtered = batchItems.filter((b) => b.id !== item.id);
        item.batch = [item, ...filtered];
      }
    }
    // An SVG drops as a native VECTOR (nested groups + editable paths), not as
    // a background picture — see media-svg-drop.ts. Its markup is normally
    // prefetched with the gallery; fetch now in case it isn't.
    const isSvg = kind === 'image' && isSvgMediaUrl(url);
    if (isSvg) void prefetchSvgMarkup(url);
    const dragItem = (): ToolbarItem => {
      const markup = isSvg ? getPrefetchedSvgMarkup(url) : null;
      const base = (markup && buildSvgMediaDragItem(url, markup, { width: ghostW, height: ghostH })) || item;
      if (item.batch && !base.batch) {
        base.batch = [base, ...item.batch.filter((b) => b.id !== item.id)];
      }
      return base;
    };
    let dragStarted = false;
    let released = false;
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const start = () => {
      const finalItem = dragItem();
      trace.action('media-panel:drag-start', { kind, url, svg: isSvg, batchCount: finalItem.batch?.length ?? 1 });
      startToolbarDrag(finalItem, startEvent);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (dragStarted) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (dx * dx + dy * dy < MEDIA_DRAG_THRESHOLD_PX * MEDIA_DRAG_THRESHOLD_PX) return;
      dragStarted = true;
      // SVG markup still in flight: start the drag the moment it lands (if the
      // pointer is still down) instead of falling back to the picture drop.
      if (isSvg && getPrefetchedSvgMarkup(url) === undefined) {
        window.removeEventListener('pointermove', onMove);
        void prefetchSvgMarkup(url).then(() => { if (!released) { cleanup(); start(); } });
        return;
      }
      cleanup();
      start();
    };
    const onUp = (upEvent: PointerEvent) => {
      released = true;
      cleanup();
      if (!dragStarted && onTileClick) {
        onTileClick(upEvent);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [url, kind, isSelected, getBatchItems, onTileClick]);
}

/** Single tile in the gallery grid with selection checkbox, drag to canvas,
 *  hover delete button, and selection overlay. */
const MediaTile = React.memo(function MediaTile({
  url,
  thumbnailUrl,
  kind,
  mediaKey,
  isSelected,
  getBatchItems,
  canDelete,
  onShiftPointerDown,
  onPlainClick,
  onCtrlClick,
  onToggleSelect,
  onRequestDelete,
}: {
  url: string;
  thumbnailUrl?: string;
  kind: 'image' | 'video';
  mediaKey: string | null;
  isSelected: boolean;
  getBatchItems?: () => ToolbarItem[] | undefined;
  canDelete: boolean;
  onShiftPointerDown: (key: string, e: React.PointerEvent) => void;
  onPlainClick: (key: string) => void;
  onCtrlClick: (key: string) => void;
  onToggleSelect: (key: string) => void;
  onRequestDelete: (key: string) => void;
}) {
  const handleDrag = useMediaDrag(url, kind, isSelected, getBatchItems, (upEvent) => {
    if (!mediaKey) return;
    if (upEvent.ctrlKey || upEvent.metaKey) {
      onCtrlClick(mediaKey);
    } else {
      onPlainClick(mediaKey);
    }
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.shiftKey && mediaKey) {
      e.preventDefault();
      e.stopPropagation();
      onShiftPointerDown(mediaKey, e);
      return;
    }
    handleDrag(e);
  };

  return (
    <div
      data-media-key={mediaKey ?? undefined}
      onPointerDown={onPointerDown}
      className={`group relative aspect-square cut-corners cut-border overflow-hidden border cursor-grab active:cursor-grabbing select-none ${
        isSelected
          ? 'border-[var(--accent)] [--cut-border-color:var(--accent)] transition-none'
          : 'border-[var(--border-light)] [--cut-border-color:var(--border-light)] hover:border-[var(--accent)] hover:[--cut-border-color:var(--accent)] transition-colors'
      }`}
      style={isSelected ? MULTI_SELECT_OUTLINE : undefined}
      title="Click to select, drag to canvas"
    >
      {kind === 'image' ? (
        <img
          src={thumbnailUrl || url}
          alt=""
          className="w-full h-full object-cover pointer-events-none"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <video
          src={url}
          className="w-full h-full object-cover pointer-events-none"
          preload="none"
          muted
        />
      )}
      {/* Selected: light accent wash over the artwork */}
      {isSelected && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--accent, #4c8df6)', opacity: 0.22 }}
        />
      )}
      {/* Selection checkbox top-left */}
      {mediaKey && (
        <button
          type="button"
          aria-label={isSelected ? 'Deselect asset' : 'Select asset'}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(mediaKey); }}
          className={`absolute top-1.5 left-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border transition-all cursor-pointer ${
            isSelected
              ? 'bg-[var(--accent)] border-[var(--accent)] text-white opacity-100 shadow-sm'
              : 'bg-black/50 border-white/60 text-white hover:border-white hover:bg-black/70 opacity-0 group-hover:opacity-100 [[data-has-selection=true]_&]:opacity-90'
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={isSelected ? 'opacity-100' : 'opacity-0 hover:opacity-60'}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      )}
      {/* Hover delete — dark grey disc, white × */}
      {canDelete && mediaKey && (
        <button
          type="button"
          aria-label="Delete asset"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onClick={(e) => { e.stopPropagation(); onRequestDelete(mediaKey); }}
          className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12" />
            <path d="M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
});

interface MediaRowExtraProps {
  uploads: UploadedFile[];
  selectedKeys: Set<string>;
  getBatchItems: () => ToolbarItem[] | undefined;
  onShiftPointerDown: (key: string, e: React.PointerEvent) => void;
  onPlainClick: (key: string) => void;
  onCtrlClick: (key: string) => void;
  onToggleSelect: (key: string) => void;
  onRequestDelete: (key: string) => void;
  tab: string;
}

function MediaRow({
  index,
  style,
  uploads,
  selectedKeys,
  getBatchItems,
  onShiftPointerDown,
  onPlainClick,
  onCtrlClick,
  onToggleSelect,
  onRequestDelete,
  tab,
}: RowComponentProps<MediaRowExtraProps>) {
  const leftItem = uploads[index * 2];
  const rightItem = uploads[index * 2 + 1];
  const kind = tab === 'images' ? 'image' : 'video';

  const leftKey = leftItem ? deriveUploadKey(leftItem) : null;
  const rightKey = rightItem ? deriveUploadKey(rightItem) : null;

  return (
    <div style={style} className="px-3 pb-2">
      <div className="grid grid-cols-2 gap-2 h-full">
        {leftItem && (
          <MediaTile
            url={leftItem.url}
            thumbnailUrl={leftItem.thumbnailUrl}
            kind={kind}
            mediaKey={leftKey}
            isSelected={!!leftKey && selectedKeys.has(leftKey)}
            getBatchItems={getBatchItems}
            canDelete={true}
            onShiftPointerDown={onShiftPointerDown}
            onPlainClick={onPlainClick}
            onCtrlClick={onCtrlClick}
            onToggleSelect={onToggleSelect}
            onRequestDelete={onRequestDelete}
          />
        )}
        {rightItem ? (
          <MediaTile
            url={rightItem.url}
            thumbnailUrl={rightItem.thumbnailUrl}
            kind={kind}
            mediaKey={rightKey}
            isSelected={!!rightKey && selectedKeys.has(rightKey)}
            getBatchItems={getBatchItems}
            canDelete={true}
            onShiftPointerDown={onShiftPointerDown}
            onPlainClick={onPlainClick}
            onCtrlClick={onCtrlClick}
            onToggleSelect={onToggleSelect}
            onRequestDelete={onRequestDelete}
          />
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

interface StorageInfo {
  currentUsageMB: string;
  storageLimitMB: string;
}

export default function MediaGalleryPanel() {
  const [tab, setTab] = useState('images');
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Multi-select (click, shift+click range, shift+sweep, checkbox) — keyed by R2 object key / filename.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  // Pending delete confirmation — the keys the ConfirmModal will remove.
  const [confirmKeys, setConfirmKeys] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useListRef(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 256, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const cr = el.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) {
        setDimensions({ width: Math.round(cr.width), height: Math.round(cr.height) });
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [uploads.length, loadingList]);

  const projectId = getProjectId();
  const noun: 'image' | 'video' = tab === 'images' ? 'image' : 'video';

  const tilePadding = 12; // px-3
  const tileGap = 8;      // gap-2
  const availableWidth = Math.max(0, dimensions.width - tilePadding * 2);
  const tileWidth = Math.max(1, Math.floor((availableWidth - tileGap) / 2));
  const rowHeight = tileWidth + tileGap;
  const rowCount = Math.ceil(uploads.length / 2);

  const allUploadKeys = useMemo(
    () => uploads.map((u) => deriveUploadKey(u)).filter(Boolean) as string[],
    [uploads]
  );
  const { allSelected, someSelected } = useMemo(
    () => getSelectionState(allUploadKeys, selectedKeys),
    [allUploadKeys, selectedKeys]
  );

  const selectedBatchItems = useMemo(() => {
    if (selectedKeys.size <= 1) return undefined;
    const kind: 'image' | 'video' = tab === 'images' ? 'image' : 'video';
    const selectedUploads = uploads.filter((u) => {
      const k = deriveUploadKey(u);
      return !!k && selectedKeys.has(k);
    });
    return selectedUploads.map((u) => makeMediaToolbarItem(u.url, kind));
  }, [uploads, selectedKeys, tab]);

  const selectedBatchItemsRef = useRef(selectedBatchItems);
  useEffect(() => {
    selectedBatchItemsRef.current = selectedBatchItems;
  }, [selectedBatchItems]);

  const getBatchItems = useCallback(() => selectedBatchItemsRef.current, []);

  const selectedKeysRef = useRef(selectedKeys);
  useEffect(() => {
    selectedKeysRef.current = selectedKeys;
  }, [selectedKeys]);

  const lastSelectedKeyRef = useRef(lastSelectedKey);
  useEffect(() => {
    lastSelectedKeyRef.current = lastSelectedKey;
  }, [lastSelectedKey]);

  const allUploadKeysRef = useRef(allUploadKeys);
  useEffect(() => {
    allUploadKeysRef.current = allUploadKeys;
  }, [allUploadKeys]);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  trace.fn('MediaGalleryPanel:render', { tab, count: uploads.length, selected: selectedKeys.size });

  // Fetch existing uploads + storage info
  const fetchUploads = useCallback(async () => {
    setLoadingList(true);
    try {
      const [uploadsRes, storageRes] = await Promise.all([
        fetch(`/api/upload?websiteId=${projectId}&type=${tab === 'images' ? 'image' : 'video'}`),
        fetch(`/api/upload?websiteId=${projectId}&type=storage`),
      ]);
      if (uploadsRes.ok) {
        const data = await uploadsRes.json();
        const rawUploads: UploadedFile[] = data.uploads || [];
        const filtered = rawUploads.filter((u) => {
          const key = deriveUploadKey(u) || '';
          return !key.startsWith('thumbnail-') && !u.url.includes('/thumbnail-');
        });
        setUploads(filtered);
        // SVG tiles drop as vectors — have their markup ready before a drag.
        for (const u of filtered) if (isSvgMediaUrl(u.url)) void prefetchSvgMarkup(u.url);
        trace.action('media:fetched', { type: tab, count: filtered.length });
      }
      if (storageRes.ok) {
        const data = await storageRes.json();
        const currentMB = data.used != null ? +(data.used / (1024 * 1024)).toFixed(1) : (data.currentUsageMB ?? 0);
        const limitMB = data.limit != null ? +(data.limit / (1024 * 1024)).toFixed(0) : (data.storageLimitMB ?? 500);
        setStorage({ currentUsageMB: currentMB, storageLimitMB: limitMB });
      }
    } catch (err) {
      trace.error('media:fetch-failed', err);
    }
    setLoadingList(false);
  }, [projectId, tab]);

  useEffect(() => { fetchUploads(); }, [fetchUploads]);

  // Tab switch invalidates the selection AND the visible list
  useEffect(() => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
    setUploads([]);
  }, [tab]);

  // Escape clears multi-selection
  useEffect(() => {
    if (selectedKeys.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmKeys) {
        setSelectedKeys(new Set());
        setLastSelectedKey(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKeys.size, confirmKeys]);

  // Outside click clears multi-selection
  useEffect(() => {
    if (selectedKeys.size === 0) return;
    const onDown = (e: PointerEvent) => {
      if (confirmKeys) return;
      const cont = containerRef.current;
      if (cont && e.target instanceof Node && cont.contains(e.target)) return;
      trace.action('media-select:clear-outside', { had: selectedKeys.size });
      setSelectedKeys(new Set());
      setLastSelectedKey(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [selectedKeys.size, confirmKeys]);

  // Keyboard shortcuts: Ctrl+A / Cmd+A to select all, Delete / Backspace to remove
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const cont = containerRef.current;
        if (cont && (cont.contains(document.activeElement) || cont.contains(e.target as Node))) {
          e.preventDefault();
          setSelectedKeys(new Set(allUploadKeys));
          if (allUploadKeys.length > 0) setLastSelectedKey(allUploadKeys[0]);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeys.size > 0 && !confirmKeys) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setConfirmKeys([...selectedKeys]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allUploadKeys, selectedKeys, confirmKeys]);

  // Handle file upload (supports single or multiple files)
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploading(true);
    setUploadError(null);
    trace.action('media:upload-start', { count: files.length, names: files.map(f => f.name) });
    try {
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const url = await backend.uploadAsset(projectId, file);
          if (isSvgMediaUrl(url)) seedSvgMarkup(url, await file.text());
          const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(file.name);
          const filename = url.replace(/^\/api\/uploads\//, '').split('?')[0];
          const thumbnailUrl = isImage && filename ? `/api/uploads/thumb/${filename}` : undefined;
          return { url, thumbnailUrl, size: file.size, key: filename || file.name };
        })
      );
      const successful: UploadedFile[] = [];
      const failures: string[] = [];
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          successful.push(res.value);
        } else {
          failures.push(`${files[idx].name} (${res.reason instanceof Error ? res.reason.message : 'failed'})`);
        }
      });
      if (successful.length > 0) {
        setUploads(prev => [...successful, ...prev]);
        trace.action('media:upload-success', { count: successful.length });
        fetchUploads();
      }
      if (failures.length > 0) {
        trace.error('media:upload-partial-failures', { failures });
        setUploadError(`Failed to upload: ${failures.join(', ')}`);
      }
    } catch (err) {
      trace.error('media:upload-failed', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [projectId, fetchUploads]);

  // Tile selection handlers
  const handlePlainClick = useCallback((key: string) => {
    setSelectedKeys(new Set([key]));
    setLastSelectedKey(key);
    trace.action('media-select:single', { key });
  }, []);

  const handleCtrlClick = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastSelectedKey(key);
    trace.action('media-select:ctrl-toggle', { key });
  }, []);

  const handleToggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastSelectedKey(key);
    trace.action('media-select:checkbox-toggle', { key });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    const next = toggleSelectAllKeys(allUploadKeys, selectedKeys);
    setSelectedKeys(next);
    if (next.size > 0) {
      setLastSelectedKey(allUploadKeys[0] || null);
    } else {
      setLastSelectedKey(null);
    }
    trace.action('media-select:toggle-all', { size: next.size });
  }, [allUploadKeys, selectedKeys]);

  const handleClearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setLastSelectedKey(null);
  }, []);

  // ─── Shift+click range selection / shift+drag marquee sweep ──────────────
  const sweepRef = useRef<{
    anchor: { x: number; y: number };
    base: Set<string>;
    startClient: { x: number; y: number };
    lastClient: { x: number; y: number };
    moved: boolean;
    toggleKey: string | null;
    raf: number;
  } | null>(null);

  const recomputeSweep = useCallback(() => {
    const s = sweepRef.current;
    const listEl = listRef.current?.element;
    if (!s || !listEl) return;
    const cr = listEl.getBoundingClientRect();
    const b = {
      x: s.lastClient.x - cr.left + listEl.scrollLeft,
      y: s.lastClient.y - cr.top + listEl.scrollTop,
    };
    const rects = computeGridTileRects(allUploadKeysRef.current, dimensions.width, tileGap, 2, tilePadding, 0);
    const swept = keysInSweep(rects, s.anchor, b);
    setSelectedKeys(new Set([...s.base, ...swept]));
  }, [dimensions.width, tileGap, tilePadding]);

  const beginShiftGesture = useCallback((toggleKey: string | null, e: React.PointerEvent) => {
    const listEl = listRef.current?.element;
    if (!listEl) return;
    const cr = listEl.getBoundingClientRect();
    sweepRef.current = {
      anchor: { x: e.clientX - cr.left + listEl.scrollLeft, y: e.clientY - cr.top + listEl.scrollTop },
      base: new Set(selectedKeysRef.current),
      startClient: { x: e.clientX, y: e.clientY },
      lastClient: { x: e.clientX, y: e.clientY },
      moved: false,
      toggleKey,
      raf: 0,
    };
    trace.action('media-sweep:begin', { toggleKey, selected: selectedKeysRef.current.size });

    const onMove = (ev: PointerEvent) => {
      const s = sweepRef.current;
      if (!s) return;
      s.lastClient = { x: ev.clientX, y: ev.clientY };
      if (!s.moved) {
        const dx = ev.clientX - s.startClient.x;
        const dy = ev.clientY - s.startClient.y;
        if (dx * dx + dy * dy < MEDIA_DRAG_THRESHOLD_PX * MEDIA_DRAG_THRESHOLD_PX) return;
        s.moved = true;
      }
      recomputeSweep();
    };

    const cleanup = () => {
      const s = sweepRef.current;
      if (s?.raf) cancelAnimationFrame(s.raf);
      sweepRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onUp = () => {
      const s = sweepRef.current;
      cleanup();
      if (!s) return;
      if (!s.moved && s.toggleKey) {
        // Shift+CLICK without moving — Range selection from anchor to target!
        const targetKey = s.toggleKey;
        const allKeys = allUploadKeysRef.current;
        const anchor = lastSelectedKeyRef.current;
        setSelectedKeys((prev) => {
          const next = rangeSelectKeys(allKeys, prev, targetKey, anchor);
          trace.action('media-select:range', { targetKey, anchor, size: next.size });
          return next;
        });
        setLastSelectedKey(targetKey);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // Edge auto-scroll loop during marquee sweep
    const tick = () => {
      const s = sweepRef.current;
      const el = listRef.current?.element;
      if (!s || !el) return;
      if (s.moved) {
        const rect = el.getBoundingClientRect();
        const step = sweepAutoScrollStep(s.lastClient.y, rect.top, rect.bottom);
        if (step !== 0) {
          el.scrollTop += step;
          recomputeSweep();
        }
      }
      s.raf = requestAnimationFrame(tick);
    };
    sweepRef.current.raf = requestAnimationFrame(tick);
  }, [recomputeSweep]);

  // Shift+drag started on empty space sweeps marquee
  const onGridPointerDown = useCallback((e: React.PointerEvent) => {
    if (!e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    beginShiftGesture(null, e);
  }, [beginShiftGesture]);

  // ─── Delete flow ─────────────────────────────────────────────────────────
  const requestDelete = useCallback((key: string) => {
    const keys = selectedKeys.size > 1 && selectedKeys.has(key) ? [...selectedKeys] : [key];
    trace.action('media-delete:request', { count: keys.length });
    setConfirmKeys(keys);
  }, [selectedKeys]);

  const confirmDelete = useCallback(async () => {
    if (!confirmKeys || deleting) return;
    setDeleting(true);
    try {
      await backend.deleteAssets(projectId, confirmKeys);
      trace.action('media-delete:done', { count: confirmKeys.length });
      setSelectedKeys(new Set());
      setLastSelectedKey(null);
      setConfirmKeys(null);
      await fetchUploads();
    } catch (err) {
      trace.error('media-delete:failed', err);
      setUploadError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmKeys(null);
    }
    setDeleting(false);
  }, [confirmKeys, deleting, projectId, fetchUploads]);

  const rowProps: MediaRowExtraProps = useMemo(() => ({
    uploads,
    selectedKeys,
    getBatchItems,
    onShiftPointerDown: beginShiftGesture,
    onPlainClick: handlePlainClick,
    onCtrlClick: handleCtrlClick,
    onToggleSelect: handleToggleSelect,
    onRequestDelete: requestDelete,
    tab,
  }), [
    uploads,
    selectedKeys,
    getBatchItems,
    beginShiftGesture,
    handlePlainClick,
    handleCtrlClick,
    handleToggleSelect,
    requestDelete,
    tab,
  ]);

  const storageLabel = storage ? `${storage.currentUsageMB} / ${storage.storageLimitMB} MB` : '0.0 / 500 MB';

  return (
    <div className="flex flex-col h-full">
      <SectionLabel size="md" right={<span className="text-[11px] text-[var(--text-disabled)]">{storageLabel}</span>}>Media</SectionLabel>

      {/* Tabs */}
      <div className="px-3 mt-3">
        <ToolSegmentedControl value={tab} onChange={setTab} options={TAB_OPTIONS} />
      </div>

      {/* Error banner */}
      {uploadError && (
        <div className="px-3 mt-3">
          <div className="px-2.5 py-1.5 cut-corners cut-border bg-red-500/10 border border-red-500/20 text-[11px] text-red-500 dark:text-red-400 leading-snug">
            {uploadError}
          </div>
        </div>
      )}

      {/* Upload button */}
      <div className="px-3 mt-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={tab === 'images' ? 'image/*' : 'video/*'}
          onChange={handleUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 py-2 cut-corners cut-border [--cut-border-color:var(--border-light)] border border-[var(--border-light)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {uploading ? 'Uploading...' : `Upload ${tab === 'images' ? 'image' : 'video'}`}
        </button>
      </div>

      {/* Selection toolbar & "Select all" control */}
      {uploads.length > 0 && (
        <div className="flex items-center justify-between px-3 pt-3 pb-1 text-xs text-[var(--text-secondary)]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              ref={selectAllCheckboxRef}
              checked={allSelected}
              onChange={handleToggleSelectAll}
              className="w-3.5 h-3.5 rounded accent-[var(--accent)] cursor-pointer"
            />
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              {selectedKeys.size > 0
                ? `Selected ${selectedKeys.size} of ${allUploadKeys.length}`
                : `Select all (${allUploadKeys.length})`}
            </span>
          </label>
          {selectedKeys.size > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5 rounded cursor-pointer"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmKeys([...selectedKeys])}
                className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 px-2 py-0.5 rounded transition-colors cursor-pointer"
                title={`Delete ${selectedKeys.size} selected ${noun}s`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete ({selectedKeys.size})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Gallery grid */}
      <div
        ref={containerRef}
        data-has-selection={someSelected || allSelected ? 'true' : 'false'}
        onPointerDown={onGridPointerDown}
        className="flex-1 min-h-0 overflow-hidden flex flex-col pt-2"
      >
        {uploads.length > 0 ? (
          <List
            listRef={listRef}
            rowCount={rowCount}
            rowHeight={rowHeight}
            rowComponent={MediaRow}
            rowProps={rowProps}
            style={{
              height: '100%',
              width: '100%',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            } as CSSProperties}
            className="scrollbar-hide flex-1 min-h-0"
          />
        ) : loadingList ? (
          <div className="flex-1 overflow-y-auto scrollbar-hide px-3" aria-hidden>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square cut-corners cut-border [--cut-border-color:var(--border-light)] border border-[var(--border-light)] bg-[var(--bg-hover)] animate-pulse"
                  style={{ animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-xs text-[var(--text-secondary)]">No {tab} uploaded yet</p>
            <p className="text-[10px] text-[var(--text-disabled)] max-w-[180px] leading-relaxed">
              Upload {tab} to see them here
            </p>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={confirmKeys !== null}
        title={confirmKeys && confirmKeys.length > 1 ? `Delete ${confirmKeys.length} ${noun}s` : `Delete ${noun}`}
        message={deleteConfirmMessage(confirmKeys?.length ?? 1, noun)}
        confirmText="Delete"
        variant="danger"
        isLoading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setConfirmKeys(null); }}
      />
    </div>
  );
}
