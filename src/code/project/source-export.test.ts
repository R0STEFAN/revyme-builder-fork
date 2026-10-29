import { describe, it, expect } from 'vitest';
import { buildSourceExport, localizeUrlImports, exportSlug, isBuilderMetadataPath, prepareSiteFiles, getUploadSrcSet, injectResponsiveImageSrcSets, ensureSeoAndAiDiscoveryFiles } from './source-export';
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
      '.gitignore',
      'README.md',
      'app/llms-full.txt/route.ts',
      'app/llms.txt/route.ts',
      'app/page.client.tsx',
      'app/page.tsx',
      'app/robots.ts',
      'app/sitemap.ts',
      'cms/posts.json',
      'lib/image-utils.ts',
      'next.config.mjs',
      'package.json',
      'scripts/optimize-images.mjs',
      'tsconfig.json',
    ]);
    expect(out.filename).toBe('halden-studio.zip');
    const pkg = JSON.parse(out.files['package.json']);
    expect(pkg).toMatchObject({
      name: 'halden-studio',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        'optimize-images': 'node scripts/optimize-images.mjs',
        prebuild: 'npm run optimize-images',
      },
      devDependencies: {
        sharp: '^0.35.5',
      },
    });
    expect(pkg.dependencies['@revyme/runtime']).toBe('^0.0.28');
    expect(pkg.dependencies.next).toBe('^16');
    expect(pkg.dependencies).not.toHaveProperty('gsap');
    expect(JSON.parse(out.files['tsconfig.json']).compilerOptions.paths).toEqual({ '@/*': ['./*'] });
    expect(out.files['scripts/optimize-images.mjs']).toContain('sharp');
    expect(out.files['lib/image-utils.ts']).toContain('getUploadSrcSet');
    // Next 16: no removed `next lint` script, no unsupported `eslint` config key.
    expect(pkg.scripts).not.toHaveProperty('lint');
    expect(out.files['next.config.mjs']).not.toContain('eslint');
    expect(out.files['README.md']).toMatch(/^# Halden Studio\n/);
  });

  it('exports localized multi-locale project into app/[lang] tree with proxy.ts', async () => {
    const out = await buildSourceExport({
      'i18n/config.json': JSON.stringify({
        defaultLocale: 'uk',
        locales: [{ code: 'uk', label: 'Ukrainian' }, { code: 'en', label: 'English' }],
      }),
      'app/layout.tsx': `import './globals.css';\nimport { Providers } from './providers';\nexport default function RootLayout({ children }: any) { return <html><body><Providers>{children}</Providers></body></html>; }`,
      'app/globals.css': 'body { margin: 0; }',
      'app/providers.tsx': 'export function Providers({ children }: any) { return children; }',
      'app/page.client.tsx': PAGE,
      'app/page.tsx': 'export default function Page() { return null; }',
    }, { name: 'Localized Site', runtimeRange: '^1', now: NOW });

    expect(out.files['app/[lang]/page.tsx']).toBeDefined();
    expect(out.files['app/[lang]/page.client.tsx']).toBeDefined();
    expect(out.files['app/[lang]/layout.tsx']).toBeDefined();
    expect(out.files['app/layout.tsx']).toBeUndefined();
    expect(out.files['proxy.ts']).toBeDefined();
    expect(out.files['lib/revyme-locale-routing.ts']).toBeDefined();
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

  it('automatically converts Google Fonts @import to next/font/google in exported layout', async () => {
    const layout = `import './globals.css';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
    const tokens = `@import url('https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;700&display=swap');
:root {
  --font-heading: 'Comfortaa', sans-serif;
}`;
    const out = await buildSourceExport({
      'app/layout.tsx': layout,
      'app/page.client.tsx': PAGE,
      'app/page.tsx': "import P from './page.client';\nexport default function Page() { return <P />; }\n",
      'styles/tokens.css': tokens,
    }, { name: 'Font Site', runtimeRange: '^1', now: NOW });

    expect(out.files['app/layout.tsx']).toContain("import { Comfortaa } from 'next/font/google';");
    expect(out.files['app/layout.tsx']).toContain('${comfortaa.variable}');
    expect(out.files['styles/tokens.css']).not.toContain('@import url(');
    expect(out.files['styles/tokens.css']).toContain("var(--font-comfortaa), 'Comfortaa', sans-serif");
  });

  it('slugs and metadata paths', () => {
    expect(exportSlug('  My Site!! ')).toBe('my-site');
    expect(exportSlug('')).toBe('revyme-site');
    expect(isBuilderMetadataPath('_meta/x.json')).toBe(true);
    expect(isBuilderMetadataPath('app/_private/page.tsx')).toBe(false);
  });

  it('generates correct srcSet with getUploadSrcSet', () => {
    expect(getUploadSrcSet(undefined)).toBeUndefined();
    expect(getUploadSrcSet(null)).toBeUndefined();
    expect(getUploadSrcSet('')).toBeUndefined();
    expect(getUploadSrcSet('https://example.com/pic.jpg')).toBeUndefined();
    expect(getUploadSrcSet('/other/path.png')).toBeUndefined();
    expect(getUploadSrcSet('/uploads/hero.png')).toBe(
      '/uploads/hero-320w.webp 320w, /uploads/hero-640w.webp 640w, /uploads/hero-768w.webp 768w, /uploads/hero-1024w.webp 1024w, /uploads/hero-1280w.webp 1280w, /uploads/hero-1920w.webp 1920w'
    );
    expect(getUploadSrcSet('/api/uploads/photo.jpg?query=1#hash')).toBe(
      '/api/uploads/photo-320w.webp 320w, /api/uploads/photo-640w.webp 640w, /api/uploads/photo-768w.webp 768w, /api/uploads/photo-1024w.webp 1024w, /api/uploads/photo-1280w.webp 1280w, /api/uploads/photo-1920w.webp 1920w'
    );
  });

  it('injects responsive srcSet and sizes into <img ...> elements during export', () => {
    const rawCode = `
export default function Page() {
  return (
    <div>
      <img
        data-id="img1"
        data-name="Image"
        src="/api/uploads/1791474873750-d8fd12f5.webp"
        alt=""
        loading="lazy"
        decoding="async"
        style={{ width: '100%' }}
      />
      <img
        data-id="cms-img"
        src={item.photo}
        alt="User"
      />
      <img
        data-id="external"
        src="https://images.unsplash.com/photo-123"
        alt="External"
      />
    </div>
  );
}`;
    const transformed = injectResponsiveImageSrcSets(rawCode);
    expect(transformed).toContain('srcSet="/api/uploads/1791474873750-d8fd12f5-320w.webp 320w, /api/uploads/1791474873750-d8fd12f5-640w.webp 640w');
    expect(transformed).toContain('sizes="100vw"');
    expect(transformed).toContain('srcSet={getUploadSrcSet(item.photo)}');
    expect(transformed).toMatch(/import \{ getUploadSrcSet \} from ['"]@\/lib\/image-utils['"];/);
    // External images without upload prefix don't get responsive srcSet
    expect(transformed).not.toContain('srcSet="https://images.unsplash.com');
  });

  it('infers optimal sizes="145px" for thumbnail images during export', () => {
    const rawCode = `
export default function Page() {
  return (
    <img
      data-id="thumb"
      src="/api/uploads/thumb.webp"
      style={{ width: '145px', height: '121px' }}
    />
  );
}`;
    const transformed = injectResponsiveImageSrcSets(rawCode);
    expect(transformed).toContain('sizes="145px"');
  });

  it('upgrades default sizes="100vw" to sizes="145px" when style width is 145px', () => {
    const rawCode = `
export default function Page() {
  return (
    <img
      data-id="thumb"
      sizes="100vw"
      src="/api/uploads/thumb.webp"
      style={{ width: '145px', height: '121px' }}
    />
  );
}`;
    const transformed = injectResponsiveImageSrcSets(rawCode);
    expect(transformed).toContain('sizes="145px"');
    expect(transformed).not.toContain('sizes="100vw"');
  });

  describe('Hybrid SSG vs Dynamic export variants', () => {
    const cmsDetailPage = `import PageClient from './page.client';
import articles from '@/cms/articles.json';

export async function generateMetadata({ params }) {
  return { title: 'Article' };
}

export default function Page() {
  return <PageClient />;
}
`;
    const localeDetailPage = `/** @revyme-locale-route fr — GENERATED route for /fr/articles/[slug].
 *  Content lives in app/articles/[slug]/page.client.tsx; app/providers.tsx resolves the locale
 *  from the URL. The editor regenerates this file on locale/page changes.
 *  Do not edit. */
export { default } from '@/app/articles/[slug]/page';
`;
    const pageWithImage = `export default function Page() {
  return (
    <div>
      <img
        data-id="img1"
        src="/api/uploads/photo.jpg"
        alt=""
        style={{ width: '100%' }}
      />
    </div>
  );
}`;
    const projectFiles = {
      'app/articles/[slug]/page.tsx': cmsDetailPage,
      'app/articles/[slug]/page.client.tsx': pageWithImage,
      'app/fr/articles/[slug]/page.tsx': localeDetailPage,
      'cms/articles.json': '[{"_slug":"hello","title":"Hello"}]',
    };

    it('dynamic export (ssg: false or omitted) does not include generateStaticParams in CMS detail or locale wrapper', async () => {
      const omitted = await buildSourceExport(projectFiles, { name: 'Dynamic Site', runtimeRange: '^1', now: NOW });
      expect(omitted.files['app/articles/[slug]/page.tsx']).not.toContain('generateStaticParams');
      expect(omitted.files['app/fr/articles/[slug]/page.tsx']).toContain("export { default } from '@/app/articles/[slug]/page';");
      expect(omitted.files['app/fr/articles/[slug]/page.tsx']).not.toContain('generateStaticParams');

      const explicitFalse = await buildSourceExport(projectFiles, { name: 'Dynamic Site', runtimeRange: '^1', now: NOW, ssg: false });
      expect(explicitFalse.files['app/articles/[slug]/page.tsx']).not.toContain('generateStaticParams');
      expect(explicitFalse.files['app/fr/articles/[slug]/page.tsx']).toContain("export { default } from '@/app/articles/[slug]/page';");
      expect(explicitFalse.files['app/fr/articles/[slug]/page.tsx']).not.toContain('generateStaticParams');

      // Both retain image-utils, optimize-images, responsive srcSet, and sharp
      expect(omitted.files['lib/image-utils.ts']).toContain('getUploadSrcSet');
      expect(omitted.files['scripts/optimize-images.mjs']).toContain('sharp');
      expect(omitted.files['app/articles/[slug]/page.client.tsx']).toContain('srcSet="/api/uploads/photo-320w.webp 320w');
      expect(JSON.parse(omitted.files['package.json']).devDependencies.sharp).toBe('^0.35.5');
    });

    it('hybrid SSG export (ssg: true) includes generateStaticParams in CMS detail and re-exports in dynamic locale wrapper', async () => {
      const ssg = await buildSourceExport(projectFiles, { name: 'SSG Site', runtimeRange: '^1', now: NOW, ssg: true });

      // CMS detail page has generateStaticParams injected
      expect(ssg.files['app/articles/[slug]/page.tsx']).toContain('export async function generateStaticParams()');
      expect(ssg.files['app/articles/[slug]/page.tsx']).toContain('const items = Array.isArray(articles) ? articles : [];');

      // Dynamic locale route re-exports generateStaticParams
      expect(ssg.files['app/fr/articles/[slug]/page.tsx']).toContain(
        "export { default, generateStaticParams } from '@/app/articles/[slug]/page';",
      );

      // Retains image-utils, optimize-images, responsive srcSet, and sharp
      expect(ssg.files['lib/image-utils.ts']).toContain('getUploadSrcSet');
      expect(ssg.files['scripts/optimize-images.mjs']).toContain('sharp');
      expect(ssg.files['app/articles/[slug]/page.client.tsx']).toContain('srcSet="/api/uploads/photo-320w.webp 320w');
      expect(JSON.parse(ssg.files['package.json']).devDependencies.sharp).toBe('^0.35.5');
    });
  });

  describe('ensureSeoAndAiDiscoveryFiles', () => {
    it('automatically generates sitemap, robots, and llms route files from project files', async () => {
      const files = {
        'app/page.tsx': "export default function Page() { return <div>Home</div>; }",
        'app/about/page.tsx': "export default function About() { return <div>About</div>; }",
        'app/blog/[slug]/page.tsx': "import posts from '@/cms/posts.json';\nexport default function Blog() { return <div>Post</div>; }",
        'cms/posts.json': JSON.stringify([{ slug: 'hello-world', title: 'Hello World', excerpt: 'My first post' }]),
        '_meta/robots.json': JSON.stringify({ mode: 'allow_all', aiBots: { gptBot: false, claudeBot: true } }),
      };

      const out = await buildSourceExport(files, { name: 'SEO Site', runtimeRange: '^1', now: NOW });

      // 1. Sitemap
      expect(out.files['app/sitemap.ts']).toBeDefined();
      expect(out.files['app/sitemap.ts']).toContain("import type { MetadataRoute } from 'next';");
      expect(out.files['app/sitemap.ts']).toContain("import postsItems from '@/cms/posts.json';");
      expect(out.files['app/sitemap.ts']).toContain('${baseUrl}/about');
      expect(out.files['app/sitemap.ts']).toContain('${baseUrl}/blog/');

      // 2. Robots
      expect(out.files['app/robots.ts']).toBeDefined();
      expect(out.files['app/robots.ts']).toContain("import type { MetadataRoute } from 'next';");
      expect(out.files['app/robots.ts']).toContain('GPTBot');
      expect(out.files['app/robots.ts']).toContain('"userAgent": "GPTBot"');
      expect(out.files['app/robots.ts']).toContain('"disallow": "/"');

      // 3. LLMs.txt
      expect(out.files['app/llms.txt/route.ts']).toBeDefined();
      expect(out.files['app/llms.txt/route.ts']).toContain("import postsItems from '@/cms/posts.json';");
      expect(out.files['app/llms.txt/route.ts']).toContain('## Posts');

      // 4. LLMs-full.txt
      expect(out.files['app/llms-full.txt/route.ts']).toBeDefined();
      expect(out.files['app/llms-full.txt/route.ts']).toContain('postsItemsFullBlocks');
    });

    it('does not overwrite existing custom sitemap.ts or robots.ts', async () => {
      const customSitemap = "// custom sitemap\nexport default function sitemap() { return []; }";
      const customRobots = "// custom robots\nexport default function robots() { return {}; }";

      const files = {
        'app/page.tsx': "export default function Page() { return <div>Home</div>; }",
        'app/sitemap.ts': customSitemap,
        'app/robots.ts': customRobots,
      };

      const out = await buildSourceExport(files, { name: 'Custom SEO Site', runtimeRange: '^1', now: NOW });
      expect(out.files['app/sitemap.ts']).toBe(customSitemap);
      expect(out.files['app/robots.ts']).toBe(customRobots);
    });

    it('correctly associates routes with multiple collections and spreads staticUrls', async () => {
      const files = {
        'app/page.tsx': "export default function Page() { return <div>Home</div>; }",
        'app/(main)/blog/page.tsx': "export default function BlogList() { return <div>Blog</div>; }",
        'app/(main)/blog/[slug]/page.client.tsx': "import categories from '@/cms/categories.json'; export default function PostClient({ item }: any) { return <div>{item.title}</div>; }",
        'app/(main)/blog/[slug]/page.tsx': "import posts from '@/cms/posts.json'; export default function PostPage() { return <div>Post</div>; }",
        'app/(main)/category/[category]/page.client.tsx': "export default function CatClient({ item }: any) { return <div>{item.name}</div>; }",
        'app/(main)/category/[category]/page.tsx': "import categories from '@/cms/categories.json'; export default function CatPage() { return <div>Cat</div>; }",
        'cms/posts.json': JSON.stringify([
          { _slug: 'mastering-typography', slug: 'mastering-typography', title: 'Mastering Typography' },
        ]),
        'cms/categories.json': JSON.stringify([
          { _slug: 'design', slug: 'design', name: 'Design' },
        ]),
      };

      const out = await buildSourceExport(files, { name: 'Multi Collection Site', runtimeRange: '^1', now: NOW });
      const sitemap = out.files['app/sitemap.ts'];
      expect(sitemap).toBeDefined();
      expect(sitemap).toContain("import postsItems from '@/cms/posts.json';");
      expect(sitemap).toContain("import categoriesItems from '@/cms/categories.json';");
      expect(sitemap).toContain('${baseUrl}/blog/');
      expect(sitemap).toContain('${baseUrl}/category/');
      // Must spread staticUrls
      expect(sitemap).toContain('return [...staticUrls,');
      expect(sitemap).not.toContain('return [staticUrls,');
    });

    it('generates correct sitemap for real blog project proj-1793030645294-xrmdi5', async () => {
      const fs = await import('fs');
      const content = JSON.parse(fs.readFileSync('data/projects/proj-1793030645294-xrmdi5.json', 'utf8'));
      const files = content.data.files;
      const updated = ensureSeoAndAiDiscoveryFiles(files);
      const sitemap = updated['app/sitemap.ts'];
      // Write to data/builds/proj-1793030645294-xrmdi5/app/sitemap.ts so the running next server picks it up
      if (fs.existsSync('data/builds/proj-1793030645294-xrmdi5/app')) {
        fs.writeFileSync('data/builds/proj-1793030645294-xrmdi5/app/sitemap.ts', sitemap);
      }
      expect(sitemap).toBeDefined();
      expect(sitemap).toContain("import postsItems from '@/cms/posts.json';");
      expect(sitemap).toContain("import categoriesItems from '@/cms/categories.json';");
      expect(sitemap).toContain('${baseUrl}/blog/${encodeURIComponent(String(slug))}');
      expect(sitemap).toContain('${baseUrl}/category/${encodeURIComponent(String(slug))}');
      expect(sitemap).toContain('return [...staticUrls,');
      expect(sitemap).not.toContain('return [staticUrls,');
    });
  });
});
