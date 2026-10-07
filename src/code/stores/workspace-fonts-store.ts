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
import { addWorkspaceFontFacesToCss } from '@/code/project/preset-ops';
import { forceCanvasRender } from '@/canvas/node-ops';
import type { WorkspaceFont } from '@/backend/types';

let _fonts: WorkspaceFont[] = [];
let _loaded = false;
let _loading = false;
const listeners = new Set<() => void>();

const LOCAL_STORAGE_KEY = 'revyme_custom_fonts';

function loadLocalCustomFonts(): WorkspaceFont[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalCustomFonts(fonts: WorkspaceFont[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fonts));
  } catch {}
}

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * Fetch the workspace font library once, then cache. Resolves the owning
 * workspace from the current website, lists its fonts, merges local custom fonts,
 * and pre-registers each face (so previews render). Safe to call repeatedly.
 */
export async function ensureWorkspaceFonts(): Promise<void> {
  if (_loaded || _loading) return;
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
    _fonts = Array.from(map.values());
    _loaded = true;
    trace.action('workspace-fonts:loaded', { count: _fonts.length });

    // Register every face so the picker renders each in its own typeface.
    for (const f of _fonts) {
      loadCustomFont({ family: f.family, url: f.url, weight: f.weight, style: f.style });
    }
    notify();
  } catch (err) {
    trace.error('workspace-fonts:load-failed', err);
    _loaded = true;
  } finally {
    _loading = false;
    notify();
  }
}

/** Add a newly uploaded custom font to workspace fonts */
export function addCustomFont(font: WorkspaceFont): void {
  const existingIdx = _fonts.findIndex(f => f.id === font.id || (f.family === font.family && f.weight === font.weight && f.style === font.style));
  if (existingIdx >= 0) {
    _fonts[existingIdx] = font;
  } else {
    _fonts.push(font);
  }
  const localFonts = _fonts.filter(f => f.id.startsWith('local-') || f.uploadedBy === 'user' || f.uploadedBy === 'local');
  saveLocalCustomFonts(localFonts);

  loadCustomFont({ family: font.family, url: font.url, weight: font.weight, style: font.style });
  previewWorkspaceFontInCanvas(font.family);
  applyWorkspaceFontToProject(font.family);
  notify();
}

/** Delete a custom font from workspace fonts */
export function deleteCustomFont(fontId: string): void {
  _fonts = _fonts.filter(f => f.id !== fontId);
  const localFonts = _fonts.filter(f => f.id.startsWith('local-') || f.uploadedBy === 'user' || f.uploadedBy === 'local');
  saveLocalCustomFonts(localFonts);
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

  const specs = familyFonts.map(f => ({
    family: f.family, url: f.url, weight: f.weight, style: f.style, ext: f.ext,
  }));

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
    if (f.family === family) loadCustomFontInCanvas({ family: f.family, url: f.url, weight: f.weight, style: f.style });
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
