// packages/automation-core/test/fixture.ts
import assert from 'node:assert/strict';
import {
  type Snapshot,
  type Result,
  type Issue,
} from '../src/contracts';
import {
  createSnapshot,
  createOperationContext,
  prepareOperation,
} from '../src/session';

export interface RunCaseStep {
  tool: string;
  input: Record<string, unknown>;
  expectedStatus?: 'ok' | 'error';
}

export interface RunCaseExpect {
  ok?: boolean;
  revisionDelta?: number;
  changedFiles?: string[];
  unchangedFiles?: string[];
  issues?: Array<{ code?: string; message?: string }>;
  sourceMatches?: Record<string, RegExp | string>;
}

export interface RunCaseOptions {
  seed: 'empty' | 'landing' | 'complete';
  steps: RunCaseStep[];
  expect?: RunCaseExpect;
}

export function createSeedFiles(seed: 'empty' | 'landing' | 'complete'): Map<string, string> {
  const files = new Map<string, string>();

  // Base files for all seeds
  files.set(
    'app/layout.tsx',
    `import React from 'react';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`
  );

  files.set(
    'revyme.config.json',
    JSON.stringify(
      {
        version: 2,
        primaryBreakpoint: 1200,
        breakpoints: [
          { id: 'desktop', width: 1200 },
          { id: 'tablet', width: 768 },
          { id: 'mobile', width: 375 },
        ],
      },
      null,
      2
    )
  );

  if (seed === 'empty') {
    files.set(
      'app/page.tsx',
      `import React from 'react';
export default function Page() {
  return (
    <main data-id="root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <h1 data-id="title">Welcome to Revyme</h1>
    </main>
  );
}`
    );
  } else if (seed === 'landing' || seed === 'complete') {
    files.set(
      'components/Navbar.tsx',
      `import React from 'react';
export function Navbar() {
  return (
    <header data-id="nav-root" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px' }}>
      <div data-id="nav-logo">Revyme Brand</div>
      <nav data-id="nav-links">
        <a data-id="nav-link-home" href="/">Home</a>
        <a data-id="nav-link-about" href="/about">About</a>
      </nav>
    </header>
  );
}`
    );

    files.set(
      'components/Hero.tsx',
      `import React from 'react';
export function Hero() {
  return (
    <section data-id="hero-root" style={{ padding: '64px 24px', textAlign: 'center' }}>
      <h1 data-id="hero-heading">Build Beautiful Websites in Real Code</h1>
      <p data-id="hero-subheading">A visual, code-first Next.js website builder.</p>
      <button data-id="hero-cta" style={{ padding: '12px 24px', backgroundColor: '#000', color: '#fff' }}>
        Get Started
      </button>
    </section>
  );
}`
    );

    files.set(
      'components/Footer.tsx',
      `import React from 'react';
export function Footer() {
  return (
    <footer data-id="footer-root" style={{ padding: '32px 24px', borderTop: '1px solid #eee' }}>
      <p data-id="footer-copy">&copy; 2026 Revyme. All rights reserved.</p>
    </footer>
  );
}`
    );

    files.set(
      'app/page.tsx',
      `import React from 'react';
import { Navbar } from '@/components/Navbar';
import { Hero } from '@/components/Hero';
import { Footer } from '@/components/Footer';

export default function Page() {
  return (
    <div data-id="page-root">
      <Navbar />
      <main data-id="main-content">
        <Hero />
      </main>
      <Footer />
    </div>
  );
}`
    );

    if (seed === 'complete') {
      files.set(
        'app/about/page.tsx',
        `import React from 'react';
export default function AboutPage() {
  return (
    <main data-id="about-root" style={{ padding: '48px' }}>
      <h1 data-id="about-title">About Our Mission</h1>
    </main>
  );
}`
      );

      files.set(
        'cms/case-studies.json',
        JSON.stringify(
          [
            { id: '1', slug: 'fintech-app', title: 'Fintech App Redesign', client: 'Acme Bank' },
            { id: '2', slug: 'ecommerce-hub', title: 'Next-Gen E-commerce', client: 'Shopify Partner' },
          ],
          null,
          2
        )
      );
    }
  }

  return files;
}

export async function runCase(options: {
  seed: 'empty' | 'landing' | 'complete';
  steps: RunCaseStep[];
  expect?: RunCaseExpect;
}): Promise<{ snapshot: Snapshot; results: Result[] }> {
  const initialFiles = createSeedFiles(options.seed);
  const initialSnapshot = createSnapshot(
    { projectId: 'test-project', branchId: 'main' },
    1,
    initialFiles,
    { seed: options.seed }
  );

  let currentSnapshot = initialSnapshot;
  const initialFilesClone = new Map(initialFiles);
  const results: Result[] = [];
  const context = createOperationContext();

  for (const step of options.steps) {
    const res = await prepareOperation(currentSnapshot, step.tool, step.input, context);
    results.push(res);

    if (step.expectedStatus === 'error') {
      assert.equal(res.ok, false, `Expected step ${step.tool} to fail, but it succeeded`);
    } else if (step.expectedStatus === 'ok') {
      assert.equal(res.ok, true, `Expected step ${step.tool} to succeed, but failed with: ${res.error?.message}`);
    }

    if (res.ok && res.data && typeof res.data === 'object' && 'changes' in (res.data as any)) {
      const changes = (res.data as any).changes;
      if (Array.isArray(changes)) {
        const nextFiles = new Map(currentSnapshot.files);
        for (const ch of changes) {
          if (ch.content === null) {
            nextFiles.delete(ch.path);
          } else {
            nextFiles.set(ch.path, ch.content);
          }
        }
        currentSnapshot = createSnapshot(
          currentSnapshot.scope,
          currentSnapshot.revision + 1,
          nextFiles,
          currentSnapshot.config
        );
      }
    }
  }

  // Assert expectations if provided
  if (options.expect) {
    const exp = options.expect;

    if (exp.ok !== undefined) {
      const allOk = results.every((r) => r.ok);
      assert.equal(allOk, exp.ok, `Expected overall success to be ${exp.ok}`);
    }

    if (exp.revisionDelta !== undefined) {
      const delta = currentSnapshot.revision - initialSnapshot.revision;
      assert.equal(delta, exp.revisionDelta, `Expected revision delta ${exp.revisionDelta}, got ${delta}`);
    }

    if (exp.changedFiles) {
      for (const file of exp.changedFiles) {
        const initialContent = initialFilesClone.get(file);
        const finalContent = currentSnapshot.files.get(file);
        assert.notEqual(
          initialContent,
          finalContent,
          `Expected file "${file}" to have changed, but it remained identical`
        );
      }
    }

    if (exp.unchangedFiles) {
      for (const file of exp.unchangedFiles) {
        const initialContent = initialFilesClone.get(file);
        const finalContent = currentSnapshot.files.get(file);
        assert.equal(
          initialContent,
          finalContent,
          `Expected file "${file}" to remain unchanged, but it was modified`
        );
      }
    }

    if (exp.sourceMatches) {
      for (const [filePath, pattern] of Object.entries(exp.sourceMatches)) {
        const content = currentSnapshot.files.get(filePath);
        assert.ok(content !== undefined, `File "${filePath}" must exist in final snapshot`);
        if (pattern instanceof RegExp) {
          assert.match(content, pattern, `File "${filePath}" does not match expected regex`);
        } else {
          assert.ok(content.includes(pattern), `File "${filePath}" does not include expected string`);
        }
      }
    }

    if (exp.issues) {
      const allIssues = results.flatMap((r) => r.error?.issues ?? []);
      for (const expectedIssue of exp.issues) {
        const match = allIssues.some(
          (issue) =>
            (!expectedIssue.code || issue.code === expectedIssue.code) &&
            (!expectedIssue.message || issue.message.includes(expectedIssue.message))
        );
        assert.ok(match, `Expected issue matching ${JSON.stringify(expectedIssue)} not found in results`);
      }
    }
  }

  return { snapshot: currentSnapshot, results };
}
