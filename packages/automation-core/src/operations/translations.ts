// packages/automation-core/src/operations/translations.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  getI18nConfig,
  setNodeOverride,
  setCollectionItemOverride,
} from '@/code/project/locale-ops';
import {
  listTranslatableTexts,
  commitTranslationText,
  commitTranslationAttr,
  readTranslationText,
  type TranslatableText,
} from '@/code/project/translation-ops';
import { updateLocaleStyleInCode } from '@/code/generation/locale-gen';
import { setLocaleInstancePropInCode } from '@/code/generation/responsive-instance-prop-vars-gen';
import { deleteMessageValue } from '@/code/generation/i18n-gen';
import { filePathToSlug } from '@/code/project/active-file-store';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { isTextTag } from '@/shared/constants';
import { trace } from '@/shared/debug-trace';
import { syncSnapshotToProjectFS } from './locales';

export interface TranslatableTextEntry {
  filePath: string;
  nodeId: string;
  label: string;
  source: string;
  fallbackDefaultText: string;
  rich?: boolean;
  instanceProp?: { componentName: string; prop: string };
  translations: Record<string, string>;
}

/**
 * Fallback scanner for standard page.tsx files that might not use the .client.tsx naming convention.
 */
function scanExtraPageTexts(filePath: string, defaultLocale: string): TranslatableText[] {
  const code = projectFS.readFile(filePath);
  if (!code) return [];
  const out: TranslatableText[] = [];
  try {
    const nodes = parseJSXToNodes(code);
    for (const [nodeId, node] of nodes) {
      const translatable =
        node.translationKey ||
        (isTextTag(node.type) && node.textContent?.trim() && !node.textVariable && !node.binding);
      if (!translatable) continue;
      const source = node.translationKey
        ? readTranslationText({ filePath, key: nodeId, locale: defaultLocale }) ?? node.textContent ?? ''
        : node.textContent ?? '';
      out.push({
        filePath,
        kind: 'page',
        nodeId,
        label: node.name || node.type,
        source,
        fallbackDefaultText: node.textContent ?? '',
      });
    }
  } catch {
    // ignore parse errors
  }
  return out;
}

// ─── 1. translations.list ────────────────────────────────────────────────────

export const translationsListOperation: Operation<
  { filePath?: string },
  {
    defaultLocale: string;
    locales: string[];
    texts: TranslatableTextEntry[];
  }
> = {
  name: 'translations.list',
  description: 'List all translatable text nodes, rich text fragments, and instance props across files with current translations',
  category: 'localization',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    filePath: z.string().optional(),
  }),
  async execute(snapshot, input) {
    syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();
    const defaultLocale = config.defaultLocale;
    const localeCodes = config.locales.map((l) => l.code);

    let rawTexts = listTranslatableTexts(defaultLocale);

    // If input.filePath points to a page.tsx that listTranslatableTexts didn't pick up:
    if (input.filePath && !rawTexts.some((t) => t.filePath === input.filePath)) {
      const extra = scanExtraPageTexts(input.filePath, defaultLocale);
      rawTexts = [...rawTexts, ...extra];
    } else if (!input.filePath) {
      // Also check standard app/page.tsx if present and not in list
      if (projectFS.exists('app/page.tsx') && !rawTexts.some((t) => t.filePath === 'app/page.tsx')) {
        const extra = scanExtraPageTexts('app/page.tsx', defaultLocale);
        rawTexts = [...rawTexts, ...extra];
      }
    }

    if (input.filePath) {
      rawTexts = rawTexts.filter((t) => t.filePath === input.filePath);
    }

    const texts: TranslatableTextEntry[] = rawTexts.map((item) => {
      const translations: Record<string, string> = {};
      for (const loc of localeCodes) {
        const val = readTranslationText({ filePath: item.filePath, key: item.nodeId, locale: loc });
        if (val !== null) {
          translations[loc] = val;
        } else if (loc === defaultLocale) {
          translations[loc] = item.source;
        }
      }

      return {
        filePath: item.filePath,
        nodeId: item.nodeId,
        label: item.label,
        source: item.source,
        fallbackDefaultText: item.fallbackDefaultText,
        ...(item.rich ? { rich: true } : {}),
        ...(item.instanceProp ? { instanceProp: item.instanceProp } : {}),
        translations,
      };
    });

    trace.fn('translations.list', { defaultLocale, localeCount: localeCodes.length, textCount: texts.length });
    return {
      defaultLocale,
      locales: localeCodes,
      texts,
    };
  },
};

// ─── 2. translations.set ─────────────────────────────────────────────────────

export const translationsSetOperation: Operation<
  {
    locale: string;
    items: Array<{
      filePath: string;
      nodeId: string;
      text: string;
      rich?: boolean;
    }>;
  },
  {
    locale: string;
    written: number;
    changes: FileChange[];
  }
> = {
  name: 'translations.set',
  description: 'Write translation messages to messages/{locale}.json and transform JSX elements to {t(nodeId)} calls',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    locale: z.string().min(1),
    items: z
      .array(
        z.object({
          filePath: z.string().min(1),
          nodeId: z.string().min(1),
          text: z.string(),
          rich: z.boolean().optional(),
        }),
      )
      .min(1, 'Items array must contain at least one translation'),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (input.locale === config.defaultLocale) {
      throw new Error(
        `Cannot set translations for default locale "${input.locale}". Default text is authored directly in JSX or canvas source.`,
      );
    }

    if (!config.locales.some((l) => l.code === input.locale)) {
      throw new Error(`Locale "${input.locale}" is not configured in i18n/config.json. Add the locale first.`);
    }

    for (const item of input.items) {
      commitTranslationText({
        filePath: item.filePath,
        nodeId: item.nodeId,
        locale: input.locale,
        defaultLocale: config.defaultLocale,
        text: item.text,
        rich: item.rich,
      });
    }

    trace.action('translations.set', { locale: input.locale, written: input.items.length });
    return {
      locale: input.locale,
      written: input.items.length,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 3. translations.attribute.set ───────────────────────────────────────────

export const translationsAttributeSetOperation: Operation<
  {
    filePath: string;
    nodeId: string;
    attr: 'placeholder' | 'alt' | 'title' | 'aria-label' | 'value';
    locale: string;
    text: string;
  },
  {
    nodeId: string;
    attr: string;
    locale: string;
    changes: FileChange[];
  }
> = {
  name: 'translations.attribute.set',
  description: 'Commit translated HTML attribute (placeholder, alt, title, aria-label, value) binding in JSX to {t(key)}',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    attr: z.enum(['placeholder', 'alt', 'title', 'aria-label', 'value']),
    locale: z.string().min(1),
    text: z.string(),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (!config.locales.some((l) => l.code === input.locale)) {
      throw new Error(`Locale "${input.locale}" is not configured in i18n/config.json. Add the locale first.`);
    }

    const code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const node = nodes.get(input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found in "${input.filePath}"`);
    }

    const current = node.attrs?.[input.attr];
    const transformed = node.attrTranslationKeys?.[input.attr] !== undefined;

    commitTranslationAttr({
      filePath: input.filePath,
      nodeId: input.nodeId,
      attr: input.attr,
      locale: input.locale,
      defaultLocale: config.defaultLocale,
      text: input.text,
      transformed,
      fallbackDefaultValue: current,
    });

    trace.action('translations.attribute.set', { nodeId: input.nodeId, attr: input.attr, locale: input.locale });
    return {
      nodeId: input.nodeId,
      attr: input.attr,
      locale: input.locale,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 4. translations.nodeOverride.set ────────────────────────────────────────

export const translationsNodeOverrideSetOperation: Operation<
  {
    locale: string;
    filePath: string;
    nodeId: string;
    override: {
      text?: string;
      visible?: boolean;
      styles?: Record<string, string>;
      props?: Record<string, unknown>;
      textOverrides?: Record<string, string>;
    };
  },
  {
    locale: string;
    filePath: string;
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'translations.nodeOverride.set',
  description: 'Merge localized style, prop, visibility, and responsive text overrides into i18n/{locale}.json',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    locale: z.string().min(1),
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    override: z.object({
      text: z.string().optional(),
      visible: z.boolean().optional(),
      styles: z.record(z.string(), z.string()).optional(),
      props: z.record(z.string(), z.unknown()).optional(),
      textOverrides: z.record(z.string(), z.string()).optional(),
    }),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (!config.locales.some((l) => l.code === input.locale)) {
      throw new Error(`Locale "${input.locale}" is not configured in i18n/config.json`);
    }

    setNodeOverride(input.locale, input.filePath, input.nodeId, input.override);

    trace.action('translations.nodeOverride.set', { locale: input.locale, filePath: input.filePath, nodeId: input.nodeId });
    return {
      locale: input.locale,
      filePath: input.filePath,
      nodeId: input.nodeId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 5. translations.cmsItem.set ─────────────────────────────────────────────

export const translationsCmsItemSetOperation: Operation<
  {
    locale: string;
    collection: string;
    itemId: string;
    fieldOverrides: Record<string, unknown>;
  },
  {
    locale: string;
    collection: string;
    itemId: string;
    changes: FileChange[];
  }
> = {
  name: 'translations.cmsItem.set',
  description: 'Persist localized CMS collection item field overrides in i18n/{locale}.json',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    locale: z.string().min(1),
    collection: z.string().min(1),
    itemId: z.string().min(1),
    fieldOverrides: z.record(z.string(), z.unknown()),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (!config.locales.some((l) => l.code === input.locale)) {
      throw new Error(`Locale "${input.locale}" is not configured in i18n/config.json`);
    }

    setCollectionItemOverride(input.locale, input.collection, input.itemId, input.fieldOverrides);

    trace.action('translations.cmsItem.set', {
      locale: input.locale,
      collection: input.collection,
      itemId: input.itemId,
    });
    return {
      locale: input.locale,
      collection: input.collection,
      itemId: input.itemId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 6. translations.style.set ───────────────────────────────────────────────

export const translationsStyleSetOperation: Operation<
  {
    filePath: string;
    nodeId: string;
    locale: string;
    styles: Record<string, string>;
    maxWidth?: number;
    variantName?: string;
  },
  {
    nodeId: string;
    locale: string;
    changes: FileChange[];
  }
> = {
  name: 'translations.style.set',
  description: 'Apply localized style overrides for a node in :lang() CSS rules within JSX source',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    locale: z.string().min(1),
    styles: z.record(z.string(), z.string()),
    maxWidth: z.number().optional(),
    variantName: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (!config.locales.some((l) => l.code === input.locale)) {
      throw new Error(`Locale "${input.locale}" is not configured in i18n/config.json`);
    }

    const code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nextCode = updateLocaleStyleInCode(
      code,
      input.nodeId,
      input.locale,
      input.styles,
      input.maxWidth,
      input.variantName,
    );
    projectFS.writeFile(input.filePath, nextCode);

    trace.action('translations.style.set', { nodeId: input.nodeId, locale: input.locale });
    return {
      nodeId: input.nodeId,
      locale: input.locale,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 7. translations.instanceProp.set ────────────────────────────────────────

export const translationsInstancePropSetOperation: Operation<
  {
    filePath: string;
    nodeId: string;
    componentName: string;
    prop: string;
    locale: string;
    value: string | null;
  },
  {
    nodeId: string;
    prop: string;
    locale: string;
    changes: FileChange[];
  }
> = {
  name: 'translations.instanceProp.set',
  description: 'Update localized component instance prop value scoped to a specific locale in JSX source',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    componentName: z.string().min(1),
    prop: z.string().min(1),
    locale: z.string().min(1),
    value: z.string().nullable(),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (!config.locales.some((l) => l.code === input.locale)) {
      throw new Error(`Locale "${input.locale}" is not configured in i18n/config.json`);
    }

    const code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nextCode = setLocaleInstancePropInCode(
      code,
      input.nodeId,
      input.componentName,
      input.prop,
      input.locale,
      input.value,
    );
    projectFS.writeFile(input.filePath, nextCode);

    trace.action('translations.instanceProp.set', {
      nodeId: input.nodeId,
      prop: input.prop,
      locale: input.locale,
    });
    return {
      nodeId: input.nodeId,
      prop: input.prop,
      locale: input.locale,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 8. translations.delete ──────────────────────────────────────────────────

export const translationsDeleteOperation: Operation<
  {
    filePath: string;
    nodeId: string;
    locale?: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'translations.delete',
  description: 'Delete a translation key from messages JSON files for one or all locales',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    locale: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();
    const namespace = filePathToSlug(input.filePath);

    const locales = input.locale ? [input.locale] : config.locales.map((l) => l.code);

    for (const loc of locales) {
      const msgPath = `messages/${loc}.json`;
      const raw = projectFS.readFile(msgPath);
      if (raw) {
        const next = deleteMessageValue(raw, namespace, input.nodeId);
        if (next !== raw) {
          projectFS.writeFile(msgPath, next);
        }
      }
    }

    trace.action('translations.delete', { nodeId: input.nodeId, locale: input.locale });
    return {
      nodeId: input.nodeId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(translationsListOperation);
defaultRegistry.register(translationsSetOperation);
defaultRegistry.register(translationsAttributeSetOperation);
defaultRegistry.register(translationsNodeOverrideSetOperation);
defaultRegistry.register(translationsCmsItemSetOperation);
defaultRegistry.register(translationsStyleSetOperation);
defaultRegistry.register(translationsInstancePropSetOperation);
defaultRegistry.register(translationsDeleteOperation);

// Aliases for compatibility
defaultRegistry.registerAlias('translations.get', 'translations.list');
defaultRegistry.registerAlias('translations.batch', 'translations.set');
defaultRegistry.registerAlias('translations.bind', 'translations.set');
defaultRegistry.registerAlias('translations.attribute', 'translations.attribute.set');
defaultRegistry.registerAlias('translations.attr.set', 'translations.attribute.set');
defaultRegistry.registerAlias('translations.nodeOverride', 'translations.nodeOverride.set');
defaultRegistry.registerAlias('translations.cmsItem', 'translations.cmsItem.set');
defaultRegistry.registerAlias('translations.style', 'translations.style.set');
defaultRegistry.registerAlias('translations.instanceProp', 'translations.instanceProp.set');
defaultRegistry.registerAlias('locales.override.set', 'translations.nodeOverride.set');
defaultRegistry.registerAlias('locales.cmsItem.set', 'translations.cmsItem.set');
