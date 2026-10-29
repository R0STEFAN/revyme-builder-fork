// src/code/audit/rendered/geometry-linter.ts
// Geometry, layout overflow, clipping, and media performance linter.

import type { AuditFinding } from '../core/types';
import { generateFindingId } from '../core/normalizer';
import type { AuditNode, LayoutRect } from '@/ai/agent/tools/design-audit';
import { trace } from '@/shared/debug-trace';

export interface GeometryLinterOptions {
  pagePath: string;
  viewportWidth?: number;  // defaults to 1200 or desktop
  viewportHeight?: number; // defaults to 800
  imagesMeta?: Array<{
    nodeId: string;
    naturalWidth: number;
    naturalHeight: number;
    loading?: string;
    priority?: boolean;
    fetchPriority?: string;
  }>;
}

const VIEWPORT_OVERFLOW_TOLERANCE_PX = 8;

export function auditGeometry(
  nodes: AuditNode[],
  options: GeometryLinterOptions
): AuditFinding[] {
  trace.fn('auditGeometry', { nodeCount: nodes.length, pagePath: options.pagePath });
  const findings: AuditFinding[] = [];
  const vpWidth = options.viewportWidth || 1200;
  const vpHeight = options.viewportHeight || 800;

  const nodeMap = new Map<string, AuditNode>(nodes.map((n) => [n.id, n]));

  // Helper to check if node or any ancestor has overflow hidden/clip
  const isClippedByAncestor = (nodeId: string): boolean => {
    let curr = nodeMap.get(nodeId);
    while (curr) {
      const ov = curr.computed?.overflow || '';
      const ovX = curr.computed?.overflowX || '';
      if (ov === 'hidden' || ov === 'clip' || ovX === 'hidden' || ovX === 'clip') {
        return true;
      }
      if (!curr.parentId) break;
      curr = nodeMap.get(curr.parentId);
    }
    return false;
  };

  // ─── 1. Horizontal Viewport Overflow ──────────────────────────────────────
  for (const node of nodes) {
    if (!node.rect || node.rect.width <= 0 || node.rect.height <= 0) continue;
    // Don't flag root itself or elements clipped by overflow:hidden containers (sliders/carousels)
    if (node.id === 'root' || isClippedByAncestor(node.id)) continue;

    const rightEdge = node.rect.x + node.rect.width;
    if (rightEdge > vpWidth + VIEWPORT_OVERFLOW_TOLERANCE_PX) {
      const overflowPx = Math.round(rightEdge - vpWidth);
      const loc = { pagePath: options.pagePath, nodeId: node.id };
      findings.push({
        id: generateFindingId('performance', 'horizontal-overflow', loc),
        scope: 'performance',
        ruleId: 'horizontal-overflow',
        severity: 'error',
        title: 'Viewport horizontal overflow detected',
        message: `Element #${node.id} overflows viewport right boundary by ${overflowPx}px.`,
        explanation: 'Elements exceeding viewport width cause unintended horizontal scrollbars.',
        remediation: 'Constrain element width with max-width: 100% or adjust layout container.',
        location: loc,
        evidence: {
          elementRight: rightEdge,
          viewportWidth: vpWidth,
          overflowPx,
        },
        canAutoFix: false,
      });
    }
  }

  // ─── 2. Clipped Content (overflow: hidden clipping children) ──────────────
  for (const node of nodes) {
    if (node.computed.overflow === 'hidden' && node.rect) {
      for (const childId of node.children) {
        const child = nodeMap.get(childId);
        if (!child || !child.rect) continue;

        const clippedRight = child.rect.x + child.rect.width > node.rect.x + node.rect.width + 4;
        const clippedBottom = child.rect.y + child.rect.height > node.rect.y + node.rect.height + 4;

        if (clippedRight || clippedBottom) {
          // If child has text, this is actionable clipping
          const hasText = Boolean(child.text && child.text.trim().length > 0);
          if (hasText) {
            const loc = { pagePath: options.pagePath, nodeId: child.id };
            findings.push({
              id: generateFindingId('performance', 'clipped-content', loc),
              scope: 'performance',
              ruleId: 'clipped-content',
              severity: 'warning',
              title: 'Container clipping text or interactive controls',
              message: `Child #${child.id} text is clipped by container #${node.id} with overflow: hidden.`,
              explanation: 'Text or controls clipped by parent containers become unreadable or inaccessible.',
              remediation: 'Expand container dimensions, add padding, or adjust text wrapping.',
              location: loc,
              evidence: {
                parentContainerId: node.id,
                childId: child.id,
              },
              canAutoFix: false,
            });
            break; // report once per parent container
          }
        }
      }
    }
  }

  // ─── 3. Media: Oversized Images, Below-Fold Eager, LCP Priority ───────────
  if (options.imagesMeta && options.imagesMeta.length > 0) {
    let largestAboveFoldArea = 0;
    let lcpCandidate: (typeof options.imagesMeta)[0] | null = null;
    let lcpNode: AuditNode | null = null;

    for (const img of options.imagesMeta) {
      const node = nodeMap.get(img.nodeId);
      if (!node || !node.rect) continue;

      const renderedW = node.rect.width;
      const renderedH = node.rect.height;
      const area = renderedW * renderedH;

      // Oversized image check
      if (renderedW > 0 && img.naturalWidth > renderedW * 2.5) {
        const loc = { pagePath: options.pagePath, nodeId: img.nodeId, tag: 'img' };
        findings.push({
          id: generateFindingId('performance', 'oversized-image', loc),
          scope: 'performance',
          ruleId: 'oversized-image',
          severity: 'warning',
          title: 'Image asset significantly oversized',
          message: `Image natural width (${img.naturalWidth}px) exceeds rendered width (${Math.round(renderedW)}px) by ${(img.naturalWidth / renderedW).toFixed(1)}x.`,
          explanation: 'Serving oversized images wastes client bandwidth and slows page render.',
          remediation: 'Resize image file or provide responsive srcSet sizes matching display dimensions.',
          location: loc,
          evidence: {
            naturalWidth: img.naturalWidth,
            renderedWidth: Math.round(renderedW),
            ratio: Number((img.naturalWidth / renderedW).toFixed(2)),
          },
          canAutoFix: false,
        });
      }

      // Check fold position
      const isBelowFold = node.rect.y > vpHeight;
      if (isBelowFold) {
        // Rule: eager-below-fold-image
        if (img.loading !== 'lazy') {
          const loc = { pagePath: options.pagePath, nodeId: img.nodeId, tag: 'img', propName: 'loading' };
          findings.push({
            id: generateFindingId('performance', 'eager-below-fold-image', loc),
            scope: 'performance',
            ruleId: 'eager-below-fold-image',
            severity: 'warning',
            title: 'Below-the-fold image loaded eagerly',
            message: `Image #${img.nodeId} is below viewport fold (${Math.round(node.rect.y)}px) but lacks loading="lazy".`,
            explanation: 'Images outside initial viewport should be lazily loaded to preserve initial bandwidth.',
            remediation: 'Add loading="lazy" to the image element.',
            location: loc,
            canAutoFix: true,
            suggestedFix: {
              type: 'set-attribute',
              description: 'Add loading="lazy"',
              patch: { loading: 'lazy' },
            },
          });
        }
      } else {
        // Above fold: track for LCP candidate
        if (area > largestAboveFoldArea && area >= 80000) {
          largestAboveFoldArea = area;
          lcpCandidate = img;
          lcpNode = node;
        }
      }
    }

    // Rule: missing-lcp-priority on hero LCP image
    if (lcpCandidate && lcpNode) {
      const isLazy = lcpCandidate.loading === 'lazy';
      const hasPriority = lcpCandidate.priority === true || lcpCandidate.fetchPriority === 'high';

      if (isLazy || !hasPriority) {
        const loc = { pagePath: options.pagePath, nodeId: lcpCandidate.nodeId, tag: 'img', propName: 'priority' };
        findings.push({
          id: generateFindingId('performance', 'missing-lcp-priority', loc),
          scope: 'performance',
          ruleId: 'missing-lcp-priority',
          severity: 'warning',
          title: 'Hero LCP image lacks high fetch priority',
          message: `Hero LCP image #${lcpCandidate.nodeId} (${Math.round(lcpNode.rect?.width || 0)}x${Math.round(lcpNode.rect?.height || 0)}px) is lazy or lacks fetch priority.`,
          explanation: 'The Largest Contentful Paint hero image must be fetched immediately to optimize Core Web Vitals.',
          remediation: 'Add priority or fetchpriority="high" and remove loading="lazy".',
          location: loc,
          evidence: {
            area: largestAboveFoldArea,
            isLazy,
          },
          canAutoFix: true,
          suggestedFix: {
            type: 'set-attribute',
            description: 'Add priority attribute',
            patch: { priority: 'true', loading: '' },
          },
        });
      }
    }
  }

  return findings;
}
