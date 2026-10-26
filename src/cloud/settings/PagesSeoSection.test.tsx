import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createStore, Provider, atom } from 'jotai';

const fsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@/code/project/project-fs', () => ({
  projectVersionAtom: atom(0),
  projectFS: {
    readFile: vi.fn((path: string) => fsStore.get(path) ?? null),
    writeFile: vi.fn((path: string, content: string) => { fsStore.set(path, content); }),
    deleteFile: vi.fn((path: string) => { fsStore.delete(path); }),
    listFiles: vi.fn((dir?: string) => {
      const prefix = dir ? (dir.endsWith('/') ? dir : dir + '/') : '';
      const result: string[] = [];
      for (const path of fsStore.keys()) {
        if (!prefix || path.startsWith(prefix)) result.push(path);
      }
      return result.sort();
    }),
    exists: vi.fn((path: string) => fsStore.has(path)),
  },
}));

vi.mock('@/code/project/modify-file', () => ({
  modifyProjectFile: vi.fn((path: string, fn: (code: string) => string) => {
    const cur = fsStore.get(path) ?? '';
    fsStore.set(path, fn(cur));
  }),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

import PagesSeoSection from './PagesSeoSection';
import { activeLocaleAtom, i18nConfigAtom, isDefaultLocaleAtom } from '@/code/stores/locale-store';
import { selectedSeoPageAtom } from '@/code/stores/website-settings-store';
import { migrateLegacyTemplateTranslations } from '@/code/project/translation-ops';

describe('PagesSeoSection localization round-trip', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    fsStore.clear();
    store = createStore();

    // Setup i18n config: default uk, secondary en
    fsStore.set('i18n/config.json', JSON.stringify({
      defaultLocale: 'uk',
      locales: [
        { code: 'uk', label: 'Ukrainian' },
        { code: 'en', label: 'English' },
      ],
    }));

    // Setup page pair
    fsStore.set('app/gallery/page.client.tsx', `'use client';
export default function GalleryClient() {
  return <div data-id="root">Галерея</div>;
}`);

    fsStore.set('app/gallery/page.tsx', `import PageClient from './page.client';

export const metadata = {
  title: 'Галерея робіт',
  description: 'Оригінальні картини',
};

export default function Page() {
  return <PageClient />;
}`);

    fsStore.set('messages/uk.json', '{}');
    fsStore.set('messages/en.json', '{}');

    store.set(selectedSeoPageAtom, 'app/gallery/page.client.tsx');
  });

  it('default locale: edits round-trip directly into page.tsx metadata', async () => {
    store.set(activeLocaleAtom, 'uk');

    const { container } = render(
      <Provider store={store}>
        <PagesSeoSection />
      </Provider>
    );

    const titleInput = container.querySelector('#seo-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Галерея робіт');

    fireEvent.change(titleInput, { target: { value: 'Галерея робіт (Оновлено)' } });
    expect(titleInput.value).toBe('Галерея робіт (Оновлено)');

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    const updatedCode = fsStore.get('app/gallery/page.tsx')!;
    expect(updatedCode).toContain('Галерея робіт (Оновлено)');

    // messages/en.json remains empty
    expect(fsStore.get('messages/en.json')).toBe('{}');
  });

  it('secondary locale: saves English title to messages/en.json without touching page.tsx', async () => {
    store.set(activeLocaleAtom, 'en');

    const { container } = render(
      <Provider store={store}>
        <PagesSeoSection />
      </Provider>
    );

    const titleInput = container.querySelector('#seo-title') as HTMLInputElement;
    // Value is empty because no override has been set yet
    expect(titleInput.value).toBe('');
    // Placeholder reflects default Ukrainian title
    expect(titleInput.placeholder).toBe('Галерея робіт');

    // Type English override
    fireEvent.change(titleInput, { target: { value: 'Art Gallery' } });
    expect(titleInput.value).toBe('Art Gallery');

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    // page.tsx MUST be completely unchanged
    const code = fsStore.get('app/gallery/page.tsx')!;
    expect(code).toContain("'Галерея робіт'");
    expect(code).not.toContain('Art Gallery');

    // messages/en.json MUST contain the override under gallery._seo
    const enMsgs = JSON.parse(fsStore.get('messages/en.json') || '{}');
    expect(enMsgs.gallery._seo).toEqual({
      title: 'Art Gallery',
    });
  });

  it('clearing English override removes _seo and falls back to default title', async () => {
    fsStore.set('messages/en.json', JSON.stringify({
      gallery: {
        _seo: { title: 'Art Gallery' },
      },
    }));

    store.set(activeLocaleAtom, 'en');

    const { container, unmount } = render(
      <Provider store={store}>
        <PagesSeoSection />
      </Provider>
    );

    const titleInput = container.querySelector('#seo-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Art Gallery');

    // Clear the input
    fireEvent.change(titleInput, { target: { value: '' } });
    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    // Override is deleted from messages/en.json
    const enMsgs = JSON.parse(fsStore.get('messages/en.json') || '{}');
    expect(enMsgs.gallery?._seo).toBeUndefined();

    // Default code unchanged
    const code = fsStore.get('app/gallery/page.tsx')!;
    expect(code).toContain("'Галерея робіт'");

    unmount();

    // Reopen component and verify fallback placeholder
    const { container: reopenedContainer } = render(
      <Provider store={store}>
        <PagesSeoSection />
      </Provider>
    );
    const reopenedInput = reopenedContainer.querySelector('#seo-title') as HTMLInputElement;
    expect(reopenedInput.value).toBe('');
    expect(reopenedInput.placeholder).toBe('Галерея робіт');
  });

  it('_seo in messages survives template migration and orphan cleanup', () => {
    fsStore.set('messages/uk.json', JSON.stringify({
      'LayoutClient.tsx': {
        _seo: { title: 'Template SEO' },
      },
    }));

    migrateLegacyTemplateTranslations({ locales: [{ code: 'uk' }] });

    const ukJson = JSON.parse(fsStore.get('messages/uk.json') ?? '{}');
    expect(ukJson['LayoutClient.tsx']?._seo).toEqual({ title: 'Template SEO' });
  });
});
