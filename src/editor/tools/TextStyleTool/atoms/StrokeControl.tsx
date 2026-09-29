// StrokeControl.tsx — Text stroke popup control.
// Button row with preview: color swatch + width + RemoveButton.
// Click opens ToolPopup with: Width slider + Color picker.
// Uses text.get/set('webkitTextStroke') for TipTap-aware property.
//
// A node's stroke is either the legacy `WebkitTextStroke` shorthand ("2px #000")
// or the WIDTH / COLOR longhands — what a typography preset binds
// (`var(--typo-x-stroke-width)` → "0.015em"). The control reads both, resolves a
// preset's var to its value, and writes the longhands (clearing the shorthand,
// which would otherwise fight them by key order).

import { useRef, useState, useCallback, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { ToolSlider, ToolInput, ControlLabel, ColorInput, ControlActionRow, ColorSwatch, RemoveButton } from '../../../controls';
import { TextStrokeIcon } from '@/design-system/PropertyIcons';
import { useTextStyles } from '../../../hooks/useTextStyles';
import { useControl } from '../../../controls/ControlProvider';
import ToolPopup, { useToolPopupOptional } from '../../../ui/ToolPopup';
import { presetTokensAtom } from '@/code/stores/preset-store';
import { resolveTokenValue } from '@/code/project/preset-ops';
import type { PresetToken } from '@/shared/types';
import { trace } from '@/shared/debug-trace';

export type StrokeUnit = 'px' | 'em';

/** Slider range per unit — em is a fraction of the font size (0.015em ≈ 2px at 144px). */
const RANGE: Record<StrokeUnit, { max: number; step: number }> = {
  px: { max: 10, step: 0.5 },
  em: { max: 0.1, step: 0.005 },
};

/** A node's current stroke from its styles (shorthand or longhands, preset vars resolved). */
export function readTextStroke(
  styles: Record<string, string>,
  tokens: PresetToken[],
): { width: number; unit: StrokeUnit; color: string } {
  const resolve = (v: string | undefined) => {
    const s = (v ?? '').trim();
    return /^var\(/.test(s) ? (resolveTokenValue(s, tokens) ?? '') : s;
  };
  let width = resolve(styles.WebkitTextStrokeWidth);
  let color = resolve(styles.WebkitTextStrokeColor);
  const shorthand = resolve(styles.WebkitTextStroke || styles.webkitTextStroke);
  if (!width && shorthand) {
    const m = shorthand.match(/^(-?\d*\.?\d+)(px|em)\s+(.+)$/);
    if (m) { width = `${m[1]}${m[2]}`; color = color || m[3].trim(); }
  }
  const wm = width.match(/^(-?\d*\.?\d+)(px|em)?$/);
  return { width: wm ? parseFloat(wm[1]) : 0, unit: wm?.[2] === 'em' ? 'em' : 'px', color: color || '#000000' };
}

/**
 * Width + Color editor. Keeps its OWN state: inside a parent popup it is pushed as a sliding panel
 * — static content captured at push time — so the slider and swatch must track the drag locally.
 * Re-seeds when the committed value changes (undo, another editor).
 */
function TextStrokePanel({ width, unit, color, onSet, onSetLive }: {
  width: number; unit: StrokeUnit; color: string;
  onSet: (width: number, color: string) => void;
  onSetLive: (width: number, color: string) => void;
}) {
  const [w, setW] = useState(width);
  const [c, setC] = useState(color);
  useEffect(() => { setW(width); setC(color); }, [width, color]);
  const { max, step } = RANGE[unit];
  const set = (nw: number, nc: string) => { setW(nw); setC(nc); onSet(nw, nc); };
  const live = (nw: number, nc: string) => { setW(nw); setC(nc); onSetLive(nw, nc); };
  return (
    // Own gap-2 wrapper: Width + Color rows are otherwise direct children of
    // the popup content (shared gap-3.5) — wrapping tightens ONLY this popup.
    <div className="flex flex-col gap-2" data-text-stroke-panel>
      <div className="flex items-center justify-between">
        <ControlLabel label="Width" property="WebkitTextStroke" plain />
        <div className="flex items-center gap-2 w-full">
          <ToolSlider value={w} min={0} max={max} step={step} onChange={(v) => live(v, c)} onCommit={(v) => set(v, c)} />
          <ToolInput value={String(w)} onChange={(v) => set(parseFloat(v) || 0, c)} onChangeLive={(v) => live(parseFloat(v) || 0, c)} onCommit={(v) => set(parseFloat(v) || 0, c)} step={step} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <ControlLabel label="Color" property="WebkitTextStroke" plain />
        <ColorInput value={c} onChange={(nc) => set(w, nc)} onChangeLive={(nc) => live(w, nc)} />
      </div>
    </div>
  );
}

/**
 * The Stroke row + its Width / Color editor, for any stroke value. `unit` sets the
 * width's unit and slider range (a typography preset's stroke is em — it scales
 * with the font size on every breakpoint). Inside another popup (the preset
 * editor) the editor SLIDES IN as a panel, like Decoration and Shadow — opening a
 * second popup would close the one it lives in (one popup at a time).
 */
export function TextStrokeRow({ width, unit, color, onSet, onSetLive }: {
  width: number;
  unit: StrokeUnit;
  color: string;
  /** Commit (release / typed value). `width` 0 = no stroke. */
  onSet: (width: number, color: string) => void;
  /** Per-frame during a slider / picker drag. */
  onSetLive: (width: number, color: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const popupCtx = useToolPopupOptional();
  const panel = <TextStrokePanel width={width} unit={unit} color={color} onSet={onSet} onSetLive={onSetLive} />;
  const open = () => {
    if (popupCtx) popupCtx.pushPanel('Text Stroke', panel);
    else setIsOpen(true);
  };
  return (
    <>
      <div ref={rowRef} className="flex items-center justify-between w-full">
        <ControlLabel label="Stroke" property="WebkitTextStroke" />
        <ControlActionRow onClick={open}>
          {width > 0 ? (
            <>
              <ColorSwatch style={{ backgroundColor: color }} />
              <span className="text-xs truncate flex-1">
                {width}{unit.toUpperCase()}
              </span>
              <RemoveButton onClick={() => onSet(0, color)} />
            </>
          ) : (
            <>
              <TextStrokeIcon width={20} height={20} bg="var(--control-border)" className="shrink-0 opacity-50" />
              <span className="text-[var(--text-secondary)]">Add</span>
            </>
          )}
        </ControlActionRow>
      </div>
      {!popupCtx && (
        <ToolPopup isOpen={isOpen} onClose={() => setIsOpen(false)} title="Text Stroke" anchorRef={rowRef}>
          {panel}
        </ToolPopup>
      )}
    </>
  );
}

export function StrokeControl() {
  const text = useTextStyles();
  const { styles, updateMultipleStyles, updateStyleLive } = useControl();
  const tokens = useAtomValue(presetTokensAtom);

  // Read from TipTap marks if editing (a mark is always the shorthand).
  const current = text.isEditing
    ? readTextStroke({ WebkitTextStroke: text.get('webkitTextStroke').value }, tokens)
    : readTextStroke(styles, tokens);
  const { width, unit, color } = current;

  const setStroke = useCallback((w: number, c: string) => {
    if (text.isEditing) { text.set('webkitTextStroke', w === 0 ? '' : `${w}${unit} ${c}`); return; }
    updateMultipleStyles({
      WebkitTextStroke: '',
      WebkitTextStrokeWidth: w === 0 ? '' : `${w}${unit}`,
      WebkitTextStrokeColor: w === 0 ? '' : c,
    });
  }, [text, unit, updateMultipleStyles]);

  // Live (per-frame) twin for picker/slider drags — DOM-only patch in node
  // mode (no re-parse), TipTap live in edit mode. Commit lands on release via
  // setStroke.
  const setStrokeLive = useCallback((w: number, c: string) => {
    if (text.isEditing) { text.setLive('webkitTextStroke', w === 0 ? '' : `${w}${unit} ${c}`); return; }
    updateStyleLive('WebkitTextStrokeWidth', w === 0 ? '0px' : `${w}${unit}`);
    updateStyleLive('WebkitTextStrokeColor', c);
  }, [text, unit, updateStyleLive]);

  trace.fn('StrokeControl:render', { width, unit, color, isEditing: text.isEditing });

  return <TextStrokeRow width={width} unit={unit} color={color} onSet={setStroke} onSetLive={setStrokeLive} />;
}
