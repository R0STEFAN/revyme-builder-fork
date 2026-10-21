// packages/automation-core/src/operations/typography.ts
import { z } from 'zod';
import * as t from '@babel/types';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parsePresetTokens,
  addPresetTokenToCSS,
  removePresetTokenFromCSS,
} from '@/code/generation/preset-gen';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { generate } from '@/code/generation/generator-utils';
import catalogFonts from '@/shared/google-fonts-catalog.json';
import { scanTokenUsage } from './tokens';

const googleFontNames = new Set((catalogFonts as any[]).map((f: any) => f.family.toLowerCase()));

export const TYPO_SUFFIXES = [
  'min-default',
  'min-md',
  'line-height-md',
  'line-height-sm',
  'line-height',
  'spacing-md',
  'spacing-sm',
  'spacing',
  'size-md',
  'size-sm',
  'size',
  'stroke-width',
  'stroke-color',
  'decoration',
  'transform',
  'shadow',
  'weight',
  'color',
  'font',
  'tag',
] as const;

export const TYPO_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span']);

export function retagNodeInCode(code: string, nodeId: string, newTag: string): string {
  const ast = parseJSX(code);
  if (!ast) return code;
  let changed = false;

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const dataIdAttr = opening.attributes.find(
        (a): a is t.JSXAttribute =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name, { name: 'data-id' }) &&
          t.isStringLiteral(a.value) &&
          a.value.value === nodeId,
      );
      if (dataIdAttr) {
        opening.name = t.jsxIdentifier(newTag);
        if (path.node.closingElement) {
          path.node.closingElement.name = t.jsxIdentifier(newTag);
        }
        changed = true;
      }
    },
  });

  if (!changed) return code;
  return generate(ast, { retainLines: true }, code).code;
}

export function ensureGoogleFontImportInCSS(css: string, fontFamilyValue: string): string {
  const name = fontFamilyValue.split(',')[0].trim().replace(/['"]/g, '');
  if (!name) return css;

  const SYSTEM_FONTS = [
    'arial', 'helvetica', 'times new roman', 'georgia', 'verdana',
    'courier new', 'tahoma', 'trebuchet ms', 'comic sans ms', 'impact',
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
    'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'inter',
  ];
  if (SYSTEM_FONTS.some((sf) => name.toLowerCase() === sf)) return css;
  if (!googleFontNames.has(name.toLowerCase())) return css;

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importRegex = new RegExp(`@import\\s+url\\([^)]*${escapedName.replace(/ /g, '\\+')}[^)]*\\)`);
  if (importRegex.test(css)) return css;

  const fontFaceRegex = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*['"]?${escapedName}['"]?`, 'i');
  if (fontFaceRegex.test(css)) return css;

  const urlFamily = `family=${name.replace(/ /g, '+')}:wght@300;400;500;600;700`;
  const importLine = `@import url('https://fonts.googleapis.com/css2?${urlFamily}&display=swap');`;

  const existingImportLines: string[] = [];
  const cssWithoutImports = css.replace(/@import\s+url\([^)]*\)[^;]*;\s*\n?/g, (match) => {
    existingImportLines.push(match.trim());
    return '';
  });

  if (!existingImportLines.some((line) => line.includes(name.replace(/ /g, '+')))) {
    existingImportLines.push(importLine);
  }

  return existingImportLines.join('\n') + '\n' + cssWithoutImports;
}

export interface TypoPreset {
  name: string;
  label: string;
  tag: string;
  values: Record<string, string>;
  responsiveTiers: {
    md?: Record<string, string>;
    sm?: Record<string, string>;
  };
}

export function groupTypographyPresets(tokens: Array<{ name: string; value: string; category: string }>): TypoPreset[] {
  const groups = new Map<string, Record<string, string>>();

  for (const token of tokens) {
    if (token.category !== 'typography' && !token.name.startsWith('typo-')) continue;
    const withoutPrefix = token.name.replace(/^typo-/, '');

    let groupName = withoutPrefix;
    let foundSuffix: string | null = null;
    for (const suffix of TYPO_SUFFIXES) {
      if (withoutPrefix.endsWith('-' + suffix)) {
        groupName = withoutPrefix.slice(0, -(suffix.length + 1));
        foundSuffix = suffix;
        break;
      }
    }
    if (!groupName) groupName = withoutPrefix;

    const current = groups.get(groupName) ?? {};
    if (foundSuffix) {
      current[foundSuffix] = token.value;
    }
    groups.set(groupName, current);
  }

  return Array.from(groups.entries()).map(([name, vals]) => {
    const md: Record<string, string> = {};
    const sm: Record<string, string> = {};

    for (const [k, v] of Object.entries(vals)) {
      if (k.endsWith('-md')) md[k.replace(/-md$/, '')] = v;
      if (k.endsWith('-sm')) sm[k.replace(/-sm$/, '')] = v;
    }

    return {
      name,
      label: name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      tag: vals.tag || 'p',
      values: vals,
      responsiveTiers: {
        ...(Object.keys(md).length > 0 ? { md } : {}),
        ...(Object.keys(sm).length > 0 ? { sm } : {}),
      },
    };
  });
}

// 1. typography.list
export const typographyListOperation: Operation<
  { targetFile?: string },
  {
    presets: TypoPreset[];
  }
> = {
  name: 'typography.list',
  description: 'List all compound typography presets (heading, body, etc.) including tags, responsive tiers, and token values',
  category: 'typography',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const css = snapshot.files.get(targetFile) ?? '';
    const tokens = parsePresetTokens(css);
    const presets = groupTypographyPresets(tokens);

    return { presets };
  },
};

// 2. typography.get
export const typographyGetOperation: Operation<
  { name: string; targetFile?: string },
  {
    preset: TypoPreset | null;
  }
> = {
  name: 'typography.get',
  description: 'Get a specific compound typography preset by name',
  category: 'typography',
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
    const cleanName = input.name.replace(/^--/, '').replace(/^typo-/, '').trim();
    const css = snapshot.files.get(targetFile) ?? '';
    const tokens = parsePresetTokens(css);
    const presets = groupTypographyPresets(tokens);
    const preset = presets.find((p) => p.name === cleanName) ?? null;

    return { preset };
  },
};

// 3. typography.set
export const typographySetOperation: Operation<
  {
    name: string;
    tag?: string;
    values?: Record<string, string>;
    responsiveTiers?: {
      md?: Record<string, string>;
      sm?: Record<string, string>;
    };
    targetFile?: string;
  },
  {
    changes: FileChange[];
    createdTokens: string[];
    preset: TypoPreset;
  }
> = {
  name: 'typography.set',
  description: 'Create or update a compound typography preset with font family, weight, size, line-height, stroke, and responsive tiers',
  category: 'typography',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    name: z.string().min(1),
    tag: z.string().optional(),
    values: z.record(z.string(), z.string()).optional(),
    responsiveTiers: z
      .object({
        md: z.record(z.string(), z.string()).optional(),
        sm: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanName = input.name.replace(/^--/, '').replace(/^typo-/, '').trim();
    let css = snapshot.files.get(targetFile) ?? ':root {\n}\n';

    const tag = input.tag || input.values?.tag || 'p';
    const defaultTokens: Record<string, string> = {
      tag,
      font: "'Inter', sans-serif",
      weight: '400',
      color: '#111111',
      transform: 'none',
      decoration: 'none',
      shadow: 'none',
      size: '16px',
      spacing: '0px',
      'line-height': '1.5',
      'min-default': '1200',
      'min-md': '600',
    };

    const mergedValues: Record<string, string> = {
      ...defaultTokens,
      ...(input.values ?? {}),
      tag,
    };

    if (input.responsiveTiers?.md) {
      for (const [k, v] of Object.entries(input.responsiveTiers.md)) {
        mergedValues[`${k}-md`] = v;
      }
    }
    if (input.responsiveTiers?.sm) {
      for (const [k, v] of Object.entries(input.responsiveTiers.sm)) {
        mergedValues[`${k}-sm`] = v;
      }
    }

    const createdTokens: string[] = [];
    for (const [suffix, val] of Object.entries(mergedValues)) {
      const tokenName = `typo-${cleanName}-${suffix}`;
      createdTokens.push(tokenName);
      css = addPresetTokenToCSS(css, {
        name: tokenName,
        value: val,
        category: 'typography',
      });
    }

    // Auto-import Google font if specified
    if (mergedValues.font) {
      css = ensureGoogleFontImportInCSS(css, mergedValues.font);
    }

    const presets = groupTypographyPresets(parsePresetTokens(css));
    const preset = presets.find((p) => p.name === cleanName)!;

    return {
      changes: [
        {
          path: targetFile,
          beforeHash: null,
          content: css,
        },
      ],
      createdTokens,
      preset,
    };
  },
};

// 4. typography.apply
export const typographyApplyOperation: Operation<
  {
    name: string;
    targetFile: string;
    nodeId: string;
    retag?: boolean;
  },
  {
    changes: FileChange[];
    appliedStyles: Record<string, string>;
    retagged?: string;
  }
> = {
  name: 'typography.apply',
  description: 'Apply a typography preset to a node (binds styles and optionally updates element tag)',
  category: 'typography',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    name: z.string().min(1),
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    retag: z.boolean().optional().default(true),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const cleanName = input.name.replace(/^--/, '').replace(/^typo-/, '').trim();
    const globalsCSS = snapshot.files.get('app/globals.css') ?? '';
    const presets = groupTypographyPresets(parsePresetTokens(globalsCSS));
    const preset = presets.find((p) => p.name === cleanName);

    if (!preset) {
      throw new Error(`PRESET_NOT_FOUND: Typography preset "${cleanName}" not found`);
    }

    let retagged: string | undefined;
    if (input.retag && preset.tag && TYPO_TAGS.has(preset.tag)) {
      code = retagNodeInCode(code, input.nodeId, preset.tag);
      retagged = preset.tag;
    }

    const stylePatch: Record<string, string> = {
      fontFamily: `var(--typo-${cleanName}-font)`,
      fontSize: `var(--typo-${cleanName}-size)`,
      fontWeight: `var(--typo-${cleanName}-weight)`,
      color: `var(--typo-${cleanName}-color)`,
      lineHeight: `var(--typo-${cleanName}-line-height)`,
      letterSpacing: `var(--typo-${cleanName}-spacing)`,
      textTransform: `var(--typo-${cleanName}-transform)`,
      textDecoration: `var(--typo-${cleanName}-decoration)`,
      textShadow: `var(--typo-${cleanName}-shadow)`,
    };

    if (preset.values['stroke-width']) {
      stylePatch.WebkitTextStrokeWidth = `var(--typo-${cleanName}-stroke-width)`;
      stylePatch.WebkitTextStrokeColor = `var(--typo-${cleanName}-stroke-color)`;
      stylePatch.WebkitTextStroke = ''; // clear shorthand
    }

    let nextCode = updateNodeInCode(code, input.nodeId, stylePatch);

    // If responsive tiers exist, inject responsive rule into <style>
    if (preset.responsiveTiers.md?.size || preset.responsiveTiers.sm?.size) {
      const minDefault = Number(preset.values['min-default'] || 1200);
      const minMd = Number(preset.values['min-md'] || 600);

      const rules: string[] = [];
      if (preset.responsiveTiers.md?.size) {
        rules.push(
          `@media (max-width: ${minDefault - 1}px) { [data-id="${input.nodeId}"] { font-size: var(--typo-${cleanName}-size-md) !important; } }`,
        );
      }
      if (preset.responsiveTiers.sm?.size) {
        rules.push(
          `@media (max-width: ${minMd - 1}px) { [data-id="${input.nodeId}"] { font-size: var(--typo-${cleanName}-size-sm) !important; } }`,
        );
      }

      if (rules.length > 0) {
        const responsiveBlock = rules.join('\n');
        if (nextCode.includes('<style>{`')) {
          nextCode = nextCode.replace(
            /(<style>\{`)([\s\S]*?)(`\}<\/style>)/,
            `$1$2\n${responsiveBlock}\n$3`,
          );
        } else {
          // Add style before last closing tag
          nextCode = nextCode.replace(
            /(<\/div>|<\/section>|<\/main>)([\s\S]*?$)/,
            `<style>{\`\n${responsiveBlock}\n\`}</style>\n$1$2`,
          );
        }
      }
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      appliedStyles: stylePatch,
      retagged,
    };
  },
};

// 5. typography.detach
export const typographyDetachOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    bakedStyles: Record<string, string>;
  }
> = {
  name: 'typography.detach',
  description: 'Detach typography preset from node, baking current token values into literal inline styles',
  category: 'typography',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const globalsCSS = snapshot.files.get('app/globals.css') ?? '';
    const presets = groupTypographyPresets(parsePresetTokens(globalsCSS));

    // Detect which preset is currently applied
    const nodes = parseJSXToNodes(code);
    const node = nodes.get(input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const ff = node.styles?.fontFamily || '';
    const match = ff.match(/var\(--typo-([a-zA-Z0-9_-]+)-font\)/);
    if (!match) {
      return { changes: [], bakedStyles: {} };
    }

    const presetName = match[1];
    const preset = presets.find((p) => p.name === presetName);
    if (!preset) {
      return { changes: [], bakedStyles: {} };
    }

    const baked: Record<string, string> = {};
    if (preset.values.font) baked.fontFamily = preset.values.font;
    if (preset.values.size) baked.fontSize = preset.values.size;
    if (preset.values.weight) baked.fontWeight = preset.values.weight;
    if (preset.values.color) baked.color = preset.values.color;
    if (preset.values['line-height']) baked.lineHeight = preset.values['line-height'];
    if (preset.values.spacing) baked.letterSpacing = preset.values.spacing;
    if (preset.values.transform && preset.values.transform !== 'none') baked.textTransform = preset.values.transform;
    if (preset.values.decoration && preset.values.decoration !== 'none') baked.textDecoration = preset.values.decoration;

    const nextCode = updateNodeInCode(code, input.nodeId, baked);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      bakedStyles: baked,
    };
  },
};

// 6. typography.remove
export const typographyRemoveOperation: Operation<
  {
    name: string;
    replacementPreset?: string;
    force?: boolean;
    targetFile?: string;
  },
  {
    changes: FileChange[];
    removedTokens: string[];
  }
> = {
  name: 'typography.remove',
  description: 'Remove a typography preset and all its corresponding tokens from globals.css',
  category: 'typography',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    name: z.string().min(1),
    replacementPreset: z.string().optional(),
    force: z.boolean().optional().default(false),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanName = input.name.replace(/^--/, '').replace(/^typo-/, '').trim();
    let css = snapshot.files.get(targetFile);

    if (!css) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" not found in project`);
    }

    const fontToken = `typo-${cleanName}-font`;
    const usages = scanTokenUsage(snapshot.files).get(fontToken) ?? [];

    if (usages.length > 0 && !input.force && !input.replacementPreset) {
      throw new Error(
        `PRESET_IN_USE: Typography preset "${cleanName}" is still used by ${usages.length} elements (e.g. ${usages[0].filePath}). Provide replacementPreset or set force: true.`,
      );
    }

    const changes: FileChange[] = [];

    if (input.replacementPreset && usages.length > 0) {
      const replacementClean = input.replacementPreset.replace(/^--/, '').replace(/^typo-/, '').trim();
      for (const [filePath, content] of snapshot.files.entries()) {
        if (filePath === targetFile) continue;
        if (!content.includes(`--typo-${cleanName}-`)) continue;

        const regex = new RegExp(`var\\(\\s*--typo-${cleanName}-([a-zA-Z0-9_-]+)`, 'g');
        const nextContent = content.replace(regex, `var(--typo-${replacementClean}-$1`);
        changes.push({
          path: filePath,
          beforeHash: null,
          content: nextContent,
        });
      }
    }

    const removedTokens: string[] = [];
    for (const suffix of TYPO_SUFFIXES) {
      const tokenName = `typo-${cleanName}-${suffix}`;
      css = removePresetTokenFromCSS(css, tokenName);
      removedTokens.push(tokenName);
    }

    changes.push({
      path: targetFile,
      beforeHash: null,
      content: css,
    });

    return {
      changes,
      removedTokens,
    };
  },
};

// Register typography operations
defaultRegistry.register(typographyListOperation);
defaultRegistry.register(typographyGetOperation);
defaultRegistry.register(typographySetOperation);
defaultRegistry.register(typographyApplyOperation);
defaultRegistry.register(typographyDetachOperation);
defaultRegistry.register(typographyRemoveOperation);
