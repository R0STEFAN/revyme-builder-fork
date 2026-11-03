import { expect, it, vi } from 'vitest';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as motionRuntime from 'framer-motion';
import { cleanup, render } from '@testing-library/react';
import ts from 'typescript';
import { composeLoopInCode, decomposeLoopInCode, getLoopAnimate, setLoopInCode } from './generator-motion-loop';

it('preserves variant animation bindings while composing a loop', () => {
  const base = `export default function Component(){\n return <motion.div data-id="spinner" variants={spinnerVariants} animate={['default', variant]} initial={['default', initialVariant]} />;\n}`;
  const code = composeLoopInCode(setLoopInCode(base, 'spinner', { props: { rotate: '360' }, transition: { duration: '1', repeat: 'Infinity' }, offscreen: 'play' }), 'spinner');
  expect(code).toContain("animate={['default', variant]}");
});

it('stops imperative loops under reduced motion and preserves their editable specification', () => {
  const base = `import React, { useEffect } from 'react'; import { motion, useMotionValue, animate } from 'framer-motion'; export default function Page(){\n  return <motion.div data-id="spinner" />;\n}`;
  const code = composeLoopInCode(setLoopInCode(base, 'spinner', { props: { rotate: '360' }, transition: { duration: '1', repeat: 'Infinity' }, offscreen: 'play' }), 'spinner');
  const animate = vi.fn(() => ({ stop: vi.fn() }));
  const exports: { default?: React.ComponentType } = {};
  new Function('exports', 'require', ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText)(exports, (name: string) => name === 'react' ? React : name === 'react/jsx-runtime' ? jsxRuntime : { ...motionRuntime, animate });
  const Page = exports.default!;
  try {
    const view = render(<motionRuntime.MotionConfig reducedMotion="always"><Page /></motionRuntime.MotionConfig>);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<motionRuntime.MotionConfig reducedMotion="never"><Page /></motionRuntime.MotionConfig>);
    expect(animate).toHaveBeenCalledTimes(1);
    view.rerender(<motionRuntime.MotionConfig reducedMotion="always"><Page /></motionRuntime.MotionConfig>);
    expect(animate.mock.results[0].value.stop).toHaveBeenCalledTimes(1);
    const restored = decomposeLoopInCode(code, 'spinner');
    expect(getLoopAnimate(restored, 'spinner')?.props).toEqual({ rotate: '360' });
    expect(restored).not.toMatch(/const \w+LoopReducedMotion/);
  } finally { cleanup(); }
});
