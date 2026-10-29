// src/code/audit/core/types.ts
// Zod schemas & TypeScript definitions for the Revyme Site Audit System.

import { z } from 'zod';

export const AuditScope = z.enum([
  'accessibility',
  'seo',
  'performance',
  'security',
  'clean-code',
]);
export type AuditScope = z.infer<typeof AuditScope>;

export const AuditSeverity = z.enum(['error', 'warning', 'info']);
export type AuditSeverity = z.infer<typeof AuditSeverity>;

export const AuditLocation = z.object({
  pagePath: z.string(),
  route: z.string().optional(),        // Clean URL route (e.g. / or /blog)
  nodeId: z.string().optional(),       // data-id in Revyme JSX / Canvas
  tag: z.string().optional(),
  propName: z.string().optional(),
  selector: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
});
export type AuditLocation = z.infer<typeof AuditLocation>;

export const AuditFinding = z.object({
  id: z.string(),                      // Unique key: ${scope}/${ruleId}/${locationIdentity}
  scope: AuditScope,
  ruleId: z.string(),
  severity: AuditSeverity,
  title: z.string(),
  message: z.string(),
  explanation: z.string(),
  remediation: z.string(),             // Actionable instruction for human or AI agent
  location: AuditLocation,
  evidence: z.record(z.string(), z.unknown()).optional(),
  documentationUrl: z.string().url().optional(),
  canAutoFix: z.boolean().default(false),
  suggestedFix: z.object({
    type: z.string(),
    description: z.string(),
    patch: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
});
export type AuditFinding = z.infer<typeof AuditFinding>;

export const AuditScores = z.object({
  accessibility: z.number().min(0).max(100),
  seo: z.number().min(0).max(100),
  performance: z.number().min(0).max(100),
  bestPractices: z.number().min(0).max(100),
});
export type AuditScores = z.infer<typeof AuditScores>;

export const AuditSummary = z.object({
  total: z.number(),
  bySeverity: z.record(AuditSeverity, z.number()),
  byScope: z.record(AuditScope, z.number()),
  scores: AuditScores.optional(),
});
export type AuditSummary = z.infer<typeof AuditSummary>;

export const SkippedAuditCheck = z.object({
  ruleId: z.string(),
  reason: z.enum(['dynamic-expression', 'unsupported-component', 'missing-context']),
  location: AuditLocation,
});
export type SkippedAuditCheck = z.infer<typeof SkippedAuditCheck>;

export const AuditResult = z.object({
  summary: AuditSummary,
  findings: z.array(AuditFinding),
  skippedChecks: z.array(SkippedAuditCheck),
  remediatedFindings: z.array(AuditFinding).optional(),
});
export type AuditResult = z.infer<typeof AuditResult>;

export const AuditMode = z.enum(['static', 'rendered', 'full-production']);
export type AuditMode = z.infer<typeof AuditMode>;

export interface RunAuditOptions {
  pagePath?: string;
  scopes?: AuditScope[];
  mode?: AuditMode;
  autoFix?: boolean;
  fileMap?: Record<string, string>;
  baseUrl?: string;
}
