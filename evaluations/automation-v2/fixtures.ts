// evaluations/automation-v2/fixtures.ts
/**
 * Test fixtures, sample projects, and snapshots for Revyme Automation v2 evaluation benchmarks.
 */

import { createSnapshot } from '../../packages/automation-core/src/session';
import type { Snapshot } from '../../packages/automation-core/src/contracts';

export const FIXTURE_HOME_PAGE = `'use client';
import React from 'react';
import Link from 'next/link';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', height: 'auto', padding: '32px', backgroundColor: '#09090b' }}>
      <header data-id="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 data-id="logo" style={{ order: '0', flex: '0 0 auto', fontSize: '24px', fontWeight: 'bold', color: '#fafafa' }}>EvalBenchmark</h1>
        <nav data-id="nav" style={{ order: '1', flex: '0 0 auto', display: 'flex', gap: '16px' }}>
          <Link data-id="nav-link-1" href="#features" style={{ order: '0', flex: '0 0 auto', color: '#a1a1aa' }}>Features</Link>
          <Link data-id="nav-link-2" href="#pricing" style={{ order: '1', flex: '0 0 auto', color: '#a1a1aa' }}>Pricing</Link>
        </nav>
      </header>
      <main data-id="main">
        <section data-id="hero" style={{ padding: '64px 0' }}>
          <h2 data-id="hero-title" style={{ fontSize: '48px', fontWeight: '800', textAlign: 'center', color: '#fafafa' }}>Automation at Scale</h2>
          <p data-id="hero-sub" style={{ fontSize: '18px', textAlign: 'center', color: '#a1a1aa', marginTop: '16px' }}>
            Production-grade Next.js builder automation with Model Context Protocol.
          </p>
          <button data-id="cta-button" style={{ display: 'block', margin: '24px auto 0', padding: '12px 24px', backgroundColor: '#2563eb', color: '#ffffff', borderRadius: '8px' }}>
            Get Started
          </button>
        </section>
      </main>
      <footer data-id="footer" style={{ marginTop: '64px', borderTop: '1px solid #27272a', padding: '24px 0' }}>
        <p data-id="footer-text" style={{ textAlign: 'center', color: '#71717a' }}>© 2026 Revyme Evaluation Suite</p>
      </footer>
    </div>
  );
}
`;

export const FIXTURE_LAYOUT = `'use client';
import React from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>EvalBenchmark</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
`;

export function createEvaluationSnapshot(overrides: Record<string, string> = {}): Snapshot {
  return createSnapshot(
    { projectId: 'eval-project-001', branchId: 'main' },
    1,
    {
      'app/page.client.tsx': FIXTURE_HOME_PAGE,
      'app/layout.tsx': FIXTURE_LAYOUT,
      ...overrides,
    },
  );
}
