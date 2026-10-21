// packages/automation-core/test/capabilities/T09-components.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import {
  componentsListOperation,
  componentsGetOperation,
  componentsCreateOperation,
  componentsExtractOperation,
  componentsReplaceOperation,
  componentsDetachOperation,
  componentsRemoveOperation,
} from '../../src/operations/components';
import {
  componentsInstanceCreateOperation,
  componentsInstancePropsGetOperation,
  componentsInstancePropsSetOperation,
  componentsVariablesCreateOperation,
  componentsVariablesRenameOperation,
  componentsVariablesRemoveOperation,
} from '../../src/operations/component-props';

const mockContext: OperationContext = {
  createId: (kind = 'id') => `${kind}-id-100`,
  signal: new AbortController().signal,
  trace: () => {},
  adapters: {},
};

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return {
    scope: { projectId: 'p1', branchId: 'main' },
    revision: 1,
    files: new Map(Object.entries(files)),
    config: {},
  };
}

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const change of changes) {
    if (change.content === null) {
      files.delete(change.path);
    } else {
      files.set(change.path, change.content);
    }
  }
}

describe('T09: Design Components, Props/Variables and Instances', () => {
  it('creates a new master component (Card) with typed props and variants', async () => {
    const initialFiles = {
      'app/page.tsx': `export default function Page() {
  return <div data-id="root-1">Hello</div>;
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Create component Card with title, price, image, and variants
    const createRes = await componentsCreateOperation.execute(
      snapshot,
      {
        name: 'Card',
        props: [
          { name: 'title', type: 'string', default: 'Default Title' },
          { name: 'price', type: 'string', default: '$19' },
          { name: 'featured', type: 'boolean', default: false },
        ],
        variants: [
          { name: 'highlight', label: 'Highlight State' },
        ],
        layout: [
          {
            tag: 'h3',
            text: '{title}',
            dataId: 'card-title',
            style: { fontSize: '20px', fontWeight: 'bold' },
          },
          {
            tag: 'p',
            text: '{price}',
            dataId: 'card-price',
            style: { color: '#666' },
          },
          {
            tag: 'span',
            text: '{featured}',
            dataId: 'card-featured',
            style: { display: 'none' },
          },
        ],
      },
      mockContext,
    );

    applyChanges(mutableFiles, createRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    const cardCode = snapshot.files.get('components/Card.tsx')!;
    expect(cardCode).toContain('"use client";');
    expect(cardCode).toContain('import { withResponsiveProps } from "@revyme/runtime";');
    expect(cardCode).toContain('/** @name "Card" */');
    expect(cardCode).toContain("name: 'default'");
    expect(cardCode).toContain("name: 'highlight'");
    expect(cardCode).toContain('title = "Default Title"');
    expect(cardCode).toContain('price = "$19"');
    expect(cardCode).toContain('featured = false');
    expect(cardCode).toContain('...style');
    expect(cardCode).toContain('export default withResponsiveProps(Card);');

    // 2. Read component back via get and list
    const getRes = await componentsGetOperation.execute(snapshot, { name: 'Card' }, mockContext);
    expect(getRes.component).not.toBeNull();
    expect(getRes.component?.name).toBe('Card');
    expect(getRes.component?.props.some((p) => p.name === 'title')).toBe(true);
    expect(getRes.component?.variants).toHaveLength(2);

    const listRes = await componentsListOperation.execute(snapshot, {}, mockContext);
    expect(listRes.components.some((c) => c.name === 'Card')).toBe(true);

    // 3. Trying to overwrite existing component fails safely
    await expect(
      componentsCreateOperation.execute(
        snapshot,
        {
          name: 'Card',
          props: [{ name: 'title', type: 'string', default: 'Title' }],
          layout: [{ tag: 'div', text: '{title}' }],
        },
        mockContext,
      ),
    ).rejects.toThrow(/COMPONENT_ALREADY_EXISTS/);
  });

  it('places instances, reads/sets instance props and handles Invariant 3 deletion', async () => {
    const initialFiles = {
      'components/Card.tsx': `"use client";
import { withResponsiveProps } from "@revyme/runtime";
export const variantConfig = [{ name: 'default', label: 'Default', isPrimary: true, x: 0, y: 0 }];

function Card({
  style,
  title = "Default Card",
  price = "$10",
}: {
  style?: React.CSSProperties;
  title?: string;
  price?: string;
}) {
  return (
    <div data-id="card-root" style={{ padding: "16px", ...style }}>
      <h3 data-id="title-1">{title}</h3>
      <p data-id="price-1">{price}</p>
    </div>
  );
}
export default withResponsiveProps(Card);
`,
      'app/page.tsx': `export default function Page() {
  return (
    <div data-id="container">
      <p>Header</p>
    </div>
  );
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Create instance 1 with prop overrides
    const inst1Res = await componentsInstanceCreateOperation.execute(
      snapshot,
      {
        componentName: 'Card',
        targetFile: 'app/page.tsx',
        parentId: 'container',
        props: {
          title: 'Pro Plan',
          price: '$29/mo',
        },
        style: {
          marginBottom: '20px',
        },
      },
      mockContext,
    );
    applyChanges(mutableFiles, inst1Res.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain("import Card from '@/components/Card';");
    expect(pageCode).toContain('<Card');
    expect(pageCode).toContain('title="Pro Plan"');
    expect(pageCode).toContain('price="$29/mo"');

    // 2. Read instance props
    const propsGet = await componentsInstancePropsGetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: inst1Res.instanceId,
      },
      mockContext,
    );
    expect(propsGet.componentName).toBe('Card');
    expect(propsGet.props.title).toBe('Pro Plan');
    expect(propsGet.props.price).toBe('$29/mo');

    // 3. Update instance props and test empty string deletion
    const propsSet = await componentsInstancePropsSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: inst1Res.instanceId,
        props: {
          title: 'Enterprise Plan',
          price: '', // Invariant 3: empty string removes the prop override
        },
      },
      mockContext,
    );
    applyChanges(mutableFiles, propsSet.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('title="Enterprise Plan"');
    expect(pageCode).not.toContain('price='); // price prop override removed!
  });

  it('extracts, replaces, and detaches components preserving styles and props', async () => {
    const initialFiles = {
      'components/Button.tsx': `"use client";
import { withResponsiveProps } from "@revyme/runtime";
export const variantConfig = [{ name: 'default', label: 'Default', isPrimary: true, x: 0, y: 0 }];

function Button({ style, label = "Click Me" }: { style?: React.CSSProperties; label?: string }) {
  return <button data-id="btn-inner" style={{ ...style }}>{label}</button>;
}
export default withResponsiveProps(Button);
`,
      'app/page.tsx': `export default function Page() {
  return (
    <div data-id="page-root">
      <div data-id="banner-box" style={{ background: '#3b82f6', padding: '24px' }}>
        <h2 data-id="banner-title">Welcome Banner</h2>
      </div>
    </div>
  );
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Extract banner-box into Banner component
    const extractRes = await componentsExtractOperation.execute(
      snapshot,
      {
        name: 'Banner',
        sourceFile: 'app/page.tsx',
        nodeId: 'banner-box',
      },
      mockContext,
    );
    applyChanges(mutableFiles, extractRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.has('components/Banner.tsx')).toBe(true);
    let pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain("import Banner from '@/components/Banner';");
    expect(pageCode).toContain('<Banner data-id="banner-box"');

    // 2. Replace Banner instance with Button instance
    const replaceRes = await componentsReplaceOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'banner-box',
        newComponentName: 'Button',
      },
      mockContext,
    );
    applyChanges(mutableFiles, replaceRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain("import Button from '@/components/Button';");
    expect(pageCode).toContain('<Button');
    expect(pageCode).toContain('data-id="banner-box"');

    // 3. Detach Button instance back into inline JSX
    const detachRes = await componentsDetachOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'banner-box',
      },
      mockContext,
    );
    applyChanges(mutableFiles, detachRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('<button data-id="btn-inner"');
    expect(pageCode).not.toContain('<Button');
    expect(pageCode).not.toContain("import Button from '@/components/Button';");
  });

  it('manages component variable creation, renaming, and removal across project', async () => {
    const initialFiles = {
      'components/Card.tsx': `"use client";
import { withResponsiveProps } from "@revyme/runtime";
export const variantConfig = [{ name: 'default', label: 'Default', isPrimary: true, x: 0, y: 0 }];

function Card({ style }: { style?: React.CSSProperties }) {
  return (
    <div data-id="card-root" style={{ backgroundColor: "#ffffff", ...style }}>
      <p data-id="card-text">Hello</p>
    </div>
  );
}
export default withResponsiveProps(Card);
`,
      'app/page.tsx': `import Card from '@/components/Card';

export default function Page() {
  return (
    <div>
      <Card data-id="c1" bgColor="#f0f0f0" />
      <Card data-id="c2" bgColor="#e0e0e0" />
    </div>
  );
}`,
    };

    let snapshot = createMockSnapshot(initialFiles);
    const mutableFiles = new Map(snapshot.files);

    // 1. Create variable bgColor in Card master
    const varCreate = await componentsVariablesCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/Card.tsx',
        nodeId: 'card-root',
        property: 'backgroundColor',
        propName: 'bgColor',
        defaultValue: '#ffffff',
        propType: 'color',
        label: 'Background Color',
        description: 'Card background fill color',
      },
      mockContext,
    );
    applyChanges(mutableFiles, varCreate.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let cardCode = snapshot.files.get('components/Card.tsx')!;
    expect(cardCode).toContain('bgColor = "#ffffff"');
    expect(cardCode).toContain('backgroundColor: bgColor');
    expect(cardCode).toContain('@propMeta');
    expect(cardCode).toContain('"type":"color"');
    expect(cardCode).toContain('"label":"Background Color"');

    // 2. Rename variable from bgColor to surfaceColor and cascade update instances
    const varRename = await componentsVariablesRenameOperation.execute(
      snapshot,
      {
        componentFile: 'components/Card.tsx',
        oldName: 'bgColor',
        newName: 'surfaceColor',
        updateInstances: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, varRename.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    cardCode = snapshot.files.get('components/Card.tsx')!;
    expect(cardCode).toContain('surfaceColor = "#ffffff"');
    expect(cardCode).toContain('backgroundColor: surfaceColor');
    expect(cardCode).toContain('"label":"Background Color"');

    const pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('surfaceColor="#f0f0f0"');
    expect(pageCode).toContain('surfaceColor="#e0e0e0"');
    expect(pageCode).not.toContain('bgColor=');

    // 3. Remove variable surfaceColor from Card master
    const varRemove = await componentsVariablesRemoveOperation.execute(
      snapshot,
      {
        componentFile: 'components/Card.tsx',
        nodeId: 'card-root',
        property: 'backgroundColor',
        propName: 'surfaceColor',
        defaultValue: '#ffffff',
      },
      mockContext,
    );
    applyChanges(mutableFiles, varRemove.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    cardCode = snapshot.files.get('components/Card.tsx')!;
    expect(cardCode).not.toContain('surfaceColor =');

    // 4. Removing component master file
    await expect(
      componentsRemoveOperation.execute(
        snapshot,
        {
          name: 'Card',
          force: false,
        },
        mockContext,
      ),
    ).rejects.toThrow(/COMPONENT_IN_USE/);

    const removeForce = await componentsRemoveOperation.execute(
      snapshot,
      {
        name: 'Card',
        force: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeForce.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    expect(snapshot.files.has('components/Card.tsx')).toBe(false);
  });
});
