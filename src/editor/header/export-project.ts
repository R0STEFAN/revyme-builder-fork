// export-project.ts — Downloads the current project as a zip.
//
// Extracted from RightHeader's `handleExport` so the cmd+K palette runs the
// identical path instead of a second copy. The React-specific parts
// (`exporting` spinner, closing the dropdown) stay in the component; this
// module owns the fetch → blob → anchor-click sequence, which is the part
// that must not diverge between callers.
//
// Cloud: each format maps to its own backend route so the service layer can
// pick the right transformer. `tailwind` returns 501 until Phase 2 lands,
// which surfaces as a "coming soon" message rather than a generic failure.
//
// Standalone (open source, no backend): the "Source code" format — a runnable
// Next.js project — is assembled and zipped IN THE BROWSER from the files the
// editor already holds (code/project/source-export.ts, shared/zip.ts). The
// other formats need a server build (prerender, Tailwind conversion) and are
// not offered there.

import { toast } from 'sonner';
import { trace } from '@/shared/debug-trace';
import { CLOUD_ENABLED } from '@/shared/cloud-flag';
import type { ExportFormat } from './ExportDropdown';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import { flushNow } from '@/code/mutation/mutation-queue';
import { buildSourceExport } from '@/code/project/source-export';
import { buildZip } from '@/shared/zip';
import { getDefaultStore } from 'jotai';
import { projectNameAtom } from '@/code/stores/project-store';

/** Whether export is reachable at all. Always: cloud exports on the server,
 *  standalone builds the Next.js source zip in the browser. */
export function canExport(): boolean {
  return true;
}

/** The formats this build can export. Standalone has no server to prerender
 *  or convert, so only the Next.js source — built locally — is on offer. */
export function canExportFormat(format: ExportFormat): boolean {
  return CLOUD_ENABLED || format === 'source';
}

/** The @revyme/runtime range to pin in an exported package.json. */
function runtimeRange(): string {
  const defined = typeof __REVYME_RUNTIME_RANGE__ === 'string' ? __REVYME_RUNTIME_RANGE__ : null;
  return defined ?? 'latest';
}

function download(bytes: Uint8Array<ArrayBuffer> | Blob, filename: string): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: some browsers start the download after click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function extractUploadFilenames(files: Iterable<string>): string[] {
  const filenames = new Set<string>();
  const regex = /(?:\/api)?\/uploads\/([a-zA-Z0-9_.-]+)/g;
  for (const text of files) {
    if (!text || typeof text !== 'string') continue;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) {
        const safeName = m[1].split('?')[0].split('#')[0];
        filenames.add(safeName);
      }
    }
  }
  return Array.from(filenames);
}

/** Standalone: MAIN's files (what publishes — never a branch), as a
 *  runnable Next.js project, zipped here and downloaded. */
async function exportSourceInBrowser(): Promise<boolean> {
  // Pending canvas edits reach ProjectFS on flush — export what's on screen.
  flushNow();
  const main = projectFS.readBranchFiles(MAIN_BRANCH_ID, { shared: true }) ?? new Map<string, string>();
  const name = getDefaultStore().get(projectNameAtom) || null;
  trace.action('export-project:local-start', { files: main.size });
  const built = await buildSourceExport(Object.fromEntries(main), { name, runtimeRange: runtimeRange() });

  // Gather referenced upload assets and fetch binary data to bundle into public/api/uploads and public/uploads
  const uploadFiles = extractUploadFilenames(main.values());
  const uploadEntries: { path: string; data: Uint8Array }[] = [];
  if (uploadFiles.length > 0) {
    await Promise.all(
      uploadFiles.map(async (filename) => {
        try {
          const res = await fetch(`/api/uploads/${encodeURIComponent(filename)}`);
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            uploadEntries.push({ path: `public/api/uploads/${filename}`, data: buf });
            uploadEntries.push({ path: `public/uploads/${filename}`, data: buf });
          }
        } catch {
          // ignore individual fetch errors
        }
      })
    );
  }

  const zipEntries = [
    ...Object.entries(built.files).map(([path, data]) => ({ path, data })),
    ...uploadEntries,
  ];

  const zip = await buildZip(zipEntries);
  download(zip, built.filename);
  if (built.failed.length > 0) {
    toast(`${built.failed.length} marketplace component${built.failed.length === 1 ? '' : 's'} couldn’t be downloaded — ${built.failed.length === 1 ? 'it stays' : 'they stay'} imported by URL.`);
  }
  trace.action('export-project:local-success', {
    filename: built.filename,
    files: Object.keys(built.files).length,
    assets: uploadEntries.length,
    bytes: zip.length,
    localized: built.downloaded.length,
    failed: built.failed.length,
  });
  return true;
}

/**
 * Fetch and download the project zip.
 *
 * @returns `true` when the download started, `false` on any handled
 *          failure (already reported to the user).
 *
 * Never throws — every caller so far treats a failure as "tell the user and
 * carry on", and a rejected promise crossing into a click handler would be
 * an unhandled rejection.
 */
export async function exportProject(format: ExportFormat = 'source'): Promise<boolean> {
  if (!CLOUD_ENABLED) {
    if (!canExportFormat(format)) {
      toast.error('Only the Next.js source export runs without Revyme Cloud.');
      return false;
    }
    try {
      return await exportSourceInBrowser();
    } catch (err) {
      trace.error('export-project:local-error', err);
      toast.error('Export failed — check console');
      return false;
    }
  }

  const { getProjectId } = await import('@/backend/project-id');
  const id = getProjectId();
  if (!id) return false;

  trace.action('export-project:start', { id, format });
  try {
    const res = await fetch(`/api/export/${format}/${id}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      trace.error('export-project:failed', { format, status: res.status, error: body });
      toast.error(
        res.status === 501
          ? 'This export format is coming soon.'
          : body?.error?.message ?? 'Export failed — check console',
      );
      return false;
    }

    // Honour the server's filename when it sends one; the backend names the
    // zip after the site, which is friendlier than a generic fallback.
    const disposition = res.headers.get('content-disposition') ?? '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? 'revyme-export.zip';

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    trace.action('export-project:success', { format, filename, bytes: blob.size });
    return true;
  } catch (err) {
    trace.error('export-project:error', err);
    toast.error('Export failed — check console');
    return false;
  }
}
