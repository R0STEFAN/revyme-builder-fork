import { trace } from '@/shared/debug-trace';

export type LocalServerState = 'idle' | 'building' | 'running' | 'error';

export interface LocalServerStatus {
  status: LocalServerState;
  port: number | null;
  url: string | null;
  isBuilt: boolean;
  lastBuiltAt: number | null;
  lastError: string | null;
  pid: number | null;
}

export interface BuildResult {
  success: boolean;
  log: string;
}

function parseServerStatus(data: any): LocalServerStatus {
  if (data && typeof data.status === 'object' && data.status !== null) {
    return data.status as LocalServerStatus;
  }
  return data as LocalServerStatus;
}

/**
 * Fetch current local server status for a project.
 * Returns null if network fails or project server is unreachable.
 */
export async function fetchLocalServerStatus(projectId: string): Promise<LocalServerStatus | null> {
  trace.action('local-server-client:status', { projectId });
  try {
    const res = await fetch(`/api/local-server/${encodeURIComponent(projectId)}/status`);
    if (!res.ok) {
      trace.error('local-server-client:status-not-ok', { projectId, status: res.status });
      return null;
    }
    const data = await res.json();
    const serverStatus = parseServerStatus(data);
    trace.action('local-server-client:status-done', { projectId, status: serverStatus?.status });
    return serverStatus;
  } catch (err: any) {
    trace.error('local-server-client:status-error', { projectId, error: String(err?.message || err) });
    return null;
  }
}

/**
 * Trigger Next.js production build for a project.
 * Optionally passes memory files to export to disk prior to build,
 * and an optional active branch name.
 */
export async function buildLocalServer(
  projectId: string,
  files?: Record<string, string>,
  branch?: string
): Promise<BuildResult> {
  trace.action('local-server-client:build', {
    projectId,
    branch,
    fileCount: files ? Object.keys(files).length : 0,
  });
  try {
    const payload: { files?: Record<string, string>; branch?: string } = { files };
    if (branch !== undefined) {
      payload.branch = branch;
    }

    const res = await fetch(`/api/local-server/${encodeURIComponent(projectId)}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      trace.action('local-server-client:build-success', { projectId });
      return {
        success: true,
        log: data?.log || '',
      };
    } else {
      const log = data?.log || data?.error || 'Build failed';
      trace.error('local-server-client:build-fail', { projectId, status: res.status, log });
      return {
        success: false,
        log,
      };
    }
  } catch (err: any) {
    const log = err?.message || 'Build failed';
    trace.error('local-server-client:build-error', { projectId, error: log });
    return {
      success: false,
      log,
    };
  }
}

/**
 * Start the local server for a project on the specified or default port.
 * Throws an Error on failure.
 */
export async function startLocalServer(projectId: string, port?: number): Promise<LocalServerStatus> {
  trace.action('local-server-client:start', { projectId, port });
  try {
    const res = await fetch(`/api/local-server/${encodeURIComponent(projectId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(port !== undefined ? { port } : {}),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMsg = data?.error || `Failed to start local server (${res.status})`;
      trace.error('local-server-client:start-fail', { projectId, status: res.status, error: errorMsg });
      const error = new Error(errorMsg);
      if (data?.status) {
        (error as any).status = data.status;
      }
      throw error;
    }

    const status = parseServerStatus(data);
    trace.action('local-server-client:start-done', { projectId, port: status?.port });
    return status;
  } catch (err: any) {
    trace.error('local-server-client:start-error', { projectId, error: String(err?.message || err) });
    throw err;
  }
}

/**
 * Stop the running local server for a project.
 * Throws an Error on failure.
 */
export async function stopLocalServer(projectId: string, port?: number): Promise<LocalServerStatus> {
  trace.action('local-server-client:stop', { projectId, port });
  try {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    if (port !== undefined) {
      init.body = JSON.stringify({ port });
    }
    const res = await fetch(`/api/local-server/${encodeURIComponent(projectId)}/stop`, init);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMsg = data?.error || `Failed to stop local server (${res.status})`;
      trace.error('local-server-client:stop-fail', { projectId, status: res.status, error: errorMsg });
      const error = new Error(errorMsg);
      if (data?.status) {
        (error as any).status = data.status;
      }
      throw error;
    }

    const status = parseServerStatus(data);
    trace.action('local-server-client:stop-done', { projectId, status: status?.status });
    return status;
  } catch (err: any) {
    trace.error('local-server-client:stop-error', { projectId, error: String(err?.message || err) });
    throw err;
  }
}
