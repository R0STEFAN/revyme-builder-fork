// packages/automation-core/test/capabilities/T08-design-system.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import {
  tokensListOperation,
  tokensGetOperation,
  tokensSetOperation,
  tokensRenameOperation,
  tokensRemoveOperation,
  tokensUsageOperation,
  tokensValidateOperation,
} from '../../src/operations/tokens';
import {
  presetsListOperation,
  presetsSetOperation,
  presetsApplyOperation,
  presetsFoldersCreateOperation,
  presetsFoldersListOperation,
} from '../../src/operations/presets';
import {
  typographyListOperation,
  typographyGetOperation,
  typographySetOperation,
  typographyApplyOperation,
  typographyDetachOperation,
  typographyRemoveOperation,
} from '../../src/operations/typography';
import {
  fontsCatalogOperation,
  fontsImportOperation,
  fontsWorkspaceAddOperation,
  fontsWorkspaceRemoveOperation,
  fontsPreloadOperation,
  fontsTransformNextFontOperation,
} from '../../src/operations/fonts';

const mockContext: OperationContext = {
  createId: (kind = 'id') => `${kind}-test-123`,
  signal: new AbortController().signal,
  trace: () => {},
  adapters: {},
};

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return {
    scope: { projectId: 'p1', branchId: 'main' },
    revision: 1,
    files: new Map(Object.entries(files)),
    config: {},
  };
}

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const change of changes) {
    if (change.content === null) {
      files.delete(change.path);
    } else {
      files.set(change.path, change.content);
    }
  }
}

describe('T08: Design System — Tokens, Presets, Themes, Typography and Fonts', () => {
  it('manages brand tokens, light/dark themes, and Invariant 3 empty-string deletion', async () => {
    const initialFiles = {
      'app/globals.css': `/* Design Tokens — Presets */
:root {
  /* Colors */
  --color-brand: #6366f1;
}

:root.dark {
  --color-brand: #818cf8;
}
`,
    };

    let snapshot = createMockSnapshot(initialFiles);

    // 1. Read token list
    const listRes = await tokensListOperation.execute(snapshot, {}, mockContext);
    expect(listRes.tokens).toHaveLength(1);
    expect(listRes.tokens[0].name).toBe('color-brand');
    expect(listRes.tokens[0].value).toBe('#6366f1');
    expect(listRes.tokens[0].darkValue).toBe('#818cf8');

    // 2. Set new surface token with light and dark values
    const setRes = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'color-surface',
        value: '#ffffff',
        darkValue: '#121212',
        category: 'color',
      },
      mockContext,
    );

    const mutableFiles = new Map(snapshot.files);
    applyChanges(mutableFiles, setRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const globalsCss = snapshot.files.get('app/globals.css')!;
    expect(globalsCss).toContain('--color-surface: #ffffff;');
    expect(globalsCss).toContain('--color-surface: #121212;');

    // 3. Test empty-string deletion: clearing dark value only
    const clearDarkRes = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'color-surface',
        darkValue: '',
      },
      mockContext,
    );
    applyChanges(mutableFiles, clearDarkRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const getRes = await tokensGetOperation.execute(snapshot, { name: 'color-surface' }, mockContext);
    expect(getRes.token?.value).toBe('#ffffff');
    expect(getRes.token?.darkValue).toBeNull();

    // 4. Test complete deletion of token with empty string
    const clearTokenRes = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'color-surface',
        value: '',
      },
      mockContext,
    );
    applyChanges(mutableFiles, clearTokenRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const checkDeleted = await tokensGetOperation.execute(snapshot, { name: 'color-surface' }, mockContext);
    expect(checkDeleted.token).toBeNull();
  });

  it('renames tokens updating references across project and guards deletion of in-use tokens', async () => {
    const initialFiles = {
      'app/globals.css': `:root {
  --color-brand: #6366f1;
  --color-secondary: #ec4899;
}
`,
      'app/page.tsx': `export default function Page() {
  return (
    <div data-id="box-1" style={{ backgroundColor: 'var(--color-brand)' }}>
      <span data-id="text-1" style={{ color: 'var(--color-brand)' }}>Hello</span>
    </div>
  );
}`,
      'components/Card.tsx': `export function Card() {
  return <div data-id="card-1" style={{ border: '1px solid var(--color-brand)' }}>Card</div>;
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);

    // 1. Scan usages
    const usageRes = await tokensUsageOperation.execute(snapshot, {}, mockContext);
    expect(usageRes.usages['color-brand']).toBeDefined();
    expect(usageRes.usages['color-brand'].length).toBeGreaterThanOrEqual(2);

    // 2. Renaming --color-brand to --color-primary updates all references
    const renameRes = await tokensRenameOperation.execute(
      snapshot,
      {
        oldName: 'color-brand',
        newName: 'color-primary',
        updateReferences: true,
      },
      mockContext,
    );

    const mutableFiles = new Map(snapshot.files);
    applyChanges(mutableFiles, renameRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.get('app/globals.css')).toContain('--color-primary: #6366f1;');
    expect(snapshot.files.get('app/page.tsx')).toContain("var(--color-primary)");
    expect(snapshot.files.get('components/Card.tsx')).toContain("var(--color-primary)");
    expect(snapshot.files.get('app/page.tsx')).not.toContain("var(--color-brand)");

    // 3. Attempting to remove in-use token without replacement or force fails safely
    await expect(
      tokensRemoveOperation.execute(
        snapshot,
        {
          name: 'color-primary',
          force: false,
        },
        mockContext,
      ),
    ).rejects.toThrow(/TOKEN_IN_USE/);

    // 4. Removing in-use token WITH replacementToken rebinds references
    const removeWithReplace = await tokensRemoveOperation.execute(
      snapshot,
      {
        name: 'color-primary',
        replacementToken: 'color-secondary',
      },
      mockContext,
    );

    applyChanges(mutableFiles, removeWithReplace.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.get('app/globals.css')).not.toContain('--color-primary:');
    expect(snapshot.files.get('app/page.tsx')).toContain("var(--color-secondary)");
    expect(snapshot.files.get('components/Card.tsx')).toContain("var(--color-secondary)");

    // 5. Validation passes (no dead var references)
    const validateRes = await tokensValidateOperation.execute(snapshot, {}, mockContext);
    expect(validateRes.isValid).toBe(true);
  });

  it('manages compound presets (borders, shadows, radius) and organizational folders', async () => {
    const initialFiles = {
      'app/globals.css': `:root {
}\n`,
      'app/page.tsx': `export default function Page() {
  return <div data-id="card-root" style={{ padding: '20px' }}>Content</div>;
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Create a folder for border presets
    const folderRes = await presetsFoldersCreateOperation.execute(
      snapshot,
      {
        category: 'border',
        name: 'Cards & Containers',
      },
      mockContext,
    );
    applyChanges(mutableFiles, folderRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(folderRes.folder.name).toBe('Cards & Containers');
    const foldersList = await presetsFoldersListOperation.execute(snapshot, { category: 'border' }, mockContext);
    expect(foldersList.folders).toHaveLength(1);

    // 2. Create compound border preset
    const borderRes = await presetsSetOperation.execute(
      snapshot,
      {
        category: 'border',
        name: 'subtle',
        values: {
          width: '1px',
          style: 'solid',
          color: '#e5e7eb',
        },
        folderId: folderRes.folder.id,
      },
      mockContext,
    );
    applyChanges(mutableFiles, borderRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.get('app/globals.css')).toContain('--border-subtle-width: 1px;');
    expect(snapshot.files.get('app/globals.css')).toContain('--border-subtle-style: solid;');
    expect(snapshot.files.get('app/globals.css')).toContain('--border-subtle-color: #e5e7eb;');

    // 3. List border presets
    const listBorder = await presetsListOperation.execute(snapshot, { category: 'border' }, mockContext);
    expect(listBorder.presets).toHaveLength(1);
    expect(listBorder.presets[0].name).toBe('subtle');
    expect(listBorder.presets[0].flavor).toBe('solid');

    // 4. Apply preset to a JSX node
    const applyRes = await presetsApplyOperation.execute(
      snapshot,
      {
        category: 'border',
        name: 'subtle',
        targetFile: 'app/page.tsx',
        nodeId: 'card-root',
      },
      mockContext,
    );
    applyChanges(mutableFiles, applyRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toMatch(/borderWidth:\s*['"]var\(--border-subtle-width\)['"]/);
    expect(pageCode).toMatch(/borderStyle:\s*['"]var\(--border-subtle-style\)['"]/);
    expect(pageCode).toMatch(/borderColor:\s*['"]var\(--border-subtle-color\)['"]/);
  });

  it('handles full typography preset lifecycle: creation, responsive tiers, apply, retag, and detach', async () => {
    const initialFiles = {
      'app/globals.css': `:root {
}\n`,
      'app/page.tsx': `export default function Page() {
  return (
    <div>
      <p data-id="hero-header" style={{ position: 'relative' }}>Original Headline</p>
    </div>
  );
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Create typography preset with tag and responsive tiers
    const typoSetRes = await typographySetOperation.execute(
      snapshot,
      {
        name: 'display',
        tag: 'h1',
        values: {
          font: "'Anton', sans-serif",
          weight: '900',
          size: '72px',
          'line-height': '1.1',
          'min-default': '1200',
          'min-md': '600',
        },
        responsiveTiers: {
          md: { size: '48px' },
          sm: { size: '36px' },
        },
      },
      mockContext,
    );
    applyChanges(mutableFiles, typoSetRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const css = snapshot.files.get('app/globals.css')!;
    expect(css).toContain("--typo-display-font: 'Anton', sans-serif;");
    expect(css).toContain('--typo-display-weight: 900;');
    expect(css).toContain('--typo-display-size: 72px;');
    expect(css).toContain('--typo-display-size-md: 48px;');
    expect(css).toContain('--typo-display-size-sm: 36px;');
    expect(css).toContain('--typo-display-tag: h1;');
    // Google font import injected automatically
    expect(css).toContain('@import url(\'https://fonts.googleapis.com/css2?family=Anton');

    // 2. Read preset back
    const getTypo = await typographyGetOperation.execute(snapshot, { name: 'display' }, mockContext);
    expect(getTypo.preset?.name).toBe('display');
    expect(getTypo.preset?.tag).toBe('h1');
    expect(getTypo.preset?.responsiveTiers.md?.size).toBe('48px');

    // 3. Apply preset to <p data-id="hero-header">: retags to <h1> and binds vars and responsive styles
    const applyRes = await typographyApplyOperation.execute(
      snapshot,
      {
        name: 'display',
        targetFile: 'app/page.tsx',
        nodeId: 'hero-header',
        retag: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, applyRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('<h1 data-id="hero-header"');
    expect(pageCode).toMatch(/fontFamily:\s*['"]var\(--typo-display-font\)['"]/);
    expect(pageCode).toMatch(/fontSize:\s*['"]var\(--typo-display-size\)['"]/);
    expect(pageCode).toMatch(/fontWeight:\s*['"]var\(--typo-display-weight\)['"]/);
    expect(pageCode).toContain('@media (max-width: 1199px)');
    expect(pageCode).toContain('[data-id="hero-header"] { font-size: var(--typo-display-size-md) !important; }');

    // 4. Detach preset: bakes literal token values into inline style and removes preset vars
    const detachRes = await typographyDetachOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'hero-header',
      },
      mockContext,
    );
    applyChanges(mutableFiles, detachRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const detachedCode = snapshot.files.get('app/page.tsx')!;
    expect(detachedCode).toMatch(/fontFamily:\s*['"]'Anton',\s*sans-serif['"]/);
    expect(detachedCode).toMatch(/fontSize:\s*['"]72px['"]/);
    expect(detachedCode).toMatch(/fontWeight:\s*['"]900['"]/);
    expect(detachedCode).not.toContain("var(--typo-display-font)");

    // 5. Safe removal
    const removeRes = await typographyRemoveOperation.execute(
      snapshot,
      {
        name: 'display',
        force: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.get('app/globals.css')).not.toContain('--typo-display-font');
  });

  it('supports Google font catalog, verified weight imports, workspace font-face, and layout Next.js font codegen', async () => {
    const initialFiles = {
      'app/globals.css': `:root {\n  --color-bg: #fff;\n}\n`,
      'app/layout.tsx': `export const metadata = { title: 'Test App' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Query font catalog
    const catalogRes = await fontsCatalogOperation.execute(
      snapshot,
      {
        query: 'Inter',
        category: 'sans-serif',
      },
      mockContext,
    );
    expect(catalogRes.fonts.length).toBeGreaterThan(0);
    expect(catalogRes.fonts[0].family).toBe('Inter');
    expect(catalogRes.fonts[0].variants).toContain('regular');

    // 2. Import Google font with weights
    const importRes = await fontsImportOperation.execute(
      snapshot,
      {
        family: 'Playfair Display',
        weights: ['400', '700', '900'], // '900' is not supported by Playfair Display in catalog
      },
      mockContext,
    );
    applyChanges(mutableFiles, importRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(importRes.importedWeights).toEqual(['400', '700']);
    let css = snapshot.files.get('app/globals.css')!;
    expect(css).toContain('@import url(\'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap\');');

    // 3. Add custom workspace font face with variable range and unicode-range
    const wsAddRes = await fontsWorkspaceAddOperation.execute(
      snapshot,
      {
        family: 'Acme Variable Sans',
        url: 'https://assets.revyme.app/fonts/acme-var.woff2',
        weight: 400,
        style: 'normal',
        ext: 'woff2',
        weightRange: { min: 100, max: 900 },
        unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153',
      },
      mockContext,
    );
    applyChanges(mutableFiles, wsAddRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    css = snapshot.files.get('app/globals.css')!;
    expect(css).toContain("@font-face {\n  font-family: 'Acme Variable Sans';");
    expect(css).toContain("url('https://assets.revyme.app/fonts/acme-var.woff2') format('woff2');");
    expect(css).toContain('font-weight: 100 900;');
    expect(css).toContain('unicode-range: U+0000-00FF, U+0131, U+0152-0153;');

    // 4. Preload audit
    const preloadRes = await fontsPreloadOperation.execute(snapshot, {}, mockContext);
    const playfairDecl = preloadRes.declarations.find((d) => d.family === 'Playfair Display');
    expect(playfairDecl?.isGoogleImport).toBe(true);

    // 5. Transform layout with Next.js zero-latency font loaders
    const transformRes = await fontsTransformNextFontOperation.execute(
      snapshot,
      {
        layoutFile: 'app/layout.tsx',
        globalsFile: 'app/globals.css',
      },
      mockContext,
    );
    applyChanges(mutableFiles, transformRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const layoutCode = snapshot.files.get('app/layout.tsx')!;
    expect(layoutCode).toContain("import { Playfair_Display } from 'next/font/google';");
    expect(layoutCode).toContain("const playfairDisplay = Playfair_Display({");
    expect(layoutCode).toContain("variable: '--font-playfair-display'");
    expect(layoutCode).toContain("${playfairDisplay.variable}");

    // 6. Remove workspace custom font
    const wsRemoveRes = await fontsWorkspaceRemoveOperation.execute(
      snapshot,
      {
        families: ['Acme Variable Sans'],
      },
      mockContext,
    );
    applyChanges(mutableFiles, wsRemoveRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.get('app/globals.css')).not.toContain('Acme Variable Sans');
  });
});
