// ExpressionEditorPopup.tsx — Visual expression / formula editor dialog.
// Allows no-code authoring of dynamic composite text and URLs with token autocomplete and live preview.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import Modal from '@/design-system/Modal';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { collectionDataAtom, collectionSchemasAtom } from '@/code/stores/cms-store';
import type { FieldDefinition } from '@/shared/types';
import { trace } from '@/shared/debug-trace';

interface ExpressionEditorPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (expression: string) => void;
  initialExpression?: string;
  targetProperty?: 'text' | 'href';
  collectionSlug?: string;
  itemVar?: string;
  fields?: FieldDefinition[];
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
}: ExpressionEditorPopupProps) {
  const [expression, setExpression] = useState(initialExpression);
  const activeFilePath = useAtomValue(activeFilePathAtom);
  const collectionData = useAtomValue(collectionDataAtom);
  const collectionSchemas = useAtomValue(collectionSchemasAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setExpression(initialExpression);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, initialExpression]);

  // Extract route parameters from active file path (e.g. `app/gallery/[category]/[place]/page.client.tsx` -> `['category', 'place']`)
  const routeParams = useMemo(() => {
    if (!activeFilePath) return [];
    const matches = Array.from(activeFilePath.matchAll(/\[([^/\]]+)\]/g));
    const params = matches.map(m => m[1]).filter(p => !p.startsWith('...'));
    return Array.from(new Set(params));
  }, [activeFilePath]);

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
    setExpression(next);
    setTimeout(() => {
      el.focus();
      const nextPos = start + token.length;
      el.setSelectionRange(nextPos, nextPos);
    }, 0);
  }, [expression]);

  // Build sample evaluation context
  const sampleContext = useMemo(() => {
    const ctx: Record<string, any> = {};

    // 1. Mock params
    const mockParams: Record<string, string> = {};
    for (const p of routeParams) {
      mockParams[p] = p === 'category' ? 'men' : p === 'place' || p === 'placement' ? 'chest' : p;
    }
    ctx.params = mockParams;

    // 2. Mock collections data
    for (const [slug, items] of collectionData.entries()) {
      ctx[slug] = items;
      const varName = slug.replace(/[^a-zA-Z0-9]/g, '');
      if (varName) ctx[varName] = items;
    }

    // 3. Mock item inside collection loop
    if (collectionSlug) {
      const items = collectionData.get(collectionSlug) || [];
      ctx[itemVar] = items[0] || { name: 'Dragon Sleeve', slug: 'dragon-sleeve', title: 'Dragon Sleeve', _slug: 'dragon-sleeve' };
    } else {
      ctx[itemVar] = { name: 'Dragon Sleeve', slug: 'dragon-sleeve', title: 'Dragon Sleeve', _slug: 'dragon-sleeve' };
    }

    return ctx;
  }, [routeParams, collectionData, collectionSlug, itemVar]);

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={targetProperty === 'href' ? 'Link Expression (Formula)' : 'Text Expression (Formula)'}
      width={480}
    >
      <div className="flex flex-col gap-3 py-1">
        {/* Helper description */}
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed m-0">
          Combine variables, route params, and text in quotes (e.g.{' '}
          <code className="px-1 py-0.5 rounded bg-[var(--grid-line)] text-purple-300 font-mono text-[11px]">
            {targetProperty === 'href' ? '"/gallery/men/" + item.slug' : 'params.category + " тату у Запоріжжі"'}
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
          {(fields.length > 0 || (collectionSlug && (collectionSchemas.get(collectionSlug)?.fields?.length ?? 0) > 0)) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-disabled)] font-medium">This Row ({itemVar}):</span>
              {(fields.length > 0 ? fields : (collectionSchemas.get(collectionSlug!)?.fields || [])).map((f) => (
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
          )}

          {/* CMS Collections */}
          {Array.from(collectionSchemas.entries())
            .filter(([colSlug]) => colSlug !== collectionSlug)
            .map(([colSlug, schema]) => (
            <div key={colSlug} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-disabled)] font-medium">{schema.name || colSlug}:</span>
              {schema.fields?.map((f) => (
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
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-primary)]">
            Expression (JavaScript Formula):
          </label>
          <textarea
            ref={textareaRef}
            rows={3}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder={
              targetProperty === 'href'
                ? '"/gallery/men/" + item.slug'
                : 'params.category + " тату на " + params.place + " у Запоріжжі"'
            }
            className="w-full px-2.5 py-2 text-xs font-mono bg-[var(--grid-line)] border border-[var(--control-border)] hover:border-[var(--control-border-hover)] focus:border-purple-500 text-[var(--text-primary)] rounded focus:outline-none resize-none transition-colors"
          />
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
