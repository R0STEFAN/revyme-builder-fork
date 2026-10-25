'use client';

// PreviewRevymeSplitText.tsx — Preview sandbox adapter for RevymeSplitText.
// Fixes Layer in View trigger inside the builder's preview iframe by measuring
// the parent element container when the host wrapper has `display: contents`
// (which zeroes out bounding client rects in browser layout engines).

import * as React from 'react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';

export type SplitTextScope = { query: string } | { variant: string };

export interface SplitTextSpec {
  animationType?: 'character' | 'word' | 'line' | 'full';
  mask?: boolean;
  trigger?: 'appear' | 'view' | 'section' | 'scroll';
  viewport?: 'top' | 'middle' | 'bottom';
  replay?: boolean;
  sectionId?: string;
  disabled?: boolean;
  scrollStart?: number;
  scrollEnd?: number;
  scrollWindow?: number;
  opacity?: number;
  scale?: number;
  blur?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  skewX?: number;
  skewY?: number;
  x?: number | string;
  y?: number | string;
  delay?: number;
  transition?: {
    type?: 'spring' | 'tween';
    stiffness?: number;
    damping?: number;
    mass?: number;
    duration?: number;
    bounce?: number;
    ease?: string | number[];
    delay?: number;
  };
  responsive?: Array<{ scope: SplitTextScope; config: Partial<SplitTextSpec> }>;
}

export interface RevymeSplitTextProps {
  spec?: SplitTextSpec;
  variant?: string;
  children?: React.ReactNode;
}

const WRAP_PLAIN: React.CSSProperties = { whiteSpace: 'nowrap' };
const WRAP_MASK: React.CSSProperties = {
  whiteSpace: 'nowrap',
  display: 'inline-block',
  overflow: 'hidden',
  paddingBottom: '0.14em',
  marginBottom: '-0.14em',
};

function normalizeEase(e: string | number[] | undefined): string | number[] | undefined {
  if (e === undefined || Array.isArray(e)) return e;
  const s = String(e).trim();
  if (!s.startsWith('[')) return s;
  const n = s.replace(/[[\]]/g, '').split(',').map((v) => parseFloat(v.trim()));
  return n.length === 4 && n.every(Number.isFinite) ? n : undefined;
}

function flattenToText(node: React.ReactNode): string | null {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    let out = '';
    for (const child of node) {
      const part = flattenToText(child);
      if (part === null) return null;
      out += part;
    }
    return out;
  }
  if (React.isValidElement(node)) {
    const type = (node as React.ReactElement).type;
    if (type === 'br') return '\n';
    if (type === React.Fragment) return flattenToText((node.props as any)?.children);
    return null;
  }
  return null;
}

function useActiveScopeIndex(spec: SplitTextSpec, variant?: string): number {
  const entries = spec.responsive;
  const compute = React.useCallback((): number => {
    if (!entries || entries.length === 0) return -1;
    for (let i = 0; i < entries.length; i++) {
      const scope = entries[i].scope;
      if ('variant' in scope) {
        if (variant !== undefined && scope.variant === variant) return i;
      } else if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        if (window.matchMedia(scope.query).matches) return i;
      }
    }
    return -1;
  }, [entries, variant]);

  const [idx, setIdx] = React.useState(compute);

  React.useEffect(() => {
    setIdx(compute());
    if (!entries || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const lists = entries
      .map((e) => ('query' in e.scope ? window.matchMedia(e.scope.query) : null))
      .filter(Boolean) as MediaQueryList[];
    if (lists.length === 0) return;
    const onChange = () => setIdx(compute());
    for (const l of lists) l.addEventListener('change', onChange);
    return () => {
      for (const l of lists) l.removeEventListener('change', onChange);
    };
  }, [entries, compute]);

  return idx;
}

const RESTING: Record<string, number> = {
  opacity: 1,
  scale: 1,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  skewX: 0,
  skewY: 0,
  x: 0,
  y: 0,
};
const CHANNELS = ['opacity', 'scale', 'rotateX', 'rotateY', 'rotateZ', 'skewX', 'skewY', 'x', 'y'] as const;

function hiddenState(s: SplitTextSpec): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of CHANNELS) {
    const v = s[k];
    if (v !== undefined && v !== RESTING[k]) out[k] = v;
  }
  if (s.blur !== undefined && s.blur !== 0) out.filter = `blur(${s.blur}px)`;
  return out;
}

function visibleState(s: SplitTextSpec): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of CHANNELS) {
    const v = s[k];
    if (v !== undefined && v !== RESTING[k]) out[k] = RESTING[k];
  }
  if (s.blur !== undefined && s.blur !== 0) out.filter = 'blur(0px)';
  return out;
}

function restingOf(from: number | string, key: string): number | string {
  if (typeof from === 'number') return RESTING[key] ?? 0;
  const m = String(from).match(/^(-?[\d.]+)(.*)$/);
  return m ? `${RESTING[key] ?? 0}${m[2]}` : (RESTING[key] ?? 0);
}

interface Unit {
  key: string;
  inner: React.ReactNode;
  display: 'inline-block' | 'block';
  index: number;
}

type Node =
  | { t: 'unit'; u: Unit }
  | { t: 'br'; k: string }
  | { t: 'text'; k: string; v: string }
  | { t: 'wrap'; k: string; kids: Node[] }
  | { t: 'el'; k: string; tag: string; props: Record<string, unknown>; kids: Node[] };

const INLINE_MARK_TAGS = new Set([
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'mark',
  'code',
  'a',
]);

function buildRichNodes(
  children: React.ReactNode,
  animationType: SplitTextSpec['animationType'],
  mask: boolean,
): { nodes: Node[]; count: number; sig: string } | null {
  let i = 0;
  let sig = '';
  let key = 0;
  let bailed = false;

  type Seg =
    | { kind: 'text'; v: string }
    | { kind: 'el'; tag: string; props: Record<string, unknown>; segs: Seg[] }
    | { kind: 'br' };

  const toSegs = (node: React.ReactNode, out: Seg[]): void => {
    if (bailed || node === null || node === undefined || node === false || node === true) return;
    if (typeof node === 'string' || typeof node === 'number') {
      const v = String(node);
      out.push({ kind: 'text', v });
      sig += v;
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) toSegs(c, out);
      return;
    }
    if (React.isValidElement(node)) {
      const type = (node as React.ReactElement).type;
      if (type === React.Fragment) {
        toSegs((node.props as { children?: React.ReactNode })?.children, out);
        return;
      }
      if (type === 'br') {
        out.push({ kind: 'br' });
        sig += '\n';
        return;
      }
      if (typeof type === 'string' && INLINE_MARK_TAGS.has(type)) {
        const { children: kids, ...props } = (node.props ?? {}) as { children?: React.ReactNode } & Record<
          string,
          unknown
        >;
        const segs: Seg[] = [];
        sig += `<${type} ${JSON.stringify(props.style ?? null)}>`;
        toSegs(kids, segs);
        sig += `</${type}>`;
        out.push({ kind: 'el', tag: type, props, segs });
        return;
      }
      bailed = true;
      return;
    }
    bailed = true;
  };

  const roots: Seg[] = [];
  toSegs(children, roots);
  if (bailed) return null;

  const unit = (inner: React.ReactNode, display: 'inline-block' | 'block'): Node => {
    const u: Node = { t: 'unit', u: { key: `u${i}`, inner, display, index: i } };
    i++;
    return u;
  };

  const emit = (segs: Seg[], out: Node[]): void => {
    for (const seg of segs) {
      if (seg.kind === 'br') {
        out.push({ t: 'br', k: `br${key++}` });
      } else if (seg.kind === 'el') {
        const kids: Node[] = [];
        emit(seg.segs, kids);
        out.push({ t: 'el', k: `el${key++}`, tag: seg.tag, props: seg.props, kids });
      } else if (animationType === 'full') {
        out.push(unit(seg.v, 'inline-block'));
      } else if (animationType === 'line') {
        out.push(unit(seg.v, 'block'));
      } else {
        const words = seg.v.split(' ');
        for (let wi = 0; wi < words.length; wi++) {
          if (wi > 0) out.push({ t: 'text', k: `sp${key++}`, v: ' ' });
          const word = words[wi];
          if (!word) continue;
          if (animationType === 'word') {
            const u = unit(word, 'inline-block');
            out.push(mask ? { t: 'wrap', k: `w${key++}`, kids: [u] } : u);
          } else {
            const kids: Node[] = [];
            for (const ch of word) kids.push(unit(ch, 'inline-block'));
            out.push({ t: 'wrap', k: `w${key++}`, kids });
          }
        }
      }
    }
  };
  const nodes: Node[] = [];
  emit(roots, nodes);
  return { nodes, count: i, sig };
}

function buildNodes(
  text: string,
  animationType: SplitTextSpec['animationType'],
  mask: boolean,
): { nodes: Node[]; count: number } {
  const nodes: Node[] = [];
  let i = 0;
  const lines = text.split('\n');

  if (animationType === 'line') {
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) nodes.push({ t: 'br', k: `br${li}` });
      nodes.push({ t: 'unit', u: { key: `u${i}`, inner: lines[li], display: 'block', index: i } });
      i++;
    }
    return { nodes, count: i };
  }
  if (animationType === 'full') {
    nodes.push({ t: 'unit', u: { key: 'u0', inner: text, display: 'inline-block', index: 0 } });
    return { nodes, count: 1 };
  }

  for (let li = 0; li < lines.length; li++) {
    if (li > 0) nodes.push({ t: 'br', k: `br${li}` });
    const words = lines[li].split(' ');
    for (let wi = 0; wi < words.length; wi++) {
      if (wi > 0) nodes.push({ t: 'text', k: `sp${li}-${wi}`, v: ' ' });
      const word = words[wi];
      if (!word) continue;
      if (animationType === 'word') {
        const u: Node = { t: 'unit', u: { key: `u${i}`, inner: word, display: 'inline-block', index: i } };
        i++;
        nodes.push(mask ? { t: 'wrap', k: `w${li}-${wi}`, kids: [u] } : u);
      } else {
        const kids: Node[] = [];
        for (const ch of word) {
          kids.push({ t: 'unit', u: { key: `u${i}`, inner: ch, display: 'inline-block', index: i } });
          i++;
        }
        nodes.push({ t: 'wrap', k: `w${li}-${wi}`, kids });
      }
    }
  }
  return { nodes, count: i };
}

function ScrollUnit({
  progress,
  range,
  channels,
  display,
  children,
}: {
  progress: MotionValue<number>;
  range: [number, number];
  channels: Array<{ key: string; from: number | string; to: number | string }>;
  display: string;
  children: React.ReactNode;
}) {
  const style: Record<string, any> = { display };
  for (const c of channels) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    style[c.key] = useTransform(progress, range, [c.from as never, c.to as never]);
  }
  return <motion.span style={style as React.CSSProperties}>{children}</motion.span>;
}

const VIEWPORT_LINE: Record<string, number> = { top: 0, middle: 0.5, bottom: 1 };

/**
 * Preview-aware `usePlayed` hook.
 * Handles `display: contents` on `hostRef` by resolving to `hostRef.current.parentElement`,
 * and protects against unlaid-out zero rects before the preview iframe completes initial layout.
 */
function usePlayed(hostRef: React.RefObject<HTMLElement | null>, spec: SplitTextSpec): boolean {
  const trigger = spec.trigger ?? 'view';
  const [played, setPlayed] = React.useState(false);

  React.useEffect(() => {
    if (trigger === 'scroll') return;
    if (trigger === 'appear') {
      setPlayed(true);
      return;
    }
    const line = VIEWPORT_LINE[spec.viewport ?? 'bottom'] ?? 1;

    const check = () => {
      const host = hostRef.current;
      let el: HTMLElement | null =
        trigger === 'section'
          ? spec.sectionId
            ? document.getElementById(spec.sectionId)
            : null
          : host;
      if (!el) return;

      let r = el.getBoundingClientRect();

      // If the element has `display: contents` (or 0 dimensions), measure its parent container
      if (
        trigger !== 'section' &&
        host?.parentElement &&
        ((r.width === 0 && r.height === 0) || host.style.display === 'contents')
      ) {
        el = host.parentElement;
        r = el.getBoundingClientRect();
      }

      // If not yet laid out (0 dimensions and top/bottom at 0), wait for next layout frame
      if (r.width === 0 && r.height === 0 && r.top === 0 && r.bottom === 0) {
        return;
      }

      const h = window.innerHeight;
      const crossed = r.top <= h * line && (line < 1 || r.top < h);
      if (crossed) {
        setPlayed(true);
      } else if (spec.replay) {
        setPlayed(false);
      }
    };

    const rafId = requestAnimationFrame(check);
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [trigger, spec.viewport, spec.replay, spec.sectionId, hostRef]);

  return played;
}

export function RevymeSplitText({ spec, variant, children }: RevymeSplitTextProps): React.ReactElement {
  const base: SplitTextSpec = spec ?? {};
  const hostRef = React.useRef<HTMLSpanElement>(null);

  const scopeIdx = useActiveScopeIndex(base, variant);
  const resolved: SplitTextSpec = React.useMemo(() => {
    const r =
      scopeIdx >= 0 && base.responsive ? { ...base, ...base.responsive[scopeIdx].config } : base;
    return { ...r, animationType: base.animationType, mask: base.mask, responsive: base.responsive };
  }, [base, scopeIdx]);

  const animationType = base.animationType ?? 'character';
  const mask = !!base.mask;
  const text = flattenToText(children);

  const inView = usePlayed(hostRef, resolved);

  const startFrac = Math.min(1, Math.max(0, (resolved.scrollStart ?? 90) / 100));
  const endFrac = Math.min(1, Math.max(0, (resolved.scrollEnd ?? 35) / 100));
  const { scrollYProgress } = useScroll({
    target: hostRef,
    offset: [`start ${startFrac}`, `start ${endFrac}`] as never,
  });

  const springScroll = resolved.trigger === 'scroll' && resolved.transition?.type === 'spring';
  const sprung = useSpring(
    scrollYProgress,
    springScroll
      ? {
          stiffness: resolved.transition?.stiffness ?? 300,
          damping: resolved.transition?.damping ?? 30,
          mass: resolved.transition?.mass ?? 1,
        }
      : { stiffness: 1e6, damping: 1e6, mass: 1 },
  );
  const scrubProgress = springScroll ? sprung : scrollYProgress;

  const rich = React.useMemo(
    () => (text !== null ? null : buildRichNodes(children, animationType, mask)),
    [text === null ? 1 : 0, animationType, mask, children],
  );
  const plain = React.useMemo(
    () => buildNodes(text ?? '', animationType, mask),
    [text, animationType, mask],
  );
  const { nodes, count } = rich ?? plain;

  if (text === null && rich === null) {
    return (
      <span ref={hostRef} style={{ display: 'contents' }}>
        {children}
      </span>
    );
  }

  const isScroll = resolved.trigger === 'scroll';
  const off = !!resolved.disabled;
  const hidden = off ? {} : hiddenState(resolved);
  const visible = off ? {} : visibleState(resolved);
  const stagger = resolved.delay ?? 0.05;
  const initialDelay = resolved.transition?.delay ?? 0;
  const tr = resolved.transition
    ? ({ ...resolved.transition, ease: normalizeEase(resolved.transition.ease), delay: undefined } as any)
    : ({ type: 'spring' as const, stiffness: 300, damping: 30 } as any);

  const channels =
    isScroll && !off
      ? Object.entries(hidden).map(([key, from]) => ({
          key,
          from: from as number | string,
          to: key === 'filter' ? 'blur(0px)' : restingOf(from as number | string, key),
        }))
      : [];
  const fingerprint = channels.map((c) => c.key).join('|');

  const renderUnit = (u: Unit): React.ReactElement => {
    if (isScroll) {
      const w =
        resolved.scrollWindow === undefined
          ? 0.4
          : resolved.scrollWindow <= 0
          ? 1 / Math.max(1, count)
          : Math.min(1, resolved.scrollWindow);
      const start = count > 1 ? Math.round((u.index / (count - 1)) * (1 - w) * 1000) / 1000 : 0;
      const end = Math.min(1, Math.round((start + w) * 1000) / 1000);
      return (
        <ScrollUnit
          key={`${fingerprint}#${u.key}`}
          progress={scrubProgress}
          range={[start, end]}
          channels={channels}
          display={u.display}
        >
          {u.inner}
        </ScrollUnit>
      );
    }
    return (
      <motion.span
        key={u.key}
        style={{ display: u.display }}
        initial={hidden}
        animate={inView ? visible : hidden}
        transition={{ ...tr, delay: Math.round((initialDelay + u.index * stagger) * 1000) / 1000 }}
      >
        {u.inner}
      </motion.span>
    );
  };

  const render = (n: Node): React.ReactNode => {
    if (n.t === 'br') return <br key={n.k} />;
    if (n.t === 'text') return n.v;
    if (n.t === 'wrap') return <span key={n.k} style={mask ? WRAP_MASK : WRAP_PLAIN}>{n.kids.map(render)}</span>;
    if (n.t === 'el') return React.createElement(n.tag, { ...n.props, key: n.k }, n.kids.map(render));
    return renderUnit(n.u);
  };

  return (
    <span ref={hostRef} style={{ display: 'contents' }}>
      {nodes.map(render)}
    </span>
  );
}

export { RevymeSplitText as PreviewRevymeSplitText };
export default RevymeSplitText;
