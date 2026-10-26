import React from 'react';
import { notFound } from 'next/navigation';
import { Providers } from '../providers';

const LOCALES = ['uk', 'en'];

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!LOCALES.includes(lang)) {
    notFound();
  }

  return (
    <html lang={lang} suppressHydrationWarning>
      <body data-testid="layout-body">
        <Providers locale={lang}>
          <header style={{ padding: '1rem', borderBottom: '1px solid #ccc' }}>
            <nav style={{ display: 'flex', gap: '1rem' }}>
              <a href={lang === 'uk' ? '/gallery' : `/${lang}/gallery`}>Gallery</a>
              <a href={lang === 'uk' ? '/about' : `/${lang}/about`}>About</a>
              {/* Native language switcher with data-no-vt */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <a href="/gallery" data-no-vt style={{ fontWeight: lang === 'uk' ? 'bold' : 'normal' }}>
                  UK
                </a>
                <a href="/en/gallery" data-no-vt style={{ fontWeight: lang === 'en' ? 'bold' : 'normal' }}>
                  EN
                </a>
              </div>
            </nav>
          </header>
          <main style={{ padding: '1rem' }}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
