import { describe, it, expect } from 'vitest';
import {
  prepareLocalizedSiteFiles,
  LOCALIZED_OUTPUT_MARKER,
} from './localized-site-export';
import { transformSiteFilesForNextFonts } from '../generation/next-font-gen';

describe('prepareLocalizedSiteFiles', () => {
  const i18nConfig = JSON.stringify({
    defaultLocale: 'uk',
    locales: [
      { code: 'uk', label: 'Ukrainian' },
      { code: 'en', label: 'English' },
    ],
  });

  const baseFiles: Record<string, string> = {
    'i18n/config.json': i18nConfig,
    'app/layout.tsx': `import './globals.css';
import { Providers } from './providers';

export const siteConfig = { language: 'en' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}`,
    'app/globals.css': 'body { margin: 0; }',
    'app/providers.tsx': 'export function Providers({ children }: any) { return children; }',
    'app/page.tsx': "import PageClient from './page.client';\nexport default function Page() { return <PageClient />; }",
    'app/page.client.tsx': "'use client';\nexport default function PageClient() { return <div>Home</div>; }",
    'app/(Body)/gallery/page.tsx': "import GalleryClient from './page.client';\nexport default function Page() { return <GalleryClient />; }",
    'app/(Body)/gallery/page.client.tsx': "'use client';\nexport default function GalleryClient() { return <div>Gallery</div>; }",
    'app/api/cms/query/route.ts': 'export async function POST() { return new Response(); }',
    'app/robots.ts': 'export default function robots() { return {}; }',
    'app/not-found.tsx': "'use client';\nexport default function NotFound() { return <div>Custom 404</div>; }",
    'components/Hero.tsx': "export function Hero() { return <h1>Hero</h1>; }",
  };

  it('preserves input object immutability', () => {
    const input = { ...baseFiles };
    const beforeStr = JSON.stringify(input);
    const output = prepareLocalizedSiteFiles(input);

    expect(JSON.stringify(input)).toBe(beforeStr);
    expect(output).not.toBe(input);
  });

  it('moves UI routes under app/[lang]/ and keeps API/system routes at root', () => {
    const output = prepareLocalizedSiteFiles(baseFiles);

    // Root layout moved to app/[lang]/layout.tsx
    expect(output['app/layout.tsx']).toBeUndefined();
    expect(output['app/[lang]/layout.tsx']).toBeDefined();

    // Pages moved under app/[lang]/
    expect(output['app/[lang]/page.tsx']).toBeDefined();
    expect(output['app/[lang]/page.client.tsx']).toBeDefined();
    expect(output['app/[lang]/(Body)/gallery/page.tsx']).toBeDefined();
    expect(output['app/[lang]/(Body)/gallery/page.client.tsx']).toBeDefined();

    // API and system routes remain at root
    expect(output['app/api/cms/query/route.ts']).toBeDefined();
    expect(output['app/robots.ts']).toBeDefined();
    expect(output['app/globals.css']).toBeDefined();
    expect(output['app/providers.tsx']).toBeDefined();

    // Proxy and locale routing helper generated
    expect(output['proxy.ts']).toBeDefined();
    expect(output['lib/revyme-locale-routing.ts']).toBeDefined();
  });

  it('transforms RootLayout into async layout with params.lang and generateStaticParams', () => {
    const output = prepareLocalizedSiteFiles(baseFiles);
    const layoutCode = output['app/[lang]/layout.tsx'];

    expect(layoutCode).toContain(LOCALIZED_OUTPUT_MARKER);
    expect(layoutCode).toContain('export function generateStaticParams');
    expect(layoutCode).toContain('["uk","en"]');
    expect(layoutCode).toContain('const { lang } = await params;');
    expect(layoutCode).toContain('if (!["uk","en"].includes(lang))');
    expect(layoutCode).toContain('notFound()');
    expect(layoutCode).toContain('<Providers locale={lang}>');
    expect(layoutCode).toContain('<html lang={lang}');

    // Unsupported export removed: export const siteConfig -> const siteConfig
    expect(layoutCode).not.toContain('export const siteConfig');
    expect(layoutCode).toContain('const siteConfig');
  });

  it('correctly transforms <html lang={siteConfig.language || "en"} suppressHydrationWarning> without JSX syntax corruption', () => {
    const filesWithHydration = {
      ...baseFiles,
      'app/layout.tsx': `import './globals.css';
import { Providers } from './providers';

export const siteConfig = { language: 'en' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={siteConfig.language || 'en'} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}`,
    };

    const output = prepareLocalizedSiteFiles(filesWithHydration);
    const layoutCode = output['app/[lang]/layout.tsx'];

    expect(layoutCode).toContain('<html lang={lang} suppressHydrationWarning>');
    expect(layoutCode).not.toContain("|| 'en'}");
    expect(layoutCode).not.toContain('|| "en"}');
  });

  it('retargets relative imports in moved files', () => {
    const output = prepareLocalizedSiteFiles(baseFiles);
    const layoutCode = output['app/[lang]/layout.tsx'];

    // ./globals.css -> ../globals.css
    expect(layoutCode).toMatch(/import\s+['"]\.\.\/globals\.css['"]/);
    // ./providers -> ../providers
    expect(layoutCode).toMatch(/from\s+['"]\.\.\/providers['"]/);

    // Sibling import within moved folder remains sibling:
    const galleryServer = output['app/[lang]/(Body)/gallery/page.tsx'];
    expect(galleryServer).toContain("import GalleryClient from './page.client'");
  });

  it('handles custom not-found.tsx both in locale tree and as global root fallback', () => {
    const output = prepareLocalizedSiteFiles(baseFiles);

    expect(output['app/[lang]/not-found.tsx']).toBeDefined();
    expect(output['app/not-found.tsx']).toBeDefined();
    expect(output['app/not-found.tsx']).toContain('GlobalNotFound');
    expect(output['app/not-found.tsx']).toContain('<Providers locale="uk">');
  });

  it('returns single-locale or non-i18n projects unchanged', () => {
    const monolingualFiles = {
      ...baseFiles,
      'i18n/config.json': JSON.stringify({ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] }),
    };

    const output = prepareLocalizedSiteFiles(monolingualFiles);
    expect(output['app/layout.tsx']).toBeDefined();
    expect(output['app/[lang]/layout.tsx']).toBeUndefined();
    expect(output['proxy.ts']).toBeUndefined();
  });

  it('is idempotent on already processed files', () => {
    const output1 = prepareLocalizedSiteFiles(baseFiles);
    const output2 = prepareLocalizedSiteFiles(output1);

    expect(output2).toEqual(output1);
  });

  it('preserves Google Fonts loaders when run after transformSiteFilesForNextFonts', () => {
    const filesWithFont = {
      ...baseFiles,
      'app/globals.css': `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');\nbody { font-family: 'Inter'; }`,
    };

    const fontTransformed = transformSiteFilesForNextFonts(filesWithFont);
    expect(fontTransformed['app/layout.tsx']).toContain('next/font/google');
    expect(fontTransformed['app/layout.tsx']).toContain('Inter');

    const localized = prepareLocalizedSiteFiles(fontTransformed);
    const localizedLayout = localized['app/[lang]/layout.tsx'];

    expect(localizedLayout).toBeDefined();
    expect(localizedLayout).toContain('next/font/google');
    expect(localizedLayout).toContain('Inter');
    expect(localizedLayout).toMatch(/import\s+['"]\.\.\/globals\.css['"]/);
    expect(localizedLayout).not.toMatch(/import\s+['"]\.\/globals\.css['"]/);
  });

  it('throws diagnostic collision error if authored route collides with localized destination', () => {
    const collidingFiles = {
      ...baseFiles,
      'app/gallery/page.tsx': 'export default function G() {}',
      'app/[lang]/gallery/page.tsx': 'export default function LG() {}',
    };

    expect(() => prepareLocalizedSiteFiles(collidingFiles)).toThrow(/Localization export collision/);
  });

  it('rejects differing localized _slug override with actionable diagnostic', () => {
    const filesWithLocalizedSlug = {
      ...baseFiles,
      'cms/articles.json': JSON.stringify([
        {
          _slug: 'first-post',
          title: 'First Post',
          _i18n: {
            uk: {
              _slug: 'pershyi-dopys',
              title: 'Перший допис',
            },
          },
        },
      ]),
    };

    expect(() => prepareLocalizedSiteFiles(filesWithLocalizedSlug)).toThrow(
      /Localized record slug overrides are not supported in this release: collection "articles", item "first-post" has _i18n\[uk\]\._slug = "pershyi-dopys"\. Use shared record slugs only\./
    );
  });

  it('wraps Link and MotionLink hrefs with localizeHref and ensures locale hook', () => {
    const filesWithLinks = {
      ...baseFiles,
      'components/Navbar.tsx': `'use client';
import React from 'react';
import Link from 'next/link';

export default function Navbar() {
  return (
    <nav>
      <Link href="/gallery">Gallery</Link>
      <Link href="https://external.com">External</Link>
      <Link href="#section">Hash</Link>
      <Link href="/downloads/catalog.pdf">Download</Link>
      <Link data-no-vt href="/fr">French Switcher</Link>
    </nav>
  );
}`,
      'app/page.client.tsx': `'use client';
import React from 'react';
import { MotionLink } from '@/components/motion';

export default function Page() {
  const item = { slug: 'my-post' };
  return (
    <div>
      <MotionLink href={\`/blog/\${item.slug}\`}>Post</MotionLink>
    </div>
  );
}`,
    };

    const result = prepareLocalizedSiteFiles(filesWithLinks);
    const navbar = result['components/Navbar.tsx'];
    const page = result['app/[lang]/page.client.tsx'];

    // Localized internal link
    expect(navbar).toContain('localizeHref("/gallery", __activeLocale)');
    expect(navbar).toContain("import { localizeHref } from '@/lib/revyme-locale-routing';");
    expect(navbar).toContain("import { useLocale } from 'next-intl';");
    expect(navbar).toContain('const __activeLocale = useLocale();');

    // Untouched special links
    expect(navbar).toContain('href="https://external.com"');
    expect(navbar).toContain('href="#section"');
    expect(navbar).toContain('href="/downloads/catalog.pdf"');
    expect(navbar).toContain('data-no-vt href="/fr"');

    // Dynamic MotionLink
    expect(page).toContain('localizeHref(`/blog/${item.slug}`, __activeLocale)');
    expect(page).toContain("import { localizeHref } from '@/lib/revyme-locale-routing';");
  });

  it('does not corrupt MotionLinkBase scaffolding or forwardRef with __activeLocale', () => {
    const filesWithScaffolding = {
      ...baseFiles,
      'app/page.client.tsx': `'use client';
import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

const MotionLink = motion.create(React.forwardRef(function MotionLinkBase({ href, ...props }: any, ref: any) {
  return href ? <Link ref={ref} href={href} {...props} /> : <div ref={ref} {...props} />;
}));

export default function Page() {
  return (
    <div>
      <MotionLink href="/about">About</MotionLink>
    </div>
  );
}`,
    };

    const result = prepareLocalizedSiteFiles(filesWithScaffolding);
    const page = result['app/[lang]/page.client.tsx'];

    // Scaffolding inside MotionLinkBase must preserve href={href} without undefined __activeLocale
    expect(page).toContain('<Link ref={ref} href={href} {...props} />');
    expect(page).not.toContain('href={localizeHref(href, __activeLocale)}');

    // Call site inside Page must be localized
    expect(page).toContain('<MotionLink href={localizeHref("/about", __activeLocale)}>About</MotionLink>');
  });

  it('transforms static metadata into localized generateMetadata with canonical and reciprocal hreflangs', () => {
    const filesWithMeta = {
      ...baseFiles,
      'app/gallery/page.tsx': `import React from 'react';
import GalleryClient from './page.client';

export const metadata = {
  title: 'Галерея робіт',
  description: 'Оригінальні картини',
  keywords: ['арт', 'картини'],
  alternates: { canonical: 'https://mysite.com/gallery' },
};

export default function Page() {
  return <GalleryClient />;
}`,
      'messages/en.json': JSON.stringify({
        gallery: {
          _seo: {
            title: 'Art Gallery',
            description: 'Original paintings',
          },
        },
      }),
    };

    const result = prepareLocalizedSiteFiles(filesWithMeta);
    const galleryPage = result['app/[lang]/gallery/page.tsx'];

    // Un-exports static metadata to prevent Next.js metadata/generateMetadata conflict
    expect(galleryPage).not.toContain('export const metadata');
    expect(galleryPage).toContain('const __authoredMetadata =');

    // Emits generateMetadata
    expect(galleryPage).toContain('export async function generateMetadata(props: any = {})');

    // Injects _seo overrides
    expect(galleryPage).toContain('"title": "Art Gallery"');

    // Reciprocal alternates and canonical
    expect(galleryPage).toContain('canonical = getLocalizedPublicPath(lang)');
    expect(galleryPage).toContain('"uk": getLocalizedPublicPath("uk")');
    expect(galleryPage).toContain('"en": getLocalizedPublicPath("en")');
    expect(galleryPage).toContain('\'x-default\': getLocalizedPublicPath("uk")');

    // Preserves custom metadata like keywords
    expect(galleryPage).toContain('...base');
  });

  it('wraps existing generateMetadata without export collisions', () => {
    const filesWithGenMeta = {
      ...baseFiles,
      'app/blog/[slug]/page.tsx': `import React from 'react';
import PageClient from './page.client';

export async function generateMetadata({ params }: any) {
  const { slug } = await params;
  return {
    title: 'Post: ' + slug,
  };
}

export default function Page() {
  return <PageClient />;
}`,
    };

    const result = prepareLocalizedSiteFiles(filesWithGenMeta);
    const blogPage = result['app/[lang]/blog/[slug]/page.tsx'];

    // Renames authored function and wraps
    expect(blogPage).toContain('async function __authoredGenerateMetadata');
    expect(blogPage).toContain('export async function generateMetadata(props: any = {})');
    expect(blogPage).toContain('(await __authoredGenerateMetadata(props)) || {}');
  });
});
