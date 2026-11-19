// surface-dialect.test.ts — the editable-surface fence.
//
// Every REJECTS fixture here passed the gate with zero violations before these
// rules existed (verified probe, 2026-08-11) while being permanently
// uneditable in the builder.

import { describe, it, expect } from 'vitest';
import { checkFile } from './check-file';

const codesOf = (code: string, kind: 'page' | 'component' = 'page') =>
  checkFile(code, { kind }).map((x) => x.code);

const page = (body: string, head = '') => `'use client';
import React, { useState } from 'react';
import { motion } from 'framer-motion';
${head}
export default function Page() {
  return (
    <div data-id="root" data-name="Root" style={{ position: 'relative', width: '100%' }}>
${body}
    </div>
  );
}
`;

describe('STYLE_PROP_NO_CONTROL', () => {
  it('rejects the touchAction / scroll-snap carousel cluster', () => {
    const code = page(`      <div data-id="rail" style={{ position: 'relative', width: '100%', height: 'auto', display: 'flex', touchAction: 'pan-y', scrollSnapType: 'x mandatory', overscrollBehavior: 'contain' }}>x</div>`);
    const codes = codesOf(code);
    expect(codes).toContain('STYLE_PROP_NO_CONTROL');
  });

  it('rejects CSS custom properties', () => {
    expect(codesOf(page(`      <div data-id="b" style={{ position: 'relative', width: '100%', height: 'auto', '--brand': '#f00' }}>x</div>`)))
      .toContain('STYLE_PROP_NO_CONTROL');
  });

  it("allows overflow: 'auto' alongside visible/hidden/scroll/clip", () => {
    const code = page(`      <div data-id="s" style={{ position: 'relative', width: '100%', height: '300px', overflow: 'auto' }}>x</div>`);
    expect(codesOf(code)).not.toContain('STYLE_PROP_NO_CONTROL');
  });

  it('rejects bare transform channels on PLAIN tags, allows them on motion.*', () => {
    const plain = page(`      <div data-id="p" style={{ position: 'relative', width: '10px', height: '10px', rotate: '45deg' }}>x</div>`);
    expect(codesOf(plain)).toContain('STYLE_PROP_NO_CONTROL');
    const motionEl = page(`      <motion.div data-id="m" style={{ position: 'relative', width: '10px', height: '10px', rotate: 45 }}>x</motion.div>`);
    expect(codesOf(motionEl)).not.toContain('STYLE_PROP_NO_CONTROL');
  });

  it('rejects the independent CSS translate property everywhere', () => {
    const code = page(`      <motion.div data-id="t" style={{ position: 'relative', width: '10px', height: '10px', translate: '0 20px' }}>x</motion.div>`);
    expect(codesOf(code)).toContain('STYLE_PROP_NO_CONTROL');
  });

  it('accepts transformBox (rotation carrier) and boxSizing (search-field gen)', () => {
    const code = page(`      <motion.div data-id="rot" style={{ position: 'relative', width: '80px', height: '8px', rotate: 40, transformBox: 'fill-box', transformOrigin: '50% 50%', boxSizing: 'border-box' }}>x</motion.div>`);
    expect(codesOf(code)).not.toContain('STYLE_PROP_NO_CONTROL');
  });
});

describe('TEXT_STYLE_ON_FRAME', () => {
  it('rejects typography on a wrapper div (inheritance pattern)', () => {
    const code = page(`      <div data-id="wrap" style={{ position: 'relative', width: '100%', height: 'auto', fontFamily: 'Manrope, sans-serif', fontSize: '18px', color: '#B5B2B1', whiteSpace: 'nowrap' }}>
        <p data-id="txt" style={{ position: 'relative', width: '100%', height: 'auto', margin: '0px' }}>Inherited</p>
      </div>`);
    expect(codesOf(code)).toContain('TEXT_STYLE_ON_FRAME');
  });

  it('allows typography on a form control (its value and placeholder ARE its text)', () => {
    const code = page(`      <form data-id="f" data-form='{"sendTo":[]}' onSubmit={() => {}} style={{ position: 'relative', width: '100%', height: 'auto' }}>
        <input data-id="in" data-name="Name" type="text" name="name" placeholder="Name" style={{ position: 'relative', width: '100%', fontFamily: 'Inter', fontSize: '16px', color: '#303030', whiteSpace: 'nowrap' }} />
        <textarea data-id="ta" data-name="Message" name="message" style={{ position: 'relative', width: '100%', fontSize: '16px', color: '#303030', resize: 'vertical' }}></textarea>
        <select data-id="sel" data-name="Topic" name="topic" style={{ position: 'relative', width: '100%', fontSize: '16px', color: '#303030' }}>
          <option data-id="o1" value="a" style={{}}>A</option>
        </select>
      </form>`);
    expect(codesOf(code)).not.toContain('TEXT_STYLE_ON_FRAME');
  });

  it('allows the button-as-div pattern (element carries its OWN text)', () => {
    const code = page(`      <div data-id="btn" style={{ position: 'relative', width: '160px', height: '44px', color: '#fff', fontSize: '14px', fontWeight: '500' }}>Request access</div>`);
    expect(codesOf(code)).not.toContain('TEXT_STYLE_ON_FRAME');
  });

  it('leaves text tags and svg alone', () => {
    const code = page(`      <p data-id="t" style={{ position: 'relative', width: '100%', height: 'auto', color: '#fff', fontSize: '16px' }}>Hi</p>
      <svg data-id="i" viewBox="0 0 10 10" style={{ width: '10px', height: '10px', stroke: '#fff' }}></svg>`);
    expect(codesOf(code)).not.toContain('TEXT_STYLE_ON_FRAME');
  });
});

describe('ELEMENT_UNSUPPORTED_TAG', () => {
  it('allows ul/ol/li lists natively and supports listStyleType', () => {
    const code = page(`      <ul data-id="l" style={{ position: 'relative', width: '100%', height: 'auto', listStyleType: 'disc' }}>
        <li data-id="i1" style={{ position: 'relative', width: '100%', height: 'auto' }}>One</li>
      </ul>`);
    expect(codesOf(code)).not.toContain('ELEMENT_UNSUPPORTED_TAG');
    expect(codesOf(code)).not.toContain('STYLE_PROP_NO_CONTROL');
  });

  it('rejects table / details / iframe with per-tag redirects', () => {
    const code = page(`      <table data-id="t" style={{ position: 'relative', width: '100%', height: 'auto' }}><tbody data-id="b" style={{ width: '100%', height: 'auto' }}><tr data-id="r" style={{ width: '100%', height: 'auto' }}><td data-id="c" style={{ width: '50%', height: 'auto' }}>x</td></tr></tbody></table>
      <details data-id="d" style={{ position: 'relative', width: '100%', height: 'auto' }}><summary data-id="s" style={{ width: '100%', height: 'auto' }}>Q</summary></details>
      <iframe data-id="f" src="https://example.com" style={{ position: 'relative', width: '100%', height: '300px' }} />`);
    const msgs = checkFile(code, { kind: 'page' }).filter((v) => v.code === 'ELEMENT_UNSUPPORTED_TAG').map((v) => v.message).join('\n');
    expect(msgs).toContain('GRID');
    expect(msgs).toContain('VARIANTS');
    expect(msgs).toContain('CODE COMPONENT');
  });

  it('rejects unsupported input types, keeps the supported list', () => {
    const bad = page(`      <input data-id="c" type="color" name="ok" style={{ position: 'relative', width: '20px', height: '20px' }} />`);
    expect(codesOf(bad)).toContain('ELEMENT_UNSUPPORTED_TAG');
    // Checkbox and radio are native form fields (the form's "+", the Input
    // tool's Checked row, the Styles tool's Checked / Focus states).
    for (const type of ['checkbox', 'radio']) {
      const native = page(`      <input data-id="b" type="${type}" name="ok" style={{ position: 'relative', appearance: 'none', width: '16px', height: '16px' }} />`);
      expect(codesOf(native)).not.toContain('ELEMENT_UNSUPPORTED_TAG');
      expect(codesOf(native)).not.toContain('STYLE_PROP_NO_CONTROL');
    }
    const good = page(`      <input data-id="e" type="email" name="email" style={{ position: 'relative', width: '100%', height: '44px' }} />`);
    expect(codesOf(good)).not.toContain('ELEMENT_UNSUPPORTED_TAG');
  });
});

describe('LOOP_MISSING_CARRIER', () => {
  it('rejects animate+repeat without data-loop on a viewport element', () => {
    const code = page(`      <motion.div data-id="marq" animate={{ x: '-50%' }} transition={{ repeat: Infinity, duration: 12, ease: 'linear' }} style={{ position: 'relative', width: '200%', height: '60px' }}>logos</motion.div>`);
    expect(codesOf(code)).toContain('LOOP_MISSING_CARRIER');
  });

  it('accepts the carrier form and the parked canvas-node form', () => {
    const withCarrier = page(`      <motion.div data-id="orb" data-loop='{"props":{"rotate":"360"},"transition":{"repeat":"Infinity","duration":"8"}}' animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 8 }} style={{ position: 'relative', width: '40px', height: '40px' }} />`);
    expect(codesOf(withCarrier)).not.toContain('LOOP_MISSING_CARRIER');
    const parked = `'use client';
import React from 'react';
import { motion } from 'framer-motion';

export default function Page() {
  return <div data-id="root" style={{ position: 'relative', width: '100%' }} />;
}
const canvasNodes = (
  <>
    <motion.div data-id="cn-orb" data-canvas-node="true" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 8 }} style={{ position: 'absolute', width: '40px', height: '40px', left: '0px', top: '0px' }} />
  </>
);
`;
    expect(codesOf(parked)).not.toContain('LOOP_MISSING_CARRIER');
  });
});

describe('RAW_STYLE_TAG on pages', () => {
  it('rejects @keyframes and bare selectors in the page style block', () => {
    const code = page(`      <div data-id="glow" style={{ position: 'relative', width: '100%', height: 'auto' }}>x</div>
      <style>{\`
        [data-id="glow"] { box-shadow: 0 0 40px rgba(255,69,36,.6); }
        @keyframes pulse { 0% { opacity: .4; } 100% { opacity: 1; } }
      \`}</style>`);
    expect(codesOf(code)).toContain('RAW_STYLE_TAG');
  });

  it('accepts the canonical page block: :lang rules + banded [data-id] rules', () => {
    const code = page(`      <p data-id="t" style={{ position: 'relative', width: '100%', height: 'auto' }}>Hi</p>
      <style>{\`
    :lang(fr) [data-id="t"] { font-size: 28px !important; }
    @media (max-width: 768px) and (min-width: 375.02px) {
      [data-id="t"] { font-size: 32px !important; }
      :lang(fr) [data-id="t"] { font-size: 24px !important; }
    }
    @media (max-width: 375px) {
      [data-id="t"] { font-size: 24px !important; }
    }
      \`}</style>`);
    expect(codesOf(code)).not.toContain('RAW_STYLE_TAG');
  });
});

describe('PAGE_EXTRA_EXPORT', () => {
  it('rejects the refused-API-route workaround export', () => {
    const code = page(`      <p data-id="t" style={{ position: 'relative', width: '100%', height: 'auto' }}>Hi</p>`,
      `export async function submitLead(data) { const r = await fetch('https://api.example.com', { method: 'POST' }); return r.json(); }\n`);
    const hit = checkFile(code, { kind: 'page' }).find((v) => v.code === 'PAGE_EXTRA_EXPORT')!;
    expect(hit.message).toContain('CODE COMPONENT');
  });

  it('a page exporting only its default component passes', () => {
    expect(codesOf(page(`      <p data-id="t" style={{ position: 'relative', width: '100%', height: 'auto' }}>Hi</p>`)))
      .not.toContain('PAGE_EXTRA_EXPORT');
  });
});

describe('surface — a 3D flip card is a controlled surface', () => {
  it('backfaceVisibility and perspective are not dead-end styles', () => {
    const code = `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative' }}>
      <div data-id="flip" data-name="Flip" style={{ position: 'relative', transformStyle: 'preserve-3d', perspective: '1200px' }}>
        <div data-id="front" data-name="Front" style={{ position: 'absolute', backfaceVisibility: 'hidden' }}></div>
      </div>
    </div>
  );
}
`;
    const codes = checkFile(code, { kind: 'page' }).map((x) => x.code);
    expect(codes).not.toContain('STYLE_PROP_NO_CONTROL');
  });

  it('mixBlendMode is a controlled style: the Styles panel has a Blend Mode row', () => {
    const code = `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative' }}>
      <div data-id="grain" data-name="Grain" style={{ position: 'absolute', mixBlendMode: 'multiply', opacity: '0.2' }}></div>
    </div>
  );
}
`;
    const codes = checkFile(code, { kind: 'page' }).map((x) => x.code);
    expect(codes).not.toContain('STYLE_PROP_NO_CONTROL');
  });
});
