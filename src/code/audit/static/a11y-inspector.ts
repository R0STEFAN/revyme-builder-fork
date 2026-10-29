// src/code/audit/static/a11y-inspector.ts
// Static AST inspector for WCAG 2.2 AA Accessibility rules.

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { AuditFinding, SkippedAuditCheck } from '../core/types';
import {
  VALID_ARIA_ROLES,
  REQUIRED_ARIA_ROLE_PROPERTIES,
} from '../core/registry';
import { generateFindingId } from '../core/normalizer';
import { trace } from '@/shared/debug-trace';

interface ElementInfo {
  tag: string;
  nodeId?: string;
  id?: string;
  role?: string;
  tabIndex?: number;
  ariaHidden?: boolean;
  hasText: boolean;
  attrs: Map<string, string | boolean | number>;
  line?: number;
  column?: number;
}

export function extractJSXAttributeValue(attr: t.JSXAttribute): string | boolean | number | null {
  if (!attr.value) return true; // e.g. <input disabled />
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  if (t.isJSXExpressionContainer(attr.value)) {
    const expr = attr.value.expression;
    if (t.isStringLiteral(expr)) return expr.value;
    if (t.isNumericLiteral(expr)) return expr.value;
    if (t.isBooleanLiteral(expr)) return expr.value;
  }
  return null;
}

export function inspectA11yInAST(
  ast: t.File,
  pagePath: string,
  traverseFn: any
): { findings: AuditFinding[]; skippedChecks: SkippedAuditCheck[] } {
  trace.fn('inspectA11yInAST', { pagePath });
  const findings: AuditFinding[] = [];
  const skippedChecks: SkippedAuditCheck[] = [];

  const elements: ElementInfo[] = [];
  const idCounts = new Map<string, { count: number; line?: number; nodeId?: string }>();
  const labelForReferences: Array<{ htmlFor: string; line?: number; nodeId?: string }> = [];

  traverseFn(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const opening = path.node.openingElement;
      let tagName = '';
      if (t.isJSXIdentifier(opening.name)) {
        tagName = opening.name.name;
      } else if (t.isJSXMemberExpression(opening.name)) {
        const obj = (opening.name.object as any).name;
        const prop = opening.name.property.name;
        tagName = obj === 'motion' ? prop : `${obj}.${prop}`;
      }

      const attrs = new Map<string, string | boolean | number>();
      let nodeId: string | undefined;
      let htmlId: string | undefined;
      let role: string | undefined;
      let tabIndex: number | undefined;
      let ariaHidden: boolean | undefined;

      for (const attr of opening.attributes) {
        if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
          const name = attr.name.name;
          const val = extractJSXAttributeValue(attr);
          if (val !== null) {
            attrs.set(name, val);
          } else {
            // Expression could not be evaluated statically
            skippedChecks.push({
              ruleId: 'a11y-dynamic-attribute',
              reason: 'dynamic-expression',
              location: {
                pagePath,
                nodeId,
                tag: tagName,
                propName: name,
                line: attr.loc?.start.line,
              },
            });
          }

          if (name === 'data-id' && typeof val === 'string') {
            nodeId = val;
          } else if (name === 'id' && typeof val === 'string') {
            htmlId = val;
          } else if (name === 'role' && typeof val === 'string') {
            role = val;
          } else if (name === 'tabIndex' || name === 'tabindex') {
            if (typeof val === 'number') tabIndex = val;
            else if (typeof val === 'string' && !isNaN(Number(val))) tabIndex = Number(val);
          } else if (name === 'aria-hidden') {
            ariaHidden = val === true || val === 'true';
          }
        }
      }

      // Track HTML ID uniqueness
      if (htmlId) {
        const existing = idCounts.get(htmlId);
        if (existing) {
          existing.count++;
        } else {
          idCounts.set(htmlId, {
            count: 1,
            line: opening.loc?.start.line,
            nodeId,
          });
        }
      }

      // Track label htmlFor
      if (tagName === 'label' && attrs.has('htmlFor')) {
        const forVal = String(attrs.get('htmlFor'));
        labelForReferences.push({
          htmlFor: forVal,
          line: opening.loc?.start.line,
          nodeId,
        });
      }

      // Check text children presence
      let hasText = false;
      for (const child of path.node.children) {
        if (t.isJSXText(child) && child.value.trim().length > 0) {
          hasText = true;
          break;
        }
        if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
          hasText = true;
          break;
        }
        if (t.isJSXElement(child)) {
          // Has inner markup
          hasText = true;
          break;
        }
      }

      const info: ElementInfo = {
        tag: tagName,
        nodeId,
        id: htmlId,
        role,
        tabIndex,
        ariaHidden,
        hasText,
        attrs,
        line: opening.loc?.start.line,
        column: opening.loc?.start.column,
      };

      elements.push(info);

      // ─── Rule 1: missing-alt ──────────────────────────────────────────────
      if (tagName === 'img' || tagName === 'Image' || tagName.endsWith('.img')) {
        if (!attrs.has('alt')) {
          const loc = { pagePath, nodeId, tag: tagName, line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'missing-alt', loc),
            scope: 'accessibility',
            ruleId: 'missing-alt',
            severity: 'error',
            title: 'Missing image alt attribute',
            message: `<${tagName}> lacks an alt attribute.`,
            explanation: 'Images must provide an alt attribute for accessibility. Use alt="" if the image is purely decorative.',
            remediation: 'Add alt="Descriptive text" or alt="" if decorative.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add decorative alt="" attribute',
              patch: { alt: '' },
            },
          });
        }
      }

      // ─── Rule 2: missing-image-input-alt ──────────────────────────────────
      if (tagName === 'input' && attrs.get('type') === 'image') {
        if (!attrs.has('alt')) {
          const loc = { pagePath, nodeId, tag: tagName, line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'missing-image-input-alt', loc),
            scope: 'accessibility',
            ruleId: 'missing-image-input-alt',
            severity: 'error',
            title: 'Missing alt attribute on image input',
            message: '<input type="image"> lacks an alt attribute.',
            explanation: '<input type="image"> acts as a graphical submit button and requires alt text describing its action.',
            remediation: 'Add alt="Submit" or descriptive action text.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add alt="Submit" attribute',
              patch: { alt: 'Submit' },
            },
          });
        }
      }

      // ─── Rule 3: missing-iframe-title ─────────────────────────────────────
      if (tagName === 'iframe') {
        if (!attrs.has('title') || String(attrs.get('title')).trim().length === 0) {
          const loc = { pagePath, nodeId, tag: tagName, line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'missing-iframe-title', loc),
            scope: 'accessibility',
            ruleId: 'missing-iframe-title',
            severity: 'error',
            title: 'Missing iframe title',
            message: '<iframe> element lacks an accessible title attribute.',
            explanation: 'Inline frames require a descriptive title attribute to inform screen reader users of their contents.',
            remediation: 'Add a descriptive title attribute to the <iframe>.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add title attribute to iframe',
              patch: { title: 'Embedded Content' },
            },
          });
        }
      }

      // ─── Rule 4: missing-accessible-name ──────────────────────────────────
      const isInteractive =
        tagName === 'button' ||
        tagName === 'a' ||
        tagName.endsWith('.button') ||
        tagName.endsWith('.a') ||
        role === 'button' ||
        role === 'link';

      if (isInteractive) {
        const hasAriaName =
          attrs.has('aria-label') ||
          attrs.has('aria-labelledby') ||
          attrs.has('title');
        if (!hasText && !hasAriaName) {
          const loc = { pagePath, nodeId, tag: tagName, line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'missing-accessible-name', loc),
            scope: 'accessibility',
            ruleId: 'missing-accessible-name',
            severity: 'error',
            title: 'Interactive element lacks accessible name',
            message: `<${tagName}> has no text content and no aria-label, aria-labelledby, or title.`,
            explanation: 'Interactive controls must have a discernable name so assistive technologies can read them aloud.',
            remediation: 'Provide visible text content or declare an aria-label attribute.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add aria-label attribute',
              patch: { 'aria-label': 'Action' },
            },
          });
        }
      }

      // ─── Rule 5: positive-tabindex ────────────────────────────────────────
      if (tabIndex !== undefined && tabIndex > 0) {
        const loc = { pagePath, nodeId, tag: tagName, propName: 'tabIndex', line: info.line, column: info.column };
        findings.push({
          id: generateFindingId('accessibility', 'positive-tabindex', loc),
          scope: 'accessibility',
          ruleId: 'positive-tabindex',
          severity: 'warning',
          title: 'Disruptive positive tabIndex',
          message: `Element has positive tabIndex={${tabIndex}}, which disrupts native keyboard flow.`,
          explanation: 'Positive tabIndex creates an artificial navigation order that confounds keyboard users.',
          remediation: 'Use tabIndex={0} or naturally ordered DOM elements instead.',
          location: loc,
          canAutoFix: true,
          suggestedFix: {
            type: 'set-attribute',
            description: 'Change tabIndex to 0',
            patch: { tabIndex: '0' },
          },
        });
      }

      // ─── Rule 6: aria-hidden-focusable ────────────────────────────────────
      if (ariaHidden === true) {
        const isFocusable =
          isInteractive ||
          (tabIndex !== undefined && tabIndex >= 0) ||
          ['input', 'select', 'textarea'].includes(tagName);

        if (isFocusable) {
          const loc = { pagePath, nodeId, tag: tagName, line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'aria-hidden-focusable', loc),
            scope: 'accessibility',
            ruleId: 'aria-hidden-focusable',
            severity: 'error',
            title: 'Focusable element hidden by aria-hidden',
            message: `<${tagName}> has aria-hidden="true" but is interactive or focusable.`,
            explanation: 'Elements hidden with aria-hidden="true" should never be keyboard-focusable.',
            remediation: 'Remove aria-hidden="true" or add tabIndex={-1} to remove it from keyboard sequence.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Remove aria-hidden attribute',
              patch: { 'aria-hidden': '' },
            },
          });
        }
      }

      // ─── Rule 7: invalid-aria-role ────────────────────────────────────────
      if (role) {
        if (!VALID_ARIA_ROLES.has(role)) {
          const loc = { pagePath, nodeId, tag: tagName, propName: 'role', line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'invalid-aria-role', loc),
            scope: 'accessibility',
            ruleId: 'invalid-aria-role',
            severity: 'error',
            title: 'Invalid WAI-ARIA role attribute',
            message: `role="${role}" is not a recognized W3C WAI-ARIA role.`,
            explanation: 'The declared role attribute must match official WAI-ARIA standards.',
            remediation: 'Correct the role name or remove the role attribute.',
            location: loc,
            canAutoFix: false,
          });
        } else {
          // ─── Rule 8: missing-required-aria-role-property ─────────────────
          const requiredProps = REQUIRED_ARIA_ROLE_PROPERTIES[role];
          if (requiredProps) {
            for (const reqProp of requiredProps) {
              if (!attrs.has(reqProp)) {
                const loc = { pagePath, nodeId, tag: tagName, propName: reqProp, line: info.line, column: info.column };
                findings.push({
                  id: generateFindingId('accessibility', 'missing-required-aria-role-property', loc),
                  scope: 'accessibility',
                  ruleId: 'missing-required-aria-role-property',
                  severity: 'error',
                  title: 'Missing required ARIA role property',
                  message: `role="${role}" requires mandatory property "${reqProp}".`,
                  explanation: `ARIA specification requires ${role} to declare ${reqProp}.`,
                  remediation: `Supply the ${reqProp} property with appropriate state value.`,
                  location: loc,
                  canAutoFix: false,
                });
              }
            }
          }
        }
      }

      // ─── Rule 9: missing-form-label ───────────────────────────────────────
      const isFormControl = ['input', 'select', 'textarea'].includes(tagName);
      if (isFormControl && attrs.get('type') !== 'hidden' && attrs.get('type') !== 'image') {
        const hasAria = attrs.has('aria-label') || attrs.has('aria-labelledby') || attrs.has('title');
        const hasId = attrs.has('id');
        const isReferencedByLabel = hasId && labelForReferences.some((l) => l.htmlFor === String(attrs.get('id')));

        // Check if wrapped by label
        let isWrappedByLabel = false;
        let current: NodePath | null = path.parentPath as NodePath | null;
        while (current) {
          if (current.isJSXElement()) {
            const parentName = (current.node.openingElement.name as any)?.name;
            if (parentName === 'label') {
              isWrappedByLabel = true;
              break;
            }
          }
          current = (current as any).parentPath ?? null;
        }

        if (!hasAria && !isReferencedByLabel && !isWrappedByLabel) {
          const loc = { pagePath, nodeId, tag: tagName, line: info.line, column: info.column };
          findings.push({
            id: generateFindingId('accessibility', 'missing-form-label', loc),
            scope: 'accessibility',
            ruleId: 'missing-form-label',
            severity: 'error',
            title: 'Form control lacks associated label',
            message: `<${tagName}> is not associated with a <label> or aria-label.`,
            explanation: 'Every form control must have an associated label for accessibility.',
            remediation: 'Add a <label htmlFor="..."> or declare aria-label on the form input.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add aria-label attribute',
              patch: { 'aria-label': 'Input field' },
            },
          });
        }
      }
    },
  });

  // ─── Rule 10: duplicate-id ───────────────────────────────────────────────
  for (const [id, record] of idCounts.entries()) {
    if (record.count > 1) {
      const loc = { pagePath, nodeId: record.nodeId, propName: 'id', line: record.line };
      findings.push({
        id: generateFindingId('accessibility', 'duplicate-id', loc),
        scope: 'accessibility',
        ruleId: 'duplicate-id',
        severity: 'error',
        title: 'Duplicate HTML id attribute',
        message: `HTML id "${id}" appears ${record.count} times in the page.`,
        explanation: 'All element id values in a document must be unique.',
        remediation: 'Ensure every HTML id is unique.',
        location: loc,
        canAutoFix: false,
      });
    }
  }

  // ─── Rule 11: invalid-label-reference ─────────────────────────────────────
  for (const ref of labelForReferences) {
    if (!idCounts.has(ref.htmlFor)) {
      const loc = { pagePath, nodeId: ref.nodeId, propName: 'htmlFor', line: ref.line };
      findings.push({
        id: generateFindingId('accessibility', 'invalid-label-reference', loc),
        scope: 'accessibility',
        ruleId: 'invalid-label-reference',
        severity: 'error',
        title: 'Label references nonexistent element',
        message: `<label htmlFor="${ref.htmlFor}"> references an id that does not exist in the page.`,
        explanation: 'The htmlFor target must match a valid element id in the same document.',
        remediation: `Create a form control with id="${ref.htmlFor}" or update htmlFor.`,
        location: loc,
        canAutoFix: false,
      });
    }
  }

  return { findings, skippedChecks };
}
