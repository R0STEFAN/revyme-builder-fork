import { describe, it, expect } from 'vitest';
import { extractVariantBorderAfterRuleBody, parseBorderAfterCSS } from '@/editor/ui/border-utils';
import { updateBorderOverlayStyle, removeBorderOverlayStyle, borderOverlaySelector } from '@/code/generation/generator-styles';

// An imported master's border is a LITERAL ::after rule, per variant. The X
// has to remove THAT rule — `varBorderMode` ("is a component file") sent the
// clear down the variable path, which wrote empty --rvb-* that nothing read,
// so the rule survived and the button appeared to ignore the click.
const MASTER = `export default function C({ variant }) {
  return (<div data-id="r1" data-variant={variant}>
      <style>{\`
    [data-id="r1"]::after {
  content: '';
  border-width: 1px;
    }
    ${borderOverlaySelector('r1', 'variant-2')} {
  content: '';
  border-width: 10px;
    }
  \`}</style>
  </div>);
}`;

describe('a literal per-variant overlay border', () => {
  it('is readable as that variant’s own override', () => {
    const body = extractVariantBorderAfterRuleBody(MASTER, 'r1', 'variant-2');
    expect(body, 'the variant rule is not readable').toBeTruthy();
    expect(parseBorderAfterCSS(body!)?.top.width).toBe(10);
    // …and the base is untouched by that read.
    expect(extractVariantBorderAfterRuleBody(MASTER, 'r1', 'default')).toBeNull();
  });

  it('removes only that variant, leaving the base', () => {
    const out = removeBorderOverlayStyle(MASTER, 'r1', 'variant-2');
    expect(extractVariantBorderAfterRuleBody(out, 'r1', 'variant-2')).toBeNull();
    expect(out).toContain('[data-id="r1"]::after {');
    expect(out).toContain('border-width: 1px;');
  });
});
