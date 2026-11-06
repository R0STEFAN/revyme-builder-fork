import { describe, expect, it } from 'vitest';
import { updateNativeFavicon } from './favicon';
import { parseMetadataFromCode, updateMetadataInCode } from '../../generation/metadata-gen';

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

  it('keeps the light icon editable and adds a dark-mode icon', () => {
    const code = updateNativeFavicon("export const metadata = { title: 'Site' };", '/assets/light.webp', '/assets/dark.webp');
    expect(code).toContain('icon: "/assets/light.webp"');
    expect(code).toContain('"url":"/assets/dark.webp"');
    expect(code).toContain('"media":"(prefers-color-scheme: dark)"');
    expect(parseMetadataFromCode(updateMetadataInCode(code!, { title: 'New title' })).icons).toMatchObject({ icon: '/assets/light.webp', other: { url: '/assets/dark.webp', media: '(prefers-color-scheme: dark)' } });
    expect(updateNativeFavicon('export const metadata = { icons: { other: existing } };', '/assets/light.webp', '/assets/dark.webp')).toBeUndefined();
  });

  it('updates both light and dark icons when other already exists', () => {
    const original = `export const metadata = { icons: { icon: '/old-light.webp', other: { rel: 'icon', url: '/old-dark.webp', media: '(prefers-color-scheme: dark)' } } };\nexport default function Layout() { return null; }`;
    const updated = updateNativeFavicon(original, '/new-light.webp', '/new-dark.webp');
    expect(updated).toBeDefined();
    expect(updated).toContain('"/new-light.webp"');
    expect(updated).toContain('"/new-dark.webp"');
    expect(updated).not.toContain('/old-light.webp');
    expect(updated).not.toContain('/old-dark.webp');
  });
});
