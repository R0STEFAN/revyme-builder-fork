import { describe, it, expect } from 'vitest';
import {
  stripLocale,
  localizePath,
  localizeHref,
  isSpecialOrExternalHref,
  isSystemOrAssetPath,
} from './locale-routing';

describe('locale-routing', () => {
  const LOCALES = ['uk', 'en', 'fr'];
  const DEFAULT_LOCALE = 'uk';

  describe('stripLocale', () => {
    it('strips configured leading locale segment', () => {
      expect(stripLocale('/en/gallery', LOCALES)).toBe('/gallery');
      expect(stripLocale('/uk/about/team', LOCALES)).toBe('/about/team');
      expect(stripLocale('/fr', LOCALES)).toBe('/');
      expect(stripLocale('/en/', LOCALES)).toBe('/');
    });

    it('returns bare path unchanged when no locale segment is present', () => {
      expect(stripLocale('/', LOCALES)).toBe('/');
      expect(stripLocale('/gallery', LOCALES)).toBe('/gallery');
      expect(stripLocale('/blog/dragon', LOCALES)).toBe('/blog/dragon');
    });

    it('does not strip partial word matches', () => {
      expect(stripLocale('/enterprise', LOCALES)).toBe('/enterprise');
      expect(stripLocale('/ukraine/today', LOCALES)).toBe('/ukraine/today');
      expect(stripLocale('/french-fries', LOCALES)).toBe('/french-fries');
    });

    it('handles paths without leading slash gracefully', () => {
      expect(stripLocale('en/gallery', LOCALES)).toBe('/gallery');
      expect(stripLocale('gallery', LOCALES)).toBe('/gallery');
    });
  });

  describe('localizePath', () => {
    it('returns bare pathname for default locale', () => {
      expect(localizePath('/', 'uk', DEFAULT_LOCALE)).toBe('/');
      expect(localizePath('/gallery', 'uk', DEFAULT_LOCALE)).toBe('/gallery');
      expect(localizePath('/blog/dragon', 'uk', DEFAULT_LOCALE)).toBe('/blog/dragon');
    });

    it('adds locale prefix for secondary locales without trailing slash', () => {
      expect(localizePath('/', 'en', DEFAULT_LOCALE)).toBe('/en');
      expect(localizePath('/gallery', 'en', DEFAULT_LOCALE)).toBe('/en/gallery');
      expect(localizePath('/blog/dragon', 'en', DEFAULT_LOCALE)).toBe('/en/blog/dragon');
    });
  });

  describe('isSpecialOrExternalHref', () => {
    it('identifies external and protocol URLs', () => {
      expect(isSpecialOrExternalHref('https://example.com')).toBe(true);
      expect(isSpecialOrExternalHref('http://example.com/foo')).toBe(true);
      expect(isSpecialOrExternalHref('//cdn.example.com/img.jpg')).toBe(true);
      expect(isSpecialOrExternalHref('mailto:info@revyme.app')).toBe(true);
      expect(isSpecialOrExternalHref('tel:+380991234567')).toBe(true);
      expect(isSpecialOrExternalHref('javascript:void(0)')).toBe(true);
      expect(isSpecialOrExternalHref('#section')).toBe(true);
    });

    it('returns false for internal paths', () => {
      expect(isSpecialOrExternalHref('/gallery')).toBe(false);
      expect(isSpecialOrExternalHref('/about#contact')).toBe(false);
      expect(isSpecialOrExternalHref('/blog/dragon?page=1')).toBe(false);
    });
  });

  describe('isSystemOrAssetPath', () => {
    it('identifies API, system endpoints and common static assets', () => {
      expect(isSystemOrAssetPath('/api/cms/query')).toBe(true);
      expect(isSystemOrAssetPath('/_next/static/chunks/main.js')).toBe(true);
      expect(isSystemOrAssetPath('/robots.txt')).toBe(true);
      expect(isSystemOrAssetPath('/sitemap.xml')).toBe(true);
      expect(isSystemOrAssetPath('/favicon.ico')).toBe(true);
      expect(isSystemOrAssetPath('/hero-banner.webp')).toBe(true);
      expect(isSystemOrAssetPath('/assets/icon.svg')).toBe(true);
    });

    it('distinguishes dotted CMS record slugs from assets', () => {
      expect(isSystemOrAssetPath('/blog/release-v2.0')).toBe(false);
      expect(isSystemOrAssetPath('/gallery/project.item.1')).toBe(false);
    });
  });

  describe('localizeHref', () => {
    it('rewrites internal paths for secondary locale', () => {
      expect(localizeHref('/gallery', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/en/gallery');
      expect(localizeHref('/', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/en');
    });

    it('rewrites internal paths for default locale to bare path', () => {
      expect(localizeHref('/gallery', 'uk', DEFAULT_LOCALE, LOCALES)).toBe('/gallery');
      expect(localizeHref('/en/gallery', 'uk', DEFAULT_LOCALE, LOCALES)).toBe('/gallery');
    });

    it('preserves query parameters and hashes', () => {
      expect(localizeHref('/gallery?sort=new#reviews', 'en', DEFAULT_LOCALE, LOCALES))
        .toBe('/en/gallery?sort=new#reviews');
      expect(localizeHref('/en/gallery?sort=new#reviews', 'uk', DEFAULT_LOCALE, LOCALES))
        .toBe('/gallery?sort=new#reviews');
    });

    it('prevents double prefixing', () => {
      expect(localizeHref('/en/gallery', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/en/gallery');
      expect(localizeHref('/fr/about', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/en/about');
    });

    it('leaves external and protocol hrefs untouched', () => {
      expect(localizeHref('https://example.com/gallery', 'en', DEFAULT_LOCALE, LOCALES)).toBe('https://example.com/gallery');
      expect(localizeHref('mailto:test@example.com', 'en', DEFAULT_LOCALE, LOCALES)).toBe('mailto:test@example.com');
      expect(localizeHref('#top', 'en', DEFAULT_LOCALE, LOCALES)).toBe('#top');
    });

    it('leaves static assets and APIs untouched', () => {
      expect(localizeHref('/api/cms/query', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/api/cms/query');
      expect(localizeHref('/logo.svg', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/logo.svg');
      expect(localizeHref('/robots.txt', 'en', DEFAULT_LOCALE, LOCALES)).toBe('/robots.txt');
    });

    it('supports Next.js Link URL object format', () => {
      const input = { pathname: '/gallery', query: { tab: 'art' } };
      const result = localizeHref(input, 'en', DEFAULT_LOCALE, LOCALES);
      expect(result).toEqual({ pathname: '/en/gallery', query: { tab: 'art' } });
    });
  });
});
