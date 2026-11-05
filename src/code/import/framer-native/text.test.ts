import { describe, expect, it } from 'vitest';
import { parseJSX } from '../../parsing/ast-utils';
import { mapSourceText, mapSourceTypography } from './text';
import { buildSourceGraph, resolveSourceNode } from './source-graph';
import type { ResolvedSourceNode, TransferDiagnostic } from './types';
const node = (html: string, extra = {}): ResolvedSourceNode => ({ id: 'text', sourceId: 'text', kind: 'RichTextNode', properties: { html, ...extra }, children: [], provenance: ['text'] });
const context = () => ({ diagnostics: [] as TransferDiagnostic[] });

describe('editable original rich text', () => {
  it('binds the master preset while keeping a replica font-size override', () => {
    const source = { format: 'revyme.framer.native', version: 1, complete: true, diagnostics: [], context: { projectId: 'source', branchId: 'main', revision: '1', editorBuild: 'test', scopeId: 'text', mode: 'selection' }, rootIds: ['text'], definitions: [
      { id: 'text', kind: 'RichTextNode', data: { id: 'text', __class: 'RichTextNode', html: '<p data-styles-preset="replica">Title</p>', children: [] } },
      { id: 'master', kind: 'TextStylePresetNode', data: { id: 'master', __class: 'TextStylePresetNode', name: 'Heading', font: 'GF;Zalando Sans-450', fontSize: '64px', children: [] } },
      { id: 'replica', kind: 'TextStylePresetNode', data: { id: 'replica', __class: 'TextStylePresetNode', name: 'Heading', fontSize: '32px', replicaInfo: { master: 'master', overrides: { master: { fontSize: '32px' } } }, children: [] } },
    ], assets: [] };
    const graph = buildSourceGraph(source as never);
    const result = mapSourceText(resolveSourceNode(graph, 'text'), { graph, typographyIdentity: { master: 'framer-master' }, diagnostics: [] });
    expect(result.styles.fontFamily).toBe('var(--typo-framer-heading-master-font)');
    expect(result.styles.fontSize).toBe('32px');
  });
  it('uses the actual font CSS while treating --font-selector as editor metadata', () => {
    const c = context();
    const text = mapSourceText(node('<p style="--framer-font-family: Zalando Sans, sans-serif; --font-selector: R0Y7WmFsYW5kbyBTYW5zLTgwMA==; --framer-font-weight: 800">Title</p>'), c);
    expect(text.styles).toEqual({ fontFamily: 'Zalando Sans, sans-serif', fontWeight: '800' });
    expect(c.diagnostics).toEqual([]);
    const unresolved = context();
    mapSourceText(node('<p style="--font-selector: original-font-id; --foreign-css: 10px">Title</p>'), unresolved);
    expect(unresolved.diagnostics.map(item => item.property)).toEqual(expect.arrayContaining(['--font-selector', '--foreign-css']));
  });
  it.each([['0.8em', '0.8'], ['150%', '1.5'], ['30px', '1.25']])('normalizes inline line-height %s to the native ratio %s', (height, ratio) => {
    const text = mapSourceText(node(`<p style="--framer-font-size: 24px; --framer-line-height: ${height}">Title</p>`), context());
    expect(text.styles.lineHeight).toBe(ratio);
  });
  it('preserves literal braces, entities, whitespace and inline links in valid JSX', () => {
    const text = mapSourceText(node('<p>A &amp; B {draft} <a href="/works?a=1&amp;b=2">more</a><br>next</p>'), context());
    expect(text.plainText).toBe('A & B {draft} more\nnext');
    expect(text.tag).toBe('p');
    expect(text.jsx).toContain('&#123;draft&#125;');
    expect(text.jsx).toContain('href="/works?a=1&amp;b=2"');
    expect(parseJSX(`<div>${text.jsx}</div>`)).not.toBeNull();
  });
  it('maps preset identity and inline Framer typography to native styles', () => {
    const text = mapSourceText(node('<h2 data-styles-preset="heading" style="--framer-font-size: 64px; --framer-text-color: rgb(0, 0, 0)">Title</h2>'), context());
    expect(text.presetId).toBe('heading');
    expect(text.styles).toMatchObject({ fontSize: '64px', color: 'rgb(0, 0, 0)' });
    expect(text.jsx).not.toContain('--framer-');
  });
  it('retains original variable bindings instead of replacing them with the preview text', () => {
    const binding = { type: 'variableReference', providerId: 'component', id: 'label' };
    const text = mapSourceText(node('<p>Preview</p>', { textContent: binding }), context());
    expect(text.binding).toEqual(binding);
    expect(text.plainText).toBe('Preview');
  });
  it('keeps multiple blocks as separate editable paragraphs', () => {
    const text = mapSourceText(node('<p>First</p><p><strong>Second</strong></p>'), context());
    expect(text.tag).toBe('div');
    expect(text.plainText).toBe('First\nSecond');
    expect(text.jsx).toContain('<p>');
    expect(text.runs.map(run => run.text)).toEqual(['First', 'Second']);
    const identified = mapSourceText(node('<p dir="auto">First</p><p dir="auto"><strong>Second</strong></p>'), context(), 'framer-rich');
    expect(identified.blockIds).toEqual(['framer-rich-block-1', 'framer-rich-block-2']);
    expect(identified.jsx).toContain('<p data-id="framer-rich-block-1" dir="auto">First</p><p data-id="framer-rich-block-2" dir="auto"><strong>Second</strong></p>');
  });
  it('retains the direction and link attributes of the outer text block', () => {
    expect(mapSourceText(node('<p dir="rtl">שלום</p>'), context()).attributes).toEqual({ dir: 'rtl' });
    expect(mapSourceText(node('<a href="/works" target="_blank" rel="noopener">Work</a>'), context()).attributes).toEqual({ href: '/works', target: '_blank', rel: 'noopener' });
  });
  it('rejects executable HTML, unsafe links and unrecognized text semantics explicitly', () => {
    const c = context();
    const text = mapSourceText(node('<p onclick="alert(1)"><script>bad()</script><a href="javascript:bad()">Link</a></p>'), c);
    expect(text.jsx).not.toContain('javascript:');
    expect(text.jsx).not.toContain('<script');
    expect(text.jsx).not.toContain('onclick');
    expect(c.diagnostics.length).toBeGreaterThanOrEqual(3);
    expect(c.diagnostics.every(d => d.sourceId === 'text')).toBe(true);
  });
  it('preserves font variation axes, features and observed decoration styles', () => {
    const font = mapSourceTypography({ font: 'GF;Zalando Sans-variable-regularVF=IndkdGgiIDEwMCwgIndnaHQiIDQ1MA==', fontSize: '22px', lineHeight: [1.4, 'em'], letterSpacing: [-0.02, 'em'], openTypeFontFeatures: ['blwf', 'cv09'] });
    expect(font).toMatchObject({ fontFamily: '"Zalando Sans"', fontSize: '22px', fontWeight: '450', fontVariationSettings: '"wdth" 100', letterSpacing: '-0.02em', lineHeight: '1.4', fontFeatureSettings: '"blwf", "cv09"' });
    const c = context();
    expect(mapSourceText(node('<p style="--framer-text-decoration-thickness: 2px; --framer-font-open-type-features: &quot;cv09&quot;">Link</p>'), c).styles).toMatchObject({ textDecorationThickness: '2px', fontFeatureSettings: '"cv09"' });
    expect(c.diagnostics).toEqual([]);
  });
});
