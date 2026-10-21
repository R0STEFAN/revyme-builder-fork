// packages/automation-core/test/capabilities/T14-motion.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  motionSetOperation,
  motionGetOperation,
  motionRemoveOperation,
  motionPresetApplyOperation,
} from '../../src/operations/motion';
import {
  textEffectsSetOperation,
  textEffectsGetOperation,
  textEffectsRemoveOperation,
} from '../../src/operations/text-effects';
import {
  siteEffectsSmoothScrollSetOperation,
  siteEffectsSmoothScrollGetOperation,
  siteEffectsSmoothScrollRemoveOperation,
  siteEffectsPageTransitionSetOperation,
  siteEffectsPageTransitionGetOperation,
  siteEffectsPageTransitionRemoveOperation,
  siteEffectsCursorSetOperation,
  siteEffectsCursorRemoveOperation,
  siteEffectsGlideSetOperation,
  siteEffectsGlideGetOperation,
  siteEffectsGlideRemoveOperation,
} from '../../src/operations/site-effects';

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

const mockContext = createOperationContext();

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

describe('T14: Complete Motion, Text Effects, and Site Effects', () => {
  it('handles framer-motion props, presets, reading and removal', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="page-root">
      <div data-id="hero-header">
        <h1 data-id="title">Super Hero Title</h1>
      </div>
      <div data-id="card-item" style={{ padding: 20 }}>
        <p data-id="card-text">Card Content</p>
      </div>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. motion.set whileHover on card-item
    const hoverRes = await motionSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'card-item',
        prop: 'whileHover',
        values: { scale: '1.05', y: '-5' },
      },
      mockContext,
    );
    applyChanges(mutableFiles, hoverRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('motion.div');
    expect(code).toContain('whileHover=');
    expect(code).toContain("from 'framer-motion'");

    // 2. motion.preset.apply 'fade-up' on hero-header
    const presetRes = await motionPresetApplyOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'hero-header',
        preset: 'fade-up',
        physics: 'snappy',
      },
      mockContext,
    );
    applyChanges(mutableFiles, presetRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('whileInView');
    expect(code).toContain('initial=');

    // 3. motion.get on both elements
    const getCard = await motionGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'card-item' },
      mockContext,
    );
    expect(getCard.isMotionElement).toBe(true);
    expect(getCard.props.whileHover).toBeDefined();

    const getHero = await motionGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'hero-header' },
      mockContext,
    );
    expect(getHero.isMotionElement).toBe(true);
    expect(getHero.props.whileInView).toBeDefined();

    // 4. motion.remove
    const removeHover = await motionRemoveOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'card-item', prop: 'whileHover' },
      mockContext,
    );
    applyChanges(mutableFiles, removeHover.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));

    const removeScrollFx = await motionRemoveOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'hero-header', prop: 'scrollFx' },
      mockContext,
    );
    applyChanges(mutableFiles, removeScrollFx.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('whileHover=');
    expect(code).not.toContain('data-scroll-fx=');
  });

  it('handles split-text animation lifecycle: set, get, and unwrap removal', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="heading-1">Animated Headline</h1>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. textEffects.set
    const setRes = await textEffectsSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'heading-1',
        split: 'words',
        mask: true,
        trigger: 'view',
        stagger: 0.08,
        y: '100%',
        transition: { type: 'spring', stiffness: 250, damping: 25 },
      },
      mockContext,
    );
    applyChanges(mutableFiles, setRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('RevymeSplitText');
    expect(code).toContain('@revyme/runtime');
    expect(code).toContain('mask: true');

    // 2. textEffects.get
    const getRes = await textEffectsGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'heading-1' },
      mockContext,
    );
    expect(getRes.hasTextAnim).toBe(true);
    expect(getRes.config?.animationType).toBe('word');
    expect(getRes.config?.mask).toBe(true);

    // 3. textEffects.remove
    const removeRes = await textEffectsRemoveOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'heading-1' },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('<RevymeSplitText');
    expect(code).toContain('Animated Headline');
  });

  it('manages site effects: smooth scroll, page transitions, custom cursor, and glide', async () => {
    const layoutCode = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}`;

    const pageCode = `export default function Page() {
  return (
    <div data-id="root">
      <button data-id="cta-btn">Click Me</button>
      <div data-id="faq-accordion">
        <div data-id="faq-1"><p>Q1</p></div>
        <div data-id="faq-2"><p>Q2</p></div>
      </div>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/layout.tsx': layoutCode,
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. Smooth Scroll: set, get, remove
    const scrollSetRes = await siteEffectsSmoothScrollSetOperation.execute(
      snapshot,
      { route: '/', enabled: true, intensity: 15, smoothWheel: true },
      mockContext,
    );
    applyChanges(mutableFiles, scrollSetRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    expect(snapshot.files.has('app/smooth-scroll.ts')).toBe(true);
    expect(snapshot.files.get('app/layout.tsx')).toContain('<SmoothScroll />');

    const scrollGet = await siteEffectsSmoothScrollGetOperation.execute(snapshot, { route: '/' }, mockContext);
    expect(scrollGet.config?.enabled).toBe(true);
    expect(scrollGet.config?.intensity).toBe(15);

    const scrollRemove = await siteEffectsSmoothScrollRemoveOperation.execute(snapshot, { route: '/' }, mockContext);
    applyChanges(mutableFiles, scrollRemove.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));

    // 2. Page Transitions: set, get, remove
    const transSetRes = await siteEffectsPageTransitionSetOperation.execute(
      snapshot,
      { page: '/', preset: 'slide-left', duration: 0.4 },
      mockContext,
    );
    applyChanges(mutableFiles, transSetRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    expect(snapshot.files.has('app/page-effects.ts')).toBe(true);

    const transGet = await siteEffectsPageTransitionGetOperation.execute(snapshot, { page: '/' }, mockContext);
    expect(transGet.effect?.preset).toBe('slide-left');

    const transRemove = await siteEffectsPageTransitionRemoveOperation.execute(snapshot, { page: '/' }, mockContext);
    applyChanges(mutableFiles, transRemove.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));

    // 3. Custom Cursor: set, remove
    const cursorSetRes = await siteEffectsCursorSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'cta-btn',
        component: 'PointerDot',
        mode: 'follow',
      },
      mockContext,
    );
    applyChanges(mutableFiles, cursorSetRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('withCursor(');
    expect(code).toContain('PointerDot');

    const cursorRemoveRes = await siteEffectsCursorRemoveOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'cta-btn' },
      mockContext,
    );
    applyChanges(mutableFiles, cursorRemoveRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('withCursor(');

    // 4. Glide (Flow layout): set, get, remove
    const glideSetRes = await siteEffectsGlideSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'faq-accordion',
        duration: '0.6',
        bounce: '0.2',
      },
      mockContext,
    );
    applyChanges(mutableFiles, glideSetRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('data-glide=');
    expect(code).toContain('data-glide-item');

    const glideGet = await siteEffectsGlideGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'faq-accordion' },
      mockContext,
    );
    expect(glideGet.hasGlide).toBe(true);
    expect(glideGet.spec?.transition?.duration).toBe('0.6');

    const glideRemove = await siteEffectsGlideRemoveOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'faq-accordion' },
      mockContext,
    );
    applyChanges(mutableFiles, glideRemove.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('data-glide=');
    expect(code).not.toContain('data-glide-item');
  });
});
