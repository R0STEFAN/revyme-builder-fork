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

  it.each([
    { width: '100%', height: 'min-content' },
    { width: 'min-content', height: 'min-content' },
    { flex: '1 0 0px', height: '240px' },
  ])('preserves editor sizing while retaining the article defaults: %o', (style) => {
    const Component = compileCodeComponent(MARKDOWN_ARTICLE_COMPONENT, 'MarkdownArticle', { previewMode: false });
    const markup = renderToStaticMarkup(createElement(Component!, { content: 'Article body', style }));
    const container = document.createElement('div');
    container.innerHTML = markup;
    const article = container.querySelector('article')!;
    expect(article.style.boxSizing).toBe('border-box');
    expect(article.style.padding).toBe('16px 0px');
    expect(article.style.maxWidth).toBe('760px');
    for (const [key, value] of Object.entries(style)) {
      expect((article.style as unknown as Record<string, string>)[key]).toBe(value);
    }
  });

  it('lets editor styles override the configured article width limit', () => {
    const Component = compileCodeComponent(MARKDOWN_ARTICLE_COMPONENT, 'MarkdownArticle', { previewMode: false });
    const override = renderToStaticMarkup(createElement(Component!, { content: 'Article', maxWidth: 640, style: { maxWidth: '100%' } }));
    expect(override).toContain('max-width:100%');
    expect(override).toContain('box-sizing:border-box');
  });

});
