// packages/automation-core/src/operations/project-skills.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { FileChangeSchema } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  SKILLS_FILE_PATH,
  SKILL_CONTENT_MAX,
  SKILL_DESCRIPTION_MAX,
  MAX_SKILLS,
  parseSkills,
  type ProjectSkill,
  type SkillsFile,
} from '@/code/project/skills-config';
import { syncCodeSnapshotToProjectFS } from './code-components';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export const SKILL_NAME_REGEX = /^[a-z0-9-]+$/;

interface FrontmatterMetadata {
  name?: string;
  description?: string;
  alwaysApply?: boolean;
}

/** Lightweight zero-dependency markdown frontmatter parser */
function parseFrontmatter(raw: string): { meta: FrontmatterMetadata; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const rawMeta = match[1];
  const body = match[2];
  const meta: FrontmatterMetadata = {};

  for (const line of rawMeta.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key === 'name') meta.name = val;
    else if (key === 'description') meta.description = val;
    else if (key === 'alwaysApply' || key === 'always_apply') {
      meta.alwaysApply = val.toLowerCase() === 'true';
    }
  }

  return { meta, body };
}

// ─── 1. skills.list ───────────────────────────────────────────────────────────

export const skillsListInputSchema = z.object({});
export type SkillsListInput = z.infer<typeof skillsListInputSchema>;

export interface SkillSummary {
  name: string;
  description: string;
  alwaysApply: boolean;
  charCount: number;
}

export const skillsListOutputSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      alwaysApply: z.boolean(),
      charCount: z.number().int().nonnegative(),
    }),
  ),
});
export type SkillsListOutput = z.infer<typeof skillsListOutputSchema>;

export const skillsListOperation: Operation<SkillsListInput, SkillsListOutput> = {
  name: 'skills.list',
  description: 'List project skills configured in _meta/skills.json or discovered in .agents/skills/',
  category: 'skills',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: skillsListInputSchema,
  outputSchema: skillsListOutputSchema,
  async execute(snapshot, _input, context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);

    const skillsMap = new Map<string, SkillSummary>();

    // 1. Read from canonical _meta/skills.json
    const metaRaw = projectFS.readFile(SKILLS_FILE_PATH);
    if (metaRaw) {
      const parsed = parseSkills(metaRaw);
      for (const s of parsed.skills) {
        skillsMap.set(s.name, {
          name: s.name,
          description: s.description,
          alwaysApply: s.alwaysApply,
          charCount: s.content.length,
        });
      }
    }

    // 2. Discover from .agents/skills/ in snapshot and projectFS
    const candidatePaths = new Set<string>();
    if (snapshot?.files) {
      for (const p of snapshot.files.keys()) {
        if (p.startsWith('.agents/skills/')) candidatePaths.add(p);
      }
    }
    for (const p of projectFS.listFiles()) {
      if (p.startsWith('.agents/skills/')) candidatePaths.add(p);
    }

    for (const filePath of candidatePaths) {
      const isSkillMd = filePath.endsWith('/SKILL.md') || filePath.endsWith('/skill.md');
      const isDirectMd = filePath.endsWith('.md') && !filePath.slice('.agents/skills/'.length).includes('/');

      if (!isSkillMd && !isDirectMd) continue;

      const raw = projectFS.readFile(filePath) ?? snapshot?.files?.get(filePath);
      if (!raw) continue;

      const { meta, body } = parseFrontmatter(raw);
      let name = meta.name;
      if (!name) {
        if (isSkillMd) {
          const parts = filePath.split('/');
          name = parts[2]; // .agents/skills/<name>/SKILL.md
        } else {
          name = filePath.replace('.agents/skills/', '').replace(/\.md$/, '');
        }
      }
      name = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

      if (!skillsMap.has(name) && name.length > 0) {
        skillsMap.set(name, {
          name,
          description: (meta.description || body.slice(0, 100).split('\n')[0] || '').slice(0, SKILL_DESCRIPTION_MAX),
          alwaysApply: !!meta.alwaysApply,
          charCount: body.trim().length,
        });
      }
    }

    const skills = Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    context?.trace?.('skills:list', { count: skills.length });

    return { skills };
  },
};

// ─── 2. skills.save ───────────────────────────────────────────────────────────

export const skillsSaveInputSchema = z.object({
  name: z.string().regex(SKILL_NAME_REGEX, 'Skill name must be lowercase alphanumeric with dashes'),
  description: z.string().min(1, 'Skill description must not be empty'),
  content: z.string().min(1, 'Skill content must not be empty').max(SKILL_CONTENT_MAX, `Skill content cannot exceed ${SKILL_CONTENT_MAX} characters`),
  alwaysApply: z.boolean().optional(),
  previousName: z.string().optional(),
});
export type SkillsSaveInput = z.infer<typeof skillsSaveInputSchema>;

export const skillsSaveOutputSchema = z.object({
  name: z.string(),
  alwaysApply: z.boolean(),
  changes: z.array(FileChangeSchema),
});
export type SkillsSaveOutput = z.infer<typeof skillsSaveOutputSchema>;

export const skillsSaveOperation: Operation<SkillsSaveInput, SkillsSaveOutput> = {
  name: 'skills.save',
  description: 'Create, update, or rename a project skill saved in _meta/skills.json',
  category: 'skills',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: skillsSaveInputSchema,
  outputSchema: skillsSaveOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = skillsSaveInputSchema.parse(rawInput);
    syncCodeSnapshotToProjectFS(snapshot);

    const targetName = input.name.trim();
    const content = input.content.trim();
    const description = input.description.trim().slice(0, SKILL_DESCRIPTION_MAX);
    const beforeRaw = projectFS.readFile(SKILLS_FILE_PATH);
    const currentFile: SkillsFile = parseSkills(beforeRaw);
    let skills: ProjectSkill[] = [...currentFile.skills];

    const now = Date.now();
    let savedSkill: ProjectSkill;

    if (input.previousName) {
      const prev = input.previousName.trim();
      const existingIdx = skills.findIndex((s) => s.name === prev);
      if (existingIdx === -1) {
        throw new Error(`SKILL_NOT_FOUND: Skill "${prev}" does not exist to rename.`);
      }
      if (targetName !== prev && skills.some((s) => s.name === targetName)) {
        throw new Error(`SKILL_EXISTS: Skill "${targetName}" already exists.`);
      }

      const existing = skills[existingIdx];
      savedSkill = {
        name: targetName,
        description,
        content,
        alwaysApply: input.alwaysApply ?? existing.alwaysApply,
        createdAt: existing.createdAt || now,
        updatedAt: now,
      };
      skills[existingIdx] = savedSkill;
    } else {
      const existingIdx = skills.findIndex((s) => s.name === targetName);
      if (existingIdx !== -1) {
        const existing = skills[existingIdx];
        savedSkill = {
          name: targetName,
          description,
          content,
          alwaysApply: input.alwaysApply ?? existing.alwaysApply,
          createdAt: existing.createdAt || now,
          updatedAt: now,
        };
        skills[existingIdx] = savedSkill;
      } else {
        if (skills.length >= MAX_SKILLS) {
          throw new Error(`MAX_SKILLS_EXCEEDED: Project skills limit of ${MAX_SKILLS} reached.`);
        }
        savedSkill = {
          name: targetName,
          description,
          content,
          alwaysApply: input.alwaysApply ?? false,
          createdAt: now,
          updatedAt: now,
        };
        skills.push(savedSkill);
      }
    }

    const nextFile: SkillsFile = {
      version: 1,
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    };
    const nextContent = JSON.stringify(nextFile, null, 2);

    projectFS.writeFile(SKILLS_FILE_PATH, nextContent);
    if (snapshot?.files && 'set' in snapshot.files) {
      (snapshot.files as Map<string, string>).set(SKILLS_FILE_PATH, nextContent);
    }

    const changes: FileChange[] = [
      {
        path: SKILLS_FILE_PATH,
        beforeHash: beforeRaw ? sha256(beforeRaw) : null,
        content: nextContent,
      },
    ];

    context?.trace?.('skills:save', {
      name: savedSkill.name,
      renamed: !!input.previousName,
      alwaysApply: savedSkill.alwaysApply,
    });

    return {
      name: savedSkill.name,
      alwaysApply: savedSkill.alwaysApply,
      changes,
    };
  },
};

// ─── Registration & Aliases ──────────────────────────────────────────────────

defaultRegistry.register(skillsListOperation);
defaultRegistry.register(skillsSaveOperation);

defaultRegistry.registerAlias('project-skills.list', 'skills.list');
defaultRegistry.registerAlias('project-skills.save', 'skills.save');
defaultRegistry.registerAlias('skills.create', 'skills.save');
