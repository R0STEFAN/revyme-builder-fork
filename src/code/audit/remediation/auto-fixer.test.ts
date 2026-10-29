// src/code/audit/remediation/auto-fixer.test.ts
import { describe, it, expect } from 'vitest';
import { runStaticAudit } from '../static/static-runner';
import { applyAutoFixesToCode, applyAutoFixesToProject } from './auto-fixer';

describe('Site Audit: Auto-Remediation Engine', () => {
  it('automatically remediates missing-alt, rel-noopener, skipped heading and empty title', async () => {
    const brokenCode = `
      export const metadata = {
        title: '',
        description: '',
      };

      export default function BrokenPage() {
        return (
          <main>
            <h1>Main Title</h1>
            <h3 data-id="h3-node">Skipped to H3</h3>
            <img src="/photo.png" data-id="img-node" />
            <a href="https://external.com" target="_blank" data-id="link-node">Visit</a>
          </main>
        );
      }
    `;

    const initialAudit = await runStaticAudit({
      pagePath: 'app/page.tsx',
      fileMap: { 'app/page.tsx': brokenCode },
    });

    expect(initialAudit.findings.length).toBeGreaterThan(0);

    const fixResult = applyAutoFixesToCode(brokenCode, initialAudit.findings);
    expect(fixResult.remediated.length).toBeGreaterThanOrEqual(3);

    // Verify code string fixes
    expect(fixResult.code).toContain('alt=""');
    expect(fixResult.code).toContain('rel="noopener noreferrer"');
    expect(fixResult.code).toContain('<h2 data-id="h3-node">');
    expect(fixResult.code).toContain('title:');

    // Run audit on the remediated code
    const reAudit = await runStaticAudit({
      pagePath: 'app/page.tsx',
      fileMap: { 'app/page.tsx': fixResult.code },
    });

    const remainingRuleIds = reAudit.findings.map((f) => f.ruleId);
    expect(remainingRuleIds).not.toContain('missing-alt');
    expect(remainingRuleIds).not.toContain('target-blank-without-noopener');
    expect(remainingRuleIds).not.toContain('skipped-heading-level');
    expect(remainingRuleIds).not.toContain('empty-page-title');
  });

  it('applies auto-fixes across multiple files in a project', async () => {
    const files = {
      'app/page.tsx': `
        export const metadata = { title: 'Home' };
        export default function Home() {
          return (
            <main>
              <h1>Home</h1>
              <img src="/banner.png" data-id="b1" />
            </main>
          );
        }
      `,
      'app/about/page.tsx': `
        export const metadata = { title: 'About' };
        export default function About() {
          return (
            <main>
              <h1>About</h1>
              <a href="https://example.com" target="_blank" data-id="a1">Link</a>
            </main>
          );
        }
      `,
    };

    const audit = await runStaticAudit({ fileMap: files });
    const { files: fixedFiles, remediated } = applyAutoFixesToProject(files, audit.findings);

    expect(remediated.length).toBeGreaterThanOrEqual(2);
    expect(fixedFiles['app/page.tsx']).toContain('alt=""');
    expect(fixedFiles['app/about/page.tsx']).toContain('rel="noopener noreferrer"');
  });
});
