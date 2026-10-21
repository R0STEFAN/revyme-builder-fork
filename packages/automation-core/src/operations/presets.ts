// packages/automation-core/src/operations/presets.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parsePresetTokens,
  addPresetTokenToCSS,
  removePresetTokenFromCSS,
} from '@/code/generation/preset-gen';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import type { PresetToken } from '@/shared/types';

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  children: string[];
}

export interface PresetFolderData {
  version: number;
  rootOrder: string[];
  folders: FolderNode[];
}

function getFoldersPath(category: string): string {
  return `_meta/preset-folders-${category}.json`;
}

function readFoldersData(snapshot: Snapshot, category: string): PresetFolderData {
  const path = getFoldersPath(category);
  const raw = snapshot.files.get(path);
  if (!raw) {
    return {
      version: 1,
      rootOrder: [],
      folders: [],
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || 1,
      rootOrder: Array.isArray(parsed.rootOrder) ? parsed.rootOrder : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
  } catch {
    return {
      version: 1,
      rootOrder: [],
      folders: [],
    };
  }
}

// ─── Border grouping ────────────────────────────────────────────────────────
const BORDER_SUFFIXES = ['image-source', 'image-slice', 'width', 'style', 'color'] as const;

export interface BorderPresetGroup {
  name: string;
  label: string;
  flavor: 'solid' | 'gradient';
  tokens: Record<string, string>;
}

export function groupBorderPresets(tokens: PresetToken[]): BorderPresetGroup[] {
  const groups = new Map<string, Record<string, string>>();

  for (const token of tokens) {
    if (token.category !== 'border') continue;
    const withoutPrefix = token.name.replace(/^border-/, '');

    let groupName = withoutPrefix;
    let foundSuffix: string | null = null;
    for (const suffix of BORDER_SUFFIXES) {
      if (withoutPrefix.endsWith('-' + suffix)) {
        groupName = withoutPrefix.slice(0, -(suffix.length + 1));
        foundSuffix = suffix;
        break;
      }
    }
    if (!groupName) groupName = withoutPrefix;
    const current = groups.get(groupName) ?? {};
    current[foundSuffix ?? 'val'] = token.value;
    groups.set(groupName, current);
  }

  return Array.from(groups.entries()).map(([name, groupTokens]) => ({
    name,
    label: name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    flavor: groupTokens['image-source'] ? 'gradient' : 'solid',
    tokens: groupTokens,
  }));
}

// 1. presets.list
export const presetsListOperation: Operation<
  { category: string; targetFile?: string },
  {
    category: string;
    presets: Array<{
      name: string;
      label?: string;
      tokens: Record<string, string>;
      flavor?: string;
    }>;
  }
> = {
  name: 'presets.list',
  description: 'List compound presets (border, shadow, radius, color, spacing) from globals.css',
  category: 'presets',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    category: z.string().min(1),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const css = snapshot.files.get(targetFile) ?? '';
    const allTokens = parsePresetTokens(css);

    if (input.category === 'border') {
      const borders = groupBorderPresets(allTokens);
      return {
        category: 'border',
        presets: borders.map((b) => ({
          name: b.name,
          label: b.label,
          flavor: b.flavor,
          tokens: b.tokens,
        })),
      };
    }

    const filtered = allTokens.filter((t) => t.category === input.category);
    return {
      category: input.category,
      presets: filtered.map((t) => ({
        name: t.name,
        tokens: { [t.name]: t.value },
      })),
    };
  },
};

// 2. presets.set
export const presetsSetOperation: Operation<
  {
    category: 'border' | 'shadow' | 'radius' | 'spacing' | 'color' | 'other';
    name: string;
    values: Record<string, string>;
    folderId?: string;
    targetFile?: string;
  },
  {
    changes: FileChange[];
    createdTokens: string[];
  }
> = {
  name: 'presets.set',
  description: 'Create or update a compound design preset (such as a border group with width/style/color)',
  category: 'presets',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    category: z.enum(['border', 'shadow', 'radius', 'spacing', 'color', 'other']),
    name: z.string().min(1),
    values: z.record(z.string(), z.string()),
    folderId: z.string().optional(),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanName = input.name.replace(/^--/, '').trim();
    let css = snapshot.files.get(targetFile) ?? ':root {\n}\n';
    const createdTokens: string[] = [];

    if (input.category === 'border') {
      for (const [suffix, val] of Object.entries(input.values)) {
        const tokenName = `border-${cleanName}-${suffix}`;
        createdTokens.push(tokenName);
        css = addPresetTokenToCSS(css, {
          name: tokenName,
          value: val,
          category: 'border',
        });
      }
    } else {
      for (const [key, val] of Object.entries(input.values)) {
        const prefix = input.category === 'other' ? '' : `${input.category}-`;
        const tokenName = key.startsWith(prefix) ? key : `${prefix}${cleanName}`;
        createdTokens.push(tokenName);
        css = addPresetTokenToCSS(css, {
          name: tokenName,
          value: val,
          category: input.category as PresetToken['category'],
        });
      }
    }

    const changes: FileChange[] = [
      {
        path: targetFile,
        beforeHash: null,
        content: css,
      },
    ];

    if (input.folderId) {
      const folderPath = getFoldersPath(input.category);
      const folderData = readFoldersData(snapshot, input.category);
      const targetFolder = folderData.folders.find((f) => f.id === input.folderId);
      if (targetFolder && !targetFolder.children.includes(cleanName)) {
        targetFolder.children.push(cleanName);
        changes.push({
          path: folderPath,
          beforeHash: null,
          content: JSON.stringify(folderData, null, 2),
        });
      }
    }

    return {
      changes,
      createdTokens,
    };
  },
};

// 3. presets.apply
export const presetsApplyOperation: Operation<
  {
    category: 'border' | 'shadow' | 'radius' | 'color';
    name: string;
    targetFile: string;
    nodeId: string;
    property?: 'color' | 'backgroundColor';
  },
  {
    changes: FileChange[];
    appliedStyles: Record<string, string>;
  }
> = {
  name: 'presets.apply',
  description: 'Apply a design preset to a target node in JSX source',
  category: 'presets',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    category: z.enum(['border', 'shadow', 'radius', 'color']),
    name: z.string().min(1),
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.enum(['color', 'backgroundColor']).optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const cleanName = input.name.replace(/^--/, '').trim();
    const stylePatch: Record<string, string> = {};

    if (input.category === 'border') {
      stylePatch.borderWidth = `var(--border-${cleanName}-width)`;
      stylePatch.borderStyle = `var(--border-${cleanName}-style)`;
      stylePatch.borderColor = `var(--border-${cleanName}-color)`;
    } else if (input.category === 'shadow') {
      stylePatch.boxShadow = `var(--shadow-${cleanName})`;
    } else if (input.category === 'radius') {
      stylePatch.borderRadius = `var(--radius-${cleanName})`;
    } else if (input.category === 'color') {
      const prop = input.property || 'backgroundColor';
      stylePatch[prop] = `var(--color-${cleanName})`;
    }

    const nextCode = updateNodeInCode(code, input.nodeId, stylePatch);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      appliedStyles: stylePatch,
    };
  },
};

// 4. presets.folders.list
export const presetsFoldersListOperation: Operation<
  { category: string },
  {
    category: string;
    rootOrder: string[];
    folders: FolderNode[];
  }
> = {
  name: 'presets.folders.list',
  description: 'List folders and organizational tree for a preset category',
  category: 'presets',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    category: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const data = readFoldersData(snapshot, input.category);
    return {
      category: input.category,
      rootOrder: data.rootOrder,
      folders: data.folders,
    };
  },
};

// 5. presets.folders.create
export const presetsFoldersCreateOperation: Operation<
  { category: string; name: string; parentId?: string | null },
  {
    changes: FileChange[];
    folder: FolderNode;
  }
> = {
  name: 'presets.folders.create',
  description: 'Create an organizational folder for presets within a category',
  category: 'presets',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    category: z.string().min(1),
    name: z.string().min(1),
    parentId: z.string().nullable().optional(),
  }),
  async execute(snapshot, input, context) {
    const folderPath = getFoldersPath(input.category);
    const data = readFoldersData(snapshot, input.category);
    const folderId = `pfld-${input.category}-${context.createId('folder')}`;

    const newFolder: FolderNode = {
      id: folderId,
      name: input.name,
      parentId: input.parentId ?? null,
      children: [],
    };

    data.folders.push(newFolder);
    if (!newFolder.parentId) {
      data.rootOrder.push(folderId);
    } else {
      const parent = data.folders.find((f) => f.id === newFolder.parentId);
      if (parent) {
        parent.children.push(folderId);
      }
    }

    return {
      changes: [
        {
          path: folderPath,
          beforeHash: null,
          content: JSON.stringify(data, null, 2),
        },
      ],
      folder: newFolder,
    };
  },
};

// Register preset operations
defaultRegistry.register(presetsListOperation);
defaultRegistry.register(presetsSetOperation);
defaultRegistry.register(presetsApplyOperation);
defaultRegistry.register(presetsFoldersListOperation);
defaultRegistry.register(presetsFoldersCreateOperation);
