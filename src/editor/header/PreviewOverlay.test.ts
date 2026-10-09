import { describe, it, expect } from 'vitest';
import { getPreviewPageUrl } from './PreviewOverlay';
import { filePathToSlug } from '@/code/project/active-file-store';

describe('getPreviewPageUrl', () => {
  it('returns / for home page variants', () => {
    expect(getPreviewPageUrl('app/page.client.tsx')).toBe('/');
    expect(getPreviewPageUrl('app/page.tsx')).toBe('/');
    expect(getPreviewPageUrl('app/(marketing)/page.client.tsx')).toBe('/');
    expect(getPreviewPageUrl('app/(marketing)/(en)/page.client.tsx')).toBe('/');
  });

  it('returns the page slug for standard sub-pages', () => {
    expect(getPreviewPageUrl('app/about/page.client.tsx')).toBe('/about');
    expect(getPreviewPageUrl('app/pricing/page.tsx')).toBe('/pricing');
    expect(getPreviewPageUrl('app/services/web/page.client.tsx')).toBe('/services/web');
  });

  it('strips route groups from page URLs', () => {
    expect(getPreviewPageUrl('app/(marketing)/pricing/page.client.tsx')).toBe('/pricing');
    expect(getPreviewPageUrl('app/(shop)/(checkout)/cart/page.client.tsx')).toBe('/cart');
  });

  it('substitutes dynamic segment with activePreviewSlug for CMS pages', () => {
    expect(getPreviewPageUrl('app/blog/[slug]/page.client.tsx', 'hello-world')).toBe('/blog/hello-world');
    expect(getPreviewPageUrl('app/team/[member]/page.client.tsx', 'alex')).toBe('/team/alex');
  });

  it('falls back to raw dynamic segment if activePreviewSlug is missing', () => {
    expect(getPreviewPageUrl('app/blog/[slug]/page.client.tsx', null)).toBe('/blog/[slug]');
  });

  it('returns / for component master files', () => {
    expect(getPreviewPageUrl('components/Header.tsx')).toBe('/');
    expect(getPreviewPageUrl('components/ui/Button.tsx')).toBe('/');
  });

  it('substitutes multiple dynamic segments with routeParams', () => {
    expect(
      getPreviewPageUrl('app/gallery/[category]/[placement]/page.client.tsx', null, {
        category: 'men',
        placement: 'chest',
      })
    ).toBe('/gallery/men/chest');

    expect(
      getPreviewPageUrl('app/gallery/[:category]/[:placement]/page.client.tsx', null, {
        category: 'women',
        placement: 'arm',
      })
    ).toBe('/gallery/women/arm');
  });

  it('handles routeParams with colon-prefixed keys', () => {
    expect(
      getPreviewPageUrl('app/gallery/[category]/[placement]/page.client.tsx', null, {
        ':category': 'tattoos',
        ':placement': 'back',
      })
    ).toBe('/gallery/tattoos/back');
  });

  it('returns template preview route for LayoutClient files', () => {
    expect(getPreviewPageUrl('app/(marketing)/LayoutClient.tsx')).toBe('/__template_preview/marketing');
  });
});

describe('filePathToSlug route group stripping', () => {
  it('strips single and multiple route groups', () => {
    expect(filePathToSlug('app/(marketing)/pricing/page.client.tsx')).toBe('pricing');
    expect(filePathToSlug('app/(group1)/(group2)/pricing/page.client.tsx')).toBe('pricing');
    expect(filePathToSlug('app/(group1)/(group2)/page.client.tsx')).toBe('home');
  });
});
