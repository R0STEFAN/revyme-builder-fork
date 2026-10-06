// thumbnail-capture.ts — Capture screenshot/thumbnail of the current website from canvas or preview and persist it.

import { CLOUD_ENABLED } from '@/shared/cloud-flag';
import { getProjectId } from '@/backend/project-id';
import { uploadPreviewThumbnail } from '@/backend/revyme-backend';
import { getCanvasBridge } from '@/canvas/canvas-bridge';
import { trace } from '@/shared/debug-trace';

let _capturing = false;
let _lastCapturedVersion: number | null = null;

/**
 * Capture a screenshot/thumbnail of the current page from the canvas
 * and save it to backend storage & localStorage.
 */
export async function captureAndSaveProjectThumbnail(projectId?: string): Promise<string | null> {
  if (_capturing) return null;
  const id = projectId || getProjectId();
  if (!id) return null;

  const bridge = getCanvasBridge() as {
    captureElement?: (
      nodeId: string,
      vpPrefix: string,
      opts: { format: 'png' | 'jpeg' | 'svg'; pixelRatio: number; backgroundColor?: string }
    ) => Promise<string | null>;
  };

  if (typeof bridge?.captureElement !== 'function') return null;

  _capturing = true;
  try {
    // Capture root element of the primary (desktop) viewport
    const dataUrl = await bridge.captureElement('root', '', {
      format: 'jpeg',
      pixelRatio: 0.6,
      backgroundColor: '#ffffff',
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return null;
    }

    trace.action('thumbnail-capture:captured', { id, size: dataUrl.length });

    if (!CLOUD_ENABLED) {
      // Local / Self-host mode: save to localStorage and server endpoint
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          localStorage.setItem(`revyme:project-preview:${id}`, dataUrl);
        } catch {
          // localStorage quota
        }
      }

      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      }).catch(() => null);

      if (res?.ok) {
        const json = await res.json().catch(() => ({}));
        return json.previewImage || dataUrl;
      }
      return dataUrl;
    } else {
      // Cloud mode
      try {
        const url = await uploadPreviewThumbnail(id, dataUrl);
        return url;
      } catch (err) {
        trace.error('thumbnail-capture:cloud-upload-failed', err);
      }
    }
  } catch (err) {
    trace.error('thumbnail-capture:failed', err);
  } finally {
    _capturing = false;
  }
  return null;
}
