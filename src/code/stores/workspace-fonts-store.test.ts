import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseFontFilename,
  addCustomFont,
  deleteCustomFont,
  ensureWorkspaceFonts,
  isWorkspaceFontFamily,
} from './workspace-fonts-store';
import type { WorkspaceFont } from '@/backend/types';

describe('workspace-fonts-store', () => {
  beforeEach(() => {
    localStorage.clear();
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
    it('adds and persists custom font locally', async () => {
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

      const stored = JSON.parse(localStorage.getItem('revyme_custom_fonts') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].family).toBe('MyBrandFont');

      deleteCustomFont('local-font-1');
      expect(isWorkspaceFontFamily('MyBrandFont')).toBe(false);
      const afterDelete = JSON.parse(localStorage.getItem('revyme_custom_fonts') || '[]');
      expect(afterDelete).toHaveLength(0);
    });
  });
});
