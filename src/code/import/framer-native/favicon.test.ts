import { describe, expect, it } from 'vitest';
import { updateNativeFavicon } from './favicon';

describe('native favicon update', () => {
  it('preserves dynamic metadata and unrelated icon options', () => {
    const original = `export const metadata = { title: siteTitle, icons: { apple: '/apple.png', icon: '/old.png' } };\nexport default function Layout() { return null; }`;
    const result = updateNativeFavicon(original, '/api/uploads/new.webp');
    expect(result).toContain('title: siteTitle');
    expect(result).toContain("apple: '/apple.png'");
    expect(result).toContain('"/api/uploads/new.webp"');
    expect(result).not.toContain('/old.png');
  });

  it('rejects dynamic or ambiguous icon metadata instead of changing its meaning', () => {
    expect(updateNativeFavicon('export const metadata = { ...other };', '/api/uploads/a.webp')).toBeUndefined();
    expect(updateNativeFavicon('export const metadata = { icons: dynamicIcons };', '/api/uploads/a.webp')).toBeUndefined();
    expect(updateNativeFavicon('export const metadata = { icons: {}, icons: {} };', '/api/uploads/a.webp')).toBeUndefined();
  });

  it('adds an icon to metadata objects with trailing commas', () => {
    const result = updateNativeFavicon("export const metadata = { title: 'Site', icons: { apple: '/apple.png', }, };", '/api/uploads/a.webp');
    expect(result).toContain('icon: "/api/uploads/a.webp"');
    expect(result).toContain("apple: '/apple.png'");
  });
});
