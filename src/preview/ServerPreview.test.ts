import { describe, it, expect, vi } from 'vitest';
import { buildFiles } from './ServerPreview';

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

describe('ServerPreview buildFiles pipeline', () => {
  const sessionId = 'test-session-1';

  it('heals missing root layout for non-localized project', () => {
    const input = {
      'app/page.tsx': 'export default function Page() { return <div>Home</div>; }',
    };

    const output = buildFiles(sessionId, input);
    expect(output['app/layout.tsx']).toBeDefined();
    expect(output['app/layout.tsx']).toContain('export default function RootLayout');
  });

  it('compiles authored localized project to app/[lang] without creating redundant outer app/layout.tsx', () => {
    const input = {
      'app/page.tsx': 'export default function Page() { return <div>Home</div>; }',
      'app/layout.tsx': `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body><Providers>{children}</Providers></body></html>;
}`,
      'app/providers.tsx': "'use client';\nexport function Providers({ children }: any) { return children; }",
      'i18n/config.json': JSON.stringify({
        defaultLocale: 'uk',
        locales: [{ code: 'uk' }, { code: 'en' }],
      }),
    };

    const output = buildFiles(sessionId, input);

    // Root layout compiled under app/[lang]
    expect(output['app/[lang]/layout.tsx']).toBeDefined();
    expect(output['app/[lang]/page.tsx']).toBeDefined();

    // Redundant outer app/layout.tsx MUST NOT exist
    expect(output['app/layout.tsx']).toBeUndefined();
  });

  it('already-compiled localized inputs survive without an added app/layout.tsx', () => {
    const input = {
      'app/[lang]/layout.tsx': 'export default function RootLayout() { return null; }',
      'app/[lang]/page.tsx': 'export default function Page() { return null; }',
      'i18n/config.json': JSON.stringify({
        defaultLocale: 'uk',
        locales: [{ code: 'uk' }, { code: 'en' }],
      }),
    };

    const output = buildFiles(sessionId, input);

    expect(output['app/[lang]/layout.tsx']).toBeDefined();
    // No outer app/layout.tsx recreated
    expect(output['app/layout.tsx']).toBeUndefined();
  });

  it('prefixes hrefs with sessionId without double-prefixing', () => {
    const input = {
      'app/gallery/page.tsx': `import Link from 'next/link';
export default function Gallery() {
  return (
    <div>
      <a href="/about">About</a>
      <a href="/${sessionId}/contact">Contact</a>
    </div>
  );
}`,
    };

    const output = buildFiles(sessionId, input);
    const code = output['app/gallery/page.tsx'];

    expect(code).toContain(`href="/${sessionId}/about"`);
    // Pre-existing sessionId prefix is NOT doubled
    expect(code).toContain(`href="/${sessionId}/contact"`);
    expect(code).not.toContain(`/${sessionId}/${sessionId}`);
  });
});
