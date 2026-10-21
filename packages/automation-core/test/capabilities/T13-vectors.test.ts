// packages/automation-core/test/capabilities/T13-vectors.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  vectorsListOperation,
  vectorsCreateSetOperation,
  vectorsAddVariantOperation,
  vectorsRemoveVariantOperation,
  vectorsSearchIconsOperation,
  vectorsRetiredSketchesOperation,
} from '../../src/operations/vectors';
import {
  shapesGetOperation,
  shapesUpdateAttrsOperation,
  shapesAddChildOperation,
  shapesRemoveChildOperation,
  shapesReplaceInnerOperation,
} from '../../src/operations/shapes';
import {
  drawingSketchAnimSetOperation,
  drawingSketchAnimGetOperation,
  drawingSketchAnimRemoveOperation,
  drawingSketchAnimListOperation,
} from '../../src/operations/drawing';

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

describe('T13: Vectors, SVG Shapes, Path, and Active Drawing', () => {
  it('manages vector icon set lifecycle: createSet, list, addVariant, and removeVariant with single variant guard', async () => {
    let snapshot = createMockSnapshot({});
    const mutableFiles = new Map(snapshot.files);

    // 1. vectors.createSet
    const createRes = await vectorsCreateSetOperation.execute(
      snapshot,
      {
        name: 'BrandIcons',
        icons: [
          {
            id: 'icon-star',
            displayName: 'Star Icon',
            svgMarkup: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27" fill="gold" /></svg>',
          },
        ],
      },
      mockContext,
    );
    expect(createRes.changes).toHaveLength(1);
    expect(createRes.vectorSet.filePath).toBe('icons/BrandIcons.tsx');
    expect(createRes.vectorSet.displayName).toBe('BrandIcons');

    applyChanges(mutableFiles, createRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));

    // 2. vectors.list
    const listRes = await vectorsListOperation.execute(snapshot, {}, mockContext);
    expect(listRes.vectorSets).toHaveLength(1);
    expect(listRes.vectorSets[0].exportName).toBe('BrandIcons');
    expect(listRes.vectorSets[0].displayName).toBe('BrandIcons');
    expect(listRes.vectorSets[0].icons).toHaveLength(1);
    expect(listRes.vectorSets[0].icons[0].id).toBe('icon-star');

    // 3. vectors.addVariant
    const addRes = await vectorsAddVariantOperation.execute(
      snapshot,
      {
        targetFile: 'icons/BrandIcons.tsx',
        name: 'Heart Icon',
        id: 'icon-heart',
        svgMarkup: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5" fill="red" /></svg>',
      },
      mockContext,
    );
    expect(addRes.variant.id).toBe('icon-heart');
    applyChanges(mutableFiles, addRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));

    // Verify list after adding variant
    const listAfterAdd = await vectorsListOperation.execute(snapshot, {}, mockContext);
    expect(listAfterAdd.vectorSets[0].icons).toHaveLength(2);

    // 4. vectors.removeVariant - remove one of the two
    const removeRes = await vectorsRemoveVariantOperation.execute(
      snapshot,
      {
        targetFile: 'icons/BrandIcons.tsx',
        variantId: 'icon-heart',
      },
      mockContext,
    );
    expect(removeRes.removedId).toBe('icon-heart');
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));

    const listAfterRemove = await vectorsListOperation.execute(snapshot, {}, mockContext);
    expect(listAfterRemove.vectorSets[0].icons).toHaveLength(1);

    // 5. vectors.removeVariant - guard against removing the last remaining variant
    await expect(
      vectorsRemoveVariantOperation.execute(
        snapshot,
        {
          targetFile: 'icons/BrandIcons.tsx',
          variantId: 'icon-star',
        },
        mockContext,
      ),
    ).rejects.toThrow(/CANNOT_REMOVE_LAST_VARIANT/);

    // 6. vectors.searchIcons
    const searchRes = await vectorsSearchIconsOperation.execute(
      snapshot,
      { query: 'arrow', limit: 5 },
      mockContext,
    );
    expect(searchRes.icons.length).toBeGreaterThan(0);
    expect(searchRes.icons.some(i => i.name.includes('arrow'))).toBe(true);

    // 7. vectors.retiredSketches - reports retirement reason
    const retiredRes = await vectorsRetiredSketchesOperation.execute(snapshot, {}, mockContext);
    expect(retiredRes.retired).toBe(true);
    expect(retiredRes.reason).toContain('removed from the product');
  });

  it('manipulates SVG attributes, children, and inner contents with shapes operations', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="root">
      <svg data-id="svg-shape" viewBox="0 0 100 100" style={{ width: 100, height: 100 }}>
        <path data-id="path-1" d="M10 10 L90 90" stroke="black" strokeWidth="2" fill="none" />
      </svg>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. shapes.get
    const getRes = await shapesGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'svg-shape' },
      mockContext,
    );
    expect(getRes.viewBox).toBe('0 0 100 100');

    // 2. shapes.updateAttrs on the inner shape element
    const updateRes = await shapesUpdateAttrsOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'svg-shape',
        attrs: {
          stroke: '#3b82f6',
          strokeWidth: '4',
          fill: '#dbeafe',
        },
      },
      mockContext,
    );
    applyChanges(mutableFiles, updateRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('stroke="#3b82f6"');
    expect(code).toContain('strokeWidth="4"');
    expect(code).toContain('fill="#dbeafe"');

    // 3. shapes.addChild: append a <circle>
    const addCircleRes = await shapesAddChildOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        svgNodeId: 'svg-shape',
        childJSX: '<circle data-id="circle-1" cx="50" cy="50" r="20" fill="yellow" />',
      },
      mockContext,
    );
    applyChanges(mutableFiles, addCircleRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('<circle data-id="circle-1"');

    // 4. shapes.removeChild: remove the second child (index 1 = circle)
    const removeCircleRes = await shapesRemoveChildOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        svgNodeId: 'svg-shape',
        childIndex: 1,
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeCircleRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('<circle data-id="circle-1"');

    // 5. shapes.replaceInner: replace inner contents with new path
    const replaceRes = await shapesReplaceInnerOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        svgNodeId: 'svg-shape',
        innerJSX: '<rect data-id="rect-new" x="5" y="5" width="90" height="90" rx="10" fill="purple" />',
      },
      mockContext,
    );
    applyChanges(mutableFiles, replaceRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('rect data-id="rect-new"');
    expect(code).not.toContain('path data-id="path-1"');
  });

  it('manages sketch draw animation lifecycle: set, get, list, and remove', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="root">
      <svg data-id="sketch-svg" viewBox="0 0 100 100">
        <path d="M0 0 L100 100" />
      </svg>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. drawing.sketchAnim.set
    const setRes = await drawingSketchAnimSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'sketch-svg',
        trigger: 'inView',
        mode: 'draw',
        durationScale: 1.5,
        stagger: 0.1,
        transition: {
          type: 'spring',
          stiffness: 120,
          damping: 20,
        },
      },
      mockContext,
    );
    applyChanges(mutableFiles, setRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('playSketchDraw');
    expect(code).toContain('useEffect');
    expect(code).toContain('sketch-svg');
    expect(code).toContain("trigger: 'inView'");

    // 2. drawing.sketchAnim.get
    const getRes = await drawingSketchAnimGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'sketch-svg' },
      mockContext,
    );
    expect(getRes.config).not.toBeNull();
    expect(getRes.config?.trigger).toBe('inView');
    expect(getRes.config?.mode).toBe('draw');
    expect(getRes.config?.durationScale).toBe(1.5);
    expect(getRes.config?.stagger).toBe(0.1);
    expect(getRes.config?.transition.type).toBe('spring');

    // 3. drawing.sketchAnim.list
    const listRes = await drawingSketchAnimListOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx' },
      mockContext,
    );
    expect(listRes.animatedNodeIds).toContain('sketch-svg');

    // 4. drawing.sketchAnim.remove
    const removeRes = await drawingSketchAnimRemoveOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'sketch-svg' },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(mutableFiles));
    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('playSketchDraw(');

    // 5. Verify list after removal
    const listAfter = await drawingSketchAnimListOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx' },
      mockContext,
    );
    expect(listAfter.animatedNodeIds).not.toContain('sketch-svg');
  });
});
