// packages/automation-core/test/capabilities/design-component-variants.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { checkFile } from '@/code/oracle/check-file';
import { componentsGetOperation } from '../../src/operations/components';
import { nodesGetOperation } from '../../src/operations/nodes';
import {
  stylesGetOperation,
  stylesSetOperation,
  stylesRemoveOperation,
} from '../../src/operations/styles';
import { layoutSetOperation } from '../../src/operations/layout';
import { textGetOperation, textSetOperation } from '../../src/operations/text';
import { applyVariantStyleUpdateInCode } from '@/code/generation/generator-styles';

const mockContext = createOperationContext();

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-variants', branchId: 'main' }, 1, files);
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

const DESIGN_COMPONENT = `"use client";
import { withResponsiveProps } from "@revyme/runtime";
import { motion, AnimatePresence } from "framer-motion";

/** @name "Card" */
export const variantConfig = [
  { name: 'default', label: 'Default', isPrimary: true, x: 0, y: 0 },
  { name: 'compact', label: 'Compact', x: 400, y: 0 },
  { name: 'hover', label: 'Hover', x: 800, y: 0 },
];

const cardRootVariants = {
  default: { backgroundColor: '#ffffff' },
  compact: { backgroundColor: '#f8fafc' },
  hover: { backgroundColor: '#eff6ff' },
};

function Card({
  style,
  initialVariant = 'default',
  title = 'Starter Plan',
}: {
  style?: React.CSSProperties;
  initialVariant?: string;
  title?: string;
}) {
  return (
    <motion.div
      data-id="card-root"
      layout={true}
      variants={cardRootVariants}
      initial={['default', initialVariant]}
      animate={['default', initialVariant]}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: initialVariant === 'compact' ? '260px' : '360px',
        padding: '24px',
        gap: '16px',
        backgroundColor: '#ffffff',
        boxShadow: 'none',
        ...style,
      }}
    >
      <motion.h3 data-id="card-title" style={{ fontSize: '20px', color: '#0f172a', flex: '0 0 auto', order: '0' }}>
        {title}
      </motion.h3>
      <motion.p data-id="card-label" style={{ fontSize: '14px', color: '#475569', flex: '0 0 auto', order: '1' }}>
        Learn more
      </motion.p>
      <AnimatePresence mode="popLayout">
        {initialVariant !== 'compact' && (
          <motion.span
            key="card-badge"
            data-id="card-badge"
            layout={true}
            style={{ fontSize: '12px', color: '#2563eb', flex: '0 0 auto', order: '2' }}
          >
            Popular
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default withResponsiveProps(Card);
`;

const CODE_COMPONENT = `"use client";
/** @defaultWidth 320 */
/** @defaultHeight 120 */
/** @controls { "label": { "type": "string", "defaultValue": "Click" } } */
export default function CustomButton({ label = "Click" }: { label?: string }) {
  return <button style={{ padding: '12px 20px' }}>{label}</button>;
}
`;

describe('Design Component & Variant MCP operations', () => {
  it('components.get returns rootNodeId and full internal node tree with variantStyles, variantTexts, and hiddenOnVariants', async () => {
    const withTextVariant = await (async () => {
      const snap = createMockSnapshot({ 'components/Card.tsx': DESIGN_COMPONENT });
      const res = await textSetOperation.execute(
        snap,
        {
          filePath: 'components/Card.tsx',
          nodeId: 'card-label',
          variantName: 'hover',
          textContent: 'Open details',
        },
        mockContext,
      );
      const map = new Map(snap.files);
      applyChanges(map, res.changes);
      return map;
    })();

    withTextVariant.set('components/CustomButton.tsx', CODE_COMPONENT);
    const snapshot = createMockSnapshot(Object.fromEntries(withTextVariant.entries()));

    const res = await componentsGetOperation.execute(snapshot, { name: 'Card' }, mockContext);
    expect(res.component).not.toBeNull();
    expect(res.component?.isCodeComponent).toBe(false);
    expect(res.component?.rootNodeId).toBe('card-root');
    expect(res.component?.nodes?.length).toBeGreaterThanOrEqual(4);

    const rootSummary = res.component?.nodes?.find((n) => n.id === 'card-root');
    expect(rootSummary?.styles.backgroundColor).toBe('#ffffff');
    expect(rootSummary?.variantStyles?.compact).toMatchObject({
      backgroundColor: '#f8fafc',
      width: '260px',
    });
    expect(rootSummary?.variantStyles?.hover).toMatchObject({
      backgroundColor: '#eff6ff',
    });

    const labelSummary = res.component?.nodes?.find((n) => n.id === 'card-label');
    expect(labelSummary?.variantTexts).toEqual({
      hover: 'Open details',
      default: 'Learn more',
    });

    const badgeSummary = res.component?.nodes?.find((n) => n.id === 'card-badge');
    expect(badgeSummary?.hiddenOnVariants).toEqual(['compact']);

    // Code Components keep controls metadata without fabricating design nodes
    const codeRes = await componentsGetOperation.execute(
      snapshot,
      { name: 'CustomButton' },
      mockContext,
    );
    expect(codeRes.component?.isCodeComponent).toBe(true);
    expect(codeRes.component?.nodes).toBeUndefined();

    // nodes.get resolves 'root' alias on component masters and surfaces variant data
    const rootNodeRes = await nodesGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'root' },
      mockContext,
    );
    expect(rootNodeRes.node.id).toBe('card-root');
    expect(rootNodeRes.node.variantStyles?.compact?.width).toBe('260px');

    const badgeNodeRes = await nodesGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-badge' },
      mockContext,
    );
    expect(Array.isArray(badgeNodeRes.node.hiddenOnVariants)).toBe(true);
    expect(badgeNodeRes.node.hiddenOnVariants).toEqual(['compact']);
  });

  it('styles.set with variantName routes layout props to ternaries, normalizes boxShadow none, and passes Oracle cleanly', async () => {
    const files = new Map<string, string>([['components/Card.tsx', DESIGN_COMPONENT]]);
    let snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    // Mixed layout (gap, width, flexDirection) + paint (padding, backgroundColor) + boxShadow on hover
    const setRes = await stylesSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-root',
        variantName: 'hover',
        styles: {
          width: '380px',
          gap: '20px',
          flexDirection: 'row',
          padding: '28px',
          backgroundColor: '#dbeafe',
          boxShadow: '0 12px 30px rgba(15, 23, 42, 0.15)',
        },
      },
      mockContext,
    );
    applyChanges(files, setRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    let updatedCode = files.get('components/Card.tsx')!;
    const violationsHover = checkFile(updatedCode, { kind: 'component', path: 'components/Card.tsx' });
    expect(violationsHover).toEqual([]);

    // Also setting boxShadow: 'none' on compact variant normalizes to rgba(0, 0, 0, 0) instead of failing Oracle
    const noneShadowRes = await stylesSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-root',
        variantName: 'compact',
        styles: {
          boxShadow: 'none',
        },
      },
      mockContext,
    );
    applyChanges(files, noneShadowRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    updatedCode = files.get('components/Card.tsx')!;
    const violationsCompact = checkFile(updatedCode, { kind: 'component', path: 'components/Card.tsx' });
    expect(violationsCompact).toEqual([]);

    // styles.get with variantName returns merged effective styles + variantStyles map
    const hoverStyles = await stylesGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-root', variantName: 'hover' },
      mockContext,
    );
    expect(hoverStyles.styles.width).toBe('380px');
    expect(hoverStyles.styles.gap).toBe('20px');
    expect(hoverStyles.styles.flexDirection).toBe('row');
    expect(hoverStyles.styles.padding).toBe('28px');
    expect(hoverStyles.styles.backgroundColor).toBe('#dbeafe');
    expect(hoverStyles.variantStyles?.compact?.boxShadow).toBe('0 0 0 rgba(0, 0, 0, 0)');
  });

  it('styles.set for primary default (with or without variantName) syncs inline and variants.default without wiping ternaries', async () => {
    const files = new Map<string, string>([['components/Card.tsx', DESIGN_COMPONENT]]);
    let snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    // 1. Explicit variantName: 'default' updating inline conditional width + visual backgroundColor
    const explicitRes = await stylesSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-root',
        variantName: 'default',
        styles: {
          width: '400px',
          backgroundColor: '#f1f5f9',
          boxShadow: 'none',
        },
      },
      mockContext,
    );
    applyChanges(files, explicitRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    let code = files.get('components/Card.tsx')!;
    expect(checkFile(code, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);

    let readDefault = await stylesGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-root', variantName: 'default' },
      mockContext,
    );
    expect(readDefault.baseStyles?.backgroundColor).toBe('#f1f5f9');
    expect(readDefault.variantStyles?.default?.backgroundColor).toBe('#f1f5f9');
    expect(readDefault.variantStyles?.compact?.width).toBe('260px');
    expect(readDefault.styles.width).toBe('400px');

    // 2. Base edit WITHOUT variantName also keeps cardRootVariants.default synced and conditional compact width intact
    const baseRes = await stylesSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-root',
        styles: {
          backgroundColor: '#e2e8f0',
          width: '420px',
        },
      },
      mockContext,
    );
    applyChanges(files, baseRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    code = files.get('components/Card.tsx')!;
    expect(checkFile(code, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);

    readDefault = await stylesGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-root' },
      mockContext,
    );
    expect(readDefault.styles.backgroundColor).toBe('#e2e8f0');
    expect(readDefault.variantStyles?.default?.backgroundColor).toBe('#e2e8f0');
    expect(readDefault.variantStyles?.compact?.width).toBe('260px');

    // 3. styles.remove with variantName removes variant override cleanly
    const removeRes = await stylesRemoveOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-root',
        variantName: 'compact',
        properties: ['width'],
      },
      mockContext,
    );
    applyChanges(files, removeRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));
    expect(checkFile(files.get('components/Card.tsx')!, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);
  });

  it('layout.set and text.set / text.get support variantName and pass Oracle with zero violations', async () => {
    const files = new Map<string, string>([['components/Card.tsx', DESIGN_COMPONENT]]);
    let snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    // 1. layout.set on compact variant
    const layoutRes = await layoutSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-root',
        variantName: 'compact',
        flexDirection: 'row',
        gap: '8px',
        alignItems: 'center',
      },
      mockContext,
    );
    applyChanges(files, layoutRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    expect(checkFile(files.get('components/Card.tsx')!, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);

    const compactStyles = await stylesGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-root', variantName: 'compact' },
      mockContext,
    );
    expect(compactStyles.styles.flexDirection).toBe('row');
    expect(compactStyles.styles.gap).toBe('8px');
    expect(compactStyles.styles.alignItems).toBe('center');

    // 2. text.set on hover variant & primary default, plus text.get
    const textHoverRes = await textSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-label',
        variantName: 'hover',
        textContent: 'Select Plan',
      },
      mockContext,
    );
    applyChanges(files, textHoverRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    expect(checkFile(files.get('components/Card.tsx')!, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);

    const textGetHover = await textGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-label', variantName: 'hover' },
      mockContext,
    );
    expect(textGetHover.textContent).toBe('Select Plan');
    expect(textGetHover.variantTexts).toEqual({
      hover: 'Select Plan',
      default: 'Learn more',
    });

    // Updating base text without variantName preserves hover branch!
    const textBaseRes = await textSetOperation.execute(
      snapshot,
      {
        filePath: 'components/Card.tsx',
        nodeId: 'card-label',
        textContent: 'Get started',
      },
      mockContext,
    );
    applyChanges(files, textBaseRes.changes);
    snapshot = createMockSnapshot(Object.fromEntries(files.entries()));

    const textAfterBase = await textGetOperation.execute(
      snapshot,
      { filePath: 'components/Card.tsx', nodeId: 'card-label' },
      mockContext,
    );
    expect(textAfterBase.textContent).toBe('Get started');
    expect(textAfterBase.variantTexts).toEqual({
      hover: 'Select Plan',
      default: 'Get started',
    });
    expect(checkFile(files.get('components/Card.tsx')!, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);
  });

  it('shared applyVariantStyleUpdateInCode keeps component valid across mixed layout + visual props', () => {
    const out = applyVariantStyleUpdateInCode(
      DESIGN_COMPONENT,
      'card-root',
      'compact',
      {
        gap: '10px',
        flexDirection: 'row',
        color: '#1e293b',
        boxShadow: 'none',
      },
      { explicitVariant: true },
    );
    expect(checkFile(out, { kind: 'component', path: 'components/Card.tsx' })).toEqual([]);
    expect(out).toContain("gap: initialVariant === 'compact' ? '10px' : '16px'");
    expect(out).toContain("flexDirection: initialVariant === 'compact' ? 'row' : 'column'");
  });
});
