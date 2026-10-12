// EmblaCarousel — Code component template for fluid, multi-slide, marquee,
// and external-trigger carousels powered by Embla Carousel (v8).

export const EMBLA_CAROUSEL_COMPONENT = `'use client';

/** @label "Embla Carousel" */
/** @comment "A fluid, highly customizable slider powered by Embla Carousel with multi-slide, marquee, and external trigger support." */
/** @defaultWidth 800 */
/** @defaultHeight 450 */
/** @controls {
  "children": { "type": "slot", "label": "Slides", "slotMax": "infinite" },

  "layout": { "type": "group", "label": "Layout & Slides", "controls": {
    "visibleSlides": { "type": "select", "label": "Visible Slides", "default": "1", "options": [
      { "label": "1 Slide", "value": "1" },
      { "label": "2 Slides", "value": "2" },
      { "label": "3 Slides", "value": "3" },
      { "label": "4 Slides", "value": "4" },
      { "label": "5 Slides", "value": "5" },
      { "label": "6 Slides", "value": "6" },
      { "label": "Custom (Peeking)", "value": "custom" },
      { "label": "Auto (Content)", "value": "auto" }
    ]},
    "customSlideWidth": { "type": "text", "label": "Slide Width", "default": "80%" },
    "gap": { "type": "number", "label": "Slide Gap", "min": 0, "max": 120, "step": 2, "default": 16 },
    "aspectRatio": { "type": "select", "label": "Aspect Ratio", "default": "fill", "options": [
      { "label": "Fill (Match Carousel)", "value": "fill" },
      { "label": "16:9 (Widescreen)", "value": "16/9" },
      { "label": "4:3 (Standard)", "value": "4/3" },
      { "label": "1:1 (Square)", "value": "1/1" },
      { "label": "3:4 (Portrait)", "value": "3/4" },
      { "label": "9:16 (Vertical / Stories)", "value": "9/16" },
      { "label": "Auto (Content)", "value": "auto" }
    ]},
    "objectFit": { "type": "select", "label": "Image Fit", "default": "cover", "options": [
      { "label": "Cover (Crop & Fill)", "value": "cover" },
      { "label": "Contain (Fit Inside)", "value": "contain" },
      { "label": "Fill (Stretch)", "value": "fill" },
      { "label": "Original (None)", "value": "none" }
    ]},
    "objectPosition": { "type": "select", "label": "Image Position", "default": "center", "options": [
      { "label": "Center", "value": "center" },
      { "label": "Top", "value": "top" },
      { "label": "Bottom", "value": "bottom" },
      { "label": "Left", "value": "left" },
      { "label": "Right", "value": "right" }
    ]},
    "slideRadius": { "type": "number", "label": "Slide Radius", "min": 0, "max": 80, "step": 2, "default": 0 },
    "align": { "type": "select", "label": "Alignment", "default": "start", "options": [
      { "label": "Start", "value": "start" },
      { "label": "Center", "value": "center" },
      { "label": "End", "value": "end" }
    ]},
    "axis": { "type": "select", "label": "Axis", "default": "horizontal", "options": [
      { "label": "Horizontal", "value": "horizontal" },
      { "label": "Vertical", "value": "vertical" }
    ]},
    "direction": { "type": "select", "label": "Direction", "default": "ltr", "options": [
      { "label": "Left to Right (LTR)", "value": "ltr" },
      { "label": "Right to Left (RTL)", "value": "rtl" }
    ]}
  }},

  "scroll": { "type": "group", "label": "Scroll & Physics", "controls": {
    "scrollMode": { "type": "select", "label": "Scroll Mode", "default": "single", "options": [
      { "label": "Single Slide", "value": "single" },
      { "label": "Full Page (All Visible)", "value": "page" },
      { "label": "Custom Count", "value": "custom" }
    ]},
    "slidesToScrollCustom": { "type": "number", "label": "Scroll Count", "min": 1, "max": 10, "step": 1, "default": 1 },
    "loop": { "type": "toggle", "label": "Infinite Loop", "default": true },
    "dragFree": { "type": "select", "label": "Drag Momentum", "default": "none", "options": [
      { "label": "Off (Snap Only)", "value": "none" },
      { "label": "Free Momentum", "value": "free" },
      { "label": "Free + Snap", "value": "snap" }
    ]},
    "containScroll": { "type": "select", "label": "Contain Scroll", "default": "trimSnaps", "options": [
      { "label": "Trim Snaps", "value": "trimSnaps" },
      { "label": "Keep Snaps", "value": "keepSnaps" },
      { "label": "None", "value": "none" }
    ]},
    "duration": { "type": "number", "label": "Snap Speed", "min": 10, "max": 60, "step": 1, "default": 25 },
    "wheelGestures": { "type": "toggle", "label": "Wheel Gestures", "default": false },
    "autoHeight": { "type": "toggle", "label": "Auto Height", "default": false }
  }},

  "motion": { "type": "group", "label": "Autoplay & Motion", "controls": {
    "autoplayMode": { "type": "select", "label": "Auto Motion", "default": "off", "options": [
      { "label": "Off", "value": "off" },
      { "label": "Step Autoplay", "value": "autoplay" },
      { "label": "Continuous Marquee", "value": "autoScroll" }
    ]},
    "autoplayDelay": { "type": "number", "label": "Step Interval (s)", "min": 1, "max": 15, "step": 0.5, "default": 4 },
    "pauseOnHover": { "type": "toggle", "label": "Pause on Hover", "default": true },
    "marqueeSpeed": { "type": "number", "label": "Marquee Speed", "min": 0.5, "max": 10, "step": 0.5, "default": 2 },
    "marqueeDirection": { "type": "select", "label": "Marquee Direction", "default": "forward", "options": [
      { "label": "Forward", "value": "forward" },
      { "label": "Backward", "value": "backward" }
    ]},
    "effect": { "type": "select", "label": "Transition Effect", "default": "slide", "options": [
      { "label": "Slide", "value": "slide" },
      { "label": "Fade", "value": "fade" }
    ]}
  }},

  "arrows": { "type": "group", "label": "Built-in Arrows", "controls": {
    "arrowsShow": { "type": "toggle", "label": "Show Arrows", "default": true },
    "arrowsPosition": { "type": "select", "label": "Position", "default": "inside-sides", "options": [
      { "label": "Inside Sides", "value": "inside-sides" },
      { "label": "Outside Sides", "value": "outside-sides" },
      { "label": "Bottom Left", "value": "bottom-left" },
      { "label": "Bottom Center", "value": "bottom-center" },
      { "label": "Bottom Right", "value": "bottom-right" }
    ]},
    "arrowsOffset": { "type": "number", "label": "Offset (px)", "min": -60, "max": 60, "step": 2, "default": 16 },
    "arrowsSize": { "type": "number", "label": "Button Size", "min": 24, "max": 80, "step": 2, "default": 40 },
    "arrowsRadius": { "type": "number", "label": "Corner Radius (%)", "min": 0, "max": 50, "step": 5, "default": 50 },
    "arrowsFill": { "type": "color", "label": "Background", "default": "rgba(0,0,0,0.5)" },
    "arrowsColor": { "type": "color", "label": "Icon Color", "default": "#ffffff" }
  }},

  "dots": { "type": "group", "label": "Pagination & Indicators", "controls": {
    "dotsShow": { "type": "toggle", "label": "Show Indicators", "default": true },
    "dotsFormat": { "type": "select", "label": "Format", "default": "dots", "options": [
      { "label": "Dots", "value": "dots" },
      { "label": "Pills / Bars", "value": "pills" },
      { "label": "Fraction (01 / 05)", "value": "fraction" },
      { "label": "Progress Bar", "value": "progressBar" }
    ]},
    "dotsPosition": { "type": "select", "label": "Position", "default": "bottom-center", "options": [
      { "label": "Bottom Center", "value": "bottom-center" },
      { "label": "Bottom Left", "value": "bottom-left" },
      { "label": "Top Right", "value": "top-right" }
    ]},
    "dotsSize": { "type": "number", "label": "Size / Height", "min": 4, "max": 24, "step": 1, "default": 8 },
    "dotsGap": { "type": "number", "label": "Gap", "min": 2, "max": 24, "step": 1, "default": 8 },
    "dotsColor": { "type": "color", "label": "Inactive Color", "default": "rgba(255,255,255,0.35)" },
    "dotsActiveColor": { "type": "color", "label": "Active Color", "default": "#ffffff" }
  }},

  "activeSlideIndex": { "type": "number", "label": "Active Slide (Canvas)", "min": 0, "max": 50, "step": 1, "default": 0 }
} */

import { useEffect, useState, useCallback, Children, useRef, isValidElement, cloneElement } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import AutoScroll from 'embla-carousel-auto-scroll';
import Fade from 'embla-carousel-fade';
import AutoHeight from 'embla-carousel-auto-height';
import { wheelGestures } from 'embla-carousel-wheel-gestures';
import { withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

function EmblaCarousel({
  visibleSlides = '1',
  customSlideWidth = '80%',
  gap = 16,
  aspectRatio = 'fill',
  objectFit = 'cover',
  objectPosition = 'center',
  slideRadius = 0,
  align = 'start',
  axis = 'horizontal',
  direction = 'ltr',

  scrollMode = 'single',
  slidesToScrollCustom = 1,
  loop = true,
  dragFree = 'none',
  containScroll = 'trimSnaps',
  duration = 25,
  wheelGestures: enableWheelGestures = false,
  autoHeight = false,

  autoplayMode = 'off',
  autoplayDelay = 4,
  pauseOnHover = true,
  marqueeSpeed = 2,
  marqueeDirection = 'forward',
  effect = 'slide',

  arrowsShow = true,
  arrowsPosition = 'inside-sides',
  arrowsOffset = 16,
  arrowsSize = 40,
  arrowsRadius = 50,
  arrowsFill = 'rgba(0,0,0,0.5)',
  arrowsColor = '#ffffff',

  dotsShow = true,
  dotsFormat = 'dots',
  dotsPosition = 'bottom-center',
  dotsSize = 8,
  dotsGap = 8,
  dotsColor = 'rgba(255,255,255,0.35)',
  dotsActiveColor = '#ffffff',

  activeSlideIndex = 0,

  children,
  ...props
}) {
  const isStatic = useStaticCanvas();
  const slides = Children.toArray(children);
  const count = slides.length;

  const isVertical = axis === 'vertical';
  const isLoop = loop !== false && loop !== 'false';
  const isPauseOnHover = pauseOnHover !== false && pauseOnHover !== 'false';
  const isAutoHeight = autoHeight === true || autoHeight === 'true';
  const isWheelGestures = enableWheelGestures === true || enableWheelGestures === 'true';
  const showArrows = arrowsShow !== false && arrowsShow !== 'false';
  const showDots = dotsShow !== false && dotsShow !== 'false';

  const emblaOptions = {
    loop: isLoop,
    align,
    axis: isVertical ? 'y' : 'x',
    direction,
    duration: Number(duration || 25),
    containScroll: containScroll === 'none' ? false : containScroll,
    slidesToScroll: scrollMode === 'page' ? 'auto' : (scrollMode === 'custom' ? Number(slidesToScrollCustom || 1) : 1),
    dragFree: dragFree === 'none' ? false : (dragFree === 'snap' ? 'snap' : true),
  };

  const plugins = [];
  if (autoplayMode === 'autoplay' && !isStatic) {
    plugins.push(Autoplay({
      delay: Number(autoplayDelay || 4) * 1000,
      stopOnMouseEnter: isPauseOnHover,
      stopOnInteraction: false,
    }));
  }
  if (autoplayMode === 'autoScroll' && !isStatic) {
    plugins.push(AutoScroll({
      speed: Number(marqueeSpeed || 2),
      direction: marqueeDirection || 'forward',
      stopOnMouseEnter: isPauseOnHover,
      stopOnInteraction: false,
    }));
  }
  if (effect === 'fade') {
    plugins.push(Fade());
  }
  if (isAutoHeight) {
    plugins.push(AutoHeight());
  }
  if (isWheelGestures) {
    plugins.push(wheelGestures());
  }

  const [emblaRef, emblaApi] = useEmblaCarousel(emblaOptions, plugins);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [scrollSnaps, setScrollSnaps] = useState([]);
  const [progress, setProgress] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanPrev(emblaApi.canScrollPrev());
    setCanNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  const onScroll = useCallback(() => {
    if (!emblaApi) return;
    setProgress(Math.max(0, Math.min(1, emblaApi.scrollProgress())));
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    setScrollSnaps(emblaApi.scrollSnapList());
    onSelect();
    onScroll();
    const onReInit = () => {
      setScrollSnaps(emblaApi.scrollSnapList());
      onSelect();
      onScroll();
    };
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onReInit);
    emblaApi.on('scroll', onScroll);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onReInit);
      emblaApi.off('scroll', onScroll);
    };
  }, [emblaApi, onSelect, onScroll]);

  // Active slide index sync (in canvas mode)
  useEffect(() => {
    if (isStatic && emblaApi && typeof activeSlideIndex === 'number') {
      emblaApi.scrollTo(activeSlideIndex);
    }
  }, [isStatic, emblaApi, activeSlideIndex]);

  // Root ref & external trigger listener and button state sync
  const rootRef = useRef(null);
  const carouselId = props['data-id'] || props.id || 'embla';

  // Live container resize observer: automatically recalibrates Embla's slide metrics,
  // track transforms, and snaps whenever the slider is resized on the canvas or window reflows.
  useEffect(() => {
    if (!emblaApi || !rootRef.current) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      try {
        emblaApi.reInit();
      } catch (e) {}
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [emblaApi]);

  // Neutralize lingering canvas positioning (absolute, left, top) on slot children
  // and pin elements to fill the slide inner card so aspect ratio never collapses.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const inners = root.querySelectorAll('[data-embla-slide-inner]');
    inners.forEach((inner) => {
      Array.from(inner.children).forEach((c) => {
        if (c instanceof HTMLElement) {
          c.style.setProperty('position', 'absolute', 'important');
          c.style.setProperty('top', '0', 'important');
          c.style.setProperty('left', '0', 'important');
          c.style.setProperty('right', '0', 'important');
          c.style.setProperty('bottom', '0', 'important');
          c.style.setProperty('margin', '0', 'important');
          c.style.setProperty('width', '100%', 'important');
          c.style.setProperty('height', '100%', 'important');
          c.style.setProperty('max-width', '100%', 'important');
          c.style.setProperty('max-height', '100%', 'important');
          c.style.setProperty('box-sizing', 'border-box', 'important');
        }
      });
      const imgs = inner.querySelectorAll('img');
      imgs.forEach((img) => {
        img.style.setProperty('position', 'absolute', 'important');
        img.style.setProperty('top', '0', 'important');
        img.style.setProperty('left', '0', 'important');
        img.style.setProperty('right', '0', 'important');
        img.style.setProperty('bottom', '0', 'important');
        img.style.setProperty('width', '100%', 'important');
        img.style.setProperty('height', '100%', 'important');
        img.style.setProperty('max-width', '100%', 'important');
        img.style.setProperty('max-height', '100%', 'important');
        img.style.setProperty('object-fit', objectFit || 'cover', 'important');
        img.style.setProperty('object-position', objectPosition || 'center', 'important');
        img.style.setProperty('display', 'block', 'important');
      });
    });
  }, [children, objectFit, objectPosition, aspectRatio, count]);

  const renderSlideChild = (child) => {
    if (!isValidElement(child)) return child;
    const childStyle = (child.props && child.props.style) || {};
    return cloneElement(child, {
      style: {
        ...childStyle,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        margin: 0,
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        objectFit: objectFit || 'cover',
        objectPosition: objectPosition || 'center',
      },
    });
  };

  useEffect(() => {
    if (!emblaApi) return;

    const updateTriggers = () => {
      try {
        const canP = emblaApi.canScrollPrev();
        const canN = emblaApi.canScrollNext();
        const triggers = document.querySelectorAll('[data-carousel-target="' + carouselId + '"]');
        triggers.forEach((el) => {
          const action = el.getAttribute('data-carousel-action');
          const isDisabled = action === 'prev' ? !canP : (action === 'next' ? !canN : false);
          if ('disabled' in el) {
            el.disabled = isDisabled;
          }
          el.setAttribute('aria-disabled', String(isDisabled));
          if (isDisabled) {
            el.setAttribute('data-disabled', 'true');
          } else {
            el.removeAttribute('data-disabled');
          }
        });
      } catch (e) {}
    };

    const handleClick = (e) => {
      const target = e.target;
      const el = target && target.closest ? target.closest('[data-carousel-target="' + carouselId + '"]') : null;
      if (!el) return;
      const action = el.getAttribute('data-carousel-action');
      if (action === 'prev') {
        emblaApi.scrollPrev();
      } else if (action === 'next') {
        emblaApi.scrollNext();
      }
    };

    document.addEventListener('click', handleClick);
    emblaApi.on('select', updateTriggers);
    emblaApi.on('reInit', updateTriggers);
    updateTriggers();

    return () => {
      document.removeEventListener('click', handleClick);
      emblaApi.off('select', updateTriggers);
      emblaApi.off('reInit', updateTriggers);
    };
  }, [emblaApi, carouselId]);

  if (count === 0) {
    return (
      <div
        data-id={props['data-id']}
        data-name={props['data-name']}
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '20px',
          textAlign: 'center',
          background: '#141414',
          border: '1px dashed rgba(255,255,255,0.14)',
          width: '100%',
          height: '100%',
          ...props.style,
        }}
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

  let flexBasis = '0 0 100%';
  const numGap = Number(gap || 0);
  if (visibleSlides === '1') {
    flexBasis = '0 0 100%';
  } else if (visibleSlides === 'custom') {
    flexBasis = '0 0 ' + (customSlideWidth || '80%');
  } else if (visibleSlides === 'auto') {
    flexBasis = '0 0 auto';
  } else {
    const n = Number(visibleSlides) || 1;
    if (numGap > 0) {
      flexBasis = '0 0 calc((100% - ' + ((n - 1) * numGap) + 'px) / ' + n + ')';
    } else {
      flexBasis = '0 0 calc(100% / ' + n + ')';
    }
  }

  const isFill = !aspectRatio || aspectRatio === 'fill';
  const isAutoRatio = aspectRatio === 'auto';
  const radiusPx = Number(slideRadius || 0);

  const slideOuterStyle = {
    flex: flexBasis,
    minWidth: 0,
    minHeight: 0,
    height: isVertical ? 'auto' : '100%',
    width: isVertical ? '100%' : undefined,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    boxSizing: 'border-box',
    ...(isVertical
      ? { marginBottom: numGap + 'px' }
      : { marginRight: numGap + 'px' }),
  };

  const isFitHeight = !props.style?.height ||
    props.style.height === 'fit-content' ||
    props.style.height === 'auto' ||
    props.style.height === 'min-content' ||
    props.style.height === 'max-content';

  const slideInnerStyle = {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radiusPx > 0 ? radiusPx + 'px' : undefined,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(isFill || isAutoRatio
      ? {
          width: '100%',
          height: isFitHeight ? 'auto' : '100%',
          aspectRatio: isFitHeight ? '16/9' : undefined,
          minHeight: isFitHeight ? '180px' : undefined,
        }
      : {
          aspectRatio: aspectRatio,
          width: isVertical ? 'auto' : '100%',
          height: isVertical ? '100%' : 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
        }),
  };

  const numArrowsOffset = Number(arrowsOffset || 0);
  const numArrowsSize = Number(arrowsSize || 40);
  const numDotsSize = Number(dotsSize || 8);

  const hasBottomArrows = showArrows && count > 1 && !isVertical &&
    (arrowsPosition === 'bottom-left' || arrowsPosition === 'bottom-center' || arrowsPosition === 'bottom-right');
  const hasBottomDots = showDots && count > 1 && !isVertical &&
    (dotsPosition === 'bottom-center' || dotsPosition === 'bottom-left');
  const hasBottomBar = hasBottomArrows || hasBottomDots;

  const arrowsInsideSides = showArrows && count > 1 && arrowsPosition === 'inside-sides';
  const padSides = arrowsInsideSides && !isVertical ? (numArrowsSize + numArrowsOffset + 8) : 0;
  const padTopBottomSides = arrowsInsideSides && isVertical ? (numArrowsSize + numArrowsOffset + 8) : 0;

  const arrowBtnStyle = (disabled) => ({
    width: arrowsSize + 'px',
    height: arrowsSize + 'px',
    borderRadius: arrowsRadius + '%',
    background: arrowsFill,
    color: arrowsColor,
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: Math.round(arrowsSize * 0.52) + 'px',
    lineHeight: '1',
    userSelect: 'none',
    transition: 'opacity 0.2s ease',
    padding: 0,
    zIndex: 20,
  });

  const prevDisabled = !isLoop && !canPrev;
  const nextDisabled = !isLoop && !canNext;

  const renderArrowButtons = () => (
    <>
      <button
        onClick={() => emblaApi?.scrollPrev()}
        disabled={prevDisabled}
        style={arrowBtnStyle(prevDisabled)}
        aria-label="Previous"
      >
        {isVertical ? '\\u2303' : '\\u2039'}
      </button>
      <button
        onClick={() => emblaApi?.scrollNext()}
        disabled={nextDisabled}
        style={arrowBtnStyle(nextDisabled)}
        aria-label="Next"
      >
        {isVertical ? '\\u2304' : '\\u203A'}
      </button>
    </>
  );

  const renderFloatingArrows = () => {
    if (!showArrows || count <= 1) return null;
    if (arrowsPosition !== 'inside-sides' && arrowsPosition !== 'outside-sides' && !isVertical) return null;
    const isInside = arrowsPosition === 'inside-sides';
    const offsetVal = Number(arrowsOffset || 0);
    const sizeVal = Number(arrowsSize || 40);

    const prevPosStyle = {
      position: 'absolute',
      zIndex: 20,
      ...(isVertical
        ? {
            left: '50%',
            transform: 'translateX(-50%)',
            top: isInside ? offsetVal + 'px' : -(offsetVal + sizeVal) + 'px',
          }
        : {
            top: '50%',
            transform: 'translateY(-50%)',
            left: isInside ? offsetVal + 'px' : -(offsetVal + sizeVal) + 'px',
          }),
    };

    const nextPosStyle = {
      position: 'absolute',
      zIndex: 20,
      ...(isVertical
        ? {
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: isInside ? offsetVal + 'px' : -(offsetVal + sizeVal) + 'px',
          }
        : {
            top: '50%',
            transform: 'translateY(-50%)',
            right: isInside ? offsetVal + 'px' : -(offsetVal + sizeVal) + 'px',
          }),
    };

    return (
      <>
        <button
          onClick={() => emblaApi?.scrollPrev()}
          disabled={prevDisabled}
          style={{ ...arrowBtnStyle(prevDisabled), ...prevPosStyle }}
          aria-label="Previous"
        >
          {isVertical ? '\\u2303' : '\\u2039'}
        </button>
        <button
          onClick={() => emblaApi?.scrollNext()}
          disabled={nextDisabled}
          style={{ ...arrowBtnStyle(nextDisabled), ...nextPosStyle }}
          aria-label="Next"
        >
          {isVertical ? '\\u2304' : '\\u203A'}
        </button>
      </>
    );
  };

  const renderDotsContent = () => {
    const snapCount = scrollSnaps.length || count;

    if (dotsFormat === 'fraction') {
      return (
        <div
          style={{
            fontSize: Math.max(12, dotsSize * 1.5) + 'px',
            fontWeight: 600,
            color: dotsActiveColor,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          <span>{String(selectedIndex + 1).padStart(2, '0')}</span>
          <span style={{ color: dotsColor, margin: '0 4px' }}>/</span>
          <span style={{ color: dotsColor }}>{String(snapCount).padStart(2, '0')}</span>
        </div>
      );
    }

    if (dotsFormat === 'progressBar') {
      const fillPercent = progress > 0
        ? progress * 100
        : (snapCount > 1 ? (selectedIndex / (snapCount - 1)) * 100 : 0);
      return (
        <div
          style={{
            position: 'relative',
            width: '120px',
            height: dotsSize + 'px',
            background: dotsColor,
            borderRadius: Math.round(dotsSize / 2) + 'px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: fillPercent + '%',
              background: dotsActiveColor,
              borderRadius: Math.round(dotsSize / 2) + 'px',
              transition: 'width 0.15s ease-out',
            }}
          />
        </div>
      );
    }

    const isPills = dotsFormat === 'pills';
    const items = scrollSnaps.length > 0 ? scrollSnaps : slides;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: dotsGap + 'px' }}>
        {items.map(function (_, i) {
          const isActive = i === selectedIndex;
          const dotWidth = isPills
            ? (isActive ? dotsSize * 3 : dotsSize * 1.5) + 'px'
            : dotsSize + 'px';
          const dotHeight = dotsSize + 'px';
          const borderRadius = isPills ? Math.round(dotsSize / 2) + 'px' : '50%';

          return (
            <button
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={'Go to slide ' + (i + 1)}
              style={{
                width: dotWidth,
                height: dotHeight,
                borderRadius,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background: isActive ? dotsActiveColor : dotsColor,
                transition: 'all 0.25s ease',
              }}
            />
          );
        })}
      </div>
    );
  };

  const renderFloatingDots = () => {
    if (!showDots || count <= 1) return null;
    if (dotsPosition !== 'top-right' && !isVertical) return null;
    return (
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: dotsGap + 'px',
        }}
      >
        {renderDotsContent()}
      </div>
    );
  };

  const renderBottomBar = () => {
    const bottomBarPaddingTop = Math.max(8, Number(arrowsOffset || 0));

    // Case 1: Both arrows and dots at the bottom
    if (hasBottomArrows && hasBottomDots) {
      if (arrowsPosition === 'bottom-left' && dotsPosition === 'bottom-center') {
        return (
          <div
            data-embla-controls="bottom"
            style={{
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
              width: '100%',
              boxSizing: 'border-box',
              paddingTop: bottomBarPaddingTop + 'px',
              paddingBottom: '4px',
              minHeight: numArrowsSize + 'px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', zIndex: 2 }}>{renderArrowButtons()}</div>
            <div
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                zIndex: 1,
              }}
            >
              {renderDotsContent()}
            </div>
          </div>
        );
      }
      if (arrowsPosition === 'bottom-right' && dotsPosition === 'bottom-center') {
        return (
          <div
            data-embla-controls="bottom"
            style={{
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
              width: '100%',
              boxSizing: 'border-box',
              paddingTop: bottomBarPaddingTop + 'px',
              paddingBottom: '4px',
              minHeight: numArrowsSize + 'px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                zIndex: 1,
              }}
            >
              {renderDotsContent()}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', zIndex: 2 }}>
              {renderArrowButtons()}
            </div>
          </div>
        );
      }
      if (arrowsPosition === 'bottom-left' && dotsPosition === 'bottom-left') {
        return (
          <div
            data-embla-controls="bottom"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              width: '100%',
              boxSizing: 'border-box',
              paddingTop: bottomBarPaddingTop + 'px',
              paddingBottom: '4px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>{renderArrowButtons()}</div>
            {renderDotsContent()}
          </div>
        );
      }
      if (arrowsPosition === 'bottom-center' && dotsPosition === 'bottom-center') {
        return (
          <div
            data-embla-controls="bottom"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              boxSizing: 'border-box',
              paddingTop: bottomBarPaddingTop + 'px',
              paddingBottom: '4px',
            }}
          >
            {renderDotsContent()}
            <div style={{ display: 'flex', gap: '8px' }}>{renderArrowButtons()}</div>
          </div>
        );
      }
      return (
        <div
          data-embla-controls="bottom"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            boxSizing: 'border-box',
            paddingTop: bottomBarPaddingTop + 'px',
            paddingBottom: '4px',
          }}
        >
          {renderDotsContent()}
          <div style={{ display: 'flex', gap: '8px' }}>{renderArrowButtons()}</div>
        </div>
      );
    }

    // Case 2: Only arrows at the bottom
    if (hasBottomArrows) {
      const justify = arrowsPosition === 'bottom-center' ? 'center' : arrowsPosition === 'bottom-right' ? 'flex-end' : 'flex-start';
      return (
        <div
          data-embla-controls="bottom"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: justify,
            width: '100%',
            boxSizing: 'border-box',
            paddingTop: bottomBarPaddingTop + 'px',
            paddingBottom: '4px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>{renderArrowButtons()}</div>
        </div>
      );
    }

    // Case 3: Only dots at the bottom
    if (hasBottomDots) {
      const justify = dotsPosition === 'bottom-left' ? 'flex-start' : 'center';
      return (
        <div
          data-embla-controls="bottom"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: justify,
            width: '100%',
            boxSizing: 'border-box',
            paddingTop: bottomBarPaddingTop + 'px',
            paddingBottom: '4px',
          }}
        >
          {renderDotsContent()}
        </div>
      );
    }

    return null;
  };

  return (
    <div
      ref={rootRef}
      data-embla-root={carouselId}
      data-id={props['data-id']}
      data-name={props['data-name']}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        ...props.style,
      }}
    >
      <style>{
        '[data-embla-root="' + carouselId + '"] [data-embla-slide-inner] > * { ' +
        'position: absolute !important; ' +
        'top: 0 !important; ' +
        'left: 0 !important; ' +
        'right: 0 !important; ' +
        'bottom: 0 !important; ' +
        'margin: 0 !important; ' +
        'width: 100% !important; ' +
        'height: 100% !important; ' +
        'max-width: 100% !important; ' +
        'max-height: 100% !important; ' +
        'box-sizing: border-box !important; ' +
        '} ' +
        '[data-embla-root="' + carouselId + '"] [data-embla-slide-inner] img { ' +
        'position: absolute !important; ' +
        'top: 0 !important; ' +
        'left: 0 !important; ' +
        'right: 0 !important; ' +
        'bottom: 0 !important; ' +
        'width: 100% !important; ' +
        'height: 100% !important; ' +
        'max-width: 100% !important; ' +
        'max-height: 100% !important; ' +
        'object-fit: ' + (objectFit || 'cover') + ' !important; ' +
        'object-position: ' + (objectPosition || 'center') + ' !important; ' +
        'display: block !important; ' +
        '}'
      }</style>
      <div
        ref={emblaRef}
        style={{
          overflow: 'hidden',
          width: '100%',
          flex: isFitHeight ? '0 0 auto' : '1 1 auto',
          minHeight: 0,
          position: 'relative',
          boxSizing: 'border-box',
          paddingLeft: padSides ? padSides + 'px' : undefined,
          paddingRight: padSides ? padSides + 'px' : undefined,
          paddingTop: padTopBottomSides ? padTopBottomSides + 'px' : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isVertical ? 'column' : 'row',
            height: isVertical ? 'auto' : '100%',
            touchAction: isVertical ? 'pan-x' : 'pan-y',
          }}
        >
          {slides.map(function (slide, idx) {
            return (
              <div key={idx} data-embla-slide={idx} style={slideOuterStyle}>
                <div data-embla-slide-inner="true" style={slideInnerStyle}>
                  {renderSlideChild(slide)}
                </div>
              </div>
            );
          })}
        </div>

        {renderFloatingArrows()}
        {renderFloatingDots()}
      </div>

      {hasBottomBar && renderBottomBar()}
    </div>
  );
}

export default withResponsiveProps(EmblaCarousel);
`;
