// wrapped-component-prop-defaults.test.ts — a component's defaults when its
// function is WRAPPED.
//
// `const Foo = React.forwardRef(function Foo({ x = '…' }, ref) {…})` is not a
// FunctionExpression at the top of the declarator — it is a CallExpression
// around one. Read as such, the component's defaults were never collected, so
// a style bound to one of its props kept the raw `var:<prop>` marker:
// unresolved, no `styleVariables`, and no variable pill on the very row that
// is bound. Every icon set is written this way.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn() } }));

import { parseJSXToNodes } from './parser';

const set = (decl: string, close = '});') => `'use client';
import React from 'react';
/** @name "Arrows" */
/** @iconSet */
const iconConfig = [{ name: 'icon-1', label: 'Arrow', x: 0, y: 0, width: 240, height: 240, isPrimary: true }];
${decl}
  const master = (
    <div data-id="root" data-name="Icons" style={{ position: 'relative' }}>
      <div data-id="icon-1" data-name="Arrow" style={{ backgroundColor: '#ffffff' }}>
        <svg data-id="shape-icon-1" data-name="Arrow" viewBox="0 0 24 24" style={{ position: 'absolute', stroke: iconColor }}>
          <path d="M 0 7 L 18 7" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
  if (!name) return master;
  return null;
${close}
`;

const FORWARD_REF = set(
  "const Arrows = React.forwardRef(function Arrows({ name, style, iconColor = 'rgb(1, 2, 3)', ...rest }, ref) {",
);

describe('a style bound to a prop of a wrapped component', () => {
  const svg = (code: string) => parseJSXToNodes(code).get('shape-icon-1') as any;

  it('resolves through React.forwardRef', () => {
    expect(svg(FORWARD_REF).styleVariables?.stroke).toBe('iconColor');
  });

  // …and the row shows the prop's DEFAULT, not the raw marker.
  it('takes the default as the value', () => {
    expect(svg(FORWARD_REF).styles?.stroke).toBe('rgb(1, 2, 3)');
  });

  it('resolves through any single-function wrapper', () => {
    const memo = set("const Arrows = React.memo(function Arrows({ name, style, iconColor = 'rgb(4, 5, 6)' }) {");
    expect(svg(memo).styleVariables?.stroke).toBe('iconColor');
    expect(svg(memo).styles?.stroke).toBe('rgb(4, 5, 6)');
  });

  // The plain shapes must keep working exactly as before.
  it('still resolves an unwrapped component', () => {
    const plain = set("const Arrows = function Arrows({ name, style, iconColor = 'rgb(7, 8, 9)' }) {", '};');
    expect(svg(plain).styleVariables?.stroke).toBe('iconColor');
    expect(svg(plain).styles?.stroke).toBe('rgb(7, 8, 9)');
  });
});
