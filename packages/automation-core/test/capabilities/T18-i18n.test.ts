// packages/automation-core/test/capabilities/T18-i18n.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { runCase } from '../fixture';
import {
  localesGetOperation,
  localesAddOperation,
  localesRemoveOperation,
  localesSetDefaultOperation,
  localesUpdateOperation,
  localesRoutesSyncOperation,
  localesSwitcherAddOperation,
} from '../../src/operations/locales';
import {
  translationsListOperation,
  translationsSetOperation,
  translationsAttributeSetOperation,
  translationsNodeOverrideSetOperation,
  translationsCmsItemSetOperation,
  translationsStyleSetOperation,
  translationsInstancePropSetOperation,
  translationsDeleteOperation,
} from '../../src/operations/translations';
import { projectFS } from '@/code/project/project-fs';
import { isRtlLocale } from '@/shared/rtl-text';
import { LOCALE_ROUTE_MARKER } from '@/code/project/locale-route-ops';

const BASE_PAGE = `'use client';
import React from 'react';

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <header data-id="header">
        <h1 data-id="hero-title">Welcome to Revyme</h1>
        <p data-id="hero-sub">Build stunning web applications visually</p>
      </header>
      <div data-id="search-container">
        <input data-id="search-input" placeholder="Search resources..." />
      </div>
    </div>
  );
}
`;

const ABOUT_PAGE = `'use client';
import React from 'react';

export default function AboutPage() {
  return (
    <div data-id="about-root" style={{ padding: '32px' }}>
      <h1 data-id="about-title">About Our Mission</h1>
      <p data-id="about-desc">Empowering creators worldwide.</p>
    </div>
  );
}
`;

const CARD_COMPONENT = `'use client';
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

/** @controls { "title": { "type": "text", "default": "Card Title" } } */
function Card({ title = "Card Title", ...props }: { title?: string; [k: string]: any }) {
  return (
    <div data-id={props['data-id']} style={{ padding: '16px', border: '1px solid #ddd' }}>
      <h3 data-id="card-h">{title}</h3>
    </div>
  );
}

export default withResponsiveProps(Card);
`;

const PAGE_WITH_INSTANCE = `'use client';
import React from 'react';
import Card from '@/components/Card';

export default function FeaturesPage() {
  return (
    <div data-id="feat-root">
      <h1 data-id="feat-heading">Features</h1>
      <Card data-id="card-inst-1" title="Feature One" />
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

const mockContext = createOperationContext();

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

describe('T18: Localization, Locale Routes, Direction & Translations', () => {
  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Locale CRUD, Defaults, Direction & Route Wrappers
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Locale Configuration & Routes Lifecycle', () => {
    it('reads default configuration when no i18n/config.json exists', async () => {
      const snap = createMockSnapshot({});
      const res = await localesGetOperation.execute(snap, {}, mockContext);

      expect(res.defaultLocale).toBe('en');
      expect(res.locales).toHaveLength(1);
      expect(res.locales[0].code).toBe('en');
      expect(res.locales[0].direction).toBe('ltr');
      expect(res.locales[0].isRtl).toBe(false);
    });

    it('adds multiple locales (LTR Ukrainian and RTL Arabic) with route wrappers and providers', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
        'app/(Body)/about/page.client.tsx': ABOUT_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      // 1. Add Ukrainian locale (LTR, fallback en)
      const ukRes = await localesAddOperation.execute(
        snap,
        {
          code: 'uk',
          label: 'Українська',
          direction: 'ltr',
          fallback: 'en',
        },
        mockContext,
      );

      expect(ukRes.code).toBe('uk');
      expect(ukRes.label).toBe('Українська');
      expect(ukRes.isRtl).toBe(false);
      applyChanges(mutableFiles, ukRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Verify files generated
      expect(mutableFiles.has('i18n/config.json')).toBe(true);
      expect(mutableFiles.has('i18n/uk.json')).toBe(true);
      expect(mutableFiles.has('messages/uk.json')).toBe(true);
      expect(mutableFiles.has('app/providers.tsx')).toBe(true);
      expect(mutableFiles.has('app/uk/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/(Body)/uk/about/page.tsx')).toBe(true);

      const ukRouteContent = mutableFiles.get('app/(Body)/uk/about/page.tsx')!;
      expect(ukRouteContent).toContain(LOCALE_ROUTE_MARKER);
      expect(ukRouteContent).toContain("export { default } from '@/app/(Body)/about/page'");
      expect(ukRouteContent).toContain("canonical: '/uk/about'");

      // 2. Add Arabic locale (RTL automatically inferred or explicit)
      const arRes = await localesAddOperation.execute(
        snap,
        {
          code: 'ar',
          label: 'العربية',
          direction: 'rtl',
        },
        mockContext,
      );

      expect(arRes.code).toBe('ar');
      expect(arRes.isRtl).toBe(true);
      applyChanges(mutableFiles, arRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const providersSrc = mutableFiles.get('app/providers.tsx')!;
      expect(providersSrc).toContain("import arMessages from '@/messages/ar.json'");
      expect(providersSrc).toContain("import ukMessages from '@/messages/uk.json'");
      expect(providersSrc).toContain("const RTL_TEXT_CSS =");

      // Verify route wrapper for Arabic
      expect(mutableFiles.has('app/ar/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/(Body)/ar/about/page.tsx')).toBe(true);

      // Verify locales.get reports both
      const listRes = await localesGetOperation.execute(snap, {}, mockContext);
      expect(listRes.locales).toHaveLength(3);
      const arConfig = listRes.locales.find((l) => l.code === 'ar');
      expect(arConfig).toBeDefined();
      expect(arConfig?.direction).toBe('rtl');
      expect(arConfig?.isRtl).toBe(true);
    });

    it('updates existing locale metadata with locales.update', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'fr', label: 'French' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const updateRes = await localesUpdateOperation.execute(
        snap,
        {
          code: 'fr',
          label: 'Français (France)',
          fallback: 'en',
        },
        mockContext,
      );

      expect(updateRes.label).toBe('Français (France)');
      applyChanges(mutableFiles, updateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listRes = await localesGetOperation.execute(snap, {}, mockContext);
      const fr = listRes.locales.find((l) => l.code === 'fr');
      expect(fr?.label).toBe('Français (France)');
      expect(fr?.fallback).toBe('en');
    });

    it('switches default locale with locales.setDefault and syncs route wrappers', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'de', label: 'Deutsch' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      expect(mutableFiles.has('app/de/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/en/page.tsx')).toBe(false);

      // Switch default to 'de'
      const setDefRes = await localesSetDefaultOperation.execute(snap, { code: 'de' }, mockContext);
      expect(setDefRes.defaultLocale).toBe('de');
      applyChanges(mutableFiles, setDefRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listRes = await localesGetOperation.execute(snap, {}, mockContext);
      expect(listRes.defaultLocale).toBe('de');

      // Now 'en' needs a wrapper /en/page.tsx, and 'de' route wrapper should be pruned
      expect(mutableFiles.has('app/en/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/de/page.tsx')).toBe(false);
    });

    it('removes a locale, cleans up overrides, and prunes orphan routes', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'es', label: 'Español' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      expect(mutableFiles.has('app/es/page.tsx')).toBe(true);
      expect(mutableFiles.has('i18n/es.json')).toBe(true);

      // Remove 'es'
      const remRes = await localesRemoveOperation.execute(snap, { code: 'es' }, mockContext);
      expect(remRes.code).toBe('es');
      applyChanges(mutableFiles, remRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      expect(mutableFiles.has('app/es/page.tsx')).toBe(false);
      expect(mutableFiles.has('i18n/es.json')).toBe(false);

      const listRes = await localesGetOperation.execute(snap, {}, mockContext);
      expect(listRes.locales.some((l) => l.code === 'es')).toBe(false);
    });

    it('installs LocaleSwitcher code component and inserts instance via locales.switcher.add', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const switcherRes = await localesSwitcherAddOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          parentId: 'header',
        },
        mockContext,
      );

      expect(switcherRes.component).toBe('LocaleSwitcher');
      expect(switcherRes.instanceId).toBeDefined();
      applyChanges(mutableFiles, switcherRes.changes);

      expect(mutableFiles.has('components/LocaleSwitcher.tsx')).toBe(true);
      const updatedPage = mutableFiles.get('app/page.client.tsx')!;
      expect(updatedPage).toContain("import LocaleSwitcher from '@/components/LocaleSwitcher';");
      expect(updatedPage).toContain(`<LocaleSwitcher data-id="${switcherRes.instanceId}"`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Translations: Listing, Setting, Attributes, Overrides & Styles
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Translations Pipeline', () => {
    it('lists translatable texts across pages with fallback values and translations', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(snap, { code: 'fr', label: 'French' }, mockContext);
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listRes = await translationsListOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        mockContext,
      );

      expect(listRes.defaultLocale).toBe('en');
      expect(listRes.locales).toContain('en');
      expect(listRes.locales).toContain('fr');
      expect(listRes.texts.length).toBeGreaterThanOrEqual(2);

      const heroTitle = listRes.texts.find((t) => t.nodeId === 'hero-title');
      expect(heroTitle).toBeDefined();
      expect(heroTitle?.source).toBe('Welcome to Revyme');
      expect(heroTitle?.translations.en).toBe('Welcome to Revyme');
    });

    it('commits translations, writes messages/{locale}.json and transforms JSX to {t()}', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'it', label: 'Italiano' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const setRes = await translationsSetOperation.execute(
        snap,
        {
          locale: 'it',
          items: [
            {
              filePath: 'app/page.client.tsx',
              nodeId: 'hero-title',
              text: 'Benvenuti in Revyme',
            },
            {
              filePath: 'app/page.client.tsx',
              nodeId: 'hero-sub',
              text: 'Costruisci splendide applicazioni web visivamente',
            },
          ],
        },
        mockContext,
      );

      expect(setRes.written).toBe(2);
      expect(setRes.locale).toBe('it');
      applyChanges(mutableFiles, setRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Verify messages files
      const itMsgs = JSON.parse(mutableFiles.get('messages/it.json')!);
      expect(itMsgs.home['hero-title']).toBe('Benvenuti in Revyme');
      expect(itMsgs.home['hero-sub']).toBe('Costruisci splendide applicazioni web visivamente');

      const enMsgs = JSON.parse(mutableFiles.get('messages/en.json')!);
      expect(enMsgs.home['hero-title']).toBe('Welcome to Revyme');

      // Verify page JSX was transformed to {t(...)}
      const transformedJsx = mutableFiles.get('app/page.client.tsx')!;
      expect(transformedJsx).toContain('{t("hero-title")}');
      expect(transformedJsx).toContain('{t("hero-sub")}');
      expect(transformedJsx).toContain('useTranslations');
      expect(transformedJsx).toContain('next-intl');

      // Verify translations.list reflects the new translation
      const listRes = await translationsListOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        mockContext,
      );
      const titleEntry = listRes.texts.find((t) => t.nodeId === 'hero-title');
      expect(titleEntry?.translations.it).toBe('Benvenuti in Revyme');
    });

    it('translates HTML attributes (placeholder) via translations.attribute.set', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'pt', label: 'Português' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const attrRes = await translationsAttributeSetOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: 'search-input',
          attr: 'placeholder',
          locale: 'pt',
          text: 'Buscar recursos...',
        },
        mockContext,
      );

      expect(attrRes.nodeId).toBe('search-input');
      expect(attrRes.attr).toBe('placeholder');
      expect(attrRes.locale).toBe('pt');
      applyChanges(mutableFiles, attrRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Messages check
      const ptMsgs = JSON.parse(mutableFiles.get('messages/pt.json')!);
      expect(ptMsgs.home['search-input__attr_placeholder']).toBe('Buscar recursos...');

      const enMsgs = JSON.parse(mutableFiles.get('messages/en.json')!);
      expect(enMsgs.home['search-input__attr_placeholder']).toBe('Search resources...');

      // JSX check
      const transformedJsx = mutableFiles.get('app/page.client.tsx')!;
      expect(transformedJsx).toContain('placeholder={t("search-input__attr_placeholder")}');
    });

    it('persists node style/prop/visibility overrides in i18n/{locale}.json', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'ja', label: '日本語' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const overrideRes = await translationsNodeOverrideSetOperation.execute(
        snap,
        {
          locale: 'ja',
          filePath: 'app/page.client.tsx',
          nodeId: 'hero-title',
          override: {
            visible: true,
            styles: { fontSize: '36px', lineHeight: '1.4' },
            props: { customData: 'jp-val' },
          },
        },
        mockContext,
      );

      expect(overrideRes.nodeId).toBe('hero-title');
      applyChanges(mutableFiles, overrideRes.changes);

      const jaOverrides = JSON.parse(mutableFiles.get('i18n/ja.json')!);
      expect(jaOverrides.pages['app/page.client.tsx']['hero-title'].styles.fontSize).toBe('36px');
      expect(jaOverrides.pages['app/page.client.tsx']['hero-title'].styles.lineHeight).toBe('1.4');
      expect(jaOverrides.pages['app/page.client.tsx']['hero-title'].props.customData).toBe('jp-val');
    });

    it('persists localized CMS collection item field overrides in i18n/{locale}.json', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'pl', label: 'Polski' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const cmsRes = await translationsCmsItemSetOperation.execute(
        snap,
        {
          locale: 'pl',
          collection: 'articles',
          itemId: 'article-101',
          fieldOverrides: {
            title: 'Wstęp do nowoczesnego projektowania stron',
            summary: 'Kompleksowy poradnik.',
          },
        },
        mockContext,
      );

      expect(cmsRes.collection).toBe('articles');
      expect(cmsRes.itemId).toBe('article-101');
      applyChanges(mutableFiles, cmsRes.changes);

      const plOverrides = JSON.parse(mutableFiles.get('i18n/pl.json')!);
      expect(plOverrides.collections.articles['article-101'].title).toBe(
        'Wstęp do nowoczesnego projektowania stron',
      );
      expect(plOverrides.collections.articles['article-101'].summary).toBe('Kompleksowy poradnik.');
    });

    it('writes localized style rules via translations.style.set', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'nl', label: 'Nederlands' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const styleRes = await translationsStyleSetOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: 'hero-title',
          locale: 'nl',
          styles: { fontSize: '28px', color: '#0055ff' },
        },
        mockContext,
      );

      expect(styleRes.nodeId).toBe('hero-title');
      applyChanges(mutableFiles, styleRes.changes);

      const updatedCode = mutableFiles.get('app/page.client.tsx')!;
      expect(updatedCode).toContain(':lang(nl)');
      expect(updatedCode).toContain('[data-id="hero-title"]');
      expect(updatedCode).toContain('font-size: 28px !important');
      expect(updatedCode).toContain('color: #0055ff !important');
    });

    it('updates localized instance props via translations.instanceProp.set', async () => {
      const files: Record<string, string> = {
        'components/Card.tsx': CARD_COMPONENT,
        'app/features/page.client.tsx': PAGE_WITH_INSTANCE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'fr', label: 'Français' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const propRes = await translationsInstancePropSetOperation.execute(
        snap,
        {
          filePath: 'app/features/page.client.tsx',
          nodeId: 'card-inst-1',
          componentName: 'Card',
          prop: 'title',
          locale: 'fr',
          value: 'Fonctionnalité Une',
        },
        mockContext,
      );

      expect(propRes.nodeId).toBe('card-inst-1');
      expect(propRes.prop).toBe('title');
      expect(propRes.locale).toBe('fr');
      applyChanges(mutableFiles, propRes.changes);

      const code = mutableFiles.get('app/features/page.client.tsx')!;
      expect(code).toContain('__activeLocale');
      expect(code).toContain('Fonctionnalité Une');
    });

    it('deletes translation keys with translations.delete', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const addRes = await localesAddOperation.execute(
        snap,
        { code: 'sv', label: 'Svenska' },
        mockContext,
      );
      applyChanges(mutableFiles, addRes.changes);

      projectFS.writeFile('messages/sv.json', JSON.stringify({ home: { 'old-key': 'Gammal text' } }));
      mutableFiles.set('messages/sv.json', JSON.stringify({ home: { 'old-key': 'Gammal text' } }));
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const delRes = await translationsDeleteOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: 'old-key',
          locale: 'sv',
        },
        mockContext,
      );

      expect(delRes.nodeId).toBe('old-key');
      applyChanges(mutableFiles, delRes.changes);

      const svMsgs = JSON.parse(mutableFiles.get('messages/sv.json')!);
      expect(svMsgs.home?.['old-key']).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Boundary & Error Conditions
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Boundary & Error Scenarios', () => {
    it('throws error when adding duplicate locale', async () => {
      const snap = createMockSnapshot({});
      await localesAddOperation.execute(snap, { code: 'fr', label: 'French' }, mockContext);

      await expect(
        localesAddOperation.execute(snap, { code: 'fr', label: 'French duplicate' }, mockContext),
      ).rejects.toThrow(/already exists/i);
    });

    it('throws error when attempting to remove the default active locale', async () => {
      const snap = createMockSnapshot({});
      await expect(
        localesRemoveOperation.execute(snap, { code: 'en' }, mockContext),
      ).rejects.toThrow(/cannot remove the default locale/i);
    });

    it('throws error when setting default locale to unconfigured code', async () => {
      const snap = createMockSnapshot({});
      await expect(
        localesSetDefaultOperation.execute(snap, { code: 'non-existent' }, mockContext),
      ).rejects.toThrow(/not configured/i);
    });

    it('throws error when setting translation on the default locale', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': BASE_PAGE,
      });

      await expect(
        translationsSetOperation.execute(
          snap,
          {
            locale: 'en',
            items: [
              {
                filePath: 'app/page.client.tsx',
                nodeId: 'hero-title',
                text: 'New English Title',
              },
            ],
          },
          mockContext,
        ),
      ).rejects.toThrow(/cannot set translations for default locale/i);
    });

    it('throws error when operating on unconfigured locale in translations', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': BASE_PAGE,
      });

      await expect(
        translationsSetOperation.execute(
          snap,
          {
            locale: 'unconfigured-loc',
            items: [
              {
                filePath: 'app/page.client.tsx',
                nodeId: 'hero-title',
                text: 'Text',
              },
            ],
          },
          mockContext,
        ),
      ).rejects.toThrow(/not configured/i);
    });

    it('throws error when translating attribute on non-existent node', async () => {
      const files: Record<string, string> = {
        'app/page.client.tsx': BASE_PAGE,
      };
      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));
      const addRes = await localesAddOperation.execute(snap, { code: 'fr', label: 'French' }, mockContext);
      applyChanges(mutableFiles, addRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      await expect(
        translationsAttributeSetOperation.execute(
          snap,
          {
            filePath: 'app/page.client.tsx',
            nodeId: 'ghost-element',
            attr: 'placeholder',
            locale: 'fr',
            text: 'Test',
          },
          mockContext,
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. End-to-End Orchestration via runCase
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. runCase Orchestration', () => {
    it('executes multi-step localization pipeline with snapshot verification', async () => {
      const result = await runCase({
        seed: 'complete',
        steps: [
          {
            tool: 'locales.add',
            input: {
              code: 'uk',
              label: 'Українська',
              direction: 'ltr',
              fallback: 'en',
            },
            expectedStatus: 'ok',
          },
          {
            tool: 'translations.set',
            input: {
              locale: 'uk',
              items: [
                {
                  filePath: 'app/about/page.tsx',
                  nodeId: 'about-title',
                  text: 'Про нашу місію',
                },
              ],
            },
            expectedStatus: 'ok',
          },
          {
            tool: 'locales.switcher.add',
            input: {
              filePath: 'app/page.tsx',
              parentId: 'page-root',
            },
            expectedStatus: 'ok',
          },
        ],
        expect: {
          ok: true,
          changedFiles: [
            'i18n/config.json',
            'i18n/uk.json',
            'messages/uk.json',
            'app/about/page.tsx',
            'app/page.tsx',
            'components/LocaleSwitcher.tsx',
          ],
        },
      });

      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.ok)).toBe(true);

      const aboutContent = result.snapshot.files.get('app/about/page.tsx')!;
      expect(aboutContent).toContain('{t("about-title")}');

      const pageContent = result.snapshot.files.get('app/page.tsx')!;
      expect(pageContent).toContain("<LocaleSwitcher");

      const ukMsgs = JSON.parse(result.snapshot.files.get('messages/uk.json')!);
      expect(ukMsgs.about['about-title']).toBe('Про нашу місію');
    });
  });
});
