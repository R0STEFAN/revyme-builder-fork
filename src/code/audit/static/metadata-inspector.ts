// src/code/audit/static/metadata-inspector.ts
// Static inspector for SEO metadata, OpenGraph, language, canonicals, and JSON-LD.

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { AuditFinding } from '../core/types';
import { generateFindingId } from '../core/normalizer';
import { COMMON_SCHEMA_ORG_TYPES } from '../core/registry';
import { parseMetadataFromCode } from '@/code/generation/metadata-gen';
import {
  hasCmsSeo,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  parseCmsSeoExpressions,
} from '@/code/project/cms-seo';
import { trace } from '@/shared/debug-trace';

const BOILERPLATE_TITLES = new Set([
  'untitled',
  'my site',
  'new page',
  'home',
  'website',
  'page',
  'welcome',
  'revyme site',
]);

const BCP47_REGEX = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i;

export interface PageMetadataInfo {
  pagePath: string;
  code: string;
  ast?: t.File;
}

export function inspectSinglePageMetadata(
  pagePath: string,
  code: string,
  ast: t.File,
  traverseFn: any,
  companionServerCode?: string,
  targetServerPath?: string
): AuditFinding[] {
  trace.fn('inspectSinglePageMetadata', { pagePath });
  const findings: AuditFinding[] = [];

  const metaTargetFile = targetServerPath || pagePath;
  const metaSource = companionServerCode || code;
  const meta = parseMetadataFromCode(metaSource);
  let title = (meta.title as string) || '';
  let description = (meta.description as string) || '';
  let canonical = (meta.alternates as any)?.canonical || '';
  let ogImage = (meta.openGraph as any)?.images?.[0]?.url || (meta.openGraph as any)?.images || '';
  if (Array.isArray(ogImage)) ogImage = ogImage[0] || '';

  // Support dynamic generateMetadata & CMS SEO bindings
  const hasDynamicGenerateMetadata = /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(metaSource);
  let isDynamicSeo = false;
  if (hasDynamicGenerateMetadata) {
    if (hasCmsSeo(metaSource)) {
      const bindings = parseCmsSeoBindings(metaSource);
      const expressions = parseCmsSeoExpressions(metaSource);
      const defaults = parseCmsSeoDefaults(metaSource);

      if (!title) {
        title = (expressions.title || bindings.title || defaults.title || '').trim();
      }
      if (!description) {
        description = (expressions.description || bindings.description || defaults.description || '').trim();
      }
      if (!canonical) {
        canonical = (metaSource.includes('canonical') ? 'dynamic' : '').trim();
      }
      if (!ogImage) {
        ogImage = (expressions.ogImage || bindings.ogImage || defaults.ogImage || (metaSource.includes('openGraph') ? 'dynamic' : '')).trim();
      }
      isDynamicSeo = true;
    } else {
      if (!title) title = 'Dynamic Page Title';
      if (!description) description = 'Dynamic Page Description';
      if (!canonical) canonical = 'dynamic';
      isDynamicSeo = true;
    }
  }

  // Also check JSX tags: <title>, <meta name="description">, <link rel="canonical">, <script type="application/ld+json">, <html lang="...">
  let foundLang: string | null = null;
  const jsonLdScripts: string[] = [];

  traverseFn(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const opening = path.node.openingElement;
      let tagName = '';
      if (t.isJSXIdentifier(opening.name)) {
        tagName = opening.name.name.toLowerCase();
      }

      if (tagName === 'title') {
        const textChild = path.node.children.find((c) => t.isJSXText(c));
        if (textChild && t.isJSXText(textChild)) {
          if (!title) title = textChild.value.trim();
        }
      }

      if (tagName === 'html') {
        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'lang' })) {
            if (t.isStringLiteral(attr.value)) {
              foundLang = attr.value.value;
            } else if (t.isJSXExpressionContainer(attr.value)) {
              foundLang = 'dynamic';
            }
          }
        }
      }

      if (tagName === 'meta') {
        let name = '';
        let content = '';
        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
            if (attr.name.name === 'name' && t.isStringLiteral(attr.value)) {
              name = attr.value.value;
            } else if (attr.name.name === 'content' && t.isStringLiteral(attr.value)) {
              content = attr.value.value;
            }
          }
        }
        if (name === 'description' && !description) {
          description = content;
        }
      }

      if (tagName === 'link') {
        let rel = '';
        let href = '';
        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
            if (attr.name.name === 'rel' && t.isStringLiteral(attr.value)) {
              rel = attr.value.value;
            } else if (attr.name.name === 'href' && t.isStringLiteral(attr.value)) {
              href = attr.value.value;
            }
          }
        }
        if (rel === 'canonical' && !canonical) {
          canonical = href;
        }
      }

      if (tagName === 'script') {
        let isJsonLd = false;
        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'type' })) {
            if (t.isStringLiteral(attr.value) && attr.value.value === 'application/ld+json') {
              isJsonLd = true;
            }
          }
        }
        if (isJsonLd) {
          for (const child of path.node.children) {
            if (t.isJSXExpressionContainer(child)) {
              const expr = child.expression;
              // <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }} />
            }
            if (t.isJSXText(child)) {
              jsonLdScripts.push(child.value);
            }
          }
          // Also look for dangerouslySetInnerHTML attribute
          for (const attr of opening.attributes) {
            if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'dangerouslySetInnerHTML' })) {
              if (t.isJSXExpressionContainer(attr.value) && t.isObjectExpression(attr.value.expression)) {
                for (const prop of attr.value.expression.properties) {
                  if (t.isObjectProperty(prop) && t.isIdentifier(prop.key, { name: '__html' })) {
                    if (t.isStringLiteral(prop.value)) {
                      jsonLdScripts.push(prop.value.value);
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
  });

  const isPage = pagePath.endsWith('page.tsx') || pagePath.endsWith('page.client.tsx') || pagePath === 'page.client.tsx';
  const isRootLayout = pagePath === 'app/layout.tsx';

  // ─── Rule: empty-page-title ───────────────────────────────────────────────
  if (isPage) {
    if (!title || title.trim().length === 0 || BOILERPLATE_TITLES.has(title.trim().toLowerCase())) {
      const loc = { pagePath: metaTargetFile, propName: 'title' };
      findings.push({
        id: generateFindingId('seo', 'empty-page-title', loc),
        scope: 'seo',
        ruleId: 'empty-page-title',
        severity: 'error',
        title: 'Missing or empty page title',
        message: title ? `Page title "${title}" is boilerplate.` : 'Page lacks a title.',
        explanation: 'Every indexable page must have a descriptive, unique title.',
        remediation: 'Provide a title in page metadata (40–60 characters).',
        location: loc,
        canAutoFix: true,
        suggestedFix: {
          type: 'set-metadata',
          description: 'Set page title in metadata',
          patch: { title: 'Revyme Page' },
        },
      });
    }

    // ─── Rule: missing-page-description & weak-page-description ─────────────
    if (!description || description.trim().length === 0) {
      const loc = { pagePath: metaTargetFile, propName: 'description' };
      findings.push({
        id: generateFindingId('seo', 'missing-page-description', loc),
        scope: 'seo',
        ruleId: 'missing-page-description',
        severity: 'warning',
        title: 'Missing meta description',
        message: 'Page does not provide a meta description.',
        explanation: 'A concise meta description summarizes page contents for search engine result snippets.',
        remediation: 'Add a meta description (120–160 characters) to page metadata.',
        location: loc,
        canAutoFix: true,
        suggestedFix: {
          type: 'set-metadata',
          description: 'Set default page description in metadata',
          patch: { description: 'Discover products, services, and insights on this page.' },
        },
      });
    } else if (!isDynamicSeo && (description.trim().length < 50 || description.trim().length > 180)) {
      const loc = { pagePath: metaTargetFile, propName: 'description' };
      findings.push({
        id: generateFindingId('seo', 'weak-page-description', loc),
        scope: 'seo',
        ruleId: 'weak-page-description',
        severity: 'warning',
        title: 'Suboptimal meta description length',
        message: `Meta description is ${description.trim().length} characters (recommended: 120–160).`,
        explanation: 'Descriptions under 50 characters are uninformative; descriptions over 180 characters get truncated by Google.',
        remediation: 'Adjust description length to between 120 and 160 characters.',
        location: loc,
        canAutoFix: false,
      });
    }

    // ─── Rule: missing-canonical ───────────────────────────────────────────
    // NOTE: Revyme automatically generates self-referential canonical URLs and
    // hreflang alternates for all routes during export and build time. Leaving
    // canonical empty in page metadata is standard and expected; do not flag as missing.

    // ─── Rule: missing-social-image-asset ──────────────────────────────────
    if (!ogImage) {
      const loc = { pagePath: metaTargetFile, propName: 'openGraph.images' };
      findings.push({
        id: generateFindingId('seo', 'missing-social-image-asset', loc),
        scope: 'seo',
        ruleId: 'missing-social-image-asset',
        severity: 'warning',
        title: 'Missing OpenGraph social image',
        message: 'Page does not declare an OpenGraph social preview image (og:image).',
        explanation: 'Sharing links on social networks without an image results in unappealing link previews.',
        remediation: 'Declare an og:image (1200x630px) in page metadata.',
        location: loc,
        canAutoFix: false,
      });
    }
  }

  // ─── Rule: invalid-page-language (checked on root layout or html tag) ───
  if (isRootLayout || foundLang !== null) {
    if (foundLang === null && isRootLayout) {
      const loc = { pagePath, tag: 'html', propName: 'lang' };
      findings.push({
        id: generateFindingId('seo', 'invalid-page-language', loc),
        scope: 'seo',
        ruleId: 'invalid-page-language',
        severity: 'warning',
        title: 'Missing HTML language tag',
        message: 'Root <html> element lacks a lang attribute.',
        explanation: 'The lang attribute on <html> specifies the primary document language for crawlers and speech synthesizers.',
        remediation: 'Add lang="en" (or your primary language tag) to <html lang="...">.',
        location: loc,
        canAutoFix: true,
        suggestedFix: {
          type: 'set-attribute',
          description: 'Add lang="en" to <html>',
          patch: { lang: 'en' },
        },
      });
    } else if (foundLang && foundLang !== 'dynamic' && !BCP47_REGEX.test(foundLang)) {
      const loc = { pagePath, tag: 'html', propName: 'lang' };
      findings.push({
        id: generateFindingId('seo', 'invalid-page-language', loc),
        scope: 'seo',
        ruleId: 'invalid-page-language',
        severity: 'warning',
        title: 'Invalid BCP-47 language tag',
        message: `Value "${foundLang}" is not a valid BCP-47 language tag.`,
        explanation: 'HTML lang attributes must follow the BCP-47 format (e.g. "en", "en-US", "uk").',
        remediation: 'Update lang to a valid BCP-47 tag.',
        location: loc,
        canAutoFix: true,
        suggestedFix: {
          type: 'set-attribute',
          description: 'Fix language tag to "en"',
          patch: { lang: 'en' },
        },
      });
    }
  }

  // ─── JSON-LD Structured Data Checks ──────────────────────────────────────
  for (const rawJson of jsonLdScripts) {
    try {
      const parsed = JSON.parse(rawJson);
      // Rule: missing-json-ld-context
      if (!parsed['@context'] || !String(parsed['@context']).includes('schema.org')) {
        const loc = { pagePath, tag: 'script', propName: '@context' };
        findings.push({
          id: generateFindingId('seo', 'missing-json-ld-context', loc),
          scope: 'seo',
          ruleId: 'missing-json-ld-context',
          severity: 'warning',
          title: 'Missing Schema.org context in JSON-LD',
          message: 'JSON-LD structured data root lacks "@context": "https://schema.org".',
          explanation: 'All Schema.org JSON-LD structured data blocks must identify https://schema.org as their context.',
          remediation: 'Add "@context": "https://schema.org" to the JSON-LD root object.',
          location: loc,
          canAutoFix: true,
        });
      }

      // Rule: unknown-schema-org-type
      const type = parsed['@type'];
      if (type && typeof type === 'string' && !COMMON_SCHEMA_ORG_TYPES.has(type)) {
        const loc = { pagePath, tag: 'script', propName: '@type' };
        findings.push({
          id: generateFindingId('seo', 'unknown-schema-org-type', loc),
          scope: 'seo',
          ruleId: 'unknown-schema-org-type',
          severity: 'warning',
          title: 'Unrecognized Schema.org entity type',
          message: `The declared Schema.org @type "${type}" is uncommon or unrecognized.`,
          explanation: 'Using standard Schema.org entity types ensures search engines understand your structured snippets.',
          remediation: 'Verify type spelling against schema.org (e.g. Organization, Article, WebSite).',
          location: loc,
          canAutoFix: false,
        });
      }
    } catch {
      // Rule: invalid-json-ld
      const loc = { pagePath, tag: 'script' };
      findings.push({
        id: generateFindingId('seo', 'invalid-json-ld', loc),
        scope: 'seo',
        ruleId: 'invalid-json-ld',
        severity: 'error',
        title: 'Malformed JSON-LD structured data',
        message: 'JSON-LD structured data script contains malformed JSON.',
        explanation: 'Structured data scripts must parse as strict JSON without syntax errors.',
        remediation: 'Correct the JSON syntax in the ld+json script.',
        location: loc,
        canAutoFix: false,
      });
    }
  }

  return findings;
}

/**
 * Cross-page metadata inspection: checks for duplicate titles and descriptions across routes.
 */
export function inspectCrossPageMetadata(
  pages: Array<{ pagePath: string; title: string; description: string }>
): AuditFinding[] {
  trace.fn('inspectCrossPageMetadata', { pageCount: pages.length });
  const findings: AuditFinding[] = [];

  const titleMap = new Map<string, string[]>();
  const descMap = new Map<string, string[]>();

  for (const page of pages) {
    if (page.title && page.title.trim().length > 0) {
      const clean = page.title.trim().toLowerCase();
      const list = titleMap.get(clean) || [];
      list.push(page.pagePath);
      titleMap.set(clean, list);
    }
    if (page.description && page.description.trim().length > 0) {
      const clean = page.description.trim().toLowerCase();
      const list = descMap.get(clean) || [];
      list.push(page.pagePath);
      descMap.set(clean, list);
    }
  }

  // Duplicate titles across pages
  for (const [titleKey, paths] of titleMap.entries()) {
    if (paths.length > 1) {
      for (const p of paths) {
        const loc = { pagePath: p, propName: 'title' };
        findings.push({
          id: generateFindingId('seo', 'duplicate-page-title', loc),
          scope: 'seo',
          ruleId: 'duplicate-page-title',
          severity: 'warning',
          title: 'Duplicate page title across routes',
          message: `Page title is duplicated across ${paths.length} routes: ${paths.join(', ')}.`,
          explanation: 'Each page should have a unique title describing its distinct content.',
          remediation: 'Customize page title for each route.',
          location: loc,
          canAutoFix: false,
        });
      }
    }
  }

  // Duplicate descriptions across pages
  for (const [descKey, paths] of descMap.entries()) {
    if (paths.length > 1) {
      for (const p of paths) {
        const loc = { pagePath: p, propName: 'description' };
        findings.push({
          id: generateFindingId('seo', 'duplicate-page-description', loc),
          scope: 'seo',
          ruleId: 'duplicate-page-description',
          severity: 'warning',
          title: 'Duplicate meta description across routes',
          message: `Meta description is duplicated across ${paths.length} routes: ${paths.join(', ')}.`,
          explanation: 'Each page should have an individualized meta description.',
          remediation: 'Provide a tailored description for each route.',
          location: loc,
          canAutoFix: false,
        });
      }
    }
  }

  return findings;
}
