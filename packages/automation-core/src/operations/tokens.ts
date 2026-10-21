// packages/automation-core/src/operations/tokens.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parsePresetTokens,
  addPresetTokenToCSS,
  updatePresetTokenInCSS,
  removePresetTokenFromCSS,
} from '@/code/generation/preset-gen';
import {
  migrateLegacyDarkBlock,
  addDarkTokenValueToCSS,
  removeDarkTokenFromCSS,
} from '@/code/project/preset-ops';
import { parseJSXToNodes } from '@/code/parsing/parser';
import type { PresetToken } from '@/shared/types';

const DARK_BLOCK_REGEX = /(:root\.dark\s*\{)([\s\S]*?)(\})/;
const LEGACY_DARK_REGEX = /\[data-theme="dark"\]\s*\{([\s\S]*?)\}\s*/;

export function getDarkTokenValueFromCSS(css: string, tokenName: string): string | null {
  const propRegex = new RegExp(`--${tokenName}:\\s*([^;]+);`);
  const darkMatch = css.match(DARK_BLOCK_REGEX);
  if (darkMatch) {
    const m = darkMatch[2].match(propRegex);
    if (m) return m[1].trim();
  }
  const legacyMatch = css.match(LEGACY_DARK_REGEX);
  if (legacyMatch) {
    const m = legacyMatch[1].match(propRegex);
    if (m) return m[1].trim();
  }
  return null;
}

export interface TokenUsage {
  tokenName: string;
  filePath: string;
  nodeId?: string;
  nodeName?: string;
}

export function scanTokenUsage(files: ReadonlyMap<string, string>): Map<string, TokenUsage[]> {
  const result = new Map<string, TokenUsage[]>();
  const isLayoutFile = (p: string) => /\/(?:layout|LayoutClient)\.tsx$/.test(p);
  const targets = Array.from(files.keys()).filter((p) =>
    (p.startsWith('app/') && (p.endsWith('.tsx') || p.endsWith('.css')) && !isLayoutFile(p)) ||
    (p.startsWith('components/') && (p.endsWith('.tsx') || p.endsWith('.css')))
  );

  for (const filePath of targets) {
    const code = files.get(filePath);
    if (!code || !code.includes('var(--')) continue;

    let nodeMap: Map<string, { name?: string; type?: string }> | null = null;
    if (filePath.endsWith('.tsx')) {
      try {
        const parsed = parseJSXToNodes(code);
        nodeMap = new Map();
        for (const [id, n] of parsed) {
          nodeMap.set(id, { name: n.name, type: n.type });
        }
      } catch {
        nodeMap = null;
      }
    }

    const varRegex = /var\(\s*--([a-zA-Z0-9_-]+)/g;
    let match: RegExpExecArray | null;
    const seen = new Set<string>();

    while ((match = varRegex.exec(code)) !== null) {
      const tokenName = match[1];
      let nodeId: string | undefined;
      let nodeName: string | undefined;

      if (nodeMap) {
        const prefix = code.slice(0, match.index);
        const dataIdMatch = [...prefix.matchAll(/data-id=["']([^"']+)["']/g)].pop();
        if (dataIdMatch) {
          nodeId = dataIdMatch[1];
          const node = nodeMap.get(nodeId);
          if (node) nodeName = node.name || node.type;
        }
      }

      const dedupeKey = `${tokenName}::${filePath}::${nodeId ?? 'file'}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const list = result.get(tokenName) ?? [];
      list.push({
        tokenName,
        filePath,
        nodeId,
        nodeName,
      });
      result.set(tokenName, list);
    }
  }

  return result;
}

export function findUnknownVarReferences(files: ReadonlyMap<string, string>): Array<{
  tokenName: string;
  filePath: string;
  nodeId?: string;
}> {
  const css = files.get('app/globals.css') ?? '';
  const declaredTokens = new Set<string>();
  const declRegex = /--([a-zA-Z0-9_-]+)\s*:/g;
  let dm: RegExpExecArray | null;
  while ((dm = declRegex.exec(css)) !== null) {
    declaredTokens.add(dm[1]);
  }

  const usages = scanTokenUsage(files);
  const unknown: Array<{ tokenName: string; filePath: string; nodeId?: string }> = [];

  for (const [tokenName, list] of usages.entries()) {
    if (!declaredTokens.has(tokenName)) {
      for (const item of list) {
        unknown.push({
          tokenName,
          filePath: item.filePath,
          nodeId: item.nodeId,
        });
      }
    }
  }

  return unknown;
}

// 1. tokens.list
export const tokensListOperation: Operation<
  { category?: string; targetFile?: string },
  {
    tokens: Array<{
      name: string;
      value: string;
      category: string;
      darkValue: string | null;
    }>;
  }
> = {
  name: 'tokens.list',
  description: 'List design preset tokens in app/globals.css with category filtering and light/dark values',
  category: 'tokens',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    category: z.string().optional(),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const css = snapshot.files.get(targetFile) ?? '';
    let tokens = parsePresetTokens(css);

    if (input.category) {
      tokens = tokens.filter((t) => t.category === input.category);
    }

    const result = tokens.map((t) => ({
      name: t.name,
      value: t.value,
      category: t.category,
      darkValue: getDarkTokenValueFromCSS(css, t.name),
    }));

    return { tokens: result };
  },
};

// 2. tokens.get
export const tokensGetOperation: Operation<
  { name: string; targetFile?: string },
  {
    token: {
      name: string;
      value: string;
      category: string;
      darkValue: string | null;
    } | null;
  }
> = {
  name: 'tokens.get',
  description: 'Get a single design token by name with light and dark values',
  category: 'tokens',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    name: z.string().min(1),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanName = input.name.replace(/^--/, '').trim();
    const css = snapshot.files.get(targetFile) ?? '';
    const tokens = parsePresetTokens(css);
    const token = tokens.find((t) => t.name === cleanName);

    if (!token) {
      return { token: null };
    }

    return {
      token: {
        name: token.name,
        value: token.value,
        category: token.category,
        darkValue: getDarkTokenValueFromCSS(css, token.name),
      },
    };
  },
};

// 3. tokens.set
export const tokensSetOperation: Operation<
  {
    name: string;
    value?: string;
    darkValue?: string;
    category?: PresetToken['category'];
    targetFile?: string;
  },
  {
    changes: FileChange[];
    token: {
      name: string;
      value: string;
      category: string;
      darkValue: string | null;
    } | null;
  }
> = {
  name: 'tokens.set',
  description: 'Create or update a design token in app/globals.css (supports empty string deletion, dark theme values)',
  category: 'tokens',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    name: z.string().min(1),
    value: z.string().optional(),
    darkValue: z.string().optional(),
    category: z
      .enum([
        'color',
        'typography',
        'spacing',
        'margin',
        'radius',
        'shadow',
        'border',
        'image',
        'video',
        'other',
      ])
      .optional(),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanName = input.name.replace(/^--/, '').trim();
    let css = snapshot.files.get(targetFile) ?? ':root {\n}\n';

    // Invariant 3: empty string means delete property
    if (input.value === '') {
      css = removePresetTokenFromCSS(css, cleanName);
    } else if (input.value !== undefined) {
      const existing = parsePresetTokens(css).find((t) => t.name === cleanName);
      if (existing) {
        css = updatePresetTokenInCSS(css, cleanName, input.value);
      } else {
        css = addPresetTokenToCSS(css, {
          name: cleanName,
          value: input.value,
          category: input.category || 'other',
        });
      }
    }

    if (input.darkValue === '') {
      css = removeDarkTokenFromCSS(css, cleanName);
    } else if (input.darkValue !== undefined) {
      css = addDarkTokenValueToCSS(css, cleanName, input.darkValue);
    }

    const changes: FileChange[] = [
      {
        path: targetFile,
        beforeHash: null,
        content: css,
      },
    ];

    const tokens = parsePresetTokens(css);
    const token = tokens.find((t) => t.name === cleanName);

    return {
      changes,
      token: token
        ? {
            name: token.name,
            value: token.value,
            category: token.category,
            darkValue: getDarkTokenValueFromCSS(css, token.name),
          }
        : null,
    };
  },
};

// 4. tokens.rename
export const tokensRenameOperation: Operation<
  {
    oldName: string;
    newName: string;
    updateReferences?: boolean;
    targetFile?: string;
  },
  {
    changes: FileChange[];
    updatedFiles: string[];
    occurrences: number;
  }
> = {
  name: 'tokens.rename',
  description: 'Rename a design token in app/globals.css and automatically update references across all project files',
  category: 'tokens',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    oldName: z.string().min(1),
    newName: z.string().min(1),
    updateReferences: z.boolean().optional().default(true),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const oldClean = input.oldName.replace(/^--/, '').trim();
    const newClean = input.newName.replace(/^--/, '').trim();
    const shouldUpdateRefs = input.updateReferences ?? true;

    let css = snapshot.files.get(targetFile);
    if (!css) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" not found in project`);
    }

    // Replace --oldClean: with --newClean: in globals.css
    const escapedOld = oldClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declRegex = new RegExp(`(--)${escapedOld}(\\s*:)`, 'g');
    if (!declRegex.test(css)) {
      throw new Error(`TOKEN_NOT_FOUND: Token "--${oldClean}" not found in "${targetFile}"`);
    }

    css = css.replace(declRegex, `$1${newClean}$2`);
    const changes: FileChange[] = [
      {
        path: targetFile,
        beforeHash: null,
        content: css,
      },
    ];

    const updatedFiles: string[] = [targetFile];
    let occurrences = 0;

    if (shouldUpdateRefs) {
      const varRegex = new RegExp(`var\\(\\s*--${escapedOld}(\\s*[,)])`, 'g');
      for (const [filePath, content] of snapshot.files.entries()) {
        if (filePath === targetFile) continue;
        if (!content.includes(`--${oldClean}`)) continue;

        let fileOccurrences = 0;
        const updatedContent = content.replace(varRegex, (match, suffix) => {
          fileOccurrences++;
          return `var(--${newClean}${suffix}`;
        });

        if (fileOccurrences > 0) {
          occurrences += fileOccurrences;
          updatedFiles.push(filePath);
          changes.push({
            path: filePath,
            beforeHash: null,
            content: updatedContent,
          });
        }
      }
    }

    return {
      changes,
      updatedFiles,
      occurrences,
    };
  },
};

// 5. tokens.remove
export const tokensRemoveOperation: Operation<
  {
    name: string;
    replacementToken?: string;
    force?: boolean;
    targetFile?: string;
  },
  {
    changes: FileChange[];
    removedName: string;
    replacedReferences: number;
  }
> = {
  name: 'tokens.remove',
  description: 'Remove a token from app/globals.css with safe reference validation and optional replacement',
  category: 'tokens',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    name: z.string().min(1),
    replacementToken: z.string().optional(),
    force: z.boolean().optional().default(false),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanName = input.name.replace(/^--/, '').trim();
    let css = snapshot.files.get(targetFile);

    if (!css) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" not found in project`);
    }

    const usagesMap = scanTokenUsage(snapshot.files);
    const usages = usagesMap.get(cleanName) ?? [];

    let replacedReferences = 0;
    const changes: FileChange[] = [];

    if (usages.length > 0) {
      if (!input.force && !input.replacementToken) {
        throw new Error(
          `TOKEN_IN_USE: Token "--${cleanName}" is still used by ${usages.length} element(s) (e.g. ${usages[0].filePath}). Provide replacementToken or set force: true to remove.`,
        );
      }

      if (input.replacementToken) {
        const cleanReplacement = input.replacementToken.replace(/^--/, '').trim();
        const escapedOld = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const varRegex = new RegExp(`var\\(\\s*--${escapedOld}(\\s*[,)])`, 'g');

        for (const [filePath, content] of snapshot.files.entries()) {
          if (filePath === targetFile) continue;
          if (!content.includes(`--${cleanName}`)) continue;

          let count = 0;
          const updatedContent = content.replace(varRegex, (_match, suffix) => {
            count++;
            return `var(--${cleanReplacement}${suffix}`;
          });

          if (count > 0) {
            replacedReferences += count;
            changes.push({
              path: filePath,
              beforeHash: null,
              content: updatedContent,
            });
          }
        }
      }
    }

    css = removePresetTokenFromCSS(css, cleanName);
    css = removeDarkTokenFromCSS(css, cleanName);

    changes.push({
      path: targetFile,
      beforeHash: null,
      content: css,
    });

    return {
      changes,
      removedName: cleanName,
      replacedReferences,
    };
  },
};

// 6. tokens.usage
export const tokensUsageOperation: Operation<
  { names?: string[] },
  {
    usages: Record<string, TokenUsage[]>;
    totalOccurrences: number;
  }
> = {
  name: 'tokens.usage',
  description: 'Scan the project files for all usages of design tokens and return detailed node and file mappings',
  category: 'tokens',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    names: z.array(z.string()).optional(),
  }),
  async execute(snapshot, input) {
    const usagesMap = scanTokenUsage(snapshot.files);
    const result: Record<string, TokenUsage[]> = {};
    let totalOccurrences = 0;

    const filterNames = input.names?.map((n) => n.replace(/^--/, '').trim());

    for (const [tokenName, list] of usagesMap.entries()) {
      if (filterNames && !filterNames.includes(tokenName)) continue;
      result[tokenName] = list;
      totalOccurrences += list.length;
    }

    return {
      usages: result,
      totalOccurrences,
    };
  },
};

// 7. tokens.validate
export const tokensValidateOperation: Operation<
  Record<string, never>,
  {
    isValid: boolean;
    unknownReferences: Array<{ tokenName: string; filePath: string; nodeId?: string }>;
  }
> = {
  name: 'tokens.validate',
  description: 'Verify that all var(--token) references across project files correspond to declared design tokens in app/globals.css',
  category: 'tokens',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const unknown = findUnknownVarReferences(snapshot.files);
    return {
      isValid: unknown.length === 0,
      unknownReferences: unknown,
    };
  },
};

// Register token operations
defaultRegistry.register(tokensListOperation);
defaultRegistry.register(tokensGetOperation);
defaultRegistry.register(tokensSetOperation);
defaultRegistry.register(tokensRenameOperation);
defaultRegistry.register(tokensRemoveOperation);
defaultRegistry.register(tokensUsageOperation);
defaultRegistry.register(tokensValidateOperation);
