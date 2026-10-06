import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  listProjects,
  getProject,
  saveProject,
  saveProjectThumbnail,
  deleteProject,
  duplicateProject,
  saveUpload,
  getUploadFilePath,
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
  });
});
