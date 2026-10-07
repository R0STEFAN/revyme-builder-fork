import { describe, it, expect } from 'vitest';
import {
  bindTextExpressionInCode,
  bindHrefExpressionInCode,
  unbindTextExpressionInCode,
  unbindHrefExpressionInCode,
} from './expression-gen';

describe('expression-gen', () => {
  const baseCode = `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="title">Hello World</h1>
      <a data-id="link" href="/default">Click me</a>
    </div>
  );
}
`;

  describe('bindTextExpressionInCode', () => {
    it('replaces text content with expression', () => {
      const result = bindTextExpressionInCode(
        baseCode,
        'title',
        'item.name + " у Запоріжжі"',
      );
      expect(result).toContain('<h1 data-id="title">{item.name + " у Запоріжжі"}</h1>');
    });

    it('injects useParams import and hook when params is referenced', () => {
      const result = bindTextExpressionInCode(
        baseCode,
        'title',
        'params.category + " тату"',
      );
      expect(result).toContain("import { useParams } from 'next/navigation';");
      expect(result).toContain('const params = useParams();');
      expect(result).toContain('<h1 data-id="title">{params.category + " тату"}</h1>');
    });
  });

  describe('bindHrefExpressionInCode', () => {
    it('replaces href with dynamic expression', () => {
      const result = bindHrefExpressionInCode(
        baseCode,
        'link',
        '"/gallery/men/" + item.slug',
      );
      expect(result).toContain('<a data-id="link" href={"/gallery/men/" + item.slug}>Click me</a>');
    });

    it('injects useParams when href expression references params', () => {
      const result = bindHrefExpressionInCode(
        baseCode,
        'link',
        '`/gallery/${params.category}/${item.slug}`',
      );
      expect(result).toContain("import { useParams } from 'next/navigation';");
      expect(result).toContain('const params = useParams();');
      expect(result).toContain('href={`/gallery/${params.category}/${item.slug}`}');
    });
    it('correctly replaces an existing template literal href without corruption', () => {
      const initial = bindHrefExpressionInCode(
        baseCode,
        'link',
        '`/gallery/${params.category}/${item.slug}`',
      );
      const replaced = bindHrefExpressionInCode(
        initial,
        'link',
        '"/gallery/men/" + item.slug',
      );
      expect(replaced).toContain('<a data-id="link" href={"/gallery/men/" + item.slug}>Click me</a>');
      expect(replaced).not.toContain('`}');
    });
  });

  describe('unbindTextExpressionInCode', () => {
    it('replaces expression with fallback text', () => {
      const withExpr = bindTextExpressionInCode(baseCode, 'title', 'item.name');
      const unbind = unbindTextExpressionInCode(withExpr, 'title', 'Static Title');
      expect(unbind).toContain('<h1 data-id="title">Static Title</h1>');
    });
  });

  describe('unbindHrefExpressionInCode', () => {
    it('replaces dynamic href with static href', () => {
      const withExpr = bindHrefExpressionInCode(baseCode, 'link', '"/gallery/" + item.slug');
      const unbind = unbindHrefExpressionInCode(withExpr, 'link', '/gallery/static');
      expect(unbind).toContain('href="/gallery/static"');
    });

    it('correctly unbinds a template literal href', () => {
      const withExpr = bindHrefExpressionInCode(baseCode, 'link', '`/gallery/${params.category}/${item.slug}`');
      const unbind = unbindHrefExpressionInCode(withExpr, 'link', '#');
      expect(unbind).toContain('href="#"');
      expect(unbind).not.toContain('`}');
    });
  });
});
