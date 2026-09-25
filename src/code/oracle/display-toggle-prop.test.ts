// display-toggle-prop.test.ts — a `display` driven by a component's own
// boolean prop is a per-INSTANCE toggle, not someone hiding with CSS.
//
// This is the builder's own Hide-variable shape: `resolveInstancePropOverrides`
// reads the ternary when it expands a master and picks the branch the
// instance's boolean selected. Framer components lean on it constantly — an
// "Icon Visible" control the nav turns off while the hero keeps its arrow —
// and nothing else can say "this instance, not that one": a variant would
// have to be invented for every combination.

import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn() } }));
import { checkFile } from './check-file';

const COMPONENT = (styleLine: string, params = 'style, initialVariant = \'default\', iconVisible = true') => `'use client';

/** @name "Button" */
/** @propMeta {"iconVisible":{"type":"toggle","label":"Icon Visible"}} */

import React from 'react';
import { motion } from 'framer-motion';

const variantConfig = [{ name: 'default', label: 'Button', x: 0, y: 0, isPrimary: true }];

function Button({ ${params}, ...rest }: any) {
  return (
    <motion.div data-id="button-1" data-name="Button" {...rest} style={{ position: 'relative', display: 'flex' }}>
      <svg data-id="button-3" data-name="Icon" viewBox="0 0 24 24" style={{ ${styleLine} }} />
    </motion.div>
  );
}

export default Button;
`;

const hides = (code: string) =>
  checkFile(code, { kind: 'component' }).filter((x) => x.code === 'DISPLAY_TOGGLE_VISIBILITY');

describe('display driven by a boolean prop', () => {
  it('is accepted', () => {
    expect(hides(COMPONENT("position: 'relative', display: iconVisible ? 'block' : 'none'"))).toEqual([]);
  });

  // The rule it is carved out of must keep biting.
  it('still rejects a plain display:none', () => {
    expect(hides(COMPONENT("position: 'relative', display: 'none'"))).toHaveLength(1);
  });

  it('still rejects a ternary on something that is not a boolean prop', () => {
    expect(hides(COMPONENT("position: 'relative', display: variant === 'x' ? 'block' : 'none'"))).toHaveLength(1);
  });

  // The detector needs a component signature — `style` or `initialVariant`
  // beside the flag — so a helper's local boolean can never pass for one.
  it('still rejects when the identifier is not a prop of this component', () => {
    const code = COMPONENT("position: 'relative', display: somethingElse ? 'block' : 'none'");
    expect(hides(code)).toHaveLength(1);
  });

  it('still rejects a boolean-looking param on a non-component function', () => {
    const code = `'use client';
import React from 'react';
function helper({ iconVisible = true }: any) { return iconVisible; }
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative' }}>
      <div data-id="x" style={{ position: 'relative', display: iconVisible ? 'block' : 'none' }} />
    </div>
  );
}
`;
    expect(hides(code)).toHaveLength(1);
  });
});
