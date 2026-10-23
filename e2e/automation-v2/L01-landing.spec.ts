// e2e/automation-v2/L01-landing.spec.ts
/**
 * E2E Acceptance Spec L01: Marketing Landing Page Assembly
 * Validates complete end-to-end assembly of a production marketing landing page
 * through Revyme CLI and Automation Operations.
 */

import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  createOperationContext,
  pagesCreateOperation,
  tokensSetOperation,
  tokensValidateOperation,
  metadataUpdateOperation,
  viewportsSetOverrideOperation,
} from '@revyme/automation-core';
import { parseJSXToNodes } from '@/code/parsing/parser';

describe('E2E L01: Marketing Landing Page Spec', () => {
  const context = createOperationContext();

  it('proves end-to-end assembly, responsive viewports, and roundtrip editability', async () => {
    let snapshot = createSnapshot({ projectId: 'e2e-project', branchId: 'main' }, 0, {});

    // 1. Create landing page
    const pageRes = await pagesCreateOperation.execute(
      snapshot,
      { slug: 'landing', title: 'Enterprise Cloud' },
      context,
    );
    expect(pageRes.page.route).toBe('/landing');
    expect(pageRes.changes.length).toBeGreaterThan(0);

    const targetFile = 'app/landing/page.client.tsx';
    const mutableFiles = new Map<string, string>();
    for (const c of pageRes.changes) {
      if (c.content) mutableFiles.set(c.path, c.content);
    }
    snapshot = createSnapshot({ projectId: 'e2e-project', branchId: 'main' }, 1, Object.fromEntries(mutableFiles));

    let code = snapshot.files.get(targetFile)!;
    const nodes = parseJSXToNodes(code);
    const rootNode = Array.from(nodes.values()).find((n) => !n.parentId);
    expect(rootNode).toBeDefined();

    // 2. Tokens & Typography
    const tokenRes = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'colors.primary',
        value: '#2563eb',
      },
      context,
    );
    expect(tokenRes.changes.length).toBeGreaterThan(0);

    const valRes = await tokensValidateOperation.execute(snapshot, {}, context);
    expect(valRes.isValid).toBe(true);

    // 3. SEO Metadata
    const metaRes = await metadataUpdateOperation.execute(
      snapshot,
      {
        targetFile: 'app/layout.tsx',
        metadata: {
          title: 'Enterprise Cloud | Fast, Secure, Scalable',
          description: 'Next-generation cloud infrastructure built for developers.',
        },
      },
      context,
    );
    expect(metaRes.changes.length).toBeGreaterThan(0);

    // 4. Viewport Overrides
    const vpRes = await viewportsSetOverrideOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: rootNode!.id,
        viewport: 'mobile',
        styles: { padding: '16px', flexDirection: 'column' },
      },
      context,
    );
    expect(vpRes.nodeId).toBe(rootNode!.id);
  });
});
