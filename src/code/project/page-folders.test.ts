import { describe, test, expect, beforeEach } from 'vitest';
import {
  PAGE_FOLDERS_FILE_PATH,
  listPageFolders,
  createPageFolder,
  deletePageFolder,
  pageFolderHasPages,
  renamePageFolder,
} from './page-folders';
import { projectFS, resetProjectFS } from './project-fs';

beforeEach(() => resetProjectFS());

describe('page folders', () => {
  test('lives in editor metadata, not in the published app', () => {
    expect(PAGE_FOLDERS_FILE_PATH).toBe('_meta/page-folders.json');
  });

  test('create records a slugged path', () => {
    expect(createPageFolder('Pour Qui ?')).toBe('app/pour-qui');
    expect(listPageFolders()).toEqual(['app/pour-qui']);
  });

  test('never shadows an existing page route', () => {
    // `/about` is a real page in the scaffold.
    expect(createPageFolder('About')).toBe('app/about-2');
  });

  test('a second folder of the same name gets its own path', () => {
    createPageFolder('Docs');
    expect(createPageFolder('Docs')).toBe('app/docs-2');
  });

  test('delete refuses while the folder still holds pages', () => {
    const dir = createPageFolder('Docs');
    projectFS.writeFile(`${dir}/intro/page.client.tsx`, 'x');
    expect(pageFolderHasPages(dir)).toBe(true);
    expect(deletePageFolder(dir)).toBe(false);
    expect(listPageFolders()).toEqual([dir]);
  });

  test('delete forgets an empty folder', () => {
    const dir = createPageFolder('Docs');
    expect(deletePageFolder(dir)).toBe(true);
    expect(listPageFolders()).toEqual([]);
  });

  test('rename only applies to an empty folder', () => {
    const dir = createPageFolder('Docs');
    expect(renamePageFolder(dir, 'Guides')).toBe('app/guides');
    expect(listPageFolders()).toEqual(['app/guides']);

    projectFS.writeFile('app/guides/intro/page.client.tsx', 'x');
    expect(renamePageFolder('app/guides', 'Manual')).toBeNull();
    expect(listPageFolders()).toEqual(['app/guides']);
  });

  test('a corrupt file degrades to no folders instead of throwing', () => {
    projectFS.writeFile(PAGE_FOLDERS_FILE_PATH, '{ not json');
    expect(listPageFolders()).toEqual([]);
  });
});
