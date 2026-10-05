import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileCodeComponent } from '@/canvas/code-component-runtime';
import { checkFile } from '@/code/oracle/check-file';
import { MARKDOWN_ARTICLE_COMPONENT } from './MarkdownArticle';

describe('MarkdownArticle template', () => {
  it('passes the oracle as an installable code component', () => {
    expect(checkFile(MARKDOWN_ARTICLE_COMPONENT, {
      kind: 'code-component', path: 'components/MarkdownArticle.tsx',
    })).toEqual([]);
  });

  it('compiles and renders the sample article', () => {
    const Component = compileCodeComponent(MARKDOWN_ARTICLE_COMPONENT, 'MarkdownArticle', { previewMode: false });
    expect(Component).toBeTruthy();
    const markup = renderToStaticMarkup(createElement(Component!));
    expect(markup).toContain('Main Article Title');
    expect(markup).toContain('<h3');
  });

  it('renders multiline CMS content with headings and inline formatting', () => {
    const Component = compileCodeComponent(MARKDOWN_ARTICLE_COMPONENT, 'MarkdownArticle', { previewMode: false });
    expect(Component).toBeTruthy();
    const markup = renderToStaticMarkup(createElement(Component!, {
      content: '## CMS title\n\n### Section\n\nA **bold** paragraph.',
    }));
    expect(markup).toContain('CMS title');
    expect(markup).toContain('<h2');
    expect(markup).toContain('<h3');
    expect(markup).toContain('<strong');
    expect(markup).not.toContain('Main Article Title');
  });
});
