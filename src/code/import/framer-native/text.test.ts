import { describe, expect, it } from 'vitest';
import { parseJSX } from '../../parsing/ast-utils';
import { mapSourceText, mapSourceTypography } from './text';
import type { ResolvedSourceNode, TransferDiagnostic } from './types';
const node = (html: string, extra = {}): ResolvedSourceNode => ({ id: 'text', sourceId: 'text', kind: 'RichTextNode', properties: { html, ...extra }, children: [], provenance: ['text'] });
const context = () => ({ diagnostics: [] as TransferDiagnostic[] });

describe('editable original rich text', () => {
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
