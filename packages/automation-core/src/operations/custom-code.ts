// packages/automation-core/src/operations/custom-code.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { syncCodeSnapshotToProjectFS } from './code-components';

export const CUSTOM_CODE_FILE = 'app/_custom-code.json';
export const VALID_LOCATIONS = ['headStart', 'headEnd', 'bodyStart', 'bodyEnd'] as const;

export type CustomCodeLocation = typeof VALID_LOCATIONS[number];

export interface CustomCodeData {
  headStart: string | null;
  headEnd: string | null;
  bodyStart: string | null;
  bodyEnd: string | null;
}

export function readCustomCodeFromFS(): CustomCodeData {
  const raw = projectFS.readFile(CUSTOM_CODE_FILE);
  const empty: CustomCodeData = {
    headStart: null,
    headEnd: null,
    bodyStart: null,
    bodyEnd: null,
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomCodeData>;
    return {
      headStart: typeof parsed.headStart === 'string' ? parsed.headStart : null,
      headEnd: typeof parsed.headEnd === 'string' ? parsed.headEnd : null,
      bodyStart: typeof parsed.bodyStart === 'string' ? parsed.bodyStart : null,
      bodyEnd: typeof parsed.bodyEnd === 'string' ? parsed.bodyEnd : null,
    };
  } catch {
    return empty;
  }
}

// ─── 1. customCode.get ────────────────────────────────────────────────────────

export const customCodeGetInputSchema = z.object({});

export type CustomCodeGetInput = z.infer<typeof customCodeGetInputSchema>;

export const customCodeGetOperation: Operation<CustomCodeGetInput, CustomCodeData> = {
  name: 'customCode.get',
  description: 'Get global head/body custom HTML code snippets',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: customCodeGetInputSchema,
  async execute(snapshot, _input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    return readCustomCodeFromFS();
  },
};

// ─── 2. customCode.set ────────────────────────────────────────────────────────

export const customCodeSetInputSchema = z.object({
  location: z.enum(VALID_LOCATIONS),
  html: z.string().nullable(),
});

export type CustomCodeSetInput = z.infer<typeof customCodeSetInputSchema>;

export interface CustomCodeSetOutput {
  location: CustomCodeLocation;
  changes: FileChange[];
}

export const customCodeSetOperation: Operation<CustomCodeSetInput, CustomCodeSetOutput> = {
  name: 'customCode.set',
  description: 'Set global custom HTML code in headStart, headEnd, bodyStart, or bodyEnd',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: customCodeSetInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);

    const current = readCustomCodeFromFS();
    const updated: CustomCodeData = {
      ...current,
      [input.location]: input.html,
    };

    projectFS.writeFile(CUSTOM_CODE_FILE, JSON.stringify(updated, null, 2));

    return {
      location: input.location,
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(customCodeGetOperation);
defaultRegistry.register(customCodeSetOperation);

// Compatibility aliases
defaultRegistry.registerAlias('custom-code.get', 'customCode.get');
defaultRegistry.registerAlias('custom-code.set', 'customCode.set');
defaultRegistry.registerAlias('customCode.getCustomCode', 'customCode.get');
defaultRegistry.registerAlias('customCode.setCustomCode', 'customCode.set');
