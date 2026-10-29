// src/code/audit/static/static-runner.ts
// Primary entry point for in-memory AST and state linting (< 20ms).

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import { parseJSX, normalizeBabelTraverse } from '@/code/parsing/ast-utils';
import _traverse from '@babel/traverse';
import type {
  AuditFinding,
  AuditResult,
  AuditScope,
  RunAuditOptions,
  SkippedAuditCheck,
} from '../core/types';
import { normalizeFindings, calculateAuditSummary, generateFindingId } from '../core/normalizer';
import { inspectA11yInAST } from './a11y-inspector';
import { inspectHeadingAndLandmarkTree } from './heading-tree';
import {
  inspectSinglePageMetadata,
  inspectCrossPageMetadata,
} from './metadata-inspector';
import { inspectSecurityInAST } from './security-inspector';
import { parseMetadataFromCode } from '@/code/generation/metadata-gen';
import { trace } from '@/shared/debug-trace';

const traverse = normalizeBabelTraverse(_traverse);

/**
 * Inspect structural layout nesting depth and image dimensions.
 */
function inspectStructuralCode(
  ast: t.File,
  pagePath: string
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  let maxDepth = 0;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      // Calculate depth of nesting
      let depth = 0;
      let curr: NodePath | null = path.parentPath;
      while (curr) {
        if (curr.isJSXElement()) depth++;
        curr = curr.parentPath;
      }
      if (depth > maxDepth) maxDepth = depth;

      // Check missing-image-dimensions on <img>
      const opening = path.node.openingElement;
      let tagName = '';
      if (t.isJSXIdentifier(opening.name)) {
        tagName = opening.name.name;
      } else if (t.isJSXMemberExpression(opening.name)) {
        const obj = (opening.name.object as any).name;
        const prop = (opening.name.property as any).name;
        tagName = obj === 'motion' ? prop : `${obj}.${prop}`;
      }

      if (tagName === 'img') {
        let hasWidth = false;
        let hasHeight = false;
        let hasStyleDimension = false;
        let nodeId: string | undefined;

        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
            const name = attr.name.name;
            if (name === 'data-id' && t.isStringLiteral(attr.value)) nodeId = attr.value.value;
            if (name === 'width') hasWidth = true;
            if (name === 'height') hasHeight = true;
            if (name === 'style' && t.isJSXExpressionContainer(attr.value) && t.isObjectExpression(attr.value.expression)) {
              for (const prop of attr.value.expression.properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                  if (prop.key.name === 'width' || prop.key.name === 'height' || prop.key.name === 'aspectRatio') {
                    hasStyleDimension = true;
                  }
                }
              }
            }
          }
        }

        if ((!hasWidth || !hasHeight) && !hasStyleDimension) {
          const loc = { pagePath, nodeId, tag: tagName, line: opening.loc?.start.line, column: opening.loc?.start.column };
          findings.push({
            id: generateFindingId('performance', 'missing-image-dimensions', loc),
            scope: 'performance',
            ruleId: 'missing-image-dimensions',
            severity: 'warning',
            title: 'Image lacks explicit width/height or aspect-ratio',
            message: '<img> tag lacks explicit width and height attributes or CSS aspect-ratio.',
            explanation: 'Images without dimensions cause Cumulative Layout Shift (CLS) when loaded.',
            remediation: 'Provide width and height attributes or declare an aspect-ratio in CSS.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add width="100%" height="auto" attributes',
              patch: { width: '100%', height: 'auto' },
            },
          });
        }
      }
    },
  });

  // Rule: excessive-div-nesting
  if (maxDepth > 15) {
    const loc = { pagePath };
    findings.push({
      id: generateFindingId('clean-code', 'excessive-div-nesting', loc),
      scope: 'clean-code',
      ruleId: 'excessive-div-nesting',
      severity: 'info',
      title: 'Excessive DOM element nesting depth (> 15 levels)',
      message: `Component hierarchy contains deep element nesting of depth ${maxDepth}.`,
      explanation: 'Deep nesting creates excessive DOM overhead and complicates layout rendering.',
      remediation: 'Flatten markup by consolidating intermediate container elements.',
      location: loc,
      canAutoFix: false,
    });
  }

  return findings;
}

export async function runStaticAudit(
  options: RunAuditOptions
): Promise<AuditResult> {
  trace.fn('runStaticAudit', { pagePath: options.pagePath, scopes: options.scopes });

  const scopesSet = options.scopes ? new Set<AuditScope>(options.scopes) : null;
  const shouldInclude = (scope: AuditScope) => !scopesSet || scopesSet.has(scope);

  const rawFindings: AuditFinding[] = [];
  const allSkipped: SkippedAuditCheck[] = [];
  const crossPages: Array<{ pagePath: string; title: string; description: string }> = [];

  const fileMap = options.fileMap || {};

  // If fileMap is empty and pagePath is provided, we check if pagePath is in fileMap
  for (const [filePath, code] of Object.entries(fileMap)) {
    if (options.pagePath && filePath !== options.pagePath && !filePath.endsWith(options.pagePath)) {
      continue;
    }

    // Only audit site source files (app/ pages/layouts and components/).
    // Skip builder plugins (plugins/), internal metadata (_meta/), tests, and scripts.
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) {
      continue;
    }
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      continue;
    }
    if (filePath.startsWith('plugins/') || filePath.startsWith('_meta/') || filePath.startsWith('node_modules/') || filePath.startsWith('data/')) {
      continue;
    }

    // Skip auto-generated locale route wrappers (@revyme-locale-route).
    // Their canonical content and SEO are authored and audited via their primary page.client.tsx file.
    if (code.includes('@revyme-locale-route')) {
      continue;
    }

    const isClientPage = filePath.endsWith('page.client.tsx') || filePath === 'page.client.tsx';
    const serverCompanionPath = isClientPage
      ? filePath.replace(/\/?page\.client\.tsx$/, (m) => m.replace('page.client.tsx', 'page.tsx'))
      : null;
    const clientCompanionPath =
      (filePath.endsWith('page.tsx') || filePath === 'page.tsx') && !isClientPage
        ? filePath.replace(/\/?page\.tsx$/, (m) => m.replace('page.tsx', 'page.client.tsx'))
        : null;

    // If this is a server wrapper whose client pair exists, its metadata & JSX are checked via the client pair
    const isServerWrapper = Boolean(clientCompanionPath && fileMap[clientCompanionPath]);
    if (isServerWrapper && !options.pagePath) {
      continue;
    }

    const ast = parseJSX(code);
    if (!ast) {
      allSkipped.push({
        ruleId: 'syntax-parse-failed',
        reason: 'unsupported-component',
        location: { pagePath: filePath },
      });
      continue;
    }

    // A11y & Landmarks
    if (shouldInclude('accessibility')) {
      const a11y = inspectA11yInAST(ast, filePath, traverse);
      rawFindings.push(...a11y.findings);
      allSkipped.push(...a11y.skippedChecks);

      const headings = inspectHeadingAndLandmarkTree(ast, filePath, traverse);
      rawFindings.push(...headings);
    }

    // SEO & Metadata
    if (shouldInclude('seo')) {
      const companionServerCode = serverCompanionPath ? fileMap[serverCompanionPath] : undefined;
      const seoFindings = inspectSinglePageMetadata(
        filePath,
        code,
        ast,
        traverse,
        companionServerCode,
        serverCompanionPath || undefined
      );
      rawFindings.push(...seoFindings);

      const metaSource = companionServerCode || code;
      const parsedMeta = parseMetadataFromCode(metaSource);
      crossPages.push({
        pagePath: filePath,
        title: (parsedMeta.title as string) || '',
        description: (parsedMeta.description as string) || '',
      });
    }

    // Security
    if (shouldInclude('security')) {
      const secFindings = inspectSecurityInAST(ast, filePath, traverse);
      rawFindings.push(...secFindings);
    }

    // Clean code & Performance
    if (shouldInclude('clean-code') || shouldInclude('performance')) {
      const structFindings = inspectStructuralCode(ast, filePath);
      for (const sf of structFindings) {
        if (shouldInclude(sf.scope)) {
          rawFindings.push(sf);
        }
      }
    }
  }

  // Cross-page SEO checks if multiple pages evaluated
  if (crossPages.length > 1 && shouldInclude('seo')) {
    const crossFindings = inspectCrossPageMetadata(crossPages);
    rawFindings.push(...crossFindings);
  }

  const normalized = normalizeFindings(rawFindings);
  const summary = calculateAuditSummary(normalized);

  return {
    summary,
    findings: normalized,
    skippedChecks: allSkipped,
  };
}
