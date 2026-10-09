// Carousel — Code component template (one connected node at a time, with slide nav).
//
// Multi-slot CONTAINER: `children` is an infinite slot — each connected
// canvas node is one slide. Built on framer-motion so the slide change can
// honour a real Motion transition (Spring / Ease / Instant) chosen via the
// `transition` control. Granular controls organised into popup GROUPS
// (Effects / Arrows / Dots) via the @controls `group` type.
//
// Animated via AnimatePresence with monotonic page indexing so slide transitions
// always advance forward seamlessly in an infinite loop without rewind glitches.

export const CAROUSEL_COMPONENT = `'use client';

/** @label "Carousel" */
/** @comment "A slideshow of connected nodes with arrows, dots, autoplay and a Motion transition. Connect canvas nodes as slides." */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "children": { "type": "slot", "label": "Slides", "slotMax": "infinite" },
  "direction": { "type": "select", "label": "Direction", "default": "horizontal", "options": [
    { "label": "Horizontal", "value": "horizontal" },
    { "label": "Vertical", "value": "vertical" }
  ]},
  "swipe": { "type": "toggle", "label": "Swipe / Drag", "default": true },
  "autoplay": { "type": "toggle", "label": "Auto Play", "default": true },
  "interval": { "type": "number", "label": "Interval", "min": 1, "max": 12, "step": 0.5, "default": 4 },
  "loop": { "type": "toggle", "label": "Loop", "default": true },
  "pauseOnHover": { "type": "toggle", "label": "Pause on Hover", "default": true },
  "padding": { "type": "number", "label": "Padding", "min": 0, "max": 120, "step": 4, "default": 0 },
  "radius": { "type": "number", "label": "Radius", "min": 0, "max": 80, "step": 2, "default": 0 },
  "transitionConfig": { "type": "transition", "label": "Transition", "default": { "type": "spring", "stiffness": "200", "damping": "30", "mass": "1" } },
  "effects": { "type": "group", "label": "Effects", "controls": {
    "effectOpacity": { "type": "number", "label": "Opacity", "min": 0, "max": 1, "step": 0.05, "default": 1 },
    "effectScale": { "type": "number", "label": "Scale", "min": 0.4, "max": 1, "step": 0.05, "default": 1 },
    "effectRotate": { "type": "number", "label": "Rotate", "min": -90, "max": 90, "step": 5, "default": 0 },
    "effectPerspective": { "type": "number", "label": "Perspective", "min": 200, "max": 3000, "step": 100, "default": 1200 }
  }},
  "arrows": { "type": "group", "label": "Arrows", "controls": {
    "arrowsShow": { "type": "toggle", "label": "Show", "default": true },
    "arrowsFill": { "type": "color", "label": "Fill", "default": "rgba(0,0,0,0.45)" },
    "arrowsColor": { "type": "color", "label": "Icon", "default": "#ffffff" },
    "arrowsSize": { "type": "number", "label": "Size", "min": 20, "max": 72, "step": 2, "default": 36 },
    "arrowsRadius": { "type": "number", "label": "Radius", "min": 0, "max": 50, "step": 2, "default": 50 }
  }},
  "dots": { "type": "group", "label": "Dots", "controls": {
    "dotsShow": { "type": "toggle", "label": "Show", "default": true },
    "dotsSize": { "type": "number", "label": "Size", "min": 4, "max": 24, "step": 1, "default": 8 },
    "dotsGap": { "type": "number", "label": "Gap", "min": 2, "max": 24, "step": 1, "default": 8 },
    "dotsColor": { "type": "color", "label": "Fill", "default": "rgba(255,255,255,0.4)" },
    "dotsActiveColor": { "type": "color", "label": "Active", "default": "#ffffff" }
  }}
} */

import { useRef, useEffect, useState, Children } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

// Convert a stored transition object into a framer-motion transition.
function toMotionTransition(raw) {
  let cfg = raw;
  if (typeof raw === 'string') {
    try { cfg = JSON.parse(raw); } catch (e) { cfg = null; }
  }
  if (!cfg || typeof cfg !== 'object') return { type: 'spring', stiffness: 200, damping: 30, mass: 1 };
  if (cfg.type === 'instant') return { duration: 0 };
  if (cfg.type === 'spring') {
    if (cfg.stiffness != null) {
      return { type: 'spring', stiffness: Number(cfg.stiffness), damping: Number(cfg.damping), mass: Number(cfg.mass || 1), delay: Number(cfg.delay || 0) };
    }
    return { type: 'spring', duration: Number(cfg.duration || 0.5), bounce: Number(cfg.bounce || 0.25), delay: Number(cfg.delay || 0) };
  }
  let ease = cfg.ease || 'easeInOut';
  if (typeof ease === 'string' && ease.charAt(0) === '[') {
    try { ease = JSON.parse(ease); } catch (e) { ease = 'easeInOut'; }
  }
  return { type: 'tween', duration: Number(cfg.duration || 0.45), ease: ease, delay: Number(cfg.delay || 0) };
}

function Carousel({
  direction = 'horizontal', swipe = true, autoplay = true, interval = 4, loop = true,
  pauseOnHover = true, padding = 0, radius = 0,
  transitionConfig = '{"type":"spring","stiffness":"200","damping":"30","mass":"1"}',
  effectOpacity = 1, effectScale = 1, effectRotate = 0, effectPerspective = 1200,
  arrowsShow = true, arrowsFill = 'rgba(0,0,0,0.45)', arrowsColor = '#ffffff',
  arrowsSize = 36, arrowsRadius = 50,
  dotsShow = true, dotsSize = 8, dotsGap = 8,
  dotsColor = 'rgba(255,255,255,0.4)', dotsActiveColor = '#ffffff',
  children, ...props
}) {
  const vertical = direction === 'vertical';
  const slides = Children.toArray(children);
  const count = slides.length;
  const isSwipe = swipe !== false && swipe !== 'false';
  const showArrows = arrowsShow !== false && arrowsShow !== 'false';
  const showDots = dotsShow !== false && dotsShow !== 'false';
  const isAutoplay = autoplay !== false && autoplay !== 'false';
  const isLoop = loop !== false && loop !== 'false';
  const isPauseOnHover = pauseOnHover !== false && pauseOnHover !== 'false';

  const [[page, dir], setPage] = useState([0, 0]);
  const containerRef = useRef(null);
  const pausedRef = useRef(false);
  const transition = toMotionTransition(transitionConfig);
  // No autoplay on the editor canvas — index stays at 0 and framer-motion
  // doesn't animate (initial = animate), so slides sit still.
  const isStatic = useStaticCanvas();

  const activeIndex = count > 0 ? ((page % count) + count) % count : 0;

  // Neutralise connected canvas-node positioning so each slide centres.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    Array.from(container.children).forEach(function (wrapper) {
      const c = wrapper.firstElementChild;
      if (!c) return;
      const s = c.style;
      s.position = 'relative';
      s.left = 'auto'; s.top = 'auto'; s.right = 'auto'; s.bottom = 'auto';
      s.margin = '0';
    });
  }, [children, page]);

  const goNext = function () {
    if (count < 2) return;
    if (!isLoop && activeIndex === count - 1) return;
    setPage(([p]) => [p + 1, 1]);
  };

  const goPrev = function () {
    if (count < 2) return;
    if (!isLoop && activeIndex === 0) return;
    setPage(([p]) => [p - 1, -1]);
  };

  const goToSlide = function (targetIndex) {
    if (targetIndex === activeIndex || count < 2) return;
    if (isLoop) {
      if (activeIndex === count - 1 && targetIndex === 0) {
        setPage(([p]) => [p + 1, 1]);
        return;
      }
      if (activeIndex === 0 && targetIndex === count - 1) {
        setPage(([p]) => [p - 1, -1]);
        return;
      }
    }
    const diff = targetIndex - activeIndex;
    setPage(([p]) => [p + diff, diff > 0 ? 1 : -1]);
  };

  const handleDragEnd = function (event, info) {
    if (!isSwipe || count < 2) return;
    const offset = vertical ? info.offset.y : info.offset.x;
    const velocity = vertical ? info.velocity.y : info.velocity.x;

    if (offset < -50 || velocity < -400) {
      goNext();
    } else if (offset > 50 || velocity > 400) {
      goPrev();
    }
  };

  // Autoplay — advances one slide every "interval" seconds (paused on hover).
  // Skipped on the editor canvas (isStatic) so the slideshow doesn't loop.
  useEffect(() => {
    if (isStatic || !isAutoplay || count < 2) return;
    const id = setInterval(function () {
      if (pausedRef.current) return;
      goNext();
    }, interval * 1000);
    return function () { clearInterval(id); };
  }, [isAutoplay, interval, count, isStatic, isLoop, activeIndex]);

  if (count === 0) {
    return (
      <div
        data-id={props['data-id']}
        data-name={props['data-name']}
        style={{
          position: 'relative', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: '8px', padding: '20px', textAlign: 'center',
          background: '#141414', border: '1px dashed rgba(255,255,255,0.14)', ...props.style }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A855F7"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="13" height="12" rx="1.5" />
          <line x1="19" y1="9" x2="19" y2="15" />
          <line x1="22" y1="11" x2="22" y2="13" />
        </svg>
        <div style={{ fontWeight: 700, fontSize: '15px', color: '#e5e5e5' }}>Connect Content</div>
        <div style={{ fontSize: '13px', color: '#8a8a8a' }}>Add slides to the carousel</div>
      </div>
    );
  }

  const variants = {
    enter: function (d) {
      return {
        x: vertical ? 0 : (d > 0 ? '100%' : (d < 0 ? '-100%' : 0)),
        y: vertical ? (d > 0 ? '100%' : (d < 0 ? '-100%' : 0)) : 0,
        opacity: effectOpacity,
        scale: effectScale,
        rotateY: vertical ? 0 : (d > 0 ? effectRotate : -effectRotate),
        rotateX: vertical ? (d > 0 ? -effectRotate : effectRotate) : 0,
      };
    },
    center: {
      x: 0,
      y: 0,
      opacity: 1,
      scale: 1,
      rotateY: 0,
      rotateX: 0,
    },
    exit: function (d) {
      return {
        x: vertical ? 0 : (d < 0 ? '100%' : '-100%'),
        y: vertical ? (d < 0 ? '100%' : '-100%') : 0,
        opacity: effectOpacity,
        scale: effectScale,
        rotateY: vertical ? 0 : (d < 0 ? effectRotate : -effectRotate),
        rotateX: vertical ? (d < 0 ? -effectRotate : effectRotate) : 0,
      };
    },
  };

  const arrowStyle = function (side) {
    const base = {
      position: 'absolute', zIndex: 3, cursor: 'pointer', border: 'none',
      width: arrowsSize + 'px', height: arrowsSize + 'px',
      borderRadius: arrowsRadius + '%',
      background: arrowsFill, color: arrowsColor,
      fontSize: Math.round(arrowsSize * 0.52) + 'px', lineHeight: '1',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    };
    if (!isLoop) {
      if (side === 'prev' && activeIndex === 0) {
        base.opacity = 0.35;
        base.cursor = 'default';
      }
      if (side === 'next' && activeIndex === count - 1) {
        base.opacity = 0.35;
        base.cursor = 'default';
      }
    }
    if (vertical) {
      base.left = '50%';
      base.transform = 'translateX(-50%)';
      if (side === 'prev') base.top = '12px'; else base.bottom = '12px';
    } else {
      base.top = '50%';
      base.transform = 'translateY(-50%)';
      if (side === 'prev') base.left = '12px'; else base.right = '12px';
    }
    return base;
  };

  return (
    <div
      data-id={props['data-id']}
      data-name={props['data-name']}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: radius + 'px', boxSizing: 'border-box', padding: padding + 'px', ...props.style }}
      onMouseEnter={() => (pausedRef.current = isPauseOnHover)}
      onMouseLeave={() => (pausedRef.current = false)}
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative', width: '100%', height: '100%',
          overflow: 'hidden', borderRadius: radius + 'px', perspective: effectPerspective + 'px',
        }}
      >
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={page}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            drag={isSwipe && count > 1 ? (vertical ? 'y' : 'x') : false}
            dragConstraints={vertical ? { top: 0, bottom: 0 } : { left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={handleDragEnd}
            whileTap={{ cursor: isSwipe && count > 1 ? (vertical ? 'ns-resize' : 'grabbing') : 'default' }}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              userSelect: 'none',
              touchAction: vertical ? 'pan-x' : 'pan-y',
              cursor: isSwipe && count > 1 ? (vertical ? 'ns-resize' : 'grab') : 'default',
            }}
          >
            {slides[activeIndex]}
          </motion.div>
        </AnimatePresence>
      </div>

      {showArrows && count > 1 && (
        <>
          <button onClick={() => goPrev()} style={arrowStyle('prev')} aria-label="Previous">
            {vertical ? '\\u2303' : '\\u2039'}
          </button>
          <button onClick={() => goNext()} style={arrowStyle('next')} aria-label="Next">
            {vertical ? '\\u2304' : '\\u203A'}
          </button>
        </>
      )}

      {showDots && count > 1 && (
        <div style={{
          position: 'absolute', zIndex: 3, display: 'flex', gap: dotsGap + 'px',
          flexDirection: vertical ? 'column' : 'row',
          bottom: vertical ? 'auto' : '12px',
          top: vertical ? '50%' : 'auto',
          right: vertical ? '12px' : 'auto',
          left: vertical ? 'auto' : '50%',
          transform: vertical ? 'translateY(-50%)' : 'translateX(-50%)',
        }}>
          {slides.map(function (_, i) {
            return (
              <button
                key={i}
                onClick={() => goToSlide(i)}
                aria-label={'Go to slide ' + (i + 1)}
                style={{
                  width: dotsSize + 'px', height: dotsSize + 'px', borderRadius: '50%',
                  border: 'none', padding: 0, cursor: 'pointer',
                  background: i === activeIndex ? dotsActiveColor : dotsColor,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default withResponsiveProps(Carousel);
`;
