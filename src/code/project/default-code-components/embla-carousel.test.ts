/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { EMBLA_CAROUSEL_COMPONENT } from './EmblaCarousel';
import { parseComponentControlsMeta, parseCodeComponentDefaultSize } from '@/code/components/controls-parser';
import { compileCodeComponent, clearCodeComponentCache } from '@/canvas/code-component-runtime';
import useEmblaCarousel from 'embla-carousel-react';
import { BUILT_IN_COMPONENTS, InMemoryProjectFS, installBuiltInCodeComponent, createDefaultProject, syncBuiltInCodeComponents } from '../project-fs';
import * as defaultComponents from './index';

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (!('IntersectionObserver' in globalThis)) {
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    };
  }

  if (!('ResizeObserver' in globalThis)) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('EmblaCarousel Component Metadata', () => {
  it('parses @controls metadata successfully', () => {
    const meta = parseComponentControlsMeta(EMBLA_CAROUSEL_COMPONENT);
    expect(meta).not.toBeNull();
    expect(meta?.label).toBe('Embla Carousel');
    expect(meta?.comment).toBe('A fluid, highly customizable slider powered by Embla Carousel with multi-slide, marquee, and external trigger support.');
    expect(meta?.controls.children?.type).toBe('slot');
    expect(meta?.controls.children?.slotMax).toBe('infinite');
    expect(meta?.controls.layout?.type).toBe('group');
    expect(meta?.controls.scroll?.type).toBe('group');
    expect(meta?.controls.motion?.type).toBe('group');
    expect(meta?.controls.slideEffects?.type).toBe('group');
    expect(meta?.controls.arrows?.type).toBe('group');
    expect(meta?.controls.dots?.type).toBe('group');
    expect(meta?.controls.activeSlideIndex?.type).toBe('number');

    // Check specific nested controls
    const layoutControls = meta?.controls.layout?.controls;
    expect(layoutControls?.visibleSlides?.type).toBe('select');
    expect(layoutControls?.visibleSlidesTablet?.type).toBe('select');
    expect(layoutControls?.visibleSlidesTablet?.default).toBe('inherit');
    expect(layoutControls?.visibleSlidesMobile?.type).toBe('select');
    expect(layoutControls?.visibleSlidesMobile?.default).toBe('inherit');
    expect(layoutControls?.gap?.type).toBe('number');
    expect(layoutControls?.aspectRatio?.type).toBe('select');
    expect(layoutControls?.objectFit?.type).toBe('select');
    expect(layoutControls?.objectPosition?.type).toBe('select');
    expect(layoutControls?.slideRadius?.type).toBe('number');
    expect(layoutControls?.align?.type).toBe('select');
    expect(layoutControls?.axis?.type).toBe('select');
    expect(layoutControls?.direction?.type).toBe('select');

    const scrollControls = meta?.controls.scroll?.controls;
    expect(scrollControls?.scrollMode?.type).toBe('select');
    expect(scrollControls?.loop?.type).toBe('toggle');
    expect(scrollControls?.dragFree?.type).toBe('select');
    expect(scrollControls?.containScroll?.type).toBe('select');
    expect(scrollControls?.duration?.type).toBe('number');

    const motionControls = meta?.controls.motion?.controls;
    expect(motionControls?.autoplayMode?.type).toBe('select');
    expect(motionControls?.autoplayDelay?.type).toBe('number');
    expect(motionControls?.pauseOnHover?.type).toBe('toggle');
    expect(motionControls?.effect?.type).toBe('select');

    const effectsControls = meta?.controls.slideEffects?.controls;
    expect(effectsControls?.enableSlideEffects?.type).toBe('toggle');
    expect(effectsControls?.inactiveScale?.type).toBe('number');
    expect(effectsControls?.inactiveOpacity?.type).toBe('number');
    expect(effectsControls?.parallaxFactor?.type).toBe('number');
    expect(effectsControls?.rotateAngle?.type).toBe('number');
    expect(effectsControls?.rotateAngle?.min).toBe(-60);
    expect(effectsControls?.rotateAngle?.max).toBe(60);
    expect(effectsControls?.effectsFalloff?.type).toBe('select');

    const arrowsControls = meta?.controls.arrows?.controls;
    expect(arrowsControls?.arrowsShow?.type).toBe('toggle');
    expect(arrowsControls?.arrowsPosition?.type).toBe('select');
    expect(arrowsControls?.arrowsSize?.type).toBe('number');

    const dotsControls = meta?.controls.dots?.controls;
    expect(dotsControls?.dotsShow?.type).toBe('toggle');
    expect(dotsControls?.dotsFormat?.type).toBe('select');
    expect(dotsControls?.dotsPosition?.type).toBe('select');
  });

  it('declares default dimensions of 800 x 450', () => {
    const size = parseCodeComponentDefaultSize(EMBLA_CAROUSEL_COMPONENT);
    expect(size.width).toBe(800);
    expect(size.height).toBe(450);
  });

  it('compiles with compileCodeComponent to a forwardRef component', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel');
    expect(Comp).not.toBeNull();
    expect(typeof Comp).toBe('object');
    expect((Comp as any).$$typeof).toBe(Symbol.for('react.forward_ref'));
  });

  it('renders placeholder when no slides are provided', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { getByText } = render(React.createElement(Comp));
    expect(getByText('Connect Content')).toBeTruthy();
    expect(getByText('Add slides to the carousel')).toBeTruthy();
  });

  it('renders slides and navigation controls when slides are provided', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { getByText, getByLabelText } = render(
      React.createElement(
        Comp,
        {
          arrowsShow: true,
          dotsShow: true,
        },
        React.createElement('div', { key: '1' }, 'Slide 1'),
        React.createElement('div', { key: '2' }, 'Slide 2'),
        React.createElement('div', { key: '3' }, 'Slide 3'),
      ),
    );
    expect(getByText('Slide 1')).toBeTruthy();
    expect(getByText('Slide 2')).toBeTruthy();
    expect(getByText('Slide 3')).toBeTruthy();
    expect(getByLabelText('Previous')).toBeTruthy();
    expect(getByLabelText('Next')).toBeTruthy();
  });

  it('renders bottom-right arrow position', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { getByLabelText } = render(
      React.createElement(
        Comp,
        { arrowsShow: true, arrowsPosition: 'bottom-right' },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
      ),
    );
    expect(getByLabelText('Previous')).toBeTruthy();
    expect(getByLabelText('Next')).toBeTruthy();
  });

  it('renders bottom-center arrow position', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { getByLabelText } = render(
      React.createElement(
        Comp,
        { arrowsShow: true, arrowsPosition: 'bottom-center' },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
      ),
    );
    expect(getByLabelText('Previous')).toBeTruthy();
    expect(getByLabelText('Next')).toBeTruthy();
  });

  it('renders fraction dot format', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { getByText } = render(
      React.createElement(
        Comp,
        { dotsShow: true, dotsFormat: 'fraction' },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
      ),
    );
    expect(getByText('01')).toBeTruthy();
    expect(getByText('02')).toBeTruthy();
  });

  it('renders progressBar dot format with proper percentage, role, and vertical layout', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container, rerender } = render(
      React.createElement(
        Comp,
        { dotsShow: true, dotsFormat: 'progressBar' },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
        React.createElement('div', { key: '3' }, 'S3'),
        React.createElement('div', { key: '4' }, 'S4'),
      ),
    );
    const progressTrack = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(progressTrack).toBeTruthy();
    expect(progressTrack?.getAttribute('aria-valuenow')).toBe('1');
    expect(progressTrack?.getAttribute('aria-valuemax')).toBe('4');
    
    const fillEl = progressTrack?.firstElementChild as HTMLElement;
    expect(fillEl).toBeTruthy();
    expect(fillEl.style.width).toBe('25%');

    // Vertical layout -> height 120px and height fill 25%
    rerender(
      React.createElement(
        Comp,
        { dotsShow: true, dotsFormat: 'progressBar', axis: 'y' },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
        React.createElement('div', { key: '3' }, 'S3'),
        React.createElement('div', { key: '4' }, 'S4'),
      ),
    );
    const verticalTrack = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(verticalTrack.style.height).toBe('120px');
    const verticalFill = verticalTrack?.firstElementChild as HTMLElement;
    expect(verticalFill.style.height).toBe('25%');
    expect(verticalFill.style.width).toBe('100%');
  });

  it('allows clicking the progressBar to navigate between slides', () => {
    clearCodeComponentCache();
    let capturedApi: any = null;
    const wrappedHook = (...args: any[]) => {
      const res = useEmblaCarousel(...args);
      if (res[1]) {
        capturedApi = res[1];
        if (!capturedApi.scrollTo?.mock) {
          vi.spyOn(capturedApi, 'scrollTo');
          capturedApi.scrollSnapList = () => [0, 1, 2, 3];
        }
      }
      return res;
    };

    try {
      const Comp = compileCodeComponent(
        EMBLA_CAROUSEL_COMPONENT,
        'EmblaCarousel',
        { previewMode: true, extraModules: { 'embla-carousel-react': { default: wrappedHook, useEmblaCarousel: wrappedHook } } },
      ) as React.ComponentType<any>;
      const { container } = render(
        React.createElement(
          Comp,
          { dotsShow: true, dotsFormat: 'progressBar' },
          React.createElement('div', { key: '1' }, 'S1'),
          React.createElement('div', { key: '2' }, 'S2'),
          React.createElement('div', { key: '3' }, 'S3'),
          React.createElement('div', { key: '4' }, 'S4'),
        ),
      );
      const progressTrack = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressTrack).toBeTruthy();

      // Mock getBoundingClientRect on track
      progressTrack.getBoundingClientRect = () => ({
        left: 100,
        top: 200,
        width: 120,
        height: 8,
        right: 220,
        bottom: 208,
        x: 100,
        y: 200,
        toJSON: () => {},
      });

      // Click at 75% across the width (clientX = 190, which is left 100 + 90 -> 90/120 = 0.75 -> index 3)
      fireEvent.click(progressTrack, { clientX: 190, clientY: 204 });

      expect(capturedApi?.scrollTo).toHaveBeenCalledWith(3);
    } finally {
      clearCodeComponentCache();
    }
  });

  it('allows clicking vertical progressBar to navigate slides top-to-bottom', () => {
    clearCodeComponentCache();
    let capturedApi: any = null;
    const wrappedHook = (...args: any[]) => {
      const res = useEmblaCarousel(...args);
      if (res[1]) {
        capturedApi = res[1];
        if (!capturedApi.scrollTo?.mock) {
          vi.spyOn(capturedApi, 'scrollTo');
          capturedApi.scrollSnapList = () => [0, 1, 2, 3];
        }
      }
      return res;
    };

    try {
      const Comp = compileCodeComponent(
        EMBLA_CAROUSEL_COMPONENT,
        'EmblaCarousel',
        { previewMode: true, extraModules: { 'embla-carousel-react': { default: wrappedHook, useEmblaCarousel: wrappedHook } } },
      ) as React.ComponentType<any>;
      const { container } = render(
        React.createElement(
          Comp,
          { dotsShow: true, dotsFormat: 'progressBar', axis: 'vertical' },
          React.createElement('div', { key: '1' }, 'S1'),
          React.createElement('div', { key: '2' }, 'S2'),
          React.createElement('div', { key: '3' }, 'S3'),
          React.createElement('div', { key: '4' }, 'S4'),
        ),
      );
      const progressTrack = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressTrack).toBeTruthy();

      // Mock getBoundingClientRect on vertical track
      progressTrack.getBoundingClientRect = () => ({
        left: 200,
        top: 100,
        width: 8,
        height: 120,
        right: 208,
        bottom: 220,
        x: 200,
        y: 100,
        toJSON: () => {},
      });

      // Click at 50% along the height (clientY = 160 -> (160 - 100) / 120 = 0.5 -> index 2)
      fireEvent.click(progressTrack, { clientX: 204, clientY: 160 });

      expect(capturedApi?.scrollTo).toHaveBeenCalledWith(2);
    } finally {
      clearCodeComponentCache();
    }
  });

  it('wires external triggers matching data-carousel-target and updates disabled states', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    
    // Create external triggers in DOM
    const prevBtn = document.createElement('button');
    prevBtn.setAttribute('data-carousel-target', 'my-slider');
    prevBtn.setAttribute('data-carousel-action', 'prev');
    document.body.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.setAttribute('data-carousel-target', 'my-slider');
    nextBtn.setAttribute('data-carousel-action', 'next');
    document.body.appendChild(nextBtn);

    render(
      React.createElement(
        Comp,
        { 'data-id': 'my-slider', loop: false },
        React.createElement('div', { key: '1' }, 'Slide 1'),
        React.createElement('div', { key: '2' }, 'Slide 2'),
      ),
    );

    // Initial state: at index 0 without loop, canPrev is false
    expect(prevBtn.disabled).toBe(true);
    expect(prevBtn.getAttribute('aria-disabled')).toBe('true');
    expect(prevBtn.getAttribute('data-disabled')).toBe('true');

    // Clean up DOM buttons
    document.body.removeChild(prevBtn);
    document.body.removeChild(nextBtn);
  });

  it('is exported from default-code-components index', () => {
    expect((defaultComponents as any).EMBLA_CAROUSEL_COMPONENT).toBe(EMBLA_CAROUSEL_COMPONENT);
  });

  it('is registered in BUILT_IN_COMPONENTS and installable via installBuiltInCodeComponent', () => {
    const entry = (BUILT_IN_COMPONENTS as [string, string][]).find(([p]) => p === 'components/EmblaCarousel.tsx');
    expect(entry).toBeDefined();
    expect(entry?.[1]).toBe(EMBLA_CAROUSEL_COMPONENT);

    const fs = new InMemoryProjectFS(createDefaultProject());
    const installed = installBuiltInCodeComponent(fs, 'EmblaCarousel');
    expect(installed).toBe(true);
    expect(fs.readFile('components/EmblaCarousel.tsx')).toBe(EMBLA_CAROUSEL_COMPONENT);
  });

  it('renders bottom-left arrow position', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { getByLabelText } = render(
      React.createElement(
        Comp,
        { arrowsShow: true, arrowsPosition: 'bottom-left' },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
      ),
    );
    expect(getByLabelText('Previous')).toBeTruthy();
    expect(getByLabelText('Next')).toBeTruthy();
  });

  it('neutralizes slot child absolute positioning and applies aspect ratio', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          visibleSlides: '3',
          aspectRatio: '3/4',
          slideRadius: 16,
          objectFit: 'cover',
        },
        React.createElement('img', {
          key: '1',
          src: 'test.jpg',
          style: { position: 'absolute', left: 450, top: 100, width: 300, height: 200 },
        }),
      ),
    );

    const slideInner = container.querySelector('[data-embla-slide-inner="true"]') as HTMLElement;
    expect(slideInner).toBeTruthy();
    expect(slideInner.style.aspectRatio).toBe('3/4');
    expect(slideInner.style.borderRadius).toBe('16px');

    const img = container.querySelector('img') as HTMLElement;
    expect(img).toBeTruthy();
    // React cloneElement overrides
    expect(img.style.position).toBe('absolute');
    expect(img.style.left).toBe('0px');
    expect(img.style.top).toBe('0px');
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
    expect(img.style.objectFit).toBe('cover');
  });

  it('renders dedicated in-flow bottom controls bar with fit-content height', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          style: { height: 'fit-content' },
          arrowsShow: true,
          arrowsPosition: 'bottom-left',
          dotsShow: true,
          dotsPosition: 'bottom-center',
        },
        React.createElement('div', { key: '1' }, 'Slide 1'),
        React.createElement('div', { key: '2' }, 'Slide 2'),
      ),
    );

    const bottomControls = container.querySelector('[data-embla-controls="bottom"]');
    expect(bottomControls).toBeTruthy();

    const buttons = bottomControls?.querySelectorAll('button');
    expect(buttons && buttons.length >= 2).toBe(true);

    const prevBtn = container.querySelector('button[aria-label="Previous"]');
    const nextBtn = container.querySelector('button[aria-label="Next"]');
    expect(bottomControls?.contains(prevBtn)).toBe(true);
    expect(bottomControls?.contains(nextBtn)).toBe(true);
  });

  it('scales slide width based on visibleWidth percentage', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          visibleSlides: '3',
          visibleWidth: 85,
          gap: 16,
        },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
        React.createElement('div', { key: '3' }, 'S3'),
      ),
    );

    const slide = container.querySelector('[data-embla-slide="0"]') as HTMLElement;
    expect(slide).toBeTruthy();
    expect(slide.style.flex).toContain('117.65%');
  });

  it('supports bottom-right dotsPosition and renders in bottom controls', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          dotsShow: true,
          dotsPosition: 'bottom-right',
        },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
      ),
    );

    const bottomControls = container.querySelector('[data-embla-controls="bottom"]');
    expect(bottomControls).toBeTruthy();
  });

  it('auto-migrates existing EmblaCarousel lacking visibleWidth in syncBuiltInCodeComponents', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    // Write an older version of EmblaCarousel without visibleWidth
    fs.writeFile('components/EmblaCarousel.tsx', `'use client';\nexport default function EmblaCarousel() { return null; }`);
    expect(fs.readFile('components/EmblaCarousel.tsx')).not.toContain('"visibleWidth"');

    syncBuiltInCodeComponents(fs);
    expect(fs.readFile('components/EmblaCarousel.tsx')).toBe(EMBLA_CAROUSEL_COMPONENT);
  });

  it('renders vertical axis with non-zero dimensions and proper flex column', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          axis: 'vertical',
          visibleSlides: '3',
          gap: 12,
        },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
        React.createElement('div', { key: '3' }, 'S3'),
      ),
    );

    const slide = container.querySelector('[data-embla-slide="0"]') as HTMLElement;
    expect(slide).toBeTruthy();
    expect(slide.style.width).toBe('100%');
    expect(slide.style.height).toBe('100%');

    const inner = container.querySelector('[data-embla-slide-inner="true"]') as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.style.height).toBe('100%');
  });

  it('renders with slideEffects enabled and applies transition styles', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          enableSlideEffects: true,
          inactiveScale: 0.85,
          inactiveOpacity: 0.6,
          rotateAngle: 15,
          parallaxFactor: 20,
        },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
        React.createElement('div', { key: '3' }, 'S3'),
      ),
    );

    const slide = container.querySelector('[data-embla-slide="0"]') as HTMLElement;
    expect(slide).toBeTruthy();
    const inner = container.querySelector('[data-embla-slide-inner="true"]') as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.style.transition).toContain('transform');

    const pTarget = container.querySelector('[data-embla-parallax-target="true"]') as HTMLElement;
    expect(pTarget).toBeTruthy();
    expect(pTarget.style.transform).toContain('scale(1.2)');
  });

  it('auto-migrates existing EmblaCarousel lacking slideEffects, parallax target, or resolvedBgSize in syncBuiltInCodeComponents', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    fs.writeFile('components/EmblaCarousel.tsx', `'use client';\n// "visibleWidth"\n// WheelGesturesPlugin\n// minHeight: isVertical && isFitHeight ? '450px'\n// "slideEffects"\n// data-embla-parallax-target\nexport default function EmblaCarousel() { return null; }`);
    expect(fs.readFile('components/EmblaCarousel.tsx')).not.toContain('resolvedBgSize');

    syncBuiltInCodeComponents(fs);
    expect(fs.readFile('components/EmblaCarousel.tsx')).toBe(EMBLA_CAROUSEL_COMPONENT);
  });

  it('auto-migrates existing EmblaCarousel lacking handleProgressClick in syncBuiltInCodeComponents', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    fs.writeFile('components/EmblaCarousel.tsx', `'use client';\n// "visibleWidth"\n// WheelGesturesPlugin\n// minHeight: isVertical && isFitHeight ? '450px'\n// "slideEffects"\n// data-embla-parallax-target\n// resolvedBgSize\nexport default function EmblaCarousel() { return null; }`);
    expect(fs.readFile('components/EmblaCarousel.tsx')).not.toContain('handleProgressClick');

    syncBuiltInCodeComponents(fs);
    expect(fs.readFile('components/EmblaCarousel.tsx')).toBe(EMBLA_CAROUSEL_COMPONENT);
  });

  it('applies backgroundSize and backgroundPosition to slide child with backgroundImage', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          objectFit: 'contain',
          objectPosition: 'top',
        },
        React.createElement('div', {
          key: '1',
          style: {
            backgroundImage: 'url("test.jpg")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          },
        }),
      ),
    );

    const slideChild = container.querySelector('[data-embla-parallax-target="true"] > div') as HTMLElement;
    expect(slideChild).toBeTruthy();
    expect(slideChild.style.backgroundSize).toBe('contain');
    expect(slideChild.style.backgroundPosition).toContain('top');
  });

  it('renders responsive slide sizes in style tag with tablet and mobile rules', () => {
    const Comp = compileCodeComponent(EMBLA_CAROUSEL_COMPONENT, 'EmblaCarousel') as React.ComponentType<any>;
    const { container } = render(
      React.createElement(
        Comp,
        {
          visibleSlides: '3',
          visibleSlidesTablet: '2',
          visibleSlidesMobile: '1',
          gap: 16,
        },
        React.createElement('div', { key: '1' }, 'S1'),
        React.createElement('div', { key: '2' }, 'S2'),
        React.createElement('div', { key: '3' }, 'S3'),
      ),
    );

    const styleTag = container.querySelector('style');
    expect(styleTag).toBeTruthy();
    const css = styleTag?.textContent || '';
    expect(css).toContain('--embla-slide-size');
    expect(css).toContain('@media (max-width: 1024px)');
    expect(css).toContain('@container (max-width: 1024px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@container (max-width: 640px)');

    const slide = container.querySelector('[data-embla-slide="0"]') as HTMLElement;
    expect(slide.style.flex).toContain('--embla-slide-size');
  });

  it('auto-migrates existing EmblaCarousel lacking visibleSlidesTablet in syncBuiltInCodeComponents', () => {
    const fs = new InMemoryProjectFS(createDefaultProject());
    fs.writeFile('components/EmblaCarousel.tsx', `'use client';\n// "visibleWidth"\n// WheelGesturesPlugin\n// minHeight: isVertical && isFitHeight ? '450px'\n// "slideEffects"\n// data-embla-parallax-target\n// resolvedBgSize\n// handleProgressClick\nexport default function EmblaCarousel() { return null; }`);
    expect(fs.readFile('components/EmblaCarousel.tsx')).not.toContain('visibleSlidesTablet');

    syncBuiltInCodeComponents(fs);
    expect(fs.readFile('components/EmblaCarousel.tsx')).toBe(EMBLA_CAROUSEL_COMPONENT);
  });
});

