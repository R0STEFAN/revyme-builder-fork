// robots-gen.ts — Next.js App Router robots code generator (app/robots.ts).
// Supports standard search bots, AI bots guard (GPTBot, ClaudeBot, PerplexityBot, Google-Extended), and sitemap linking.

import { moduleParses } from './metadata-gen';

export interface RobotsAiBotPolicies {
  gptBot?: boolean; // false = disallow
  claudeBot?: boolean;
  perplexityBot?: boolean;
  googleExtended?: boolean;
  applebotExtended?: boolean;
}

export interface RobotsGeneratorInput {
  baseUrl?: string;
  mode?: 'allow_all' | 'disallow_all' | 'custom';
  disallowPaths?: string[];
  allowPaths?: string[];
  aiBots?: RobotsAiBotPolicies;
  sitemapPath?: string;
  customRules?: Array<{
    userAgent: string | string[];
    allow?: string | string[];
    disallow?: string | string[];
  }>;
}

const AI_BOT_NAMES: Record<keyof RobotsAiBotPolicies, string> = {
  gptBot: 'GPTBot',
  claudeBot: 'ClaudeBot',
  perplexityBot: 'PerplexityBot',
  googleExtended: 'Google-Extended',
  applebotExtended: 'Applebot-Extended',
};

/**
 * Generate Next.js App Router `app/robots.ts` source code.
 */
export function generateRobotsCode(input: RobotsGeneratorInput = {}): string {
  const {
    mode = 'allow_all',
    disallowPaths = ['/api/'],
    allowPaths = ['/'],
    aiBots = {},
    sitemapPath = '/sitemap.xml',
    customRules = [],
  } = input;

  const rules: Array<Record<string, unknown>> = [];

  if (mode === 'disallow_all') {
    rules.push({
      userAgent: '*',
      disallow: '/',
    });
  } else {
    // Standard rule for all bots
    const generalRule: Record<string, unknown> = {
      userAgent: '*',
    };
    if (allowPaths.length > 0) {
      generalRule.allow = allowPaths.length === 1 ? allowPaths[0] : allowPaths;
    }
    if (disallowPaths.length > 0) {
      generalRule.disallow = disallowPaths.length === 1 ? disallowPaths[0] : disallowPaths;
    }
    rules.push(generalRule);

    // AI Bots rules
    for (const [key, botName] of Object.entries(AI_BOT_NAMES)) {
      const allowed = aiBots[key as keyof RobotsAiBotPolicies];
      if (allowed === false) {
        // Disallow this AI crawler
        rules.push({
          userAgent: botName,
          disallow: '/',
        });
      } else if (allowed === true) {
        // Explicitly allow
        rules.push({
          userAgent: botName,
          allow: '/',
        });
      }
    }

    // Custom user rules
    for (const cr of customRules) {
      rules.push(cr);
    }
  }

  const rulesLiteral = JSON.stringify(rules, null, 2)
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : `    ${line}`))
    .join('\n');

  const sitemapLine = sitemapPath
    ? `\n    sitemap: \`\${baseUrl}${sitemapPath.startsWith('/') ? sitemapPath : `/${sitemapPath}`}\`,`
    : '';

  const code = `import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const rawBase = process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com';
  const baseUrl = rawBase.replace(/\\/+$/, '');

  return {
    rules: ${rulesLiteral},${sitemapLine}
  };
}
`;

  if (!moduleParses(code)) {
    throw new Error('generateRobotsCode: generated robots code failed to parse with Babel.');
  }

  return code;
}
