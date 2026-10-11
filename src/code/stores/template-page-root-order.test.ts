import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projectFS } from '@/code/project/project-fs';
import { getDefaultStore } from 'jotai';
import { activeFilePathAtom, getLayoutForPage } from '@/code/project/active-file-store';
import { initMutationQueue, queueMutation, flushNow, getCurrentCode } from '@/code/mutation/mutation-queue';
import { seedNodesForCode } from './store';
import { parseJSXToNodes } from '../parsing/parser';

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

const BARE_PAGE_SOURCE = `'use client';
import { motion, LayoutGroup } from 'framer-motion';

export default function Page() {
  return (
    <motion.div data-id="root" data-glide='{"transition":{"type":"spring"}}'>
      <LayoutGroup>
        <motion.div data-glide-item layout style={{ order: '0' }}>
          <section data-id="first">
            <nav data-id="nav" style={{ position: 'relative' }} />
          </section>
        </motion.div>
        <motion.div data-glide-item layout style={{ order: '1' }}>
          <section data-id="second" />
        </motion.div>
      </LayoutGroup>
    </motion.div>
  );
}`;

const TEMPLATE_LAYOUT_SOURCE = `'use client';
export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root">
      <header data-id="hdr">Header</header>
      {children}
      <footer data-id="ftr">Footer</footer>
    </div>
  );
}`;

describe('template-page-root-order regression: bare vs templated root order', () => {
  beforeEach(() => {
    projectFS.loadSnapshot(new Map());
  });

  it('produces identical [first, nav, second] order on bare page and templated page after cross-parent move into Glide root', () => {
    // 1. Bare page run
    projectFS.loadSnapshot(new Map([
      ['app/page.client.tsx', BARE_PAGE_SOURCE],
    ]));
    getDefaultStore().set(activeFilePathAtom, 'app/page.client.tsx');

    let bareOut = '';
    initMutationQueue(BARE_PAGE_SOURCE, (code) => { bareOut = code; });
    queueMutation({
      type: 'move',
      nodeId: 'nav',
      newParentId: 'root',
      index: 1,
      insertBeforeId: 'second',
      styles: { position: 'relative', order: '1' },
    });
    queueMutation({ type: 'updateStyles', nodeId: 'first', styles: { order: '0' } });
    queueMutation({ type: 'updateStyles', nodeId: 'second', styles: { order: '2' } });
    flushNow();

    const bareCode = bareOut || getCurrentCode();
    const bareNodes = seedNodesForCode(bareCode);
    const bareRootKids = bareNodes.get('root')?.children ?? [];
    expect(bareRootKids).toEqual(['first', 'nav', 'second']);

    // 2. Templated page run (same initial page source, but with LayoutClient.tsx applied)
    projectFS.loadSnapshot(new Map([
      ['app/layout.tsx', 'export default function Layout({ children }: any) { return <html><body>{children}</body></html>; }'],
      ['app/LayoutClient.tsx', TEMPLATE_LAYOUT_SOURCE],
      ['app/page.client.tsx', BARE_PAGE_SOURCE],
    ]));
    getDefaultStore().set(activeFilePathAtom, 'app/page.client.tsx');

    let templatedOut = '';
    initMutationQueue(BARE_PAGE_SOURCE, (code) => { templatedOut = code; });
    queueMutation({
      type: 'move',
      nodeId: 'nav',
      newParentId: 'root',
      index: 1,
      insertBeforeId: 'second',
      styles: { position: 'relative', order: '1' },
    });
    queueMutation({ type: 'updateStyles', nodeId: 'first', styles: { order: '0' } });
    queueMutation({ type: 'updateStyles', nodeId: 'second', styles: { order: '2' } });
    flushNow();

    const templatedCode = templatedOut || getCurrentCode();
    const templatedNodes = seedNodesForCode(templatedCode);
    const templatedRootKids = templatedNodes.get('root')?.children ?? [];

    // The merged root contains header, page sections, footer
    expect(templatedRootKids).toContain('layout::hdr');
    expect(templatedRootKids).toContain('layout::ftr');

    // Extract page sections between header and footer
    const pageSections = templatedRootKids.filter(id => !id.startsWith('layout::') && id !== 'children-slot');
    expect(pageSections).toEqual(['first', 'nav', 'second']);

    // Ensure order in the underlying JSX also matches
    const pageJSXNodes = parseJSXToNodes(templatedCode);
    expect(pageJSXNodes.get('root')?.children).toEqual(['first', 'nav', 'second']);
  });
});
