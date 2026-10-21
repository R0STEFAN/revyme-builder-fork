// packages/automation-core/test/capabilities/T11-catalog.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  catalogListOperation,
  catalogGetOperation,
  catalogPlaceOperation,
} from '../../src/operations/catalog';
import {
  sectionsListOperation,
  sectionsGetOperation,
  sectionsInsertOperation,
} from '../../src/operations/sections';
import {
  slotsListOperation,
  slotsConnectOperation,
  slotsDisconnectOperation,
  slotsReorderOperation,
} from '../../src/operations/slots';

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

describe('T11: Built-in Catalog, Sections, and Slots', () => {
  it('browses catalog items and places built-in elements and components', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="page-root">
      <h1 data-id="title">Hello World</h1>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. List catalog items
    const list = await catalogListOperation.execute(snapshot, {}, mockContext);
    expect(list.items.length).toBeGreaterThan(10);
    expect(list.items.some((i) => i.id === 'button')).toBe(true);
    expect(list.items.some((i) => i.id === 'cs-marquee')).toBe(true);

    // 2. Get specific item
    const getRes = await catalogGetOperation.execute(snapshot, { itemId: 'cs-marquee' }, mockContext);
    expect(getRes.item).not.toBeNull();
    expect(getRes.tag).toBe('Marquee');

    // 3. Place a button
    const placeBtn = await catalogPlaceOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        parentId: 'page-root',
        itemId: 'button',
        textContent: 'Click Me Now',
      },
      mockContext,
    );
    applyChanges(mutableFiles, placeBtn.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('<button');
    expect(code).toContain('Click Me Now');

    // 4. Place a code component (Marquee)
    const placeMarquee = await catalogPlaceOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        parentId: 'page-root',
        itemId: 'cs-marquee',
      },
      mockContext,
    );
    applyChanges(mutableFiles, placeMarquee.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('<Marquee');
    expect(code).toContain("import Marquee from '@/components/Marquee';");
  });

  it('lists section blueprints and inserts them with unique IDs and font imports', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="page-root">
    </div>
  );
}`;
    const globalsCss = `:root {
  --background: #ffffff;
}
`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
      'app/globals.css': globalsCss,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. List sections
    const secList = await sectionsListOperation.execute(snapshot, {}, mockContext);
    expect(secList.sections.length).toBeGreaterThanOrEqual(4);
    expect(secList.sections.some((s) => s.id === 'header-editorial')).toBe(true);

    // 2. Get section blueprint
    const secGet = await sectionsGetOperation.execute(snapshot, { id: 'header-editorial' }, mockContext);
    expect(secGet.section).not.toBeNull();
    expect(secGet.section?.name).toBe('Editorial bar');
    expect(secGet.section?.fonts).toBeDefined();

    // 3. Insert section into page
    const insertRes = await sectionsInsertOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        blueprintId: 'header-editorial',
        parentId: 'page-root',
      },
      mockContext,
    );
    applyChanges(mutableFiles, insertRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain(insertRes.sectionRootId);
    expect(code).not.toContain('data-id="header-editorial"'); // remapped!

    const css = snapshot.files.get('app/globals.css')!;
    if (insertRes.fonts.length > 0) {
      expect(css).toContain('@import url');
    }
  });

  it('connects, reorders, and disconnects canvas nodes into code component slots', async () => {
    const pageWithCanvasNodes = `const canvasNodes = (
  <>
    <div data-id="slide-1" data-canvas-node="true" style={{ width: '200px', height: '150px' }}>
      Slide 1
    </div>
    <div data-id="slide-2" data-canvas-node="true" style={{ width: '200px', height: '150px' }}>
      Slide 2
    </div>
    <div data-id="slide-3" data-canvas-node="true" style={{ width: '200px', height: '150px' }}>
      Slide 3
    </div>
  </>
);

export default function Page() {
  return (
    <div data-id="page-root">
      <Carousel data-id="carousel-1" />
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageWithCanvasNodes,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. Initially no slot connections
    const list1 = await slotsListOperation.execute(snapshot, { targetFile: 'app/page.tsx', componentId: 'carousel-1' }, mockContext);
    expect(list1.connections['carousel-1']).toHaveLength(0);

    // 2. Connect slide-1 and slide-2 into carousel-1
    const conn1 = await slotsConnectOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        componentId: 'carousel-1',
        canvasNodeId: 'slide-1',
      },
      mockContext,
    );
    applyChanges(mutableFiles, conn1.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const conn2 = await slotsConnectOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        componentId: 'carousel-1',
        canvasNodeId: 'slide-2',
      },
      mockContext,
    );
    applyChanges(mutableFiles, conn2.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('cn_slide_1');
    expect(code).toContain('cn_slide_2');
    expect(code).toContain('<Carousel data-id="carousel-1">{cn_slide_1}{cn_slide_2}</Carousel>');

    // 3. Reorder slot: slide-2 then slide-1
    const reorderRes = await slotsReorderOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        componentId: 'carousel-1',
        orderedCanvasNodeIds: ['slide-2', 'slide-1'],
      },
      mockContext,
    );
    applyChanges(mutableFiles, reorderRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('<Carousel data-id="carousel-1">{cn_slide_2}{cn_slide_1}</Carousel>');

    // 4. Disconnect slide-1
    const disconnRes = await slotsDisconnectOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        componentId: 'carousel-1',
        canvasNodeId: 'slide-1',
      },
      mockContext,
    );
    applyChanges(mutableFiles, disconnRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('<Carousel data-id="carousel-1">{cn_slide_2}</Carousel>');
    expect(code).not.toContain('{cn_slide_1}');
  });
});
