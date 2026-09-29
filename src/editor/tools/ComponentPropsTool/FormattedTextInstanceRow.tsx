// ComponentPropsTool/FormattedTextInstanceRow.tsx — the instance editor for a
// FORMATTED TEXT variable (@propMeta `formattedText`).
//
// The prop holds sanitized inline HTML the master renders through
// `dangerouslySetInnerHTML={{ __html: prop }}`. The row is an "Edit Content"
// button opening the rich editor popup (FormattedContentButton).

import { ControlLabel } from '../../controls';
import FormattedContentButton from '../../ui/FormattedContentButton';
import { trace } from '@/shared/debug-trace';

export function FormattedTextInstanceRow({
  label, propName, value, defaultValue, overridden, onResetOverride, onChange,
}: {
  label: string;
  propName: string;
  /** Sanitized inline HTML (instance value, else the master default). */
  value: string;
  defaultValue: string | null;
  overridden?: boolean;
  onResetOverride?: () => void;
  onChange: (propName: string, value: string, defaultValue: string | null) => void;
}) {
  trace.fn('FormattedTextInstanceRow:render', { propName, length: value.length });

  return (
    <div className="flex items-center justify-between w-full">
      <ControlLabel label={label} property="" plain={false} hideLocalize overridden={overridden} onResetOverride={onResetOverride} subLabel="Formatted Text" />
      <FormattedContentButton
        title={label}
        value={value}
        testId={propName}
        onCommit={(html) => onChange(propName, html, defaultValue)}
      />
    </div>
  );
}
