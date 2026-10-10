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
import { SYSTEM_DATA_ATTRS, isCustomDataAttr } from '@/shared/constants';

const INPUT_CLS =
  'w-full h-[var(--control-height)] px-2 text-xs bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] hover:[--cut-border-color:var(--control-border-hover)] focus:border-[var(--border-focus)] focus:[--cut-border-color:var(--border-focus)] text-[var(--text-primary)] cut-corners cut-border focus:outline-none transition-colors placeholder:text-[var(--text-disabled)]';

function normalizeDataKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!trimmed || trimmed === 'data' || trimmed === 'data-') return '';
  return trimmed.startsWith('data-') ? trimmed : `data-${trimmed}`;
}

interface AttributeRowProps {
  attrKey: string;
  attrValue: string;
  onUpdateKey: (oldKey: string, newKey: string, val: string) => void;
  onUpdateValue: (key: string, val: string) => void;
  onRemove: (key: string) => void;
}

function AttributeRow({ attrKey, attrValue, onUpdateKey, onUpdateValue, onRemove }: AttributeRowProps) {
  const [localKey, setLocalKey] = useState(attrKey);
  const [localVal, setLocalVal] = useState(attrValue);

  useEffect(() => { setLocalKey(attrKey); }, [attrKey]);
  useEffect(() => { setLocalVal(attrValue); }, [attrValue]);

  const commitKey = useCallback(() => {
    const finalKey = normalizeDataKey(localKey);
    if (!finalKey || SYSTEM_DATA_ATTRS.has(finalKey) || finalKey === attrKey) {
      setLocalKey(attrKey);
      return;
    }
    onUpdateKey(attrKey, finalKey, localVal);
  }, [localKey, attrKey, localVal, onUpdateKey]);

  const commitValue = useCallback(() => {
    if (localVal === attrValue) return;
    onUpdateValue(attrKey, localVal);
  }, [localVal, attrValue, attrKey, onUpdateValue]);

  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <div className="flex-1 min-w-0">
        <input
          type="text"
          className={INPUT_CLS}
          value={localKey}
          onChange={(e) => setLocalKey(e.target.value)}
          onBlur={commitKey}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setLocalKey(attrKey); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="data-name"
          title={localKey}
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
      <RemoveButton onClick={() => onRemove(attrKey)} />
    </div>
  );
}

export default function AttributesTool() {
  const { node, nodeId } = useControl();

  const attrs = node?.attrs ?? {};
  const customEntries = useMemo(() => {
    return Object.entries(attrs)
      .filter(([k]) => isCustomDataAttr(k))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [attrs]);

  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftVal, setDraftVal] = useState('');
  const draftKeyRef = useRef<HTMLInputElement>(null);

  // Sync open state when node selection changes:
  // Auto-open if this node already has custom data attributes.
  useEffect(() => {
    const hasExisting = customEntries.length > 0;
    setOpen(hasExisting);
    setIsAdding(false);
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
      // Collapsing with '-' clears all custom data attributes on this node
      if (customEntries.length > 0) {
        const removals: Record<string, string> = {};
        for (const [k] of customEntries) {
          removals[k] = '';
        }
        trace.action('attributes-tool:clear-all', { nodeId, count: customEntries.length });
        queueMutation({
          type: 'updateHtmlAttrs',
          nodeId,
          attrs: removals,
        });
      }
      setIsAdding(false);
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
  }, [open, nodeId, customEntries]);

  // Focus input when adding
  useEffect(() => {
    if (isAdding && open) {
      draftKeyRef.current?.focus();
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
    trace.action('attributes-tool:remove-attr', { nodeId, key });
    queueMutation({
      type: 'updateHtmlAttrs',
      nodeId,
      attrs: { [key]: '' },
    });
  }, [nodeId]);

  const commitDraft = useCallback(() => {
    const finalKey = normalizeDataKey(draftKey);
    if (!finalKey || SYSTEM_DATA_ATTRS.has(finalKey) || !nodeId) {
      setIsAdding(false);
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
    setDraftKey('');
    setDraftVal('');
  }, [draftKey, draftVal, nodeId]);

  const cancelDraft = useCallback(() => {
    setIsAdding(false);
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
            onUpdateKey={handleUpdateKey}
            onUpdateValue={handleUpdateValue}
            onRemove={handleRemove}
          />
        ))}

        {/* Adding draft row */}
        {isAdding && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="flex-1 min-w-0">
              <input
                ref={draftKeyRef}
                type="text"
                className={INPUT_CLS}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDraft();
                  if (e.key === 'Escape') cancelDraft();
                }}
                placeholder="data-attribute"
              />
            </div>
            <div className="flex-1 min-w-0">
              <input
                type="text"
                className={INPUT_CLS}
                value={draftVal}
                onChange={(e) => setDraftVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDraft();
                  if (e.key === 'Escape') cancelDraft();
                }}
                onBlur={() => {
                  if (draftKey.trim() && draftKey.trim() !== 'data-') commitDraft();
                  else cancelDraft();
                }}
                placeholder="attribute-value"
              />
            </div>
            <RemoveButton onClick={cancelDraft} />
          </div>
        )}

        {/* Small inline add when open and not currently adding */}
        {!isAdding && (
          <button
            type="button"
            onClick={() => {
              setIsAdding(true);
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
