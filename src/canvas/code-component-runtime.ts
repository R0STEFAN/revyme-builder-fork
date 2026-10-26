// code-component-runtime.ts — Compile Code component TSX code to executable React components.
// Uses @babel/standalone for TSX → JS, then new Function for execution.

import { transform } from '@babel/standalone';
import { simpleHash } from '@/shared/hash-utils';
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, useReducer, useContext, createContext, forwardRef, memo, lazy, Suspense, Fragment, Children, cloneElement, isValidElement } from 'react';
import * as motionRuntime from 'framer-motion';
import * as revymeRuntime from '@revyme/runtime';
import * as ReactJSXRuntime from 'react/jsx-runtime';
import * as motionOne from '@motionone/dom';
import EmblaCarousel from 'embla-carousel';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import AutoScroll from 'embla-carousel-auto-scroll';
import Fade from 'embla-carousel-fade';
import AutoHeight from 'embla-carousel-auto-height';
import WheelGesturesPlugin from 'embla-carousel-wheel-gestures';
const wheelGestures = WheelGesturesPlugin;
import { trace } from '@/shared/debug-trace';
import { upgradeVectorSetInstanceBranch } from '@/code/icons/icon-set-template';

// ─── Unified withResponsiveProps HOC ────────────────────────────────────────
// Single implementation used by both canvas (via MODULE_MAP) and production
// (via lib/withResponsiveProps.tsx — same logic). Reads `data-responsive` JSON
// and merges per-viewport overrides. On canvas, CodeComponentHost injects
// `__canvasViewportWidth`; in production, uses `window.innerWidth`.

function withResponsiveProps(Component: any) {
  // forwardRef so a `forwardRef` inner (icon-set / vector-set instances, which
  // need the ref for hover/in-view effects + motion-value styles) still receives
  // it. The ref is passed through ONLY when one is actually provided — handing a
  // ref to a plain function component (design components) would warn, and those
  // are never given a ref.
  return React.forwardRef(function ResponsiveCodeComponent(props: any, ref: any) {
    const canvasVpWidth = props['__canvasViewportWidth'] as number | undefined;

    const [windowWidth, setWindowWidth] = React.useState(
      typeof window !== 'undefined' ? window.innerWidth : 1440
    );

    React.useEffect(() => {
      if (canvasVpWidth !== undefined) return;
      const handler = () => setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handler);
      return () => window.removeEventListener('resize', handler);
    }, [canvasVpWidth]);

    const vpWidth = canvasVpWidth ?? windowWidth;
    const responsiveStr = props['data-responsive'];
    let mergedProps = { ...props };

    if (responsiveStr) {
      try {
        const overrides = typeof responsiveStr === 'string'
          ? JSON.parse(responsiveStr) : responsiveStr;
        // _bp contains all viewport breakpoint widths for range computation.
        // Each breakpoint's range is (prev_bp, bp]. This prevents cascade
        // (e.g. tablet override doesn't leak to mobile).
        const allBp: number[] = Array.isArray(overrides._bp)
          ? overrides._bp : Object.keys(overrides).filter(k => k !== '_bp').map(Number);
        const sortedBp = [...allBp].sort((a, b) => a - b);

        // Find which range vpWidth falls into
        let matchedBp: number | undefined;
        for (let i = 0; i < sortedBp.length; i++) {
          const lower = i > 0 ? sortedBp[i - 1] : 0;
          if (vpWidth > lower && vpWidth <= sortedBp[i]) {
            matchedBp = sortedBp[i];
            break;
          }
        }
        if (matchedBp !== undefined && overrides[matchedBp]) {
          const ov = overrides[matchedBp];
          // A Scroll Variant binds `initialVariant={…Sv}` and OWNS it at runtime (morphs on
          // scroll). Don't let the per-viewport data-responsive entry freeze it on replicas —
          // skip ONLY `initialVariant` from the merge when a scroll variant is present. The
          // per-viewport CHOICE still drives the canvas + the Sv resting. (Mirrors @revyme/runtime.)
          if (props['data-scroll-variant'] && ov && typeof ov === 'object' && 'initialVariant' in ov) {
            const { initialVariant: _skip, ...rest } = ov as Record<string, unknown>;
            mergedProps = { ...mergedProps, ...rest };
          } else {
            mergedProps = { ...mergedProps, ...ov };
          }
        }
      } catch { /* invalid JSON — ignore */ }
    }

    delete mergedProps['data-responsive'];
    delete mergedProps['__canvasViewportWidth'];
    return React.createElement(Component, ref ? { ...mergedProps, ref } : mergedProps);
  });
}

// ─── Canvas renderer detection hook ─────────────────────────────────────────
// Returns true when running inside the canvas editor (CodeComponentHost), false in production.
// Code components use this to skip heavy effects (SVG filters, rAF loops, WebGL) on the canvas.
function useIsCanvasRenderer(): boolean {
  return true; // Always true in code-component-runtime (canvas context)
}

// next-themes stub — code components like ThemeToggle import `useTheme` from
// 'next-themes', which on the live Next.js site flips `<html class="dark">`
// and persists the choice. On the canvas the real package isn't bundled and
// the editor has its own theme switcher anyway, so we stub `useTheme`. The
// theme it reports is the one the canvas is painting — the sandbox document
// carries the editor's `.dark` class (SandboxApi.setThemeMode) — so a switch
// that draws its own state shows the right one; `setTheme` is a no-op.
const readCanvasTheme = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
const stubUseTheme = () => {
  // A hook, like the real one: the editor toggle flips the class on this
  // document (setThemeMode) without re-rendering a mounted component, so the
  // value is state that follows the class — or the switch's knob stays where
  // the last render left it while the tokens around it change.
  const [theme, setTheme] = React.useState<'light' | 'dark'>(readCanvasTheme);
  React.useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const sync = () => setTheme(readCanvasTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return {
    theme,
    resolvedTheme: theme,
    systemTheme: theme,
    themes: ['light', 'dark'],
    setTheme: (_nextTheme: string | ((previousTheme: string) => string)) => {},
  };
};
const nextThemesStub = {
  useTheme: stubUseTheme,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
};

type PreviewThemeValue = ReturnType<typeof stubUseTheme>;
const PreviewThemeContext = React.createContext<PreviewThemeValue | null>(null);

function PreviewThemeProvider({ children, defaultTheme }: { children: React.ReactNode; defaultTheme?: string }) {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(
    () => defaultTheme === 'light' || defaultTheme === 'dark' ? defaultTheme : readCanvasTheme(),
  );
  const updateTheme = (nextTheme: string | ((previousTheme: string) => string)) => {
    setTheme((previousTheme) => {
      const requested = typeof nextTheme === 'function' ? nextTheme(previousTheme) : nextTheme;
      const resolved = requested === 'dark' ? 'dark' : 'light';
      trace.action('code-component-runtime:preview-theme-change', { theme: resolved });
      return resolved;
    });
  };
  const value: PreviewThemeValue = {
    theme,
    resolvedTheme: theme,
    systemTheme: theme,
    themes: ['light', 'dark'],
    setTheme: updateTheme,
  };
  return React.createElement(PreviewThemeContext.Provider, { value }, children);
}

function PreviewThemeBoundary({ children }: { children: React.ReactNode }) {
  const parent = React.useContext(PreviewThemeContext);
  return parent ? children : React.createElement(PreviewThemeProvider, null, children);
}

function previewUseTheme() {
  const context = React.useContext(PreviewThemeContext);
  // Every compiled preview root gets a boundary. A direct provider-less call
  // still has a stable hook shape and can read the current editor theme.
  if (context) return context;
  const theme = readCanvasTheme();
  return {
    theme, resolvedTheme: theme, systemTheme: theme,
    themes: ['light', 'dark'], setTheme: (_nextTheme: string | ((previousTheme: string) => string)) => {},
  };
}

const previewNextThemes = {
  useTheme: previewUseTheme,
  ThemeProvider: PreviewThemeProvider,
};

// next-intl stub — code components like LocaleSwitcher / pages may
// `import { useTranslations, useLocale } from 'next-intl'`. On the canvas
// there's no NextIntlClientProvider in scope and the active-locale display
// is driven by the locale-override map (Renderer applies the override text
// on top of the JSX default). So `t(key)` returns the key as a fallback —
// safe enough for canvas; the live website resolves through real next-intl.
const stubUseTranslations = (_namespace?: string) => {
  const t = (key: string, _values?: any) => key;
  // next-intl's t() exposes .rich / .raw / .markup. Stub them so user code
  // that calls e.g. `t.rich('welcome', { strong: (chunks) => <strong>{chunks}</strong> })`
  // doesn't crash on the canvas.
  (t as any).rich = (key: string) => key;
  (t as any).raw = (key: string) => key;
  (t as any).markup = (key: string) => key;
  (t as any).has = () => false;
  return t;
};
const nextIntlStub = {
  useTranslations: stubUseTranslations,
  useLocale: () => 'en',
  useMessages: () => ({}),
  useFormatter: () => ({
    dateTime: (d: any) => String(d),
    number: (n: any) => String(n),
    relativeTime: (d: any) => String(d),
    list: (l: any[]) => l.join(', '),
  }),
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
};

const nextNavigationStub = {
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  notFound: () => {},
  redirect: () => {},
};

const nextLinkStub = {
  default: React.forwardRef(function NextLinkStub({ href, children, ...props }: any, ref: any) {
    return React.createElement('a', { ref, href: href || '#', ...props }, children);
  }),
};

// Module scope for Code component code execution — pre-loaded ES modules
const MODULE_MAP: Record<string, any> = {
  'react': { ...React, default: React, Children, cloneElement, isValidElement, useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, useReducer, useContext, createContext, forwardRef, memo, lazy, Suspense, Fragment, createElement: React.createElement },
  'framer-motion': motionRuntime,
  // `@revyme/runtime` is the new home for `withResponsiveProps`, `withCursor`,
  // `CursorPortal`, `useStaticCanvas`, etc. Generated user code (post-2026-05-06)
  // imports from here as a normal package; the canvas iframe has it pre-loaded
  // so the dynamic `import` resolves without a network roundtrip. Keeps the
  // same shape as the npm package once we publish.
  //
  // `useStaticCanvas` is OVERRIDDEN here to return `true`: the package's own
  // implementation defaults to `false` (production assumption), but on canvas
  // we want code components to take their static branch. Preview mode flips it back to
  // `false` lower in compileCodeComponent (see `previewOverrides` block).
  // `withResponsiveProps` is OVERRIDDEN with the LOCAL canvas copy: it is
  // identical to the package's responsive logic BUT forwards a `ref` (only when
  // one is passed) so a `forwardRef` inner — icon-set / vector-set instances,
  // which need the ref for hover/in-view effects + motion-value styles — still
  // receives it. The package version drops the ref. No-op for the plain-function
  // design components (never handed a ref). Live preview / export use the
  // package version directly (this MODULE_MAP only feeds the canvas sandbox).
  '@revyme/runtime': { ...revymeRuntime, useStaticCanvas: () => true, withResponsiveProps },
  // Legacy entries — older user projects still have `import withResponsiveProps
  // from '@/lib/withResponsiveProps'`. Resolve these to the same function so
  // they keep working without a project codemod. Old projects can migrate
  // lazily; new projects don't generate these imports.
  '@/lib/withResponsiveProps': { default: withResponsiveProps },
  'lib/withResponsiveProps': { default: withResponsiveProps },
  '@/lib/cursor-runtime': revymeRuntime,
  'lib/cursor-runtime': revymeRuntime,
  '@/lib/useIsCanvasRenderer': { default: useIsCanvasRenderer, useIsCanvasRenderer },
  'lib/useIsCanvasRenderer': { default: useIsCanvasRenderer, useIsCanvasRenderer },
  '@/lib/image-utils': { getUploadSrcSet: () => undefined, inferImageSizes: () => '100vw', default: { getUploadSrcSet: () => undefined, inferImageSizes: () => '100vw' } },
  'lib/image-utils': { getUploadSrcSet: () => undefined, inferImageSizes: () => '100vw', default: { getUploadSrcSet: () => undefined, inferImageSizes: () => '100vw' } },
  // Both spellings a published code component may use, plus the `dist/` paths
  // some of them import directly.
  // published modules are compiled with the automatic JSX runtime, so they all
  // import `jsx`/`jsxs` from here rather than using JSX syntax.
  'react/jsx-runtime': ReactJSXRuntime,
  'react/jsx-dev-runtime': ReactJSXRuntime,
  // Motion One — the other animation library published code components reach for.
  '@motionone/dom': motionOne,
  'motion': motionOne,
  'next-themes': nextThemesStub,
  'next-intl': nextIntlStub,
  'next/navigation': nextNavigationStub,
  'next/link': nextLinkStub,
  'embla-carousel': { default: EmblaCarousel, EmblaCarousel },
  'embla-carousel-react': { default: useEmblaCarousel, useEmblaCarousel },
  'embla-carousel-autoplay': { default: Autoplay, Autoplay },
  'embla-carousel-auto-scroll': { default: AutoScroll, AutoScroll },
  'embla-carousel-fade': { default: Fade, Fade },
  'embla-carousel-auto-height': { default: AutoHeight, AutoHeight },
  'embla-carousel-wheel-gestures': { default: wheelGestures, wheelGestures, WheelGesturesPlugin: wheelGestures },
};

import {
  loadOptionalModule,
  preloadOptionalModules,
  isOptionalModuleLoaded,
  getLoadedOptionalModule,
  detectRequiredOptionalModules,
} from './optional-modules-registry';

// Cache compiled components by content hash
const codeComponentCache = new Map<string, React.ComponentType<any>>();

/** Cheap content hash — covers the WHOLE source so edits anywhere
 *  invalidate the cache. The previous `code.slice(0, 100)` cache key
 *  missed every edit past byte 100 (which is where the actual JSX
 *  lives in a typical icon-set/component file — past the imports +
 *  annotation comments). Result: editing a vector's color in the
 *  master never invalidated the compiled component, so instances
 *  rendered the stale version forever. */
const fastContentHash = simpleHash;

/**
 * Compile a Code component TSX file to an executable React component.
 * Uses @babel/standalone for TSX → JS, then new Function for execution.
 *
 * If the Component source wraps its export with withResponsiveProps, the compiled
 * component is already responsive-aware (reads __canvasViewportWidth from CodeComponentHost).
 * For legacy Code components without the wrapper, we apply it as a fallback.
 */
// Canvas-only restrictions run in Babel's existing TSX pass, where braces in
// quoted strings, comments, and templates have already been parsed correctly.
const CANVAS_JSX_HANDLER_RE = /^on(?:Mouse(?:Move|Enter|Leave|Down|Up|Over|Out)|Pointer(?:Move|Enter|Leave|Down|Up|Over|Out)|Click|DoubleClick|ContextMenu|Wheel)$/;
const CANVAS_LISTENER_RE = /^(?:mouse\w+|pointer\w+|click|dblclick|contextmenu|wheel)$/;
function canvasInteractionPlugin({ types: t }: any) {
  return {
    visitor: {
      JSXAttribute(path: any) {
        if (t.isJSXIdentifier(path.node.name) && CANVAS_JSX_HANDLER_RE.test(path.node.name.name)) {
          path.remove();
        }
      },
      CallExpression(path: any) {
        const { callee, arguments: args } = path.node;
        if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object)) return;
        if (callee.object.name !== 'window' && callee.object.name !== 'document') return;
        const method = t.isIdentifier(callee.property) && !callee.computed
          ? callee.property.name
          : t.isStringLiteral(callee.property) && callee.computed ? callee.property.value : null;
        if (method !== 'addEventListener' && method !== 'removeEventListener') return;
        if (!t.isStringLiteral(args[0]) || !CANVAS_LISTENER_RE.test(args[0].value)) return;
        path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
      },
    },
  };
}

export function compileCodeComponent(
  code: string,
  componentName: string = 'Component',
  opts?: { previewMode?: boolean; extraModules?: Record<string, any>; skipCache?: boolean },
): React.ComponentType<any> | null {
  // Upgrade legacy VECTOR SET files so an instance SCALES its vector with the box
  // (older files left the inner <svg> at a fixed px size → the vector didn't grow
  // when you resized the instance). Idempotent no-op for everything else.
  code = upgradeVectorSetInstanceBranch(code);
  // Check cache — preview mode gets a separate cache key.
  // Hash the WHOLE source so edits past the file header invalidate.
  const cacheKey = (opts?.previewMode ? 'preview:' : '') + code.length + ':' + fastContentHash(code);
  if (opts?.skipCache) {
    codeComponentCache.delete(cacheKey);
  }
  const cached = codeComponentCache.get(cacheKey);
  if (cached) {
    trace.fn('code-component-runtime:cache-hit', { componentName });
    return cached;
  }

  try {
    const neededOptional = detectRequiredOptionalModules(code);
    neededOptional.forEach((spec) => {
      if (isOptionalModuleLoaded(spec)) {
        MODULE_MAP[spec] = getLoadedOptionalModule(spec);
      }
    });

    // Check if the source already wraps with withResponsiveProps
    const hasNativeResponsive = code.includes('withResponsiveProps');

    // 1. Strip @canvas and @controls comment blocks (not needed at runtime)
    let cleanCode = code
      .replace(/\/\*\*?\s*@canvas\s*\{[\s\S]*?\}\s*\*\/\s*\n?/g, '')
      .replace(/\/\*\*?\s*@label\s*"[^"]*"\s*\*\//g, '')
      .replace(/\/\*\*?\s*@comment\s*"[^"]*"\s*\*\//g, '')
      .replace(/\/\*\*?\s*@controls\s*\{[\s\S]*?\}\s*\*\//g, '');

    // 2. Strip 'use client' directive
    cleanCode = cleanCode.replace(/^['"]use client['"];?\s*\n?/gm, '');

    // 2d. Auto-inject missing framer-motion import. Master files
    // (icon-set / component) can drift into a state where
    // they reference `motion.svg` / `motion.div` etc. but lack the
    // `import { motion } from 'framer-motion'` line — mostly when the
    // edit happened through `modifyProjectFile` before its syncImports
    // pass landed, or when an older generator emitted the prefix
    // unconditionally. Without the import, `motion` is undefined at
    // runtime, the IIFE throws on first access, and EVERY instance of
    // the master renders blank with no error surfaced to the canvas.
    // Detect-and-fill here is a thin safety net so the live preview
    // doesn't break on legacy state — the long-term fix is the
    // generator + syncImports pair, which is already in place.
    // `\s*`, not `\s+`: a minified module writes `from"framer-motion"`, and
    // missing it here injected a SECOND motion binding beside the module's own
    // — "Identifier 'motion' has already been declared", component dead.
    if (/\bmotion\./.test(cleanCode) &&
        !/from\s*['"]framer-motion['"]/.test(cleanCode)) {
      trace.action('code-component-runtime:auto-inject-motion-import', { componentName });
      cleanCode = `import { motion } from 'framer-motion';\n` + cleanCode;
    }

    // Auto-inject missing Children import if code component references Children.<method>
    if (/\bChildren\./.test(cleanCode) &&
        !/import\s+[^;]*\bChildren\b[^;]*from\s*['"]react['"]/.test(cleanCode)) {
      cleanCode = `import { Children } from 'react';\n` + cleanCode;
    }

    // 3. Convert imports to require calls for our module scope
    // Transform: import X from 'mod' → const X = __require('mod').default || __require('mod')
    // Transform: import { a, b } from 'mod' → const { a, b } = __require('mod')
    // Transform: import X, { a, b } from 'mod' → combined
    // SPECIAL: 'import React' is skipped because React is already passed as IIFE parameter
    // An ALIASED named import (`import { jsx as _jsx } from …`) turns into a
    // destructure below, where the rename is spelled `jsx: _jsx`. Left as
    // `as`, the generated line is a syntax error and the whole component
    // fails to compile — which is every published module.
    cleanCode = cleanCode.replace(/import\s*\{([^}]+)\}\s*from/g, (_m, inner: string) =>
      `import {${inner.replace(/([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g, '$1: $2')}} from`);

    // NOTE the `\s*` throughout: a published module is MINIFIED, so it
    // reads `import{useMemo}from"react"` with no space anywhere. Requiring
    // whitespace left every one of those imports untouched, and an `import`
    // inside the IIFE below is a syntax error — so no the reference builder module compiled.
    cleanCode = cleanCode
      .replace(/import\s*React\s*,\s*\{([^}]+)\}\s*from\s*['"]react['"]/g,
        'const {$1} = __require("react")')
      .replace(/import\s+React\s*from\s*['"]react['"]/g, '/* React provided by runtime */')
      // …and the NAMESPACE form of the same thing. React is already in scope
      // as the wrapper's own parameter, so binding it again is
      // `Identifier 'React' has already been declared` and the whole module
      // compiles to null — a published component written
      // `import * as React from "react"` rendered as nothing at all.
      .replace(/import\s*\*\s*as\s+React\s*from\s*['"]react['"]\s*;?/g, '/* React provided by runtime */')
      // `import * as X from "…"` — the namespace form for everything else.
      .replace(/import\s*\*\s*as\s+(\w+)\s*from\s*['"]([^'"]+)['"]/g,
        'const $1 = __require("$2")')
      .replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
        'const $1 = __require("$3").default || __require("$3"); const {$2} = __require("$3")')
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g, 'const {$1} = __require("$2")')
      .replace(/import\s+(\w+)\s*from\s*['"]([^'"]+)['"]/g, 'const $1 = __require("$2").default || __require("$2")')
      // A bare side-effect import has nothing to bind; drop it.
      .replace(/import\s*['"][^'"]+['"]\s*;?/g, '');

    // A NAMED export is legal in a module and a syntax error inside the IIFE
    // below. A publisher appends a metadata export to everything it
    // publishes, so without this no published module compiles — and any user
    // component with a named export failed the same way.
    cleanCode = cleanCode
      .replace(/export\s+(const|let|var|function|class|async|interface|type)\b/g, '$1')
      .replace(/export\s*\{[^}]*\}\s*;?/g, '');

    // 4. Convert export default → variable assignment
    cleanCode = cleanCode.replace(/export\s+default\s+function\s+(\w+)/, 'var __CODE_COMPONENT__ = function $1');
    cleanCode = cleanCode.replace(/export\s+default\s+/, 'var __CODE_COMPONENT__ = ');

    // 4b. Rewrite dynamic import('...') calls to use our injected __import resolver
    cleanCode = cleanCode.replace(/\bimport\s*\(([^)]+)\)/g, '__import($1)');

    // 5. Wrap in IIFE so Babel treats it as a script (not module) and return works
    const wrapped = `(function(__require, __import, React) {\n${cleanCode}\nreturn __CODE_COMPONENT__;\n})`;

    const result = transform(wrapped, {
      presets: ['react', 'typescript'],
      filename: `${componentName}.tsx`,
      plugins: opts?.previewMode ? [] : [canvasInteractionPlugin],
    });

    if (!result.code) throw new Error('Babel transform returned empty code');

    // 6. Create the require function for module resolution
    // In preview mode, override the "is this canvas?" hooks to return false so
    // animations run with full effects in the code component editor's preview pane.
    const useIsCanvasRendererOverride = opts?.previewMode ? () => false : useIsCanvasRenderer;
    const previewOverrides: Record<string, any> = opts?.previewMode ? {
      '@/lib/useIsCanvasRenderer': { default: useIsCanvasRendererOverride, useIsCanvasRenderer: useIsCanvasRendererOverride },
      'lib/useIsCanvasRenderer': { default: useIsCanvasRendererOverride, useIsCanvasRenderer: useIsCanvasRendererOverride },
      // `@revyme/runtime` is mapped above to a spread of the real package +
      // `useStaticCanvas: () => true`. Re-spread here with `() => false` so
      // preview-pane code components animate normally.
      '@revyme/runtime': { ...revymeRuntime, useStaticCanvas: () => false },
    } : {};

    const extraModules = opts?.extraModules || {};
    const __require = (mod: string) => {
      // Check preview overrides first
      if (previewOverrides[mod]) return previewOverrides[mod];
      // Caller-provided modules (e.g. nested component imports for live preview)
      if (extraModules[mod]) return extraModules[mod];
      if (opts?.previewMode && mod === 'next-themes') return previewNextThemes;
      const resolved = MODULE_MAP[mod];
      if (resolved) return resolved;
      const shortMod = mod.replace(/^@\//, '');
      if (previewOverrides[shortMod]) return previewOverrides[shortMod];
      if (extraModules[shortMod]) return extraModules[shortMod];
      if (MODULE_MAP[shortMod]) return MODULE_MAP[shortMod];
      trace.error('code-component-runtime:module-not-found', { module: mod, componentName });
      return {};
    };

    const __import = async (spec: string) => {
      if (MODULE_MAP[spec]) return MODULE_MAP[spec];
      try {
        return await loadOptionalModule(spec);
      } catch {
        return await import(/* @vite-ignore */ spec);
      }
    };
    if (typeof window !== 'undefined') {
      (window as any).__import = __import;
    }

    // 7. Execute — the IIFE returns the component function
    const factory = eval(result.code);

    const instantiateComponent = () => {
      neededOptional.forEach((spec) => {
        MODULE_MAP[spec] = getLoadedOptionalModule(spec);
      });
      let Inner = factory(__require, __import, React);
      const isRenderable = typeof Inner === 'function'
        || (typeof Inner === 'object' && Inner !== null && (Inner as any).$$typeof != null);
      if (!isRenderable) {
        trace.error('code-component-runtime:not-a-component', { componentName, type: typeof Inner });
        return null;
      }
      if (!hasNativeResponsive) {
        Inner = withResponsiveProps(Inner);
        trace.action('code-component-runtime:legacy-wrap', { componentName });
      }
      return Inner;
    };

    let Component: React.ComponentType<any> | null = null;

    if (neededOptional.length > 0 && !neededOptional.every(isOptionalModuleLoaded)) {
      Component = function OptionalDependencyReadinessWrapper(props: any) {
        const [isReady, setIsReady] = React.useState(() => neededOptional.every(isOptionalModuleLoaded));
        const [loadError, setLoadError] = React.useState<string | null>(null);
        const [retryNonce, setRetryNonce] = React.useState(0);
        const compRef = React.useRef<any>(null);

        React.useEffect(() => {
          if (neededOptional.every(isOptionalModuleLoaded)) {
            compRef.current = instantiateComponent();
            setIsReady(true);
            return;
          }
          let cancelled = false;
          setIsReady(false);
          setLoadError(null);

          preloadOptionalModules(neededOptional)
            .then(() => {
              if (cancelled) return;
              compRef.current = instantiateComponent();
              setIsReady(true);
            })
            .catch((err) => {
              if (!cancelled) {
                setLoadError(err?.message || 'Failed to load optional module');
              }
            });

          return () => {
            cancelled = true;
          };
        }, [retryNonce]);

        if (loadError) {
          return React.createElement(
            'div',
            {
              'data-id': props['data-id'],
              'data-name': props['data-name'],
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                color: '#f87171',
                fontSize: 12,
                gap: 8,
                ...props.style,
              },
            },
            React.createElement('span', null, `Error loading 3D library: ${loadError}`),
            React.createElement(
              'button',
              {
                onClick: () => setRetryNonce((n) => n + 1),
                style: {
                  padding: '4px 10px',
                  fontSize: 11,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#fff',
                  cursor: 'pointer',
                },
              },
              'Retry'
            )
          );
        }

        if (!isReady || !compRef.current) {
          return React.createElement(
            'div',
            {
              'data-id': props['data-id'],
              'data-name': props['data-name'],
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                color: '#888',
                fontSize: 12,
                ...props.style,
              },
            },
            'Loading 3D engine...'
          );
        }

        return React.createElement(compRef.current, props);
      };
    } else {
      Component = instantiateComponent();
    }

    if (!Component) return null;

    if (opts?.previewMode) {
      const PreviewComponent = Component;
      Component = function InteractiveCodeComponent(props: any) {
        return React.createElement(PreviewThemeBoundary, null, React.createElement(PreviewComponent, props));
      };
    }

    trace.action('code-component-runtime:compiled', { componentName, codeLength: code.length, nativeResponsive: hasNativeResponsive });
    codeComponentCache.set(cacheKey, Component);
    return Component;
  } catch (err: any) {
    trace.error('code-component-runtime:compile-failed', { componentName, error: err.message });
    return null;
  }
}

/** Clear the code component compilation cache (call when component source changes) */
export function clearCodeComponentCache(): void {
  codeComponentCache.clear();
  trace.action('code-component-runtime:cache-cleared');
}
