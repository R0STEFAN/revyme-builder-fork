import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '@babel/parser';
import { projectFS } from '@/code/project/project-fs';
import { getDefaultStore } from 'jotai';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { initMutationQueue, queueMutation, flushNow, getCurrentCode } from '@/code/mutation/mutation-queue';
import { parseProjectFile } from '@/code/parsing/project-parser';
import { setInstanceDimStyleWriteInCode } from '@/code/features/instance-auto-size';
import { seedNodesForCode } from './store';

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

const parses = (code: string) => {
  parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  return true;
};

const CARD_MASTER = `'use client';
export default function Card({ style }: any) {
  return (
    <div data-id="card-root" style={{ width: '600px', height: '400px', backgroundColor: '#eee', ...style }}>
      <p data-id="card-text">Card Content</p>
    </div>
  );
}`;

const NAVBAR_MASTER = `'use client';
export default function NavBar({ style }: any) {
  return (
    <nav data-id="nav-root" style={{ width: '100%', height: '80px', backgroundColor: '#333', ...style }}>
      <span data-id="nav-logo">Logo</span>
    </nav>
  );
}`;

const TEMPLATE_SOURCE_BASE = `'use client';
import Card from '@/components/Card';
import NavBar from '@/components/NavBar';

export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root" style={{ display: 'flex', flexDirection: 'column' }}>
      <NavBar data-id="nav" style={{ position: 'relative' }} />
      <Card data-id="card" style={{ position: 'relative' }} />
      {children}
    </div>
  );
}`;

describe('template-instance-size integration tests', () => {
  beforeEach(() => {
    projectFS.loadSnapshot(new Map([
      ['components/Card.tsx', CARD_MASTER],
      ['components/NavBar.tsx', NAVBAR_MASTER],
      ['app/LayoutClient.tsx', TEMPLATE_SOURCE_BASE],
    ]));
    getDefaultStore().set(activeFilePathAtom, 'app/LayoutClient.tsx');
  });

  it('sets width to 100% on template Card instance without mutating master width', () => {
    let out = '';
    initMutationQueue(TEMPLATE_SOURCE_BASE, (code) => { out = code; });
    queueMutation({
      type: 'updateStyles',
      nodeId: 'card',
      styles: { width: '100%' },
    });
    flushNow();

    const result = out || getCurrentCode();
    expect(parses(result)).toBe(true);
    expect(result).toContain("width: '100%'");

    // Master in projectFS remains strictly 600px
    const cardMasterCode = projectFS.readFile('components/Card.tsx');
    expect(cardMasterCode).toBe(CARD_MASTER);
    expect(cardMasterCode).toContain("width: '600px'");

    // Full project parse produces instance wrapper with width: 100%
    projectFS.writeFile('app/LayoutClient.tsx', result);
    const nodes = parseProjectFile('app/LayoutClient.tsx', projectFS);
    expect(nodes.get('card')?.styles.width).toBe('100%');
  });

  it.each([
    ['50%', "width: '50%'", '50%'],
    ['320px', "width: '320px'", '320px'],
  ])('cycles width through %s cleanly', (val, expectedCodeSnippet, expectedParsedWidth) => {
    let out = '';
    initMutationQueue(TEMPLATE_SOURCE_BASE, (code) => { out = code; });
    queueMutation({
      type: 'updateStyles',
      nodeId: 'card',
      styles: { width: val },
    });
    flushNow();

    const result = out || getCurrentCode();
    expect(parses(result)).toBe(true);
    expect(result).toContain(expectedCodeSnippet);

    projectFS.writeFile('app/LayoutClient.tsx', result);
    const nodes = parseProjectFile('app/LayoutClient.tsx', projectFS);
    expect(nodes.get('card')?.styles.width).toBe(expectedParsedWidth);
  });

  it('resets width to Hug/Fit by removing width property on single-variant instance', () => {
    // Start with a pinned width
    const pinned = setInstanceDimStyleWriteInCode(TEMPLATE_SOURCE_BASE, 'card', 'width', null, '100%');
    expect(pinned).toContain("width: '100%'");

    let out = '';
    initMutationQueue(pinned, (code) => { out = code; });
    queueMutation({
      type: 'updateStyles',
      nodeId: 'card',
      styles: { width: 'auto' },
    });
    flushNow();

    const result = out || getCurrentCode();
    expect(parses(result)).toBe(true);
    // In Revyme v4 hug model, all-hug on single-variant instance removes the property so master default shines through
    expect(result).not.toContain("width: '100%'");
    expect(result).not.toContain("width: 'auto'");

    projectFS.writeFile('app/LayoutClient.tsx', result);
    const nodes = parseProjectFile('app/LayoutClient.tsx', projectFS);
    // Unpinned instance has no width override on wrapper
    expect(nodes.get('card')?.styles.width).toBeUndefined();
    // Master root maintains 600px
    const cardRoot = [...nodes.values()].find((n) => n.id.endsWith('card-root'));
    expect(cardRoot?.styles.width).toBe('600px');
  });

  it('handles missing style attribute and trailing comma when writing dimension', () => {
    const withoutStyle = TEMPLATE_SOURCE_BASE.replace('style={{ position: \'relative\' }}', '');
    const outWithout = setInstanceDimStyleWriteInCode(withoutStyle, 'card', 'width', null, '100%');
    expect(parses(outWithout)).toBe(true);
    expect(outWithout).toContain("width: '100%'");

    const withTrailingComma = TEMPLATE_SOURCE_BASE.replace('style={{ position: \'relative\' }}', 'style={{ position: \'relative\', }}');
    const outTrailing = setInstanceDimStyleWriteInCode(withTrailingComma, 'card', 'width', null, '100%');
    expect(parses(outTrailing)).toBe(true);
    expect(outTrailing).not.toContain(',,');
    expect(outTrailing).toContain("width: '100%'");
  });

  it('preserves template ownership during merge and does not allow page writes to layout:: nodes', () => {
    const layoutWithWidth = setInstanceDimStyleWriteInCode(TEMPLATE_SOURCE_BASE, 'card', 'width', null, '100%');
    projectFS.writeFile('app/LayoutClient.tsx', layoutWithWidth);
    projectFS.writeFile('app/layout.tsx', 'export default function Layout({ children }: any) { return <html><body>{children}</body></html>; }');
    const pageSource = `'use client';
export default function Page() {
  return (
    <div data-id="root">
      <section data-id="sec-1">Section</section>
    </div>
  );
}`;
    projectFS.writeFile('app/page.client.tsx', pageSource);

    getDefaultStore().set(activeFilePathAtom, 'app/page.client.tsx');
    const mergedNodes = seedNodesForCode(pageSource);

    // Template elements exist under layout:: prefix in page view
    expect(mergedNodes.has('layout::card')).toBe(true);
    expect(mergedNodes.get('layout::card')?.fromLayout).toBe(true);
    expect(mergedNodes.get('layout::card')?.styles.width).toBe('100%');
  });
});
