// packages/automation-core/src/operations/locales.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  getI18nConfig,
  saveI18nConfig,
  addLocale,
  removeLocale,
} from '@/code/project/locale-ops';
import { syncLocaleRoutes } from '@/code/project/locale-route-ops';
import { buildProvidersSource } from '@/code/project/providers-gen';
import { isRtlLocale } from '@/shared/rtl-text';
import { LOCALE_SWITCHER_COMPONENT } from '@/code/project/default-code-components/LocaleSwitcher';
import { ensureComponentImport } from './components';
import { addNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { trace } from '@/shared/debug-trace';
import type { I18nConfig, LocaleOverrides } from '@/shared/types';

/**
 * Synchronize Snapshot files to ProjectFS before running an operation,
 * and collect any added, modified, or deleted files as FileChange[].
 */
export function syncSnapshotToProjectFS(snapshot?: Snapshot): {
  collectChanges: () => FileChange[];
} {
  const beforeFiles = new Map<string, string>();
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) {
      beforeFiles.set(path, content);
    }
  }
  if (snapshot && snapshot.files.size > 0) {
    for (const [path, content] of snapshot.files) {
      beforeFiles.set(path, content);
      if (projectFS.readFile(path) !== content) {
        projectFS.writeFile(path, content);
      }
    }
  }

  return {
    collectChanges() {
      const changes: FileChange[] = [];
      const currentPaths = new Set(projectFS.listFiles());

      for (const path of currentPaths) {
        const currentContent = projectFS.readFile(path);
        const beforeContent = beforeFiles.get(path);
        if (currentContent !== null && currentContent !== beforeContent) {
          changes.push({
            path,
            beforeHash: null,
            content: currentContent,
          });
        }
      }

      for (const [path] of beforeFiles) {
        if (!currentPaths.has(path)) {
          changes.push({
            path,
            beforeHash: null,
            content: null,
          });
        }
      }

      return changes;
    },
  };
}

export interface LocaleEntryInfo {
  code: string;
  label: string;
  direction: 'ltr' | 'rtl';
  fallback?: string;
  isRtl: boolean;
}

// ─── 1. locales.get ──────────────────────────────────────────────────────────

export const localesGetOperation: Operation<
  Record<string, never>,
  {
    defaultLocale: string;
    locales: LocaleEntryInfo[];
  }
> = {
  name: 'locales.get',
  description: 'Read i18n configuration with default locale, configured locales, directions and fallback settings',
  category: 'localization',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({}),
  async execute(snapshot) {
    syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    const locales: LocaleEntryInfo[] = config.locales.map((l) => {
      const isRtl = l.direction === 'rtl' || (l.direction === undefined && isRtlLocale(l.code));
      const direction: 'ltr' | 'rtl' = l.direction ?? (isRtl ? 'rtl' : 'ltr');
      return {
        code: l.code,
        label: l.label,
        direction,
        ...(l.fallback ? { fallback: l.fallback } : {}),
        isRtl,
      };
    });

    trace.fn('locales.get', { defaultLocale: config.defaultLocale, count: locales.length });
    return {
      defaultLocale: config.defaultLocale,
      locales,
    };
  },
};

// ─── 2. locales.add ──────────────────────────────────────────────────────────

export const localesAddOperation: Operation<
  {
    code: string;
    label: string;
    direction?: 'ltr' | 'rtl';
    fallback?: string;
  },
  {
    code: string;
    label: string;
    isRtl: boolean;
    changes: FileChange[];
  }
> = {
  name: 'locales.add',
  description: 'Add a new locale, create messages and overrides files, sync app/providers.tsx, and generate route wrappers',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    code: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/, 'Locale code must match language subtag format (e.g. en, fr, pt-BR)'),
    label: z.string().min(1, 'Label cannot be empty'),
    direction: z.enum(['ltr', 'rtl']).optional(),
    fallback: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (config.locales.some((l) => l.code === input.code)) {
      throw new Error(`Locale "${input.code}" already exists in project configuration`);
    }

    const isRtl = input.direction ? input.direction === 'rtl' : isRtlLocale(input.code);
    const direction: 'ltr' | 'rtl' = input.direction ?? (isRtl ? 'rtl' : 'ltr');

    const entry: { code: string; label: string; direction?: 'ltr' | 'rtl'; fallback?: string } = {
      code: input.code,
      label: input.label,
      direction,
    };
    if (input.fallback) {
      entry.fallback = input.fallback;
    }
    config.locales.push(entry);
    saveI18nConfig(config);

    // Create empty overrides file i18n/{code}.json if missing
    const overridesPath = `i18n/${input.code}.json`;
    if (!projectFS.readFile(overridesPath)) {
      const emptyOverrides: LocaleOverrides = { pages: {}, collections: {} };
      projectFS.writeFile(overridesPath, JSON.stringify(emptyOverrides, null, 2));
    }

    // Create messages/{code}.json if missing
    for (const l of config.locales) {
      const msgPath = `messages/${l.code}.json`;
      if (!projectFS.readFile(msgPath)) {
        projectFS.writeFile(msgPath, '{}');
      }
    }

    // Regenerate providers.tsx
    projectFS.writeFile('app/providers.tsx', buildProvidersSource(config));

    // Synchronize per-locale Next.js route wrappers (pages × non-default locales)
    syncLocaleRoutes(config);

    trace.action('locales.add', { code: input.code, label: input.label, isRtl, direction });
    return {
      code: input.code,
      label: input.label,
      isRtl,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 3. locales.remove ───────────────────────────────────────────────────────

export const localesRemoveOperation: Operation<
  { code: string },
  { code: string; changes: FileChange[] }
> = {
  name: 'locales.remove',
  description: 'Remove a configured locale, delete its overrides file, prune orphan route wrappers, and regenerate providers',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    code: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (input.code === config.defaultLocale) {
      throw new Error(`Cannot remove the default locale "${input.code}". Set a new default locale first before removing.`);
    }

    if (!config.locales.some((l) => l.code === input.code)) {
      throw new Error(`Locale "${input.code}" is not configured in project`);
    }

    config.locales = config.locales.filter((l) => l.code !== input.code);
    saveI18nConfig(config);

    const overridesPath = `i18n/${input.code}.json`;
    if (projectFS.exists(overridesPath)) {
      projectFS.deleteFile(overridesPath);
    }

    // Regenerate providers.tsx without the removed locale
    projectFS.writeFile('app/providers.tsx', buildProvidersSource(config));

    // Prune stale route wrappers
    syncLocaleRoutes(config);

    trace.action('locales.remove', { code: input.code });
    return {
      code: input.code,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 4. locales.setDefault ───────────────────────────────────────────────────

export const localesSetDefaultOperation: Operation<
  { code: string },
  { defaultLocale: string; changes: FileChange[] }
> = {
  name: 'locales.setDefault',
  description: 'Change the project default primary locale, updating route wrappers and providers',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    code: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    if (!config.locales.some((l) => l.code === input.code)) {
      throw new Error(`Locale "${input.code}" is not configured in i18n/config.json. Add the locale first.`);
    }

    config.defaultLocale = input.code;
    saveI18nConfig(config);

    // Update providers and route wrappers for new default
    projectFS.writeFile('app/providers.tsx', buildProvidersSource(config));
    syncLocaleRoutes(config);

    trace.action('locales.setDefault', { defaultLocale: input.code });
    return {
      defaultLocale: input.code,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 5. locales.update ───────────────────────────────────────────────────────

export const localesUpdateOperation: Operation<
  {
    code: string;
    label?: string;
    direction?: 'ltr' | 'rtl';
    fallback?: string;
  },
  {
    code: string;
    label: string;
    isRtl: boolean;
    changes: FileChange[];
  }
> = {
  name: 'locales.update',
  description: 'Update metadata for an existing locale including label, direction, and fallback locale',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    code: z.string().min(1),
    label: z.string().optional(),
    direction: z.enum(['ltr', 'rtl']).optional(),
    fallback: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();

    const loc = config.locales.find((l) => l.code === input.code);
    if (!loc) {
      throw new Error(`Locale "${input.code}" is not configured in project`);
    }

    if (input.label !== undefined) loc.label = input.label;
    if (input.direction !== undefined) loc.direction = input.direction;
    if (input.fallback !== undefined) loc.fallback = input.fallback;

    saveI18nConfig(config);

    projectFS.writeFile('app/providers.tsx', buildProvidersSource(config));
    syncLocaleRoutes(config);

    const isRtl = loc.direction === 'rtl' || (loc.direction === undefined && isRtlLocale(loc.code));

    trace.action('locales.update', { code: input.code, label: loc.label, isRtl });
    return {
      code: input.code,
      label: loc.label,
      isRtl,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 6. locales.routes.sync ──────────────────────────────────────────────────

export const localesRoutesSyncOperation: Operation<
  Record<string, never>,
  {
    written: string[];
    removed: string[];
    changes: FileChange[];
  }
> = {
  name: 'locales.routes.sync',
  description: 'Synchronize Next.js route wrappers across all pages and configured non-default locales',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const sync = syncSnapshotToProjectFS(snapshot);
    const config = getI18nConfig();
    const result = syncLocaleRoutes(config);

    return {
      written: result.written,
      removed: result.removed,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 7. locales.switcher.add ─────────────────────────────────────────────────

export const localesSwitcherAddOperation: Operation<
  {
    filePath: string;
    parentId: string;
    index?: number;
  },
  {
    instanceId: string;
    component: 'LocaleSwitcher';
    changes: FileChange[];
  }
> = {
  name: 'locales.switcher.add',
  description: 'Ensure LocaleSwitcher code component is installed and insert an instance under the specified container',
  category: 'localization',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T18',
  inputSchema: z.object({
    filePath: z.string().min(1),
    parentId: z.string().min(1),
    index: z.number().int().nonnegative().optional(),
  }),
  async execute(snapshot, input, context) {
    const sync = syncSnapshotToProjectFS(snapshot);

    // 1. Ensure components/LocaleSwitcher.tsx is installed
    const switcherComponentPath = 'components/LocaleSwitcher.tsx';
    if (!projectFS.readFile(switcherComponentPath)) {
      projectFS.writeFile(switcherComponentPath, LOCALE_SWITCHER_COMPONENT);
      trace.action('locales.switcher.add:template-created', { path: switcherComponentPath });
    }

    // 2. Read target file
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    // 3. Ensure import
    code = ensureComponentImport(code, 'LocaleSwitcher');

    // 4. Generate instance ID and insert node
    const instanceId = context.createId('switcher');
    const nodeDef: AddNodeDef = {
      id: instanceId,
      type: 'LocaleSwitcher',
      name: 'Locale Switcher',
      styles: {},
    };

    code = addNodeInCode(code, input.parentId, nodeDef, input.index);
    projectFS.writeFile(input.filePath, code);

    trace.action('locales.switcher.add:inserted', { instanceId, filePath: input.filePath, parentId: input.parentId });
    return {
      instanceId,
      component: 'LocaleSwitcher',
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(localesGetOperation);
defaultRegistry.register(localesAddOperation);
defaultRegistry.register(localesRemoveOperation);
defaultRegistry.register(localesSetDefaultOperation);
defaultRegistry.register(localesUpdateOperation);
defaultRegistry.register(localesRoutesSyncOperation);
defaultRegistry.register(localesSwitcherAddOperation);

// Aliases for compatibility
defaultRegistry.registerAlias('locales.list', 'locales.get');
defaultRegistry.registerAlias('locales.config.get', 'locales.get');
defaultRegistry.registerAlias('locales.create', 'locales.add');
defaultRegistry.registerAlias('locales.delete', 'locales.remove');
defaultRegistry.registerAlias('locales.switcher', 'locales.switcher.add');
defaultRegistry.registerAlias('locales.default.set', 'locales.setDefault');
