// src/code/audit/rendered/contrast-engine.ts
// WCAG 2.2 AA Color Contrast Engine (relative luminance & contrast ratio).

import type { AuditFinding } from '../core/types';
import { generateFindingId } from '../core/normalizer';
import {
  parseCssColor,
  relativeLuminance,
  contrastRatio,
  type AuditNode,
  type ParsedColor,
} from '@/ai/agent/tools/design-audit';
import { trace } from '@/shared/debug-trace';

export { parseCssColor, relativeLuminance, contrastRatio };

export interface ContrastOptions {
  pagePath: string;
  defaultBackground?: string; // Fallback background if whole chain is transparent (defaults to #ffffff)
}

/**
 * Resolves the effective background color of a node by walking up parent hierarchy
 * until a non-transparent color is encountered.
 */
export function resolveEffectiveBackgroundColor(
  node: AuditNode,
  nodeMap: Map<string, AuditNode>,
  fallbackBg: string = '#ffffff'
): string {
  let curr: AuditNode | undefined = node;
  while (curr) {
    const bg = curr.computed.backgroundColor;
    if (bg) {
      const parsed = parseCssColor(bg);
      if (parsed && parsed.a >= 0.95) {
        return bg;
      }
    }
    curr = curr.parentId ? nodeMap.get(curr.parentId) : undefined;
  }
  return fallbackBg;
}

/**
 * Checks whether text is considered "large text" under WCAG 2.2:
 * >= 24px (18pt) or >= 18.66px (14pt) with bold weight (>= 700).
 */
export function isLargeText(fontSizeStr: string, fontWeightStr: string): boolean {
  const px = parseFloat(fontSizeStr) || 16;
  const isBold =
    fontWeightStr === 'bold' ||
    fontWeightStr === 'bolder' ||
    (parseInt(fontWeightStr, 10) >= 700);

  if (px >= 24) return true;
  if (px >= 18.66 && isBold) return true;
  return false;
}

/**
 * Audits all text nodes for WCAG 2.2 AA contrast compliance.
 */
export function auditTextContrast(
  nodes: AuditNode[],
  options: ContrastOptions
): AuditFinding[] {
  trace.fn('auditTextContrast', { nodeCount: nodes.length, pagePath: options.pagePath });
  const findings: AuditFinding[] = [];
  const nodeMap = new Map<string, AuditNode>(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    const text = (node.text || '').trim();
    if (!text) continue; // Only check nodes that actually display text

    const fg = node.computed.color;
    if (!fg) continue;

    const bg = resolveEffectiveBackgroundColor(node, nodeMap, options.defaultBackground || '#ffffff');
    const ratio = contrastRatio(fg, bg);
    if (ratio === null) continue;

    const large = isLargeText(node.computed.fontSize || '', node.computed.fontWeight || '');
    const minRatio = large ? 3.0 : 4.5;

    if (ratio < minRatio) {
      const loc = {
        pagePath: options.pagePath,
        nodeId: node.id,
        propName: 'color',
      };
      findings.push({
        id: generateFindingId('accessibility', 'low-text-contrast', loc),
        scope: 'accessibility',
        ruleId: 'low-text-contrast',
        severity: 'warning',
        title: 'Insufficient text color contrast (WCAG AA)',
        message: `Text "${text.slice(0, 30)}" has contrast ratio ${ratio.toFixed(2)}:1 against background ${bg} (required: ${minRatio}:1).`,
        explanation: `WCAG 2.2 AA requires at least ${minRatio}:1 contrast ratio for ${large ? 'large' : 'regular'} text to ensure readability.`,
        remediation: 'Increase text color contrast by adjusting color or background color.',
        location: loc,
        evidence: {
          textColor: fg,
          backgroundColor: bg,
          actualRatio: Number(ratio.toFixed(2)),
          requiredRatio: minRatio,
          isLargeText: large,
        },
        canAutoFix: false,
      });
    }
  }

  return findings;
}
