import { describe, expect, it } from 'vitest';
import capturedUnderline from './fixtures/captured-underline.json';
import capturedComponents from './fixtures/captured-components.json';
import capturedCms from './fixtures/captured-cms.json';
import {
  inspectNativeTransfer,
  extractTransferTokens,
  extractTransferSlice,
  extractTransferCms,
} from './agent-slice';

describe('agent-slice: inspectNativeTransfer', () => {
  it('summarizes captured-underline transfer accurately', () => {
    const summary = inspectNativeTransfer(capturedUnderline);
    expect(summary.provenance.projectId).toBe('fixture-project');
    expect(summary.provenance.mode).toBe('component');
    expect(summary.components.length).toBe(1);
    expect(summary.components[0].name).toBe('Underline Link (Line Out)');
    expect(summary.components[0].variantCount).toBe(6);
    expect(summary.components[0].variants).toContain('Regular');
    expect(summary.components[0].variants).toContain('Large');
  });

  it('summarizes captured-components with tokens and collections', () => {
    const summary = inspectNativeTransfer(capturedComponents);
    expect(summary.provenance.projectId).toBe('fixture-project');
    expect(summary.components.some(c => c.name === 'Project Card')).toBe(true);
    expect(summary.tokens.colors).toBeGreaterThanOrEqual(2);
    expect(summary.tokens.typography).toBeGreaterThanOrEqual(1);
    expect(summary.cms.some(c => c.name === 'Category')).toBe(true);
  });

  it('summarizes captured-cms with all collections', () => {
    const summary = inspectNativeTransfer(capturedCms);
    expect(summary.cms.length).toBeGreaterThanOrEqual(3);
    const names = summary.cms.map(c => c.name);
    expect(names).toContain('Works');
    expect(names).toContain('Category');
    expect(names).toContain('Services');
  });
});

describe('agent-slice: extractTransferTokens', () => {
  it('extracts color and typography tokens from captured-components', () => {
    const tokens = extractTransferTokens(capturedComponents);
    expect(tokens.colors.length).toBeGreaterThanOrEqual(2);
    const grey = tokens.colors.find(c => c.name.toLowerCase().includes('grey') || c.sourceName?.includes('Grey'));
    expect(grey).toBeDefined();
    expect(grey?.value).toBeTruthy();

    expect(tokens.typography.length).toBeGreaterThanOrEqual(1);
    const bodyFaded = tokens.typography.find(t => t.name.toLowerCase().includes('body') || t.sourceName?.includes('Body Faded'));
    expect(bodyFaded).toBeDefined();
    // Verify normalized values without comma artifacts
    for (const typo of tokens.typography) {
      if (typo.lineHeight) expect(typo.lineHeight).not.toContain(',');
      if (typo.letterSpacing) expect(typo.letterSpacing).not.toContain(',');
    }
  });

  it('normalizes tuple lineHeight/letterSpacing and resolves BI; built-in font families', () => {
    const mockTransfer = {
      ...capturedComponents,
      definitions: [
        ...(capturedComponents as any).definitions,
        {
          id: 'customTypo',
          kind: 'TextStylePresetNode',
          data: {
            __class: 'TextStylePresetNode',
            id: 'customTypo',
            name: 'Hero Heading',
            font: 'BI;Open Sauce Two/Medium/v0',
            fontSize: 120,
            lineHeight: [1.1, 'em'],
            letterSpacing: [-0.03, 'em'],
          },
        },
      ],
      rootIds: [...(capturedComponents as any).rootIds, 'customTypo'],
    };
    const tokens = extractTransferTokens(mockTransfer);
    const custom = tokens.typography.find(t => t.id === 'customTypo');
    expect(custom).toBeDefined();
    expect(custom?.fontSize).toBe('120px');
    expect(custom?.lineHeight).toBe('1.1');
    expect(custom?.letterSpacing).toBe('-0.03em');
    expect(custom?.fontFamily).toBe('Open Sauce Two');
    expect(custom?.fontWeight).toBe('500');
  });
});

describe('agent-slice: extractTransferSlice', () => {
  it('extracts a clean semantic slice from captured-underline component', () => {
    // f03DgVEM5 is the SmartComponentNode root
    const slice = extractTransferSlice(capturedUnderline, 'f03DgVEM5');
    expect(slice.id).toBe('f03DgVEM5');
    expect(slice.name).toBe('Underline Link (Line Out)');
    expect(slice.children.length).toBeGreaterThan(0);

    // First child is a FrameNode (variant or container)
    const child = slice.children[0];
    expect(child.styles).toBeDefined();
    expect(typeof child.styles).toBe('object');
    // Ensure noise/internal Framer metadata is not leaking in styles
    expect(child.styles.__class).toBeUndefined();
    expect(child.styles.replicaInfo).toBeUndefined();
  });

  it('resolves text node content inside a slice', () => {
    const slice = extractTransferSlice(capturedUnderline, 'f03DgVEM5');
    // Find any text child recursively
    const findText = (node: typeof slice): string | undefined => {
      if (node.text) return node.text;
      for (const c of node.children) {
        const found = findText(c);
        if (found) return found;
      }
      return undefined;
    };
    const textContent = findText(slice);
    expect(typeof textContent).toBe('string');
  });

  it('inlines local canvas component instances recursively with controls, text, and links', () => {
    // Create a mock transfer with a page that instantiates a component via CodeComponentNode
    const mockTransfer = {
      ...capturedComponents,
      definitions: [
        ...(capturedComponents as any).definitions,
        {
          id: 'testPage',
          kind: 'WebPageNode',
          data: {
            id: 'testPage',
            __class: 'WebPageNode',
            name: 'Home',
            children: [
              {
                id: 'testDesktop',
                __class: 'FrameNode',
                name: 'Desktop',
                children: [
                  {
                    id: 'headerInst',
                    __class: 'CodeComponentNode',
                    codeComponentIdentifier: 'local-module:canvasComponent/cardComp:default',
                    $control__heading: { type: 'string', value: 'Hero Title' },
                    $control__ctaLink: { type: 'link', value: { type: 'url', url: 'https://example.com' } },
                    children: [],
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'cardComp',
          kind: 'SmartComponentNode',
          data: {
            id: 'cardComp',
            __class: 'SmartComponentNode',
            name: 'HeaderCard',
            baseVariantId: 'cardVariantDesktop',
            variables: [
              { id: 'heading', name: 'Heading', type: 'string', initialValue: 'Default Heading' },
              { id: 'ctaLink', name: 'CTA Link', type: 'link', initialValue: '' },
            ],
            children: [
              {
                id: 'cardVariantDesktop',
                __class: 'FrameNode',
                name: 'Desktop',
                children: [
                  {
                    id: 'headingNode',
                    __class: 'RichTextNode',
                    name: 'Title',
                    textContent: { type: 'variableReference', id: 'heading' },
                    children: [],
                  },
                ],
              },
            ],
          },
        },
      ],
      rootIds: [...(capturedComponents as any).rootIds, 'testPage', 'cardComp'],
    };

    const summary = inspectNativeTransfer(mockTransfer);
    const testPageSummary = summary.pages.find(p => p.id === 'testPage');
    expect(testPageSummary).toBeDefined();
    expect(testPageSummary?.components).toBeDefined();
    expect(testPageSummary?.components?.some(c => c.id === 'cardComp' && c.name === 'HeaderCard')).toBe(true);

    const slice = extractTransferSlice(mockTransfer, 'testPage');
    expect(slice.children.length).toBeGreaterThan(0);
    const desktopSlice = slice.children[0];
    expect(desktopSlice.children.length).toBeGreaterThan(0);
    const headerSlice = desktopSlice.children[0];
    expect(headerSlice.componentId).toBe('cardComp');
    expect(headerSlice.componentName).toBe('HeaderCard');
    expect(headerSlice.link?.href).toBe('https://example.com');
    expect(headerSlice.children.length).toBeGreaterThan(0);
    const headingSlice = headerSlice.children[0];
    expect(headingSlice.text).toBe('Hero Title');
  });
});

describe('agent-slice: extractTransferCms', () => {
  it('extracts collections with schema fields and item data from captured-cms', () => {
    const cms = extractTransferCms(capturedCms);
    expect(cms.collections.length).toBeGreaterThanOrEqual(3);

    const works = cms.collections.find(c => c.name === 'Works');
    expect(works).toBeDefined();
    expect(works?.fields.length).toBeGreaterThan(0);
    expect(works?.items.length).toBeGreaterThan(0);

    // Verify item data contains populated fields
    const firstItem = works?.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.slug).toBeTruthy();
    expect(Object.keys(firstItem?.data || {}).length).toBeGreaterThan(0);
  });

  it('filters by collectionId when specified', () => {
    const cms = extractTransferCms(capturedCms, 'DwP_tmnNO');
    expect(cms.collections.length).toBe(1);
    expect(cms.collections[0].id).toBe('DwP_tmnNO');
    expect(cms.collections[0].name).toBe('Category');
  });
});
