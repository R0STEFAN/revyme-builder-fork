import { ensureMotionTag } from '../../generation/generator-motion-scroll';
import { composeLoopInCode, setLoopInCode } from '../../generation/generator-motion-loop';
import { ensureNamedImport } from '../../generation/generator-utils';
import { sourceRecord } from './source-graph';
import { trace } from '../../../shared/debug-trace';
import type { SourceGraph, SourceProperties } from './types';

type LoopSpec = { props: Record<string, string>; transition: Record<string, string>; offscreen?: string };

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
