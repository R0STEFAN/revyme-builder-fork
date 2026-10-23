// packages/automation-core/test/acceptance/L01-landing.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { projectFS } from '@/code/project/project-fs';

// Operations used in L01
import { tokensSetOperation, tokensValidateOperation } from '../../src/operations/tokens';
import { typographySetOperation, typographyApplyOperation } from '../../src/operations/typography';
import { pagesCreateOperation } from '../../src/operations/pages';
import { nodesCreateOperation, nodesReorderOperation, nodesWrapOperation } from '../../src/operations/nodes';
import { stylesSetOperation } from '../../src/operations/styles';
import { layoutSetOperation } from '../../src/operations/layout';
import { textSetOperation } from '../../src/operations/text';
import { viewportsSetOverrideOperation } from '../../src/operations/viewports';
import { componentsCreateOperation } from '../../src/operations/components';
import { componentsInstanceCreateOperation } from '../../src/operations/component-props';
import { variantsCreateOperation, variantsVisibilitySetOperation } from '../../src/operations/variants';
import { linksSetOperation } from '../../src/operations/links';
import { overlaysCreateOperation } from '../../src/operations/overlays';
import { slotsConnectOperation } from '../../src/operations/slots';
import { formsCreateOperation, formsDestinationSetOperation } from '../../src/operations/forms';
import { formsFieldAddOperation, formsSubmitButtonAddOperation } from '../../src/operations/form-fields';
import { metadataUpdateOperation, metadataReadOperation } from '../../src/operations/metadata';
import { observeAuditOperation, observeLayoutOperation } from '../../src/operations/observe';

function createMockContext(): OperationContext {
  let counter = 0;
  return {
    createId: (prefix = 'node') => `${prefix}-l01-${++counter}`,
    signal: new AbortController().signal,
    trace: () => {},
    adapters: {},
  };
}

function applyChanges(snapshot: Snapshot, changes?: FileChange[]): Snapshot {
  if (!changes || changes.length === 0) return snapshot;
  const nextFiles = new Map(snapshot.files);
  for (const ch of changes) {
    if (ch.content === null) {
      nextFiles.delete(ch.path);
      projectFS.deleteFile(ch.path);
    } else {
      nextFiles.set(ch.path, ch.content);
      projectFS.writeFile(ch.path, ch.content);
    }
  }
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    files: nextFiles,
  };
}

describe('L01 Acceptance Suite: End-to-End Marketing Landing Page Assembly', () => {
  let snapshot: Snapshot;
  let context: OperationContext;

  const INITIAL_LAYOUT = `import React from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  );
}
`;

  const INITIAL_GLOBALS_CSS = `:root {
  --color-primary: #3b82f6;
  --color-bg: #ffffff;
  --color-text: #111827;
}
`;

  beforeEach(() => {
    context = createMockContext();
    const files = new Map<string, string>();
    files.set('app/layout.tsx', INITIAL_LAYOUT);
    files.set('app/globals.css', INITIAL_GLOBALS_CSS);

    for (const [p, c] of files) {
      projectFS.writeFile(p, c);
    }

    snapshot = createSnapshot(
      { projectId: 'l01-landing-project', branchId: 'main' },
      1,
      files
    );
  });

  it('assembles a full responsive marketing landing page with design tokens, reusable components, variants, forms, and metadata', async () => {
    // -------------------------------------------------------------------------
    // Phase 1: Tokens and Typography Setup (T08)
    // -------------------------------------------------------------------------
    const tokenPrimary = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'brand-primary',
        value: '#2563EB',
        darkValue: '#3B82F6',
        category: 'color',
      },
      context
    );
    snapshot = applyChanges(snapshot, tokenPrimary.changes);

    const tokenBg = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'brand-bg',
        value: '#0F172A',
        darkValue: '#020617',
        category: 'color',
      },
      context
    );
    snapshot = applyChanges(snapshot, tokenBg.changes);

    const tokenText = await tokensSetOperation.execute(
      snapshot,
      {
        name: 'brand-text',
        value: '#F8FAFC',
        darkValue: '#FFFFFF',
        category: 'color',
      },
      context
    );
    snapshot = applyChanges(snapshot, tokenText.changes);

    // Validate tokens in globals.css
    const tokenValidation = await tokensValidateOperation.execute(snapshot, {}, context);
    expect(tokenValidation.isValid).toBe(true);

    // Setup typography preset
    const typoRes = await typographySetOperation.execute(
      snapshot,
      {
        name: 'hero-headline',
        tag: 'h1',
        values: {
          font: 'Inter',
          size: '48px',
          weight: '800',
          'line-height': '1.15',
          spacing: '-0.02em',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, typoRes.changes);

    // -------------------------------------------------------------------------
    // Phase 2: Page Route & Shell Creation (T06)
    // -------------------------------------------------------------------------
    const pageRes = await pagesCreateOperation.execute(
      snapshot,
      { slug: '', title: 'Revyme - Code-First Visual Builder' },
      context
    );
    snapshot = applyChanges(snapshot, pageRes.changes);

    const targetFile = 'app/page.client.tsx';
    expect(snapshot.files.has(targetFile)).toBe(true);

    const initialNodes = parseJSXToNodes(snapshot.files.get(targetFile)!);
    const rootNode = Array.from(initialNodes.values()).find((n) => !n.parentId);
    const rootId = rootNode?.id || 'root';

    // -------------------------------------------------------------------------
    // Phase 3: Shared Navigation & Mobile Drawer (T07, T10)
    // -------------------------------------------------------------------------
    // Create Header / Nav container
    const navRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'header',
        name: 'Navbar',
        styles: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 32px',
          width: '100%',
          backgroundColor: 'var(--brand-bg)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, navRes.changes);
    const navId = navRes.nodeId;

    // Brand logo
    const logoRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: navId,
        type: 'div',
        name: 'Logo',
        styles: {
          fontSize: '20px',
          fontWeight: '700',
          color: 'var(--brand-text)',
        },
        textContent: 'Revyme',
      },
      context
    );
    snapshot = applyChanges(snapshot, logoRes.changes);

    // Desktop nav links container
    const linksNavRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: navId,
        type: 'nav',
        name: 'Desktop Nav',
        styles: {
          display: 'flex',
          gap: '24px',
          alignItems: 'center',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, linksNavRes.changes);
    const linksNavId = linksNavRes.nodeId;

    // Add navigation link
    const linkFeaturesRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: linksNavId,
        type: 'a',
        name: 'Link Features',
        styles: { color: 'var(--brand-text)', textDecoration: 'none' },
        textContent: 'Features',
      },
      context
    );
    snapshot = applyChanges(snapshot, linkFeaturesRes.changes);
    const linkFeaturesId = linkFeaturesRes.nodeId;

    // Wire link href
    const linkSetRes = await linksSetOperation.execute(
      snapshot,
      {
        targetFile,
        nodeId: linkFeaturesId,
        url: '#features',
      },
      context
    );
    snapshot = applyChanges(snapshot, linkSetRes.changes);

    // Mobile Hamburger button
    const hamburgerRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: navId,
        type: 'button',
        name: 'Hamburger Button',
        styles: {
          display: 'none',
          padding: '8px',
          color: 'var(--brand-text)',
        },
        textContent: '☰',
      },
      context
    );
    snapshot = applyChanges(snapshot, hamburgerRes.changes);
    const hamburgerId = hamburgerRes.nodeId;

    // Mobile Drawer Overlay
    const overlayRes = await overlaysCreateOperation.execute(
      snapshot,
      {
        targetFile,
        triggerId: hamburgerId,
        type: 'fixed',
        side: 'right',
      },
      context
    );
    snapshot = applyChanges(snapshot, overlayRes.changes);
    expect(overlayRes.overlayId).toBeDefined();

    // -------------------------------------------------------------------------
    // Phase 4: Hero Section with CTA & Video/Media Fill (T07, T12)
    // -------------------------------------------------------------------------
    const heroRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'section',
        name: 'Hero Section',
        styles: {
          position: 'relative',
          padding: '100px 32px',
          textAlign: 'center',
          backgroundColor: 'var(--brand-bg)',
          width: '100%',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, heroRes.changes);
    const heroId = heroRes.nodeId;

    // Headline with applied typography
    const headlineRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: heroId,
        type: 'h1',
        name: 'Hero Headline',
        textContent: 'Supercharge Your Web Workflow',
        styles: {
          color: 'var(--brand-text)',
          marginBottom: '20px',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, headlineRes.changes);
    const headlineId = headlineRes.nodeId;

    const typoApply = await typographyApplyOperation.execute(
      snapshot,
      {
        targetFile,
        nodeId: headlineId,
        name: 'hero-headline',
      },
      context
    );
    snapshot = applyChanges(snapshot, typoApply.changes);

    // Subtitle
    const subheadRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: heroId,
        type: 'p',
        name: 'Hero Subheading',
        textContent: 'A visual Next.js builder that generates real clean code.',
        styles: {
          fontSize: '18px',
          color: '#94a3b8',
          maxWidth: '600px',
          margin: '0 auto 32px auto',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, subheadRes.changes);

    // CTA Button
    const ctaRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: heroId,
        type: 'button',
        name: 'Hero CTA',
        textContent: 'Get Started Free',
        styles: {
          backgroundColor: 'var(--brand-primary)',
          color: '#ffffff',
          padding: '14px 32px',
          borderRadius: '8px',
          fontWeight: '600',
          cursor: 'pointer',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, ctaRes.changes);

    // -------------------------------------------------------------------------
    // Phase 5: Reusable Feature Card Component & Grid Layout (T09)
    // -------------------------------------------------------------------------
    const featureCardComp = await componentsCreateOperation.execute(
      snapshot,
      {
        name: 'FeatureCard',
        props: [
          { name: 'title', type: 'string', default: 'Lightning Fast' },
          { name: 'description', type: 'string', default: 'Optimized performance out of the box.' },
        ],
        layout: [
          {
            tag: 'h3',
            text: '{title}',
            dataId: 'fc-title',
            style: { fontSize: '20px', fontWeight: 'bold', color: '#111' },
          },
          {
            tag: 'p',
            text: '{description}',
            dataId: 'fc-desc',
            style: { color: '#666', marginTop: '8px' },
          },
        ],
      },
      context
    );
    snapshot = applyChanges(snapshot, featureCardComp.changes);
    expect(snapshot.files.has('components/FeatureCard.tsx')).toBe(true);

    // Features Section & Grid Container
    const featSectionRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'section',
        name: 'Features Section',
        styles: {
          padding: '80px 32px',
          backgroundColor: '#ffffff',
          width: '100%',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, featSectionRes.changes);
    const featSectionId = featSectionRes.nodeId;

    const gridRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: featSectionId,
        type: 'div',
        name: 'Features Grid',
        styles: {
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px',
          maxWidth: '1200px',
          margin: '0 auto',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, gridRes.changes);
    const gridId = gridRes.nodeId;

    // Place 3 FeatureCard instances
    const card1 = await componentsInstanceCreateOperation.execute(
      snapshot,
      {
        targetFile,
        parentId: gridId,
        componentName: 'FeatureCard',
        props: {
          title: 'Code-First Simplicity',
          description: 'No proprietary format. Pure React & Next.js AST.',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, card1.changes);

    const card2 = await componentsInstanceCreateOperation.execute(
      snapshot,
      {
        targetFile,
        parentId: gridId,
        componentName: 'FeatureCard',
        props: {
          title: 'Design Systems',
          description: 'Tokens, themes, responsive viewports, and fonts.',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, card2.changes);

    const card3 = await componentsInstanceCreateOperation.execute(
      snapshot,
      {
        targetFile,
        parentId: gridId,
        componentName: 'FeatureCard',
        props: {
          title: 'Headless Automation',
          description: 'Autonomous agents and MCP v2 tools manipulate code.',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, card3.changes);

    // -------------------------------------------------------------------------
    // Phase 6: Metrics / Stats Container (T07)
    // -------------------------------------------------------------------------
    const metricsRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'div',
        name: 'Metrics Section',
        styles: {
          display: 'flex',
          justifyContent: 'space-around',
          padding: '60px 32px',
          backgroundColor: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          borderBottom: '1px solid #e2e8f0',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, metricsRes.changes);
    const metricsId = metricsRes.nodeId;

    const statItem1 = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: metricsId,
        type: 'div',
        name: 'Stat 1',
        textContent: '100% Next.js Output',
        styles: { fontSize: '24px', fontWeight: '700', textAlign: 'center' },
      },
      context
    );
    snapshot = applyChanges(snapshot, statItem1.changes);

    const statItem2 = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: metricsId,
        type: 'div',
        name: 'Stat 2',
        textContent: '275+ Automation Tools',
        styles: { fontSize: '24px', fontWeight: '700', textAlign: 'center' },
      },
      context
    );
    snapshot = applyChanges(snapshot, statItem2.changes);

    // -------------------------------------------------------------------------
    // Phase 7: Pricing Section with Variants (T10)
    // -------------------------------------------------------------------------
    const pricingRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'section',
        name: 'Pricing Section',
        styles: {
          padding: '80px 32px',
          textAlign: 'center',
          backgroundColor: '#ffffff',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, pricingRes.changes);
    const pricingId = pricingRes.nodeId;

    const pricingCardRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: pricingId,
        type: 'div',
        name: 'Pricing Card',
        styles: {
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '400px',
          margin: '0 auto',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, pricingCardRes.changes);
    const pricingCardId = pricingCardRes.nodeId;

    const priceTextRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: pricingCardId,
        type: 'div',
        name: 'Price Text',
        textContent: '$29 / month',
        styles: { fontSize: '32px', fontWeight: '800', color: '#1e293b' },
      },
      context
    );
    snapshot = applyChanges(snapshot, priceTextRes.changes);

    // -------------------------------------------------------------------------
    // Phase 8: Testimonials with Connected Slots (T11)
    // -------------------------------------------------------------------------
    const testSectionRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'section',
        name: 'Testimonials Section',
        styles: { padding: '80px 32px', backgroundColor: '#f1f5f9' },
      },
      context
    );
    snapshot = applyChanges(snapshot, testSectionRes.changes);
    const testSectionId = testSectionRes.nodeId;

    const quoteNodeRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: testSectionId,
        type: 'blockquote',
        name: 'Customer Quote',
        textContent: '"Revyme is hands down the best code-native website builder."',
        styles: { fontSize: '20px', fontStyle: 'italic', textAlign: 'center' },
      },
      context
    );
    snapshot = applyChanges(snapshot, quoteNodeRes.changes);
    const quoteId = quoteNodeRes.nodeId;

    // Connect slot for dynamic quote injection
    const slotRes = await slotsConnectOperation.execute(
      snapshot,
      {
        targetFile,
        componentId: testSectionId,
        canvasNodeId: quoteId,
      },
      context
    );
    snapshot = applyChanges(snapshot, slotRes.changes);
    expect(slotRes.connections).toContain(quoteId);

    // -------------------------------------------------------------------------
    // Phase 9: Contact Form with Validation & Destination (T19)
    // -------------------------------------------------------------------------
    const formSectionRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'section',
        name: 'Contact Section',
        styles: { padding: '80px 32px', backgroundColor: '#ffffff' },
      },
      context
    );
    snapshot = applyChanges(snapshot, formSectionRes.changes);
    const formSectionId = formSectionRes.nodeId;

    // Create form node
    const formRes = await formsCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: formSectionId,
        name: 'Inquiry Form',
      },
      context
    );
    snapshot = applyChanges(snapshot, formRes.changes);
    const formId = formRes.formId;

    // Add Name field
    const nameField = await formsFieldAddOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: formId,
        type: 'text',
        name: 'fullName',
        label: 'Your Name',
        placeholder: 'Jane Doe',
        required: true,
      },
      context
    );
    snapshot = applyChanges(snapshot, nameField.changes);

    // Add Email field
    const emailField = await formsFieldAddOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: formId,
        type: 'email',
        name: 'emailAddress',
        label: 'Email Address',
        placeholder: 'jane@example.com',
        required: true,
      },
      context
    );
    snapshot = applyChanges(snapshot, emailField.changes);

    // Add Message textarea field
    const msgField = await formsFieldAddOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: formId,
        type: 'textarea',
        name: 'messageBody',
        label: 'Project Details',
        placeholder: 'Tell us about your next project...',
        required: true,
      },
      context
    );
    snapshot = applyChanges(snapshot, msgField.changes);

    // Add Submit button
    const submitBtn = await formsSubmitButtonAddOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: formId,
        label: 'Send Inquiry',
      },
      context
    );
    snapshot = applyChanges(snapshot, submitBtn.changes);

    // Set Form destination
    const destRes = await formsDestinationSetOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: formId,
        emails: [{ recipient: 'inquiries@revyme.com' }],
        webhooks: [{ url: 'https://api.revyme.com/v1/inquiries' }],
        redirect: '/thank-you',
        antispam: 'block',
      },
      context
    );
    snapshot = applyChanges(snapshot, destRes.changes);
    expect(destRes.sendToCount).toBe(2);

    // -------------------------------------------------------------------------
    // Phase 10: Footer & SEO Social Metadata (T06)
    // -------------------------------------------------------------------------
    const footerRes = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        parentId: rootId,
        type: 'footer',
        name: 'Site Footer',
        styles: {
          padding: '40px 32px',
          backgroundColor: 'var(--brand-bg)',
          color: '#94a3b8',
          textAlign: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        },
        textContent: '© 2026 Revyme Inc. All rights reserved.',
      },
      context
    );
    snapshot = applyChanges(snapshot, footerRes.changes);

    // Update site metadata and social cards
    const metaRes = await metadataUpdateOperation.execute(
      snapshot,
      {
        targetFile: 'app/layout.tsx',
        metadata: {
          title: 'Revyme - Code-First Visual Website Builder',
          description: 'Build fast, responsive websites with visual editing that compiles to pure Next.js code.',
          openGraph: {
            title: 'Revyme - Code-First Visual Website Builder',
            description: 'The Next.js builder with zero vendor lock-in.',
            url: 'https://revyme.com',
            siteName: 'Revyme',
          },
          twitter: {
            card: 'summary_large_image',
            title: 'Revyme',
          },
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, metaRes.changes);

    // Read back metadata
    const metaRead = await metadataReadOperation.execute(snapshot, { targetFile: 'app/layout.tsx' }, context);
    expect(metaRead.metadata.title).toBe('Revyme - Code-First Visual Website Builder');

    // -------------------------------------------------------------------------
    // Phase 11: Responsive Viewport Overrides (T07)
    // -------------------------------------------------------------------------
    // Override Features Grid to 1 column on mobile (375px)
    const mobileOverride = await viewportsSetOverrideOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: gridId,
        viewport: 375,
        styles: {
          gridTemplateColumns: '1fr',
          padding: '16px',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, mobileOverride.changes);

    // Override Desktop Nav to hidden on mobile (375px)
    const navMobileOverride = await viewportsSetOverrideOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: linksNavId,
        viewport: 375,
        styles: { display: 'none' },
      },
      context
    );
    snapshot = applyChanges(snapshot, navMobileOverride.changes);

    // Override Hamburger to block on mobile (375px)
    const burgerMobileOverride = await viewportsSetOverrideOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: hamburgerId,
        viewport: 375,
        styles: { display: 'block' },
      },
      context
    );
    snapshot = applyChanges(snapshot, burgerMobileOverride.changes);

    // -------------------------------------------------------------------------
    // Phase 12: Observation, Auditing, and Verification (T24)
    // -------------------------------------------------------------------------
    const auditRes = await observeAuditOperation.execute(
      snapshot,
      { filePath: targetFile, viewport: 'desktop' },
      context
    );
    expect(auditRes).toBeDefined();
    expect(auditRes.viewport).toBe('desktop');

    const layoutRes = await observeLayoutOperation.execute(
      snapshot,
      { filePath: targetFile, viewport: 'desktop' },
      context
    );
    expect(layoutRes).toBeDefined();

    // -------------------------------------------------------------------------
    // Phase 13: AST Source Integrity & GUI Editability Roundtrip
    // -------------------------------------------------------------------------
    const finalPageCode = snapshot.files.get(targetFile)!;
    const finalNodes = parseJSXToNodes(finalPageCode);

    // Verify key nodes exist in the re-parsed AST
    expect(finalNodes.has(navId)).toBe(true);
    expect(finalNodes.has(heroId)).toBe(true);
    expect(finalNodes.has(featSectionId)).toBe(true);
    expect(finalNodes.has(gridId)).toBe(true);
    expect(finalNodes.has(formId)).toBe(true);

    // Perform an editor edit: change headline text and CTA color
    const textEditRes = await textSetOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: headlineId,
        textContent: 'The Ultimate Web Development Canvas',
      },
      context
    );
    snapshot = applyChanges(snapshot, textEditRes.changes);

    const styleEditRes = await stylesSetOperation.execute(
      snapshot,
      {
        filePath: targetFile,
        nodeId: ctaRes.nodeId,
        styles: {
          backgroundColor: '#10B981',
          boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.3)',
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, styleEditRes.changes);

    // Verify edits survived in final JSX source
    const updatedPageCode = snapshot.files.get(targetFile)!;
    expect(updatedPageCode).toContain('The Ultimate Web Development Canvas');
    expect(updatedPageCode).toContain('#10B981');
    expect(updatedPageCode).toContain('Inquiry Form');
  });
});
