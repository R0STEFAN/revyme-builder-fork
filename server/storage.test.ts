import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  duplicateProject,
  saveUpload,
  getUploadFilePath,
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
});
