// src/code/audit/static/heading-tree.ts
// Sequential heading tree validator (h1–h6) and document landmark checker.

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { AuditFinding } from '../core/types';
import { generateFindingId } from '../core/normalizer';
import { trace } from '@/shared/debug-trace';

interface HeadingNode {
  level: number;
  tagName: string;
  nodeId?: string;
  line?: number;
  column?: number;
}

interface LandmarkNode {
  tag: string;
  role?: string;
  nodeId?: string;
  line?: number;
}

export function inspectHeadingAndLandmarkTree(
  ast: t.File,
  pagePath: string,
  traverseFn: any
): AuditFinding[] {
  trace.fn('inspectHeadingAndLandmarkTree', { pagePath });
  const findings: AuditFinding[] = [];
  const headings: HeadingNode[] = [];
  const mainLandmarks: LandmarkNode[] = [];

  traverseFn(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const opening = path.node.openingElement;
      let tagName = '';
      if (t.isJSXIdentifier(opening.name)) {
        tagName = opening.name.name.toLowerCase();
      } else if (t.isJSXMemberExpression(opening.name) && t.isJSXIdentifier(opening.name.property)) {
        const obj = t.isJSXIdentifier(opening.name.object) ? opening.name.object.name.toLowerCase() : '';
        if (obj === 'motion') {
          tagName = opening.name.property.name.toLowerCase();
        } else {
          tagName = `${obj}.${opening.name.property.name.toLowerCase()}`;
        }
      }

      let nodeId: string | undefined;
      let role: string | undefined;

      for (const attr of opening.attributes) {
        if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
          const val = attr.value;
          if (attr.name.name === 'data-id' && t.isStringLiteral(val)) {
            nodeId = val.value;
          } else if (attr.name.name === 'role' && t.isStringLiteral(val)) {
            role = val.value.toLowerCase();
          }
        }
      }

      // Check heading h1-h6
      const headingMatch = tagName.match(/^h([1-6])$/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1], 10);
        headings.push({
          level,
          tagName,
          nodeId,
          line: opening.loc?.start.line,
          column: opening.loc?.start.column,
        });
      }

      // Check <main> or role="main"
      if (tagName === 'main' || role === 'main') {
        mainLandmarks.push({
          tag: tagName,
          role,
          nodeId,
          line: opening.loc?.start.line,
        });
      }
    },
  });

  // Skip heading checks for non-page files (e.g. components or fragments)
  const isPage = pagePath.endsWith('page.tsx') || pagePath.endsWith('page.client.tsx') || pagePath === 'page.client.tsx';

  if (isPage) {
    const h1Headings = headings.filter((h) => h.level === 1);

    // Rule: missing-page-heading
    if (h1Headings.length === 0) {
      const loc = { pagePath };
      findings.push({
        id: generateFindingId('accessibility', 'missing-page-heading', loc),
        scope: 'accessibility',
        ruleId: 'missing-page-heading',
        severity: 'warning',
        title: 'Missing top-level <h1> heading',
        message: 'The page contains no <h1> element.',
        explanation: 'Every page should contain exactly one top-level <h1> element defining its main topic.',
        remediation: 'Add an <h1> heading summarizing the page theme.',
        location: loc,
        canAutoFix: false,
      });
    } else if (h1Headings.length > 1) {
      // Rule: multiple-page-headings
      for (let i = 1; i < h1Headings.length; i++) {
        const extra = h1Headings[i];
        const loc = { pagePath, nodeId: extra.nodeId, tag: extra.tagName, line: extra.line, column: extra.column };
        findings.push({
          id: generateFindingId('accessibility', 'multiple-page-headings', loc),
          scope: 'accessibility',
          ruleId: 'multiple-page-headings',
          severity: 'warning',
          title: 'Multiple <h1> headings found',
          message: `Secondary <h1> heading found on line ${extra.line || 'unknown'}.`,
          explanation: 'Standard accessibility practice recommends a single <h1> per page; secondary titles should be <h2>.',
          remediation: 'Demote secondary <h1> to <h2>.',
          location: loc,
          canAutoFix: true,
          suggestedFix: {
            type: 'change-tag',
            description: 'Change heading tag from h1 to h2',
            patch: { newTag: 'h2' },
          },
        });
      }
    }

    // Rule: skipped-heading-level
    let lastLevel = 1;
    for (let i = 0; i < headings.length; i++) {
      const curr = headings[i];
      if (i === 0) {
        if (curr.level > 2) {
          const loc = { pagePath, nodeId: curr.nodeId, tag: curr.tagName, line: curr.line, column: curr.column };
          findings.push({
            id: generateFindingId('accessibility', 'skipped-heading-level', loc),
            scope: 'accessibility',
            ruleId: 'skipped-heading-level',
            severity: 'warning',
            title: 'Skipped heading hierarchy level',
            message: `First heading on page is <${curr.tagName}>, skipping <h1>.`,
            explanation: 'Headings should follow sequential structure without skipping levels.',
            remediation: 'Change to <h1> or <h2> as appropriate.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'change-tag',
              description: 'Change heading tag to h1',
              patch: { newTag: 'h1' },
            },
          });
        }
        lastLevel = curr.level;
      } else {
        if (curr.level > lastLevel + 1) {
          const expectedTag = `h${lastLevel + 1}`;
          const loc = { pagePath, nodeId: curr.nodeId, tag: curr.tagName, line: curr.line, column: curr.column };
          findings.push({
            id: generateFindingId('accessibility', 'skipped-heading-level', loc),
            scope: 'accessibility',
            ruleId: 'skipped-heading-level',
            severity: 'warning',
            title: 'Skipped heading hierarchy level',
            message: `<${curr.tagName}> follows <h${lastLevel}>, skipping intermediate heading levels.`,
            explanation: `Headings should not skip levels. After <h${lastLevel}>, expected <${expectedTag}>.`,
            remediation: `Change <${curr.tagName}> to <${expectedTag}>.`,
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'change-tag',
              description: `Change heading tag to ${expectedTag}`,
              patch: { newTag: expectedTag },
            },
          });
        }
        lastLevel = curr.level;
      }
    }

    // Rule: missing-main-landmark
    if (mainLandmarks.length === 0) {
      const loc = { pagePath };
      findings.push({
        id: generateFindingId('accessibility', 'missing-main-landmark', loc),
        scope: 'accessibility',
        ruleId: 'missing-main-landmark',
        severity: 'warning',
        title: 'Missing <main> landmark',
        message: 'The page has no <main> landmark container.',
        explanation: 'Assistive technologies use the <main> landmark to jump directly to the primary page content.',
        remediation: 'Wrap page content inside a <main> element.',
        location: loc,
        canAutoFix: false,
      });
    } else if (mainLandmarks.length > 1) {
      // Rule: multiple-main-landmarks
      for (let i = 1; i < mainLandmarks.length; i++) {
        const extra = mainLandmarks[i];
        const loc = { pagePath, nodeId: extra.nodeId, tag: extra.tag, line: extra.line };
        findings.push({
          id: generateFindingId('accessibility', 'multiple-main-landmarks', loc),
          scope: 'accessibility',
          ruleId: 'multiple-main-landmarks',
          severity: 'warning',
          title: 'Multiple <main> landmarks detected',
          message: `Secondary <main> landmark found on line ${extra.line || 'unknown'}.`,
          explanation: 'A document should contain at most one top-level <main> landmark.',
          remediation: 'Consolidate multiple <main> elements into one.',
          location: loc,
          canAutoFix: false,
        });
      }
    }
  }

  return findings;
}
