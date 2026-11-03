import { ensureMotionTag } from '../../generation/generator-motion-scroll';
import { composeLoopInCode, setLoopInCode } from '../../generation/generator-motion-loop';
import { ensureNamedImport } from '../../generation/generator-utils';
import { sourceRecord } from './source-graph';
import { trace } from '../../../shared/debug-trace';
import type { SourceGraph, SourceProperties } from './types';

type LoopSpec = { props: Record<string, string>; transition: Record<string, string>; offscreen?: string };

export interface SourceMountEffects {
  initial: Record<string, string>;
  animate: Record<string, string>;
  exit?: Record<string, string>;
  enterTransition?: Record<string, string>;
  exitTransition?: Record<string, string>;
}

/** onMount uses the explicit entry/exit channels, not the retained style-appear values. */
export function sourceMountEffects(p: SourceProperties): SourceMountEffects | undefined {
  trace.fn('framer-native.sourceMountEffects');
  if (p.styleAppearEffectEnabled !== true) return;
  if (p.styleAppearEffectTrigger !== 'onMount' || p.styleAppearEffectLocked !== false || p.enterEffectEnabled !== true || typeof p.exitEffectEnabled !== 'boolean') throw new Error('Source appearance mode requires its native lifecycle adapter');
  if ((p.rotation ?? 0) !== 0 || (p.scale ?? 1) !== 1) throw new Error('Source appearance with a base transform requires its native composition adapter');
  const axes = { Opacity: 'opacity', X: 'x', Y: 'y', Scale: 'scale', Rotate: 'rotate', RotateX: 'rotateX', RotateY: 'rotateY', SkewX: 'skewX', SkewY: 'skewY' };
  const target: Record<string, string> = {};
  const channel = (prefix: 'enterEffect' | 'exitEffect') => {
    const known = new Set(['Enabled', 'Transition', 'Rotate3d', 'RotateAdditiveDynamicValue', ...Object.keys(axes)].map(key => prefix + key));
    if (Object.keys(p).some(key => key.startsWith(prefix) && !known.has(key)) || p[`${prefix}RotateAdditiveDynamicValue`] === true || p[`${prefix}Rotate3d`] !== undefined && typeof p[`${prefix}Rotate3d`] !== 'boolean') throw new Error(`Unsupported source ${prefix} setting`);
    const values: Record<string, string> = {};
    for (const [suffix, prop] of Object.entries(axes)) {
      const neutral = prop === 'opacity' ? p.opacity ?? 1 : prop === 'scale' ? 1 : 0;
      const value = p[prefix + suffix] ?? neutral;
      if (typeof value !== 'number' || !Number.isFinite(value) || prop === 'opacity' && (value < 0 || value > 1) || typeof neutral !== 'number' || !Number.isFinite(neutral)) throw new Error(`Invalid source ${prefix}${suffix}`);
      if (['rotateX', 'rotateY'].includes(prop) && value !== 0 && p[`${prefix}Rotate3d`] !== true) throw new Error(`Inactive 3D source ${prefix}${suffix} requires verification`);
      values[prop] = String(value); target[prop] = String(neutral);
    }
    const transition = sourceRecord(p[`${prefix}Transition`]);
    if (transition?.stagger !== undefined && transition.stagger !== 0) throw new Error('Source stagger requires its native timing adapter');
    return { values, transition: sourceTransitionSpec(p[`${prefix}Transition`]) };
  };
  const enter = channel('enterEffect');
  const exit = p.exitEffectEnabled ? channel('exitEffect') : undefined;
  return { initial: enter.values, animate: target, enterTransition: enter.transition, ...(exit ? { exit: exit.values, exitTransition: exit.transition } : {}) };
}

/** The captured editor defaults to pausing loops offscreen. */
export function sourceRotationLoop(p: SourceProperties): LoopSpec | undefined {
  if (p.loopEffectEnabled !== true) return;
  trace.fn('framer-native.sourceRotationLoop');
  const known = new Set(['loopEffectEnabled', 'loopEffectOpacity', 'loopEffectX', 'loopEffectY', 'loopEffectScale', 'loopEffectRotate3d', 'loopEffectRotate', 'loopEffectRotateX', 'loopEffectRotateY', 'loopEffectSkewX', 'loopEffectSkewY', 'loopEffectRepeatDelay', 'loopEffectRepeatType', 'loopEffectTransition', 'loopEffectPauseOffscreen']);
  if (Object.keys(p).some(key => key.startsWith('loopEffect') && !known.has(key))) return;
  for (const [key, neutral] of Object.entries({ loopEffectOpacity: 1, loopEffectX: 0, loopEffectY: 0, loopEffectScale: 1, loopEffectRotateX: 0, loopEffectRotateY: 0, loopEffectSkewX: 0, loopEffectSkewY: 0 })) if (p[key] !== undefined && p[key] !== neutral) return;
  if ((p.rotation ?? 0) !== 0 || (p.scale ?? 1) !== 1 || (p.loopEffectRotate3d !== undefined && p.loopEffectRotate3d !== false) || p.loopEffectRepeatType !== 'loop' || (p.loopEffectRepeatDelay ?? 0) !== 0 || (p.loopEffectPauseOffscreen !== undefined && typeof p.loopEffectPauseOffscreen !== 'boolean')) return;
  if (typeof p.loopEffectRotate !== 'number' || !Number.isFinite(p.loopEffectRotate) || p.loopEffectRotate === 0) return;
  const transition = sourceRecord(p.loopEffectTransition);
  if (!transition || transition.type !== 'tween' || typeof transition.duration !== 'number' || !Number.isFinite(transition.duration) || transition.duration <= 0 || (transition.delay ?? 0) !== 0 || JSON.stringify(transition.ease) !== '[0,0,1,1]') return;
  if (Object.keys(transition).some(key => !['type', 'duration', 'delay', 'ease', 'damping', 'mass', 'stiffness', 'durationBasedSpring', 'bounce'].includes(key))) return;
  return { props: { rotate: String(p.loopEffectRotate) }, transition: { duration: String(transition.duration), repeat: 'Infinity', ease: 'linear' }, ...(p.loopEffectPauseOffscreen === false ? { offscreen: 'play' } : {}) };
}

export function applySourceRotationLoop(code: string, nodeId: string, spec: LoopSpec): string {
  trace.fn('framer-native.applySourceRotationLoop', { nodeId });
  let result = ensureMotionTag(code, nodeId);
  result = setLoopInCode(result, nodeId, spec);
  result = composeLoopInCode(result, nodeId);
  result = ensureNamedImport(result, 'framer-motion', spec.offscreen === 'play' ? ['motion', 'useMotionValue', 'animate'] : ['motion', 'useMotionValue', 'useInView', 'animate']);
  return ensureNamedImport(result, 'react', spec.offscreen === 'play' ? ['useEffect'] : ['useEffect', 'useRef']);
}

export function assertLoopOutsideSourceList(graph: SourceGraph, nodeId: string): void {
  const seen = new Set<string>();
  let id: string | undefined = nodeId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = graph.nodes.get(id);
    if (node?.kind !== 'WebPageNode' && node?.raw.dataIdentifier !== undefined) throw new Error(`Loop in repeated source list on ${nodeId} requires its native per-item adapter`);
    const parent: unknown = node?.raw.parentid;
    id = typeof parent === 'string' ? parent : undefined;
  }
}

export function sourceTransitionSpec(value: unknown): Record<string, string> | undefined {
  trace.fn('framer-native.sourceTransition');
  const transition = sourceRecord(value);
  if (value == null) return;
  if (!transition) throw new Error('Invalid source transition');
  if (transition.type === false) return { duration: '0' };
  if (!['tween', 'spring'].includes(String(transition.type))) throw new Error('Unsupported source transition type');
  const numeric = ['duration', 'delay', 'bounce', 'stiffness', 'damping', 'mass', 'stagger'];
  if (Object.keys(transition).some(key => !['type', 'ease', 'durationBasedSpring', ...numeric].includes(key))) throw new Error('Unsupported source transition field');
  for (const key of numeric) if (transition[key] !== undefined && (typeof transition[key] !== 'number' || !Number.isFinite(transition[key]) || Number(transition[key]) < 0 || ['mass', 'stiffness'].includes(key) && transition[key] === 0 || key === 'bounce' && Number(transition[key]) > 1)) throw new Error(`Invalid source transition ${key}`);
  if (transition.durationBasedSpring !== undefined && typeof transition.durationBasedSpring !== 'boolean') throw new Error('Invalid source spring mode');
  const output: Record<string, string> = { type: String(transition.type) };
  const keys = transition.type === 'spring'
    ? transition.durationBasedSpring ? ['duration', 'bounce', 'delay'] : ['stiffness', 'damping', 'mass', 'delay']
    : ['duration', 'delay'];
  for (const key of keys) if (typeof transition[key] === 'number') output[key] = String(transition[key]);
  if (transition.type === 'tween' && transition.ease !== undefined) {
    if (Array.isArray(transition.ease) && transition.ease.length === 4 && transition.ease.every(item => typeof item === 'number' && Number.isFinite(item)) && [transition.ease[0], transition.ease[2]].every(value => value >= 0 && value <= 1)) output.ease = JSON.stringify(transition.ease);
    else if (typeof transition.ease === 'string' && ['linear', 'easeIn', 'easeOut', 'easeInOut', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut', 'anticipate'].includes(transition.ease)) output.ease = transition.ease;
    else throw new Error('Unsupported source easing');
  }
  if (typeof transition.stagger === 'number' && transition.stagger !== 0) throw new Error('Source stagger requires the motion emitter');
  return output;
}
