// packages/automation-core/src/operations/vectors.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { simpleHash } from '@/shared/hash-utils';
import {
  buildIconSetFile,
  generateIconSetName,
  toPascalCase,
  isIconSetCode,
  type IconEntryInput,
} from '@/code/icons/icon-set-template';
import {
  parseIconSetConfig,
  replaceIconSetConfigInCode,
  type IconConfig,
} from '@/code/icons/icon-set-config';
import { parseIconSetFile, type IconSetInfo } from '@/code/icons/icon-set-registry';

function removeIconBlockFromCode(code: string, iconId: string): string {
  const dataIdMarker = `data-id="${iconId}"`;
  const blockStart = code.indexOf(dataIdMarker);
  if (blockStart === -1) return code;

  let openStart = blockStart;
  while (openStart > 0 && !code.startsWith('<div', openStart)) openStart--;
  if (!code.startsWith('<div', openStart)) return code;

  let depth = 1;
  let scan = code.indexOf('>', openStart) + 1;
  while (scan < code.length && depth > 0) {
    const nextOpen = code.indexOf('<div', scan);
    const nextClose = code.indexOf('</div>', scan);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      scan = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) {
        const blockEnd = nextClose + '</div>'.length;
        let from = openStart;
        while (from > 0 && (code[from - 1] === ' ' || code[from - 1] === '\t')) from--;
        if (code[from - 1] === '\n') from--;
        return code.slice(0, from) + code.slice(blockEnd);
      }
      scan = nextClose + 6;
    }
  }
  return code;
}

// 1. vectors.list
export const vectorsListOperation: Operation<
  Record<string, never>,
  { vectorSets: IconSetInfo[] }
> = {
  name: 'vectors.list',
  description: 'List all vector/icon sets defined in the project icons/ folder',
  category: 'vectors',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const vectorSets: IconSetInfo[] = [];

    for (const [filePath, content] of snapshot.files.entries()) {
      if (filePath.startsWith('icons/') && filePath.endsWith('.tsx')) {
        if (isIconSetCode(content)) {
          const hash = simpleHash(content);
          const info = parseIconSetFile(filePath, content, hash);
          if (info) {
            vectorSets.push(info);
          }
        }
      }
    }

    return { vectorSets };
  },
};

// 2. vectors.createSet
export const vectorsCreateSetOperation: Operation<
  {
    name: string;
    icons: Array<{
      id?: string;
      displayName?: string;
      name?: string;
      svgMarkup: string;
      width?: number;
      height?: number;
      viewBox?: string;
    }>;
  },
  {
    changes: FileChange[];
    vectorSet: {
      filePath: string;
      exportName: string;
      displayName: string;
      iconCount: number;
    };
  }
> = {
  name: 'vectors.createSet',
  description: 'Create a new vector icon set (.tsx) in icons/ directory',
  category: 'vectors',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    name: z.string().min(1),
    icons: z.array(
      z.object({
        id: z.string().optional(),
        displayName: z.string().optional(),
        name: z.string().optional(),
        svgMarkup: z.string().min(1),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        viewBox: z.string().optional(),
      }),
    ).min(1),
  }),
  async execute(snapshot, input) {
    const clean = input.name.replace(/[^a-zA-Z0-9]/g, '');
    const exportName = (/^[A-Z][a-zA-Z0-9]*$/.test(clean) ? clean : toPascalCase(input.name)) || generateIconSetName();
    const filePath = `icons/${exportName}.tsx`;

    if (snapshot.files.has(filePath)) {
      throw new Error(`FILE_ALREADY_EXISTS: Vector set file "${filePath}" already exists`);
    }

    const entries: IconEntryInput[] = input.icons.map((item, index) => {
      const id = item.id || `icon-${index + 1}`;
      const displayName = item.displayName || item.name || `Vector ${index + 1}`;
      let svg = item.svgMarkup.trim();
      if (!svg.startsWith('<svg')) {
        const vb = item.viewBox || '0 0 100 100';
        svg = `<svg viewBox="${vb}">${svg}</svg>`;
      }
      return {
        id,
        displayName,
        svgJSX: svg,
        leftPx: index * 280,
        topPx: 0,
        widthPx: item.width ?? 240,
        heightPx: item.height ?? 240,
      };
    });

    const code = buildIconSetFile(exportName, input.name, entries);

    return {
      changes: [
        {
          path: filePath,
          beforeHash: null,
          content: code,
        },
      ],
      vectorSet: {
        filePath,
        exportName,
        displayName: input.name,
        iconCount: entries.length,
      },
    };
  },
};

// 3. vectors.addVariant
export const vectorsAddVariantOperation: Operation<
  {
    targetFile: string;
    name: string;
    svgMarkup: string;
    id?: string;
    width?: number;
    height?: number;
  },
  {
    changes: FileChange[];
    variant: {
      id: string;
      name: string;
    };
  }
> = {
  name: 'vectors.addVariant',
  description: 'Add an icon variant into an existing vector set file',
  category: 'vectors',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    name: z.string().min(1),
    svgMarkup: z.string().min(1),
    id: z.string().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const configs = parseIconSetConfig(code);
    const id = input.id || `icon-${configs.length + 1}`;
    const width = input.width ?? 240;
    const height = input.height ?? 240;
    const maxX = configs.reduce((max, c) => Math.max(max, (c.x || 0) + (c.width || 240)), 0);
    const x = configs.length === 0 ? 0 : maxX + 40;

    const newConfig: IconConfig = {
      name: id,
      label: input.name,
      x,
      y: 0,
      width,
      height,
      isPrimary: configs.length === 0,
    };

    const nextConfigs = [...configs, newConfig];
    code = replaceIconSetConfigInCode(code, nextConfigs);

    // Build the JSX block for the new icon
    let svg = input.svgMarkup.trim();
    if (!svg.startsWith('<svg')) {
      svg = `<svg viewBox="0 0 100 100">${svg}</svg>`;
    }
    const newBlock = `      <div data-id="${id}" data-name="${input.name}" style={{ backgroundColor: '#ffffff' }}>\n        ${svg}\n      </div>\n`;

    // Find the closing </div> of the master container
    const masterCloseIdx = code.indexOf('    </div>\n  );');
    if (masterCloseIdx !== -1) {
      code = code.slice(0, masterCloseIdx) + newBlock + code.slice(masterCloseIdx);
    } else {
      // Fallback: search for </div>\n  );
      const fallbackIdx = code.indexOf('</div>\n  );');
      if (fallbackIdx !== -1) {
        code = code.slice(0, fallbackIdx) + newBlock + code.slice(fallbackIdx);
      }
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      variant: {
        id,
        name: input.name,
      },
    };
  },
};

// 4. vectors.removeVariant
export const vectorsRemoveVariantOperation: Operation<
  {
    targetFile: string;
    variantId: string;
  },
  {
    changes: FileChange[];
    removedId: string;
  }
> = {
  name: 'vectors.removeVariant',
  description: 'Remove an icon variant from a vector set file (refuses if only one variant remains)',
  category: 'vectors',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    variantId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const configs = parseIconSetConfig(code);
    if (configs.length <= 1) {
      throw new Error(`CANNOT_REMOVE_LAST_VARIANT: Vector set in "${input.targetFile}" must have at least one variant`);
    }

    const idx = configs.findIndex((c) => c.name === input.variantId);
    if (idx === -1) {
      throw new Error(`VARIANT_NOT_FOUND: Variant "${input.variantId}" not found in "${input.targetFile}"`);
    }

    const wasPrimary = configs[idx].isPrimary;
    const nextConfigs = configs.filter((c) => c.name !== input.variantId);
    if (wasPrimary && nextConfigs.length > 0 && !nextConfigs.some((c) => c.isPrimary)) {
      nextConfigs[0] = { ...nextConfigs[0], isPrimary: true };
    }

    code = replaceIconSetConfigInCode(code, nextConfigs);
    code = removeIconBlockFromCode(code, input.variantId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      removedId: input.variantId,
    };
  },
};

// 5. vectors.searchIcons
export const vectorsSearchIconsOperation: Operation<
  {
    query: string;
    limit?: number;
  },
  {
    icons: Array<{ name: string; library: string }>;
  }
> = {
  name: 'vectors.searchIcons',
  description: 'Search available icon sets and libraries for icon glyphs',
  category: 'vectors',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional().default(20),
  }),
  async execute(_snapshot, input) {
    const q = input.query.toLowerCase();
    const commonIcons = [
      'lucide:arrow-right', 'lucide:arrow-left', 'lucide:check', 'lucide:check-circle',
      'lucide:chevron-down', 'lucide:chevron-right', 'lucide:menu', 'lucide:x',
      'lucide:search', 'lucide:star', 'lucide:heart', 'lucide:user',
      'lucide:mail', 'lucide:phone', 'lucide:map-pin', 'lucide:calendar',
      'lucide:github', 'lucide:twitter', 'lucide:linkedin', 'lucide:instagram',
    ];

    const matched = commonIcons
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, input.limit)
      .map((name) => {
        const [library] = name.split(':');
        return { name, library };
      });

    return { icons: matched };
  },
};

// 6. vectors.retiredSketches
export const vectorsRetiredSketchesOperation: Operation<
  Record<string, never>,
  {
    retired: true;
    reason: string;
  }
> = {
  name: 'vectors.retiredSketches',
  description: 'Compatibility check for retired sketch-set RPCs',
  category: 'vectors',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({}),
  async execute() {
    return {
      retired: true,
      reason: 'sketch sets were removed from the product; vector shapes and sketch draw animations are supported via shapes.* and drawing.sketchAnim.*',
    };
  },
};

defaultRegistry.register(vectorsListOperation);
defaultRegistry.register(vectorsCreateSetOperation);
defaultRegistry.register(vectorsAddVariantOperation);
defaultRegistry.register(vectorsRemoveVariantOperation);
defaultRegistry.register(vectorsSearchIconsOperation);
defaultRegistry.register(vectorsRetiredSketchesOperation);
