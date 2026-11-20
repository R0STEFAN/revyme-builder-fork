// PseudoElementControl.tsx — Visual editor for CSS pseudo-states (:hover, :active, :focus-visible,
// custom single-node selectors) and pseudo-elements (::before, ::after, ::placeholder).
// Row style matches Border/Filter/Shadow: ControlLabel + ControlActionRow with summary + RemoveButton.
// Inner editor reuses real ToolAtom controls via MotionPropsEditor pattern (stopProps + onStopChange).
// Live preview via injectCanvasCSS. Writes via queueMutation({ type: 'updatePseudoStyle' }).

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { ControlLabel, ControlActionRow, RemoveButton, ToolInput, ToolSlider, ToolSelect, SingleEntryRow } from '../../../controls';
import ColorInput from '../../../controls/ColorInput';
import ToolPopup, { useToolPopupOptional } from '../../../ui/ToolPopup';
import { useControl } from '../../../controls/ControlProvider';
import { pseudoStylesAtom } from '@/code/stores/pseudo-store';
import { keyframeNamesAtom } from '@/code/stores/animation-store';
import {
  BUILTIN_PSEUDO_ELEMENTS,
  BUILTIN_PSEUDO_STATES,
  normalizePseudoKind,
  type PseudoKind,
} from '@/code/parsing/pseudo-parser';
import type { CanvasNode } from '@/code/parsing/parser';
import { forSelectionTargets, selectionTargetIds } from '../../../controls/multi-select-targets';
import { queueMutation } from '@/code/mutation/mutation-queue';
import { injectCanvasCSS, removeCanvasCSS } from '@/canvas/node-ops';
import { toKebab } from '@/shared/css-utils';
import {
  parseAnimationShorthand, formatAnimationShorthand, animationSummary,
  parseTransitionShorthand, formatTransitionShorthand, transitionSummary, createDefaultTransition,
  CSS_EASING_OPTIONS, CSS_DIRECTION_OPTIONS, CSS_FILL_OPTIONS, CSS_ITERATION_OPTIONS,
} from '@/shared/animation-utils';
import { trace } from '@/shared/debug-trace';
import { OpacityControl } from './OpacityControl';
import { RadiusControl } from './RadiusControl';
import { ClipPathControl } from './ClipPathControl';
import { FillControl } from './FillControl';
import { FilterControl } from './FilterControl';
import { ShadowControl } from './ShadowControl';
import { BorderControl } from './BorderControl';
import { MaskControl } from './MaskControl';
import { TransformControl } from './TransformControl';
import { ShadowControl as TextShadowControl } from '../../TextStyleTool/atoms/ShadowControl';
import { getPropertyIcon, PseudoIcon, TransitionIcon } from '@/design-system/PropertyIcons';
import type { AtomProps } from '../../../controls/unified/types';
import type { ComponentType } from 'react';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';

// ─── ToolAtom properties (reuse centralized controls) ──────────────────────

const ADDABLE_STYLE_ATOMS: { key: string; label: string; Atom: ComponentType<AtomProps> }[] = [
  { key: 'backgroundColor', label: 'Background', Atom: FillControl },
  { key: 'opacity', label: 'Opacity', Atom: OpacityControl },
  { key: 'borderRadius', label: 'Border Radius', Atom: RadiusControl },
  { key: 'clipPath', label: 'Clip Path', Atom: ClipPathControl },
  { key: 'filter', label: 'Filter', Atom: FilterControl },
  { key: 'boxShadow', label: 'Shadow', Atom: ShadowControl },
  { key: 'border', label: 'Border', Atom: BorderControl },
  { key: 'maskImage', label: 'Mask', Atom: MaskControl },
  { key: 'transform', label: 'Transform', Atom: TransformControl },
];

const SUB_PROPERTY_MAP: Record<string, string> = {
  borderWidth: 'border', borderStyle: 'border', borderColor: 'border',
  borderTopWidth: 'border', borderTopStyle: 'border', borderTopColor: 'border',
  borderRightWidth: 'border', borderRightStyle: 'border', borderRightColor: 'border',
  borderBottomWidth: 'border', borderBottomStyle: 'border', borderBottomColor: 'border',
  borderLeftWidth: 'border', borderLeftStyle: 'border', borderLeftColor: 'border',
  WebkitMaskImage: 'maskImage', mask: 'maskImage', WebkitMask: 'maskImage',
  background: 'backgroundColor', backgroundImage: 'backgroundColor',
};

// ─── Raw-value properties (slider+input, select, color, or text) ─────────

type RawPropType = 'numeric' | 'color' | 'text' | 'select' | 'dimension';
interface RawPropDef { key: string; label: string; type: RawPropType; min?: number; max?: number; step?: number; defaultValue: string; options?: { value: string; label: string }[] }

const POSITION_OPTIONS = [
  { value: 'absolute', label: 'Absolute' },
  { value: 'relative', label: 'Relative' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'sticky', label: 'Sticky' },
];

const POINTER_EVENTS_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'auto', label: 'Auto' },
];

const DIMENSION_UNIT_OPTIONS = [
  { value: 'px', label: 'px' },
  { value: '%', label: '%' },
  { value: 'rem', label: 'rem' },
  { value: 'em', label: 'em' },
  { value: 'vw', label: 'vw' },
  { value: 'vh', label: 'vh' },
  { value: 'svh', label: 'svh' },
  { value: 'svw', label: 'svw' },
  { value: 'dvh', label: 'dvh' },
  { value: 'dvw', label: 'dvw' },
  { value: 'lvh', label: 'lvh' },
  { value: 'lvw', label: 'lvw' },
  { value: 'auto', label: 'fit' },
];

const BLEND_MODE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

const RAW_PROPS: RawPropDef[] = [
  { key: 'content', label: 'Content', type: 'text', defaultValue: "''" },
  { key: 'position', label: 'Position', type: 'select', defaultValue: 'absolute', options: POSITION_OPTIONS },
  { key: 'inset', label: 'Inset', type: 'text', defaultValue: '0' },
  { key: 'top', label: 'Top', type: 'numeric', min: -500, max: 500, step: 1, defaultValue: '0' },
  { key: 'left', label: 'Left', type: 'numeric', min: -500, max: 500, step: 1, defaultValue: '0' },
  { key: 'right', label: 'Right', type: 'numeric', min: -500, max: 500, step: 1, defaultValue: '0' },
  { key: 'bottom', label: 'Bottom', type: 'numeric', min: -500, max: 500, step: 1, defaultValue: '0' },
  { key: 'width', label: 'Width', type: 'dimension', defaultValue: '100%' },
  { key: 'height', label: 'Height', type: 'dimension', defaultValue: '100%' },
  { key: 'color', label: 'Color', type: 'color', defaultValue: '#ffffff' },
  { key: 'zIndex', label: 'Z-Index', type: 'numeric', min: -10, max: 100, step: 1, defaultValue: '1' },
  { key: 'mixBlendMode', label: 'Blend Mode', type: 'select', defaultValue: 'normal', options: BLEND_MODE_OPTIONS },
  { key: 'pointerEvents', label: 'Pointer Events', type: 'select', defaultValue: 'none', options: POINTER_EVENTS_OPTIONS },
  { key: 'fontSize', label: 'Font Size', type: 'numeric', min: 0, max: 200, step: 1, defaultValue: '16px' },
  { key: 'fontFamily', label: 'Font Family', type: 'text', defaultValue: 'inherit' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

export function formatPseudoLabel(pseudo: PseudoKind): string {
  if (pseudo === 'before' || pseudo === 'after' || pseudo === 'placeholder') {
    return `::${pseudo}`;
  }
  if (pseudo.startsWith('custom:')) {
    return pseudo.slice('custom:'.length);
  }
  return `:${pseudo}`;
}

export function isInteractivePseudo(pseudo: PseudoKind): boolean {
  return pseudo !== 'before' && pseudo !== 'after' && pseudo !== 'placeholder';
}

export function formatCanvasRuleSelector(nodeId: string, pseudo: PseudoKind): string {
  if (pseudo === 'before' || pseudo === 'after' || pseudo === 'placeholder') {
    return `[data-id="${nodeId}"]::${pseudo}`;
  }
  if (pseudo.startsWith('custom:')) {
    return `[data-id="${nodeId}"]${pseudo.slice('custom:'.length)}`;
  }
  return `[data-id="${nodeId}"]:${pseudo}`;
}

export function formatCanvasPreviewSelector(nodeId: string): string {
  // Doubled same-node attribute selector increases specificity without colliding
  // with any base `[data-id="..."]` rule during removeCanvasCSS cleanup.
  return `[data-id="${nodeId}"][data-id="${nodeId}"]`;
}

export function isFormControlOwnedPseudo(
  node: Pick<CanvasNode, 'type' | 'attrs'> | null | undefined,
  pseudo: PseudoKind,
): boolean {
  if (!node) return false;
  const tag = node.type;
  const inputType = String(node.attrs?.type ?? 'text');
  const isControl =
    (tag === 'input' || tag === 'textarea' || tag === 'select') &&
    !['submit', 'button', 'reset', 'hidden'].includes(inputType);
  const isBoolean = tag === 'input' && (inputType === 'checkbox' || inputType === 'radio');
  return (isControl && pseudo === 'focus') || (isBoolean && pseudo === 'checked');
}

function starterStylesForPseudo(pseudo: PseudoKind): Record<string, string> {
  if (pseudo === 'before' || pseudo === 'after') {
    return { content: "''", position: 'absolute', inset: '0', pointerEvents: 'none' };
  }
  if (pseudo === 'placeholder') {
    return { color: '#888888' };
  }
  return { opacity: '0.85' };
}

function stylesToCSS(styles: Record<string, string>): string {
  return Object.entries(styles)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${toKebab(k)}: ${v} !important`)
    .join('; ');
}

function buildSummary(styles: Record<string, string>): string {
  const count = Object.keys(styles).filter(k => styles[k] !== '').length;
  return `${count} style${count !== 1 ? 's' : ''}`;
}

/** Parse numeric value from CSS string like "2px", "-10", "50%" */
function parseNum(raw: string): number {
  return parseFloat(raw) || 0;
}

/** Normalize text-shadow to "Xpx Ypx BLURpx COLOR" format that TextShadowControl expects.
 *  AI often generates "-1px 0 #FF0033" (no blur, no px on zero). */
function normalizeTextShadow(raw: string): string {
  if (!raw || raw === 'none') return 'none';
  // Match: X Y [blur] color — where values may lack px units
  const m = raw.match(/(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(?:(-?[\d.]+)(?:px)?\s+)?(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
  if (!m) return raw;
  const x = m[1], y = m[2], blur = m[3] || '0', color = m[4];
  return `${x}px ${y}px ${blur}px ${color}`;
}

// ─── Animation editor panel ────────────────────────────────────────────────

function parseSecondsInput(raw: string): number {
  const trimmed = raw.trim();
  const n = parseFloat(trimmed) || 0;
  const seconds = /ms$/i.test(trimmed) ? n / 1000 : n;
  return Math.max(0, Math.round(seconds * 1000) / 1000);
}

function AnimationEditorPanel({ initialValue, onCommit }: { initialValue: string; onCommit: (v: string) => void }) {
  const keyframeNames = useAtomValue(keyframeNamesAtom);
  const parsed = parseAnimationShorthand(initialValue);
  const initial = parsed[0] || { keyframeName: '', duration: 1, easing: 'ease', delay: 0, iterationCount: '1', direction: 'normal', fillMode: 'none' };
  const [vals, setVals] = useState(initial);

  const update = (patch: Partial<typeof vals>) => {
    const next = { ...vals, ...patch };
    setVals(next);
    if (!next.keyframeName) { onCommit('none'); return; }
    onCommit(formatAnimationShorthand([next]));
  };

  const nameOptions = [
    { value: '', label: 'None' },
    ...keyframeNames.map(n => ({ value: n, label: n })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <ControlLabel label="Keyframe" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.keyframeName} onChange={(v) => update({ keyframeName: v })} options={nameOptions} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Duration" property="" plain />
        <div className="flex items-center gap-1 w-full">
          <ToolSlider value={vals.duration} min={0} max={10} step={0.1} onChange={(v) => update({ duration: v })} />
          <ToolInput value={String(vals.duration)} onChange={(v) => update({ duration: parseSecondsInput(v) })} step={0.1} min={0} max={10} chevronLabel="s" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Easing" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.easing} onChange={(v) => update({ easing: v })} options={CSS_EASING_OPTIONS} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Delay" property="" plain />
        <div className="flex items-center gap-1 w-full">
          <ToolSlider value={vals.delay} min={0} max={5} step={0.1} onChange={(v) => update({ delay: v })} />
          <ToolInput value={String(vals.delay)} onChange={(v) => update({ delay: parseSecondsInput(v) })} step={0.1} min={0} max={5} chevronLabel="s" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Iterations" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.iterationCount} onChange={(v) => update({ iterationCount: v })} options={CSS_ITERATION_OPTIONS} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Direction" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.direction} onChange={(v) => update({ direction: v })} options={CSS_DIRECTION_OPTIONS} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Fill Mode" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.fillMode} onChange={(v) => update({ fillMode: v })} options={CSS_FILL_OPTIONS} />
        </div>
      </div>
    </div>
  );
}

/** Animation row — shows keyframe name summary, opens editor panel */
function AnimationRow({ value, onChange, onRemove }: {
  value: string; onChange: (v: string) => void; onRemove: () => void;
}) {
  const popupCtx = useToolPopupOptional();
  const parsed = parseAnimationShorthand(value);
  const summary = parsed.length > 0 ? animationSummary(parsed) : 'None';

  const handleClick = () => {
    if (popupCtx?.pushPanel) {
      popupCtx.pushPanel('Animation', <AnimationEditorPanel initialValue={value} onCommit={onChange} />);
    }
  };

  return (
    <div className="flex items-center justify-between w-full">
      <ControlLabel label="Animation" property="" plain />
      <ControlActionRow onClick={handleClick}>
        <span className="truncate flex-1">{summary}</span>
        <RemoveButton onClick={(e) => { e.stopPropagation(); onRemove(); }} />
      </ControlActionRow>
    </div>
  );
}

// ─── Transition editor panel ───────────────────────────────────────────────

const TRANSITION_PROPERTY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'background-color', label: 'Background' },
  { value: 'color', label: 'Color' },
  { value: 'transform', label: 'Transform' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'border-color', label: 'Border Color' },
  { value: 'box-shadow', label: 'Shadow' },
  { value: 'filter', label: 'Filter' },
];

const EDITORIAL_BEZIER = 'cubic-bezier(0.77, 0, 0.175, 1)';
const TRANSITION_EASING_OPTIONS = CSS_EASING_OPTIONS.some((o) => o.value === EDITORIAL_BEZIER)
  ? CSS_EASING_OPTIONS
  : [...CSS_EASING_OPTIONS, { value: EDITORIAL_BEZIER, label: 'Editorial (0.77, 0, 0.175, 1)' }];

function TransitionEditorPanel({ initialValue, onCommit }: { initialValue: string; onCommit: (v: string) => void }) {
  const parsed = parseTransitionShorthand(initialValue);
  const initial = parsed[0] || createDefaultTransition();
  const [vals, setVals] = useState(initial);

  const propOptions = TRANSITION_PROPERTY_OPTIONS.some((o) => o.value === vals.property)
    ? TRANSITION_PROPERTY_OPTIONS
    : [...TRANSITION_PROPERTY_OPTIONS, { value: vals.property, label: vals.property }];

  const easingOptions = TRANSITION_EASING_OPTIONS.some((o) => o.value === vals.easing)
    ? TRANSITION_EASING_OPTIONS
    : [...TRANSITION_EASING_OPTIONS, { value: vals.easing, label: vals.easing }];

  const update = (patch: Partial<typeof vals>) => {
    const next = { ...vals, ...patch };
    setVals(next);
    onCommit(formatTransitionShorthand([next]));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <ControlLabel label="Property" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.property} onChange={(v) => update({ property: v })} options={propOptions} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Duration" property="" plain />
        <div className="flex items-center gap-1 w-full">
          <ToolSlider value={vals.duration} min={0} max={5} step={0.05} onChange={(v) => update({ duration: v })} />
          <ToolInput value={String(vals.duration)} onChange={(v) => update({ duration: parseSecondsInput(v) })} step={0.05} min={0} max={5} chevronLabel="s" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Easing" property="" plain />
        <div className="w-full">
          <ToolSelect value={vals.easing} onChange={(v) => update({ easing: v })} options={easingOptions} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Delay" property="" plain />
        <div className="flex items-center gap-1 w-full">
          <ToolSlider value={vals.delay} min={0} max={5} step={0.05} onChange={(v) => update({ delay: v })} />
          <ToolInput value={String(vals.delay)} onChange={(v) => update({ delay: parseSecondsInput(v) })} step={0.05} min={0} max={5} chevronLabel="s" />
        </div>
      </div>
    </div>
  );
}

/** Transition row — shows shorthand summary (or Add button when unset), opens editor panel */
function TransitionRow({ value, onChange, onRemove }: {
  value: string; onChange: (v: string) => void; onRemove: () => void;
}) {
  const popupCtx = useToolPopupOptional();
  const hasValue = Boolean(value && value.trim() && value.trim() !== 'none');
  const parsed = parseTransitionShorthand(value);
  const summary = parsed.length > 0 ? transitionSummary(parsed) : (value || 'None');

  const handleOpen = () => {
    const seed = hasValue ? value : formatTransitionShorthand([createDefaultTransition()]);
    if (!hasValue) {
      onChange(seed);
    }
    if (popupCtx?.pushPanel) {
      popupCtx.pushPanel('Transition', <TransitionEditorPanel initialValue={seed} onCommit={onChange} />);
    }
  };

  return (
    <SingleEntryRow
      label="Transition" property="" plain
      hasValue={hasValue}
      onOpen={handleOpen}
      EmptyIcon={TransitionIcon}
      renderPreview={() => <span className="truncate flex-1">{summary}</span>}
      onRemove={hasValue ? (e) => { e.stopPropagation(); onRemove(); } : undefined}
    />
  );
}

// ─── Raw property row — renders slider+input for numeric, ColorInput for color, ToolInput for text

function RawPropertyRow({ def, value, onChange, onRemove }: {
  def: RawPropDef; value: string; onChange: (v: string) => void; onRemove: () => void;
}) {
  const unit = value.replace(/^-?[\d.]+/, '') || '';

  if (def.type === 'color') {
    return (
      <div className="flex items-center justify-between w-full">
        <ControlLabel label={def.label} property="" plain />
        <div className="w-full">
          <ControlActionRow onClick={undefined}>
            <ColorInput value={value} onChange={onChange} />
            <RemoveButton onClick={onRemove} />
          </ControlActionRow>
        </div>
      </div>
    );
  }

  if (def.type === 'select' && def.options) {
    return (
      <div className="flex items-center justify-between w-full">
        <ControlLabel label={def.label} property="" plain />
        <div className="flex items-center gap-1 w-full">
          <div className="flex-1">
            <ToolSelect value={value} onChange={onChange} options={def.options} />
          </div>
          <RemoveButton onClick={onRemove} />
        </div>
      </div>
    );
  }

  if (def.type === 'dimension') {
    const numVal = value === 'auto' ? '' : String(parseFloat(value) || 0);
    const unitVal = value === 'auto' ? 'auto' : (value.replace(/^-?[\d.]+/, '') || 'px');
    return (
      <div className="flex items-center justify-between w-full">
        <ControlLabel label={def.label} property="" plain />
        <div className="flex items-center gap-1 w-full">
          <div className="flex-1">
            <ToolInput
              value={numVal}
              onChange={(v) => {
                if (unitVal === 'auto') onChange('auto');
                else onChange(`${parseFloat(v) || 0}${unitVal}`);
              }}
              step={1}
              disabled={unitVal === 'auto'}
            />
          </div>
          <div className="flex-1">
            <ToolSelect
              value={unitVal}
              onChange={(u) => {
                if (u === 'auto') onChange('auto');
                else onChange(`${parseFloat(numVal) || 0}${u}`);
              }}
              options={DIMENSION_UNIT_OPTIONS}
            />
          </div>
          <RemoveButton onClick={onRemove} />
        </div>
      </div>
    );
  }

  if (def.type === 'numeric') {
    return (
      <div className="flex items-center justify-between w-full">
        <ControlLabel label={def.label} property="" plain />
        <div className="flex items-center gap-1 w-full">
          <ToolSlider value={parseNum(value)} min={def.min ?? -500} max={def.max ?? 500} step={def.step ?? 1}
            onChange={(v) => onChange(`${v}${unit || 'px'}`)} />
          <ToolInput value={value} onChange={onChange} />
          <RemoveButton onClick={onRemove} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between w-full">
      <ControlLabel label={def.label} property="" plain />
      <div className="flex items-center gap-1 w-full">
        <div className="flex-1">
          <ToolInput value={value} onChange={onChange} />
        </div>
        <RemoveButton onClick={onRemove} />
      </div>
    </div>
  );
}

// ─── PseudoEditor (inside ToolPopup) ────────────────────────────────────────

function PseudoEditor({ nodeId, pseudo, styles }: {
  nodeId: string; pseudo: PseudoKind; styles: Record<string, string>;
}) {
  const popupCtx = useToolPopupOptional();
  const pushPanel = popupCtx?.pushPanel;
  const popPanel = popupCtx?.popPanel;
  const interactive = isInteractivePseudo(pseudo);
  const [previewOnCanvas, setPreviewOnCanvas] = useState(interactive);
  const [localStyles, setLocalStyles] = useState<Record<string, string>>(() => ({ ...styles }));
  const localRef = useRef(localStyles);
  localRef.current = localStyles;
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;
  const pseudoRef = useRef(pseudo);
  pseudoRef.current = pseudo;
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External re-seed (undo/redo while the pseudo editor is open). Own
  // commits are debounced writes counted by selfWriteRef — skipped so
  // mid-typing state is never clobbered by the round-trip.
  const stylesSig = JSON.stringify(styles);
  const selfWriteRef = useRef(0);
  const prevStylesSigRef = useRef(stylesSig);
  useEffect(() => {
    if (stylesSig === prevStylesSigRef.current) return;
    prevStylesSigRef.current = stylesSig;
    if (selfWriteRef.current > 0) { selfWriteRef.current--; return; }
    setLocalStyles({ ...styles });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stylesSig]);

  trace.fn('PseudoEditor:render', { nodeId, pseudo, propCount: Object.keys(localStyles).length });

  const doWrite = useCallback((s: Record<string, string>) => {
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(s)) { if (v) filtered[k] = v; }
    expediteStableAtomSync();
    // Multi-selection: the same pseudo styles land on every selected node.
    forSelectionTargets(nodeIdRef.current, (tid) =>
      queueMutation({ type: 'updatePseudoStyle', nodeId: tid, pseudo: pseudoRef.current, styles: filtered })
    );
    trace.action('pseudo-editor:write', {
      nodeId: nodeIdRef.current,
      pseudo: pseudoRef.current,
      propCount: Object.keys(filtered).length,
    });
  }, []);
  const doWriteRef = useRef(doWrite);
  doWriteRef.current = doWrite;

  // Flush pending debounced writes and strip canvas CSS overrides on unmount.
  useEffect(() => {
    const targets = selectionTargetIds(nodeIdRef.current);
    const activePseudo = pseudoRef.current;
    return () => {
      for (const tid of targets) {
        removeCanvasCSS(formatCanvasRuleSelector(tid, activePseudo));
        removeCanvasCSS(formatCanvasPreviewSelector(tid));
      }
      if (writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
        doWriteRef.current(localRef.current);
      }
    };
  }, []);

  // Live preview via injectCanvasCSS (plus forced preview on the element when toggled on).
  useEffect(() => {
    const css = stylesToCSS(localStyles);
    forSelectionTargets(nodeId, (tid) => {
      const ruleSel = formatCanvasRuleSelector(tid, pseudo);
      const previewSel = formatCanvasPreviewSelector(tid);
      if (css) injectCanvasCSS(ruleSel, css);
      else removeCanvasCSS(ruleSel);

      if (interactive && previewOnCanvas && css) {
        injectCanvasCSS(previewSel, css);
      } else {
        removeCanvasCSS(previewSel);
      }
    });
  }, [localStyles, nodeId, pseudo, interactive, previewOnCanvas]);

  const scheduleWrite = useCallback((s: Record<string, string>) => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => { writeTimerRef.current = null; selfWriteRef.current++; doWrite(s); }, 400);
  }, [doWrite]);

  const handleChange = useCallback((newStyles: Record<string, string>) => {
    setLocalStyles(newStyles);
    scheduleWrite(newStyles);
  }, [scheduleWrite]);

  // Mode props for ToolAtom controls — route through stopProps/onStopChange
  const mp: AtomProps = { mode: 'scrollStop' as const, stopProps: localStyles, onStopChange: handleChange };

  // Determine which ToolAtom keys are active
  const allKeys = new Set(Object.keys(localStyles));
  for (const key of [...allKeys]) {
    if (SUB_PROPERTY_MAP[key]) allKeys.add(SUB_PROPERTY_MAP[key]);
  }
  const activeAtomKeys = [...allKeys].filter(k => ADDABLE_STYLE_ATOMS.some(a => a.key === k));
  const activeRawProps = RAW_PROPS.filter(p => allKeys.has(p.key));
  const hasTextShadow = allKeys.has('textShadow');
  const hasAnimation = allKeys.has('animation');
  const hasTransition = allKeys.has('transition');

  // Available to add
  const availableAtoms = ADDABLE_STYLE_ATOMS.filter(a => !allKeys.has(a.key));
  const availableRaw = RAW_PROPS.filter(p => !allKeys.has(p.key));
  const canAddTextShadow = !hasTextShadow;
  const canAddAnimation = !hasAnimation;
  const canAddTransition = !interactive && !hasTransition;

  return (
    <div className="flex flex-col gap-2">
      {interactive && (
        <button
          type="button"
          aria-pressed={previewOnCanvas}
          onClick={() => setPreviewOnCanvas((v) => !v)}
          className={`w-full h-[var(--control-height)] flex items-center justify-between px-2 text-xs cut-corners cut-border border cursor-pointer transition-colors ${
            previewOnCanvas
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)] [--cut-border-color:var(--accent)]'
              : 'bg-[var(--grid-line)] text-[var(--text-secondary)] border-[var(--control-border)] [--cut-border-color:var(--control-border)]'
          }`}
        >
          <span>Preview on canvas</span>
          <span className="font-mono text-[10px]">{previewOnCanvas ? 'ON' : 'OFF'}</span>
        </button>
      )}

      {/* Raw value properties — slider+input, color, or text rows */}
      {activeRawProps.map((def) => (
        <RawPropertyRow
          key={def.key}
          def={def}
          value={localStyles[def.key] || ''}
          onChange={(v) => handleChange({ ...localRef.current, [def.key]: v })}
          onRemove={() => {
            const updated = { ...localRef.current };
            delete updated[def.key];
            handleChange(updated);
            trace.action('pseudo-editor:remove-property', { nodeId, pseudo, property: def.key });
          }}
        />
      ))}

      {/* Text Shadow — standalone control, renders its own label + row */}
      {hasTextShadow && (
        <TextShadowControl
          value={normalizeTextShadow(localStyles.textShadow || 'none')}
          onChange={(v) => handleChange({ ...localRef.current, textShadow: v })}
        />
      )}

      {/* Animation — keyframe selector + timing controls */}
      {hasAnimation && (
        <AnimationRow
          value={localStyles.animation || 'none'}
          onChange={(v) => handleChange({ ...localRef.current, animation: v })}
          onRemove={() => {
            const updated = { ...localRef.current };
            delete updated.animation;
            handleChange(updated);
          }}
        />
      )}

      {/* Transition — always visible for interactive states (:hover, :active, etc.) */}
      {(interactive || hasTransition) && (
        <TransitionRow
          value={localStyles.transition || ''}
          onChange={(v) => handleChange({ ...localRef.current, transition: v })}
          onRemove={() => {
            const updated = { ...localRef.current };
            delete updated.transition;
            handleChange(updated);
            trace.action('pseudo-editor:remove-property', { nodeId, pseudo, property: 'transition' });
          }}
        />
      )}

      {/* ToolAtom-backed properties — reuse centralized controls */}
      {activeAtomKeys.map(key => {
        const entry = ADDABLE_STYLE_ATOMS.find(a => a.key === key);
        if (!entry) return null;
        return <entry.Atom key={key} {...mp} />;
      })}

      {/* Add Property button — same width pattern as other rows.
          Empty ControlLabel claims the chevron-gutter space so the right
          column lines up; `<div className="w-full">` wrapper makes the
          button fill the column instead of shrinking to content. */}
      {(availableAtoms.length > 0 || availableRaw.length > 0 || canAddTextShadow || canAddAnimation || canAddTransition) && (
        <div className="flex items-center justify-between w-full">
          <ControlLabel label="" property="" plain />
          <div className="w-full">
          <button onClick={() => {
            const addList = (
              <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto">
                {canAddTransition && (
                  <button
                    onClick={() => {
                      handleChange({
                        ...localRef.current,
                        transition: formatTransitionShorthand([createDefaultTransition()]),
                      });
                      popPanel?.();
                      trace.action('pseudo-editor:add-property', { nodeId, pseudo, property: 'transition' });
                    }}
                    className="w-full h-[var(--control-height)] shrink-0 flex items-center gap-2 px-2 bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] cursor-pointer transition-colors text-xs text-[var(--text-primary)]">
                    {(() => { const I = getPropertyIcon('transition'); return <I width={20} height={20} className="shrink-0" />; })()}
                    Transition
                  </button>
                )}
                {availableRaw.map(({ key, label, defaultValue }) => (
                  <button key={key}
                    onClick={() => {
                      handleChange({ ...localRef.current, [key]: defaultValue });
                      popPanel?.();
                      trace.action('pseudo-editor:add-property', { nodeId, pseudo, property: key });
                    }}
                    className="w-full h-[var(--control-height)] shrink-0 flex items-center gap-2 px-2 bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] cursor-pointer transition-colors text-xs text-[var(--text-primary)]">
                    {(() => { const I = getPropertyIcon(key); return <I width={20} height={20} className="shrink-0" />; })()}
                    {label}
                  </button>
                ))}
                {canAddTextShadow && (
                  <button
                    onClick={() => {
                      handleChange({ ...localRef.current, textShadow: 'none' });
                      popPanel?.();
                      trace.action('pseudo-editor:add-property', { nodeId, pseudo, property: 'textShadow' });
                    }}
                    className="w-full h-[var(--control-height)] shrink-0 flex items-center gap-2 px-2 bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] cursor-pointer transition-colors text-xs text-[var(--text-primary)]">
                    {(() => { const I = getPropertyIcon('textShadow'); return <I width={20} height={20} className="shrink-0" />; })()}
                    Text Shadow
                  </button>
                )}
                {canAddAnimation && (
                  <button
                    onClick={() => {
                      handleChange({ ...localRef.current, animation: 'none' });
                      popPanel?.();
                      trace.action('pseudo-editor:add-property', { nodeId, pseudo, property: 'animation' });
                    }}
                    className="w-full h-[var(--control-height)] shrink-0 flex items-center gap-2 px-2 bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] cursor-pointer transition-colors text-xs text-[var(--text-primary)]">
                    {(() => { const I = getPropertyIcon('animation'); return <I width={20} height={20} className="shrink-0" />; })()}
                    Animation
                  </button>
                )}
                {availableAtoms.map(({ key, label }) => (
                  <button key={key}
                    onClick={() => {
                      const defaults: Record<string, string> = {
                        backgroundColor: 'transparent', opacity: '1', borderRadius: '0',
                        clipPath: 'none', filter: 'none', boxShadow: 'none',
                        border: 'none', maskImage: 'none', transform: 'none',
                      };
                      handleChange({ ...localRef.current, [key]: defaults[key] || '0' });
                      popPanel?.();
                      trace.action('pseudo-editor:add-property', { nodeId, pseudo, property: key });
                    }}
                    className="w-full h-[var(--control-height)] shrink-0 flex items-center gap-2 px-2 bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] cursor-pointer transition-colors text-xs text-[var(--text-primary)]">
                    {(() => { const I = getPropertyIcon(key); return <I width={20} height={20} className="shrink-0" />; })()}
                    {label}
                  </button>
                ))}
              </div>
            );
            if (pushPanel) pushPanel('Add Property', addList);
          }}
            className="w-full h-[var(--control-height)] flex items-center justify-center text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border hover:[--cut-border-color:var(--control-border-hover)] cursor-pointer transition-colors">
            + Add Property
          </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pseudo entry row inside the popup ──────────────────────────────────────

function PseudoEntryRow({ nodeId, pseudo, styles, pushPanel }: {
  nodeId: string; pseudo: PseudoKind; styles: Record<string, string> | undefined;
  pushPanel: (title: string, content: React.ReactNode) => void;
}) {
  const hasStyles = !!styles && Object.keys(styles).length > 0;
  const label = formatPseudoLabel(pseudo);

  const handleAdd = () => {
    const defaults = starterStylesForPseudo(pseudo);
    expediteStableAtomSync();
    queueMutation({ type: 'updatePseudoStyle', nodeId, pseudo, styles: defaults });
    trace.action('pseudo-entry:add', { nodeId, pseudo });
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    expediteStableAtomSync();
    queueMutation({ type: 'removePseudo', nodeId, pseudo });
    removeCanvasCSS(formatCanvasRuleSelector(nodeId, pseudo));
    removeCanvasCSS(formatCanvasPreviewSelector(nodeId));
    trace.action('pseudo-entry:remove', { nodeId, pseudo });
  };

  const openEditor = () => {
    if (hasStyles) {
      pushPanel(label, <PseudoEditor nodeId={nodeId} pseudo={pseudo} styles={styles!} />);
    } else {
      handleAdd();
    }
  };

  return (
    <SingleEntryRow
      label={label} property="" plain
      hasValue={hasStyles}
      onOpen={openEditor}
      EmptyIcon={PseudoIcon}
      renderPreview={() => <span className="truncate flex-1">{buildSummary(styles!)}</span>}
      onRemove={handleRemove}
    />
  );
}

// ─── Main popup content ────────────────────────────────────────────────────

const ALL_BUILTIN_PSEUDO_KINDS: PseudoKind[] = [
  ...BUILTIN_PSEUDO_STATES,
  ...BUILTIN_PSEUDO_ELEMENTS,
];

function PseudoPopupContent({ node }: { node: Pick<CanvasNode, 'id' | 'type' | 'attrs'> }) {
  const pseudoStyles = useAtomValue(pseudoStylesAtom);
  const popupCtx = useToolPopupOptional();
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const nodeId = node.id;
  const nodeStyles = pseudoStyles.get(nodeId) ?? {};

  if (!popupCtx?.pushPanel) return null;

  const activeEntries = (Object.entries(nodeStyles) as Array<[PseudoKind, Record<string, string> | undefined]>)
    .filter(([kind, vals]) => !isFormControlOwnedPseudo(node, kind) && !!vals && Object.keys(vals).length > 0);

  const activeSet = new Set(activeEntries.map(([k]) => k));
  const addableBuiltins = ALL_BUILTIN_PSEUDO_KINDS.filter(
    (k) => !isFormControlOwnedPseudo(node, k) && !activeSet.has(k),
  );

  const handleQuickAdd = (kind: PseudoKind) => {
    const defaults = starterStylesForPseudo(kind);
    expediteStableAtomSync();
    forSelectionTargets(nodeId, (tid) =>
      queueMutation({ type: 'updatePseudoStyle', nodeId: tid, pseudo: kind, styles: defaults })
    );
    trace.action('pseudo-popup:quick-add', { nodeId, pseudo: kind });
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = customInput.trim();
    if (!raw) return;

    const normalized = normalizePseudoKind(raw);
    if (!normalized) {
      setCustomError(
        'Invalid state selector. Use a single-node pseudo or attribute (e.g. :nth-child(odd), [aria-expanded="true"]).'
      );
      return;
    }
    if (isFormControlOwnedPseudo(node, normalized)) {
      setCustomError(`${formatPseudoLabel(normalized)} is managed by the Form State control above.`);
      return;
    }
    setCustomError(null);
    setCustomInput('');
    handleQuickAdd(normalized);
  };

  return (
    <div className="flex flex-col gap-2">
      {activeEntries.map(([kind, styles]) => (
        <PseudoEntryRow
          key={kind}
          nodeId={nodeId}
          pseudo={kind}
          styles={styles}
          pushPanel={popupCtx.pushPanel}
        />
      ))}

      {addableBuiltins.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {addableBuiltins.map((kind) => {
            const label = formatPseudoLabel(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => handleQuickAdd(kind)}
                className="px-2 py-1 text-[11px] bg-[var(--grid-line)] border border-[var(--control-border)] [--cut-border-color:var(--control-border)] hover:border-[var(--control-border-hover)] cut-corners cut-border cursor-pointer text-[var(--text-primary)] transition-colors"
              >
                + {label}
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleCustomSubmit} className="flex flex-col gap-1 pt-1 border-t border-[var(--border-light)]">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={customInput}
            onChange={(e) => {
              setCustomInput(e.target.value);
              if (customError) setCustomError(null);
            }}
            placeholder=':nth-child(odd) or [aria-expanded="true"]'
            className="flex-1 min-w-0 h-[var(--control-height)] px-2 text-xs bg-[var(--grid-line)] border border-[var(--control-border)] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] cut-corners outline-none"
          />
          <button
            type="submit"
            className="h-[var(--control-height)] px-2 text-xs bg-[var(--grid-line)] border border-[var(--control-border)] hover:border-[var(--control-border-hover)] text-[var(--text-primary)] cut-corners cursor-pointer shrink-0"
          >
            Add State
          </button>
        </div>
        {customError && (
          <div role="alert" className="text-[11px] text-red-500 leading-snug">
            {customError}
          </div>
        )}
      </form>

      <p className="text-[10px] leading-snug text-[var(--text-secondary)] pt-1 border-t border-[var(--border-light)]">
        Use States for single-node CSS states. For parent-hover affecting child elements, extract a Design Component with Hover variants.
      </p>
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────────

/** Single "States & Pseudo" row → opens popup with CSS states & ::before / ::after editors. */
export function PseudoElementControl({ openSignal = 0 }: { openSignal?: number } = {}) {
  const { node } = useControl();
  const pseudoStyles = useAtomValue(pseudoStylesAtom);
  const [isOpen, setIsOpen] = useState(openSignal > 0);
  const btnRef = useRef<HTMLSpanElement>(null);
  const prevNodeIdRef = useRef<string | null>(node?.id ?? null);

  useEffect(() => {
    if (openSignal > 0) setIsOpen(true);
  }, [openSignal]);

  useEffect(() => {
    const nextId = node?.id ?? null;
    if (prevNodeIdRef.current !== null && prevNodeIdRef.current !== nextId && !(openSignal > 0)) {
      setIsOpen(false);
    }
    prevNodeIdRef.current = nextId;
  }, [node?.id, openSignal]);

  if (!node) return null;

  const nodeId = node.id;
  const nodeStyles = pseudoStyles.get(nodeId);
  const visibleEntries = nodeStyles
    ? (Object.entries(nodeStyles) as Array<[PseudoKind, Record<string, string> | undefined]>).filter(
        ([kind, vals]) => !isFormControlOwnedPseudo(node, kind) && !!vals && Object.keys(vals).length > 0,
      )
    : [];
  const hasAny = visibleEntries.length > 0;
  const summary = hasAny
    ? visibleEntries.map(([kind]) => formatPseudoLabel(kind)).join(', ')
    : '';

  trace.fn('PseudoElementControl:render', { nodeId, activeCount: visibleEntries.length });

  return (
    <>
      <SingleEntryRow
        label="States" property="" plain
        hasValue={hasAny}
        onOpen={() => setIsOpen(!isOpen)}
        anchorRef={btnRef}
        EmptyIcon={PseudoIcon}
        renderPreview={() => <span className="truncate flex-1">{summary}</span>}
      />

      <ToolPopup isOpen={isOpen} onClose={() => setIsOpen(false)} title="States & Pseudo" anchorRef={btnRef}>
        <PseudoPopupContent node={node} />
      </ToolPopup>
    </>
  );
}
