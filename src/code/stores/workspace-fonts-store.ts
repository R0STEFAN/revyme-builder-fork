// workspace-fonts-store.ts — custom fonts uploaded to the workspace library.
//
// The website being edited belongs to a workspace; custom fonts are a
// workspace-level library shared by every project in it (uploaded from the
// dashboard's Workspace → Fonts settings). The font picker surfaces them under
// a "Workspace fonts" section.
//
// Lazy: the list is fetched the first time something needs it (the picker
// opening), then cached for the session. Each font is registered with the
// FontFace API on load so the picker can render every entry in its own
// typeface. Cloud-only — stays empty in standalone / local-project mode.
//
// Module-level state + `useSyncExternalStore`, the same pattern as
// `credits-store` — readable from React and imperative code, and dodges the
// editor's `<Provider>` store.

import { useSyncExternalStore } from 'react';
import { trace } from '@/shared/debug-trace';
import { backend } from '@/backend';
import { getProjectId } from '@/backend/project-id';
import { loadCustomFont, loadCustomFontInCanvas } from '@/shared/font-loader';
import { modifyProjectFile } from '@/code/project/modify-file';
import { addWorkspaceFontFacesToCss, removeWorkspaceFontFacesFromCss } from '@/code/project/preset-ops';
import { projectFS } from '@/code/project/project-fs';
import { forceCanvasRender } from '@/canvas/node-ops';
import type { WorkspaceFont } from '@/backend/types';

let _fonts: WorkspaceFont[] = [];
let _loaded = false;
let _loading = false;
let _loadedProjectId: string | null = null;
const listeners = new Set<() => void>();

const STORAGE_KEY_PREFIX = 'revyme:custom_fonts:';
const LEGACY_STORAGE_KEY = 'revyme_custom_fonts';

function getProjectCustomFontsKey(): string {
  const projectId = getProjectId() || 'local';
  return `${STORAGE_KEY_PREFIX}${projectId}`;
}

function loadLocalCustomFonts(): WorkspaceFont[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  try {
    const key = getProjectCustomFontsKey();
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);

    // One-time migration from legacy un-scoped key for the current project
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      try {
        const legacyFonts = JSON.parse(legacyRaw);
        if (Array.isArray(legacyFonts) && legacyFonts.length > 0) {
          localStorage.setItem(key, JSON.stringify(legacyFonts));
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          return legacyFonts;
        }
      } catch {}
    }
    return [];
  } catch {
    return [];
  }
}

function saveLocalCustomFonts(fonts: WorkspaceFont[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const key = getProjectCustomFontsKey();
    localStorage.setItem(key, JSON.stringify(fonts));
  } catch {}
}

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * Parse custom @font-face declarations from CSS to discover uploaded/imported fonts.
 */
export function parseCustomFontsFromCss(css: string): WorkspaceFont[] {
  if (!css || !css.includes('@font-face')) return [];
  const fonts: WorkspaceFont[] = [];
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/gi;
  let match: RegExpExecArray | null;

  while ((match = fontFaceRegex.exec(css)) !== null) {
    const block = match[1];
    const famMatch = block.match(/font-family:\s*['"]?([^'";]+)['"]?/i);
    const srcMatch = block.match(/url\(['"]?([^'")]+)['"]?\)/i);
    if (!famMatch || !srcMatch) continue;

    const family = famMatch[1].trim();
    const url = srcMatch[1].trim();
    const weightMatch = block.match(/font-weight:\s*(\d+)/i);
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : 400;
    const styleMatch = block.match(/font-style:\s*(normal|italic|oblique)/i);
    const style = (styleMatch && styleMatch[1].toLowerCase() === 'italic') ? 'italic' : 'normal';

    const extMatch = url.match(/\.(woff2|woff|ttf|otf)(?:[?#]|$)/i);
    const ext = (extMatch ? extMatch[1].toLowerCase() : 'woff2') as 'woff2' | 'woff' | 'ttf' | 'otf';

    fonts.push({
      id: `discovered-${family.replace(/\s+/g, '-').toLowerCase()}-${weight}-${style}`,
      family,
      weight,
      style,
      ext,
      fileName: url.split('/').pop()?.split('?')[0] || `${family}.${ext}`,
      size: 0,
      url,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'discovered',
    });
  }
  return fonts;
}

/**
 * Synchronize custom fonts discovered in project CSS into the workspace fonts store
 * and local storage so they appear in the font picker and can be re-used.
 */
export function syncProjectCustomFontsFromCss(css: string): WorkspaceFont[] {
  const discovered = parseCustomFontsFromCss(css);
  if (discovered.length === 0) return [];

  let changed = false;
  for (const font of discovered) {
    const existing = _fonts.some(f => f.family === font.family && f.weight === font.weight && f.style === font.style);
    if (!existing) {
      _fonts.push(font);
      changed = true;
    }
  }

  if (changed) {
    const localFonts = _fonts.filter(f => f.id.startsWith('local-') || f.id.startsWith('discovered-') || f.uploadedBy === 'user' || f.uploadedBy === 'local' || f.uploadedBy === 'discovered');
    saveLocalCustomFonts(localFonts);
    for (const f of discovered) {
      loadCustomFont({ family: f.family, url: f.url, weight: f.weight, style: f.style });
    }
    notify();
  }
  return discovered;
}

/**
 * Fetch the workspace font library once, then cache. Resolves the owning
 * workspace from the current website, lists its fonts, merges local custom fonts,
 * discovers any custom fonts defined in project globals.css,
 * and pre-registers each face (so previews render). Safe to call repeatedly.
 */
export async function ensureWorkspaceFonts(): Promise<void> {
  const currentProjectId = getProjectId() || 'local';
  if (_loaded && _loadedProjectId === currentProjectId) return;
  if (_loading) return;
  _loading = true;
  try {
    const localFonts = loadLocalCustomFonts();
    const websiteId = getProjectId();
    let backendFonts: WorkspaceFont[] = [];

    if (websiteId && websiteId !== 'local') {
      try {
        const workspaceId = await backend.getWebsiteWorkspaceId(websiteId);
        if (workspaceId) {
          backendFonts = await backend.listWorkspaceFonts(workspaceId);
        }
      } catch (err) {
        trace.error('workspace-fonts:backend-failed', err);
      }
    }

    const map = new Map<string, WorkspaceFont>();
    for (const f of backendFonts) map.set(f.id, f);
    for (const f of localFonts) map.set(f.id, f);

    // Auto-discover custom fonts declared in app/globals.css
    try {
      const globalsCss = projectFS.readFile('app/globals.css');
      if (globalsCss) {
        const discovered = parseCustomFontsFromCss(globalsCss);
        for (const f of discovered) {
          const key = `${f.family}__${f.weight}__${f.style}`;
          const already = Array.from(map.values()).some(existing => `${existing.family}__${existing.weight}__${existing.style}` === key);
          if (!already) {
            map.set(f.id, f);
          }
        }
      }
    } catch {}

    _fonts = Array.from(map.values());
    _loaded = true;
    _loadedProjectId = currentProjectId;
    trace.action('workspace-fonts:loaded', { count: _fonts.length, projectId: currentProjectId });

    // Register every face so the picker renders each in its own typeface.
    for (const f of _fonts) {
      loadCustomFont({ family: f.family, url: f.url, weight: f.weight, style: f.style });
    }
    notify();
  } catch (err) {
    trace.error('workspace-fonts:load-failed', err);
    _loaded = true;
    _loadedProjectId = currentProjectId;
  } finally {
    _loading = false;
    notify();
  }
}

/** Add a newly uploaded custom font to workspace fonts */
export function addCustomFont(font: WorkspaceFont): void {
  const currentProjectId = getProjectId() || 'local';
  if (!_loaded || _loadedProjectId !== currentProjectId) {
    const local = loadLocalCustomFonts();
    const map = new Map<string, WorkspaceFont>();
    for (const f of _fonts) map.set(f.id, f);
    for (const f of local) map.set(f.id, f);
    _fonts = Array.from(map.values());
    _loaded = true;
    _loadedProjectId = currentProjectId;
  }
  const existingIdx = _fonts.findIndex(f => f.id === font.id || (f.family === font.family && f.weight === font.weight && f.style === font.style));
  if (existingIdx >= 0) {
    _fonts[existingIdx] = font;
  } else {
    _fonts.push(font);
  }
  const localFonts = _fonts.filter(f => f.id.startsWith('local-') || f.id.startsWith('discovered-') || f.uploadedBy === 'user' || f.uploadedBy === 'local' || f.uploadedBy === 'discovered');
  saveLocalCustomFonts(localFonts);

  loadCustomFont({ family: font.family, url: font.url, weight: font.weight, style: font.style });
  previewWorkspaceFontInCanvas(font.family);
  applyWorkspaceFontToProject(font.family);
  notify();
}

/** Delete a custom font from workspace fonts and clean up its CSS declarations */
export function deleteCustomFont(fontId: string): void {
  const currentProjectId = getProjectId() || 'local';
  if (!_loaded || _loadedProjectId !== currentProjectId) {
    const local = loadLocalCustomFonts();
    const map = new Map<string, WorkspaceFont>();
    for (const f of _fonts) map.set(f.id, f);
    for (const f of local) map.set(f.id, f);
    _fonts = Array.from(map.values());
    _loaded = true;
    _loadedProjectId = currentProjectId;
  }
  const target = _fonts.find(f => f.id === fontId);
  const targetFamily = target?.family;
  _fonts = _fonts.filter(f => f.id !== fontId);
  const localFonts = _fonts.filter(f => f.id.startsWith('local-') || f.id.startsWith('discovered-') || f.uploadedBy === 'user' || f.uploadedBy === 'local' || f.uploadedBy === 'discovered');
  saveLocalCustomFonts(localFonts);

  // If we know the family being deleted, also remove its @font-face rules from globals.css
  if (targetFamily) {
    const aliases = [targetFamily];
    const unspaced = targetFamily.replace(/\s+/g, '');
    if (unspaced && unspaced !== targetFamily) aliases.push(unspaced);
    modifyProjectFile('app/globals.css', css => removeWorkspaceFontFacesFromCss(css, aliases));
    forceCanvasRender();
  }

  notify();
}

/**
 * Parse a font file name (e.g. "ClashDisplay-Bold.woff2") into
 * family name, weight, style, and extension.
 */
export function parseFontFilename(fileName: string): {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  ext: 'woff2' | 'woff' | 'otf' | 'ttf';
} {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const extMatch = fileName.match(/\.([^.]+)$/);
  const ext = (extMatch ? extMatch[1].toLowerCase() : 'woff2') as 'woff2' | 'woff' | 'otf' | 'ttf';

  let style: 'normal' | 'italic' = 'normal';
  if (/italic|oblique/i.test(baseName)) {
    style = 'italic';
  }

  let weight = 400;
  if (/thin|hairline|100/i.test(baseName)) weight = 100;
  else if (/extralight|ultralight|200/i.test(baseName)) weight = 200;
  else if (/light|300/i.test(baseName)) weight = 300;
  else if (/medium|500/i.test(baseName)) weight = 500;
  else if (/semibold|demibold|600/i.test(baseName)) weight = 600;
  else if (/extrabold|ultrabold|800/i.test(baseName)) weight = 800;
  else if (/black|heavy|900/i.test(baseName)) weight = 900;
  else if (/bold|700/i.test(baseName)) weight = 700;

  // Clean family name
  let family = baseName
    .replace(/[-_]?(100|200|300|400|500|600|700|800|900)/g, '')
    .replace(/[-_]?(thin|hairline|extralight|ultralight|light|regular|normal|medium|semibold|demibold|extrabold|ultrabold|bold|black|heavy)/gi, '')
    .replace(/[-_]?(italic|oblique)/gi, '')
    .replace(/[-_]?(variable|vf)/gi, '')
    .replace(/[-_]?(opsz\d+|wght\d+|\d+pt)/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  // If camelCase or PascalCase without spaces, e.g. "ClashDisplay" -> "Clash Display"
  if (!family.includes(' ')) {
    family = family.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  if (!family) family = baseName;

  return { family, weight, style, ext };
}

/** Imperative read of the cached library (empty until loaded). */
function getWorkspaceFonts(): WorkspaceFont[] {
  return _fonts;
}

/**
 * Make a workspace font usable in the CURRENT project: declare an @font-face
 * for every weight/style of the family in app/globals.css (pointing at the
 * hosted file), then force a canvas re-render so the iframe resolves it. The
 * @font-face lives in the project source, so it's visible in the code explorer
 * and ships with the published site. Called when the user applies a workspace
 * font from the picker. No-op when the family isn't in the library.
 */
export function applyWorkspaceFontToProject(family: string): void {
  const familyFonts = _fonts.filter(f => f.family === family);
  if (familyFonts.length === 0) return;

  const specs: import('@/code/project/preset-ops').WorkspaceFontFaceSpec[] = [];
  for (const f of familyFonts) {
    specs.push({
      family: f.family, url: f.url, weight: f.weight, style: f.style, ext: f.ext,
    });
    // For single-face custom fonts (default 400), also declare weight: 700
    // so bold elements and tags (<strong>, <b>) still resolve this custom face
    if (f.weight === 400 && !familyFonts.some(other => other.weight === 700)) {
      specs.push({
        family: f.family, url: f.url, weight: 700, style: f.style, ext: f.ext,
      });
    }
    // Also declare alias without spaces if family has spaces (e.g. "CompactaMobsters")
    const unspaced = f.family.replace(/\s+/g, '');
    if (unspaced && unspaced !== f.family) {
      specs.push({
        family: unspaced, url: f.url, weight: f.weight, style: f.style, ext: f.ext,
      });
      if (f.weight === 400 && !familyFonts.some(other => other.weight === 700)) {
        specs.push({
          family: unspaced, url: f.url, weight: 700, style: f.style, ext: f.ext,
        });
      }
    }
  }

  // modifyProjectFile flushes any pending mutation (e.g. the fontFamily write
  // that just queued) before reading globals.css, so neither clobbers the other.
  const before = modifyProjectFile('app/globals.css', css => addWorkspaceFontFacesToCss(css, specs));
  trace.action('workspace-fonts:applied-to-project', { family, weights: specs.length, changed: before != null });
  forceCanvasRender();
}

/** Font-picker HOVER preview: make every face of a workspace family resolvable inside the canvas
 *  iframe right now — the project only declares it (globals.css) once the font is picked. */
export function previewWorkspaceFontInCanvas(family: string): void {
  for (const f of _fonts) {
    if (f.family === family) {
      loadCustomFontInCanvas({ family: f.family, url: f.url, weight: f.weight, style: f.style });
      const unspaced = f.family.replace(/\s+/g, '');
      if (unspaced && unspaced !== f.family) {
        loadCustomFontInCanvas({ family: unspaced, url: f.url, weight: f.weight, style: f.style });
      }
    }
  }
}

/** Is this family one of the workspace's custom fonts (not a Google font)? */
export function isWorkspaceFontFamily(family: string): boolean {
  return _fonts.some((f) => f.family === family);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** React hook — the workspace font library, reactive to load completion. */
export function useWorkspaceFonts(): WorkspaceFont[] {
  return useSyncExternalStore(subscribe, getWorkspaceFonts, getWorkspaceFonts);
}

/** Reset in-memory cached fonts state (useful in tests when switching project or clearing storage). */
export function resetWorkspaceFontsForTesting(): void {
  _fonts = [];
  _loaded = false;
  _loading = false;
  _loadedProjectId = null;
}
