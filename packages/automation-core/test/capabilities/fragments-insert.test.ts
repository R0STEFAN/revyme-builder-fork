// packages/automation-core/test/capabilities/fragments-insert.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { defaultRegistry } from '../../src/registry';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { checkFile } from '@/code/oracle/check-file';
import '../../src/operations/fragments';
import '../../src/operations/nodes';

function createMockContext(): OperationContext {
  let counter = 0;
  return {
    createId: (prefix = 'node') => `${prefix}-${++counter}`,
    signal: new AbortController().signal,
    trace: () => {},
    adapters: {},
  };
}

describe('fragments.insert: Semantic JSX Section Composition', () => {
  let files: Map<string, string>;
  let snapshot: Snapshot;
  let context: OperationContext;

  const INITIAL_PAGE_CODE = `'use client';

/* @canvas { single: true, height: 'auto' } */

import React from 'react';

export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{
      position: 'relative', width: '100%', minHeight: '900px',
      backgroundColor: '#ffffff'
    }}>
      <header data-id="header-1" data-name="Header" style={{ position: 'relative', display: 'flex', width: '100%' }}>
        <h1 data-id="title-1" style={{ position: 'relative' }}>Original Title</h1>
      </header>
    </div>
  );
}
`;

  const BUTTON_COMPONENT_CODE = `'use client';

/** @name "Button" */

import React from 'react';

export default function Button({
  style,
  label = 'Click me',
  variant = 'primary',
}: {
  style?: React.CSSProperties;
  label?: string;
  variant?: string;
}) {
  return (
    <button data-id="btn-root" style={{ position: 'relative', ...style }}>
      {label}
    </button>
  );
}
`;

  function applyChanges(changes: FileChange[]): void {
    for (const ch of changes) {
      if (ch.content === null) files.delete(ch.path);
      else files.set(ch.path, ch.content);
    }
  }

  beforeEach(() => {
    context = createMockContext();
    files = new Map([
      ['app/page.client.tsx', INITIAL_PAGE_CODE],
      ['components/Button.tsx', BUTTON_COMPONENT_CODE],
    ]);
    snapshot = {
      scope: { projectId: 'test-project', branchId: 'main' },
      revision: 1,
      config: {},
      files,
    };
  });

  it('inserts a pure HTML semantic section with nested nodes and design tokens', async () => {
    const fragment = `
      <section data-name="Hero Section" style={{ padding: '80px 24px', backgroundColor: 'var(--bg-canvas)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '48px', color: 'var(--ink-primary)' }}>Impact Studio</h2>
          <p style={{ fontSize: '18px', color: 'var(--ink-secondary)' }}>We craft digital experiences.</p>
        </div>
      </section>
    `;

    const op = defaultRegistry.get('fragments.insert');
    expect(op).toBeDefined();

    const result = await op!.execute(snapshot, {
      parentId: 'root',
      fragment,
    }, context);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].path).toBe('app/page.client.tsx');
    expect(result.insertedIds.length).toBeGreaterThanOrEqual(4);

    applyChanges(result.changes);
    const updatedCode = files.get('app/page.client.tsx')!;

    // Verify code contains section, headings, and styles
    expect(updatedCode).toContain('data-name="Hero Section"');
    expect(updatedCode).toContain('padding: \'80px 24px\'');
    expect(updatedCode).toContain('var(--bg-canvas)');
    expect(updatedCode).toContain('Impact Studio');
    expect(updatedCode).toContain('We craft digital experiences.');

    // Verify parseJSXToNodes parses all new nodes into native canvas nodes
    const nodes = parseJSXToNodes(updatedCode);
    const root = nodes.get('root');
    expect(root).toBeDefined();
    expect(root!.children).toContain(result.rootId);

    const sectionNode = nodes.get(result.rootId);
    expect(sectionNode).toBeDefined();
    expect(sectionNode!.type).toBe('section');
    expect(sectionNode!.name).toBe('Hero Section');

    // Verify Oracle checks pass cleanly with 0 tier-3 errors
    const violations = checkFile(updatedCode, { kind: 'page' });
    const tier3 = violations.filter((v) => v.tier === 3);
    expect(tier3).toHaveLength(0);
  });

  it('resolves Design Component instance and injects required import', async () => {
    const fragment = `
      <section data-name="CTA Section" style={{ padding: '40px 20px' }}>
        <h3 style={{ fontSize: '24px' }}>Ready to start?</h3>
        <Button variant="primary" label="Get in touch" />
      </section>
    `;

    const op = defaultRegistry.get('fragments.insert');
    const result = await op!.execute(snapshot, {
      parentId: 'root',
      fragment,
    }, context);

    applyChanges(result.changes);
    const updatedCode = files.get('app/page.client.tsx')!;

    // Verify import was added
    expect(updatedCode).toContain("import Button from '@/components/Button';");

    // Verify Button instance rendered in JSX
    expect(updatedCode).toContain('<Button');
    expect(updatedCode).toContain('label="Get in touch"');
    expect(updatedCode).toContain('variant="primary"');

    // Verify parseJSXToNodes finds the Button instance
    const nodes = parseJSXToNodes(updatedCode);
    const buttonNode = Array.from(nodes.values()).find((n) => n.type === 'Button');
    expect(buttonNode).toBeDefined();
    expect(buttonNode!.attrs.label).toBe('Get in touch');
    expect(buttonNode!.attrs.variant).toBe('primary');

    // Verify clean Oracle check
    const violations = checkFile(updatedCode, { kind: 'page' });
    const tier3 = violations.filter((v) => v.tier === 3);
    expect(tier3).toHaveLength(0);
  });

  it('throws COMPONENT_NOT_FOUND if a referenced component does not exist', async () => {
    const fragment = `
      <section>
        <UnregisteredWidget title="Fails" />
      </section>
    `;

    const op = defaultRegistry.get('fragments.insert');
    await expect(
      op!.execute(snapshot, {
        parentId: 'root',
        fragment,
      }, context)
    ).rejects.toThrow('COMPONENT_NOT_FOUND');
  });

  it('inserts multiple sibling elements wrapped in a JSX fragment', async () => {
    const fragment = `
      <>
        <section data-id="custom-sec-1" style={{ height: '200px' }}>
          <h2>First Section</h2>
        </section>
        <section data-id="custom-sec-2" style={{ height: '300px' }}>
          <h2>Second Section</h2>
        </section>
      </>
    `;

    const op = defaultRegistry.get('fragments.insert');
    const result = await op!.execute(snapshot, {
      parentId: 'root',
      fragment,
    }, context);

    expect(result.insertedIds).toContain('custom-sec-1');
    expect(result.insertedIds).toContain('custom-sec-2');

    applyChanges(result.changes);
    const updatedCode = files.get('app/page.client.tsx')!;

    expect(updatedCode).toContain('data-id="custom-sec-1"');
    expect(updatedCode).toContain('data-id="custom-sec-2"');

    const nodes = parseJSXToNodes(updatedCode);
    expect(nodes.has('custom-sec-1')).toBe(true);
    expect(nodes.has('custom-sec-2')).toBe(true);
  });

  it('enforces position: relative by default and data-pinned for absolute nodes', async () => {
    const fragment = `
      <div style={{ width: '100%' }}>
        <div style={{ position: 'absolute', top: '10px', left: '10px' }}>
          <span>Absolute Badge</span>
        </div>
      </div>
    `;

    const op = defaultRegistry.get('fragments.insert');
    const result = await op!.execute(snapshot, {
      parentId: 'root',
      fragment,
    }, context);

    applyChanges(result.changes);
    const updatedCode = files.get('app/page.client.tsx')!;

    // Check that relative position was assigned to the outer div
    expect(updatedCode).toContain('position: \'relative\'');

    // Check that data-pinned="true" was added to the absolute child
    expect(updatedCode).toContain('data-pinned="true"');

    // Oracle should have zero NODE_MISSING_POSITION or PIN_ABSOLUTE_NODE violations
    const violations = checkFile(updatedCode, { kind: 'page' });
    const positionViolations = violations.filter(
      (v) => v.code === 'NODE_MISSING_POSITION' || v.code === 'PIN_ABSOLUTE_NODE'
    );
    expect(positionViolations).toHaveLength(0);
  });

  it('fails cleanly on non-existent parent ID', async () => {
    const op = defaultRegistry.get('fragments.insert');
    await expect(
      op!.execute(snapshot, {
        parentId: 'non-existent-parent',
        fragment: '<section><h2>Hi</h2></section>',
      }, context)
    ).rejects.toThrow('PARENT_NOT_FOUND');
  });

  it('fails cleanly on malformed JSX syntax', async () => {
    const op = defaultRegistry.get('fragments.insert');
    await expect(
      op!.execute(snapshot, {
        parentId: 'root',
        fragment: '<section><h2>Unclosed header</section>',
      }, context)
    ).rejects.toThrow('INVALID_FRAGMENT');
  });

  it('binds typography presets (SSOT), stripping redundant inline styles and injecting responsive rules', async () => {
    // Add globals.css with custom typography preset
    files.set(
      'app/globals.css',
      `:root {
  --dp-color-bright: #f2f2f2;
  --dp-color-read: #a6a9ad;
  --dp-typography-face: 'Geist', sans-serif;
  --typo-display-statement-tag: h1;
  --typo-display-statement-font: var(--dp-typography-face);
  --typo-display-statement-weight: 400;
  --typo-display-statement-color: var(--dp-color-bright);
  --typo-display-statement-size: 72px;
  --typo-display-statement-spacing: -0.035em;
  --typo-display-statement-line-height: 1.02;
  --typo-display-statement-min-default: 1200;
  --typo-display-statement-min-md: 600;
  --typo-display-statement-size-md: 54px;
  --typo-display-statement-size-sm: 38px;
  --typo-section-title-tag: h2;
  --typo-section-title-font: var(--dp-typography-face);
  --typo-section-title-weight: 400;
  --typo-section-title-color: var(--dp-color-bright);
  --typo-section-title-size: 36px;
  --typo-section-title-line-height: 1.2;
}
`
    );

    const fragment = `
      <section data-id="sec-hero">
        <h1 preset="display-statement" data-id="h1-hero">Hero Statement</h1>
        <h2 data-id="h2-sub">Sub Heading</h2>
      </section>
    `;

    const op = defaultRegistry.get('fragments.insert')!;
    const res = await op.execute(
      snapshot,
      {
        parentId: 'root',
        fragment,
      },
      context
    );

    applyChanges(res.changes);
    const updatedCode = files.get('app/page.client.tsx')!;
    const nodes = parseJSXToNodes(updatedCode);

    const h1Node = nodes.get('h1-hero');
    expect(h1Node).toBeDefined();
    // 1. Font family and color reference preset variables, NOT hardcoded literals
    expect(h1Node?.styles.fontFamily).toBe('var(--typo-display-statement-font)');
    expect(h1Node?.styles.color).toBe('var(--typo-display-statement-color)');
    expect(h1Node?.styles.fontSize).toBe('var(--typo-display-statement-size)');
    expect(h1Node?.styles.lineHeight).toBe('var(--typo-display-statement-line-height)');
    // 2. Preset attribute was stripped from DOM attrs
    expect(h1Node?.attrs?.['preset']).toBeUndefined();

    // 3. Smart tag matching bound h2 to section-title
    const h2Node = nodes.get('h2-sub');
    expect(h2Node).toBeDefined();
    expect(h2Node?.styles.fontFamily).toBe('var(--typo-section-title-font)');
    expect(h2Node?.styles.color).toBe('var(--typo-section-title-color)');

    // 4. Responsive rule was injected for display-statement (has md/sm tiers)
    expect(updatedCode).toContain('@media (max-width: 1199px)');
    expect(updatedCode).toContain('font-size: var(--typo-display-statement-size-md) !important');
    expect(updatedCode).toContain('@media (max-width: 599px)');
    expect(updatedCode).toContain('font-size: var(--typo-display-statement-size-sm) !important');

    // 5. Oracle check verifies code is 100% valid
    const violations = checkFile(updatedCode, { kind: 'page' });
    expect(violations.filter((v) => v.tier === 3)).toHaveLength(0);
  });

  it('wires onSubmit, data-form destination, and input names when inserting forms', async () => {
    const fragment = `
      <form style={{ display: 'flex', gap: '8px' }}>
        <input type="email" placeholder="Enter email" style={{ padding: '8px 12px' }} />
        <button type="submit" style={{ padding: '8px 16px' }}>Submit</button>
      </form>
    `;

    const op = defaultRegistry.get('fragments.insert');
    const result = await op!.execute(snapshot, {
      parentId: 'root',
      fragment,
    }, context);

    applyChanges(result.changes);
    const updatedCode = files.get('app/page.client.tsx')!;

    expect(updatedCode).toContain('onSubmit={async (e) =>');
    expect(updatedCode).toContain('data-form=');
    expect(updatedCode).toContain('name=');
    expect(files.has('app/api/form/route.ts')).toBe(true);

    const violations = checkFile(updatedCode, { kind: 'page' });
    const formViolations = violations.filter(
      (v) => v.code === 'FORM_MISSING_ONSUBMIT' || v.code === 'FORM_NO_DESTINATION' || v.code === 'FORM_INPUT_MISSING_NAME'
    );
    expect(formViolations).toHaveLength(0);
  });

  it('auto-heals raw screenshot-style JSX so fragments.insert passes Oracle in one shot', async () => {
    const existing = files.get('app/page.client.tsx')!;
    files.set(
      'app/page.client.tsx',
      existing.replace(
        "'use client';",
        `'use client';\n/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }, { "id": "tablet", "label": "Tablet", "width": 810, "height": "auto", "isPrimary": false, "order": 1 }, { "id": "mobile", "label": "Mobile", "width": 390, "height": "auto", "isPrimary": false, "order": 2 } ], "positions": { "desktop": { "x": 0, "y": 0 }, "tablet": { "x": 1360, "y": 0 }, "mobile": { "x": 2330, "y": 0 } } } */`
      )
    );

    const fragment = `
      <section style={{ background: '#0f172a', color: '#f8fafc', fontFamily: 'Inter', padding: '48px 24px', minHeight: 'min-content' }}>
        <h2>Pricing Features</h2>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
          <div style={{ width: '100%', border: '1px solid rgba(255,255,255,0.1)', borderColor: 'transparent', transition: 'all 0.2s ease', padding: '16px', position: 'relative' }}>
            <span style={{ position: 'absolute', inset: '12px 12px auto auto', lineHeight: '1.25 /* tight */' }}>Popular</span>
            <p>Starter tier with generous limits</p>
            <img src="https://example.com/card.jpg" alt="Card preview" />
          </div>
          <div style={{ width: '100%', padding: '16px' }}>
            <ul style={{ listStyleType: 'disc', paddingLeft: '20px', overflow: 'auto', maxHeight: '240px' }}>
              <li style={{ fontSize: '14px' }}>Unlimited blocks</li>
              <li style={{ fontSize: '14px' }}>Native JSX source</li>
            </ul>
          </div>
        </div>
      </section>
    `;

    const op = defaultRegistry.get('fragments.insert');
    const result = await op!.execute(snapshot, {
      parentId: 'root',
      fragment,
    }, context);

    applyChanges(result.changes);
    const updatedCode = files.get('app/page.client.tsx')!;

    expect(updatedCode).toContain("backgroundColor: '#0f172a'");
    expect(updatedCode).not.toContain("minHeight: 'min-content'");
    expect(updatedCode).not.toContain('transition:');
    expect(updatedCode).toContain('rgba(0, 0, 0, 0)');
    expect(updatedCode).toContain("data-pinned=\"true\"");
    expect(updatedCode).toContain("flex: '1 0 0px'");
    expect(updatedCode).toContain("flex: '0 0 auto'");
    expect(updatedCode).toContain("order: '0'");
    expect(updatedCode).toContain("order: '1'");
    expect(updatedCode).toContain("lineHeight: '1.25'");
    expect(updatedCode).toContain("objectFit: 'cover'");

    const violations = checkFile(updatedCode, { kind: 'page' });
    expect(violations).toEqual([]);
  });

  it('supports targetId + where (before, after, prepend) placement with synchronized flex order', async () => {
    files.set(
      'app/page.client.tsx',
      `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}>
      <header data-id="header-1" style={{ position: 'relative', flex: '0 0 auto', order: '0' }}>
        <h1 data-id="title-1" style={{ position: 'relative' }}>Original Title</h1>
      </header>
    </div>
  );
}
`
    );

    const insertOp = defaultRegistry.get('fragments.insert')!;

    // Seed two sibling blocks inside root
    const seedRes = await insertOp.execute(snapshot, {
      parentId: 'root',
      fragment: `
        <section style={{ padding: '24px' }}><p>First</p></section>
        <section style={{ padding: '24px' }}><p>Third</p></section>
      `,
    }, context);
    applyChanges(seedRes.changes);

    const firstId = seedRes.insertedIds[0];

    // Insert "Middle" right after first section
    const afterRes = await insertOp.execute(snapshot, {
      targetId: firstId,
      where: 'after',
      fragment: `<section style={{ padding: '24px' }}><p>Middle</p></section>`,
    }, context);
    applyChanges(afterRes.changes);
    const middleId = afterRes.rootId;

    // Insert "Banner" right before first section
    const beforeRes = await insertOp.execute(snapshot, {
      targetId: firstId,
      where: 'before',
      fragment: `<div style={{ padding: '16px' }}><p>Top Banner</p></div>`,
    }, context);
    applyChanges(beforeRes.changes);
    const bannerId = beforeRes.rootId;

    // Prepend badge inside middle section
    const prependRes = await insertOp.execute(snapshot, {
      targetId: middleId,
      where: 'prepend',
      fragment: `<span>Badge</span>`,
    }, context);
    applyChanges(prependRes.changes);
    const badgeId = prependRes.rootId;

    const nodes = parseJSXToNodes(files.get('app/page.client.tsx')!);
    const thirdId = seedRes.insertedIds[2];
    expect(nodes.get('root')?.children).toEqual(['header-1', bannerId, firstId, middleId, thirdId]);
    expect(nodes.get('header-1')?.styles.order).toBe('0');
    expect(nodes.get(bannerId)?.styles.order).toBe('1');
    expect(nodes.get(firstId)?.styles.order).toBe('2');
    expect(nodes.get(middleId)?.styles.order).toBe('3');
    expect(nodes.get(thirdId)?.styles.order).toBe('4');
    expect(nodes.get(middleId)?.children[0]).toBe(badgeId);
  });

  it('atomically replaces an existing node in place via fragments.replace', async () => {
    files.set(
      'app/page.client.tsx',
      `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}>
      <header data-id="header-1" style={{ position: 'relative', flex: '0 0 auto', order: '0' }}>
        <h1 data-id="title-1" style={{ position: 'relative' }}>Original Title</h1>
      </header>
    </div>
  );
}
`
    );

    const insertOp = defaultRegistry.get('fragments.insert')!;
    const replaceOp = defaultRegistry.get('fragments.replace')!;

    const seedRes = await insertOp.execute(snapshot, {
      parentId: 'root',
      fragment: `
        <section style={{ padding: '24px' }}><p>Hero</p></section>
        <section style={{ padding: '24px' }}><p>Old Pricing</p></section>
        <footer style={{ padding: '24px' }}><p>Footer</p></footer>
      `,
    }, context);
    applyChanges(seedRes.changes);

    const nodesBefore = parseJSXToNodes(files.get('app/page.client.tsx')!);
    const rootChildrenBefore = nodesBefore.get('root')!.children;
    expect(rootChildrenBefore).toHaveLength(4);
    const [existingHeaderId, heroId, oldPricingId, footerId] = rootChildrenBefore;

    const replaceRes = await replaceOp.execute(snapshot, {
      targetId: oldPricingId,
      fragment: `<section style={{ padding: '32px', backgroundColor: '#111827' }}><h2 style={{ color: '#ffffff' }}>New Pricing</h2></section>`,
    }, context);
    applyChanges(replaceRes.changes);

    const updatedCode = files.get('app/page.client.tsx')!;
    const nodesAfter = parseJSXToNodes(updatedCode);
    expect(nodesAfter.has(oldPricingId)).toBe(false);
    expect(replaceRes.replacedId).toBe(oldPricingId);
    expect(nodesAfter.get('root')?.children).toEqual([existingHeaderId, heroId, replaceRes.rootId, footerId]);
    expect(nodesAfter.get(existingHeaderId)?.styles.order).toBe('0');
    expect(nodesAfter.get(heroId)?.styles.order).toBe('1');
    expect(nodesAfter.get(replaceRes.rootId)?.styles.order).toBe('2');
    expect(nodesAfter.get(footerId)?.styles.order).toBe('3');
    expect(updatedCode).not.toContain('Old Pricing');
    expect(updatedCode).toContain('New Pricing');
  });
});
