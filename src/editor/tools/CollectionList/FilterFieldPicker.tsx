import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { FieldDefinition } from '@/shared/types';
import type { HierarchicalField } from './cms-filter-utils';
import { trace } from '@/shared/debug-trace';

/** The type-specific dynamic input label (design-tool parity), or null when the field
 *  type has no meaningful dynamic control. */
function dynamicInputLabel(type: string | undefined): string | null {
  switch (type) {
    case 'text': case 'string': case 'richtext': case 'slug': return 'Search Field';
    case 'image': return 'Checkbox';       // "has image"
    case 'boolean': return 'Checkbox';
    case 'number': return 'Number Input';
    case 'date': return 'Date Picker';
    case 'enum': return 'Select';
    default: return null;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  fields: FieldDefinition[];
  hierarchicalFields?: HierarchicalField[];
  anchorRef: React.RefObject<HTMLElement | null>;
  /** STATIC condition for `fieldId` (wired). */
  onPickStatic: (fieldId: string) => void;
  /** DYNAMIC input for `fieldId` — creates a bound Search Field. Only offered for
   *  text fields (the implemented dynamic kind) and only when allowed (page base
   *  context). Absent → the Dynamic option renders greyed. */
  onPickDynamic?: (fieldId: string) => void;
  /** Route params detected on the active page (e.g. ['category', 'place']). */
  routeParams?: string[];
  /** Pick a route param as the dynamic filter value. */
  onPickRouteParam?: (fieldId: string, param: string) => void;
}

/** Whether a field type supports a WIRED dynamic input today (Search Field for
 *  text-like fields). Other types still SHOW their dynamic label, but greyed. */
function dynamicWired(type: string | undefined): boolean {
  return dynamicInputLabel(type) === 'Search Field';
}

const ROW = 'group flex items-center justify-between mx-1.5 px-2.5 py-1.5 cut-corners w-[calc(100%-12px)] text-left cursor-pointer bg-transparent hover:!bg-[var(--accent)] border-none whitespace-nowrap';
const ROW_LABEL = 'text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-fg)]';

/** One field row + its cascading flyout (Dynamic option / Route Param / Static / Subfields). */
function HierarchicalFieldRow({
  field,
  onStatic,
  onDynamic,
  routeParams,
  onPickRouteParam,
  depth = 0,
}: {
  field: HierarchicalField;
  onStatic: (fieldId: string) => void;
  onDynamic?: (fieldId: string) => void;
  routeParams?: string[];
  onPickRouteParam?: (fieldId: string, param: string) => void;
  depth?: number;
}) {
  const [showSub, setShowSub] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, toRight: false, btnTop: 0, btnBottom: 0 });
  const dyn = dynamicInputLabel(field.type);
  const hasChildren = !!(field.children && field.children.length > 0);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const toRight = r.left - 230 < 10;
    const x = toRight ? r.right + 4 : r.left - 4;
    
    // Default: align top of flyout with the hovered row button
    let y = r.top;
    const flyoutH = portalRef.current?.offsetHeight || 160;
    
    // If flyout would overflow bottom of viewport, shift up so bottom of flyout aligns with button bottom
    if (y + flyoutH > window.innerHeight - 8) {
      y = Math.max(8, Math.min(r.bottom - flyoutH, window.innerHeight - flyoutH - 8));
    }
    
    setPos({ x, y, toRight, btnTop: r.top, btnBottom: r.bottom });
  }, []);

  useLayoutEffect(() => {
    if (showSub) {
      updatePos();
      const raf = requestAnimationFrame(updatePos);
      window.addEventListener('resize', updatePos);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', updatePos);
      };
    }
  }, [showSub, updatePos]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setShowSub(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShowSub(false);
    }, 120);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const el = portalRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener('mousedown', stop, true);
    return () => el.removeEventListener('mousedown', stop, true);
  });

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button ref={btnRef} type="button" className={ROW} onClick={() => setShowSub(v => !v)}>
        <span className={ROW_LABEL}>{field.name}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-secondary)] group-hover:text-[var(--accent-fg)] shrink-0 ml-2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {showSub && createPortal(
        <div
          ref={portalRef}
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: pos.toRight ? 'none' : 'translateX(-100%)',
            zIndex: 100031 + depth * 2,
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div
            style={{
              position: 'absolute',
              top: Math.min(0, (pos.btnTop || pos.y) - pos.y),
              [pos.toRight ? 'left' : 'right']: -16,
              width: 20,
              height: Math.max(
                portalRef.current?.offsetHeight || 160,
                (pos.btnBottom || pos.y + 30) - Math.min(pos.y, pos.btnTop || pos.y)
              ),
            }}
          />
          <div className="min-w-[170px] max-w-[280px] max-h-[380px] overflow-y-auto bg-[var(--dropdown-bg)] border border-[var(--border-light)] cut-corners cut-lg cut-border [--cut-border-color:var(--border-light)] shadow-2xl py-1.5">
            {/* Direct options for this field / relation itself */}
            {(dyn || (routeParams && routeParams.length > 0)) && (
              <>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] opacity-60">
                  {hasChildren ? 'Filter Whole Relation' : 'Dynamic'}
                </div>
                {onDynamic && dynamicWired(field.type) ? (
                  <button type="button" className={ROW} onClick={() => onDynamic(field.fullPath)}>
                    <span className={ROW_LABEL}>{dyn}</span>
                  </button>
                ) : (
                  (!routeParams || routeParams.length === 0) && dyn ? (
                    <div className="mx-1.5 px-2.5 py-1.5 rounded w-[calc(100%-12px)] whitespace-nowrap opacity-40" title="Coming soon">
                      <span className={ROW_LABEL}>{dyn}</span>
                    </div>
                  ) : null
                )}
                {routeParams && routeParams.map(param => (
                  <button key={param} type="button" className={ROW} onClick={() => onPickRouteParam?.(field.fullPath, param)}>
                    <span className={ROW_LABEL}>Route Param ([:{param}])</span>
                  </button>
                ))}
              </>
            )}
            <button type="button" className={ROW} onClick={() => onStatic(field.fullPath)}>
              <span className={ROW_LABEL}>{hasChildren ? 'Static (Whole)' : 'Static'}</span>
            </button>

            {/* Nested Subfields if present */}
            {hasChildren && (
              <>
                <div className="h-px bg-white/10 mx-2 my-1.5" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] opacity-60">
                  Subfields ({field.name})
                </div>
                {field.children!.map(child => (
                  <HierarchicalFieldRow
                    key={child.fullPath}
                    field={child}
                    onStatic={onStatic}
                    onDynamic={onDynamic}
                    routeParams={routeParams}
                    onPickRouteParam={onPickRouteParam}
                    depth={depth + 1}
                  />
                ))}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function FilterFieldPicker({
  open,
  onClose,
  fields,
  hierarchicalFields,
  anchorRef,
  onPickStatic,
  onPickDynamic,
  routeParams,
  onPickRouteParam,
}: Props) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const [visible, setVisible] = useState(false);

  // Normalize fields into hierarchical representation
  const fieldTree: HierarchicalField[] = useMemo(() => {
    if (hierarchicalFields && hierarchicalFields.length > 0) return hierarchicalFields;
    return fields.map(f => ({
      id: f.id,
      name: f.name || f.id,
      fullPath: f.id,
      type: f.type || 'text',
    }));
  }, [hierarchicalFields, fields]);

  // Flattened list for direct search matching
  const flatSearchList = useMemo(() => {
    const list: HierarchicalField[] = [];
    function collect(nodes: HierarchicalField[]) {
      for (const node of nodes) {
        list.push(node);
        if (node.children && node.children.length > 0) {
          collect(node.children);
        }
      }
    }
    collect(fieldTree);
    return list;
  }, [fieldTree]);

  useEffect(() => {
    if (!open) { setQuery(''); setVisible(false); return; }
    const a = anchorRef.current?.getBoundingClientRect();
    if (a) {
      const M = 8, W = 250;
      const maxH = Math.min(420, window.innerHeight - M * 2);
      let top = a.bottom + 4;
      if (top + maxH > window.innerHeight - M) top = Math.max(M, window.innerHeight - M - maxH);
      let left = Math.min(a.left, window.innerWidth - W - M);
      left = Math.max(M, left);
      setPos({ left, top, maxH });
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => { cancelAnimationFrame(raf); };
  }, [open, anchorRef]);

  if (!open || !pos) return null;

  const isSearching = !!query.trim();
  const searchLower = query.trim().toLowerCase();
  const searchResults = isSearching
    ? flatSearchList.filter(f => f.fullPath.toLowerCase().includes(searchLower) || f.name.toLowerCase().includes(searchLower))
    : [];

  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100029 }}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); trace.action('filter-field-picker:backdrop-close', {}); onClose(); }}
      />
      <div
        ref={ref}
        style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxH, zIndex: 100030, width: 250, opacity: visible ? 1 : 0 }}
        className="bg-[var(--dropdown-bg)] border border-[var(--border-light)] cut-corners cut-lg cut-border [--cut-border-color:var(--border-light)] shadow-2xl py-1.5 overflow-y-auto transition-opacity duration-150"
      >
        {/* Inline search */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-secondary)] shrink-0">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type to search…"
            className="flex-1 min-w-0 bg-transparent border-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          />
        </div>
        <div className="h-px bg-white/10 mx-2 my-1" />

        {isSearching ? (
          searchResults.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No matching fields</div>
          ) : (
            searchResults.map(f => (
              <HierarchicalFieldRow
                key={f.fullPath}
                field={{ ...f, name: f.fullPath.replace(/\./g, ' › ') }}
                routeParams={routeParams}
                onStatic={(path) => { trace.action('filter-field-picker:static', { field: path }); onPickStatic(path); onClose(); }}
                onDynamic={onPickDynamic && dynamicWired(f.type)
                  ? (path) => { trace.action('filter-field-picker:dynamic', { field: path }); onPickDynamic(path); onClose(); }
                  : undefined}
                onPickRouteParam={onPickRouteParam
                  ? (path, param) => { trace.action('filter-field-picker:route-param', { field: path, param }); onPickRouteParam(path, param); onClose(); }
                  : undefined}
              />
            ))
          )
        ) : (
          fieldTree.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No fields</div>
          ) : (
            fieldTree.map(f => (
              <HierarchicalFieldRow
                key={f.fullPath}
                field={f}
                routeParams={routeParams}
                onStatic={(path) => { trace.action('filter-field-picker:static', { field: path }); onPickStatic(path); onClose(); }}
                onDynamic={onPickDynamic && dynamicWired(f.type)
                  ? (path) => { trace.action('filter-field-picker:dynamic', { field: path }); onPickDynamic(path); onClose(); }
                  : undefined}
                onPickRouteParam={onPickRouteParam
                  ? (path, param) => { trace.action('filter-field-picker:route-param', { field: path, param }); onPickRouteParam(path, param); onClose(); }
                  : undefined}
              />
            ))
          )
        )}
      </div>
    </>,
    document.body,
  );
}
