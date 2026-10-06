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
}

export interface ProjectRecord {
  id: string;
  name: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  data: any;
  folderId?: string | null;
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

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  return { root, projectsDir, uploadsDir, foldersFile };
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
  folderId?: string | null
): ProjectRecord {
  const { projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  let createdAt = Date.now();
  let existingName = 'Untitled Website';
  let existingFolderId: string | null = null;

  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (existing.createdAt) createdAt = existing.createdAt;
      if (existing.name) existingName = existing.name;
      if (existing.folderId !== undefined) existingFolderId = existing.folderId;
    } catch {
      // ignore read error on overwrite
    }
  }

  const finalName = (name && name.trim()) ? name.trim() : existingName;
  const finalFolderId = folderId !== undefined ? folderId : existingFolderId;
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
  };

  // Atomic write via temp file
  const tmpPath = path.join(projectsDir, `${safeId}.tmp.${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return record;
}

/**
 * Delete a project by ID.
 */
export function deleteProject(id: string, customRoot?: string): boolean {
  const { projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
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
