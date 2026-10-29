// llms-gen.ts — Next.js App Router route handler generator for app/llms.txt/route.ts & app/llms-full.txt/route.ts.
// Implements the open /llms.txt specification for AI search engines, Cursor, and LLM web crawlers.

import { moduleParses } from './metadata-gen';

export interface LlmsPageItem {
  title: string;
  route?: string;
  path?: string;
  description?: string;
}

export interface LlmsCmsCollection {
  collection?: string;
  collectionSlug?: string;
  routePrefix: string;
  titleField?: string;
  summaryField?: string;
  descriptionField?: string;
  contentField?: string;
  slugField?: string;
}

export interface LlmsGeneratorInput {
  siteName?: string;
  siteTitle?: string;
  siteDescription?: string;
  notes?: string;
  fullMarkdownNotes?: string;
  corePages?: LlmsPageItem[];
  keyPages?: LlmsPageItem[];
  cmsCollections?: LlmsCmsCollection[];
  customSections?: Array<{ title: string; content: string }>;
  isFull?: boolean;
}

export type LlmsRouteGeneratorInput = LlmsGeneratorInput;

function toValidIdentifier(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  return /^[0-9]/.test(clean) ? `cms_${clean}` : clean;
}

/**
 * Generate source code for Next.js App Router route handler (app/llms.txt/route.ts or app/llms-full.txt/route.ts).
 */
export function generateLlmsRouteCode(input: LlmsGeneratorInput = {}): string {
  const {
    siteName = input.siteTitle || 'Website',
    siteDescription = '',
    corePages = input.keyPages || [{ title: 'Home', route: '/', description: 'Home page' }],
    cmsCollections = [],
    customSections = [],
    isFull = false,
  } = input;

  const imports: string[] = [];
  const cmsProcessors: string[] = [];
  const importedCollections = new Set<string>();

  for (const col of cmsCollections) {
    const colName = col.collection || col.collectionSlug || 'posts';
    if (!importedCollections.has(colName)) {
      importedCollections.add(colName);
      const varName = `${toValidIdentifier(colName)}Items`;
      imports.push(`import ${varName} from '@/cms/${colName}.json';`);
    }
  }

  for (let i = 0; i < cmsCollections.length; i++) {
    const col = cmsCollections[i];
    const colName = col.collection || col.collectionSlug || 'posts';
    const baseVar = `${toValidIdentifier(colName)}Items`;
    const isDup = cmsCollections.filter((c) => (c.collection || c.collectionSlug) === colName).length > 1;
    const listVar = isDup ? `${baseVar}List_${i}` : `${baseVar}List`;
    const linesVar = isDup ? `${baseVar}Lines_${i}` : `${baseVar}Lines`;
    const fullBlocksVar = isDup ? `${baseVar}FullBlocks_${i}` : `${baseVar}FullBlocks`;

    const prefix = col.routePrefix.replace(/\/+$/, '');
    const titleF = col.titleField || 'title';
    const summaryF = col.summaryField || col.descriptionField || 'summary';
    const contentF = col.contentField || 'content';
    const slugF = col.slugField || '_slug';

    if (!isFull) {
      // Short index version for llms.txt
      cmsProcessors.push(`
  // Collection: ${colName} (${col.routePrefix})
  const ${listVar} = Array.isArray(${baseVar}) ? ${baseVar} : [];
  const ${linesVar} = ${listVar}
    .filter((it: any) => it && it._status !== 'draft')
    .map((it: any) => {
      const slug = it.${slugF} || it.slug || it.id;
      if (!slug) return null;
      const title = it.${titleF} || it.name || slug;
      const desc = it.${summaryF} || it.description || '';
      return \`- [\${title}](\${baseUrl}${prefix}/\${encodeURIComponent(String(slug))})\${desc ? \`: \${desc}\` : ''}\`;
    })
    .filter(Boolean);
  if (${linesVar}.length > 0) {
    sections.push(\`## ${colName.charAt(0).toUpperCase() + colName.slice(1)}\\n\${${linesVar}.join('\\n')}\`);
  }
`);
    } else {
      // Full markdown content version for llms-full.txt
      cmsProcessors.push(`
  // Full Collection: ${colName} (${col.routePrefix})
  const ${listVar} = Array.isArray(${baseVar}) ? ${baseVar} : [];
  const ${fullBlocksVar} = ${listVar}
    .filter((it: any) => it && it._status !== 'draft')
    .map((it: any) => {
      const slug = it.${slugF} || it.slug || it.id;
      if (!slug) return null;
      const title = it.${titleF} || it.name || slug;
      const desc = it.${summaryF} || it.description || '';
      const content = it.${contentF} || desc || '';
      return \`### \${title}\\nURL: \${baseUrl}${prefix}/\${encodeURIComponent(String(slug))}\\n\\n\${desc ? \`> \${desc}\\n\\n\` : ''}\${content}\`;
    })
    .filter(Boolean);
  if (${fullBlocksVar}.length > 0) {
    sections.push(\`## ${colName.charAt(0).toUpperCase() + colName.slice(1)}\\n\\n\${${fullBlocksVar}.join('\\n\\n---\\n\\n')}\`);
  }
`);
    }
  }

  // Core pages formatting
  const corePagesCode = corePages
    .map((p) => {
      const rawRoute = p.route || p.path || '/';
      const path = rawRoute.startsWith('/') ? rawRoute : `/${rawRoute}`;
      const desc = p.description ? `: ${p.description}` : '';
      return `    \`- [${p.title}](\${baseUrl}${path === '/' ? '' : path})${desc}\``;
    })
    .join(',\n');

  // Custom sections
  const customSectionsCode = customSections
    .map((s) => `  sections.push(\`## ${s.title}\\n${s.content.replace(/`/g, '\\`')}\`);`)
    .join('\n');

  const optionalLink = !isFull
    ? `  sections.push(\`## Optional\\n- [Full Content](\${baseUrl}/llms-full.txt): Complete site documentation and content in markdown\`);\n`
    : '';

  const code = `${imports.join('\n')}

export async function GET(): Promise<Response> {
  const rawBase = process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com';
  const baseUrl = rawBase.replace(/\\/+$/, '');

  const sections: string[] = [];

  // Header & Title
  sections.push(\`# ${siteName}\\n${siteDescription ? `> ${siteDescription}\\n` : ''}\`);

  // Core Pages
  const pages = [
${corePagesCode}
  ];
  if (pages.length > 0) {
    sections.push(\`## Pages\\n\${pages.join('\\n')}\`);
  }
${cmsProcessors.join('\n')}
${customSectionsCode}
${optionalLink}
  const body = sections.join('\\n\\n') + '\\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
`;

  if (!moduleParses(code)) {
    throw new Error('generateLlmsRouteCode: generated llms.txt route code failed to parse with Babel.');
  }

  return code;
}

/**
 * Generate source code for Next.js App Router route handler for full markdown content (app/llms-full.txt/route.ts).
 */
export function generateLlmsFullRouteCode(input: LlmsGeneratorInput = {}): string {
  return generateLlmsRouteCode({ ...input, isFull: true });
}

