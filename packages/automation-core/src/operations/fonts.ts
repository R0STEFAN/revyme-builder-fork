// packages/automation-core/src/operations/fonts.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { DEFAULT_FONTS, type FontItem } from '@/shared/google-fonts';
import {
  extractGoogleFontsFromCSS,
  transformLayoutWithNextFonts,
  getSupportedWeightsForFont,
  type GoogleFontSpec,
} from '@/code/generation/next-font-gen';
import {
  addWorkspaceFontFacesToCss,
  removeWorkspaceFontFacesFromCss,
  type WorkspaceFontFaceSpec,
} from '@/code/project/preset-ops';
import { collectFontFamilies } from '@/code/project/font-preload';

// 1. fonts.catalog
export const fontsCatalogOperation: Operation<
  {
    query?: string;
    category?: string;
    cyrillicOnly?: boolean;
    limit?: number;
  },
  {
    total: number;
    fonts: Array<{
      family: string;
      category: string;
      variants: string[];
      isCyrillic: boolean;
      tags: string[];
    }>;
  }
> = {
  name: 'fonts.catalog',
  description: 'Search and browse the Google Fonts catalog with Cyrillic support, category filters, and weight variants',
  category: 'fonts',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    query: z.string().optional(),
    category: z.string().optional(),
    cyrillicOnly: z.boolean().optional(),
    limit: z.number().int().positive().optional().default(50),
  }),
  async execute(_snapshot, input) {
    let list = DEFAULT_FONTS;

    if (input.query) {
      const q = input.query.toLowerCase().trim();
      list = list.filter((f) => f.family.toLowerCase().includes(q));
    }

    if (input.category && input.category.toLowerCase() !== 'all') {
      const cat = input.category.toLowerCase().trim();
      list = list.filter((f) => f.category.toLowerCase() === cat);
    }

    if (input.cyrillicOnly) {
      list = list.filter((f) => (f.tags || []).some((t) => t.name?.toLowerCase().includes('cyrillic')));
    }

    const total = list.length;
    const limit = input.limit ?? 50;
    const paged = list.slice(0, limit);

    return {
      total,
      fonts: paged.map((f) => ({
        family: f.family,
        category: f.category,
        variants: f.variants,
        isCyrillic: (f.tags || []).some((t) => t.name?.toLowerCase().includes('cyrillic')),
        tags: (f.tags || []).map((t) => t.name),
      })),
    };
  },
};

// 2. fonts.import
export const fontsImportOperation: Operation<
  {
    family: string;
    weights?: string[];
    display?: string;
    targetFile?: string;
  },
  {
    changes: FileChange[];
    family: string;
    importedWeights: string[];
    importUrl: string;
  }
> = {
  name: 'fonts.import',
  description: 'Import a Google Font into app/globals.css with verified weight variants',
  category: 'fonts',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    family: z.string().min(1),
    weights: z.array(z.string()).optional(),
    display: z.string().optional().default('swap'),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const cleanFamily = input.family.trim().replace(/['"]/g, '');
    let css = snapshot.files.get(targetFile) ?? '';

    const validWeights = getSupportedWeightsForFont(cleanFamily, input.weights) || ['400', '600', '700'];
    const wghtStr = validWeights.join(';');
    const urlFamily = `family=${cleanFamily.replace(/ /g, '+')}:wght@${wghtStr}`;
    const display = input.display || 'swap';
    const importUrl = `https://fonts.googleapis.com/css2?${urlFamily}&display=${display}`;
    const importLine = `@import url('${importUrl}');`;

    const existingImportLines: string[] = [];
    const cssWithoutImports = css.replace(/@import\s+url\([^)]*\)[^;]*;\s*\n?/g, (match) => {
      existingImportLines.push(match.trim());
      return '';
    });

    const escapedName = cleanFamily.replace(/ /g, '\\+');
    const existingIdx = existingImportLines.findIndex((line) => line.includes(escapedName));
    if (existingIdx !== -1) {
      existingImportLines[existingIdx] = importLine;
    } else {
      existingImportLines.push(importLine);
    }

    const nextCss = existingImportLines.join('\n') + '\n' + cssWithoutImports;

    return {
      changes: [
        {
          path: targetFile,
          beforeHash: null,
          content: nextCss,
        },
      ],
      family: cleanFamily,
      importedWeights: validWeights,
      importUrl,
    };
  },
};

// 3. fonts.workspace.add
export const fontsWorkspaceAddOperation: Operation<
  {
    family: string;
    url: string;
    weight: number;
    style: 'normal' | 'italic';
    ext: 'woff2' | 'woff' | 'otf' | 'ttf';
    weightRange?: { min: number; max: number };
    unicodeRange?: string;
    targetFile?: string;
  },
  {
    changes: FileChange[];
    font: WorkspaceFontFaceSpec;
  }
> = {
  name: 'fonts.workspace.add',
  description: 'Add a custom workspace font (@font-face) to app/globals.css supporting variable font weights and subsetting',
  category: 'fonts',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    family: z.string().min(1),
    url: z.string().url(),
    weight: z.number().int().positive(),
    style: z.enum(['normal', 'italic']),
    ext: z.enum(['woff2', 'woff', 'otf', 'ttf']),
    weightRange: z
      .object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      })
      .optional(),
    unicodeRange: z.string().optional(),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const css = snapshot.files.get(targetFile) ?? '';

    const fontSpec: WorkspaceFontFaceSpec = {
      family: input.family,
      url: input.url,
      weight: input.weight,
      style: input.style,
      ext: input.ext,
      weightRange: input.weightRange,
      unicodeRange: input.unicodeRange,
    };

    const nextCss = addWorkspaceFontFacesToCss(css, [fontSpec]);

    return {
      changes: [
        {
          path: targetFile,
          beforeHash: null,
          content: nextCss,
        },
      ],
      font: fontSpec,
    };
  },
};

// 4. fonts.workspace.remove
export const fontsWorkspaceRemoveOperation: Operation<
  {
    families: string[];
    targetFile?: string;
  },
  {
    changes: FileChange[];
    removedFamilies: string[];
  }
> = {
  name: 'fonts.workspace.remove',
  description: 'Remove custom workspace font (@font-face) declarations from app/globals.css',
  category: 'fonts',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    families: z.array(z.string().min(1)),
    targetFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/globals.css';
    const css = snapshot.files.get(targetFile) ?? '';

    const nextCss = removeWorkspaceFontFacesFromCss(css, input.families);

    return {
      changes: [
        {
          path: targetFile,
          beforeHash: null,
          content: nextCss,
        },
      ],
      removedFamilies: input.families,
    };
  },
};

// 5. fonts.preload
export const fontsPreloadOperation: Operation<
  Record<string, never>,
  {
    referencedFamilies: string[];
    declarations: Array<{
      family: string;
      isGoogleImport: boolean;
      isWorkspaceFontFace: boolean;
      status: 'loaded' | 'missing';
    }>;
  }
> = {
  name: 'fonts.preload',
  description: 'Scan project files and tokens for all referenced font families and verify their import/@font-face declaration status',
  category: 'fonts',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const fileObj: Record<string, string> = {};
    for (const [p, c] of snapshot.files.entries()) {
      fileObj[p] = c;
    }

    const familiesSet = collectFontFamilies(fileObj);
    const css = snapshot.files.get('app/globals.css') ?? '';

    // Also include fonts declared via @import or @font-face in globals.css
    const declaredGoogle = extractGoogleFontsFromCSS(css);
    for (const g of declaredGoogle) {
      familiesSet.add(g.family);
    }

    const fontFaceRegex = /@font-face\s*\{[^}]*font-family:\s*['"]?([^'";}]+)['"]?/gi;
    let ffm: RegExpExecArray | null;
    while ((ffm = fontFaceRegex.exec(css)) !== null) {
      if (ffm[1]) familiesSet.add(ffm[1].trim());
    }

    const declarations = Array.from(familiesSet).map((family) => {
      const clean = family.toLowerCase();
      const isGoogleImport = new RegExp(`fonts\\.googleapis\\.com.*family=${clean.replace(/ /g, '\\+')}`, 'i').test(css);
      const isWorkspaceFontFace = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*['"]?${clean}['"]?`, 'i').test(css);
      const isSystem = ['sans-serif', 'serif', 'monospace', 'system-ui', 'inter'].includes(clean);

      return {
        family,
        isGoogleImport,
        isWorkspaceFontFace,
        status: isGoogleImport || isWorkspaceFontFace || isSystem ? ('loaded' as const) : ('missing' as const),
      };
    });

    return {
      referencedFamilies: Array.from(familiesSet),
      declarations,
    };
  },
};

// 6. fonts.transformNextFont
export const fontsTransformNextFontOperation: Operation<
  {
    layoutFile?: string;
    globalsFile?: string;
  },
  {
    changes: FileChange[];
    transformedFonts: GoogleFontSpec[];
  }
> = {
  name: 'fonts.transformNextFont',
  description: 'Extract Google Fonts from globals.css and inject next/font/google loaders into app/layout.tsx for zero-latency export',
  category: 'fonts',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T08',
  inputSchema: z.object({
    layoutFile: z.string().optional().default('app/layout.tsx'),
    globalsFile: z.string().optional().default('app/globals.css'),
  }),
  async execute(snapshot, input) {
    const layoutFile = input.layoutFile || 'app/layout.tsx';
    const globalsFile = input.globalsFile || 'app/globals.css';

    const layoutCode = snapshot.files.get(layoutFile);
    if (!layoutCode) {
      throw new Error(`FILE_NOT_FOUND: Layout file "${layoutFile}" not found in project`);
    }

    const globalsCss = snapshot.files.get(globalsFile) ?? '';
    const googleFonts = extractGoogleFontsFromCSS(globalsCss);

    if (googleFonts.length === 0) {
      return {
        changes: [],
        transformedFonts: [],
      };
    }

    const transformedCode = transformLayoutWithNextFonts(layoutCode, googleFonts);

    return {
      changes: [
        {
          path: layoutFile,
          beforeHash: null,
          content: transformedCode,
        },
      ],
      transformedFonts: googleFonts,
    };
  },
};

// Register font operations
defaultRegistry.register(fontsCatalogOperation);
defaultRegistry.register(fontsImportOperation);
defaultRegistry.register(fontsWorkspaceAddOperation);
defaultRegistry.register(fontsWorkspaceRemoveOperation);
defaultRegistry.register(fontsPreloadOperation);
defaultRegistry.register(fontsTransformNextFontOperation);
