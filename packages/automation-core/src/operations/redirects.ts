// packages/automation-core/src/operations/redirects.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { syncCodeSnapshotToProjectFS } from './code-components';

export const REDIRECTS_FILE = 'app/_redirects.json';

export interface RedirectEntry {
  id: string;
  from: string;
  to: string;
  expandToAllLocales?: boolean;
}

export function readRedirectsFromFS(): RedirectEntry[] {
  const raw = projectFS.readFile(REDIRECTS_FILE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RedirectEntry =>
        r &&
        typeof r === 'object' &&
        typeof r.id === 'string' &&
        typeof r.from === 'string' &&
        typeof r.to === 'string',
    );
  } catch {
    return [];
  }
}

export function writeRedirectsToFS(redirects: RedirectEntry[]): void {
  projectFS.writeFile(REDIRECTS_FILE, JSON.stringify(redirects, null, 2));
}

// ─── 1. redirects.list ────────────────────────────────────────────────────────

export const redirectsListInputSchema = z.object({});

export type RedirectsListInput = z.infer<typeof redirectsListInputSchema>;

export interface RedirectsListOutput {
  redirects: RedirectEntry[];
}

export const redirectsListOperation: Operation<RedirectsListInput, RedirectsListOutput> = {
  name: 'redirects.list',
  description: 'List all configured URL redirects from app/_redirects.json',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: redirectsListInputSchema,
  async execute(snapshot, _input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    return { redirects: readRedirectsFromFS() };
  },
};

// ─── 2. redirects.add ─────────────────────────────────────────────────────────

export const redirectsAddInputSchema = z.object({
  redirects: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        expandToAllLocales: z.boolean().optional(),
      }),
    )
    .min(1),
});

export type RedirectsAddInput = z.infer<typeof redirectsAddInputSchema>;

export interface RedirectsAddOutput {
  ids: string[];
  count: number;
  changes: FileChange[];
}

export const redirectsAddOperation: Operation<RedirectsAddInput, RedirectsAddOutput> = {
  name: 'redirects.add',
  description: 'Add URL redirects with circular-loop and self-redirect validation',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: redirectsAddInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    const current = readRedirectsFromFS();

    const ids: string[] = [];
    const newEntries: RedirectEntry[] = [];

    for (const r of input.redirects) {
      const from = r.from.trim();
      const to = r.to.trim();

      if (!from.startsWith('/')) {
        throw new Error(`INVALID_REDIRECT: "from" path must start with "/" (got "${from}").`);
      }

      if (from === to) {
        throw new Error(`INVALID_REDIRECT: Self-redirect is disallowed ("${from}" -> "${to}").`);
      }

      // Check loop against existing or already added in this batch
      const allRedirects = [...current, ...newEntries];
      for (const existing of allRedirects) {
        if (existing.from === to && existing.to === from) {
          throw new Error(
            `REDIRECT_LOOP: Circular redirect detected between "${from}" and "${to}".`,
          );
        }
      }

      const id = context?.createId ? context.createId('redir') : `redir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: RedirectEntry = {
        id,
        from,
        to,
        expandToAllLocales: r.expandToAllLocales ?? false,
      };

      ids.push(id);
      newEntries.push(entry);
    }

    const combined = [...current, ...newEntries];
    writeRedirectsToFS(combined);

    return {
      ids,
      count: ids.length,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 3. redirects.remove ──────────────────────────────────────────────────────

export const redirectsRemoveInputSchema = z.object({
  redirectIds: z.array(z.string()).min(1),
});

export type RedirectsRemoveInput = z.infer<typeof redirectsRemoveInputSchema>;

export interface RedirectsRemoveOutput {
  removed: string[];
  changes: FileChange[];
}

export const redirectsRemoveOperation: Operation<RedirectsRemoveInput, RedirectsRemoveOutput> = {
  name: 'redirects.remove',
  description: 'Remove redirects by ID from app/_redirects.json',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: redirectsRemoveInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    const current = readRedirectsFromFS();

    const drop = new Set(input.redirectIds);
    const removed: string[] = [];
    const remaining = current.filter((r) => {
      if (drop.has(r.id)) {
        removed.push(r.id);
        return false;
      }
      return true;
    });

    writeRedirectsToFS(remaining);

    return {
      removed,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 4. redirects.reorder ─────────────────────────────────────────────────────

export const redirectsReorderInputSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export type RedirectsReorderInput = z.infer<typeof redirectsReorderInputSchema>;

export interface RedirectsReorderOutput {
  orderedIds: string[];
  changes: FileChange[];
}

export const redirectsReorderOperation: Operation<
  RedirectsReorderInput,
  RedirectsReorderOutput
> = {
  name: 'redirects.reorder',
  description: 'Reorder redirects priority in app/_redirects.json',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: redirectsReorderInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    const current = readRedirectsFromFS();

    const orderMap = new Map<string, number>();
    input.orderedIds.forEach((id, i) => orderMap.set(id, i));

    const sorted = [...current].sort(
      (a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999),
    );

    writeRedirectsToFS(sorted);

    return {
      orderedIds: sorted.map((r) => r.id),
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(redirectsListOperation);
defaultRegistry.register(redirectsAddOperation);
defaultRegistry.register(redirectsRemoveOperation);
defaultRegistry.register(redirectsReorderOperation);

// Compatibility aliases
defaultRegistry.registerAlias('redirects.create', 'redirects.add');
defaultRegistry.registerAlias('redirects.delete', 'redirects.remove');
defaultRegistry.registerAlias('redirects.setOrder', 'redirects.reorder');
defaultRegistry.registerAlias('redirect-rules.list', 'redirects.list');
defaultRegistry.registerAlias('redirect-rules.add', 'redirects.add');
defaultRegistry.registerAlias('redirect-rules.remove', 'redirects.remove');
