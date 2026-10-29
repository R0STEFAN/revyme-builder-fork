import { describe, it, expect } from 'vitest';
import { generateLlmsRouteCode } from './llms-gen';
import { moduleParses } from './metadata-gen';

describe('llms-gen', () => {
  it('generates a valid llms.txt route handler with core pages and optional link to full version', () => {
    const code = generateLlmsRouteCode({
      siteName: 'Revyme Blog',
      siteDescription: 'Web design, dev, and builder tutorials',
      corePages: [
        { title: 'Home', route: '/', description: 'Welcome to our blog' },
        { title: 'About Us', route: '/about', description: 'About our team' },
      ],
      isFull: false,
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain('export async function GET()');
    expect(code).toContain('# Revyme Blog');
    expect(code).toContain('> Web design, dev, and builder tutorials');
    expect(code).toContain('## Pages');
    expect(code).toContain('[Full Content](${baseUrl}/llms-full.txt)');
    expect(code).toContain("'Content-Type': 'text/plain; charset=utf-8'");
  });

  it('generates llms-full.txt with complete CMS article excerpts and blocks', () => {
    const code = generateLlmsRouteCode({
      siteName: 'Revyme Knowledge Base',
      cmsCollections: [
        {
          collection: 'posts',
          routePrefix: '/blog',
          titleField: 'title',
          summaryField: 'summary',
          contentField: 'content',
        },
      ],
      isFull: true,
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain("import postsItems from '@/cms/posts.json';");
    expect(code).toContain('postsItemsList');
    expect(code).toContain('### ${title}\\nURL:');
  });
});
