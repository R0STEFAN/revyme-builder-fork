// packages/automation-core/test/capabilities/T23-challenger2.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import '../../src/index';

import {
  publishPreflightOperation,
  publishDeployOperation,
  publishStatusOperation,
  detectRedirectCycles,
  loadDeployments,
  calculateSnapshotHash,
  DEPLOYMENTS_STORAGE_PATH,
} from '../../src/operations/publish';
import { REDIRECTS_FILE } from '../../src/operations/redirects';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const CLEAN_LAYOUT = `import React from 'react';

export const metadata = {
  title: 'Adversarial Challenger Test Site',
  description: 'Robustly verified deployment preflight site',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const CLEAN_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', height: 'auto', padding: '24px' }}>
      <h1 data-id="title">Clean Home Page</h1>
      <p data-id="desc">Preflight ready</p>
    </div>
  );
}
`;

function createAdversarialSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'adversarial-project', branchId: 'main' }, revision, files);
}

describe('T23 Empirical Challenger: Preflight & Deploy Lifecycle Hardening', () => {
  const mockHostingAdapter = {
    deploy: vi.fn(async (args: any) => ({
      success: true,
      deploymentId: `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      url: `https://${args.projectId}.${(args.target || args.targetEnvironment) === 'production' ? 'revyme.app' : 'staging.revyme.app'}`,
      status: 'deployed' as const,
      timestamp: new Date().toISOString(),
      targetEnvironment: args.targetEnvironment || args.target,
      target: args.target || args.targetEnvironment,
      revision: args.revision,
      commitHash: calculateSnapshotHash(args.snapshot.files),
    })),
  };

  const context = createOperationContext({
    adapters: {
      hosting: mockHostingAdapter,
    },
  });

  beforeEach(() => {
    projectFS.loadSnapshot(
      new Map([
        ['app/layout.tsx', CLEAN_LAYOUT],
        ['app/page.client.tsx', CLEAN_PAGE],
      ]),
    );
    projectFS.switchBranch(MAIN_BRANCH_ID);
  });

  // ===========================================================================
  // 1. Redirect Loop Stress-Testing
  // ===========================================================================
  describe('1. Complex Redirect Loop Detection', () => {
    it('detects a 3-hop cycle (A -> B -> C -> A) and isolates the cycle correctly', () => {
      const redirects = [
        { from: '/alpha', to: '/beta' },
        { from: '/beta', to: '/gamma' },
        { from: '/gamma', to: '/alpha' },
      ];
      const cycles = detectRedirectCycles(redirects);
      expect(cycles.length).toBe(1);
      expect(cycles[0]).toEqual(['/alpha', '/beta', '/gamma', '/alpha']);
    });

    it('detects self-loops (A -> A) via detectRedirectCycles and preflight check', async () => {
      const redirects = [{ from: '/self', to: '/self' }];
      const cycles = detectRedirectCycles(redirects);
      expect(cycles.length).toBe(1);
      expect(cycles[0]).toEqual(['/self', '/self']);

      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
        [REDIRECTS_FILE]: JSON.stringify(redirects),
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const selfLoopCheck = res.checks.find((c) => c.name.includes('redirects.self_loop'));
      expect(selfLoopCheck).toBeDefined();
      expect(selfLoopCheck?.status).toBe('fail');
      expect(selfLoopCheck?.message).toMatch(/self-redirect loop/i);
    });

    it('passes linear non-cyclic redirect chains (A -> B -> C -> D)', async () => {
      const redirects = [
        { from: '/step1', to: '/step2' },
        { from: '/step2', to: '/step3' },
        { from: '/step3', to: '/final' },
      ];
      const cycles = detectRedirectCycles(redirects);
      expect(cycles).toEqual([]);

      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
        [REDIRECTS_FILE]: JSON.stringify(redirects),
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      const redirectCheck = res.checks.find((c) => c.category === 'redirects');
      expect(redirectCheck?.status).toBe('pass');
      expect(redirectCheck?.message).toContain('3 redirects validated with zero circular loops');
    });

    it('detects multiple disconnected cycles in the same ruleset', () => {
      const redirects = [
        { from: '/cycle1-a', to: '/cycle1-b' },
        { from: '/cycle1-b', to: '/cycle1-a' },
        { from: '/linear-1', to: '/linear-2' },
        { from: '/cycle2-x', to: '/cycle2-y' },
        { from: '/cycle2-y', to: '/cycle2-z' },
        { from: '/cycle2-z', to: '/cycle2-x' },
      ];
      const cycles = detectRedirectCycles(redirects);
      expect(cycles.length).toBe(2);
      expect(cycles[0]).toEqual(['/cycle1-a', '/cycle1-b', '/cycle1-a']);
      expect(cycles[1]).toEqual(['/cycle2-x', '/cycle2-y', '/cycle2-z', '/cycle2-x']);
    });

    it('detects cycles when an entry path feeds into a loop (D -> B, A -> B -> C -> A)', () => {
      const redirects = [
        { from: '/entry', to: '/b' },
        { from: '/a', to: '/b' },
        { from: '/b', to: '/c' },
        { from: '/c', to: '/a' },
      ];
      const cycles = detectRedirectCycles(redirects);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      // The cycle itself must be extracted cleanly without prefix
      const mainCycle = cycles.find((c) => c.includes('/b') && c.includes('/c') && c.includes('/a'));
      expect(mainCycle).toBeDefined();
      expect(mainCycle?.[0]).toBe(mainCycle?.[mainCycle.length - 1]);
    });

    it('handles tree / converging redirects without false positives (A -> B, C -> B, B -> D)', () => {
      const redirects = [
        { from: '/old-a', to: '/hub' },
        { from: '/old-c', to: '/hub' },
        { from: '/hub', to: '/target' },
      ];
      const cycles = detectRedirectCycles(redirects);
      expect(cycles).toEqual([]);
    });

    it('trims whitespace and handles dirty strings in redirect rules', async () => {
      const redirects = [
        { from: ' /whitespace-loop  ', to: '\n/whitespace-loop\t' },
      ];
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
        [REDIRECTS_FILE]: JSON.stringify(redirects),
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const loopCheck = res.checks.find((c) => c.category === 'redirects' && c.status === 'fail');
      expect(loopCheck).toBeDefined();
    });

    it('flags unparseable malformed redirects JSON cleanly', async () => {
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
        [REDIRECTS_FILE]: 'NOT_VALID_JSON{:::broken',
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const syntaxCheck = res.checks.find((c) => c.name === 'redirects.syntax');
      expect(syntaxCheck).toBeDefined();
      expect(syntaxCheck?.status).toBe('fail');
    });

    it('handles non-array JSON and filters invalid redirect entries without throwing', async () => {
      const nonArraySnapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
        [REDIRECTS_FILE]: JSON.stringify({ notAnArray: true }),
      });

      const resNonArray = await publishPreflightOperation.execute(nonArraySnapshot, {}, context);
      expect(resNonArray.passed).toBe(false);
      const syntaxCheck = resNonArray.checks.find((c) => c.name === 'redirects.syntax');
      expect(syntaxCheck).toBeDefined();
      expect(syntaxCheck?.status).toBe('fail');

      const mixedEntriesSnapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
        [REDIRECTS_FILE]: JSON.stringify([
          null,
          123,
          'invalid-string',
          { from: 456, to: '/target' },
          { from: '/valid-from', to: '/valid-to' },
        ]),
      });

      const resMixed = await publishPreflightOperation.execute(mixedEntriesSnapshot, {}, context);
      const cyclesCheck = resMixed.checks.find((c) => c.name === 'redirects.cycles');
      expect(cyclesCheck?.status).toBe('pass');
      expect(cyclesCheck?.message).toContain('All 1 redirects validated');
    });
  });

  // ===========================================================================
  // 2. Broken Forms Stress-Testing
  // ===========================================================================
  describe('2. Broken & Valid Forms Validation', () => {
    it('flags bare <form> element missing both data-form and action', async () => {
      const BARE_FORM_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function FormTest() {
  return (
    <div data-id="root">
      <form data-id="bare-form" className="form-box">
        <input data-id="inp" type="text" name="username" />
        <button data-id="btn" type="submit">Submit</button>
      </form>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': BARE_FORM_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const bareCheck = res.checks.find((c) => c.name.includes('forms.bare_form'));
      expect(bareCheck).toBeDefined();
      expect(bareCheck?.status).toBe('fail');
      expect(bareCheck?.message).toMatch(/neither a data-form configuration nor an action/i);
    });

    it('flags data-form with empty sendTo array', async () => {
      const EMPTY_SENDTO_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function FormTest() {
  return (
    <div data-id="root">
      <form data-id="f1" data-form='{"sendTo":[]}'>
        <button data-id="btn" type="submit">Go</button>
      </form>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': EMPTY_SENDTO_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const unconfCheck = res.checks.find((c) => c.name.includes('forms.unconfigured'));
      expect(unconfCheck).toBeDefined();
      expect(unconfCheck?.status).toBe('fail');
    });

    it('flags email destination with missing or whitespace-only recipient', async () => {
      const WHITESPACE_EMAIL_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function FormTest() {
  return (
    <div data-id="root">
      <form data-id="f1" data-form='{"sendTo":[{"type":"email","recipient":"   "}]}'>
        <button data-id="btn" type="submit">Go</button>
      </form>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': WHITESPACE_EMAIL_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const emailCheck = res.checks.find((c) => c.name.includes('forms.destination_missing_email'));
      expect(emailCheck).toBeDefined();
      expect(emailCheck?.status).toBe('fail');
      expect(emailCheck?.message).toMatch(/missing recipient address/i);
    });

    it('flags webhook destination with missing or whitespace-only URL', async () => {
      const WHITESPACE_WEBHOOK_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function FormTest() {
  return (
    <div data-id="root">
      <form data-id="f1" data-form='{"sendTo":[{"type":"webhook","url":""}]}'>
        <button data-id="btn" type="submit">Go</button>
      </form>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': WHITESPACE_WEBHOOK_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const hookCheck = res.checks.find((c) => c.name.includes('forms.destination_missing_webhook'));
      expect(hookCheck).toBeDefined();
      expect(hookCheck?.status).toBe('fail');
      expect(hookCheck?.message).toMatch(/missing target URL/i);
    });

    it('passes forms with valid action URL, email destination, or webhook destination', async () => {
      const VALID_FORMS_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function MultiForms() {
  return (
    <div data-id="root">
      <form data-id="form-action" action="https://api.example.com/submit">
        <input data-id="i1" name="q" />
      </form>
      <form data-id="form-email" data-form='{"sendTo":[{"type":"email","recipient":"lead@revyme.com"}]}'>
        <input data-id="i2" name="email" />
      </form>
      <form data-id="form-webhook" data-form='{"sendTo":[{"type":"webhook","url":"https://api.revyme.com/webhooks/form-1"}]}'>
        <input data-id="i3" name="notes" />
      </form>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': VALID_FORMS_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      const formCheck = res.checks.find((c) => c.name === 'forms.destinations');
      expect(formCheck?.status).toBe('pass');
      expect(formCheck?.message).toContain('All 2 forms have valid destinations configured');
    });

    it('identifies partial failures when one form is valid and one is broken', async () => {
      const MIXED_FORMS_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function Mixed() {
  return (
    <div data-id="root">
      <form data-id="f-good" data-form='{"sendTo":[{"type":"email","recipient":"team@revyme.com"}]}'>
        <input data-id="i1" name="email" />
      </form>
      <form data-id="f-bad" data-form='{"sendTo":[{"type":"webhook","url":""}]}'>
        <input data-id="i2" name="name" />
      </form>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': MIXED_FORMS_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const failedForms = res.checks.filter((c) => c.category === 'forms' && c.status === 'fail');
      expect(failedForms.length).toBe(1);
      expect(failedForms[0].name).toContain('forms.destination_missing_webhook');
    });
  });

  // ===========================================================================
  // 3. Layout Metadata & SEO Stress-Testing
  // ===========================================================================
  describe('3. Missing Layout Metadata & Empty Strings', () => {
    it('fails preflight fatally when app/layout.tsx is missing', async () => {
      const snapshot = createAdversarialSnapshot({
        'app/page.client.tsx': CLEAN_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, {}, context);
      expect(res.passed).toBe(false);
      const layoutCheck = res.checks.find((c) => c.name === 'seo.root_layout');
      expect(layoutCheck).toBeDefined();
      expect(layoutCheck?.status).toBe('fail');
      expect(layoutCheck?.message).toContain('Root layout "app/layout.tsx" is missing');
    });

    it('treats empty string title as warn in standard mode, fail in strict mode', async () => {
      const EMPTY_TITLE_LAYOUT = `import React from 'react';
export const metadata = {
  title: '',
  description: 'Valid description here',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': EMPTY_TITLE_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
      });

      // Standard mode -> warn, overall passed: true
      const standardRes = await publishPreflightOperation.execute(snapshot, { strict: false }, context);
      const standardTitleCheck = standardRes.checks.find((c) => c.name === 'seo.title');
      expect(standardTitleCheck?.status).toBe('warn');
      expect(standardRes.passed).toBe(true);

      // Strict mode -> fail, overall passed: false
      const strictRes = await publishPreflightOperation.execute(snapshot, { strict: true }, context);
      const strictTitleCheck = strictRes.checks.find((c) => c.name === 'seo.title');
      expect(strictTitleCheck?.status).toBe('fail');
      expect(strictRes.passed).toBe(false);
    });

    it('treats whitespace-only title as empty in both modes', async () => {
      const WHITESPACE_TITLE_LAYOUT = `import React from 'react';
export const metadata = {
  title: '   \t  \n ',
  description: 'Valid description here',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': WHITESPACE_TITLE_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
      });

      const strictRes = await publishPreflightOperation.execute(snapshot, { strict: true }, context);
      const titleCheck = strictRes.checks.find((c) => c.name === 'seo.title');
      expect(titleCheck?.status).toBe('fail');
      expect(titleCheck?.message).toMatch(/missing or empty seo title/i);
    });

    it('treats empty string description as warn in standard mode, fail in strict mode', async () => {
      const EMPTY_DESC_LAYOUT = `import React from 'react';
export const metadata = {
  title: 'Valid Title Here',
  description: '   ',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': EMPTY_DESC_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
      });

      const standardRes = await publishPreflightOperation.execute(snapshot, { strict: false }, context);
      const standardDescCheck = standardRes.checks.find((c) => c.name === 'seo.description');
      expect(standardDescCheck?.status).toBe('warn');
      expect(standardRes.passed).toBe(true);

      const strictRes = await publishPreflightOperation.execute(snapshot, { strict: true }, context);
      const strictDescCheck = strictRes.checks.find((c) => c.name === 'seo.description');
      expect(strictDescCheck?.status).toBe('fail');
      expect(strictRes.passed).toBe(false);
    });

    it('passes cleanly in strict mode when isolating metadata/seo categories with valid title & description', async () => {
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
      });

      const res = await publishPreflightOperation.execute(
        snapshot,
        { strict: true, categories: ['metadata', 'seo'] },
        context,
      );
      const titleCheck = res.checks.find((c) => c.name === 'seo.title');
      const descCheck = res.checks.find((c) => c.name === 'seo.description');
      expect(titleCheck?.status).toBe('pass');
      expect(descCheck?.status).toBe('pass');
      expect(res.passed).toBe(true);
    });

    it('demonstrates standard mode allows root layout server metadata as non-fatal warnings while strict mode elevates dialect violations', async () => {
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
      });

      // Standard mode: passes with non-fatal Oracle warnings for root layout Next.js conventions
      const standardRes = await publishPreflightOperation.execute(snapshot, { strict: false }, context);
      expect(standardRes.passed).toBe(true);
      const layoutOracleWarn = standardRes.checks.find((c) => c.name === 'oracle.app/layout.tsx');
      expect(layoutOracleWarn?.status).toBe('warn');

      // Strict mode: root layout template dialect warnings become fatal
      const strictRes = await publishPreflightOperation.execute(snapshot, { strict: true }, context);
      expect(strictRes.passed).toBe(false);
      const layoutOracleFail = strictRes.checks.find((c) => c.name === 'oracle.app/layout.tsx');
      expect(layoutOracleFail?.status).toBe('fail');
    });
  });

  // ===========================================================================
  // 4. Fatal Oracle Code vs Non-Fatal Warnings
  // ===========================================================================
  describe('4. Fatal Oracle Code vs Non-Fatal Warnings', () => {
    it('fatally fails preflight on STRING_STYLE_ATTR even in standard non-strict mode', async () => {
      const STRING_STYLE_PAGE = `'use client';
import React from 'react';
export default function BadStyle() {
  return <div data-id="bad" style="color: red; margin: 10px;" />;
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': STRING_STYLE_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, { strict: false }, context);
      expect(res.passed).toBe(false);
      const oracleCheck = res.checks.find((c) => c.name.includes('oracle.app/page.client.tsx'));
      expect(oracleCheck?.status).toBe('fail');
      expect(oracleCheck?.code).toBe('STRING_STYLE_ATTR');
    });

    it('fatally fails preflight on unparseable JSX / SYNTAX_ERROR in non-strict mode', async () => {
      const SYNTAX_ERR_PAGE = `'use client';
export default function BrokenSyntax( {
  return <div data-id="unclosed">Broken
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': SYNTAX_ERR_PAGE,
      });

      const res = await publishPreflightOperation.execute(snapshot, { strict: false }, context);
      expect(res.passed).toBe(false);
      const oracleCheck = res.checks.find((c) => c.name.includes('oracle.app/page.client.tsx'));
      expect(oracleCheck?.status).toBe('fail');
      expect(oracleCheck?.code).toBe('SYNTAX_ERROR');
    });

    it('demotes non-fatal Oracle warnings (e.g. MISSING_DATA_ID) to warn in non-strict mode', async () => {
      // Element missing data-id is a Tier 2 violation, not in fatalCodes
      const MISSING_DATA_ID_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function Tier2WarningPage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1>Unannotated Heading</h1>
    </div>
  );
}
`;
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': MISSING_DATA_ID_PAGE,
      });

      // Standard mode -> warn, passed: true
      const standardRes = await publishPreflightOperation.execute(snapshot, { strict: false }, context);
      const standardOracle = standardRes.checks.find((c) => c.name.includes('oracle.app/page.client.tsx'));
      expect(standardOracle?.status).toBe('warn');
      expect(standardRes.passed).toBe(true);

      // Strict mode -> fail, passed: false
      const strictRes = await publishPreflightOperation.execute(snapshot, { strict: true }, context);
      const strictOracle = strictRes.checks.find((c) => c.name.includes('oracle.app/page.client.tsx'));
      expect(strictOracle?.status).toBe('fail');
      expect(strictRes.passed).toBe(false);
    });
  });

  // ===========================================================================
  // 5. Preflight Gate & Sequential Deployment Lifecycle
  // ===========================================================================
  describe('5. Preflight Enforcement & Sequential Deploy History Append', () => {
    it('blocks deployment when preflight fails unless force: true is explicitly passed', async () => {
      const BROKEN_SNAPSHOT = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': `'use client';
export default function Bad() { return <div data-id="bad" style="color: blue;" />; }`,
      });

      // 1. Without force -> throws and blocks
      await expect(
        publishDeployOperation.execute(BROKEN_SNAPSHOT, { target: 'production' }, context),
      ).rejects.toThrow(/DEPLOY_PREFLIGHT_BLOCKED|PREFLIGHT_FAILED/i);

      // Verify no deployment record was committed to history
      const historyAfterBlock = loadDeployments(BROKEN_SNAPSHOT);
      expect(historyAfterBlock.length).toBe(0);

      // 2. With force: true -> succeeds and records forced flag
      const forcedDeploy = await publishDeployOperation.execute(
        BROKEN_SNAPSHOT,
        { target: 'production', force: true, message: 'Emergency hotfix bypass' },
        context,
      );
      expect(forcedDeploy.status).toBe('deployed');
      expect(forcedDeploy.forced).toBe(true);
      expect(forcedDeploy.preflightPassed).toBe(false);

      const historyAfterForced = loadDeployments(BROKEN_SNAPSHOT);
      expect(historyAfterForced.length).toBe(1);
      expect(historyAfterForced[0].forced).toBe(true);
      expect(historyAfterForced[0].preflightPassed).toBe(false);
    });

    it('appends history sequentially across multiple deploys with valid timestamps, revisions, and hashes', async () => {
      // Setup initial clean project
      const snapshot = createAdversarialSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE,
      }, 1);

      // Deploy 1: Staging (revision 1)
      const expectedHash1 = calculateSnapshotHash(snapshot.files);
      const dep1 = await publishDeployOperation.execute(
        snapshot,
        { targetEnvironment: 'staging', message: 'V1.0 Staging Release' },
        context,
      );
      expect(dep1.status).toBe('deployed');
      expect(dep1.revision).toBe(1);
      expect(dep1.targetEnvironment).toBe('staging');
      expect(dep1.preflightPassed).toBe(true);
      expect(dep1.forced).toBe(false);
      expect(dep1.commitHash).toBe(expectedHash1);

      // Verify 1st deployment in history
      let history = loadDeployments(snapshot);
      expect(history.length).toBe(1);
      expect(history[0].deploymentId).toBe(dep1.deploymentId);
      expect(history[0].revision).toBe(1);
      expect(history[0].targetEnvironment).toBe('staging');
      expect(Number.isNaN(Date.parse(history[0].timestamp))).toBe(false);

      // Deploy 2: Production (revision 2)
      snapshot.revision = 2;
      const expectedHash2 = calculateSnapshotHash(snapshot.files);
      const dep2 = await publishDeployOperation.execute(
        snapshot,
        { target: 'production', message: 'V1.0 Production Promote' },
        context,
      );
      expect(dep2.status).toBe('deployed');
      expect(dep2.revision).toBe(2);
      expect(dep2.target).toBe('production');
      expect(dep2.commitHash).toBe(expectedHash2);

      history = loadDeployments(snapshot);
      expect(history.length).toBe(2);
      expect(history[0].deploymentId).toBe(dep1.deploymentId);
      expect(history[1].deploymentId).toBe(dep2.deploymentId);
      expect(history[1].revision).toBe(2);
      expect(history[1].target).toBe('production');
      expect(history[0].commitHash).toBe(expectedHash1);
      expect(history[1].commitHash).toBe(expectedHash2);

      // Verify timestamps are in chronological order
      const t1 = Date.parse(history[0].timestamp);
      const t2 = Date.parse(history[1].timestamp);
      expect(t2).toBeGreaterThanOrEqual(t1);

      // Deploy 3: Mutate page content, revision 3, deploy to production
      const UPDATED_PAGE = `'use client';
import React from 'react';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */
export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', height: 'auto', padding: '24px' }}>
      <h1 data-id="title">Updated Home Page Content</h1>
      <p data-id="desc">Revision 3 content</p>
    </div>
  );
}
`;
      (snapshot.files as Map<string, string>).set('app/page.client.tsx', UPDATED_PAGE);
      snapshot.revision = 3;

      const expectedHash3 = calculateSnapshotHash(snapshot.files);
      const dep3 = await publishDeployOperation.execute(
        snapshot,
        { target: 'production', message: 'V1.1 Production Update' },
        context,
      );
      expect(dep3.status).toBe('deployed');
      expect(dep3.revision).toBe(3);
      expect(dep3.commitHash).toBe(expectedHash3);

      // Verify all 3 records preserved in storage file
      history = loadDeployments(snapshot);
      expect(history.length).toBe(3);
      expect(history[0].revision).toBe(1);
      expect(history[1].revision).toBe(2);
      expect(history[2].revision).toBe(3);
      expect(history[2].message).toBe('V1.1 Production Update');

      // Verify publish.status returns accurate state
      const statusRes = await publishStatusOperation.execute(snapshot, { limit: 10 }, context);
      expect(statusRes.totalDeployments).toBe(3);
      expect(statusRes.latestDeployment?.deploymentId).toBe(dep3.deploymentId);
      expect(statusRes.latestDeployment?.revision).toBe(3);
      expect(statusRes.latestProduction?.deploymentId).toBe(dep3.deploymentId);
      expect(statusRes.latestProduction?.revision).toBe(3);
      expect(statusRes.latestStaging?.deploymentId).toBe(dep1.deploymentId);
      expect(statusRes.latestStaging?.revision).toBe(1);

      // Verify persistent ProjectFS storage
      const rawStoredJson = projectFS.readFile(DEPLOYMENTS_STORAGE_PATH);
      expect(rawStoredJson).toBeDefined();
      const parsedStored = JSON.parse(rawStoredJson!);
      expect(parsedStored.length).toBe(3);
    });
  });
});
