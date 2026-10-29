import { describe, it, expect } from 'vitest';
import { generateRobotsCode } from './robots-gen';
import { moduleParses } from './metadata-gen';

describe('robots-gen', () => {
  it('generates standard allow_all robots.ts with sitemap link', () => {
    const code = generateRobotsCode();

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain("import type { MetadataRoute } from 'next';");
    expect(code).toContain('export default async function robots()');
    expect(code).toContain('"userAgent": "*"');
    expect(code).toContain('sitemap: `${baseUrl}/sitemap.xml`');
  });

  it('generates disallow_all when staging/private mode is selected', () => {
    const code = generateRobotsCode({ mode: 'disallow_all' });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain('"disallow": "/"');
  });

  it('blocks specific AI bots when set to false', () => {
    const code = generateRobotsCode({
      aiBots: {
        gptBot: false,
        claudeBot: false,
        perplexityBot: true,
      },
    });

    expect(moduleParses(code)).toBe(true);
    expect(code).toContain('"userAgent": "GPTBot"');
    expect(code).toContain('"userAgent": "ClaudeBot"');
    expect(code).toContain('"userAgent": "PerplexityBot"');
  });
});
