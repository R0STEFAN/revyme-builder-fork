// ComponentPropsPanel.tsx — Controls sidebar for Component Editor.
// Uses the EXACT same control components as ComponentPropsTool.
// Rendered as a right sidebar column in the editor layout.

import type { ComponentControlDef } from '@/code/components/controls-parser';
import { findControlDef } from '@/code/components/controls-parser';
import { ToolRow, ToolInput, ToolSlider, ToolSelect, ToolSegmentedControl } from '../controls';
import ColorInput from '../controls/ColorInput';
import UploadControl from '../controls/UploadControl';
import GroupControl from '../tools/GroupControl';
import TransitionControl from '../tools/TransitionControl';
import ObjectListControl from '../tools/ObjectListControl';
import ImageListControl from '../tools/ImageListControl';
import { FontFamilyControl } from '../tools/TextStyleTool/atoms/FontFamilyControl';
import { trace } from '@/shared/debug-trace';

const YES_NO_OPTIONS = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
];

function parseFiniteNumber(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

interface ComponentPropsPanelProps {
  controls: Record<string, ComponentControlDef>;
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}

export default function ComponentPropsPanel({ controls, values, onChange }: ComponentPropsPanelProps) {
  const entries = Object.entries(controls);

  trace.fn('ComponentPropsPanel.render', { controlCount: entries.length });

  // Recursive — a `group` control renders its nested controls through this
  // same function inside the group popup (mirrors ComponentPropsTool). The
  // editor sidebar used to know only the flat types, so a @shaderDoc
  // component's grouped settings (Liquid metal · 10 settings …) rendered as
  // nothing while the Properties panel showed them (user report 2026-09-06).
  const renderControl = (propName: string, controlDef: ComponentControlDef): React.ReactNode => {
    const rawValue = values[propName] !== undefined ? values[propName] : controlDef.default;
    const hasRange = controlDef.min != null && controlDef.max != null && !controlDef.displayStepper;

    switch (controlDef.type) {
      case 'slider': {
        const defaultNum = typeof controlDef.default === 'number' ? controlDef.default : 0;
        const numValue = parseFiniteNumber(rawValue, defaultNum);
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <ToolSlider
              value={numValue}
              onChange={(v) => onChange(propName, v)}
              min={controlDef.min ?? 0}
              max={controlDef.max ?? 100}
              step={controlDef.step ?? 1}
            />
            <ToolInput
              value={String(numValue)}
              onChange={(v) => {
                const n = parseFloat(v);
                onChange(propName, Number.isFinite(n) ? n : 0);
              }}
              step={controlDef.step ?? 1}
            />
          </ToolRow>
        );
      }
      case 'number': {
        const defaultNum = typeof controlDef.default === 'number' ? controlDef.default : 0;
        const numValue = parseFiniteNumber(rawValue, defaultNum);
        return (
          <ToolRow key={propName} label={controlDef.label}>
            {hasRange && (
              <ToolSlider
                value={numValue}
                onChange={(v) => onChange(propName, v)}
                min={controlDef.min ?? 0}
                max={controlDef.max ?? 100}
                step={controlDef.step ?? 1}
              />
            )}
            <ToolInput
              value={String(numValue)}
              onChange={(v) => {
                const n = parseFloat(v);
                onChange(propName, Number.isFinite(n) ? n : 0);
              }}
              step={controlDef.step ?? 1}
            />
          </ToolRow>
        );
      }
      case 'color':
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <ColorInput
              value={String(rawValue ?? '')}
              onChange={(v) => onChange(propName, v)}
            />
          </ToolRow>
        );
      case 'text':
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <ToolInput
              value={String(rawValue ?? '')}
              onChange={(v) => onChange(propName, v)}
              text
            />
          </ToolRow>
        );
      case 'toggle': {
        const isTrue = rawValue === true || rawValue === 'true';
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <ToolSegmentedControl
              value={isTrue ? 'yes' : 'no'}
              onChange={(v) => onChange(propName, v === 'yes')}
              options={YES_NO_OPTIONS}
            />
          </ToolRow>
        );
      }
      case 'select':
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <ToolSelect
              value={String(rawValue ?? '')}
              onChange={(v) => onChange(propName, v)}
              options={(controlDef.options || []).map(o => ({ label: o.label, value: o.value }))}
            />
          </ToolRow>
        );
      case 'objectList': {
        let list: Record<string, unknown>[] = [];
        if (Array.isArray(rawValue)) {
          list = rawValue as Record<string, unknown>[];
        } else if (typeof rawValue === 'string') {
          try {
            const parsed = JSON.parse(rawValue);
            if (Array.isArray(parsed)) list = parsed;
          } catch {
            list = [];
          }
        } else if (Array.isArray(controlDef.default)) {
          list = controlDef.default as Record<string, unknown>[];
        }

        return (
          <ObjectListControl
            key={propName}
            label={controlDef.label}
            controlDef={controlDef}
            value={list}
            onChange={(next) => onChange(propName, next)}
          />
        );
      }
      case 'imageList': {
        const imageListValue = Array.isArray(rawValue)
          ? rawValue.join('|')
          : String(rawValue ?? '');
        return (
          <ImageListControl
            key={propName}
            label={controlDef.label}
            value={imageListValue}
            onChange={(v) => onChange(propName, v)}
            uploadSource={controlDef.uploadSource || 'uploaded'}
          />
        );
      }
      case 'font':
        return (
          <FontFamilyControl
            key={propName}
            label={controlDef.label}
            value={String(rawValue ?? '')}
            onChange={(v) => onChange(propName, v)}
          />
        );
      case 'upload':
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <UploadControl
              value={String(rawValue ?? '')}
              onChange={(v) => onChange(propName, v)}
              accept={controlDef.accept || 'image/*'}
              multiple={controlDef.multiple}
              uploadSource={controlDef.uploadSource || 'uploaded'}
              onBatchComplete={controlDef.multiple ? (count) => {
                if (findControlDef(controls, 'totalFrames')) {
                  onChange('totalFrames', count);
                }
              } : undefined}
            />
          </ToolRow>
        );
      case 'slot':
        return (
          <ToolRow key={propName} label={controlDef.label}>
            <div className="text-[11px] text-[var(--text-disabled)] italic py-1">
              Slots can only be connected on canvas
            </div>
          </ToolRow>
        );
      case 'group':
        return (
          <GroupControl
            key={propName}
            label={controlDef.label}
            controls={controlDef.controls ?? {}}
            renderControl={renderControl}
          />
        );
      case 'transition': {
        const transitionStr = typeof rawValue === 'object' && rawValue !== null
          ? JSON.stringify(rawValue)
          : String(rawValue ?? '');
        return (
          <TransitionControl
            key={propName}
            label={controlDef.label}
            value={transitionStr}
            onChange={(v) => onChange(propName, v)}
          />
        );
      }
      default:
        trace.action('ComponentPropsPanel:unrendered-control', { propName, type: controlDef.type });
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center h-9 border-b border-[var(--border-light)] px-3">
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Controls</span>
      </div>

      {/* Controls list */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 py-2">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--text-disabled)]">
            No @controls defined
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {entries.map(([propName, controlDef]) => renderControl(propName, controlDef))}
          </div>
        )}
      </div>
    </div>
  );
}
