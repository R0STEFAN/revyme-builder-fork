import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ProjectSummary {
  id: string;
  name: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
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

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  return { root, projectsDir, uploadsDir };
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
  customRoot?: string
): ProjectRecord {
  const { projectsDir } = getDataDirs(customRoot);
  const safeId = sanitizeId(id);
  const filePath = path.join(projectsDir, `${safeId}.json`);

  let createdAt = Date.now();
  let existingName = 'Untitled Website';

  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (existing.createdAt) createdAt = existing.createdAt;
      if (existing.name) existingName = existing.name;
    } catch {
      // ignore read error on overwrite
    }
  }

  const finalName = (name && name.trim()) ? name.trim() : existingName;
  const fileCount = data?.files ? Object.keys(data.files).length : 0;
  const updatedAt = Date.now();

  const record: ProjectRecord = {
    id: safeId,
    name: finalName,
    fileCount,
    createdAt,
    updatedAt,
    data,
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

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
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

  return saveProject(newId, source.data, duplicateName, customRoot);
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
