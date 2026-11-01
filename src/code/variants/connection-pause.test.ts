import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import ts from 'typescript';
import { parseJSX } from '../parsing/ast-utils';
import { generateConnectionCode, parseConnections, rebuildConnections, serializeConnections, type Connection } from './connection-config';

const source = `"use client";
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';
function Test({initialVariant='default',style}:{initialVariant?:string;style?:React.CSSProperties}){
return <motion.div data-id="root" data-variant={initialVariant} style={{...style}} />;
}
export default withResponsiveProps(Test);`;
function loadGenerated(code: string): React.ComponentType {
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: { default?: React.ComponentType } = {};
  const motion = { div: (props: Record<string, unknown>) => {
    const { onViewportEnter, onViewportLeave, animate: _animate, initial: _initial, variants: _variants, ...rest } = props;
    return React.createElement('div', { ...rest, onMouseEnter: onViewportEnter, onMouseLeave: onViewportLeave });
  } };
  new Function('require', 'exports', 'React', output)((name: string) => name === 'react' ? React : name === 'framer-motion' ? { motion } : { withResponsiveProps: (value: unknown) => value }, exports, React);
  return exports.default!;
}
describe('viewport-paused delayed native connections', () => {
  it('round trips the pause flag and gates the timer on viewport visibility', () => {
    const connections: Connection[] = [{ from: 'default', to: 'open', trigger: 'afterDelay', delay: 0.3, pauseOffscreen: true }];
    expect(parseConnections(serializeConnections(connections))).toEqual(connections);
    const code = generateConnectionCode(source, connections);
    expect(code).toContain('next.pauseOffscreen && !isInView');
    expect(code).toContain('onViewportEnter={() => setIsInView(true)}');
    expect(code).toContain('onViewportLeave={() => setIsInView(false)}');
    expect(code).toContain('[variant, isInView]');
    expect(code.indexOf('const [isInView')).toBeLessThan(code.indexOf('const __afterDelayChain'));
    expect(parseJSX(code)).not.toBeNull();
  });
  it('regenerates the visibility gate once and preserves normal timers', () => {
    const connections: Connection[] = [{ from: 'default', to: 'open', trigger: 'afterDelay', delay: 0.3, pauseOffscreen: true }];
    const twice = generateConnectionCode(generateConnectionCode(source, connections), connections);
    expect(twice.match(/const \[isInView/g)).toHaveLength(1);
    expect(twice.match(/const __afterDelayChain/g)).toHaveLength(1);
    const ordinary = generateConnectionCode(twice, [{ from: 'default', to: 'open', trigger: 'afterDelay' }]);
    expect(ordinary).not.toContain('isInView');
    expect(ordinary).toContain('setTimeout');
    expect(parseJSX(ordinary)).not.toBeNull();
  });
  it('keeps the remaining delay while offscreen and clears the timer on unmount', () => {
    vi.useFakeTimers();
    const code = generateConnectionCode(source, [{ from: 'default', to: 'open', trigger: 'afterDelay', delay: 0.3, pauseOffscreen: true }]);
    const mounted = render(React.createElement(loadGenerated(code)));
    try {
      const root = mounted.container.firstElementChild!;
      act(() => vi.advanceTimersByTime(1000));
      expect(root.getAttribute('data-variant')).toBe('default');
      fireEvent.mouseEnter(root);
      act(() => vi.advanceTimersByTime(200));
      fireEvent.mouseLeave(root);
      act(() => vi.advanceTimersByTime(1000));
      expect(root.getAttribute('data-variant')).toBe('default');
      fireEvent.mouseEnter(root);
      act(() => vi.advanceTimersByTime(99));
      expect(root.getAttribute('data-variant')).toBe('default');
      act(() => vi.advanceTimersByTime(1));
      expect(root.getAttribute('data-variant')).toBe('open');
    } finally {
      mounted.unmount();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });
  it('removes the delayed lifecycle when the last connection is deleted', () => {
    const generated = generateConnectionCode(source, [{ from: 'default', to: 'open', trigger: 'afterDelay', pauseOffscreen: true }]);
    const cleared = rebuildConnections(generated, []);
    expect(cleared).not.toContain('__afterDelayClock');
    expect(cleared).not.toContain('setIsInView');
    const mounted = render(React.createElement(loadGenerated(cleared)));
    expect(mounted.container.firstElementChild?.getAttribute('data-variant')).toBe('default');
    mounted.unmount();
  });
});
