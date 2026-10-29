// packages/automation-core/src/operations/site-audit.ts
// Comprehensive site audit operation registered with automation-core and MCP.

import { z } from 'zod';
import type { Operation, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  AuditScope,
  AuditMode,
} from '@/code/audit/core/types';
import { executeAuditTool, auditToolInputSchema } from '@/code/audit/mcp/audit-tool';

function snapshotToFiles(snapshot: Snapshot): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [p, c] of snapshot.files.entries()) {
    files[p] = c;
  }
  return files;
}

export const siteAuditOperation: Operation<z.infer<typeof auditToolInputSchema>, any> = {
  name: 'site.audit',
  description:
    'Comprehensive end-to-end site audit for accessibility (WCAG 2.2 AA), SEO, performance (Core Web Vitals), clean code, and security with autonomous self-healing.',
  category: 'diagnostics',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: auditToolInputSchema,
  async execute(snapshot: Snapshot, input: z.infer<typeof auditToolInputSchema>, _context: OperationContext) {
    const files = snapshotToFiles(snapshot);

    const result = await executeAuditTool(input, {
      fileMap: files,
    });

    return result;
  },
};

// ─── Registration & Aliases ──────────────────────────────────────────────────
defaultRegistry.register(siteAuditOperation);

defaultRegistry.registerAlias('audit.site', 'site.audit');
defaultRegistry.registerAlias('site_audit', 'site.audit');
defaultRegistry.registerAlias('audit', 'site.audit');
defaultRegistry.registerAlias('site.health', 'site.audit');
