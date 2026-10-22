// packages/automation-core/src/operations/guides.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  parseRulerGuides,
  updateRulerGuidesInCode,
  type RulerGuide,
} from '@/code/project/ruler-guides-config';
import { checkFile, type FileKind } from '@/code/oracle/check-file';
import { syncProjectSnapshotToProjectFS } from './projects';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ─── 1. guides.get ────────────────────────────────────────────────────────────

export const guidesGetInputSchema = z.object({
  filePath: z.string().min(1, 'Target file path must not be empty'),
});
export type GuidesGetInput = z.infer<typeof guidesGetInputSchema>;

export interface GuidesGetOutput {
  horizontal: number[];
  vertical: number[];
}

export const guidesGetOperation: Operation<GuidesGetInput, GuidesGetOutput> = {
  name: 'guides.get',
  description: 'Retrieve ruler guidelines for a page or component file',
  category: 'guides',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: guidesGetInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);

    const targetFile = input.filePath.trim();
    const code = projectFS.readFile(targetFile);
    if (code === null) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" does not exist.`);
    }

    const allGuides = parseRulerGuides(code);
    const horizontal = allGuides
      .filter((g) => g.type === 'horizontal')
      .map((g) => g.position)
      .sort((a, b) => a - b);
    const vertical = allGuides
      .filter((g) => g.type === 'vertical')
      .map((g) => g.position)
      .sort((a, b) => a - b);

    context?.trace?.('guides:get', { filePath: targetFile, hCount: horizontal.length, vCount: vertical.length });

    return {
      horizontal,
      vertical,
    };
  },
};

// ─── 2. guides.set ────────────────────────────────────────────────────────────

export const guidesSetInputSchema = z.object({
  filePath: z.string().min(1, 'Target file path must not be empty'),
  horizontal: z.array(z.number()),
  vertical: z.array(z.number()),
});
export type GuidesSetInput = z.infer<typeof guidesSetInputSchema>;

export interface GuidesSetOutput {
  filePath: string;
  count: number;
  changes: FileChange[];
}

export const guidesSetOperation: Operation<GuidesSetInput, GuidesSetOutput> = {
  name: 'guides.set',
  description: 'Update ruler guidelines for a file, embedding JSDoc annotations with Oracle validation',
  category: 'guides',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: guidesSetInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);

    const targetFile = input.filePath.trim();
    const code = projectFS.readFile(targetFile);
    if (code === null) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" does not exist.`);
    }

    const beforeHash = sha256(code);
    const guides: RulerGuide[] = [
      ...input.horizontal.map((pos, idx) => ({
        id: `guide-h-${idx + 1}`,
        type: 'horizontal' as const,
        position: pos,
      })),
      ...input.vertical.map((pos, idx) => ({
        id: `guide-v-${idx + 1}`,
        type: 'vertical' as const,
        position: pos,
      })),
    ];

    const nextCode = updateRulerGuidesInCode(code, guides);

    // Oracle verification
    const fileKind: FileKind = targetFile.startsWith('components/') ? 'component' : 'page';
    const violations = checkFile(nextCode, { kind: fileKind, path: targetFile })
      .filter((v) => !(v.code === 'NO_COMMENTS_IN_GENERATED_CODE' && v.message.includes('@rulerGuides')));
    if (violations.length > 0) {
      const issueMsgs = violations.map((i) => i.message).join('; ');
      throw new Error(`ORACLE_VIOLATION: Ruler guides update failed Oracle checks: ${issueMsgs}`);
    }

    const changes: FileChange[] = [];
    if (nextCode !== code) {
      projectFS.writeFile(targetFile, nextCode);
      changes.push({
        path: targetFile,
        beforeHash,
        content: nextCode,
      });
    }

    context?.trace?.('guides:set', {
      filePath: targetFile,
      count: guides.length,
      changed: changes.length > 0,
    });

    return {
      filePath: targetFile,
      count: guides.length,
      changes,
    };
  },
};

// ─── Registry Registration & Aliases ─────────────────────────────────────────

defaultRegistry.register(guidesGetOperation);
defaultRegistry.register(guidesSetOperation);

defaultRegistry.registerAlias('ruler-guides.get', 'guides.get');
defaultRegistry.registerAlias('ruler-guides.set', 'guides.set');
