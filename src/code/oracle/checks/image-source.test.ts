import { describe, it, expect } from 'vitest';
import { parseJSX } from '@/code/parsing/ast-utils';
import { checkImageSourceDialect, isAllowedImageSource } from './image-source';
import type { OracleViolation } from './shared';

describe('image-source rule', () => {
  it('isAllowedImageSource accepts external URLs and project uploads', () => {
    expect(isAllowedImageSource('https://images.unsplash.com/photo-123')).toBe(true);
    expect(isAllowedImageSource('http://example.com/pic.png')).toBe(true);
    expect(isAllowedImageSource('//cdn.example.com/asset.webp')).toBe(true);
    expect(isAllowedImageSource('data:image/png;base64,iVBORw...')).toBe(true);
    expect(isAllowedImageSource('blob:http://localhost:3000/123')).toBe(true);
    expect(isAllowedImageSource('/api/uploads/12345-photo.png')).toBe(true);
    expect(isAllowedImageSource('/uploads/banner.jpg')).toBe(true);
  });

  it('isAllowedImageSource rejects foreign host paths', () => {
    expect(isAllowedImageSource('/images/hero-3d-object.png')).toBe(false);
    expect(isAllowedImageSource('/images/project-barber.webp')).toBe(false);
    expect(isAllowedImageSource('../assets/pic.png')).toBe(false);
    expect(isAllowedImageSource('images/pic.png')).toBe(false);
  });

  it('isAllowedImageSource accepts ProjectFS files when projectFiles set is supplied', () => {
    const projectFiles = new Set(['assets/logo.svg', 'public/brand.png']);
    expect(isAllowedImageSource('/assets/logo.svg', projectFiles)).toBe(true);
    expect(isAllowedImageSource('public/brand.png', projectFiles)).toBe(true);
    expect(isAllowedImageSource('/images/hero.png', projectFiles)).toBe(false);
  });

  it('accepts the public URL for an uploaded public/assets file', () => {
    const projectFiles = new Set(['public/assets/mcp-audit-proof.svg']);
    expect(isAllowedImageSource('/assets/mcp-audit-proof.svg', projectFiles)).toBe(true);

    const ast = parseJSX('<img data-id="audit-image" src="/assets/mcp-audit-proof.svg" />');
    const violations: OracleViolation[] = [];
    checkImageSourceDialect(ast!, violations, projectFiles);
    expect(violations).toHaveLength(0);
  });

  it('flags JSX <img> tags with foreign local paths', () => {
    const ast = parseJSX('<img data-id="img-1" src="/images/hero-3d-object.png" alt="Hero" />');
    const v: OracleViolation[] = [];
    checkImageSourceDialect(ast!, v);
    expect(v.map((x) => x.code)).toContain('INVALID_IMAGE_SOURCE');
    expect(v[0].message).toContain('/images/hero-3d-object.png');
  });

  it('allows JSX <img> tags with Unsplash stock URL or /api/uploads/', () => {
    const ast = parseJSX(`
      <div>
        <img data-id="i1" src="https://images.unsplash.com/photo-1" />
        <img data-id="i2" src="/api/uploads/photo.webp" />
      </div>
    `);
    const v: OracleViolation[] = [];
    checkImageSourceDialect(ast!, v);
    expect(v).toHaveLength(0);
  });

  it('flags component props (image, thumbnail, avatar) with foreign local paths', () => {
    const ast = parseJSX(`
      <div>
        <ProjectCard data-id="c1" image="/images/project-portfolio.webp" />
        <UserAvatar data-id="c2" avatar="/images/avatar.png" />
      </div>
    `);
    const v: OracleViolation[] = [];
    checkImageSourceDialect(ast!, v);
    expect(v.map((x) => x.code)).toEqual(['INVALID_IMAGE_SOURCE', 'INVALID_IMAGE_SOURCE']);
  });

  it('flags inline styles with foreign backgroundImage url', () => {
    const ast = parseJSX(`
      <div data-id="box" style={{ backgroundImage: "url('/images/bg.jpg')" }} />
    `);
    const v: OracleViolation[] = [];
    checkImageSourceDialect(ast!, v);
    expect(v.map((x) => x.code)).toContain('INVALID_IMAGE_SOURCE');
  });

  it('allows inline styles with external URL or project upload', () => {
    const ast = parseJSX(`
      <div data-id="box" style={{ backgroundImage: "url('https://images.unsplash.com/bg.jpg')" }} />
    `);
    const v: OracleViolation[] = [];
    checkImageSourceDialect(ast!, v);
    expect(v).toHaveLength(0);
  });
});
