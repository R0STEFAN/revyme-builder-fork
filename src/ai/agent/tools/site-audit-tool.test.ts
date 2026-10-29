// src/ai/agent/tools/site-audit-tool.test.ts
import { describe, it, expect } from 'vitest';
import { defaultRegistry } from '@revyme/automation-core';
import { siteAuditTool } from './site-audit-tool';

describe('Site Audit MCP & Agent Tooling', () => {
  it('registers site.audit operation and aliases in automation-core defaultRegistry', () => {
    const op = defaultRegistry.get('site.audit');
    expect(op).toBeDefined();
    expect(op?.name).toBe('site.audit');

    const aliasOp = defaultRegistry.get('site_audit');
    expect(aliasOp).toBeDefined();
    expect(aliasOp?.name).toBe('site.audit');
  });

  it('runs site_audit tool via AI agent tool interface', async () => {
    const res = await siteAuditTool.execute(
      {
        mode: 'static',
        scopes: ['accessibility', 'seo'],
      },
      {} as any
    );

    expect(res.isError).toBeFalsy();
    expect(res.content).toHaveLength(1);
    const item = res.content[0];
    if (item.type === 'text') {
      const parsed = JSON.parse(item.text);
      expect(parsed.summary).toBeDefined();
      expect(parsed.findings).toBeInstanceOf(Array);
    } else {
      throw new Error('Expected text content block');
    }
  });
});
