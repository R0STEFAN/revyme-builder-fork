// LinkPrefetchControl.tsx — "Prefetch" strategy control.
// Auto: standard Next.js behavior.
// Intent: hover (desktop) & touch-down (mobile) intent prefetch.
// Viewport: eager prefetch on scroll into viewport.
// Off: disabled.
// Stored on the node as attribute `data-prefetch="auto" | "intent" | "viewport" | "off"`.

import { ToolSegmentedControl, ControlLabel } from '../../controls';
import { useHoistMenuItem } from '../../controls/hoist-context';
import { trace } from '@/shared/debug-trace';

export type LinkPrefetchMode = 'auto' | 'intent' | 'viewport' | 'off';

interface LinkPrefetchControlProps {
  value: LinkPrefetchMode;
  onChange: (mode: LinkPrefetchMode) => void;
}

export default function LinkPrefetchControl({ value, onChange }: LinkPrefetchControlProps) {
  trace.fn('LinkPrefetchControl:render', { value });
  const hoistItem = useHoistMenuItem();

  return (
    <div className="flex items-center justify-between w-full">
      <ControlLabel label="Prefetch" property="data-prefetch" plain={!hoistItem} />
      <div className="flex items-center gap-2 w-full">
        <ToolSegmentedControl
          value={value || 'auto'}
          onChange={(val) => {
            const mode = val as LinkPrefetchMode;
            trace.action('link-prefetch:change', { mode });
            onChange(mode);
          }}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'intent', label: 'Intent' },
            { value: 'viewport', label: 'View' },
            { value: 'off', label: 'Off' },
          ]}
          size="sm"
        />
      </div>
    </div>
  );
}
