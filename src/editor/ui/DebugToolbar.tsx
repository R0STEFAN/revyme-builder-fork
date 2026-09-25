// DebugToolbar.tsx — Floating draggable debug toolbar.
// Fixed at top center. Draggable. Record/stop button + dump + download.
// Only renders in development.

import { formatOverrideSource } from '@/code/generation/format-override-source';
import { useState, useRef, useCallback, useEffect } from 'react';
import { trace, saveDebugCode, saveDebugProjectFiles } from '@/shared/debug-trace';
import { useAtomValue, useSetAtom } from 'jotai';
import { codeAtom, selectedNodeAtom } from '@/code/stores/store';
import { parseJSX, findFirstElementByDataId } from '@/code/parsing/ast-utils';
import { projectFS, createDefaultProject, createEmptyProject, resetProjectFS, projectVersionAtom } from '@/code/project/project-fs';
import { activeFilePathAtom, getPageClientPath, isPageServerFile } from '@/code/project/active-file-store';
import { applyTemplate, pagePathForTemplate } from '@/code/project/template-ops';
import { modifyProjectFile } from '@/code/project/modify-file';
import { addPresetTokenToCSS } from '@/code/generation/preset-gen';
import { ensureFormRouteFile } from '@/code/generation/form-gen';
import { addWorkspaceFontFacesToCss, addDarkTokenValueToCSS } from '@/code/project/preset-ops';
import { queueMutation } from '@/code/mutation/mutation-queue';

/** Ported code components the importer can seed, by tag name. */
import { checkFile } from '@/code/oracle/check-file';
import { DEFAULT_VIEWPORT_WIDTH } from '@/shared/constants';
import { setSmoothScrollForPages } from '@/code/project/smooth-scroll-ops';
import { materializeInstanceFxInCode } from '@/code/generation/instance-fx-gen';
import { syncImports } from '@/code/mutation/mutation-queue';
import { listPageFiles } from '@/code/project/active-file-store';
import { normalizeSmoothScroll } from '@/code/project/smooth-scroll-config';
import { setPageEffectForPage, routeForPage } from '@/code/project/page-effects-ops';
import { pageEffectFromImportedSpec } from '@/code/project/page-effects-config';

function generateStressTestJSX(nodeCount: number): string {
  const colors = ['#f0f0ff', '#f0fff0', '#fff0f0', '#fffff0', '#f0ffff', '#fff0ff', '#e8f5e9', '#e3f2fd', '#fce4ec', '#fff3e0'];
  const rootW = DEFAULT_VIEWPORT_WIDTH;
  const rootH = Math.ceil(nodeCount / 5) * 220 + 200;
  const cols = 5;

  let jsx = `<div data-id="root" data-name="Stress Test" style={{
  position: 'relative', width: '${rootW}px', height: '${rootH}px',
  backgroundColor: '#f5f5f5'
}}>\n`;

  for (let i = 0; i < nodeCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = col * 280 + 20;
    const top = row * 220 + 20;
    const color = colors[i % colors.length];
    const id = `node-${i}`;

    jsx += `  <div data-id="${id}" data-name="Card ${i}" style={{
    position: 'absolute', left: '${left}px', top: '${top}px',
    width: '260px', height: '200px', backgroundColor: '${color}',
    borderRadius: '8px', padding: '16px',
    display: 'flex', flexDirection: 'column', gap: '8px'
  }}>
    <p data-id="${id}-title" style={{fontSize: '16px', fontWeight: '600', color: '#1a1a2e'}}>Card ${i}</p>
    <p data-id="${id}-desc" style={{fontSize: '12px', color: '#666', lineHeight: '1.4'}}>This is card number ${i} for performance testing.</p>
  </div>\n`;
  }

  jsx += `</div>`;
  return jsx;
}

/** Extract JSX source for a node by data-id. If withChildren=false, extracts only the opening tag. */
function extractNodeJSX(code: string, nodeId: string, withChildren: boolean): string | null {
  const ast = parseJSX(code);
  if (!ast) return null;
  let result: string | null = null;
  findFirstElementByDataId(ast, nodeId, (_path, element) => {
    const start = element.start;
    const end = element.end;
    if (start == null || end == null) return;
    if (withChildren) {
      result = code.slice(start, end);
    } else {
      // Self-closing or just the opening tag + closing tag without children
      const opening = element.openingElement;
      if (element.selfClosing || !element.closingElement) {
        result = code.slice(start, end);
      } else {
        // Opening tag only (up to >) + closing tag
        const openEnd = opening.end!;
        const closeStart = element.closingElement.start!;
        result = code.slice(start, openEnd) + code.slice(closeStart, end);
      }
    }
  });
  return result;
}

export default function DebugToolbar() {
  const code = useAtomValue(codeAtom);
  const setCode = useSetAtom(codeAtom);
  const selectedId = useAtomValue(selectedNodeAtom);
  const setProjectVersion = useSetAtom(projectVersionAtom);
  const setActiveFile = useSetAtom(activeFilePathAtom);
  const codeRef = useRef(code);
  codeRef.current = code;
  const beforeCodeRef = useRef('');

  const [recording, setRecording] = useState(false);
  const [entryCount, setEntryCount] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 }); // offset from default position
  // Starts COLLAPSED — a single small puck bottom-center — so the full
  // bar doesn't cover the canvas / floating UI on load. Click to expand.
  const [collapsed, setCollapsed] = useState(true);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Subscribe to recording state
  useEffect(() => {
    return trace.onRecordingStateChange(setRecording);
  }, []);

  // Update entry count while recording
  useEffect(() => {
    if (recording) {
      intervalRef.current = window.setInterval(() => {
        setEntryCount(trace.getEntries().length);
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setEntryCount(0);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [recording]);

  const handleRecord = useCallback(() => {
    if (recording) {
      trace.stopRecording();
      trace.dump();
      trace.saveRecording();          // writes to debug-trace.json
      saveDebugCode(codeRef.current); // writes to debug-code.jsx (after)
      if (beforeCodeRef.current) {
        saveDebugCode(beforeCodeRef.current, 'debug-code-before.jsx'); // before snapshot
      }
      // Save all project files with directory structure
      const allFiles: Record<string, string> = {};
      for (const filePath of projectFS.listFiles()) {
        const content = projectFS.readFile(filePath);
        if (content !== null) allFiles[filePath] = content;
      }
      saveDebugProjectFiles(allFiles);
    } else {
      // Capture "before" code in memory (don't write to disk — triggers HMR reload)
      beforeCodeRef.current = codeRef.current;
      trace.startRecording();
    }
  }, [recording]);

  const handleDump = useCallback(() => {
    trace.dump(100);
  }, []);

  const handleSave = useCallback(() => {
    trace.saveRecording();
  }, []);

  const handleClear = useCallback(() => {
    trace.clear();
    setEntryCount(0);
  }, []);

  // Drag logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return; // don't drag when clicking buttons
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: dragRef.current.startPosX + (me.clientX - dragRef.current.startX),
        y: dragRef.current.startPosY + (me.clientY - dragRef.current.startY),
      });
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [position]);

  // Don't render in production
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD) return null;

  // Collapsed — a single 30×30 puck at the same bottom-center spot
  // (respecting any drag offset). The dot stays red while recording so
  // the state is visible even when the bar is closed. Click → expand.
  const [importBusy, setImportBusy] = useState(false);

  /**
   * Import a published site through the IMPORT SERVICE.
   *
   * The service does the capture and the translation and answers with plain
   * project files; this side only writes what it is handed and validates it.
   * The builder carries no knowledge of which platform a site came from or of
   * how it was read — point `VITE_IMPORT_SERVICE_URL` at whichever service
   * should answer.
   */
  const handleSiteImport = useCallback(async () => {
    const endpoint = import.meta.env.VITE_IMPORT_SERVICE_URL;
    if (!endpoint) {
      window.alert('Set VITE_IMPORT_SERVICE_URL to the import service, e.g. http://localhost:5311');
      return;
    }
    const url = window.prompt('Site URL to import (replaces the current project)');
    if (!url) return;
    setImportBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, width: 1440, cms: true }),
      });
      // Read as text first: a service that throws before its JSON handler
      // answers with plain text, and parsing that reports a token error
      // instead of what actually happened.
      const raw = await res.text();
      let out: any;
      try { out = JSON.parse(raw); } catch {
        throw new Error(raw.slice(0, 200) || `import service answered ${res.status}`);
      }
      if (!res.ok || out.error) throw new Error(out.error || `import service answered ${res.status}`);

      const { code, template, componentFiles, overrideFiles, overrideWarnings, tokens, presets, colors, stats,
        collections, cmsFiles, iconSetFiles, templatedPages, fonts, smoothScroll, pageEffect } = out;
      if (typeof code !== 'string') throw new Error('import service returned no page code');

      // A site import is a whole project. Start from the empty starter, as the
      // Empty button does: written over the current project, the previous
      // import's collection pages stayed behind — one site's /blog and
      // /project beside another's /blogs and /projects (2026-09-14).
      resetProjectFS(createEmptyProject());

      // ICON SETS, before anything that places an icon from one. The file is
      // what makes an instance an icon rather than an unknown tag: the parser
      // reads the imported file's `@iconSet` annotation, so a page or a master
      // that arrives without it renders the icon as an anonymous frame — no
      // picker, no set, no colour.
      for (const [name, source] of Object.entries(iconSetFiles ?? {})) {
        projectFS.writeFile(`icons/${name}.tsx`, String(source));
      }
      // Components next: the page references them as @/components/<Name>, so
      // a page that arrives first renders unresolved tags.
      for (const [name, source] of Object.entries(componentFiles ?? {})) {
        projectFS.writeFile(`components/${name}.tsx`, String(source));
      }
      // Code overrides the page wraps elements in (`<Override with={withX}>`
      // imports `@/overrides/<File>`).
      for (const [path, source] of Object.entries(overrideFiles ?? {})) {
        projectFS.writeFile(path, formatOverrideSource(String(source)));
      }
      if (Array.isArray(overrideWarnings) && overrideWarnings.length) {
        trace.action('import:override-warnings', { warnings: overrideWarnings });
        console.warn('[import] code overrides that may not behave 1:1:\n' + overrideWarnings.join('\n'));
      }
      // An imported form posts to the project's own relay route, exactly as
      // one dropped from the Insert panel does — the route has to exist for
      // publish and export.
      if (/data-form=/.test(code) || Object.values(componentFiles ?? {}).some((s) => /data-form=/.test(String(s)))) {
        ensureFormRouteFile();
      }
      // CMS collections: the schema + data pair cms-ops reads, and the
      // collection's own index and detail pages built from the site's design
      // and bound to that data. Written straight to ProjectFS — JSON and
      // whole new page files, neither of which goes through the mutation
      // queue. The page pair carries its own `@cmsPage` annotation, so the
      // Pages tree and the detail-route resolver pick them up unaided.
      for (const [path, source] of Object.entries(cmsFiles ?? {})) {
        // Other pages can bring their own override files; keep them readable too.
        if (path.startsWith('overrides/') && projectFS.readFile(path) != null) continue;
        projectFS.writeFile(path, path.startsWith('overrides/') ? formatOverrideSource(String(source)) : String(source));
      }
      // Then the design tokens the page references.
      if (tokens?.length) {
        // A colour the site redefines for its dark appearance arrives with a
        // `dark` value: the light one goes to :root like any token, the dark
        // one to :root.dark — the builder's own theme model, so the Theme
        // setting switches the imported site the way prefers-color-scheme
        // switches the original.
        const dark = tokens.filter((t: any) => typeof t.dark === 'string' && t.dark);
        modifyProjectFile('app/globals.css', (css: string) =>
          dark.reduce((acc: string, t: any) => addDarkTokenValueToCSS(acc, t.name, t.dark),
            tokens.reduce((acc: string, t: any) => addPresetTokenToCSS(acc, t), css)));
        // The original follows the visitor's system scheme; so does the import.
        if (dark.length) queueMutation({ type: 'updateSiteConfig', config: { theme: 'system' } });
      }
      // …and the font FILES those tokens name. Same path as a workspace
      // custom font: `@font-face` in globals.css, which the Renderer lifts
      // into the canvas and a published site loads directly. Without these
      // every imported family falls back to a system sans and the text
      // metrics — and every min-content box around them — change.
      if (fonts?.length) {
        modifyProjectFile('app/globals.css', (css: string) => addWorkspaceFontFacesToCss(css, fonts));
      }

      // The project was just reset to the empty starter, so the site lands
      // on ITS home — never on whatever file was active before. A re-import
      // left the previous import's grouped page active: the move into the
      // template skipped it ("already inside"), the starter's `app/page.tsx`
      // stayed on as an empty "Home", and the imported home sat beside it
      // as a second "/" route.
      let pagePath = 'app/page.tsx';
      let templatePath: string | null = null;
      // A template means the page belongs inside its route group: Next
      // resolves a layout by FOLDER, so writing the LayoutClient is not
      // enough. applyTemplate creates the group and moves the page in.
      if (typeof template === 'string' && template) {
        const applied = applyTemplate('site', [pagePath]);
        templatePath = applied.layoutClient;
        pagePath = applied.moved[0]?.to ?? pagePath;
        // Heal a half-created group: `templateExists` only checks for the
        // LayoutClient, so a group missing its `layout.tsx` never gets one —
        // and without that file the page resolves no template at all.
        const groupLayout = templatePath.replace('LayoutClient.tsx', 'layout.tsx');
        if (!projectFS.exists(groupLayout)) {
          projectFS.writeFile(groupLayout, `import LayoutClient from './LayoutClient';

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return <LayoutClient>{children}</LayoutClient>;
}
`);
        }
        projectFS.writeFile(templatePath, template);
        // Write the CLIENT half — `page.tsx` is the server wrapper, and the
        // editor and canvas both read `page.client.tsx`.
        const clientPath = isPageServerFile(pagePath) ? getPageClientPath(pagePath) : pagePath;
        projectFS.writeFile(clientPath, code);
        setActiveFile(clientPath);
        pagePath = clientPath;
        // The collection pages share this chrome: the importer split it off
        // them exactly as it did for the main page, so they belong in the same
        // group or they render with no header and no footer at all. Same
        // call, same move (the page pair, nested routes included).
        const extra = (templatedPages ?? []).filter((p: string) => projectFS.exists(p));
        // A re-import writes the fresh page at its UNGROUPED path, and the
        // move refuses when last time's grouped copy is still there — which
        // left both, two /blog routes side by side. The fresh page supersedes
        // the old one exactly as the main page does, so clear the stale pair
        // first and let the move through.
        for (const p of extra) {
          const grouped = pagePathForTemplate(p, 'site');
          for (const stale of [grouped, getPageClientPath(grouped)]) {
            if (projectFS.exists(stale)) projectFS.deleteFile(stale);
          }
        }
        if (extra.length) applyTemplate('site', extra);
      } else {
        // No template: the page is the starter's home itself. `setCode`
        // below writes to the ACTIVE file, so point it there first.
        const clientPath = getPageClientPath(pagePath);
        setActiveFile(clientPath);
        pagePath = clientPath;
      }

      // The original's smooth scroll (a Lenis component on the page or
      // layout) becomes the builder's Smooth Scroll on EVERY imported page:
      // the same generated controller and root-layout mount the Animation
      // panel writes, so preview and publish run it natively.
      if (smoothScroll && typeof smoothScroll === 'object') {
        setSmoothScrollForPages(listPageFiles(), normalizeSmoothScroll(smoothScroll));
      }

      // The original's ROUTE TRANSITION becomes the site-wide Page Effect.
      // Written on the home page with Target = All Pages, which is exactly
      // where the panel keeps a site default (`__default`), so every page
      // navigates with the timing and easing the original stated — and the
      // Effects panel opens on it, editable like any hand-made one.
      if (pageEffect && typeof pageEffect === 'object') {
        const effect = pageEffectFromImportedSpec(pageEffect);
        const pages = listPageFiles();
        const home = pages.find((f: string) => routeForPage(f) === '/') ?? pages[0];
        if (effect && home) setPageEffectForPage(home, effect);
      }

      // Nested instance effects arrive as their `data-instance-fx` spec; the
      // code is generated here by the Animation panel's own writer.
      for (const path of projectFS.listFiles().filter((f: string) => f.endsWith('.tsx'))) {
        const src = projectFS.readFile(path) ?? '';
        // syncImports: the hooks the generated code uses, as every mutation adds them.
        const fx = src.includes('data-instance-fx=') ? syncImports(materializeInstanceFxInCode(src)) : src;
        if (fx !== src) projectFS.writeFile(path, fx);
      }

      // The oracle is this builder's acceptance test for ANY incoming source:
      // files it cannot resolve are files the panels cannot edit, however well
      // they render. Surface the violations instead of shipping them silently.
      const violations = checkFile(code, { kind: 'page', existingDataIds: new Set(['root']) });
      if (templatePath && template) {
        violations.push(...checkFile(template, { kind: 'template', path: templatePath }));
      }
      setCode(code);
      setProjectVersion((v) => v + 1);

      trace.action('debug-toolbar:site-import', {
        url, ...stats, violations: violations.length,
        presets: presets?.length ?? 0, colors: colors?.length ?? 0,
        tokens: tokens?.length ?? 0,
        componentFiles: Object.keys(componentFiles ?? {}).length,
        collections: (collections ?? []).map((c: any) => `${c.slug}:${c.items}`).join(',') || 'none',
        ms: +(performance.now() - t0).toFixed(0),
      });
      if (violations.length) {
        // eslint-disable-next-line no-console
        console.warn('[import] oracle violations', violations.slice(0, 20));
      }
    } catch (e: any) {
      trace.error('debug-toolbar:site-import-failed', { url, message: String(e?.message ?? e) });
      window.alert(`Import failed: ${e?.message ?? e}`);
    } finally {
      setImportBusy(false);
    }
  }, [setCode, setActiveFile, setProjectVersion]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Open debug toolbar"
        style={{
          position: 'fixed',
          // Anchored bottom-LEFT (just clear of the 308px left menu +
          // panel) instead of bottom-center, so it sits beside the
          // bottom toolbar rather than covering the centred canvas UI.
          bottom: 80 - position.y,
          left: 320 + position.x,
          zIndex: 999999,
          width: 30,
          height: 30,
          padding: 0,
          borderRadius: 8,
          background: recording ? '#1c1017' : '#18181b',
          border: `1px solid ${recording ? '#7f1d1d' : '#333'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: recording ? 3 : 6,
            background: recording ? '#ef4444' : '#52525b',
            transition: 'border-radius 0.15s',
          }}
        />
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        // Bottom-LEFT anchored (clear of the 308px left menu + panel) —
        // matches the collapsed puck's position so expand/collapse
        // doesn't jump.
        bottom: 80 - position.y,
        left: 320 + position.x,
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: recording ? '#1c1017' : '#18181b',
        border: `1px solid ${recording ? '#7f1d1d' : '#333'}`,
        borderRadius: 8,
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#a1a1aa',
        userSelect: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      {/* Grip handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          cursor: 'grab',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '4px 2px',
          marginRight: 2,
        }}
        title="Drag to move"
      >
        <div style={{ width: 12, height: 2, backgroundColor: '#555', borderRadius: 1 }} />
        <div style={{ width: 12, height: 2, backgroundColor: '#555', borderRadius: 1 }} />
        <div style={{ width: 12, height: 2, backgroundColor: '#555', borderRadius: 1 }} />
      </div>

      {/* Record / Stop button */}
      <button
        onClick={handleRecord}
        title={recording ? 'Stop recording & download' : 'Start recording'}
        style={{
          width: 20, height: 20,
          borderRadius: recording ? 4 : 10,
          border: 'none',
          background: recording ? '#ef4444' : '#dc2626',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'border-radius 0.15s',
        }}
      >
        {recording ? (
          // Stop icon (square)
          <div style={{ width: 8, height: 8, background: '#fff', borderRadius: 1 }} />
        ) : (
          // Record icon (circle)
          <div style={{ width: 10, height: 10, background: '#fff', borderRadius: 5 }} />
        )}
      </button>

      {/* Status */}
      {recording ? (
        <span style={{ color: '#ef4444', fontWeight: 600, minWidth: 80 }}>
          REC {entryCount > 0 ? `(${entryCount})` : ''}
        </span>
      ) : (
        <span style={{ color: '#71717a', minWidth: 80 }}>Debug</span>
      )}

      {/* Dump to console */}
      <button
        onClick={handleDump}
        title="Dump last 100 entries to console"
        style={btnStyle}
      >
        Console
      </button>

      {/* Save trace to file */}
      <button
        onClick={handleSave}
        title="Save trace to debug-trace.json"
        style={btnStyle}
      >
        Save
      </button>

      {/* Save code snapshot */}
      <button
        onClick={() => saveDebugCode(codeRef.current)}
        title="Save current code to debug-code.jsx"
        style={btnStyle}
      >
        Code
      </button>

      {/* Clear */}
      <button
        onClick={handleClear}
        title="Clear trace buffer"
        style={btnStyle}
      >
        Clear
      </button>

      {/* Separator */}
      <div style={{ width: 1, height: 16, backgroundColor: '#3f3f46' }} />

      {/* Copy Node (selected element only, no children) */}
      <button
        onClick={() => {
          if (!selectedId) return;
          const jsx = extractNodeJSX(codeRef.current, selectedId, false);
          if (jsx) { navigator.clipboard.writeText(jsx); trace.action('debug-toolbar:copy-node', { nodeId: selectedId, withChildren: false, chars: jsx.length }); }
          else trace.error('debug-toolbar:copy-node-failed', { nodeId: selectedId });
        }}
        title={selectedId ? `Copy "${selectedId}" (tag only)` : 'Select a node first'}
        style={{ ...btnStyle, opacity: selectedId ? 1 : 0.4 }}
      >
        Copy
      </button>

      {/* Copy Full (selected element + all children) */}
      <button
        onClick={() => {
          if (!selectedId) return;
          const jsx = extractNodeJSX(codeRef.current, selectedId, true);
          if (jsx) { navigator.clipboard.writeText(jsx); trace.action('debug-toolbar:copy-node', { nodeId: selectedId, withChildren: true, chars: jsx.length }); }
          else trace.error('debug-toolbar:copy-node-failed', { nodeId: selectedId });
        }}
        title={selectedId ? `Copy "${selectedId}" (with children)` : 'Select a node first'}
        style={{ ...btnStyle, opacity: selectedId ? 1 : 0.4 }}
      >
        Full
      </button>

      {/* Separator */}
      <div style={{ width: 1, height: 16, backgroundColor: '#3f3f46' }} />

      {/* Stress test buttons */}
      <button
        onClick={() => { const t0 = performance.now(); setCode(generateStressTestJSX(100)); trace.action('debug-toolbar:stress-test', { nodes: 100, ms: +(performance.now()-t0).toFixed(1) }); }}
        title="Inject 100 nodes (300 elements)"
        style={btnStyle}
      >
        100
      </button>
      <button
        onClick={() => { const t0 = performance.now(); setCode(generateStressTestJSX(500)); trace.action('debug-toolbar:stress-test', { nodes: 500, ms: +(performance.now()-t0).toFixed(1) }); }}
        title="Inject 500 nodes (1500 elements)"
        style={btnStyle}
      >
        500
      </button>
      <button
        onClick={() => { const t0 = performance.now(); setCode(generateStressTestJSX(1600)); trace.action('debug-toolbar:stress-test', { nodes: 1600, ms: +(performance.now()-t0).toFixed(1) }); }}
        title="Inject 1600 nodes (~your real builder size)"
        style={{ ...btnStyle, color: '#ef4444' }}
      >
        1600
      </button>

      {/* Separator */}
      <div style={{ width: 1, height: 16, backgroundColor: '#3f3f46' }} />

      {/* Site import — posts the URL to the import service and writes back
          whatever project files it answers with. */}
      <button
        onClick={handleSiteImport}
        disabled={importBusy}
        title="Import a published site into this page (needs VITE_IMPORT_SERVICE_URL)"
        style={{ ...btnStyle, color: importBusy ? '#71717a' : '#38bdf8' }}
      >
        {importBusy ? 'Importing…' : 'Import'}
      </button>

      {/* Reset to default template */}
      <button
        onClick={() => {
          const defaults = createDefaultProject();
          resetProjectFS(defaults);
          // Active file might point to a page that no longer exists in the
          // freshly-seeded FS (e.g. user was editing a route-group page that
          // the reset wiped). Snap back to app/page.tsx — guaranteed to
          // exist in both default and empty seeds.
          setActiveFile('app/page.tsx');
          const mainPage = defaults.get('app/page.tsx') || '';
          setCode(mainPage);
          // Bump projectVersion so the FileExplorer (and anything else
          // memoizing on `stableProjectVersionAtom`) re-reads the now-
          // replaced projectFS. Without this the explorer keeps the stale
          // tree from before the reset.
          setProjectVersion(v => v + 1);
          trace.action('debug-toolbar:inject-default', { fileCount: defaults.size });
        }}
        title="Reset to default template (overwrites everything)"
        style={{ ...btnStyle, color: '#f59e0b' }}
      >
        Default
      </button>

      {/* Reset to empty starter — same files the dashboard's
          "Create New Website" flow seeds with. Empty Desktop viewport,
          layout/providers/globals/lib runtime helpers only. */}
      <button
        onClick={() => {
          const empty = createEmptyProject();
          resetProjectFS(empty);
          setActiveFile('app/page.tsx');
          const mainPage = empty.get('app/page.tsx') || '';
          setCode(mainPage);
          setProjectVersion(v => v + 1);
          trace.action('debug-toolbar:inject-empty', { fileCount: empty.size });
        }}
        title="Reset to empty starter (same as a fresh website)"
        style={{ ...btnStyle, color: '#10b981' }}
      >
        Empty
      </button>

      {/* Collapse — folds the bar back to the single puck. */}
      <button
        onClick={() => setCollapsed(true)}
        title="Collapse debug toolbar"
        style={{ ...btnStyle, padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M1 1L9 9M9 1L1 9" />
        </svg>
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 4,
  color: '#a1a1aa',
  fontSize: 10,
  padding: '2px 8px',
  cursor: 'pointer',
  fontFamily: 'monospace',
};
