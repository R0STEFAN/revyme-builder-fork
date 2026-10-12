// AttributesTool.tsx — Custom data-* attributes editor on the properties panel.
// Allows adding, editing, and removing arbitrary data-* attributes directly on elements
// and design component instances. Follows the standard Revyme panel UX:
// The section header has a +/- toggle. Clicking + expands the section; clicking -
// clears all custom attributes and collapses the section.

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ToolSection, RemoveButton } from '../controls';
import { useControl } from '../controls/ControlProvider';
import { queueMutation } from '@/code/mutation/mutation-queue';
import { trace } from '@/shared/debug-trace';
import {
  SYSTEM_DATA_ATTRS,
  isCustomAttr,
  isBuilderDefaultAttr,
  COMMON_ATTRIBUTE_SUGGESTIONS,
  type AttrSuggestion,
} from '@/shared/constants';

const INPUT_CLS =
  'w-full h-[var(--control-height)] px-2 text-xs bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] hover:[--cut-border-color:var(--control-border-hover)] focus:border-[var(--border-focus)] focus:[--cut-border-color:var(--border-focus)] text-[var(--text-primary)] cut-corners cut-border focus:outline-none transition-colors placeholder:text-[var(--text-disabled)]';

function normalizeAttrKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!trimmed || trimmed === 'data' || trimmed === 'data-') return '';
  return trimmed;
}

interface AttributeRowProps {
  attrKey: string;
  attrValue: string;
  isBuilderDefault?: boolean;
  onUpdateKey: (oldKey: string, newKey: string, val: string) => void;
  onUpdateValue: (key: string, val: string) => void;
  onRemove: (key: string) => void;
}

function AttributeRow({
  attrKey,
  attrValue,
  isBuilderDefault = false,
  onUpdateKey,
  onUpdateValue,
  onRemove,
}: AttributeRowProps) {
  const [localKey, setLocalKey] = useState(attrKey);
  const [localVal, setLocalVal] = useState(attrValue);

  useEffect(() => { setLocalKey(attrKey); }, [attrKey]);
  useEffect(() => { setLocalVal(attrValue); }, [attrValue]);

  const commitKey = useCallback(() => {
    const finalKey = normalizeAttrKey(localKey);
    if (!finalKey || !isCustomAttr(finalKey) || finalKey === attrKey || isBuilderDefault) {
      setLocalKey(attrKey);
      return;
    }
    onUpdateKey(attrKey, finalKey, localVal);
  }, [localKey, attrKey, localVal, onUpdateKey, isBuilderDefault]);

  const commitValue = useCallback(() => {
    if (localVal === attrValue) return;
    onUpdateValue(attrKey, localVal);
  }, [localVal, attrValue, attrKey, onUpdateValue]);

  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <div className="flex-1 min-w-0">
        <input
          type="text"
          className={`${INPUT_CLS} ${isBuilderDefault ? 'opacity-80 cursor-default' : ''}`}
          value={localKey}
          onChange={(e) => setLocalKey(e.target.value)}
          onBlur={commitKey}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setLocalKey(attrKey); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="attribute"
          title={isBuilderDefault ? `${localKey} (default builder attribute)` : localKey}
          disabled={isBuilderDefault}
        />
      </div>
      <div className="flex-1 min-w-0">
        <input
          type="text"
          className={INPUT_CLS}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setLocalVal(attrValue); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="value"
          title={localVal}
        />
      </div>
      <RemoveButton
        onClick={() => onRemove(attrKey)}
        disabled={isBuilderDefault}
        title={isBuilderDefault ? 'Default builder attribute (cannot be deleted)' : 'Remove attribute'}
      />
    </div>
  );
}

export default function AttributesTool() {
  const { node, nodeId } = useControl();

  const attrs = node?.attrs ?? {};
  const customEntries = useMemo(() => {
    return Object.entries(attrs)
      .filter(([k]) => isCustomAttr(k))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [attrs]);

  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftVal, setDraftVal] = useState('');
  const draftKeyRef = useRef<HTMLInputElement>(null);
  const draftValRef = useRef<HTMLInputElement>(null);
  const draftRowRef = useRef<HTMLDivElement>(null);
  const suggestionsListRef = useRef<HTMLDivElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [openDir, setOpenDir] = useState<'up' | 'down'>('down');

  const updateOpenDir = useCallback(() => {
    const el = draftRowRef.current ?? draftKeyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const MENU_HEIGHT = 220;
    if (spaceBelow < MENU_HEIGHT && spaceAbove > spaceBelow) {
      setOpenDir('up');
    } else {
      setOpenDir('down');
    }
  }, []);

  useEffect(() => {
    if (!showSuggestions) return;
    updateOpenDir();
    window.addEventListener('resize', updateOpenDir);
    window.addEventListener('scroll', updateOpenDir, true);
    return () => {
      window.removeEventListener('resize', updateOpenDir);
      window.removeEventListener('scroll', updateOpenDir, true);
    };
  }, [showSuggestions, updateOpenDir]);

  const filteredSuggestions = useMemo(() => {
    const raw = draftKey.trim().toLowerCase();
    const existingKeys = new Set(Object.keys(attrs));
    const available = COMMON_ATTRIBUTE_SUGGESTIONS.filter((s) => !existingKeys.has(s.name));

    if (!raw || raw === 'data') {
      return available.slice(0, 8);
    }
    const starts: AttrSuggestion[] = [];
    const contains: AttrSuggestion[] = [];
    for (const s of available) {
      const lower = s.name.toLowerCase();
      if (lower === raw) continue;
      if (lower.startsWith(raw)) {
        starts.push(s);
      } else if (lower.includes(raw)) {
        contains.push(s);
      }
    }
    return [...starts, ...contains].slice(0, 8);
  }, [draftKey, attrs]);

  useEffect(() => {
    setSuggestIndex(0);
  }, [filteredSuggestions.length, draftKey]);

  useEffect(() => {
    if (!showSuggestions || !suggestionsListRef.current) return;
    const activeEl = suggestionsListRef.current.querySelector<HTMLElement>(
      `[data-index="${suggestIndex}"]`
    );
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [suggestIndex, showSuggestions]);

  const chooseSuggestion = useCallback((s: AttrSuggestion) => {
    setDraftKey(s.name);
    if (!draftVal && s.defaultValue) {
      setDraftVal(s.defaultValue);
    }
    setShowSuggestions(false);
    setTimeout(() => {
      draftValRef.current?.focus();
      if (s.defaultValue) {
        draftValRef.current?.select();
      }
    }, 0);
  }, [draftVal]);

  // Sync open state when node selection changes:
  // Auto-open if this node already has custom attributes.
  useEffect(() => {
    const hasExisting = customEntries.length > 0;
    setOpen(hasExisting);
    setIsAdding(false);
    setShowSuggestions(false);
    setDraftKey('');
    setDraftVal('');
  }, [nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When customEntries becomes > 0 (e.g. after adding first attribute), ensure open
  useEffect(() => {
    if (customEntries.length > 0) {
      setOpen(true);
    }
  }, [customEntries.length]);

  const handleToggle = useCallback(() => {
    const next = !open;
    trace.action('attributes-tool:toggle', { nodeId, open: next });
    if (!next && nodeId) {
      // Collapsing with '-' clears custom attributes, but preserves unchanged builder defaults
      if (customEntries.length > 0) {
        const removals: Record<string, string> = {};
        for (const [k, v] of customEntries) {
          if (!isBuilderDefaultAttr(node?.type, k, v)) {
            removals[k] = '';
          }
        }
        if (Object.keys(removals).length > 0) {
          trace.action('attributes-tool:clear-all', { nodeId, count: Object.keys(removals).length });
          queueMutation({
            type: 'updateHtmlAttrs',
            nodeId,
            attrs: removals,
          });
        }
      }
      setIsAdding(false);
      setShowSuggestions(false);
      setDraftKey('');
      setDraftVal('');
    } else if (next) {
      // Opening with '+': if no attributes exist yet, show draft input row ready for entry
      if (customEntries.length === 0) {
        setIsAdding(true);
        setDraftKey('data-');
        setDraftVal('');
      }
    }
    setOpen(next);
  }, [open, nodeId, customEntries, node?.type]);

  // Focus input when adding
  useEffect(() => {
    if (isAdding && open) {
      draftKeyRef.current?.focus();
      setShowSuggestions(true);
    }
  }, [isAdding, open]);

  const handleUpdateKey = useCallback((oldKey: string, newKey: string, val: string) => {
    if (!nodeId) return;
    trace.action('attributes-tool:rename-attr', { nodeId, from: oldKey, to: newKey, val });
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: { [oldKey]: '', [newKey]: val },
    });
  }, [nodeId]);

  const handleUpdateValue = useCallback((key: string, val: string) => {
    if (!nodeId) return;
    trace.action('attributes-tool:update-attr', { nodeId, key, val });
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: { [key]: val },
    });
  }, [nodeId]);

  const handleRemove = useCallback((key: string) => {
    if (!nodeId) return;
    const currentVal = attrs[key];
    if (isBuilderDefaultAttr(node?.type, key, currentVal)) {
      return; // Protected: do not delete builder default attribute
    }
    trace.action('attributes-tool:remove-attr', { nodeId, key });
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: { [key]: '' },
    });
  }, [nodeId, attrs, node?.type]);

  const commitDraft = useCallback(() => {
    const finalKey = normalizeAttrKey(draftKey);
    if (!finalKey || !isCustomAttr(finalKey) || !nodeId) {
      setIsAdding(false);
      setShowSuggestions(false);
      setDraftKey('');
      setDraftVal('');
      return;
    }
    trace.action('attributes-tool:add-attr', { nodeId, key: finalKey, val: draftVal });
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: { [finalKey]: draftVal },
    });
    setIsAdding(false);
    setShowSuggestions(false);
    setDraftKey('');
    setDraftVal('');
  }, [draftKey, draftVal, nodeId]);

  const cancelDraft = useCallback(() => {
    setIsAdding(false);
    setShowSuggestions(false);
    setDraftKey('');
    setDraftVal('');
  }, []);

  trace.fn('AttributesTool:render', { nodeId, count: customEntries.length, open, isAdding });

  const toggleBtn = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleToggle();
      }}
      className="w-5 h-5 flex items-center justify-center cursor-pointer group text-[var(--text-primary)]"
      title={open ? 'Remove all attributes and close' : 'Add attribute'}
    >
      {open ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="transition-opacity group-hover:opacity-80">
          <path d="M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="transition-opacity group-hover:opacity-80">
          <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );

  return (
    <ToolSection
      title="Attributes"
      collapsible
      action={toggleBtn}
      hasContent={open}
    >
      <div className="contents">
        {/* Existing entries */}
        {customEntries.map(([k, v]) => (
          <AttributeRow
            key={k}
            attrKey={k}
            attrValue={v}
            isBuilderDefault={isBuilderDefaultAttr(node?.type, k, v)}
            onUpdateKey={handleUpdateKey}
            onUpdateValue={handleUpdateValue}
            onRemove={handleRemove}
          />
        ))}

        {/* Adding draft row */}
        {isAdding && (
          <div ref={draftRowRef} className="relative mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <input
                  ref={draftKeyRef}
                  type="text"
                  className={INPUT_CLS}
                  value={draftKey}
                  onChange={(e) => {
                    setDraftKey(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  onKeyDown={(e) => {
                    if (showSuggestions && filteredSuggestions.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSuggestIndex((i) => (i + 1) % filteredSuggestions.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSuggestIndex((i) => (i - 1 + filteredSuggestions.length) % filteredSuggestions.length);
                        return;
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const pick = filteredSuggestions[suggestIndex];
                        if (pick) {
                          chooseSuggestion(pick);
                          return;
                        }
                      }
                      if (e.key === 'Tab') {
                        const pick = filteredSuggestions[suggestIndex];
                        if (pick) {
                          e.preventDefault();
                          chooseSuggestion(pick);
                          return;
                        }
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setShowSuggestions(false);
                        return;
                      }
                    }
                    if (e.key === 'Enter') commitDraft();
                    if (e.key === 'Escape') cancelDraft();
                  }}
                  placeholder="data-attribute"
                  autoComplete="off"
                />
              </div>

              <div className="flex-1 min-w-0">
                <input
                  ref={draftValRef}
                  type="text"
                  className={INPUT_CLS}
                  value={draftVal}
                  onChange={(e) => setDraftVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitDraft();
                    if (e.key === 'Escape') cancelDraft();
                  }}
                  onBlur={() => {
                    const k = draftKey.trim();
                    if (k && k !== 'data-' && k !== 'data') commitDraft();
                    else cancelDraft();
                  }}
                  placeholder="attribute-value"
                />
              </div>
              <RemoveButton onClick={cancelDraft} />
            </div>

            {showSuggestions && filteredSuggestions.length > 0 && (
              <div
                ref={suggestionsListRef}
                data-testid="attribute-suggestions"
                data-direction={openDir}
                className={`absolute left-0 right-0 ${
                  openDir === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
                } z-50 bg-[var(--dropdown-bg)] border border-[var(--border-light)] cut-corners cut-lg cut-border [--cut-border-color:var(--border-light)] shadow-2xl max-h-52 overflow-y-auto py-1 [scrollbar-width:thin]`}
              >
                {filteredSuggestions.map((s, idx) => {
                  const isSelected = idx === suggestIndex;
                  return (
                    <div
                      key={s.name}
                      data-testid={`attribute-suggestion-${s.name}`}
                      data-index={idx}
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => chooseSuggestion(s)}
                      onMouseEnter={() => setSuggestIndex(idx)}
                      className={`px-2.5 py-1 text-xs cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                        isSelected
                          ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                          : 'text-[var(--text-primary)] hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="font-mono font-medium truncate">{s.name}</span>
                      {s.hint && (
                        <span
                          className={`text-[10px] shrink-0 ${
                            isSelected ? 'opacity-90 text-[var(--accent-fg)]' : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {s.hint}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Small inline add when open and not currently adding */}
        {!isAdding && (
          <button
            type="button"
            onClick={() => {
              setIsAdding(true);
              setShowSuggestions(true);
              setDraftKey('data-');
              setDraftVal('');
            }}
            className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer pt-0.5 text-left"
          >
            + Add attribute
          </button>
        )}
      </div>
    </ToolSection>
  );
}
