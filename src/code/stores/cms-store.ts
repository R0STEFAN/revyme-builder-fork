// cms-store.ts — Jotai atoms for CMS Collections state.
// Schema + data atoms are DERIVED from ProjectFS — auto-update on version bump (undo/redo).

import { atom } from 'jotai';
import { projectFS, projectVersionAtom } from '../project/project-fs';
import { activeLocaleAtom, isDefaultLocaleAtom } from './locale-store';
import { localizeCollections } from './cms-locale';
import { loadCmsProjectConfig, type ApiCollectionConfig, type CmsProjectConfig } from '../project/cms-api-config';
import type { CollectionSchema, CollectionItem } from '@/shared/types';

// CMS project configuration derived from _meta/cms-api-config.json
export const cmsProjectConfigAtom = atom<CmsProjectConfig>((get) => {
  get(projectVersionAtom);
  return loadCmsProjectConfig();
});

export const cmsModeAtom = atom<'local' | 'api'>((get) => {
  return get(cmsProjectConfigAtom).mode;
});

export const apiCollectionsConfigAtom = atom<Map<string, ApiCollectionConfig>>((get) => {
  const cfg = get(cmsProjectConfigAtom);
  const map = new Map<string, ApiCollectionConfig>();
  for (const [slug, col] of Object.entries(cfg.apiCollections)) {
    map.set(slug, col);
  }
  return map;
});

// All collection schemas, keyed by slug — derived from ProjectFS
export const collectionSchemasAtom = atom<Map<string, CollectionSchema>>((get) => {
  get(projectVersionAtom);
  const schemas = new Map<string, CollectionSchema>();
  const files = projectFS.listFiles('cms/');
  for (const f of files) {
    if (!f.endsWith('.schema.json')) continue;
    const slug = f.replace('cms/', '').replace('.schema.json', '');
    const raw = projectFS.readFile(f);
    if (raw) {
      try { schemas.set(slug, JSON.parse(raw)); } catch { /* skip corrupt */ }
    }
  }
  return schemas;
});

// All collection data, keyed by slug — derived from ProjectFS
export const collectionDataAtom = atom<Map<string, CollectionItem[]>>((get) => {
  get(projectVersionAtom);
  const data = new Map<string, CollectionItem[]>();
  const files = projectFS.listFiles('cms/');
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.schema.json')) continue;
    const slug = f.replace('cms/', '').replace('.json', '');
    const raw = projectFS.readFile(f);
    if (raw) {
      try { data.set(slug, JSON.parse(raw)); } catch { /* skip corrupt */ }
    }
  }
  return data;
});

/**
 * Collection data with the ACTIVE LOCALE's field translations merged in.
 *
 * `collectionDataAtom` is the raw CMS JSON — the default language, and what the
 * CMS panel edits. This is what anything RENDERING rows should read, so a
 * translated collection actually shows its translation.
 *
 * Identity-preserving: on the default locale, or with no overrides, it returns
 * the base Map untouched, so subscribers don't re-render.
 */
export const localizedCollectionDataAtom = atom<Map<string, CollectionItem[]>>((get) => {
  const base = get(collectionDataAtom);
  if (get(isDefaultLocaleAtom)) return base;
  // `_i18n` rides on the rows themselves, so `collectionDataAtom`'s own
  // version dependency already covers a translation write.
  return localizeCollections(base, get(activeLocaleAtom));
});

// Currently selected collection in CMS panel
export const activeCmsCollectionAtom = atom<string | null>(null);

// Currently editing item ID
export const editingCmsItemAtom = atom<string | null>(null);
