// packages/automation-core/test/capabilities/T12-assets.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  assetsListOperation,
  assetsUploadOperation,
  assetsDeleteOperation,
  assetsAuditOperation,
} from '../../src/operations/assets';
import {
  mediaImageGetOperation,
  mediaImageSetOperation,
  mediaVideoSetOperation,
  mediaVideoRemoveOperation,
} from '../../src/operations/media';

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

const mockContext = createOperationContext();

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

describe('T12: Assets, Media, and Fills Operations', () => {
  it('handles asset upload, listing, audit and deletion with reference safety', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="root">
      <img data-id="hero-img" src="/assets/hero.png" alt="Hero banner" />
      <img data-id="broken-img" src="/assets/missing.png" alt="Missing" />
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
      'public/assets/hero.png': 'fake-png-binary-content-hero',
      'public/assets/unused.jpg': 'fake-jpg-binary-content-unused',
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. assets.list
    const listRes = await assetsListOperation.execute(snapshot, {}, mockContext);
    expect(listRes.assets.length).toBe(2);
    expect(listRes.assets.map(a => a.url)).toContain('/assets/hero.png');
    expect(listRes.assets.map(a => a.url)).toContain('/assets/unused.jpg');

    // 2. assets.upload
    const uploadRes = await assetsUploadOperation.execute(
      snapshot,
      {
        fileName: 'logo.svg',
        content: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /></svg>',
        folder: 'public/assets',
      },
      mockContext,
    );
    expect(uploadRes.changes).toHaveLength(1);
    expect(uploadRes.asset.path).toBe('public/assets/logo.svg');
    expect(uploadRes.asset.url).toBe('/assets/logo.svg');
    expect(uploadRes.asset.mimeType).toBe('image/svg+xml');

    applyChanges(mutableFiles, uploadRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };

    // 3. assets.audit
    const auditRes = await assetsAuditOperation.execute(snapshot, {}, mockContext);
    expect(auditRes.totalAssets).toBe(3);
    expect(auditRes.usedAssets).toContain('/assets/hero.png');
    expect(auditRes.unusedAssets).toContain('/assets/unused.jpg');
    expect(auditRes.unusedAssets).toContain('/assets/logo.svg');
    expect(auditRes.brokenReferences).toContainEqual({
      filePath: 'app/page.tsx',
      referencedUrl: '/assets/missing.png',
    });

    // 4. assets.delete - safe check against in-use asset
    await expect(
      assetsDeleteOperation.execute(
        snapshot,
        { path: 'public/assets/hero.png', force: false },
        mockContext,
      ),
    ).rejects.toThrow(/ASSET_IN_USE/);

    // 5. assets.delete - delete unused asset
    const deleteUnused = await assetsDeleteOperation.execute(
      snapshot,
      { path: 'public/assets/unused.jpg' },
      mockContext,
    );
    expect(deleteUnused.changes).toHaveLength(1);
    expect(deleteUnused.changes[0].content).toBeNull();
    applyChanges(mutableFiles, deleteUnused.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    expect(snapshot.files.has('public/assets/unused.jpg')).toBe(false);

    // 6. assets.delete - force delete in-use asset
    const forceDelete = await assetsDeleteOperation.execute(
      snapshot,
      { path: 'public/assets/hero.png', force: true },
      mockContext,
    );
    expect(forceDelete.changes).toHaveLength(1);
    applyChanges(mutableFiles, forceDelete.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    expect(snapshot.files.has('public/assets/hero.png')).toBe(false);
  });

  it('does not treat archived history snapshots as live asset references', async () => {
    const snapshot = createMockSnapshot({
      'app/page.client.tsx': 'export default function Page() { return <div data-id="root" />; }',
      'public/assets/audit-history-only.svg': '<svg />',
      '_meta/history.json': JSON.stringify({
        undoStack: [{ diffs: [{ path: 'app/page.client.tsx', oldContent: '<img src="/assets/audit-history-only.svg" />' }] }],
      }),
    });

    const audit = await assetsAuditOperation.execute(snapshot, {}, mockContext);
    expect(audit.unusedAssets).toContain('/assets/audit-history-only.svg');
    expect(audit.brokenReferences).toEqual([]);

    const deletion = await assetsDeleteOperation.execute(
      snapshot,
      { path: 'public/assets/audit-history-only.svg', force: false },
      mockContext,
    );
    expect(deletion.deletedPath).toBe('public/assets/audit-history-only.svg');
  });

  it('configures image attributes, responsive autoSizes and Invariant 3 removal', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="root">
      <img data-id="img-1" src="/assets/old.png" alt="Old" style={{ width: 400, height: 300 }} />
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. media.image.set with autoSizes
    const setRes = await mediaImageSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'img-1',
        src: '/assets/new.webp',
        alt: 'Updated alt text',
        loading: 'lazy',
        objectFit: 'cover',
        autoSizes: true,
        elementWidth: 800,
      },
      mockContext,
    );

    applyChanges(mutableFiles, setRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    const updatedCode = snapshot.files.get('app/page.tsx')!;
    expect(updatedCode).toContain('src="/assets/new.webp"');
    expect(updatedCode).toContain('alt="Updated alt text"');
    expect(updatedCode).toContain('loading="lazy"');
    expect(updatedCode).toMatch(/objectFit:\s*['"]cover['"]/);
    expect(updatedCode).toContain('sizes=');

    // 2. media.image.get
    const getRes = await mediaImageGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'img-1' },
      mockContext,
    );
    expect(getRes.src).toBe('/assets/new.webp');
    expect(getRes.alt).toBe('Updated alt text');
    expect(getRes.loading).toBe('lazy');
    expect(getRes.objectFit).toBe('cover');

    // 3. media.image.set with Invariant 3 empty string deletion
    const removePropsRes = await mediaImageSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'img-1',
        loading: '',
        objectFit: '',
      },
      mockContext,
    );
    applyChanges(mutableFiles, removePropsRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    const finalCode = snapshot.files.get('app/page.tsx')!;
    expect(finalCode).not.toContain('loading=');
    expect(finalCode).not.toContain('objectFit');
  });

  it('configures video elements and background video fills', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="hero-container" style={{ width: '100%', height: 500, position: 'relative' }}>
      <video data-id="player" src="/assets/clip.mp4" />
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. media.video.set on <video> element
    const setVideoRes = await mediaVideoSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'player',
        poster: '/assets/poster.jpg',
        controls: true,
        autoPlay: true,
        muted: true,
        loop: true,
        objectFit: 'cover',
      },
      mockContext,
    );
    applyChanges(mutableFiles, setVideoRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('poster="/assets/poster.jpg"');
    expect(code).toContain('controls="true"');
    expect(code).toContain('autoPlay="true"');
    expect(code).toContain('muted="true"');
    expect(code).toContain('loop="true"');
    expect(code).toContain('objectFit: "cover"');

    // 2. media.video.remove on <video> element
    const removeVideoRes = await mediaVideoRemoveOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'player',
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeVideoRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('poster=');
    expect(code).not.toContain('controls=');

    // 3. media.video.set asBackground fill on container
    const setBgVideoRes = await mediaVideoSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'hero-container',
        asBackground: true,
        src: '/assets/bg-loop.mp4',
        poster: '/assets/bg-poster.jpg',
        autoPlay: true,
        muted: true,
        loop: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, setBgVideoRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('data-bg-video');
    expect(code).toContain('/assets/bg-loop.mp4');

    // 4. media.video.remove background video fill
    const removeBgVideoRes = await mediaVideoRemoveOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'hero-container',
        asBackground: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeBgVideoRes.changes);
    snapshot = { ...snapshot, files: new Map(mutableFiles) };
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('data-bg-video');
    expect(code).not.toContain('/assets/bg-loop.mp4');
  });
});
