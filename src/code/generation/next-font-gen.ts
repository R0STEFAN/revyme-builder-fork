// next-font-gen.ts — Transforms Google Fonts from CSS @import into Next.js next/font/google.
//
// In the canvas/editor, fonts load via CSS @import for instant live-preview without
// restarting servers. At export and build time, this module extracts those Google Fonts
// and transforms them into zero-latency, locally-hosted next/font/google loaders
// in app/layout.tsx.

import { trace } from '@/shared/debug-trace';
import catalogFonts from '@/shared/google-fonts-catalog.json';

export interface GoogleFontSpec {
  family: string;
  identifier: string;
  variable: string;
  weights?: string[];
  subsets: string[];
  display?: string;
  importUrl: string;
}

const fontCatalogMap = new Map<string, { family: string; variants: string[]; isCyrillic: boolean }>();

for (const item of (catalogFonts as any[])) {
  const isCyrillic = (item.tags || []).some((t: any) => t.name?.includes('Cyrillic'));
  fontCatalogMap.set(item.family.toLowerCase(), {
    family: item.family,
    variants: item.variants || [],
    isCyrillic,
  });
}

/**
 * Returns strictly valid font weights for a Google Font according to the catalog.
 * E.g. Syne only supports ['400', '500', '600', '700', '800'] (rejects invalid '300').
 */
export function getSupportedWeightsForFont(family: string, requestedWeights?: string[]): string[] | undefined {
  const entry = fontCatalogMap.get(family.toLowerCase());
  if (!entry || !entry.variants || entry.variants.length === 0) {
    return requestedWeights && requestedWeights.length > 0 ? requestedWeights : undefined;
  }

  const supported = new Set<string>();
  for (const v of entry.variants) {
    if (v === 'regular' || v === 'italic') {
      supported.add('400');
    } else {
      const m = v.match(/^(\d+)/);
      if (m) supported.add(m[1]);
    }
  }

  if (supported.size === 0) return undefined;

  if (requestedWeights && requestedWeights.length > 0) {
    const valid = requestedWeights.filter((w) => supported.has(w));
    if (valid.length > 0) return valid;
  }

  return Array.from(supported).sort();
}

/**
 * Returns valid subsets for a Google Font (includes 'cyrillic' if supported by the font).
 */
export function getSubsetsForFont(family: string): string[] {
  const entry = fontCatalogMap.get(family.toLowerCase());
  if (entry?.isCyrillic) {
    return ['latin', 'cyrillic'];
  }
  return ['latin'];
}

/**
 * Converts a font family name into a valid Next.js next/font/google export identifier.
 * E.g. "Comfortaa" -> "Comfortaa", "Playfair Display" -> "Playfair_Display", "Plus-Jakarta-Sans" -> "Plus_Jakarta_Sans".
 */
export function fontNameToNextFontIdentifier(family: string): string {
  const clean = family.trim().replace(/['"]/g, '');
  return clean.replace(/[\s-]+/g, '_');
}

/**
 * Converts a font family name into a CSS variable name.
 * E.g. "Comfortaa" -> "--font-comfortaa", "Playfair Display" -> "--font-playfair-display".
 */
export function fontNameToCssVar(family: string): string {
  const clean = family.trim().replace(/['"]/g, '').toLowerCase();
  const slug = clean.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `--font-${slug}`;
}

/**
 * Converts an identifier like "Playfair_Display" into a camelCase JS variable name like "playfairDisplay".
 */
export function identifierToVariableName(identifier: string): string {
  const parts = identifier.split('_');
  return parts.map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join('');
}

/**
 * Extracts Google Font specifications from CSS content (@import url('https://fonts.googleapis.com/...')).
 */
export function extractGoogleFontsFromCSS(css: string): GoogleFontSpec[] {
  if (!css || typeof css !== 'string') return [];

  const importRegex = /@import\s+(?:url\(['"]?([^'")]+)['"]?\)|['"]([^'"]+)['"]);?/g;
  const fonts: GoogleFontSpec[] = [];
  const seenFamilies = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(css)) !== null) {
    const url = match[1] || match[2];
    if (!url || !url.includes('fonts.googleapis.com')) continue;

    try {
      // Parse query string from url
      const queryIdx = url.indexOf('?');
      if (queryIdx === -1) continue;
      const queryStr = url.slice(queryIdx + 1);
      const params = new URLSearchParams(queryStr);

      const familyParam = params.get('family');
      if (!familyParam) continue;

      // Format: "FamilyName:wght@300;400;700" or "Playfair+Display:ital,wght@0,400;1,700"
      const [rawFamily, spec] = familyParam.split(':');
      const familyName = decodeURIComponent(rawFamily.replace(/\+/g, ' ')).trim();

      if (!familyName || seenFamilies.has(familyName.toLowerCase())) continue;
      seenFamilies.add(familyName.toLowerCase());

      let rawRequestedWeights: string[] | undefined;
      if (spec) {
        const wghtMatch = spec.match(/wght@([0-9;.,]+)/);
        if (wghtMatch && wghtMatch[1]) {
          const parsed = wghtMatch[1]
            .split(';')
            .map((w) => {
              // Handle "0,400" or "400..900" or "400"
              const parts = w.split(',');
              const val = parts[parts.length - 1];
              return val.includes('..') ? val.split('..')[0] : val;
            })
            .filter((w) => w && /^\d+$/.test(w));
          if (parsed.length > 0) {
            rawRequestedWeights = Array.from(new Set(parsed));
          }
        }
      }

      // Filter and validate weights strictly against catalog
      const weights = getSupportedWeightsForFont(familyName, rawRequestedWeights);
      const subsets = getSubsetsForFont(familyName);
      const display = params.get('display') || 'swap';

      fonts.push({
        family: familyName,
        identifier: fontNameToNextFontIdentifier(familyName),
        variable: fontNameToCssVar(familyName),
        weights,
        subsets,
        display,
        importUrl: url,
      });
    } catch {
      // Ignore malformed URLs
    }
  }

  return fonts;
}

/**
 * Transforms an existing app/layout.tsx code by injecting next/font/google
 * imports, instantiations, and CSS variables onto <html>.
 */
export function transformLayoutWithNextFonts(layoutCode: string, fonts: GoogleFontSpec[]): string {
  if (!fonts.length || !layoutCode) return layoutCode;

  // Check if next/font/google is already imported
  const identifiers = Array.from(new Set(fonts.map((f) => f.identifier)));
  const fontVarNames = fonts.map((f) => ({
    spec: f,
    varName: identifierToVariableName(f.identifier),
  }));

  const fontImports = `import { ${identifiers.join(', ')} } from 'next/font/google';`;

  const fontInstances = fontVarNames
    .map(({ spec, varName }) => {
      const weightsConfig =
        spec.weights && spec.weights.length > 0
          ? `\n  weight: [${spec.weights.map((w) => `'${w}'`).join(', ')}],`
          : '';

      const subsets = spec.subsets && spec.subsets.length > 0 ? spec.subsets : ['latin'];
      const subsetsStr = subsets.map((s) => `'${s}'`).join(', ');

      return `const ${varName} = ${spec.identifier}({\n  subsets: [${subsetsStr}],${weightsConfig}\n  variable: '${spec.variable}',\n  display: '${spec.display || 'swap'}',\n});`;
    })
    .join('\n\n');

  let updated = layoutCode;

  // 1. Insert import at the top (after other imports)
  if (!updated.includes('from \'next/font/google\'') && !updated.includes('from "next/font/google"')) {
    // Place right after the last import line or at start
    const lastImportMatch = Array.from(updated.matchAll(/^import\s+[^;]+;(?:\r?\n)?/gm)).pop();
    if (lastImportMatch && lastImportMatch.index !== undefined) {
      const insertPos = lastImportMatch.index + lastImportMatch[0].length;
      updated = updated.slice(0, insertPos) + fontImports + '\n' + updated.slice(insertPos);
    } else {
      updated = fontImports + '\n' + updated;
    }
  }

  // 2. Insert font instances before `export default function` or `export const metadata`
  if (!updated.includes(fontVarNames[0].varName + ' = ' + fontVarNames[0].spec.identifier)) {
    const defaultExportIdx = updated.indexOf('export default function');
    const metadataExportIdx = updated.indexOf('export const metadata');
    const insertIdx = metadataExportIdx !== -1 ? metadataExportIdx : defaultExportIdx;

    if (insertIdx !== -1) {
      updated = updated.slice(0, insertIdx) + fontInstances + '\n\n' + updated.slice(insertIdx);
    } else {
      updated = updated + '\n\n' + fontInstances;
    }
  }

  // 3. Add font variables to <html ...> className
  const fontVarClasses = fontVarNames.map(({ varName }) => `\${${varName}.variable}`).join(' ');

  // Match <html ...>
  const htmlTagMatch = updated.match(/<html([^>]*)>/);
  if (htmlTagMatch) {
    const attrs = htmlTagMatch[1];
    const classNameMatch = attrs.match(/className=(?:\{`([^`]*)`\}|"([^"]*)"|'([^']*)')/);

    if (classNameMatch) {
      // Already has className
      const existingClass = classNameMatch[1] || classNameMatch[2] || classNameMatch[3] || '';
      if (!existingClass.includes(fontVarNames[0].varName)) {
        const newClassAttr = `className={\`${existingClass} ${fontVarClasses}\`}`;
        const newAttrs = attrs.replace(classNameMatch[0], newClassAttr);
        updated = updated.replace(htmlTagMatch[0], `<html${newAttrs}>`);
      }
    } else {
      // Add className attribute
      const newAttrs = `${attrs} className={\`${fontVarClasses}\`}`;
      updated = updated.replace(htmlTagMatch[0], `<html${newAttrs}>`);
    }
  }

  trace.action('next-font-gen:transformLayout', { fontCount: fonts.length });
  return updated;
}

/**
 * Transforms all project files for next/font/google support:
 * 1. Scans CSS files for Google Fonts.
 * 2. Injects next/font/google loaders into app/layout.tsx.
 * 3. Strips external Google Fonts @import from CSS files.
 * 4. Ensures font-family references fallback to the CSS variable.
 */
export function transformSiteFilesForNextFonts(files: Record<string, string>): Record<string, string> {
  const result = { ...files };

  // Scan all CSS files for Google Fonts @import
  const allFonts: GoogleFontSpec[] = [];
  const seenFamilies = new Set<string>();

  for (const [path, content] of Object.entries(result)) {
    if (path.endsWith('.css')) {
      const fonts = extractGoogleFontsFromCSS(content);
      for (const f of fonts) {
        if (!seenFamilies.has(f.family.toLowerCase())) {
          seenFamilies.add(f.family.toLowerCase());
          allFonts.push(f);
        }
      }
    }
  }

  if (allFonts.length === 0) return result;

  // Transform app/layout.tsx
  if (result['app/layout.tsx']) {
    result['app/layout.tsx'] = transformLayoutWithNextFonts(result['app/layout.tsx'], allFonts);
  }

  // Strip @import from CSS files and wire variables
  for (const [path, content] of Object.entries(result)) {
    if (path.endsWith('.css')) {
      let cleaned = content.replace(/@import\s+(?:url\(['"]?https:\/\/fonts\.googleapis\.com\/[^'")]+['"]?\)|['"]https:\/\/fonts\.googleapis\.com\/[^'"]+['"]);?\s*\n?/g, '');

      // Replace font-family: 'Comfortaa', ... with font-family: var(--font-comfortaa), 'Comfortaa', ...
      for (const font of allFonts) {
        const escaped = font.family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fontFamRegex = new RegExp(`(['"])${escaped}\\1`, 'g');
        cleaned = cleaned.replace(fontFamRegex, (match) => `var(${font.variable}), ${match}`);
      }

      result[path] = cleaned;
    }
  }

  trace.action('next-font-gen:transformSiteFiles', { fonts: allFonts.map((f) => f.family) });
  return result;
}
