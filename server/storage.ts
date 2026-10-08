import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ProjectFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  folderId?: string | null;
  previewImage?: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  data: any;
  folderId?: string | null;
  previewImage?: string | null;
}

export interface ProjectVersionSummary {
  id: string;
  projectId: string;
  branchId: string;
  timestamp: number;
  label?: string;
  source: 'manual' | 'autosave' | 'restore';
  fileCount: number;
  changesSummary?: string;
}

export interface ProjectVersionRecord extends ProjectVersionSummary {
  data: any;
}

/**
 * Resolve data directory paths.
 * Default: ./data relative to current working directory, or REVYME_DATA_DIR env var.
 */
export function getDataDirs(customRoot?: string) {
  const root = customRoot || process.env.REVYME_DATA_DIR || path.resolve(process.cwd(), 'data');
  const projectsDir = path.join(root, 'projects');
  const uploadsDir = path.join(root, 'uploads');
  const foldersFile = path.join(root, 'folders.json');
  const versionsDir = path.join(root, 'versions');

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }

  return { root, projectsDir, uploadsDir, foldersFile, versionsDir };
}

/**
 * List all projects from the filesystem.
 */
export function listProjects(customRoot?: string): ProjectSummary[] {
  const { projectsDir } = getDataDirs(customRoot);
  const files = fs.readdirSync(projectsDir);
  const summaries: ProjectSummary[] = [];

  for (const file of files) {
    if (!file.endsWith('.json') || file.includes('.tmp.')) continue;
    const filePath = path.join(projectsDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      summaries.push({
        id: parsed.id || file.replace(/\.json$/, ''),
        name: parsed.name || 'Untitled Website',
        fileCount: parsed.fileCount ?? (parsed.data?.files ? Object.keys(parsed.data.files).length : 0),
        createdAt: parsed.createdAt || Date.now(),
        updatedAt: parsed.updatedAt || Date.now(),
        folderId: parsed.folderId ?? null,
        previewImage: parsed.previewImage ?? parsed.data?.previewImage ?? null,
      });
    } catch (err) {
      console.error(`[Revyme Storage] Failed to read project ${file}:`, err);
    }
  }

  // Sort newest first
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get full project by ID.
 */
export function getProject(id: string, customRoot?: string): ProjectRecord | null {
  const { projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      id: parsed.id || safeId,
      name: parsed.name || 'Untitled Website',
      fileCount: parsed.fileCount ?? (parsed.data?.files ? Object.keys(parsed.data.files).length : 0),
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: parsed.updatedAt || Date.now(),
      data: parsed.data || null,
      folderId: parsed.folderId ?? null,
      previewImage: parsed.previewImage ?? parsed.data?.previewImage ?? null,
    };
  } catch (err) {
    console.error(`[Revyme Storage] Error loading project ${safeId}:`, err);
    return null;
  }
}

/**
 * Save project data to disk atomically.
 */
export function saveProject(
  id: string,
  data: any,
  name?: string,
  customRoot?: string,
  folderId?: string | null,
  previewImage?: string | null
): ProjectRecord {
  const { projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  let createdAt = Date.now();
  let existingName = 'Untitled Website';
  let existingFolderId: string | null = null;
  let existingPreviewImage: string | null = null;

  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (existing.createdAt) createdAt = existing.createdAt;
      if (existing.name) existingName = existing.name;
      if (existing.folderId !== undefined) existingFolderId = existing.folderId;
      if (existing.previewImage !== undefined) existingPreviewImage = existing.previewImage;
    } catch {
      // ignore read error on overwrite
    }
  }

  const finalName = (name && name.trim()) ? name.trim() : existingName;
  const finalFolderId = folderId !== undefined ? folderId : existingFolderId;
  const finalPreviewImage = previewImage !== undefined ? previewImage : existingPreviewImage;
  const fileCount = data?.files ? Object.keys(data.files).length : 0;
  const updatedAt = Date.now();

  const record: ProjectRecord = {
    id: safeId,
    name: finalName,
    fileCount,
    createdAt,
    updatedAt,
    data,
    folderId: finalFolderId,
    previewImage: finalPreviewImage,
  };

  // Atomic write via temp file
  const tmpPath = path.join(projectsDir, `${safeId}.tmp.${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return record;
}

/**
 * Save or update project thumbnail image.
 */
export function saveProjectThumbnail(
  id: string,
  dataUrl: string,
  customRoot?: string
): ProjectRecord | null {
  const { uploadsDir, projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const project = getProject(id, customRoot);
  if (!project) return null;

  let previewUrl = dataUrl;

  const match = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
  if (match) {
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const filename = `thumbnail-${safeId}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);
    previewUrl = `/api/uploads/${filename}?t=${Date.now()}`;
  }

  const filePath = path.join(projectsDir, `${safeId}.json`);
  const record: ProjectRecord = {
    ...project,
    previewImage: previewUrl,
    updatedAt: Date.now(),
  };

  const tmpPath = path.join(projectsDir, `${safeId}.tmp.${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return record;
}

/**
 * Delete a project by ID.
 */
export function deleteProject(id: string, customRoot?: string): boolean {
  const { projectsDir, versionsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);

  const projectVersionsDir = path.join(versionsDir, safeId);
  if (fs.existsSync(projectVersionsDir)) {
    try {
      fs.rmSync(projectVersionsDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }

  return true;
}

/**
 * Duplicate an existing project.
 */
export function duplicateProject(
  sourceId: string,
  newName?: string,
  customRoot?: string
): ProjectRecord | null {
  const source = getProject(sourceId, customRoot);
  if (!source) return null;

  const newId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const duplicateName = newName || `${source.name} (Copy)`;

  return saveProject(newId, source.data, duplicateName, customRoot, source.folderId ?? null);
}

/**
 * List all folders from folders.json.
 */
export function listFolders(customRoot?: string): ProjectFolder[] {
  const { foldersFile } = getDataDirs(customRoot);
  if (!fs.existsSync(foldersFile)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(foldersFile, 'utf-8');
    const folders = JSON.parse(raw);
    return Array.isArray(folders) ? folders : [];
  } catch (err) {
    console.error('[Revyme Storage] Failed to read folders:', err);
    return [];
  }
}

/**
 * Save a new folder to folders.json.
 */
export function saveFolder(name: string, customRoot?: string): ProjectFolder {
  const { foldersFile } = getDataDirs(customRoot);
  const folders = listFolders(customRoot);
  const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newFolder: ProjectFolder = {
    id,
    name: name.trim() || 'New Folder',
    createdAt: Date.now(),
  };
  folders.push(newFolder);
  fs.writeFileSync(foldersFile, JSON.stringify(folders, null, 2), 'utf-8');
  return newFolder;
}

/**
 * Rename an existing folder in folders.json.
 */
export function renameFolder(id: string, name: string, customRoot?: string): ProjectFolder | null {
  const { foldersFile } = getDataDirs(customRoot);
  const folders = listFolders(customRoot);
  const idx = folders.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  folders[idx].name = name.trim() || folders[idx].name;
  fs.writeFileSync(foldersFile, JSON.stringify(folders, null, 2), 'utf-8');
  return folders[idx];
}

/**
 * Delete a folder from folders.json and unassign all projects in it.
 */
export function deleteFolder(id: string, customRoot?: string): boolean {
  const { foldersFile, projectsDir } = getDataDirs(customRoot);
  const folders = listFolders(customRoot);
  const nextFolders = folders.filter((f) => f.id !== id);
  if (nextFolders.length === folders.length) return false;
  fs.writeFileSync(foldersFile, JSON.stringify(nextFolders, null, 2), 'utf-8');

  // Unassign projects that belonged to this folder
  try {
    const files = fs.readdirSync(projectsDir);
    for (const file of files) {
      if (!file.endsWith('.json') || file.includes('.tmp.')) continue;
      const filePath = path.join(projectsDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.folderId === id) {
          parsed.folderId = null;
          fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
        }
      } catch {
        // ignore single file error
      }
    }
  } catch {
    // ignore
  }

  return true;
}

/**
 * Update a project's assigned folder.
 */
export function setProjectFolder(
  projectId: string,
  folderId: string | null,
  customRoot?: string
): boolean {
  const { projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(projectId);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    parsed.folderId = folderId;
    parsed.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[Revyme Storage] Error updating project folder for ${safeId}:`, err);
    return false;
  }
}

/**
 * Save an uploaded file to disk.
 */
export function saveUpload(
  originalFilename: string,
  buffer: Buffer,
  customRoot?: string
): { filename: string; url: string; size: number } {
  const { uploadsDir } = getDataDirs(customRoot);
  const safeBase = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(safeBase) || '.bin';
  const nameWithoutExt = path.basename(safeBase, ext);
  const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${uniquePrefix}-${nameWithoutExt}${ext}`;
  const filePath = path.join(uploadsDir, filename);

  fs.writeFileSync(filePath, buffer);

  return {
    filename,
    url: `/api/uploads/${filename}`,
    size: buffer.length,
  };
}

/**
 * Save an uploaded file with its exact filename (used during bundle import).
 */
export function saveUploadExact(
  filename: string,
  buffer: Buffer,
  customRoot?: string
): { filename: string; url: string; size: number } {
  const { uploadsDir } = getDataDirs(customRoot);
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(uploadsDir, safeName);

  fs.writeFileSync(filePath, buffer);

  return {
    filename: safeName,
    url: `/api/uploads/${safeName}`,
    size: buffer.length,
  };
}

/**
 * Get upload file path if it exists safely.
 */
export function getUploadFilePath(filename: string, customRoot?: string): string | null {
  const { uploadsDir } = getDataDirs(customRoot);
  const safeName = path.basename(filename);
  const fullPath = path.join(uploadsDir, safeName);

  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  return null;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ─── Version History on Disk (Cap 100 / Branch-aware) ───────────────────────

export const MAX_PROJECT_VERSIONS = 100;

function isDataIdentical(dataA: any, dataB: any): boolean {
  if (!dataA || !dataB) return false;
  const filesA = dataA.files || {};
  const filesB = dataB.files || {};
  const keysA = Object.keys(filesA);
  const keysB = Object.keys(filesB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (filesA[k] !== filesB[k]) return false;
  }
  const branchesA = JSON.stringify(dataA.branches || null);
  const branchesB = JSON.stringify(dataB.branches || null);
  return branchesA === branchesB;
}

/**
 * Save a new project version snapshot to disk.
 * Enforces deduplication against latest version on same branch,
 * and maintains a maximum of 100 versions per project (FIFO rotation).
 */
export function saveProjectVersion(
  id: string,
  data: any,
  options?: {
    branchId?: string;
    source?: 'manual' | 'autosave' | 'restore';
    label?: string;
    changesSummary?: string;
  },
  customRoot?: string
): ProjectVersionRecord | null {
  if (!data || typeof data !== 'object' || !data.files) {
    return null;
  }

  const { versionsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const projectVersionsDir = path.join(versionsDir, safeId);
  const manifestPath = path.join(projectVersionsDir, 'manifest.json');

  if (!fs.existsSync(projectVersionsDir)) {
    fs.mkdirSync(projectVersionsDir, { recursive: true });
  }

  let manifest: ProjectVersionSummary[] = [];
  if (fs.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (Array.isArray(parsed)) manifest = parsed;
    } catch {
      manifest = [];
    }
  }

  const branchId = options?.branchId || data?.activeBranchId || 'main';

  // Deduplication check: compare against latest version of the same branch
  const latestSameBranch = manifest.find((v) => v.branchId === branchId);
  if (latestSameBranch) {
    const latestFilePath = path.join(projectVersionsDir, `${sanitizeId(latestSameBranch.id)}.json`);
    if (fs.existsSync(latestFilePath)) {
      try {
        const latestRecord: ProjectVersionRecord = JSON.parse(fs.readFileSync(latestFilePath, 'utf-8'));
        if (isDataIdentical(latestRecord.data, data)) {
          // If manual save over autosave without changes, upgrade label without duplicate
          if (options?.source === 'manual' && latestSameBranch.source !== 'manual') {
            latestSameBranch.source = 'manual';
            if (options.label) latestSameBranch.label = options.label;
            latestRecord.source = 'manual';
            if (options.label) latestRecord.label = options.label;
            fs.writeFileSync(latestFilePath, JSON.stringify(latestRecord, null, 2), 'utf-8');
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
            return latestRecord;
          }
          return null; // identical, skip saving duplicate
        }
      } catch {
        // ignore read error
      }
    }
  }

  const now = Date.now();
  const source = options?.source || 'autosave';
  const versionId = `ver-${now}-${source}-${Math.random().toString(36).slice(2, 6)}`;
  const fileCount = Object.keys(data.files).length;

  const record: ProjectVersionRecord = {
    id: versionId,
    projectId: safeId,
    branchId,
    timestamp: now,
    label: options?.label || (source === 'manual' ? 'Manual save' : source === 'restore' ? 'Before restore' : 'Autosave'),
    source,
    fileCount,
    changesSummary: options?.changesSummary,
    data,
  };

  const versionFilePath = path.join(projectVersionsDir, `${versionId}.json`);
  const tmpPath = path.join(projectVersionsDir, `${versionId}.tmp.${now}`);
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmpPath, versionFilePath);

  const summary: ProjectVersionSummary = {
    id: versionId,
    projectId: safeId,
    branchId,
    timestamp: now,
    label: record.label,
    source,
    fileCount,
    changesSummary: record.changesSummary,
  };

  manifest.unshift(summary);

  // FIFO pruning: cap to MAX_PROJECT_VERSIONS (100)
  if (manifest.length > MAX_PROJECT_VERSIONS) {
    const toRemove = manifest.slice(MAX_PROJECT_VERSIONS);
    manifest = manifest.slice(0, MAX_PROJECT_VERSIONS);
    for (const old of toRemove) {
      const oldFilePath = path.join(projectVersionsDir, `${sanitizeId(old.id)}.json`);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch {
          // ignore
        }
      }
    }
  }

  const manifestTmp = path.join(projectVersionsDir, `manifest.tmp.${now}`);
  fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(manifestTmp, manifestPath);

  return record;
}

/**
 * List all saved versions for a project, optionally filtered by branchId.
 */
export function listProjectVersions(
  id: string,
  branchId?: string,
  customRoot?: string
): ProjectVersionSummary[] {
  const { versionsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const manifestPath = path.join(versionsDir, safeId, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (branchId) {
      return parsed.filter((v: ProjectVersionSummary) => v.branchId === branchId);
    }
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Get full project version record by ID.
 */
export function getProjectVersion(
  id: string,
  versionId: string,
  customRoot?: string
): ProjectVersionRecord | null {
  const { versionsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const safeVersionId = sanitizeId(versionId);
  const filePath = path.join(versionsDir, safeId, `${safeVersionId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Restore a version snapshot: auto-checkpoints current state to disk
 * as "Before restore" and updates data/projects/{id}.json.
 */
export function restoreProjectVersion(
  id: string,
  versionId: string,
  customRoot?: string
): { success: boolean; project?: ProjectRecord; version?: ProjectVersionRecord; error?: string } {
  const version = getProjectVersion(id, versionId, customRoot);
  if (!version || !version.data) {
    return { success: false, error: 'Version not found' };
  }

  const current = getProject(id, customRoot);
  // Auto-checkpoint current state as "Before restore" so restore is 100% reversible
  if (current && current.data && current.data.files && Object.keys(current.data.files).length > 0) {
    saveProjectVersion(id, current.data, {
      branchId: version.branchId || current.data.activeBranchId || 'main',
      source: 'restore',
      label: 'Before restore',
    }, customRoot);
  }

  // Update active project file on disk
  const savedProject = saveProject(
    id,
    version.data,
    current?.name,
    customRoot,
    current?.folderId,
    current?.previewImage
  );

  return { success: true, project: savedProject, version };
}

/**
 * Delete a specific version by ID.
 */
export function deleteProjectVersion(
  id: string,
  versionId: string,
  customRoot?: string
): boolean {
  const { versionsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const safeVersionId = sanitizeId(versionId);
  const projectVersionsDir = path.join(versionsDir, safeId);
  const filePath = path.join(projectVersionsDir, `${safeVersionId}.json`);
  const manifestPath = path.join(projectVersionsDir, 'manifest.json');

  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  if (fs.existsSync(manifestPath)) {
    try {
      const manifest: ProjectVersionSummary[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const updated = manifest.filter((v) => v.id !== versionId);
      fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

