import { describe, it, expect } from 'vitest';
import { fetchGoogleFonts, DEFAULT_FONTS, FEELING_CATEGORIES } from './google-fonts';

describe('google-fonts', () => {
  it('loads full catalog as DEFAULT_FONTS fallback', async () => {
    const fonts = await fetchGoogleFonts();
    expect(fonts.length).toBeGreaterThan(1000);
    expect(DEFAULT_FONTS.length).toBeGreaterThan(1000);

    const inter = fonts.find(f => f.family === 'Inter');
    expect(inter).toBeDefined();
    expect(inter?.category).toBe('sans-serif');

    const playfair = fonts.find(f => f.family === 'Playfair Display');
    expect(playfair).toBeDefined();
    expect(playfair?.category).toBe('serif');

    const orbitron = fonts.find(f => f.family === 'Orbitron');
    expect(orbitron).toBeDefined();
    expect(orbitron?.tags.some(t => t.name.includes('Futuristic'))).toBe(true);

    const fredoka = fonts.find(f => f.family === 'Fredoka');
    expect(fredoka).toBeDefined();
    expect(fredoka?.tags.some(t => t.name.includes('Playful'))).toBe(true);
  });

  it('contains categories and tags across all categories in FEELING_CATEGORIES', async () => {
    const fonts = await fetchGoogleFonts();
    expect(FEELING_CATEGORIES.length).toBeGreaterThan(15);

    // Standard categories check
    const serifs = fonts.filter(f => f.category === 'serif');
    expect(serifs.length).toBeGreaterThan(50);

    const sansSerifs = fonts.filter(f => f.category === 'sans-serif');
    expect(sansSerifs.length).toBeGreaterThan(100);

    // Feeling tags check
    const businessFonts = fonts.filter(f => f.tags?.some(t => t.name.toLowerCase().includes('business')));
    expect(businessFonts.length).toBeGreaterThan(20);

    const playfulFonts = fonts.filter(f => f.tags?.some(t => t.name.toLowerCase().includes('playful')));
    expect(playfulFonts.length).toBeGreaterThan(10);
  });

  it('supports Cyrillic category and tags', async () => {
    expect(FEELING_CATEGORIES).toContain('Custom');
    expect(FEELING_CATEGORIES).toContain('Cyrillic');

    const fonts = await fetchGoogleFonts();
    const cyrillicFonts = fonts.filter(f => f.tags?.some(t => t.name.toLowerCase().includes('cyrillic')));
    expect(cyrillicFonts.length).toBeGreaterThan(300);

    // Common Cyrillic fonts must be present
    const names = cyrillicFonts.map(f => f.family);
    expect(names).toContain('Roboto');
    expect(names).toContain('Montserrat');
    expect(names).toContain('Inter');
    expect(names).toContain('Playfair Display');
    expect(names).toContain('Open Sans');
  });
});
