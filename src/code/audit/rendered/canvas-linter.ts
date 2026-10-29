// src/code/audit/rendered/canvas-linter.ts
// Primary entry point for in-canvas rendered DOM and bridge cache inspection (< 30ms).

import type { AuditFinding, AuditResult, AuditScope, RunAuditOptions } from '../core/types';
import { normalizeFindings, calculateAuditSummary } from '../core/normalizer';
import { auditTextContrast } from './contrast-engine';
import { auditGeometry, type GeometryLinterOptions } from './geometry-linter';
import {
  type AuditNode,
  auditOverlaps,
  collectLayoutSnapshot,
} from '@/ai/agent/tools/design-audit';
import type { CanvasNode } from '@/code/parsing/parser';
import { trace } from '@/shared/debug-trace';

export interface RenderedAuditParams extends RunAuditOptions {
  nodes?: AuditNode[];
  canvasNodes?: Map<string, CanvasNode>;
  viewportWidth?: number;
  viewportHeight?: number;
  vpId?: string;
  imagesMeta?: GeometryLinterOptions['imagesMeta'];
}

export async function runRenderedAudit(
  params: RenderedAuditParams
): Promise<AuditResult> {
  trace.fn('runRenderedAudit', { pagePath: params.pagePath });

  let auditNodes: AuditNode[] = [];

  if (params.nodes && params.nodes.length > 0) {
    auditNodes = params.nodes;
  } else if (params.canvasNodes && params.canvasNodes.size > 0) {
    const vpId = params.vpId || 'desktop';
    auditNodes = collectLayoutSnapshot(params.canvasNodes, vpId);
  }

  const rawFindings: AuditFinding[] = [];
  const scopesSet = params.scopes ? new Set<AuditScope>(params.scopes) : null;
  const shouldInclude = (s: AuditScope) => !scopesSet || scopesSet.has(s);
  const pagePath = params.pagePath || 'canvas/current';

  // 1. Accessibility Contrast (Tier 2 WCAG 2.2)
  if (shouldInclude('accessibility') && auditNodes.length > 0) {
    const contrastFindings = auditTextContrast(auditNodes, { pagePath });
    rawFindings.push(...contrastFindings);
  }

  // 2. Geometry & Performance (Overflow, Clipping, Oversized images, LCP)
  if (shouldInclude('performance') && auditNodes.length > 0) {
    const geomFindings = auditGeometry(auditNodes, {
      pagePath,
      viewportWidth: params.viewportWidth || 1200,
      viewportHeight: params.viewportHeight || 800,
      imagesMeta: params.imagesMeta,
    });
    rawFindings.push(...geomFindings);
  }

  const normalized = normalizeFindings(rawFindings);
  const summary = calculateAuditSummary(normalized);

  return {
    summary,
    findings: normalized,
    skippedChecks: [],
  };
}
