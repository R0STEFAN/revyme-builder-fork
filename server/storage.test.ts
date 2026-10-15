import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  listProjects,
  getProject,
  saveProject,
  saveProjectThumbnail,
  deleteProject,
  deleteProjects,
  duplicateProject,
  saveUpload,
  getUploadFilePath,
  getThumbnailFilePath,
  ensureThumbnail,
  listUploads,
  deleteUpload,
  getStorageInfo,
  listFolders,
  saveFolder,
  renameFolder,
  deleteFolder,
  setProjectFolder,
} from './storage';

const TEST_DATA_DIR = path.resolve(process.cwd(), '.test-data');

describe('Self-host storage', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it('saves and retrieves a project', () => {
    const data = {
      format: 'revyme-v1',
      files: {
        'app/page.tsx': 'export default function Page() { return <div>Hello</div>; }',
      },
    };

    const saved = saveProject('proj-1', data, 'Client Site 1', TEST_DATA_DIR);
    expect(saved.id).toBe('proj-1');
    expect(saved.name).toBe('Client Site 1');
    expect(saved.fileCount).toBe(1);

    const loaded = getProject('proj-1', TEST_DATA_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Client Site 1');
    expect(loaded?.data.files['app/page.tsx']).toContain('Hello');
  });

  it('lists projects sorted by updatedAt', async () => {
    saveProject('p1', { files: {} }, 'First Site', TEST_DATA_DIR);
    // slight delay for different timestamps
    await new Promise((r) => setTimeout(r, 10));
    saveProject('p2', { files: { 'a': '1', 'b': '2' } }, 'Second Site', TEST_DATA_DIR);

    const list = listProjects(TEST_DATA_DIR);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('p2');
    expect(list[0].fileCount).toBe(2);
    expect(list[1].id).toBe('p1');
    expect(list[1].fileCount).toBe(0);
  });

  it('duplicates a project', () => {
    saveProject('origin', { files: { 'index.tsx': 'code' } }, 'Original Site', TEST_DATA_DIR);
    const copy = duplicateProject('origin', 'Cloned Site', TEST_DATA_DIR);

    expect(copy).not.toBeNull();
    expect(copy?.name).toBe('Cloned Site');
    expect(copy?.id).not.toBe('origin');
    expect(copy?.data.files['index.tsx']).toBe('code');

    const all = listProjects(TEST_DATA_DIR);
    expect(all.length).toBe(2);
  });

  it('deletes a project', () => {
    saveProject('to-delete', { files: {} }, 'Temp Site', TEST_DATA_DIR);
    expect(listProjects(TEST_DATA_DIR).length).toBe(1);

    const deleted = deleteProject('to-delete', TEST_DATA_DIR);
    expect(deleted).toBe(true);
    expect(listProjects(TEST_DATA_DIR).length).toBe(0);
    expect(getProject('to-delete', TEST_DATA_DIR)).toBeNull();
  });

  it('deletes multiple projects and their files at once', () => {
    saveProject('proj-1', { files: { 'app/page.tsx': '// p1' } }, 'Site 1', TEST_DATA_DIR);
    saveProject('proj-2', { files: { 'app/page.tsx': '// p2' } }, 'Site 2', TEST_DATA_DIR);
    saveProject('proj-3', { files: { 'app/page.tsx': '// p3' } }, 'Site 3', TEST_DATA_DIR);
    expect(listProjects(TEST_DATA_DIR).length).toBe(3);

    // Save an upload associated with proj-1
    const upload1 = saveUpload('p1-photo.png', Buffer.from('photo 1'), TEST_DATA_DIR, 'proj-1');
    const p1FilePath = getUploadFilePath(upload1.filename, TEST_DATA_DIR);
    expect(fs.existsSync(p1FilePath!)).toBe(true);

    // Save thumbnail for proj-2
    saveProjectThumbnail(
      'proj-2',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      TEST_DATA_DIR
    );

    const result = deleteProjects(['proj-1', 'proj-2'], TEST_DATA_DIR);
    expect(result.deleted).toEqual(['proj-1', 'proj-2']);
    expect(result.failed).toEqual([]);

    // Remaining projects
    const remaining = listProjects(TEST_DATA_DIR);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('proj-3');

    // Associated upload file for proj-1 should be cleaned up
    expect(fs.existsSync(p1FilePath!)).toBe(false);
  });

  it('handles uploads safely', () => {
    const buf = Buffer.from('fake image content');
    const upload = saveUpload('avatar photo.png', buf, TEST_DATA_DIR);

    expect(upload.url).toMatch(/^\/api\/uploads\/\d+-[a-f0-9]+-avatar_photo\.png$/);
    const filePath = getUploadFilePath(upload.filename, TEST_DATA_DIR);
    expect(filePath).not.toBeNull();
    expect(fs.readFileSync(filePath!)).toEqual(buf);
  });

  it('manages folders and project folder assignment', () => {
    // 1. Create and list folders
    const f1 = saveFolder('Marketing', TEST_DATA_DIR);
    const f2 = saveFolder('Client Sites', TEST_DATA_DIR);
    const list = listFolders(TEST_DATA_DIR);
    expect(list.length).toBe(2);
    expect(list.map(f => f.name)).toContain('Marketing');
    expect(list.map(f => f.name)).toContain('Client Sites');

    // 2. Rename folder
    const renamed = renameFolder(f1.id, 'Marketing 2026', TEST_DATA_DIR);
    expect(renamed?.name).toBe('Marketing 2026');

    // 3. Create project and assign to folder
    const p = saveProject('proj-folder-test', { files: {} }, 'Brand Site', TEST_DATA_DIR);
    expect(p.folderId).toBeNull();

    const assigned = setProjectFolder('proj-folder-test', f1.id, TEST_DATA_DIR);
    expect(assigned).toBe(true);

    const loadedP = getProject('proj-folder-test', TEST_DATA_DIR);
    expect(loadedP?.folderId).toBe(f1.id);

    const summaries = listProjects(TEST_DATA_DIR);
    expect(summaries.find(s => s.id === 'proj-folder-test')?.folderId).toBe(f1.id);

    // 4. Delete folder unassigns the project, project still exists
    const deletedFolder = deleteFolder(f1.id, TEST_DATA_DIR);
    expect(deletedFolder).toBe(true);
    expect(listFolders(TEST_DATA_DIR).length).toBe(1);

    const unassignedProject = getProject('proj-folder-test', TEST_DATA_DIR);
    expect(unassignedProject).not.toBeNull();
    expect(unassignedProject?.folderId).toBeNull();
  });

  it('saves and updates project thumbnail', () => {
    saveProject('thumb-test', { files: {} }, 'Thumbnail Site', TEST_DATA_DIR);
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-data').toString('base64');
    const updated = saveProjectThumbnail('thumb-test', dataUrl, TEST_DATA_DIR);

    expect(updated).not.toBeNull();
    expect(updated?.previewImage).toMatch(/^\/api\/uploads\/thumbnail-thumb-test\.jpg\?t=\d+$/);

    const loaded = getProject('thumb-test', TEST_DATA_DIR);
    expect(loaded?.previewImage).toMatch(/^\/api\/uploads\/thumbnail-thumb-test\.jpg\?t=\d+$/);

    const summaries = listProjects(TEST_DATA_DIR);
    expect(summaries.find(s => s.id === 'thumb-test')?.previewImage).toMatch(/^\/api\/uploads\/thumbnail-thumb-test\.jpg\?t=\d+$/);

    // Project thumbnail must not appear in project media manager
    const mediaUploads = listUploads(undefined, TEST_DATA_DIR);
    expect(mediaUploads.some(u => u.key.startsWith('thumbnail-'))).toBe(false);
  });

  it('isolates uploads by projectId and calculates project-scoped storage', () => {
    const bufA = Buffer.from('photo A content for project A');
    const bufB = Buffer.from('photo B content for project B');

    const upA = saveUpload('photoA.png', bufA, TEST_DATA_DIR, 'project-a');
    const upB = saveUpload('photoB.png', bufB, TEST_DATA_DIR, 'project-b');

    // Listing for project-a should only contain photoA
    const listA = listUploads(undefined, TEST_DATA_DIR, 'project-a');
    expect(listA.length).toBe(1);
    expect(listA[0].key).toBe(upA.key);
    expect(listA[0].projectId).toBe('project-a');

    // Listing for project-b should only contain photoB
    const listB = listUploads(undefined, TEST_DATA_DIR, 'project-b');
    expect(listB.length).toBe(1);
    expect(listB[0].key).toBe(upB.key);
    expect(listB[0].projectId).toBe('project-b');

    // Unscoped listing returns both
    const listAll = listUploads(undefined, TEST_DATA_DIR);
    expect(listAll.length).toBe(2);

    // Storage info scoped to project-a reflects only project-a uploads
    const storageA = getStorageInfo(TEST_DATA_DIR, 'project-a');
    expect(storageA.used).toBe(bufA.length);

    // Deleting upA removes it from project-a
    expect(deleteUpload(upA.key, TEST_DATA_DIR)).toBe(true);
    expect(listUploads(undefined, TEST_DATA_DIR, 'project-a').length).toBe(0);
    expect(listUploads(undefined, TEST_DATA_DIR, 'project-b').length).toBe(1);
  });

  it('generates, caches on disk, and deletes image thumbnails', async () => {
    const sharp = (await import('sharp')).default;
    const imgBuf = await sharp({
      create: { width: 1000, height: 800, channels: 3, background: { r: 10, g: 200, b: 100 } }
    }).png().toBuffer();

    const upload = saveUpload('big-banner.png', imgBuf, TEST_DATA_DIR, 'proj-thumbs');
    expect(upload.thumbnailUrl).toBe(`/api/uploads/thumb/${upload.filename}`);

    const list = listUploads('image', TEST_DATA_DIR, 'proj-thumbs');
    expect(list[0].thumbnailUrl).toBe(`/api/uploads/thumb/${upload.filename}`);

    // Generate/ensure thumbnail on disk
    const thumbPath = await ensureThumbnail(upload.filename, TEST_DATA_DIR);
    expect(thumbPath).not.toBeNull();
    expect(fs.existsSync(thumbPath!)).toBe(true);
    expect(thumbPath!.endsWith('.webp')).toBe(true);

    // Verify thumbnail is cached on disk
    const cachedPath = getThumbnailFilePath(upload.filename, TEST_DATA_DIR);
    expect(cachedPath).toBe(thumbPath);

    // Verify thumbnail dimensions fit inside 240x240
    const meta = await sharp(thumbPath!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(240);
    expect(meta.height).toBeLessThanOrEqual(240);

    // Deleting upload must remove both original file and thumbnail from disk
    const deleted = deleteUpload(upload.filename, TEST_DATA_DIR);
    expect(deleted).toBe(true);
    expect(fs.existsSync(thumbPath!)).toBe(false);
    expect(getUploadFilePath(upload.filename, TEST_DATA_DIR)).toBeNull();
    expect(getThumbnailFilePath(upload.filename, TEST_DATA_DIR)).toBeNull();
  });
});
