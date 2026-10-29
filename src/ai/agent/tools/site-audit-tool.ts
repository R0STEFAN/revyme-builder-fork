// src/ai/agent/tools/site-audit-tool.ts
// AI Agent tool for executing end-to-end site audits with auto-healing.

import type { AgentTool, AgentToolResult } from '@/ai/agent';
import { projectFS } from '@/code/project/project-fs';
import { modifyProjectFile } from '@/code/project/modify-file';
import {
  executeAuditTool,
  auditToolInputSchema,
  auditToolDefinition,
} from '@/code/audit/mcp/audit-tool';

function ok(data: unknown): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

function collectProjectFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) files[path] = content;
  }
  return files;
}

export const siteAuditTool: AgentTool = {
  name: 'site_audit',
  description: auditToolDefinition.description,
  inputSchema: auditToolInputSchema.shape,
  category: 'read',
  execute: async (args, _ctx) => {
    try {
      const files = collectProjectFiles();
      const result = await executeAuditTool(args as any, {
        fileMap: files,
        modifyProjectFile,
      });
      return ok(result);
    } catch (err: any) {
      return fail(err?.message || 'Failed to execute site audit');
    }
  },
};
