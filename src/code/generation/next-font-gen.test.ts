import { describe, it, expect } from 'vitest';
import {
  extractGoogleFontsFromCSS,
  fontNameToNextFontIdentifier,
  fontNameToCssVar,
  transformLayoutWithNextFonts,
  transformSiteFilesForNextFonts,
} from './next-font-gen';

describe('next-font-gen', () => {
  describe('fontNameToNextFontIdentifier', () => {
    it('handles single-word font names', () => {
      expect(fontNameToNextFontIdentifier('Inter')).toBe('Inter');
      expect(fontNameToNextFontIdentifier('Comfortaa')).toBe('Comfortaa');
    });

    it('replaces spaces and hyphens with underscores for multi-word font names', () => {
      expect(fontNameToNextFontIdentifier('Playfair Display')).toBe('Playfair_Display');
      expect(fontNameToNextFontIdentifier('Plus Jakarta Sans')).toBe('Plus_Jakarta_Sans');
      expect(fontNameToNextFontIdentifier('Open-Sans')).toBe('Open_Sans');
    });
  });

  describe('fontNameToCssVar', () => {
    it('creates kebab-case css variable', () => {
      expect(fontNameToCssVar('Inter')).toBe('--font-inter');
      expect(fontNameToCssVar('Comfortaa')).toBe('--font-comfortaa');
      expect(fontNameToCssVar('Playfair Display')).toBe('--font-playfair-display');
    });
  });

  describe('extractGoogleFontsFromCSS', () => {
    it('extracts Google Fonts from @import urls in CSS', () => {
      const css = `
@import url('https://fonts.googleapis.com/css2?family=Comfortaa:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
:root {
  --font-heading: 'Comfortaa', sans-serif;
}
`;
      const fonts = extractGoogleFontsFromCSS(css);
      expect(fonts).toHaveLength(2);
      expect(fonts[0]).toEqual({
        family: 'Comfortaa',
        identifier: 'Comfortaa',
        variable: '--font-comfortaa',
        weights: ['300', '400', '500', '600', '700'],
        subsets: ['latin', 'cyrillic'],
        display: 'swap',
        importUrl: 'https://fonts.googleapis.com/css2?family=Comfortaa:wght@300;400;500;600;700&display=swap',
      });
      expect(fonts[1]?.family).toBe('Playfair Display');
      expect(fonts[1]?.identifier).toBe('Playfair_Display');
      expect(fonts[1]?.variable).toBe('--font-playfair-display');
    });

    it('filters invalid weights strictly against the Google Fonts catalog (e.g. Syne rejects 300)', () => {
      const css = "@import url('https://fonts.googleapis.com/css2?family=Syne:wght@300;400;500;600;700&display=swap');";
      const fonts = extractGoogleFontsFromCSS(css);
      expect(fonts).toHaveLength(1);
      expect(fonts[0]?.family).toBe('Syne');
      // 300 is not in Syne catalog variants, so it is filtered out!
      expect(fonts[0]?.weights).toEqual(['400', '500', '600', '700']);
      expect(fonts[0]?.weights).not.toContain('300');
    });

    it('returns empty array if no Google Fonts are imported', () => {
      const css = ':root { --color: red; }';
      expect(extractGoogleFontsFromCSS(css)).toEqual([]);
    });
  });

  describe('transformLayoutWithNextFonts', () => {
    const sampleLayout = `import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'My Site',
  description: 'Welcome',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`;

    it('injects next/font/google imports and instances into RootLayout', () => {
      const fonts = [
        {
          family: 'Comfortaa',
          identifier: 'Comfortaa',
          variable: '--font-comfortaa',
          weights: ['300', '400', '700'],
          subsets: ['latin', 'cyrillic'],
          display: 'swap',
          importUrl: 'https://fonts.googleapis.com/css2?family=Comfortaa:wght@300;400;700&display=swap',
        },
        {
          family: 'Inter',
          identifier: 'Inter',
          variable: '--font-inter',
          weights: ['400', '600'],
          subsets: ['latin'],
          display: 'swap',
          importUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
        },
      ];

      const result = transformLayoutWithNextFonts(sampleLayout, fonts);
      expect(result).toContain("import { Comfortaa, Inter } from 'next/font/google';");
      expect(result).toContain("const comfortaa = Comfortaa({");
      expect(result).toContain("variable: '--font-comfortaa'");
      expect(result).toContain("const inter = Inter({");
      expect(result).toContain("variable: '--font-inter'");
      expect(result).toContain('className={`${comfortaa.variable} ${inter.variable}`}');
    });

    it('preserves existing className on html when adding font variables', () => {
      const layoutWithClass = `import './globals.css';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark scroll-smooth" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
`;
      const fonts = [
        {
          family: 'Comfortaa',
          identifier: 'Comfortaa',
          variable: '--font-comfortaa',
          weights: ['400'],
          subsets: ['latin', 'cyrillic'],
          display: 'swap',
          importUrl: 'https://fonts.googleapis.com/css2?family=Comfortaa&display=swap',
        },
      ];
      const result = transformLayoutWithNextFonts(layoutWithClass, fonts);
      expect(result).toContain('className={`dark scroll-smooth ${comfortaa.variable}`}');
    });
  });

  describe('transformSiteFilesForNextFonts', () => {
    it('transforms layout.tsx, removes @import from tokens.css and wires font variables', () => {
      const files: Record<string, string> = {
        'app/layout.tsx': `import './globals.css';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
        'styles/tokens.css': `@import url('https://fonts.googleapis.com/css2?family=Comfortaa:wght@300;400;700&display=swap');
:root {
  --font-heading: 'Comfortaa', sans-serif;
}`,
      };

      const transformed = transformSiteFilesForNextFonts(files);

      // layout.tsx has next/font/google
      expect(transformed['app/layout.tsx']).toContain("import { Comfortaa } from 'next/font/google';");
      expect(transformed['app/layout.tsx']).toContain('${comfortaa.variable}');

      // tokens.css has @import stripped
      expect(transformed['styles/tokens.css']).not.toContain('@import url(');
      expect(transformed['styles/tokens.css']).toContain("var(--font-comfortaa), 'Comfortaa', sans-serif");
    });
  });
});
