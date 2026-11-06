import { ensureMotionTag } from '../../generation/generator-motion-scroll';
import { ensureTransformTemplateInCode, setMotionPropScopedValue, updateMotionPropInCode } from '../../generation/generator-motion-props';
import { emitObj } from '../../generation/generator-motion-compose';
import { composeLoopInCode, setLoopInCode } from '../../generation/generator-motion-loop';
import { ensureNamedImport } from '../../generation/generator-utils';
import type { GlideSpec } from '../../generation/glide-gen';
import { createDefaultSide, DEFAULT_BEZIER, type PageEffect, type SideConfig, type TransitionConfig } from '../../project/page-effects-config';
import { sourceRecord } from './source-graph';
import { trace } from '../../../shared/debug-trace';
import type { SourceGraph, SourceProperties } from './types';

type LoopSpec = { props: Record<string, string>; transition: Record<string, string>; offscreen?: string };

export interface SourceMountEffects {
  trigger?: 'onMount' | 'inView';
  initial: Record<string, string>;
  animate: Record<string, string>;
  exit?: Record<string, string>;
  enterTransition?: Record<string, string>;
  exitTransition?: Record<string, string>;
}

/** onMount and inView use the explicit entry/exit channels, not the retained style-appear values. */
export function sourceMountEffects(p: SourceProperties): SourceMountEffects | undefined {
  trace.fn('framer-native.sourceMountEffects');
  if (p.styleAppearEffectEnabled !== true) return;
  const isMount = p.styleAppearEffectTrigger === 'onMount' || p.styleAppearEffectTrigger === 'onAppear' || p.styleAppearEffectTrigger === 'appear';
  const isInView = p.styleAppearEffectTrigger === 'inView' || p.styleAppearEffectTrigger === 'onInView' || p.styleAppearEffectTrigger === 'view';
  if (!isMount && !isInView) throw new Error('Source appearance mode requires its native lifecycle adapter');
  const trigger: 'onMount' | 'inView' = isInView ? 'inView' : 'onMount';
  if (typeof p.styleAppearEffectLocked !== 'boolean' || p.enterEffectEnabled !== true || typeof p.exitEffectEnabled !== 'boolean') throw new Error('Source appearance mode requires its native lifecycle adapter');
  if (p.styleAppearEffectLocked && Object.keys(p).some(key => key.startsWith('exitEffect') && key !== 'exitEffectEnabled')) throw new Error('Source appearance mode requires its native lifecycle adapter');
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
    return { values, transition: sourceTransitionSpec(p[`${prefix}Transition`]) };
  };
  const enter = channel('enterEffect');
  const exit = p.exitEffectEnabled ? (p.styleAppearEffectLocked ? enter : channel('exitEffect')) : undefined;
  return { trigger, initial: enter.values, animate: target, enterTransition: enter.transition, ...(exit ? { exit: exit.values, exitTransition: exit.transition } : {}) };
}

export function applySourceMountEffects(
  code: string,
  nodeId: string,
  spec: SourceMountEffects,
  responsive: Array<{ width: number; spec: SourceMountEffects }> = [],
): string {
  trace.fn('framer-native.applySourceMountEffects', { nodeId });
  const animProp = spec.trigger === 'inView' ? 'whileInView' : 'animate';
  let result = updateMotionPropInCode(code, nodeId, 'initial', spec.initial);
  result = updateMotionPropInCode(result, nodeId, animProp, spec.animate);
  if (spec.trigger === 'inView') {
    result = updateMotionPropInCode(result, nodeId, 'viewport', { once: 'true' });
  }
  if (spec.enterTransition) result = updateMotionPropInCode(result, nodeId, 'transition', spec.enterTransition);
  result = updateMotionPropInCode(result, nodeId, 'exit', spec.exit ? { ...spec.exit, ...(spec.exitTransition ? { transition: emitObj(spec.exitTransition) } : {}) } : { transition: '{ duration: 0 }' });
  const ordered = [...responsive].sort((a, b) => b.width - a.width);
  for (const entry of ordered) {
    if (JSON.stringify(entry.spec.exit) !== JSON.stringify(spec.exit) || JSON.stringify(entry.spec.exitTransition) !== JSON.stringify(spec.exitTransition)) {
      throw new Error(`Responsive on-mount exit effect on ${nodeId} requires its native adapter`);
    }
  }
  for (const [propName, pick] of [
    ['initial', (item: SourceMountEffects) => item.initial],
    [animProp, (item: SourceMountEffects) => item.animate],
    ['transition', (item: SourceMountEffects) => item.enterTransition],
  ] as const) {
    let current = pick(spec);
    const branches: Array<{ width: number; props: Record<string, string> }> = [];
    for (const entry of ordered) {
      const next = pick(entry.spec);
      if (JSON.stringify(next) === JSON.stringify(current)) continue;
      if (!next || !current) throw new Error(`Responsive on-mount ${propName} presence on ${nodeId} requires its native adapter`);
      branches.push({ width: entry.width, props: next });
      current = next;
    }
    for (const branch of [...branches].reverse()) {
      result = setMotionPropScopedValue(result, nodeId, propName, branch.props, { query: `(max-width: ${branch.width}px)` });
    }
  }
  return ensureTransformTemplateInCode(result, nodeId);
}

/** The captured editor defaults to pausing loops offscreen. Supports rotate, scale, y, x, opacity, skew. */
export function sourceRotationLoop(p: SourceProperties): LoopSpec | undefined {
  if (p.loopEffectEnabled !== true) return;
  trace.fn('framer-native.sourceRotationLoop');
  const known = new Set(['loopEffectEnabled', 'loopEffectOpacity', 'loopEffectX', 'loopEffectY', 'loopEffectScale', 'loopEffectRotate3d', 'loopEffectRotate', 'loopEffectRotateX', 'loopEffectRotateY', 'loopEffectSkewX', 'loopEffectSkewY', 'loopEffectRepeatDelay', 'loopEffectRepeatType', 'loopEffectTransition', 'loopEffectPauseOffscreen']);
  if (Object.keys(p).some(key => key.startsWith('loopEffect') && !known.has(key))) return;
  if ((p.rotation ?? 0) !== 0 || (p.scale ?? 1) !== 1) return;
  if (p.loopEffectRotate3d !== undefined && typeof p.loopEffectRotate3d !== 'boolean') return;
  if (!p.loopEffectRotate3d && ((typeof p.loopEffectRotateX === 'number' && p.loopEffectRotateX !== 0) || (typeof p.loopEffectRotateY === 'number' && p.loopEffectRotateY !== 0))) return;
  if (p.loopEffectPauseOffscreen !== undefined && typeof p.loopEffectPauseOffscreen !== 'boolean') return;
  if (p.loopEffectRepeatDelay !== undefined && (typeof p.loopEffectRepeatDelay !== 'number' || !Number.isFinite(p.loopEffectRepeatDelay) || p.loopEffectRepeatDelay < 0)) return;

  if (p.loopEffectRepeatType !== undefined && !['loop', 'mirror', 'reverse'].includes(String(p.loopEffectRepeatType))) return;
  const repeatType = (p.loopEffectRepeatType === 'mirror' || p.loopEffectRepeatType === 'reverse') ? p.loopEffectRepeatType : 'loop';

  const axes: Record<string, { key: string; neutral: number }> = {
    loopEffectOpacity: { key: 'opacity', neutral: 1 },
    loopEffectScale: { key: 'scale', neutral: 1 },
    loopEffectX: { key: 'x', neutral: 0 },
    loopEffectY: { key: 'y', neutral: 0 },
    loopEffectRotate: { key: 'rotate', neutral: 0 },
    loopEffectRotateX: { key: 'rotateX', neutral: 0 },
    loopEffectRotateY: { key: 'rotateY', neutral: 0 },
    loopEffectSkewX: { key: 'skewX', neutral: 0 },
    loopEffectSkewY: { key: 'skewY', neutral: 0 },
  };

  const props: Record<string, string> = {};
  for (const [propName, { key, neutral }] of Object.entries(axes)) {
    const val = p[propName];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || !Number.isFinite(val)) return;
      if (val !== neutral) props[key] = String(val);
    }
  }
  if (!Object.keys(props).length) return;

  const transitionRecord = sourceRecord(p.loopEffectTransition);
  if (!transitionRecord) return;
  const spec = sourceTransitionSpec(transitionRecord);
  if (!spec) return;

  const trans: Record<string, string> = {
    ...spec,
    repeat: 'Infinity',
    ...(repeatType !== 'loop' ? { repeatType } : {}),
    ...(p.loopEffectRepeatDelay && p.loopEffectRepeatDelay > 0 ? { repeatDelay: String(p.loopEffectRepeatDelay) } : {}),
  };
  if (trans.ease === '[0,0,1,1]' || trans.ease === '[0, 0, 1, 1]') trans.ease = 'linear';
  if (spec.type === 'tween' && !trans.ease && repeatType === 'loop') trans.ease = 'linear';

  return {
    props,
    transition: trans,
    ...(p.loopEffectPauseOffscreen === false ? { offscreen: 'play' } : {}),
  };
}

export const sourceLoopEffect = sourceRotationLoop;

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
  return output;
}

export function sourceFlowEffect(p: SourceProperties): GlideSpec | undefined {
  if (p.flowEffectEnabled !== true) return;
  trace.fn('framer-native.sourceFlowEffect');
  const known = new Set(['flowEffectEnabled', 'flowEffectTransition']);
  if (Object.keys(p).some(key => key.startsWith('flowEffect') && !known.has(key))) throw new Error('Unsupported source flowEffect setting');
  const transition = sourceTransitionSpec(p.flowEffectTransition);
  if (!transition) throw new Error('Missing source flowEffectTransition');
  return { transition };
}

export function sourceGlobalPageEffect(value: unknown): PageEffect | undefined {
  if (value == null) return;
  trace.fn('framer-native.sourceGlobalPageEffect');
  const raw = sourceRecord(value);
  if (!raw || Object.keys(raw).some(key => !['enter', 'exit'].includes(key))) throw new Error('Unsupported source global page effect');
  const parseOffset = (input: unknown): { value: number; unit: 'fixed' | 'relative' } => {
    if (input === 0) return { value: 0, unit: 'fixed' };
    const match = typeof input === 'string' ? /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%)$/.exec(input.trim()) : null;
    const parsed = match ? Number(match[1]) : NaN;
    if (!match || !Number.isFinite(parsed)) throw new Error(`Invalid source page effect offset ${String(input)}`);
    return { value: parsed, unit: match[2] === '%' ? 'relative' : 'fixed' };
  };
  const parseSide = (input: unknown): SideConfig | undefined => {
    if (input == null) return;
    const s = sourceRecord(input);
    const known = new Set(['opacity', 'scale', 'rotate', 'rotate3d', 'rotateX', 'rotateY', 'x', 'y', 'transition']);
    if (!s || Object.keys(s).some(key => !known.has(key))) throw new Error('Unsupported source page effect side');
    if (typeof s.opacity !== 'number' || !Number.isFinite(s.opacity) || s.opacity < 0 || s.opacity > 1) throw new Error('Invalid source page effect opacity');
    if (typeof s.scale !== 'number' || !Number.isFinite(s.scale) || s.scale < 0) throw new Error('Invalid source page effect scale');
    if (typeof s.rotate !== 'number' || !Number.isFinite(s.rotate) || typeof s.rotate3d !== 'boolean' || typeof s.rotateX !== 'number' || !Number.isFinite(s.rotateX) || typeof s.rotateY !== 'number' || !Number.isFinite(s.rotateY)) throw new Error('Invalid source page effect rotation');
    if (!s.rotate3d && (s.rotateX !== 0 || s.rotateY !== 0)) throw new Error('Inactive 3D page effect rotation requires verification');
    const x = parseOffset(s.x), y = parseOffset(s.y);
    const transitionRecord = sourceRecord(s.transition), spec = sourceTransitionSpec(s.transition);
    if (!transitionRecord || !spec) throw new Error('Missing source page effect transition');
    let transition: TransitionConfig;
    if (spec.type === 'tween') {
      const bezier = spec.ease?.startsWith('[') ? JSON.parse(spec.ease) as [number, number, number, number] : undefined;
      if (spec.ease !== undefined && !bezier) throw new Error(`Source page effect easing ${spec.ease} requires a bezier adapter`);
      transition = { kind: 'ease', ease: bezier ? 'custom' : 'easeInOut', bezier: bezier ?? [...DEFAULT_BEZIER], duration: Number(spec.duration ?? 0.4), delay: Number(spec.delay ?? 0) };
    } else if (spec.type === 'spring' && transitionRecord.durationBasedSpring !== true) {
      transition = { kind: 'spring', stiffness: Number(spec.stiffness ?? 100), damping: Number(spec.damping ?? 10), mass: Number(spec.mass ?? 1), duration: Number(spec.duration ?? 0.4), delay: Number(spec.delay ?? 0) };
    } else throw new Error('Source page effect transition mode requires its native timing adapter');
    const side = createDefaultSide();
    side.opacity = s.opacity; side.scale = s.scale;
    side.rotate = s.rotate3d ? '3d' : '2d'; side.rotateZ = s.rotate; side.rotateX = s.rotate3d ? s.rotateX : 0; side.rotateY = s.rotate3d ? s.rotateY : 0;
    side.offsetX = x.value; side.offsetXUnit = x.unit; side.offsetY = y.value; side.offsetYUnit = y.unit;
    side.transition = transition;
    return side;
  };
  const enter = parseSide(raw.enter), exit = parseSide(raw.exit);
  if (!enter && !exit) throw new Error('Empty source global page effect');
  const moves = [exit, enter].some(s => s && (s.offsetX !== 0 || s.offsetY !== 0 || s.scale !== 1 || s.rotateZ !== 0 || s.rotateX !== 0 || s.rotateY !== 0));
  const sequenced = !moves && !!exit && !!enter && (exit.transition.delay >= enter.transition.delay + enter.transition.duration || enter.transition.delay >= exit.transition.delay + exit.transition.duration);
  return { preset: moves ? 'custom' : sequenced ? 'fade-out-in' : 'crossfade', target: 'all', ...(exit ? { exit } : {}), ...(enter ? { enter } : {}) };
}

export interface SourceGestureEffect {
  props: Record<string, string>;
  transition?: Record<string, string>;
}

export function sourceHoverEffect(p: SourceProperties): SourceGestureEffect | undefined {
  if (p.hoverEffectEnabled !== true) return undefined;
  trace.fn('framer-native.sourceHoverEffect');
  const axes: Record<string, { key: string; neutral: number }> = {
    hoverEffectOpacity: { key: 'opacity', neutral: 1 },
    hoverEffectScale: { key: 'scale', neutral: 1 },
    hoverEffectX: { key: 'x', neutral: 0 },
    hoverEffectY: { key: 'y', neutral: 0 },
    hoverEffectRotate: { key: 'rotate', neutral: 0 },
    hoverEffectRotateX: { key: 'rotateX', neutral: 0 },
    hoverEffectRotateY: { key: 'rotateY', neutral: 0 },
    hoverEffectSkewX: { key: 'skewX', neutral: 0 },
    hoverEffectSkewY: { key: 'skewY', neutral: 0 },
  };
  const props: Record<string, string> = {};
  for (const [propName, { key, neutral }] of Object.entries(axes)) {
    const val = p[propName];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || !Number.isFinite(val)) return undefined;
      if (val !== neutral) props[key] = String(val);
    }
  }
  if (!Object.keys(props).length) return undefined;
  const transition = p.hoverEffectTransition ? sourceTransitionSpec(p.hoverEffectTransition) : undefined;
  return { props, ...(transition ? { transition } : {}) };
}

export function sourceTapEffect(p: SourceProperties): SourceGestureEffect | undefined {
  const isEnabled = p.pressedEffectEnabled === true || p.tapEffectEnabled === true;
  if (!isEnabled) return undefined;
  trace.fn('framer-native.sourceTapEffect');
  const prefix = p.pressedEffectEnabled === true ? 'pressedEffect' : 'tapEffect';
  const axes: Record<string, { key: string; neutral: number }> = {
    [`${prefix}Opacity`]: { key: 'opacity', neutral: 1 },
    [`${prefix}Scale`]: { key: 'scale', neutral: 1 },
    [`${prefix}X`]: { key: 'x', neutral: 0 },
    [`${prefix}Y`]: { key: 'y', neutral: 0 },
    [`${prefix}Rotate`]: { key: 'rotate', neutral: 0 },
    [`${prefix}RotateX`]: { key: 'rotateX', neutral: 0 },
    [`${prefix}RotateY`]: { key: 'rotateY', neutral: 0 },
    [`${prefix}SkewX`]: { key: 'skewX', neutral: 0 },
    [`${prefix}SkewY`]: { key: 'skewY', neutral: 0 },
  };
  const props: Record<string, string> = {};
  for (const [propName, { key, neutral }] of Object.entries(axes)) {
    const val = p[propName];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || !Number.isFinite(val)) return undefined;
      if (val !== neutral) props[key] = String(val);
    }
  }
  if (!Object.keys(props).length) return undefined;
  const transVal = p[`${prefix}Transition`];
  const transition = transVal ? sourceTransitionSpec(transVal) : undefined;
  return { props, ...(transition ? { transition } : {}) };
}

export function sourceScrollSpeed(p: SourceProperties): number | undefined {
  if (p.scrollEffectEnabled !== true) return undefined;
  trace.fn('framer-native.sourceScrollSpeed');
  const raw = p.scrollEffectSpeed ?? p.scrollSpeed ?? p.speed;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const speed = Math.abs(raw) <= 2 && raw !== 1 && raw !== 0 ? Math.round(raw * 100) : raw;
  return speed;
}
