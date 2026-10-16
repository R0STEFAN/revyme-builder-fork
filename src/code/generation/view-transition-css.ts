/**
 * view-transition-css.ts — pure CSS generation for Page Effects (View
 * Transitions API). Maps a standard {exit, enter} SideConfig pair to the
 * `::view-transition-old(root)` / `::view-transition-new(root)` keyframes.
 *
 * Fully pure + unit-tested. The SAME logic is emitted into the deployed
 * `page-effects-runtime.ts` so preview + deploy run identical CSS (source =
 * deploy reality).
 */

import { trace } from '@/shared/debug-trace';
import {
  DEFAULT_BEZIER,
  createDefaultSide,
  type SideConfig,
  type MaskConfig,
  type TransitionConfig,
  type PageEffect,
  type PageEffectsMap,
} from '../project/page-effects-config';

// ─── Transform composition (§5.2) ────────────────────────────────────────────

/** A side's non-identity transform: translate → scale → rotate (identity parts
 *  omitted). `100%` offset = full page dimension. Returns 'none' when identity. */
export function sideToTransform(s: SideConfig): string {
  const parts: string[] = [];
  if (s.offsetX !== 0 || s.offsetY !== 0) {
    const ux = s.offsetXUnit === 'relative' ? '%' : 'px';
    const uy = s.offsetYUnit === 'relative' ? '%' : 'px';
    parts.push(`translate(${s.offsetX}${ux}, ${s.offsetY}${uy})`);
  }
  if (s.scale !== 1) parts.push(`scale(${s.scale})`);
  if (s.rotate === '3d') {
    if (s.rotateX !== 0 || s.rotateY !== 0 || s.rotateZ !== 0) {
      parts.push(`perspective(1200px) rotateX(${s.rotateX}deg) rotateY(${s.rotateY}deg) rotateZ(${s.rotateZ}deg)`);
    }
  } else if (s.rotateZ !== 0) {
    parts.push(`rotate(${s.rotateZ}deg)`);
  }
  return parts.length ? parts.join(' ') : 'none';
}

// ─── Mask → clip-path (§5.3) ─────────────────────────────────────────────────

/** clip-path for a mask at its 'full' (covering) or 'clipped' (hidden) phase.
 *  Enter goes clipped→full (reveal); exit goes full→clipped (clip away). */
export function maskToClip(mask: MaskConfig, phase: 'full' | 'clipped'): string {
  if (mask.type === 'circle') {
    const ox = `${mask.originX}${mask.originXUnit === 'rel' ? '%' : 'px'}`;
    const oy = `${mask.originY}${mask.originYUnit === 'rel' ? '%' : 'px'}`;
    // 150% guarantees the circle covers the corners at full.
    return phase === 'full' ? `circle(150% at ${ox} ${oy})` : `circle(0% at ${ox} ${oy})`;
  }
  if (phase === 'full') return 'inset(0 0 0 0)';
  switch (mask.type) {
    case 'wipe-left': return 'inset(0 0 0 100%)';
    case 'wipe-right': return 'inset(0 100% 0 0)';
    case 'wipe-up': return 'inset(100% 0 0 0)';
    case 'wipe-down': return 'inset(0 0 100% 0)';
    default: return 'inset(0 0 0 0)';
  }
}

// ─── Easing (§5.4) ───────────────────────────────────────────────────────────

/** Sample an underdamped spring's normalized position curve (0→1, with
 *  overshoot) into a CSS `linear()` easing + its settle duration (seconds).
 *  CSS has no native spring; `linear()` is supported wherever View Transitions
 *  are (Chrome 116+ ⊃ linear() 113+). */
export function springToLinearEasing(spring: { stiffness?: number; damping?: number; mass?: number }): {
  easing: string;
  duration: number;
} {
  const k = spring.stiffness ?? 100;
  const c = spring.damping ?? 10;
  const m = spring.mass ?? 1;
  const w0 = Math.sqrt(k / m); // natural frequency
  const zeta = c / (2 * Math.sqrt(k * m)); // damping ratio
  // Settle time ≈ envelope decay to 1%, clamped to a sane range.
  const settle = zeta > 0 ? Math.min(Math.max(-Math.log(0.01) / (zeta * w0), 0.2), 4) : 1;
  const STEPS = 24;
  const stops: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * settle;
    let x: number;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    } else if (zeta === 1) {
      x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    } else {
      const s = Math.sqrt(zeta * zeta - 1);
      const r1 = -w0 * (zeta - s);
      const r2 = -w0 * (zeta + s);
      const A = r2 / (r2 - r1);
      const B = -r1 / (r2 - r1);
      x = 1 - (A * Math.exp(r1 * t) + B * Math.exp(r2 * t));
    }
    stops.push(Math.round(x * 1000) / 1000);
  }
  stops[0] = 0;
  stops[stops.length - 1] = 1; // pin endpoints
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(settle * 1000) / 1000 };
}

/** Resolve a TransitionConfig → { easing, duration, delay } for the CSS animation
 *  shorthand. Spring derives duration from physics; ease uses the configured time. */
export function resolveTiming(t: TransitionConfig): { easing: string; duration: number; delay: number } {
  if (t.kind === 'spring') {
    const { easing, duration } = springToLinearEasing(t);
    return { easing, duration, delay: t.delay ?? 0 };
  }
  const b = t.bezier ?? DEFAULT_BEZIER;
  return {
    easing: `cubic-bezier(${b[0]}, ${b[1]}, ${b[2]}, ${b[3]})`,
    duration: t.duration ?? 0.4,
    delay: t.delay ?? 0,
  };
}

// ─── Full CSS builder (§5.1) ─────────────────────────────────────────────────

/** Build the complete `<style>` body for one navigation's transition. Either
 *  side may be omitted (that side just sits, no animation). */
export function buildViewTransitionCSS(exit?: SideConfig, enter?: SideConfig): string {
  const lines: string[] = [];
  lines.push('@media (prefers-reduced-motion: reduce) {');
  lines.push('  .revyme-pt-exit, .revyme-pt-enter { animation-duration: 0s !important; animation-delay: 0s !important; }');
  lines.push('}');
  lines.push('[data-revyme-pt-stage] { position: relative; width: 100%; isolation: isolate; }');
  lines.push('[data-revyme-pt-stage].revyme-pt-animating { overflow: clip; }');
  lines.push('.revyme-pt-exit { position: absolute; top: 0; left: 0; width: 100%; pointer-events: none; z-index: 2; mix-blend-mode: normal; will-change: transform, opacity; backface-visibility: hidden; transform: translateZ(0); }');
  lines.push('.revyme-pt-enter { width: 100%; position: relative; z-index: 1; mix-blend-mode: normal; will-change: transform, opacity; backface-visibility: hidden; transform: translateZ(0); }');

  if (exit) {
    const t = resolveTiming(exit.transition);
    lines.push(`.revyme-pt-exit.revyme-pt-exiting { animation: ${t.duration}s ${t.easing} ${t.delay}s both revyme-vt-exit; transform-origin: 50% 50%; will-change: transform, opacity; }`);
    const mf = exit.mask ? maskToClip(exit.mask, 'full') : null;
    const mt = exit.mask ? maskToClip(exit.mask, 'clipped') : null;
    lines.push('@keyframes revyme-vt-exit {');
    lines.push(`  from { opacity: 1; transform: none;${mf ? ` clip-path: ${mf};` : ''} }`);
    lines.push(`  to { opacity: ${exit.opacity}; transform: ${sideToTransform(exit)};${mt ? ` clip-path: ${mt};` : ''} }`);
    lines.push('}');
  } else {
    lines.push('.revyme-pt-exit { animation: none; }');
  }

  if (enter) {
    const t = resolveTiming(enter.transition);
    lines.push(`.revyme-pt-enter.revyme-pt-entering { animation: ${t.duration}s ${t.easing} ${t.delay}s both revyme-vt-enter; transform-origin: 50% 50%; will-change: transform, opacity; }`);
    const mf = enter.mask ? maskToClip(enter.mask, 'clipped') : null;
    const mt = enter.mask ? maskToClip(enter.mask, 'full') : null;
    lines.push('@keyframes revyme-vt-enter {');
    lines.push(`  from { opacity: ${enter.opacity}; transform: ${sideToTransform(enter)};${mf ? ` clip-path: ${mf};` : ''} }`);
    lines.push(`  to { opacity: 1; transform: none;${mt ? ` clip-path: ${mt};` : ''} }`);
    lines.push('}');
  } else {
    lines.push('.revyme-pt-enter { animation: none; }');
  }

  return lines.join('\n');
}

// ─── Presets (§5.5) ──────────────────────────────────────────────────────────

function side(overrides: Partial<SideConfig>): SideConfig {
  return { ...createDefaultSide(), ...overrides };
}
function maskSide(type: MaskConfig['type']): SideConfig {
  return side({ mask: { type, originX: 50, originXUnit: 'rel', originY: 50, originYUnit: 'rel' } });
}

export interface PresetSides { exit?: SideConfig; enter?: SideConfig; }

/** name → factory producing the concrete {exit?, enter?} SideConfigs. All
 *  offsets relative (%) so they scale to the page. Slide = new page only moves
 *  (old sits under); Push = both move in lockstep; Wipe = new revealed via clip. */
export const PRESETS: Record<string, () => PresetSides> = {
  crossfade: () => ({ exit: side({ opacity: 0 }), enter: side({ opacity: 0 }) }),
  'fade-out-in': () => {
    const exit = side({ opacity: 0 });
    const enter = side({ opacity: 0 });
    enter.transition.delay = exit.transition.duration; // sequenced
    return { exit, enter };
  },
  'slide-left': () => ({ enter: side({ offsetX: 100 }) }),
  'slide-right': () => ({ enter: side({ offsetX: -100 }) }),
  'slide-up': () => ({ enter: side({ offsetY: 100 }) }),
  'slide-down': () => ({ enter: side({ offsetY: -100 }) }),
  'push-left': () => ({ exit: side({ offsetX: -100 }), enter: side({ offsetX: 100 }) }),
  'push-right': () => ({ exit: side({ offsetX: 100 }), enter: side({ offsetX: -100 }) }),
  'push-up': () => ({ exit: side({ offsetY: -100 }), enter: side({ offsetY: 100 }) }),
  'push-down': () => ({ exit: side({ offsetY: 100 }), enter: side({ offsetY: -100 }) }),
  'wipe-left': () => ({ enter: maskSide('wipe-left') }),
  'wipe-right': () => ({ enter: maskSide('wipe-right') }),
  'wipe-up': () => ({ enter: maskSide('wipe-up') }),
  'wipe-down': () => ({ enter: maskSide('wipe-down') }),
};

/** Human labels for the Preset dropdown (order matches the reference's menu). */
export const PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'fade-out-in', label: 'Fade Out & In' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-down', label: 'Slide Down' },
  { value: 'push-left', label: 'Push Left' },
  { value: 'push-up', label: 'Push Up' },
  { value: 'push-right', label: 'Push Right' },
  { value: 'push-down', label: 'Push Down' },
  { value: 'wipe-left', label: 'Wipe Left' },
  { value: 'wipe-up', label: 'Wipe Up' },
  { value: 'wipe-right', label: 'Wipe Right' },
  { value: 'wipe-down', label: 'Wipe Down' },
  { value: 'custom', label: 'Custom' },
];

/** Resolve a preset name to its {exit?, enter?} sides (fresh copies). 'custom'
 *  (or unknown) → empty (caller keeps the user's edited sides). */
export function applyPreset(name: string): PresetSides {
  const f = PRESETS[name];
  return f ? f() : {};
}

function routeMatches(pattern: string, actual: string): boolean {
  if (!pattern || !actual) return false;
  if (pattern === actual) return true;
  if (pattern.indexOf('[') === -1) return false;
  const patternParts = pattern.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);
  if (patternParts.length !== actualParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith('[') && p.endsWith(']')) continue;
    if (p !== actualParts[i]) return false;
  }
  return true;
}

/** Pick the effect for a navigation source→dest: byTarget > all > __default > null. */
export function resolvePageEffect(map: PageEffectsMap, source: string, dest: string): PageEffect | null {
  const pages = map?.pages;
  let bucket = pages?.[source];
  if (!bucket && pages) {
    for (const key of Object.keys(pages)) {
      if (routeMatches(key, source)) { bucket = pages[key]; break; }
    }
  }
  let eff: PageEffect | null = null;
  if (bucket?.byTarget) {
    if (bucket.byTarget[dest]) {
      eff = bucket.byTarget[dest];
    } else {
      for (const tKey of Object.keys(bucket.byTarget)) {
        if (routeMatches(tKey, dest)) { eff = bucket.byTarget[tKey]; break; }
      }
    }
  }
  if (!eff) eff = bucket?.all ?? map?.__default ?? null;
  trace.fn('view-transition-css:resolve', { source, dest, preset: eff?.preset ?? null });
  return eff;
}
