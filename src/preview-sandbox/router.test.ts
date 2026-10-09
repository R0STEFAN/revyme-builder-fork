import { describe, it, expect } from 'vitest';
import { buildRouteTable, resolveRoute } from './router';

describe('preview-sandbox router', () => {
  it('resolves routes with standard dynamic segments', () => {
    const files = new Map<string, string>([
      ['app/page.client.tsx', ''],
      ['app/gallery/[category]/[placement]/page.client.tsx', ''],
    ]);
    const routes = buildRouteTable(files);
    const match = resolveRoute(routes, '/gallery/men/chest');
    expect(match).not.toBeNull();
    expect(match?.pageFile).toBe('app/gallery/[category]/[placement]/page.client.tsx');
    expect(match?.params).toEqual({
      category: 'men',
      ':category': 'men',
      placement: 'chest',
      ':placement': 'chest',
    });
  });

  it('resolves routes with colon-prefixed dynamic segments [:category]/[:placement]', () => {
    const files = new Map<string, string>([
      ['app/gallery/[:category]/[:placement]/page.client.tsx', ''],
    ]);
    const routes = buildRouteTable(files);
    const match = resolveRoute(routes, '/gallery/women/arm');
    expect(match).not.toBeNull();
    expect(match?.pageFile).toBe('app/gallery/[:category]/[:placement]/page.client.tsx');
    expect(match?.params).toEqual({
      category: 'women',
      ':category': 'women',
      placement: 'arm',
      ':placement': 'arm',
    });
  });
});
