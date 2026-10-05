import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseComponentControlsMeta } from '@/code/components/controls-parser';
import { compileCodeComponent } from '@/canvas/code-component-runtime';
import { checkFile } from '@/code/oracle/check-file';
import { ACCORDION_COMPONENT } from './index';

describe('Accordion template', () => {
  it('exposes @label, @comment and the accordion controls including objectList items', () => {
    const meta = parseComponentControlsMeta(ACCORDION_COMPONENT);
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe('Accordion');
    expect(meta!.comment).toBeTruthy();
    expect(Object.keys(meta!.controls)).toEqual([
      'items', 'allowMultiple', 'gap',
      'background', 'textColor', 'answerColor',
      'iconBackground', 'iconColor',
      'borderColor', 'borderRadius', 'fontSize',
    ]);
    expect(meta!.controls.items.type).toBe('objectList');
    expect(meta!.controls.items.item?.controls.question.type).toBe('text');
    expect(meta!.controls.items.item?.controls.answer.type).toBe('text');
  });

  it('exports default via withResponsiveProps', () => {
    expect(ACCORDION_COMPONENT).toMatch(/export default withResponsiveProps\(Accordion\);/);
  });

  it('passes the oracle as a code component', () => {
    const v = checkFile(ACCORDION_COMPONENT, { kind: 'code-component', path: 'components/Accordion.tsx' });
    expect(v).toEqual([]);
  });

  it('compiles and smoke-renders with default props', async () => {
    const Comp = compileCodeComponent(ACCORDION_COMPONENT, 'Accordion', { previewMode: false });
    expect(Comp).toBeTruthy();
    const html = renderToStaticMarkup(createElement(Comp as any));
    expect(html).toContain('What is Framer?');
    expect(html).toContain('Framer is a design tool');
    expect(html).toContain('Can I add more questions?');
  });

  it('keeps answers of closed items in the DOM for SEO indexing', async () => {
    const Comp = compileCodeComponent(ACCORDION_COMPONENT, 'Accordion', { previewMode: false });
    const html = renderToStaticMarkup(createElement(Comp as any));
    // Item 1 is closed by default, but its answer must still be present in the HTML output
    expect(html).toContain('Yes! In the Properties panel');
    expect(html).toContain('aria-hidden="true"');
  });
});
