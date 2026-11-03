import { expect, it } from 'vitest';
import { assertLoopOutsideSourceList, sourceRotationLoop, sourceTransitionSpec, sourceMountEffects } from './effects';
import { buildSourceGraph } from './source-graph';
import type { NativeTransfer } from './types';

it('reads separate on-mount entry and exit settings without substituting the legacy appearance values', () => {
  const p = { styleAppearEffectEnabled: true, styleAppearEffectTrigger: 'onMount', styleAppearEffectLocked: false, styleAppearEffectScale: 0.5, enterEffectEnabled: true, enterEffectOpacity: 0, enterEffectY: 200, enterEffectScale: 1, enterEffectTransition: { type: 'tween', duration: 1.5, delay: 0.1, ease: [0.6, 0.2, 0, 1] }, exitEffectEnabled: true, exitEffectOpacity: 0, exitEffectY: 200, exitEffectTransition: { type: 'tween', duration: 0.8, delay: 0.3 } };
  expect(sourceMountEffects(p)).toMatchObject({ initial: { opacity: '0', y: '200', scale: '1' }, animate: { opacity: '1', y: '0', scale: '1' }, exit: { opacity: '0', y: '200' }, enterTransition: { duration: '1.5', delay: '0.1' }, exitTransition: { duration: '0.8', delay: '0.3' } });
  expect(sourceMountEffects({ ...p, styleAppearEffectEnabled: false })).toBeUndefined();
  expect(() => sourceMountEffects({ ...p, enterEffectY: NaN })).toThrow();
  expect(() => sourceMountEffects({ ...p, styleAppearEffectTrigger: 'inView' })).toThrow();
});

it('refuses a shared animation hook inside a repeated list', () => {
  const list = { id: 'list', __class: 'FrameNode', dataIdentifier: 'local-module:collection/items:default', children: [{ id: 'spinner', __class: 'FrameNode', parentid: 'list', children: [] }] };
  const items = { id: 'items', __class: 'CollectionNode', children: [] };
  const input: NativeTransfer = { format: 'revyme.framer.native', version: 1, context: { projectId: 'x', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'list', mode: 'selection' }, complete: true, diagnostics: [], rootIds: ['list'], definitions: [list, items].map(data => ({ id: data.id, kind: data.__class, data })), assets: [] };
  expect(() => assertLoopOutsideSourceList(buildSourceGraph(input), 'spinner')).toThrow(/per-item adapter/);
});

it('keeps unsupported timings or other effects from being approximated as rotation', () => {
  const base = { loopEffectEnabled: true, loopEffectRotate: 360, loopEffectRepeatType: 'loop', loopEffectTransition: { type: 'tween', duration: 1, delay: 0, ease: [0, 0, 1, 1] } };
  expect(sourceRotationLoop(base)?.transition).toMatchObject({ duration: '1', repeat: 'Infinity', ease: 'linear' });
  expect(sourceRotationLoop({ ...base, loopEffectX: 10 })).toBeUndefined();
  expect(sourceRotationLoop({ ...base, loopEffectTransition: { ...base.loopEffectTransition, ease: [0.4, 0, 1, 1] } })).toBeUndefined();
  expect(sourceRotationLoop({ ...base, loopEffectPauseOffscreen: false })?.offscreen).toBe('play');
  expect(sourceRotationLoop({ ...base, loopEffectOpacity: 1, loopEffectX: 0, loopEffectY: 0, loopEffectScale: 1, loopEffectRotate3d: false, loopEffectRotateX: 0, loopEffectRotateY: 0, loopEffectSkewX: 0, loopEffectSkewY: 0, loopEffectRepeatDelay: 0, loopEffectTransition: { ...base.loopEffectTransition, damping: 60, mass: 1, stiffness: 500 } })).toEqual(sourceRotationLoop(base));
});

it('retains source transition modes and rejects malformed or unsupported animation settings', () => {
  expect(sourceTransitionSpec({ type: 'spring', durationBasedSpring: true, duration: 0.8, bounce: 0.2, stiffness: 400, damping: 30, mass: 1, delay: 0.1 })).toEqual({ type: 'spring', duration: '0.8', bounce: '0.2', delay: '0.1' });
  expect(sourceTransitionSpec({ type: 'spring', durationBasedSpring: false, duration: 0.8, bounce: 0.2, stiffness: 400, damping: 30, mass: 1 })).toEqual({ type: 'spring', stiffness: '400', damping: '30', mass: '1' });
  for (const value of [{ type: 'tween', duration: 'slow' }, { type: 'tween', duration: -1 }, { type: 'spring', mass: 0 }, { type: 'tween', custom: true }, { type: 'tween', ease: [2, 0, 1, 1] }]) expect(() => sourceTransitionSpec(value)).toThrow();
});
