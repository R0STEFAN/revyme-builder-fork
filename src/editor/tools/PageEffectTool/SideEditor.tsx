// SideEditor.tsx — one side (This Page = exit / Next Page = enter) of a Page
// Effect: Opacity, Scale, Rotate (2D/3D), Offset X/Y, Mask, Transition. Reuses
// the AnimationTool SliderRow + the TransitionPanel overlay (user requirement).

import { useState, useRef, useEffect } from 'react';
import { ToolRow, ToolInput, ToolSelect, ToolSegmentedControl } from '../../controls';
import { SliderRow, PanelRow } from '../AnimationTool/shared';
import { useToolPopup } from '../../ui/ToolPopup';
import TransitionPanel from '../AnimationTool/TransitionPanel';
import MaskEditor from './MaskEditor';
import { transitionConfigToRecord, recordToTransitionConfig, pageEffectTransitionSummary } from './transition-adapter';
import type { SideConfig, OffsetUnit, MaskConfig, RotateMode } from '@/code/project/page-effects-config';

const OFFSET_UNIT_OPTIONS: { value: OffsetUnit; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'relative', label: 'Relative' },
];

const DEFAULT_MASK: MaskConfig = { type: 'circle', originX: 50, originXUnit: 'rel', originY: 50, originYUnit: 'rel' };
const COMMIT_DELAY_MS = 250;

export default function SideEditor({ side, onChange }: {
  side: SideConfig;
  onChange: (s: SideConfig) => void;
}) {
  const { pushPanel } = useToolPopup();
  const [draft, setDraft] = useState<SideConfig>(side);
  const latest = useRef<SideConfig>(side);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selfWriteRef = useRef(0);
  const prevSideSigRef = useRef(JSON.stringify(side));

  // External change re-seed (undo/redo while panel is open):
  useEffect(() => {
    const sig = JSON.stringify(side);
    if (sig === prevSideSigRef.current) return;
    prevSideSigRef.current = sig;
    if (selfWriteRef.current > 0) {
      selfWriteRef.current--;
      return;
    }
    setDraft(side);
    latest.current = side;
  }, [side]);

  const flush = () => {
    if (pendingTimer.current !== null) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    selfWriteRef.current++;
    onChangeRef.current(latest.current);
  };

  // Closing the popup mid-drag / popping panel still saves the last value
  useEffect(() => flush, []);

  const set = (patch: Partial<SideConfig>, commitImmediately = false) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    if (commitImmediately) {
      flush();
    } else {
      if (pendingTimer.current !== null) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(flush, COMMIT_DELAY_MS);
    }
  };

  const openTransition = () => pushPanel('Transition', () => (
    <TransitionPanel
      initialTransition={transitionConfigToRecord(latest.current.transition)}
      onWrite={(r) => {
        set({ transition: recordToTransitionConfig(r) }, true);
      }}
      restrictTo={['ease', 'spring']}
    />
  ));
  const openMask = () => pushPanel('Mask', () => (
    <MaskEditor
      mask={latest.current.mask ?? DEFAULT_MASK}
      onChange={(m) => {
        set({ mask: m }, true);
      }}
      onRemove={() => {
        set({ mask: undefined }, true);
      }}
    />
  ));

  return (
    <div className="flex flex-col gap-2 p-1">
      <SliderRow
        label="Opacity"
        value={draft.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => set({ opacity: v })}
        onCommit={(v) => { set({ opacity: v }); flush(); }}
      />
      <SliderRow
        label="Scale"
        value={draft.scale}
        min={0}
        max={4}
        step={0.1}
        onChange={(v) => set({ scale: v })}
        onCommit={(v) => { set({ scale: v }); flush(); }}
      />

      <ToolRow label="Rotate">
        <div className="flex items-center gap-1 w-full">
          <ToolInput
            value={String(draft.rotateZ)}
            onChange={(v) => { set({ rotateZ: parseFloat(v) || 0 }); flush(); }}
          />
          <ToolSegmentedControl
            value={draft.rotate}
            onChange={(v) => { set({ rotate: v as RotateMode }); flush(); }}
            options={[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]}
            size="sm"
          />
        </div>
      </ToolRow>
      {draft.rotate === '3d' && (
        <ToolRow label="">
          <div className="flex items-center gap-1 w-full">
            <ToolInput value={String(draft.rotateX)} onChange={(v) => { set({ rotateX: parseFloat(v) || 0 }); flush(); }} placeholder="X" />
            <ToolInput value={String(draft.rotateY)} onChange={(v) => { set({ rotateY: parseFloat(v) || 0 }); flush(); }} placeholder="Y" />
            <ToolInput value={String(draft.rotateZ)} onChange={(v) => { set({ rotateZ: parseFloat(v) || 0 }); flush(); }} placeholder="Z" />
          </div>
        </ToolRow>
      )}

      <ToolRow label="Offset X">
        <div className="flex items-center gap-1 w-full">
          <ToolInput value={String(draft.offsetX)} onChange={(v) => { set({ offsetX: parseFloat(v) || 0 }); flush(); }} />
          <ToolSelect value={draft.offsetXUnit} onChange={(v) => { set({ offsetXUnit: v as OffsetUnit }); flush(); }} options={OFFSET_UNIT_OPTIONS} />
        </div>
      </ToolRow>
      <ToolRow label="Offset Y">
        <div className="flex items-center gap-1 w-full">
          <ToolInput value={String(draft.offsetY)} onChange={(v) => { set({ offsetY: parseFloat(v) || 0 }); flush(); }} />
          <ToolSelect value={draft.offsetYUnit} onChange={(v) => { set({ offsetYUnit: v as OffsetUnit }); flush(); }} options={OFFSET_UNIT_OPTIONS} />
        </div>
      </ToolRow>

      <PanelRow label="Mask" summary={draft.mask ? draft.mask.type : 'Add…'} onClick={openMask} />
      <PanelRow label="Transition" summary={pageEffectTransitionSummary(draft.transition)} onClick={openTransition} />
    </div>
  );
}
