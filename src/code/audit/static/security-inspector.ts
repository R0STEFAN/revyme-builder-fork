// src/code/audit/static/security-inspector.ts
// Static AST inspector for security rules (rel="noopener", secure HTTPS protocols).

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { AuditFinding } from '../core/types';
import { generateFindingId } from '../core/normalizer';
import { trace } from '@/shared/debug-trace';

export function inspectSecurityInAST(
  ast: t.File,
  pagePath: string,
  traverseFn: any
): AuditFinding[] {
  trace.fn('inspectSecurityInAST', { pagePath });
  const findings: AuditFinding[] = [];

  traverseFn(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const opening = path.node.openingElement;
      let tagName = '';
      if (t.isJSXIdentifier(opening.name)) {
        tagName = opening.name.name;
      } else if (t.isJSXMemberExpression(opening.name)) {
        tagName = `${(opening.name.object as any).name}.${opening.name.property.name}`;
      }

      const isLink = tagName === 'a' || tagName === 'Link' || tagName.endsWith('.a');
      if (!isLink) return;

      let nodeId: string | undefined;
      let href: string | undefined;
      let target: string | undefined;
      let rel: string | undefined;

      for (const attr of opening.attributes) {
        if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
          const name = attr.name.name;
          let val: string | undefined;
          if (t.isStringLiteral(attr.value)) {
            val = attr.value.value;
          } else if (t.isJSXExpressionContainer(attr.value) && t.isStringLiteral(attr.value.expression)) {
            val = attr.value.expression.value;
          }

          if (name === 'data-id') nodeId = val;
          else if (name === 'href') href = val;
          else if (name === 'target') target = val;
          else if (name === 'rel') rel = val;
        }
      }

      // Rule: target-blank-without-noopener
      if (target === '_blank') {
        const hasNoopener = rel && (rel.includes('noopener') || rel.includes('noreferrer'));
        if (!hasNoopener) {
          const loc = { pagePath, nodeId, tag: tagName, propName: 'rel', line: opening.loc?.start.line, column: opening.loc?.start.column };
          findings.push({
            id: generateFindingId('security', 'target-blank-without-noopener', loc),
            scope: 'security',
            ruleId: 'target-blank-without-noopener',
            severity: 'warning',
            title: 'External link opens in new tab without rel="noopener"',
            message: `<${tagName}> specifies target="_blank" without rel="noopener".`,
            explanation: 'Opening target="_blank" without rel="noopener" exposes the page to reverse tabnabbing attacks.',
            remediation: 'Add rel="noopener noreferrer" to the link.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add rel="noopener noreferrer"',
              patch: { rel: 'noopener noreferrer' },
            },
          });
        }
      }

      // Rule: dangerous-external-link
      if (href && href.startsWith('http://') && !href.startsWith('http://localhost') && !href.startsWith('http://127.0.0.1')) {
        const loc = { pagePath, nodeId, tag: tagName, propName: 'href', line: opening.loc?.start.line, column: opening.loc?.start.column };
        findings.push({
          id: generateFindingId('security', 'dangerous-external-link', loc),
          scope: 'security',
          ruleId: 'dangerous-external-link',
          severity: 'warning',
          title: 'Insecure external HTTP link',
          message: `Link href "${href}" uses unencrypted http:// instead of https://.`,
          explanation: 'External links should use secure HTTPS protocols to protect user integrity and privacy.',
          remediation: `Upgrade the link to https://${href.slice(7)}.`,
          location: loc,
          canAutoFix: true,
          suggestedFix: {
            type: 'set-attribute',
            description: 'Upgrade URL to HTTPS',
            patch: { href: `https://${href.slice(7)}` },
          },
        });
      }
    },
  });

  return findings;
}
