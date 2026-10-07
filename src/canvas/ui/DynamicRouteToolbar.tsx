import { useState, useRef, useEffect, useLayoutEffect, useCallback, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  cmsPageMetaAtom,
  extractRouteParamNames,
  previewRouteParamsByFileAtom,
  activePreviewRouteParamsAtom,
  slugPageReferrerByFileAtom,
  routeParamHistoryAtom,
  recordRouteParamHistoryAtom,
  removeRouteParamHistoryAtom,
  getCmsSuggestionsForParam,
  type ParamSuggestion,
} from '@/code/stores/cms-page-store';
import { activeFilePathAtom, getSlugPageParentFile, getFileDisplayName, syncUrlToPage } from '@/code/project/active-file-store';
import { collectionDataAtom } from '@/code/stores/cms-store';
import { selectedIdsAtom } from '@/code/stores/store';
import { leftPanelAtom } from '@/code/stores/left-panel-store';
import { flushNow, syncQueueCode } from '@/code/mutation/mutation-queue';
import { pushHistoryNavigation } from '@/code/mutation/history';
import { projectFS } from '@/code/project/project-fs';
import { PageDocumentIcon } from '@/shared/icons';
import { trace } from '@/shared/debug-trace';
import { setPreviewRouteParams, forceCanvasRender } from '@/canvas/node-ops';

function Chevron() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--text-tertiary)] opacity-60">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronDown({ className = '' }: { className?: string }) {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--text-tertiary)]">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--accent-text)] opacity-80">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface RouteParamComboboxProps {
  param: string;
  value: string;
  onChange: (param: string, value: string) => void;
  onCommit: (param: string, value: string) => void;
}

function RouteParamCombobox({ param, value, onChange, onCommit }: RouteParamComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const allCmsData = useAtomValue(collectionDataAtom);
  const historyMap = useAtomValue(routeParamHistoryAtom);
  const recordHistory = useSetAtom(recordRouteParamHistoryAtom);
  const removeHistory = useSetAtom(removeRouteParamHistoryAtom);

  const history = historyMap[param] || [];
  const cmsSuggestions = getCmsSuggestionsForParam(param, allCmsData);

  // Sync internal query with prop when not focused/open
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  // Update popup coordinates on open / scroll / resize
  const updateRect = useCallback(() => {
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      setRect({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 240),
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updateRect();
      window.addEventListener('resize', updateRect);
      window.addEventListener('scroll', updateRect, true);
      return () => {
        window.removeEventListener('resize', updateRect);
        window.removeEventListener('scroll', updateRect, true);
      };
    }
  }, [open, updateRect]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
      if (query.trim()) {
        onCommit(param, query.trim());
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, query, param, onCommit]);

  const q = query.trim().toLowerCase();

  // Filter history
  const filteredHistory = history.filter((h) => !q || h.toLowerCase().includes(q));

  // Filter CMS suggestions (excluding values already shown in filtered history)
  const historySet = new Set(filteredHistory.map((h) => h.toLowerCase()));
  const filteredCms = cmsSuggestions.filter((item) => {
    if (historySet.has(item.value.toLowerCase())) return false;
    if (!q) return true;
    return (
      item.value.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.source.toLowerCase().includes(q)
    );
  });

  const totalItems = filteredHistory.length + filteredCms.length;

  const handlePick = (pickedVal: string) => {
    onChange(param, pickedVal);
    onCommit(param, pickedVal);
    setQuery(pickedVal);
    setOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (totalItems > 0 ? (prev + 1) % totalItems : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (totalItems > 0 ? (prev - 1 + totalItems) % totalItems : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (totalItems > 0 && highlightIdx >= 0) {
        if (highlightIdx < filteredHistory.length) {
          handlePick(filteredHistory[highlightIdx]);
          return;
        }
        const cmsIdx = highlightIdx - filteredHistory.length;
        if (cmsIdx < filteredCms.length) {
          handlePick(filteredCms[cmsIdx].value);
          return;
        }
      }
      if (query.trim()) {
        handlePick(query.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex items-center bg-[var(--bg-surface)] border border-[var(--border-light)] cut-corners cut-sm px-1.5 py-0.5 gap-1 shadow-sm shrink-0 hover:border-[var(--accent)]/40 focus-within:border-[var(--accent)] transition-colors"
      title={`Test value for route param :${param}`}
    >
      <span className="text-[11px] font-mono font-semibold text-[var(--accent-text)] shrink-0 select-none">
        :{param}
      </span>
      <span className="text-[var(--text-tertiary)] text-xs select-none">=</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onFocus={() => {
          setOpen(true);
          setHighlightIdx(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(param, e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="value..."
        className="h-[22px] w-[82px] px-1 text-xs bg-transparent text-[var(--text-primary)] focus:outline-none transition-colors font-mono"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          setOpen((prev) => !prev);
          inputRef.current?.focus();
        }}
        className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded hover:bg-white/10 transition-colors"
        title="Show history & suggestions"
      >
        <ChevronDown className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Floating Dropdown Portal */}
      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              minWidth: rect.width,
              maxWidth: 340,
              zIndex: 99999,
            }}
            className="bg-[var(--bg-surface,#18181b)] border border-[var(--border-light,rgba(255,255,255,0.12))] cut-corners cut-lg shadow-2xl p-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="max-h-[260px] overflow-y-auto space-y-1 scrollbar-thin">
              {/* History section */}
              {filteredHistory.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                    <ClockIcon />
                    <span>Історія</span>
                  </div>
                  {filteredHistory.map((h, idx) => {
                    const isSelected = h === value;
                    const isHighlighted = idx === highlightIdx;
                    return (
                      <div
                        key={`h-${h}`}
                        onClick={() => handlePick(h)}
                        className={`group flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                          isHighlighted
                            ? 'bg-[var(--accent)]/15 text-[var(--accent-text)]'
                            : isSelected
                            ? 'bg-white/5 text-[var(--text-primary)] font-semibold'
                            : 'text-[var(--text-primary)] hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-mono text-[11px]">{h}</span>
                          {isSelected && (
                            <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                              active
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHistory({ param, value: h });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 hover:bg-rose-500/20 rounded transition-all"
                          title="Видалити з історії"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* CMS Collection suggestions section */}
              {filteredCms.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mt-1 border-t border-[var(--border-light)]/40 pt-1.5">
                    <DatabaseIcon />
                    <span>Колекція ({filteredCms[0]?.source})</span>
                  </div>
                  {filteredCms.map((item, idx) => {
                    const itemIdx = filteredHistory.length + idx;
                    const isSelected = item.value === value;
                    const isHighlighted = itemIdx === highlightIdx;
                    return (
                      <div
                        key={`cms-${item.source}-${item.value}`}
                        onClick={() => handlePick(item.value)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                          isHighlighted
                            ? 'bg-[var(--accent)]/15 text-[var(--accent-text)]'
                            : isSelected
                            ? 'bg-white/5 text-[var(--text-primary)] font-semibold'
                            : 'text-[var(--text-primary)] hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <span className="font-mono font-semibold text-[var(--accent-text)] shrink-0">
                            {item.value}
                          </span>
                          {item.name && (
                            <span className="text-[var(--text-secondary)] text-[11px] truncate">
                              {item.name}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 shrink-0 ml-1">
                            active
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Custom query action when not in list */}
              {totalItems === 0 && (
                <div
                  onClick={() => query.trim() && handlePick(query.trim())}
                  className="px-2.5 py-2 text-xs text-[var(--text-secondary)] text-center cursor-pointer hover:bg-white/5 rounded"
                >
                  {query.trim() ? (
                    <span>
                      Застосувати <span className="font-mono font-bold text-[var(--accent-text)]">«{query.trim()}»</span>
                    </span>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">Введіть значення...</span>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function DynamicRouteToolbar() {
  const filePath = useAtomValue(activeFilePathAtom);
  const meta = useAtomValue(cmsPageMetaAtom);
  const paramNames = extractRouteParamNames(filePath);
  const activeParams = useAtomValue(activePreviewRouteParamsAtom);
  const setPreviewParamsMap = useSetAtom(previewRouteParamsByFileAtom);
  const recordHistory = useSetAtom(recordRouteParamHistoryAtom);
  const [activeFile, setActiveFile] = useAtom(activeFilePathAtom);
  const setSelectedIds = useSetAtom(selectedIdsAtom);
  const selectedIds = useAtomValue(selectedIdsAtom);
  const referrerMap = useAtomValue(slugPageReferrerByFileAtom);
  const setLeftPanel = useSetAtom(leftPanelAtom);

  const isDetail = meta?.kind === 'detail';
  // If it's a standard single-slug CMS detail page with only [slug], SlugPageBreadcrumb handles it.
  const isHandledBySlugBreadcrumb = isDetail && paramNames.length === 1 && paramNames[0] === 'slug';

  if (!filePath || paramNames.length === 0 || isHandledBySlugBreadcrumb) {
    return null;
  }

  // Origin segment — parent route navigation
  const originFile = referrerMap.get(filePath) ?? getSlugPageParentFile(filePath);
  const originValid = !!originFile && originFile !== filePath && projectFS.exists(originFile);
  const originRaw = originValid ? getFileDisplayName(originFile!) : '';
  const originLabel = originRaw === '/' ? 'Home' : originRaw.replace(/^\//, '');

  const goToOrigin = () => {
    if (!originValid || !originFile) return;
    const fresh = projectFS.readFile(filePath);
    if (fresh) syncQueueCode(fresh);
    flushNow();
    const navFrom = { activeFile: filePath, selection: selectedIds };
    setActiveFile(originFile);
    setSelectedIds([]);
    syncUrlToPage(originFile);
    setLeftPanel('pages-layers');
    trace.action('dynamic-route-toolbar:back-to-origin', { from: filePath, to: originFile });
    pushHistoryNavigation(navFrom);
  };

  const handleParamChange = (param: string, value: string) => {
    const updated = { ...activeParams, [param]: value };
    setPreviewRouteParams(updated);
    setPreviewParamsMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(filePath) || {};
      next.set(filePath, { ...cur, [param]: value });
      return next;
    });
    forceCanvasRender();
    trace.action('dynamic-route-toolbar:set-param', { filePath, param, value });
  };

  const handleParamCommit = (param: string, value: string) => {
    if (value.trim()) {
      recordHistory({ param, value: value.trim() });
    }
    handleParamChange(param, value);
  };

  const cleanPath = getFileDisplayName(filePath).replace(/^\//, '');
  const segments = cleanPath.split('/').filter(Boolean);

  const pillBase =
    'flex items-center gap-1.5 px-2.5 h-[30px] bg-[var(--button-secondary-bg,rgba(255,255,255,0.06))] cut-corners text-xs font-medium transition-all whitespace-nowrap';

  return createPortal(
    <div
      className="fixed h-[52px] px-4 flex items-center left-[308px] right-[490px] isolate z-[9000] top-0"
      data-dynamic-toolbar="true"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 border-b border-[var(--border-light)]"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 93%, transparent)',
          backdropFilter: 'blur(18px) saturate(1.15)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.15)',
        } as React.CSSProperties}
      />

      <div className="flex items-center gap-3 min-w-0 max-w-full">
        {/* Left: Path Breadcrumb */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {originValid && (
            <>
              <button
                onClick={goToOrigin}
                className={`${pillBase} max-w-[140px] hover:brightness-125 cursor-pointer text-[var(--text-secondary)]`}
                title={`Back to ${originLabel}`}
              >
                <span className="flex-shrink-0 flex items-center"><PageDocumentIcon size={14} className="text-[var(--text-secondary)]" /></span>
                <span className="truncate">{originLabel}</span>
              </button>
              <Chevron />
            </>
          )}

          {/* Segments Display */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-primary)] font-medium truncate">
            {segments.map((seg, idx) => {
              const isParam = seg.startsWith('[') && seg.endsWith(']');
              return (
                <span key={idx} className="flex items-center gap-1.5 shrink-0">
                  {idx > 0 && <span className="text-[var(--text-tertiary)] opacity-40">/</span>}
                  {isParam ? (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent-text)] font-mono text-[11px] font-semibold border border-[var(--accent)]/30">
                      {seg}
                    </span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">{seg}</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-[var(--border-light)] mx-1 shrink-0" />

        {/* Dynamic Test Route Parameter Inputs */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] font-semibold uppercase tracking-wider shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Test:</span>
          </div>

          {paramNames.map((param) => {
            const val = activeParams[param] ?? '';
            return (
              <RouteParamCombobox
                key={param}
                param={param}
                value={val}
                onChange={handleParamChange}
                onCommit={handleParamCommit}
              />
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}


