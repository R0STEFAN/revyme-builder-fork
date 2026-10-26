// ExpressionEditorPopup.tsx — Visual expression / formula editor dialog.
// Allows no-code authoring of dynamic composite text and URLs with token autocomplete and live preview.

import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue } from 'jotai';
import Modal from '@/design-system/Modal';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { collectionDataAtom, collectionSchemasAtom } from '@/code/stores/cms-store';
import { listCollections, getCollectionSchema, getCollectionData } from '@/code/project/cms-ops';
import type { FieldDefinition } from '@/shared/types';
import { trace } from '@/shared/debug-trace';
import {
  getAutocompleteSuggestions,
  type AutocompleteSuggestion,
} from './expression-autocomplete';

interface ExpressionEditorPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (expression: string) => void;
  initialExpression?: string;
  targetProperty?: 'text' | 'href' | 'src' | 'aria-label';
  collectionSlug?: string;
  itemVar?: string;
  fields?: FieldDefinition[];
  filePath?: string;
}

export default function ExpressionEditorPopup({
  isOpen,
  onClose,
  onApply,
  initialExpression = '',
  targetProperty = 'text',
  collectionSlug,
  itemVar = 'item',
  fields = [],
  filePath,
}: ExpressionEditorPopupProps) {
  const [expression, setExpression] = useState(initialExpression);
  const [cursorPos, setCursorPos] = useState<number>(initialExpression.length);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isDotActive, setIsDotActive] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const activeFilePath = useAtomValue(activeFilePathAtom);
  const effectiveFilePath = filePath || activeFilePath;
  const collectionData = useAtomValue(collectionDataAtom);
  const collectionSchemas = useAtomValue(collectionSchemasAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setExpression(initialExpression);
      setCursorPos(initialExpression.length);
      setIsDismissed(false);
      setIsDotActive(false);
      setSelectedIndex(0);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, initialExpression]);

  const safeSchemas = useMemo(() => {
    const map = new Map(collectionSchemas instanceof Map ? collectionSchemas : []);
    if (map.size === 0) {
      const slugs = listCollections();
      for (const slug of slugs) {
        const s = getCollectionSchema(slug);
        if (s) map.set(slug, s);
      }
    }
    return map;
  }, [collectionSchemas]);

  // Extract route parameters from active file path (e.g. `app/gallery/[category]/[place]/page.client.tsx` -> `['category', 'place']`)
  const routeParams = useMemo(() => {
    if (!effectiveFilePath) return [];
    const matches = Array.from(effectiveFilePath.matchAll(/\[([^/\]]+)\]/g));
    const params = matches.map(m => m[1]).filter(p => !p.startsWith('...'));
    return Array.from(new Set(params));
  }, [effectiveFilePath]);

  // Insert token or text into current cursor position in the textarea
  const insertToken = useCallback((token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setExpression(prev => prev + token);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = expression;
    const next = current.slice(0, start) + token + current.slice(end);
    const nextPos = start + token.length;
    setExpression(next);
    setCursorPos(nextPos);
    setIsDismissed(false);
    setIsDotActive(false);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
    }, 0);
  }, [expression]);

  // Build sample evaluation context
  const sampleContext = useMemo(() => {
    const ctx: Record<string, any> = {};

    // 1. Mock params
    const mockParams: Record<string, string> = {};
    for (const p of routeParams) {
      mockParams[p] = p === 'category' ? 'tech' : p === 'place' || p === 'placement' ? 'chest' : p;
    }
    ctx.params = mockParams;

    // 2. Mock collections data
    const safeData = collectionData instanceof Map ? collectionData : new Map();
    for (const [slug, items] of safeData.entries()) {
      ctx[slug] = items;
      const varName = slug.replace(/[^a-zA-Z0-9]/g, '');
      if (varName) ctx[varName] = items;
    }
    for (const [slug] of safeSchemas.entries()) {
      if (!ctx[slug]) {
        const items = getCollectionData(slug);
        if (items.length > 0) {
          ctx[slug] = items;
          const varName = slug.replace(/[^a-zA-Z0-9]/g, '');
          if (varName) ctx[varName] = items;
        }
      }
    }

    // 3. Mock item inside collection loop
    if (collectionSlug) {
      const items = ctx[collectionSlug] || safeData.get(collectionSlug) || getCollectionData(collectionSlug) || [];
      ctx[itemVar] = items[0] || { name: 'Sample Item', slug: 'sample-item', title: 'Sample Item', _slug: 'sample-item', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200' };
    } else {
      ctx[itemVar] = { name: 'Sample Item', slug: 'sample-item', title: 'Sample Item', _slug: 'sample-item', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200' };
    }

    return ctx;
  }, [routeParams, collectionData, collectionSlug, itemVar, safeSchemas]);

  // Evaluate expression preview in real-time
  const evaluation = useMemo(() => {
    const expr = expression.trim();
    if (!expr) return { result: '', error: null };
    try {
      const keys = Object.keys(sampleContext);
      const values = Object.values(sampleContext);
      // Clean leading and trailing curly braces if user typed {expr}
      const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
      const fn = new Function(...keys, `return (${unwrapped});`);
      const raw = fn(...values);
      return { result: raw === undefined || raw === null ? '' : String(raw), error: null };
    } catch (e: any) {
      return { result: '', error: e?.message || 'Invalid syntax' };
    }
  }, [expression, sampleContext]);

  const handleApply = () => {
    const clean = expression.trim().replace(/^\{|\}$/g, '').trim();
    if (!clean) return;
    trace.action('expression-editor:apply', { expression: clean, targetProperty });
    onApply(clean);
    onClose();
  };

  // Intelligent autocomplete suggestions based on cursor position and active expression
  // Triggers ONLY after typing a dot '.', and stays active while typing identifier characters after that dot.
  const suggestions = useMemo(() => {
    if (!isDotActive || isDismissed) return [];
    return getAutocompleteSuggestions({
      text: expression,
      cursorPos,
      scope: sampleContext,
      routeParams,
      collectionSchemas: safeSchemas,
      itemVar,
    });
  }, [expression, cursorPos, sampleContext, routeParams, safeSchemas, itemVar, isDismissed, isDotActive]);

  const [portalStyle, setPortalStyle] = useState<React.CSSProperties | null>(null);

  // Position portal floating dropdown right below or above the textarea
  useLayoutEffect(() => {
    if (suggestions.length === 0) {
      setPortalStyle(null);
      return;
    }

    const place = () => {
      const el = textareaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = r.width || 440;
      const left = r.width ? Math.max(8, Math.min(r.left, (window.innerWidth || 1024) - width - 8)) : (r.left || 20);

      const spaceBelow = window.innerHeight ? window.innerHeight - r.bottom : 500;
      const dropdownHeight = Math.min(220, 40 + suggestions.length * 32);
      const placeAbove = spaceBelow < dropdownHeight && r.top > dropdownHeight;

      if (placeAbove) {
        setPortalStyle({
          position: 'fixed',
          left,
          bottom: Math.max(8, (window.innerHeight || 800) - r.top + 4),
          width,
          zIndex: 100020,
        });
      } else {
        setPortalStyle({
          position: 'fixed',
          left,
          top: (r.bottom || 100) + 4,
          width,
          zIndex: 100020,
        });
      }
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [suggestions.length]);

  // Click outside to dismiss suggestions
  useEffect(() => {
    if (suggestions.length === 0) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!textareaRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setIsDismissed(true);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [suggestions.length]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  useEffect(() => {
    if (listRef.current) {
      const activeItem = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const applySuggestion = useCallback((suggestion: AutocompleteSuggestion) => {
    const el = textareaRef.current;
    const current = expression;
    const next = current.slice(0, suggestion.replaceFrom) + suggestion.insertText + current.slice(suggestion.replaceTo);
    const nextPos = suggestion.replaceFrom + suggestion.insertText.length;

    setExpression(next);
    setCursorPos(nextPos);
    setIsDotActive(false);
    setIsDismissed(true);
    setSelectedIndex(0);

    setTimeout(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  }, [expression]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = suggestions[selectedIndex];
        if (selected) {
          applySuggestion(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsDismissed(true);
        setIsDotActive(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    const textBefore = val.slice(0, pos);

    if (textBefore.endsWith('.')) {
      setIsDotActive(true);
      setIsDismissed(false);
    } else if (isDotActive) {
      const lastDot = textBefore.lastIndexOf('.');
      if (lastDot !== -1) {
        const afterDot = textBefore.slice(lastDot + 1);
        if (/^[a-zA-Z0-9_$]*$/.test(afterDot)) {
          setIsDismissed(false);
        } else {
          setIsDotActive(false);
        }
      } else {
        setIsDotActive(false);
      }
    }

    setExpression(val);
    setCursorPos(pos);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.target as HTMLTextAreaElement;
    const pos = el.selectionStart;
    setCursorPos(pos);
    const textBefore = el.value.slice(0, pos);
    const lastDot = textBefore.lastIndexOf('.');
    if (lastDot === -1 || !/^[a-zA-Z0-9_$]*$/.test(textBefore.slice(lastDot + 1))) {
      setIsDotActive(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onKeyDown={(e) => {
        if (suggestions.length > 0 && e.key === 'Escape') {
          e.stopPropagation();
          setIsDismissed(true);
          setIsDotActive(false);
          return false;
        }
      }}
      title={
        targetProperty === 'src'
          ? 'Image Expression (Formula)'
          : targetProperty === 'href'
          ? 'Link Expression (Formula)'
          : targetProperty === 'aria-label'
          ? 'Aria Label Expression (Formula)'
          : 'Text Expression (Formula)'
      }
      width={480}
    >
      <div className="flex flex-col gap-3 py-1">
        {/* Helper description */}
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed m-0">
          Combine variables, route params, and text in quotes (e.g.{' '}
          <code className="px-1 py-0.5 rounded bg-[var(--grid-line)] text-purple-300 font-mono text-[11px]">
            {targetProperty === 'src'
              ? '`https://directus.example.com/assets/${item.image}`'
              : targetProperty === 'href'
              ? '"/gallery/men/" + item.slug'
              : targetProperty === 'aria-label'
              ? '`View details for ${item.name}`'
              : 'params.category + " тату у Запоріжжі"'}
          </code>
          )
        </p>

        {/* Scope Tokens Palette */}
        <div className="flex flex-col gap-1.5 p-2 bg-[var(--grid-line)]/50 rounded border border-[var(--control-border)]">
          <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Available Data Tokens
          </span>

          {/* Route Params */}
          {routeParams.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-disabled)] font-medium">Route:</span>
              {routeParams.map((param) => (
                <button
                  key={param}
                  type="button"
                  onClick={() => insertToken(`params.${param}`)}
                  className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/40 cursor-pointer transition-colors"
                  title={`Insert params.${param}`}
                >
                  params.{param}
                </button>
              ))}
            </div>
          )}

          {/* Current Loop Item Fields */}
          {(() => {
            const hasFields = fields.length > 0 || (collectionSlug ? (safeSchemas.get(collectionSlug)?.fields?.length ?? 0) > 0 : false);
            if (!hasFields) return null;
            const rowFields: FieldDefinition[] = fields.length > 0 ? fields : ((safeSchemas.get(collectionSlug!)?.fields as FieldDefinition[] | undefined) || []);
            const currentSchema = collectionSlug ? safeSchemas.get(collectionSlug) : null;
            const currentLabel = currentSchema?.name || (collectionSlug ? collectionSlug : null);
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-[var(--text-disabled)] font-medium">
                  {currentLabel ? `${currentLabel} (${itemVar}):` : `This Row (${itemVar}):`}
                </span>
                {rowFields.map((f: FieldDefinition) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => insertToken(`${itemVar}.${f.id}`)}
                    className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/40 cursor-pointer transition-colors"
                    title={`Insert ${itemVar}.${f.id}`}
                  >
                    {itemVar}.{f.id}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* CMS Collections (all available collections in the project) */}
          {Array.from(safeSchemas.entries()).map(([colSlug, schema]) => (
            <div key={colSlug} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-disabled)] font-medium">{schema.name || colSlug}:</span>
              {schema.fields?.map((f: FieldDefinition) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => insertToken(`${colSlug}[0].${f.id}`)}
                  className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 cursor-pointer transition-colors"
                  title={`Insert ${colSlug}[0].${f.id}`}
                >
                  {f.id}
                </button>
              ))}
            </div>
          ))}

          {/* Quick Syntax Operators */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[var(--control-border)]/40">
            <span className="text-[10px] text-[var(--text-disabled)] font-medium">Syntax:</span>
            <button
              type="button"
              onClick={() => insertToken(' + ')}
              className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-[var(--grid-line)] hover:bg-[var(--control-border)] text-[var(--text-primary)] border border-[var(--control-border)] cursor-pointer"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => insertToken(' || ""')}
              className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-[var(--grid-line)] hover:bg-[var(--control-border)] text-[var(--text-primary)] border border-[var(--control-border)] cursor-pointer"
            >
              || ""
            </button>
            <button
              type="button"
              onClick={() => insertToken('""')}
              className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-[var(--grid-line)] hover:bg-[var(--control-border)] text-[var(--text-primary)] border border-[var(--control-border)] cursor-pointer"
            >
              "text"
            </button>
            <button
              type="button"
              onClick={() => insertToken('`...${...}`')}
              className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-[var(--grid-line)] hover:bg-[var(--control-border)] text-[var(--text-primary)] border border-[var(--control-border)] cursor-pointer"
            >
              `template`
            </button>
          </div>
        </div>

        {/* Formula Input */}
        <div className="flex flex-col gap-1 relative">
          <label className="text-xs font-medium text-[var(--text-primary)]">
            Expression (JavaScript Formula):
          </label>
          <div className="relative">
            <textarea
              ref={textareaRef}
              rows={3}
              value={expression}
              onChange={handleTextChange}
              onSelect={handleSelect}
              onKeyUp={handleSelect}
              onClick={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={
                targetProperty === 'src'
                  ? '`https://directus.example.com/assets/${item.image}`'
                  : targetProperty === 'href'
                  ? '"/gallery/men/" + item.slug'
                  : 'params.category + " тату на " + params.place + " у Запоріжжі"'
              }
              className="w-full px-2.5 py-2 text-xs font-mono bg-[var(--grid-line)] border border-[var(--control-border)] hover:border-[var(--control-border-hover)] focus:border-purple-500 text-[var(--text-primary)] rounded focus:outline-none resize-none transition-colors"
            />

            {/* Intelligent Autocomplete Dropdown (Portaled so it floats above the modal and outside its bounds) */}
            {suggestions.length > 0 && portalStyle && typeof document !== 'undefined' && createPortal(
              <div
                ref={listRef}
                style={portalStyle}
                className="max-h-52 overflow-y-auto bg-[#18181f] border border-[var(--control-border)] rounded-md shadow-2xl py-1 divide-y divide-white/5"
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="px-2.5 py-1 text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider flex items-center justify-between bg-black/30">
                  <span>Suggestions ({suggestions.length})</span>
                  <span className="text-[9px] font-mono normal-case text-[var(--text-disabled)]">↑↓ navigate • ↵ select • esc close</span>
                </div>
                <div className="flex flex-col py-0.5">
                  {suggestions.map((item, idx) => {
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={`${item.label}-${idx}`}
                        type="button"
                        data-index={idx}
                        onClick={() => applySuggestion(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs ${
                          isSelected
                            ? 'bg-purple-600/30 text-white font-medium'
                            : 'text-[var(--text-primary)] hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {item.type === 'index' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              idx
                            </span>
                          )}
                          {item.type === 'property' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40">
                              prop
                            </span>
                          )}
                          {item.type === 'method' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              fn()
                            </span>
                          )}
                          {item.type === 'collection' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              col
                            </span>
                          )}
                          {item.type === 'param' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-pink-500/20 text-pink-300 border border-pink-500/40">
                              param
                            </span>
                          )}

                          <span className="font-mono text-xs truncate">
                            {item.displayLabel || item.label}
                          </span>
                        </div>

                        {item.detail && (
                          <span className="text-[11px] font-mono text-[var(--text-disabled)] truncate max-w-[180px] text-right">
                            {item.detail}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body,
            )}
          </div>
        </div>

        {/* Live Evaluated Output Preview */}
        <div className="flex flex-col gap-1 p-2 rounded bg-[var(--grid-line)]/80 border border-[var(--control-border)]">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-disabled)]">
            Live Output Preview
          </span>
          {evaluation.error ? (
            <span className="text-xs font-mono text-red-400 truncate" title={evaluation.error}>
              ⚠️ {evaluation.error}
            </span>
          ) : (
            <span className="text-xs font-medium text-emerald-400 break-all">
              {evaluation.result ? `"${evaluation.result}"` : <span className="text-[var(--text-disabled)] italic">(empty)</span>}
            </span>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--control-border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent hover:bg-[var(--grid-line)] border border-transparent rounded cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!expression.trim() || !!evaluation.error}
            onClick={handleApply}
            className="px-4 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded cursor-pointer transition-colors"
          >
            Apply Expression
          </button>
        </div>
      </div>
    </Modal>
  );
}
