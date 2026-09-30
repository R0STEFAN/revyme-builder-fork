import { describe, it, expect } from 'vitest';
import { buildSourceExport, localizeUrlImports, exportSlug, isBuilderMetadataPath } from './source-export';

const PAGE = "'use client';\nexport default function Page() { return <div data-id=\"root\" />; }\n";
const NOW = new Date('2026-09-30T12:00:00Z');

describe('buildSourceExport (standalone Next.js export)', () => {
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
