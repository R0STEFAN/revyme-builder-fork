// src/code/audit/mcp/audit-tool.ts
// MCP Tool (site.audit) definition and autonomous self-healing execution handler.

import { z } from 'zod';
import {
  AuditScope,
  AuditMode,
  type AuditFinding,
  type AuditResult,
  type RunAuditOptions,
} from '../core/types';
import { runStaticAudit } from '../static/static-runner';
import { runRenderedAudit } from '../rendered/canvas-linter';
import { runProductionAudit } from '../production/prod-runner';
import { applyAutoFixesToProject } from '../remediation/auto-fixer';
import { normalizeFindings, calculateAuditSummary } from '../core/normalizer';
import { trace } from '@/shared/debug-trace';

export const auditToolInputSchema = z.object({
  pagePath: z
    .string()
    .optional()
    .describe('Target route (e.g. / or /pricing). Defaults to entire project.'),
  scopes: z
    .array(AuditScope)
    .optional()
    .describe('Audit scopes to include. Defaults to all standard scopes.'),
  mode: AuditMode
    .default('rendered')
    .describe(
      "Audit depth: 'static' (fast AST, <20ms), 'rendered' (in-canvas DOM, <50ms), or 'full-production' (Next.js server + Lighthouse, ~5s)."
    ),
  autoFix: z
    .boolean()
    .default(false)
    .describe('If true, automatically applies safe codegen patches for all fixable findings.'),
  baseUrl: z
    .string()
    .optional()
    .describe('Production server base URL for full-production mode (e.g. http://127.0.0.1:3000).'),
});

export type AuditToolInput = z.input<typeof auditToolInputSchema>;

export const auditToolDefinition = {
  name: 'site.audit',
  description:
    'Runs an end-to-end audit for accessibility (WCAG 2.2 AA), SEO, performance (Core Web Vitals), clean code, and security. Supports static AST inspection, in-canvas runtime analysis, and full production build verification with optional autonomous self-healing.',
  inputSchema: {
    type: 'object',
    properties: {
      pagePath: {
        type: 'string',
        description: 'Target route (e.g. / or /pricing). Defaults to entire project.',
      },
      scopes: {
        type: 'array',
        items: { enum: ['accessibility', 'seo', 'performance', 'security', 'clean-code'] },
        description: 'Audit scopes to include. Defaults to all standard scopes.',
      },
      mode: {
        type: 'string',
        enum: ['static', 'rendered', 'full-production'],
        default: 'rendered',
        description:
          "Audit depth: 'static' (fast AST, <20ms), 'rendered' (in-canvas DOM, <50ms), or 'full-production' (Next.js server + Lighthouse, ~5s).",
      },
      autoFix: {
        type: 'boolean',
        default: false,
        description: 'If true, automatically applies safe codegen patches for all fixable findings.',
      },
      baseUrl: {
        type: 'string',
        description: 'Base URL for production server verification.',
      },
    },
  },
};

export interface AuditToolContext {
  fileMap?: Record<string, string>;
  modifyProjectFile?: (path: string, transform: (code: string) => string) => any;
  canvasNodes?: Map<string, any>;
  viewportWidth?: number;
  viewportHeight?: number;
  vpId?: string;
  baseUrl?: string;
}

/**
 * Execute site.audit tool call.
 */
export async function executeAuditTool(
  input: AuditToolInput,
  context: AuditToolContext = {}
): Promise<AuditResult & { remediated?: AuditFinding[]; updatedFiles?: Record<string, string> }> {
  const parsed = auditToolInputSchema.parse(input);
  trace.fn('executeAuditTool', { mode: parsed.mode, pagePath: parsed.pagePath, autoFix: parsed.autoFix });

  const runOpts: RunAuditOptions = {
    pagePath: parsed.pagePath,
    scopes: parsed.scopes,
    mode: parsed.mode,
    fileMap: context.fileMap || {},
    baseUrl: parsed.baseUrl || context.baseUrl,
  };

  const combinedFindings: AuditFinding[] = [];
  const skippedChecks: any[] = [];

  // 1. Tier 1: Static AST
  const staticRes = await runStaticAudit(runOpts);
  combinedFindings.push(...staticRes.findings);
  skippedChecks.push(...staticRes.skippedChecks);

  // 2. Tier 2: Rendered in-canvas (if mode is rendered or full-production)
  if (parsed.mode === 'rendered' || parsed.mode === 'full-production') {
    const renderedRes = await runRenderedAudit({
      ...runOpts,
      canvasNodes: context.canvasNodes,
      viewportWidth: context.viewportWidth,
      viewportHeight: context.viewportHeight,
      vpId: context.vpId,
    });
    combinedFindings.push(...renderedRes.findings);
    skippedChecks.push(...renderedRes.skippedChecks);
  }

  // 3. Tier 3: Full Production (if mode is full-production)
  let lighthouseScores: any = undefined;
  if (parsed.mode === 'full-production') {
    const prodRes = await runProductionAudit({
      ...runOpts,
      baseUrl: parsed.baseUrl || context.baseUrl || 'http://localhost:3000',
      runLighthouse: true,
    });
    combinedFindings.push(...prodRes.findings);
    lighthouseScores = prodRes.lighthouseScores;
  }

  let finalFindings = normalizeFindings(combinedFindings);
  let remediatedFindings: AuditFinding[] = [];
  let updatedFiles: Record<string, string> | undefined = undefined;

  // 4. Autonomous Self-Healing / AutoFix
  if (parsed.autoFix && context.fileMap) {
    const fixResult = applyAutoFixesToProject(
      context.fileMap,
      finalFindings,
      context.modifyProjectFile
    );
    remediatedFindings = fixResult.remediated;
    updatedFiles = fixResult.files;

    if (remediatedFindings.length > 0) {
      // Re-run static audit to confirm fixes and report updated score
      const reAudit = await runStaticAudit({
        ...runOpts,
        fileMap: updatedFiles,
      });
      finalFindings = normalizeFindings(reAudit.findings);
    }
  }

  const finalSummary = calculateAuditSummary(finalFindings, lighthouseScores);

  return {
    summary: finalSummary,
    findings: finalFindings,
    skippedChecks,
    remediated: remediatedFindings,
    updatedFiles,
  };
}
