import { describe, it, expect } from 'vitest';
import {
  bindTextExpressionInCode,
  bindHrefExpressionInCode,
  bindSrcExpressionInCode,
  unbindTextExpressionInCode,
  unbindHrefExpressionInCode,
  unbindSrcExpressionInCode,
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

  describe('bindSrcExpressionInCode', () => {
    const codeWithImg = `'use client';
export default function Page() {
  return (
    <div data-id="root">
      <img data-id="avatar" src="/default.png" alt="Avatar" />
    </div>
  );
}`;

    it('binds image src with template literal expression', () => {
      const result = bindSrcExpressionInCode(
        codeWithImg,
        'avatar',
        '`https://directus.example.com/assets/${item.image_id}`',
      );
      expect(result).toContain('src={`https://directus.example.com/assets/${item.image_id}`}');
      expect(result).not.toContain('src="/default.png"');
    });

    it('replaces an existing expression on src without leaving syntax fragments', () => {
      const initial = bindSrcExpressionInCode(
        codeWithImg,
        'avatar',
        '`https://directus.example.com/assets/${item.image_id}`',
      );
      const replaced = bindSrcExpressionInCode(
        initial,
        'avatar',
        'item.photo',
      );
      expect(replaced).toContain('src={item.photo}');
      expect(replaced).not.toContain('https://directus.example.com');
    });
  });

  describe('unbindSrcExpressionInCode', () => {
    const codeWithImg = `'use client';
export default function Page() {
  return (
    <div data-id="root">
      <img data-id="avatar" src="/default.png" alt="Avatar" />
    </div>
  );
}`;

    it('unbounds dynamic template literal src to static fallback', () => {
      const withExpr = bindSrcExpressionInCode(
        codeWithImg,
        'avatar',
        '`https://directus.example.com/assets/${item.image_id}`',
      );
      const unbound = unbindSrcExpressionInCode(withExpr, 'avatar', '/placeholder.jpg');
      expect(unbound).toContain('src="/placeholder.jpg"');
      expect(unbound).not.toContain('item.image_id');
    });
  });

  describe('module-scope protection (Defect #21)', () => {
    const codeWithCanvasNodes = `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="title">Page</h1>
    </div>
  );
}

const canvasNodes = (<>
  <img data-id="detached-img" src="/old.jpg" />
  <a data-id="detached-link" href="/old">Link</a>
  <p data-id="detached-text">Old Text</p>
</>);
`;

    it('protects canvasNodes src from unbound item by setting dormant metadata', () => {
      const result = bindSrcExpressionInCode(
        codeWithCanvasNodes,
        'detached-img',
        '"https://api.example.com/assets/" + item.img_file.id',
      );
      expect(result).not.toContain('src={"https://api.example.com/assets/" + item.img_file.id}');
      expect(result).toContain('src=""');
      expect(result).toContain('data-dormant-src="&quot;https://api.example.com/assets/&quot; + item.img_file.id"');

      const unbound = unbindSrcExpressionInCode(result, 'detached-img', '/default.jpg');
      expect(unbound).not.toContain('data-dormant-src');
      expect(unbound).toContain('src="/default.jpg"');
    });

    it('protects canvasNodes href from unbound item by setting dormant metadata', () => {
      const result = bindHrefExpressionInCode(
        codeWithCanvasNodes,
        'detached-link',
        '"/gallery/" + item.slug',
      );
      expect(result).not.toContain('href={"/gallery/" + item.slug}');
      expect(result).toContain('href="#"');
      expect(result).toContain('data-dormant-href="&quot;/gallery/&quot; + item.slug"');

      const unbound = unbindHrefExpressionInCode(result, 'detached-link', '/fallback');
      expect(unbound).not.toContain('data-dormant-href');
      expect(unbound).toContain('href="/fallback"');
    });

    it('protects canvasNodes text from unbound item by setting dormant metadata', () => {
      const result = bindTextExpressionInCode(
        codeWithCanvasNodes,
        'detached-text',
        'item.title + " (detached)"',
      );
      expect(result).not.toContain('{item.title + " (detached)"}');
      expect(result).toContain('data-dormant-text="item.title + &quot; (detached)&quot;"');
      expect(result).toContain('<p data-id="detached-text"');
      expect(result).toContain('Text</p>');

      const unbound = unbindTextExpressionInCode(result, 'detached-text', 'Static Text');
      expect(unbound).not.toContain('data-dormant-text');
      expect(unbound).toContain('Static Text</p>');
    });
  });
});
