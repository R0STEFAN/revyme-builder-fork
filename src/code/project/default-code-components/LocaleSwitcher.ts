// LocaleSwitcher — Code component template (globe icon + native <select>).
//
// THIRD-PARTY: the globe glyph is from Feather Icons by Cole Bemis
// (https://github.com/feathericons/feather), MIT. Attribution is repeated
// inside the template literal so it travels into projects this component is
// inserted into. See also the NOTICE file.
//
// On the canvas: renders the icon and the select. Clicks dispatch the
// `locale-change` event for parity with the live site, but the canvas has
// its own locale switcher in the editor chrome (LocalePanel) so the visual
// is what matters here.
//
// On the live site: reads the active locale from next-intl (`useLocale`)
// when the provider is mounted, falling back to `localStorage` otherwise.
// Switching dispatches the `locale-change` event picked up by
// `app/providers.tsx`'s NextIntlClientProvider wrapper, which re-renders
// the tree with the new messages dictionary.

export const LOCALE_SWITCHER_COMPONENT = `'use client';

// Globe glyph from Feather Icons (https://github.com/feathericons/feather)
// Copyright (c) 2013-2023 Cole Bemis — MIT License.
// The full MIT permission notice is reproduced in the Revyme NOTICE file.

/** @label "Locale Switcher" */
/** @comment "Globe icon + select. Switches locale via the next-intl provider in app/providers.tsx — uses useLocale() and dispatches a 'locale-change' window event." */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "locales": { "type": "text", "label": "Locales (comma)", "default": "en, fr, es" },
  "size": { "type": "number", "label": "Icon Size", "min": 12, "max": 32, "step": 1, "default": 16 },
  "color": { "type": "color", "label": "Color", "default": "currentColor" },
  "background": { "type": "color", "label": "Background", "default": "transparent" },
  "borderRadius": { "type": "number", "label": "Radius", "min": 0, "max": 32, "step": 1, "default": 8, "unit": "px" }
} */

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useStaticCanvas, withResponsiveProps } from '@revyme/runtime';

function LocaleSwitcher({
  locales = 'en, fr, es',
  size = 16,
  color = 'currentColor',
  background = 'transparent',
  borderRadius = 8,
  ...props
}) {
  const localeList = String(locales)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const providerLocale = useLocale();
  const isCanvas = useStaticCanvas();
  let pathname = '/';
  try {
    pathname = usePathname() || '/';
  } catch {}
  const initialLocale = localeList.indexOf(providerLocale) >= 0
    ? providerLocale
    : (localeList[0] || 'en');
  const [current, setCurrent] = useState(initialLocale);

  useEffect(() => {
    setCurrent(initialLocale);
    if (document.documentElement.lang !== initialLocale) {
      document.documentElement.lang = initialLocale;
    }
  }, [providerLocale, locales]);

  const handleCanvasChange = (next) => {
    setCurrent(next);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('locale', next); } catch {}
      document.documentElement.lang = next;
      window.dispatchEvent(new CustomEvent('locale-change', { detail: { locale: next } }));
    }
  };

  const buildTargetHref = (target) => {
    const segments = pathname.split('/').filter(Boolean);
    const first = segments[0];
    const isFirstLocale = localeList.includes(first);
    const barePath = isFirstLocale
      ? '/' + segments.slice(1).join('/')
      : pathname;
    const cleanBare = (barePath === '' || barePath === '//') ? '/' : barePath;
    const defaultLocale = localeList[0] || 'en';
    const isDefault = target === defaultLocale;
    const baseTarget = isDefault
      ? cleanBare
      : (cleanBare === '/' ? ('/' + target) : ('/' + target + cleanBare));

    if (typeof window !== 'undefined') {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      return baseTarget + search + hash;
    }
    return baseTarget;
  };

  return (
    <div
      data-id={props['data-id']}
      data-name={props['data-name']}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background,
        borderRadius,
        color,
        ...props.style,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      {isCanvas ? (
        <select
          aria-label="Select language"
          value={current}
          onChange={(e) => handleCanvasChange(e.target.value)}
          style={{
            background: 'transparent',
            color: 'currentColor',
            border: 'none',
            cursor: 'pointer',
            font: 'inherit',
            textTransform: 'uppercase',
            outline: 'none',
          }}
        >
          {localeList.map((l) => (
            <option key={l} value={l} style={{ color: '#000' }}>{l}</option>
          ))}
        </select>
      ) : (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {localeList.map((l) => {
            const isCurrent = l === current;
            const targetHref = buildTargetHref(l);
            return (
              <a
                key={l}
                href={targetHref}
                data-no-vt=""
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  try { window.localStorage.setItem('locale', l); } catch {}
                }}
                style={{
                  color: 'currentColor',
                  opacity: isCurrent ? 1 : 0.6,
                  fontWeight: isCurrent ? 700 : 400,
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {l}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default withResponsiveProps(LocaleSwitcher);
`;
