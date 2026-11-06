import { expect, it } from 'vitest';
import { assertLoopOutsideSourceList, sourceRotationLoop, sourceTransitionSpec, sourceMountEffects, sourceGlobalPageEffect, sourceFlowEffect, sourceHoverEffect, sourceTapEffect, sourceScrollSpeed } from './effects';
import { buildSourceGraph } from './source-graph';
import type { NativeTransfer } from './types';

it('maps enabled Flow effects to native Glide timing and rejects unknown active settings', () => {
  const source = { flowEffectEnabled: true, flowEffectTransition: { type: 'spring', durationBasedSpring: false, damping: 60, stiffness: 500, mass: 1 } };
  expect(sourceFlowEffect(source)).toEqual({ transition: { type: 'spring', damping: '60', stiffness: '500', mass: '1' } });
  expect(sourceFlowEffect({ ...source, flowEffectEnabled: false, flowEffectOther: true })).toBeUndefined();
  expect(() => sourceFlowEffect({ flowEffectEnabled: true })).toThrow(/transition/i);
  expect(() => sourceFlowEffect({ ...source, flowEffectOther: true })).toThrow(/unsupported/i);
});

it('reads separate on-mount entry and exit settings and supports inView trigger', () => {
  const p = { styleAppearEffectEnabled: true, styleAppearEffectTrigger: 'onMount', styleAppearEffectLocked: false, styleAppearEffectScale: 0.5, enterEffectEnabled: true, enterEffectOpacity: 0, enterEffectY: 200, enterEffectScale: 1, enterEffectTransition: { type: 'tween', duration: 1.5, delay: 0.1, ease: [0.6, 0.2, 0, 1], stagger: 0.05 }, exitEffectEnabled: true, exitEffectOpacity: 0, exitEffectY: 200, exitEffectTransition: { type: 'tween', duration: 0.8, delay: 0.3 } };
  expect(sourceMountEffects(p)).toMatchObject({ trigger: 'onMount', initial: { opacity: '0', y: '200', scale: '1' }, animate: { opacity: '1', y: '0', scale: '1' }, exit: { opacity: '0', y: '200' }, enterTransition: { duration: '1.5', delay: '0.1' }, exitTransition: { duration: '0.8', delay: '0.3' } });
  expect(sourceMountEffects({ styleAppearEffectEnabled: true, styleAppearEffectTrigger: 'onMount', styleAppearEffectLocked: true, enterEffectEnabled: true, enterEffectOpacity: 0, enterEffectY: 90, enterEffectTransition: { type: 'tween', duration: 1.4, ease: [0.16, 1, 0.3, 1] }, exitEffectEnabled: true })).toMatchObject({ trigger: 'onMount', initial: { opacity: '0', y: '90' }, exit: { opacity: '0', y: '90' }, enterTransition: { duration: '1.4' }, exitTransition: { duration: '1.4' } });
  expect(sourceMountEffects({ ...p, styleAppearEffectTrigger: 'inView' })).toMatchObject({ trigger: 'inView', initial: { opacity: '0', y: '200' }, animate: { opacity: '1', y: '0' } });
  expect(sourceMountEffects({ ...p, styleAppearEffectTrigger: 'onInView' })).toMatchObject({ trigger: 'inView' });
  expect(() => sourceMountEffects({ ...p, styleAppearEffectTrigger: 'unsupported' })).toThrow(/lifecycle adapter/);
  expect(() => sourceMountEffects({ ...p, styleAppearEffectLocked: true })).toThrow(/lifecycle adapter/);
  expect(sourceMountEffects({ ...p, styleAppearEffectEnabled: false })).toBeUndefined();
  expect(() => sourceMountEffects({ ...p, enterEffectY: NaN })).toThrow();
});

it('refuses a shared animation hook inside a repeated list', () => {
  const list = { id: 'list', __class: 'FrameNode', dataIdentifier: 'local-module:collection/items:default', children: [{ id: 'spinner', __class: 'FrameNode', parentid: 'list', children: [] }] };
  const items = { id: 'items', __class: 'CollectionNode', children: [] };
  const input: NativeTransfer = { format: 'revyme.framer.native', version: 1, context: { projectId: 'x', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'list', mode: 'selection' }, complete: true, diagnostics: [], rootIds: ['list'], definitions: [list, items].map(data => ({ id: data.id, kind: data.__class, data })), assets: [] };
  expect(() => assertLoopOutsideSourceList(buildSourceGraph(input), 'spinner')).toThrow(/per-item adapter/);
});

it('supports rotation, pulse scale, float y, mirror repeat, and rejects malformed loop settings', () => {
  const base = { loopEffectEnabled: true, loopEffectRotate: 360, loopEffectRepeatType: 'loop', loopEffectTransition: { type: 'tween', duration: 1, delay: 0, ease: [0, 0, 1, 1] } };
  expect(sourceRotationLoop(base)?.transition).toMatchObject({ duration: '1', repeat: 'Infinity', ease: 'linear' });
  expect(sourceRotationLoop({ ...base, loopEffectX: 10 })?.props).toEqual({ rotate: '360', x: '10' });
  expect(sourceRotationLoop({ ...base, loopEffectPauseOffscreen: false })?.offscreen).toBe('play');
  expect(sourceRotationLoop({ ...base, loopEffectOpacity: 1, loopEffectX: 0, loopEffectY: 0, loopEffectScale: 1, loopEffectRotate3d: false, loopEffectRotateX: 0, loopEffectRotateY: 0, loopEffectSkewX: 0, loopEffectSkewY: 0, loopEffectRepeatDelay: 0, loopEffectTransition: { ...base.loopEffectTransition, damping: 60, mass: 1, stiffness: 500 } })).toEqual(sourceRotationLoop(base));

  // Scale pulse loop with mirror repeat
  const pulse = { loopEffectEnabled: true, loopEffectScale: 1.1, loopEffectRepeatType: 'mirror', loopEffectTransition: { type: 'tween', duration: 0.8, ease: 'easeInOut' } };
  expect(sourceRotationLoop(pulse)).toMatchObject({ props: { scale: '1.1' }, transition: { repeat: 'Infinity', repeatType: 'mirror', duration: '0.8', ease: 'easeInOut' } });

  // Float Y loop
  const float = { loopEffectEnabled: true, loopEffectY: -20, loopEffectRepeatType: 'mirror', loopEffectRepeatDelay: 0.2, loopEffectTransition: { type: 'tween', duration: 1.5 } };
  expect(sourceRotationLoop(float)).toMatchObject({ props: { y: '-20' }, transition: { repeat: 'Infinity', repeatType: 'mirror', repeatDelay: '0.2', duration: '1.5' } });

  // Rejections
  expect(sourceRotationLoop({ ...base, loopEffectScale: NaN })).toBeUndefined();
  expect(sourceRotationLoop({ ...base, rotation: 45 })).toBeUndefined();
  expect(sourceRotationLoop({ ...base, loopEffectRepeatType: 'invalid' })).toBeUndefined();
  expect(sourceRotationLoop({ ...base, loopEffectRotateX: 45, loopEffectRotate3d: false })).toBeUndefined();
});

it('maps standalone hover and pressed gesture effects', () => {
  const hoverSource = { hoverEffectEnabled: true, hoverEffectScale: 1.05, hoverEffectOpacity: 0.9, hoverEffectTransition: { type: 'tween', duration: 0.3 } };
  expect(sourceHoverEffect(hoverSource)).toEqual({ props: { scale: '1.05', opacity: '0.9' }, transition: { type: 'tween', duration: '0.3' } });
  expect(sourceHoverEffect({ hoverEffectEnabled: false, hoverEffectScale: 1.1 })).toBeUndefined();

  const tapSource = { pressedEffectEnabled: true, pressedEffectScale: 0.95, pressedEffectTransition: { type: 'spring', durationBasedSpring: true, duration: 0.2, bounce: 0.1 } };
  expect(sourceTapEffect(tapSource)).toEqual({ props: { scale: '0.95' }, transition: { type: 'spring', duration: '0.2', bounce: '0.1' } });
  expect(sourceTapEffect({ pressedEffectEnabled: false })).toBeUndefined();
});

it('decodes scroll speed / parallax percentage and factors', () => {
  expect(sourceScrollSpeed({ scrollEffectEnabled: true, scrollEffectSpeed: 120 })).toBe(120);
  expect(sourceScrollSpeed({ scrollEffectEnabled: true, scrollSpeed: 0.5 })).toBe(50);
  expect(sourceScrollSpeed({ scrollEffectEnabled: true, speed: 1.5 })).toBe(150);
  expect(sourceScrollSpeed({ scrollEffectEnabled: false, scrollEffectSpeed: 120 })).toBeUndefined();
});

it('retains source transition modes and rejects malformed or unsupported animation settings', () => {
  expect(sourceTransitionSpec({ type: 'spring', durationBasedSpring: true, duration: 0.8, bounce: 0.2, stiffness: 400, damping: 30, mass: 1, delay: 0.1 })).toEqual({ type: 'spring', duration: '0.8', bounce: '0.2', delay: '0.1' });
  expect(sourceTransitionSpec({ type: 'spring', durationBasedSpring: false, duration: 0.8, bounce: 0.2, stiffness: 400, damping: 30, mass: 1 })).toEqual({ type: 'spring', stiffness: '400', damping: '30', mass: '1' });
  for (const value of [{ type: 'tween', duration: 'slow' }, { type: 'tween', duration: -1 }, { type: 'spring', mass: 0 }, { type: 'tween', custom: true }, { type: 'tween', ease: [2, 0, 1, 1] }]) expect(() => sourceTransitionSpec(value)).toThrow();
});

it('decodes document globalPageEffect into native page-effects config with per-axis units', () => {
  const effect = sourceGlobalPageEffect({
    enter: { opacity: 1, scale: 1, rotate: 0, rotate3d: false, rotateX: 0, rotateY: 0, x: '0px', y: '100%', transition: { type: 'tween', duration: 1.4, delay: 0, ease: [0.77, 0, 0.175, 1] } },
    exit: { opacity: 0, scale: 1, rotate: 0, rotate3d: false, rotateX: 0, rotateY: 0, x: '0px', y: '-25%', transition: { type: 'tween', duration: 1.4, delay: 0, ease: [0.77, 0, 0.175, 1] } },
  });
  expect(effect).toMatchObject({
    preset: 'custom', target: 'all',
    enter: { opacity: 1, offsetX: 0, offsetXUnit: 'fixed', offsetY: 100, offsetYUnit: 'relative', transition: { kind: 'ease', ease: 'custom', bezier: [0.77, 0, 0.175, 1], duration: 1.4, delay: 0 } },
    exit: { opacity: 0, offsetX: 0, offsetXUnit: 'fixed', offsetY: -25, offsetYUnit: 'relative', transition: { kind: 'ease', ease: 'custom', bezier: [0.77, 0, 0.175, 1], duration: 1.4, delay: 0 } },
  });
  expect(() => sourceGlobalPageEffect({ enter: { opacity: 1, scale: 1, rotate: 0, rotate3d: false, rotateX: 10, rotateY: 0, x: '0px', y: '0px', transition: { type: 'tween', duration: 0.4 } } })).toThrow();
});
