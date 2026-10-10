import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseFontFilename,
  addCustomFont,
  deleteCustomFont,
  ensureWorkspaceFonts,
  isWorkspaceFontFamily,
  parseCustomFontsFromCss,
  syncProjectCustomFontsFromCss,
  resetWorkspaceFontsForTesting,
} from './workspace-fonts-store';
import { backend } from '@/backend';
import type { WorkspaceFont } from '@/backend/types';

describe('workspace-fonts-store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceFontsForTesting();
  });

  describe('parseFontFilename', () => {
    it('parses clean bold font', () => {
      const parsed = parseFontFilename('CabinetGrotesk-Bold.woff2');
      expect(parsed.family).toBe('Cabinet Grotesk');
      expect(parsed.weight).toBe(700);
      expect(parsed.style).toBe('normal');
      expect(parsed.ext).toBe('woff2');
    });

    it('parses italic extra-bold font', () => {
      const parsed = parseFontFilename('Gilroy-ExtraBoldItalic.ttf');
      expect(parsed.family).toBe('Gilroy');
      expect(parsed.weight).toBe(800);
      expect(parsed.style).toBe('italic');
      expect(parsed.ext).toBe('ttf');
    });

    it('parses font with optical size and weight numbers', () => {
      const parsed = parseFontFilename('Inter_28pt-SemiBold.woff');
      expect(parsed.family).toBe('Inter');
      expect(parsed.weight).toBe(600);
      expect(parsed.style).toBe('normal');
      expect(parsed.ext).toBe('woff');
    });

    it('parses light font with fallback extension', () => {
      const parsed = parseFontFilename('Sora-Light.otf');
      expect(parsed.family).toBe('Sora');
      expect(parsed.weight).toBe(300);
      expect(parsed.style).toBe('normal');
      expect(parsed.ext).toBe('otf');
    });

    it('parses simple name with default regular weight', () => {
      const parsed = parseFontFilename('CustomDisplay.woff2');
      expect(parsed.family).toBe('Custom Display');
      expect(parsed.weight).toBe(400);
      expect(parsed.style).toBe('normal');
      expect(parsed.ext).toBe('woff2');
    });
  });

  describe('custom font storage', () => {
    it('adds and persists custom font locally per project and deletes file asset', async () => {
      const deleteAssetsSpy = vi.spyOn(backend, 'deleteAssets').mockResolvedValue();

      const font: WorkspaceFont = {
        id: 'local-font-1',
        family: 'MyBrandFont',
        weight: 700,
        style: 'normal',
        ext: 'woff2',
        fileName: 'MyBrandFont-Bold.woff2',
        size: 12345,
        url: '/api/uploads/test.woff2',
        uploadedAt: '2026-10-07T00:00:00.000Z',
        uploadedBy: 'user',
      };

      addCustomFont(font);
      expect(isWorkspaceFontFamily('MyBrandFont')).toBe(true);

      const stored = JSON.parse(localStorage.getItem('revyme:custom_fonts:local') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].family).toBe('MyBrandFont');

      deleteCustomFont('local-font-1');
      expect(isWorkspaceFontFamily('MyBrandFont')).toBe(false);
      const afterDelete = JSON.parse(localStorage.getItem('revyme:custom_fonts:local') || '[]');
      expect(afterDelete).toHaveLength(0);

      expect(deleteAssetsSpy).toHaveBeenCalledWith('local', ['test.woff2']);
      deleteAssetsSpy.mockRestore();
    });
  });

  describe('parseCustomFontsFromCss', () => {
    it('extracts custom @font-face declarations from css', () => {
      const css = `
/* Workspace custom fonts */
@font-face {
  font-family: 'Cabinet Grotesk';
  src: url('/api/uploads/123-CabinetGrotesk-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Gilroy';
  src: url('/uploads/456-Gilroy-Italic.ttf') format('truetype');
  font-weight: 300;
  font-style: italic;
  font-display: swap;
}
      `;

      const parsed = parseCustomFontsFromCss(css);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toMatchObject({
        family: 'Cabinet Grotesk',
        weight: 700,
        style: 'normal',
        ext: 'woff2',
        url: '/api/uploads/123-CabinetGrotesk-Bold.woff2',
      });
      expect(parsed[1]).toMatchObject({
        family: 'Gilroy',
        weight: 300,
        style: 'italic',
        ext: 'ttf',
        url: '/uploads/456-Gilroy-Italic.ttf',
      });
    });

    it('syncs discovered fonts into workspace fonts and localStorage', () => {
      const css = `
@font-face {
  font-family: 'Imported Font';
  src: url('/api/uploads/imported.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
}
      `;
      syncProjectCustomFontsFromCss(css);
      expect(isWorkspaceFontFamily('Imported Font')).toBe(true);
      const stored = JSON.parse(localStorage.getItem('revyme:custom_fonts:local') || '[]');
      expect(stored.some((f: any) => f.family === 'Imported Font')).toBe(true);
    });
  });

  describe('project isolation and migration', () => {
    it('migrates legacy revyme_custom_fonts to project-scoped storage', () => {
      const legacyFont: WorkspaceFont = {
        id: 'legacy-1',
        family: 'LegacyFont',
        weight: 400,
        style: 'normal',
        ext: 'woff2',
        fileName: 'legacy.woff2',
        size: 1000,
        url: '/legacy.woff2',
        uploadedAt: '2026-10-01T00:00:00.000Z',
        uploadedBy: 'user',
      };
      localStorage.setItem('revyme_custom_fonts', JSON.stringify([legacyFont]));

      // Calling ensureWorkspaceFonts or addCustomFont should read and migrate legacy fonts
      const font2: WorkspaceFont = {
        id: 'local-2',
        family: 'FontTwo',
        weight: 700,
        style: 'normal',
        ext: 'woff2',
        fileName: 'two.woff2',
        size: 2000,
        url: '/two.woff2',
        uploadedAt: '2026-10-01T00:00:00.000Z',
        uploadedBy: 'user',
      };
      addCustomFont(font2);

      const scoped = JSON.parse(localStorage.getItem('revyme:custom_fonts:local') || '[]');
      expect(scoped.some((f: any) => f.family === 'LegacyFont')).toBe(true);
      expect(scoped.some((f: any) => f.family === 'FontTwo')).toBe(true);
      expect(localStorage.getItem('revyme_custom_fonts')).toBeNull();
    });
  });
});
