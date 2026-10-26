import { describe, it, expect } from 'vitest';
import { checkFile } from '../check-file';

function codes(vs: Array<{ code: string }>): string[] {
  return vs.map((v) => v.code);
}

const BASE_HEADER = `'use client';
/** @label "Test Component" */
/** @comment "Test code component." */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "label": { "type": "text", "label": "Label", "default": "Click me" }
} */
import { withResponsiveProps } from '@revyme/runtime';
`;

describe('CODE_COMPONENT_ROOT_MISSING_STYLE — code components must accept and forward style to root', () => {
  it('rejects a code component whose function accepts no parameters', () => {
    const code = `${BASE_HEADER}
function TestButton() {
  return <button style={{ padding: '8px' }}>Test</button>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_ROOT_MISSING_STYLE');
    expect(vs.find((v) => v.code === 'CODE_COMPONENT_ROOT_MISSING_STYLE')?.message).toContain('does not accept');
  });

  it('rejects a code component whose destructured parameters omit style and rest props', () => {
    const code = `${BASE_HEADER}
function TestButton({ label }: { label?: string }) {
  return <button style={{ padding: '8px' }}>{label}</button>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_ROOT_MISSING_STYLE');
    expect(vs.find((v) => v.code === 'CODE_COMPONENT_ROOT_MISSING_STYLE')?.message).toContain('does not accept');
  });

  it('rejects a code component that accepts props but omits style spread on root (the ThemeToggle bug)', () => {
    const code = `${BASE_HEADER}
function TestButton({ label = 'Click', ...props }: any) {
  return (
    <button
      data-id={props['data-id']}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '8px',
      }}
    >
      {label}
    </button>
  );
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_ROOT_MISSING_STYLE');
    expect(vs.find((v) => v.code === 'CODE_COMPONENT_ROOT_MISSING_STYLE')?.message).toContain('does not apply');
  });

  it('rejects a code component returning a JSX fragment as root', () => {
    const code = `${BASE_HEADER}
function TestButton({ ...props }: any) {
  return (
    <>
      <div style={{ ...props.style }}>Part 1</div>
      <div>Part 2</div>
    </>
  );
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_ROOT_MISSING_STYLE');
    expect(vs.find((v) => v.code === 'CODE_COMPONENT_ROOT_MISSING_STYLE')?.message).toContain('JSX Fragment');
  });

  it('rejects a code component where one branch of a conditional return misses style', () => {
    const code = `${BASE_HEADER}
function TestButton({ isSpecial, ...props }: any) {
  if (isSpecial) {
    return <button style={{ color: 'red' }}>Special</button>;
  }
  return <button style={{ color: 'blue', ...props.style }}>Normal</button>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_ROOT_MISSING_STYLE');
  });

  it('rejects when ...props.style is not last in style object (CODE_COMPONENT_STYLE_SPREAD_ORDER)', () => {
    const code = `${BASE_HEADER}
function TestButton({ label, ...props }: any) {
  return (
    <button style={{ ...props.style, display: 'inline-flex', padding: '8px' }}>
      {label}
    </button>
  );
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_STYLE_SPREAD_ORDER');
    expect(codes(vs)).not.toContain('CODE_COMPONENT_ROOT_MISSING_STYLE');
  });

  it('rejects when destructured ...style is not last in style object', () => {
    const code = `${BASE_HEADER}
function TestButton({ style, label }: any) {
  return (
    <button style={{ ...style, display: 'inline-flex' }}>
      {label}
    </button>
  );
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toContain('CODE_COMPONENT_STYLE_SPREAD_ORDER');
  });

  it('accepts a code component spreading ...props.style last on root', () => {
    const code = `${BASE_HEADER}
function TestButton({ label = 'Click', ...props }: any) {
  return (
    <button
      data-id={props['data-id']}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '8px',
        ...props.style,
      }}
    >
      {label}
    </button>
  );
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('accepts a code component destructuring { style, ...props } and spreading ...style last', () => {
    const code = `${BASE_HEADER}
function TestButton({ style, label = 'Click', ...props }: any) {
  return (
    <button
      data-id={props['data-id']}
      style={{
        display: 'inline-flex',
        padding: '8px',
        ...style,
      }}
    >
      {label}
    </button>
  );
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('accepts a code component passing style={style} or style={props.style}', () => {
    const code = `${BASE_HEADER}
function TestButton({ style, ...props }: any) {
  return <button style={style}>Test</button>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('accepts a code component defining wrapperStyle variable that spreads ...props.style', () => {
    const code = `${BASE_HEADER}
function TestButton({ label, ...props }: any) {
  const wrapperStyle = {
    display: 'flex',
    padding: '8px',
    ...props.style,
  };
  return <div style={wrapperStyle}>{label}</div>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('accepts spreading ...wrapperStyle when wrapperStyle spreads ...props.style last', () => {
    const code = `${BASE_HEADER}
function TestButton({ label, ...props }: any) {
  const wrapperStyle = {
    width: '100%',
    ...props.style,
  };
  return <div style={{ ...wrapperStyle, display: 'flex' }}>{label}</div>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('accepts spreading {...props} on root without conflicting style override', () => {
    const code = `${BASE_HEADER}
function TestButton({ label, ...props }: any) {
  return <button {...props}>{label}</button>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('accepts early return null guard without false positive', () => {
    const code = `${BASE_HEADER}
import { useState, useEffect } from 'react';
function TestButton({ label, ...props }: any) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <button style={{ padding: '8px', ...props.style }}>{label}</button>;
}
export default withResponsiveProps(TestButton);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });

  it('does not demand style spread on internal helper components or sub-elements in the file', () => {
    const code = `${BASE_HEADER}
function HelperIcon() {
  return <svg width="24" height="24"><circle cx="12" cy="12" r="5" /></svg>;
}

function MainWidget({ label, ...props }: any) {
  return (
    <div style={{ display: 'flex', ...props.style }}>
      <HelperIcon />
      <span>{label}</span>
    </div>
  );
}
export default withResponsiveProps(MainWidget);
`;
    const vs = checkFile(code, { kind: 'code-component' });
    expect(codes(vs)).toEqual([]);
  });
});
