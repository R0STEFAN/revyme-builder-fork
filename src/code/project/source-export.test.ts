import { describe, it, expect } from 'vitest';
import { buildSourceExport, localizeUrlImports, exportSlug, isBuilderMetadataPath, prepareSiteFiles } from './source-export';
import { createOverlayInCode } from '../generation/overlay-gen';
import { PAGE_TRANSITIONS_SOURCE } from '../generation/page-transitions-gen';

const PAGE = "'use client';\nexport default function Page() { return <div data-id=\"root\" />; }\n";
const NOW = new Date('2026-09-30T12:00:00Z');

describe('buildSourceExport (standalone Next.js export)', () => {
  it('upgrades legacy dropdown and transition controllers in a template component before building', async () => {
    const master = createOverlayInCode(`'use client';
import React, { useState, useLayoutEffect } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';
function Navbar({ style, ...rest }: { style?: React.CSSProperties; [key: string]: any }) {
  return <LayoutGroup><motion.nav data-id="navbar" {...rest} style={{ ...style }}><button data-id="trigger">Menu</button></motion.nav></LayoutGroup>;
}
export default withResponsiveProps(Navbar);`, 'trigger', 'menu', {
      type: 'relative', triggerId: 'trigger', side: 'bottom', align: 'start', offsetX: 0, offsetY: 0, closeOnLink: true,
    }, { targetId: 'menu', trigger: 'click', dismiss: 'outside' });
    const legacyMaster = master.replace(/const onOverlayClick = [\s\S]*?document\.addEventListener\('click', onOverlayClick.*?\);/g, '')
      .replace(/document\.removeEventListener\('click', onOverlayClick.*?\);/g, '');
    expect(legacyMaster).not.toContain('onOverlayClick');
    const legacyTransition = PAGE_TRANSITIONS_SOURCE.replace('e.preventDefault();', 'e.preventDefault();\n      e.stopImmediatePropagation();');
    const input = {
      'components/Navbar.tsx': legacyMaster,
      'app/(site)/page-transitions.tsx': legacyTransition,
      'app/(site)/LayoutClient.tsx': '<Navbar />{children}',
    };
    const prepared = prepareSiteFiles(input);
    expect(prepared['components/Navbar.tsx']).toContain('onOverlayClick');
    expect(prepared['app/(site)/page-transitions.tsx']).not.toContain('stopImmediatePropagation');
    expect(input['components/Navbar.tsx']).toBe(legacyMaster);
    const exported = await buildSourceExport(input, { name: null, runtimeRange: '^1', now: NOW });
    expect(exported.files['components/Navbar.tsx']).toBe(prepared['components/Navbar.tsx']);
    expect(exported.files['app/(site)/page-transitions.tsx']).toBe(prepared['app/(site)/page-transitions.tsx']);
  });

  it('upgrades a generated controller at the app root without changing unrelated files', () => {
    const legacy = PAGE_TRANSITIONS_SOURCE.replace('e.preventDefault();', 'e.preventDefault();\n      e.stopImmediatePropagation();');
    const files = prepareSiteFiles({
      'app/page-transitions.tsx': legacy,
      'app/custom.tsx': 'export const custom = true;',
    });
    expect(files['app/page-transitions.tsx']).not.toContain('stopImmediatePropagation');
    expect(files['app/custom.tsx']).toBe('export const custom = true;');
  });

  it('ships the project minus builder metadata, plus the Next.js scaffold', async () => {
    const out = await buildSourceExport({
      'app/page.client.tsx': PAGE,
      'app/page.tsx': "import P from './page.client';\nexport default function Page() { return <P />; }\n",
      '_meta/agent-chats.json': '{}',
      '_revyme/variants/t/a.tsx': PAGE,
      'cms/posts.json': '[]',
    }, { name: 'Halden Studio', runtimeRange: '^0.0.28', now: NOW, fetchImpl: async () => { throw new Error('no network'); } });
    expect(Object.keys(out.files).sort()).toEqual([
      '.gitignore', 'README.md', 'app/page.client.tsx', 'app/page.tsx', 'cms/posts.json', 'next.config.mjs', 'package.json', 'tsconfig.json',
    ]);
    expect(out.filename).toBe('halden-studio.zip');
    const pkg = JSON.parse(out.files['package.json']);
    expect(pkg).toMatchObject({ name: 'halden-studio', private: true, scripts: { dev: 'next dev', build: 'next build' } });
    expect(pkg.dependencies['@revyme/runtime']).toBe('^0.0.28');
    expect(pkg.dependencies.next).toBe('^16');
    expect(pkg.dependencies).not.toHaveProperty('gsap');
    expect(JSON.parse(out.files['tsconfig.json']).compilerOptions.paths).toEqual({ '@/*': ['./*'] });
    // Next 16: no removed `next lint` script, no unsupported `eslint` config key.
    expect(pkg.scripts).not.toHaveProperty('lint');
    expect(out.files['next.config.mjs']).not.toContain('eslint');
    expect(out.files['README.md']).toMatch(/^# Halden Studio\n/);
  });

  it('keeps the project\'s own config files; README is always added', async () => {
    const out = await buildSourceExport({
      'app/page.client.tsx': PAGE,
      'package.json': '{"name":"mine"}',
      'next.config.js': 'module.exports = {};',
      'tsconfig.json': '{}',
      '.gitignore': 'x',
    }, { name: null, runtimeRange: '^1', now: NOW });
    expect(out.files['package.json']).toBe('{"name":"mine"}');
    expect(out.files['next.config.mjs']).toBeUndefined();
    expect(out.files['tsconfig.json']).toBe('{}');
    expect(out.files['.gitignore']).toBe('x');
    expect(out.files['README.md']).toMatch(/^# Revyme project/);
    expect(out.filename).toBe('revyme-site.zip');
  });

  it('downloads marketplace components imported by URL and rewrites the imports (nested, deduped)', async () => {
    const A = 'https://assets.revyme.app/components/ArcMeter@0123456789abcdef.js';
    const B = 'https://assets.revyme.app/components/Dial@fedcba9876543210.js';
    const fetched: string[] = [];
    const out = await localizeUrlImports({
      'app/page.client.tsx': `import ArcMeter from "${A}";\nimport Again from '${A}';`,
      'styles.css': `/* ${A} */`,
    }, async (url) => {
      fetched.push(url);
      return url === A ? `import Dial from "${B}"; export default 1;` : 'export default 2;';
    });
    expect(fetched).toEqual([A, B]);
    expect(out.files['app/page.client.tsx']).toBe('import ArcMeter from "@/components/remote/ArcMeter-01234567.js";\nimport Again from \'@/components/remote/ArcMeter-01234567.js\';');
    expect(out.files['components/remote/ArcMeter-01234567.js']).toBe('import Dial from "@/components/remote/Dial-fedcba98.js"; export default 1;');
    expect(out.files['components/remote/Dial-fedcba98.js']).toBe('export default 2;');
    expect(out.files['styles.css']).toBe(`/* ${A} */`);   // not a module
    expect(out.downloaded).toEqual(['components/remote/Dial-fedcba98.js', 'components/remote/ArcMeter-01234567.js']);
  });

  it('an unreachable bundle stays a URL and is reported', async () => {
    const A = 'https://assets.revyme.app/components/ArcMeter@0123456789abcdef.js';
    const out = await localizeUrlImports({ 'app/page.client.tsx': `import X from "${A}";` }, async () => { throw new Error('offline'); });
    expect(out.files['app/page.client.tsx']).toBe(`import X from "${A}";`);
    expect(out.failed).toEqual([A]);
  });

  it('slugs and metadata paths', () => {
    expect(exportSlug('  My Site!! ')).toBe('my-site');
    expect(exportSlug('')).toBe('revyme-site');
    expect(isBuilderMetadataPath('_meta/x.json')).toBe(true);
    expect(isBuilderMetadataPath('app/_private/page.tsx')).toBe(false);
  });
});
