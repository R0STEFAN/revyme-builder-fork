// packages/automation-core/test/capabilities/T03-ingestion.test.ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  IdManager,
  IngestionReporter,
  lowerUnits,
  normalizeStyles,
  lowerListRecipe,
  ingestTreeNode,
  ingestJSXFragment,
  createPlan,
  validatePlan,
  createSnapshot,
  createOperationContext,
  workflowBatchOperation,
  workflowChainOperation,
} from '../../src';

describe('T03: Candidate Planner, Ingestion and Independent Validation', () => {
  describe('Unit Lowering & Normalization', () => {
    it('lowers rem units with known root font sizes (16px and 20px)', () => {
      const reporter16 = new IngestionReporter();
      const res16 = lowerUnits('1.5rem', { rootFontSize: 16 }, reporter16, 'padding');
      expect(res16).toBe('24px');
      expect(reporter16.getNormalizations()).toHaveLength(1);
      expect(reporter16.getNormalizations()[0].rule).toBe('LOWER_REM_UNIT');

      const reporter20 = new IngestionReporter();
      const res20 = lowerUnits('1.5rem', { rootFontSize: 20 }, reporter20, 'padding');
      expect(res20).toBe('30px');
      expect(reporter20.getNormalizations()[0].after).toBe('30px');
    });

    it('emits contextual issue when root font size is unknown', () => {
      const reporter = new IngestionReporter();
      const res = lowerUnits('1.5rem', {}, reporter, 'fontSize');
      expect(res).toBe('1.5rem');
      expect(reporter.getIssues()).toHaveLength(1);
      expect(reporter.getIssues()[0].code).toBe('MISSING_ROOT_FONT_CONTEXT');
    });

    it('lowers em units relative to element or parent font size', () => {
      const reporter = new IngestionReporter();
      const res = lowerUnits('2em', { elementFontSize: 18 }, reporter, 'lineHeight');
      expect(res).toBe('36px');
      expect(reporter.getNormalizations()[0].rule).toBe('LOWER_EM_UNIT');
    });

    it('deletes empty string properties according to Invariant 3', () => {
      const reporter = new IngestionReporter();
      const res = normalizeStyles(
        {
          border: '1px solid red',
          borderTopWidth: '',
          backgroundColor: '#fff',
        },
        {},
        reporter,
        'card'
      );

      expect(res).toEqual({
        border: '1px solid red',
        backgroundColor: '#fff',
      });
      expect(res.borderTopWidth).toBeUndefined();
      expect(
        reporter.getNormalizations().some((n) => n.rule === 'DELETE_STYLE_PROPERTY')
      ).toBe(true);
    });
  });

  describe('ID Management & De-duplication', () => {
    it('generates deterministic IDs for missing IDs and sanitizes characters', () => {
      const manager = new IdManager();
      const reporter = new IngestionReporter();

      const node1 = manager.ensureNodeId(undefined, 'section', reporter);
      expect(node1.wasGenerated).toBe(true);
      expect(node1.id).toBe('section-1');

      const node2 = manager.ensureNodeId('my bad id!', 'div', reporter);
      expect(node2.id).toBe('my-bad-id-');
      expect(reporter.getNormalizations().some((n) => n.rule === 'SANITIZE_ID')).toBe(true);
    });

    it('detects duplicate IDs and renumbers them safely', () => {
      const manager = new IdManager();
      const reporter = new IngestionReporter();

      const first = manager.ensureNodeId('hero-title', 'h1', reporter);
      expect(first.id).toBe('hero-title');
      expect(first.wasGenerated).toBe(false);

      const duplicate = manager.ensureNodeId('hero-title', 'h1', reporter);
      expect(duplicate.wasGenerated).toBe(true);
      expect(duplicate.id).toBe('hero-title-1');
      expect(
        reporter.getNormalizations().some((n) => n.rule === 'DUPLICATE_ID_RENUMBERED')
      ).toBe(true);
    });
  });

  describe('List Lowering & Semantic Guarantees', () => {
    it('lowers ordered and unordered lists with semantic roles and markers', () => {
      const manager = new IdManager();
      const reporter = new IngestionReporter();

      const list = lowerListRecipe(
        {
          tag: 'ol',
          start: 1,
          items: [
            { text: 'Step 1' },
            {
              text: 'Step 2',
              subItems: [{ text: 'Substep 2.1' }],
            },
          ],
        },
        manager,
        reporter
      );

      expect(list).not.toBeNull();
      expect(list?.role).toBe('list');
      expect(list?.ordered).toBe(true);
      expect(list?.items).toHaveLength(2);
      expect(list?.items[0].role).toBe('listitem');
      expect(list?.items[1].children).toHaveLength(1);
      expect(list?.items[1].children?.[0].role).toBe('list');
    });

    it('strictly refuses list conversion on unresolvable expressions', () => {
      const manager = new IdManager();
      const reporter = new IngestionReporter();

      const result = lowerListRecipe(
        {
          tag: 'ul',
          items: [{ text: 'Item 1' }],
          hasUnresolvableExpressions: true,
        },
        manager,
        reporter
      );

      expect(result).toBeNull();
      expect(reporter.getIssues()).toHaveLength(1);
      expect(reporter.getIssues()[0].code).toBe('UNSUPPORTED_LIST_EXPRESSION');
    });
  });

  describe('Tree & Static JSX Ingestion', () => {
    it('ingests static JSX fragment and assigns missing data-ids', () => {
      const reporter = new IngestionReporter();
      const code = `<div style={{ padding: '16px', color: 'red' }}><h1>Title</h1><p>Description</p></div>`;

      const ingested = ingestJSXFragment(code, new IdManager(), {}, reporter);
      expect(ingested).not.toBeNull();
      expect(ingested?.tag).toBe('div');
      expect(ingested?.id).toBeDefined();
      expect(ingested?.styles?.padding).toBe('16px');
      expect(ingested?.children).toHaveLength(2);
      expect(ingested?.children?.[0].tag).toBe('h1');
      expect(ingested?.children?.[1].tag).toBe('p');
    });

    it('handles transparent inline formatting tags without breaking hierarchy', () => {
      const node = ingestTreeNode(
        {
          tag: 'p',
          children: [
            { tag: 'span', text: 'formatted' },
            { tag: 'strong', text: 'bold' },
          ],
        },
        new IdManager(),
        {},
        new IngestionReporter()
      );

      expect(node.tag).toBe('p');
      expect(node.children).toHaveLength(2);
      expect(node.children?.[0].isTransparent).toBe(true);
      expect(node.children?.[1].isTransparent).toBe(true);
    });
  });

  describe('Plan Creation & Validation', () => {
    it('creates a plan with deterministic hash and validates clean changes', () => {
      const snapshot = createSnapshot(
        { projectId: 'proj-1', branchId: 'main' },
        1,
        new Map([
          [
            'app/page.tsx',
            `export default function Page() { return <div data-id="root">Hello</div>; }`,
          ],
        ])
      );

      const beforeHash = createHash('sha256').update(snapshot.files.get('app/page.tsx')!).digest('hex');

      const plan1 = createPlan({
        scope: snapshot.scope,
        baseRevision: 1,
        operationId: 'op-1',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash,
            content: `export default function Page() { return <div data-id="root">Updated</div>; }`,
          },
        ],
      });

      const plan2 = createPlan({
        scope: snapshot.scope,
        baseRevision: 1,
        operationId: 'op-1',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash,
            content: `export default function Page() { return <div data-id="root">Updated</div>; }`,
          },
        ],
      });

      expect(plan1.planHash).toBe(plan2.planHash);

      const validation = validatePlan(snapshot, plan1);
      expect(validation.ok).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it('rejects stale revision in plan', () => {
      const snapshot = createSnapshot(
        { projectId: 'proj-1', branchId: 'main' },
        2, // snapshot is at revision 2
        new Map()
      );

      const plan = createPlan({
        scope: snapshot.scope,
        baseRevision: 1, // plan based on stale revision 1
        operationId: 'op-stale',
        changes: [],
      });

      const validation = validatePlan(snapshot, plan);
      expect(validation.ok).toBe(false);
      expect(validation.issues.some((i) => i.code === 'STALE_REVISION')).toBe(true);
    });

    it('rejects syntax errors in modified code', () => {
      const snapshot = createSnapshot(
        { projectId: 'proj-1', branchId: 'main' },
        1,
        new Map()
      );

      const plan = createPlan({
        scope: snapshot.scope,
        baseRevision: 1,
        operationId: 'op-syntax',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() { return <div>Unclosed; }`,
          },
        ],
      });

      const validation = validatePlan(snapshot, plan);
      expect(validation.ok).toBe(false);
      expect(validation.issues.some((i) => i.code === 'SYNTAX_ERROR')).toBe(true);
    });

    it('detects duplicate data-id and missing data-id in structural elements', () => {
      const snapshot = createSnapshot(
        { projectId: 'proj-1', branchId: 'main' },
        1,
        new Map()
      );

      const plan = createPlan({
        scope: snapshot.scope,
        baseRevision: 1,
        operationId: 'op-ids',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `export default function Page() {
              return (
                <div data-id="box-1">
                  <div data-id="box-1">Duplicate</div>
                  <section>Missing data id</section>
                </div>
              );
            }`,
          },
        ],
      });

      const validation = validatePlan(snapshot, plan);
      expect(validation.ok).toBe(false);
      expect(validation.issues.some((i) => i.code === 'DUPLICATE_DATA_ID')).toBe(true);
      expect(validation.issues.some((i) => i.code === 'MISSING_DATA_ID')).toBe(true);
    });

    it('allows editor-owned responsive style metadata without a canvas data-id', () => {
      const snapshot = createSnapshot(
        { projectId: 'proj-1', branchId: 'main' },
        1,
        new Map()
      );
      const plan = createPlan({
        scope: snapshot.scope,
        baseRevision: 1,
        operationId: 'op-responsive-style',
        changes: [{
          path: 'app/page.client.tsx',
          beforeHash: null,
          content: `export default function Page() {
            return <div data-id="root" data-name="Page" style={{ width: '100%' }}>
              <style>{\`@media (max-width: 390px) { [data-id="root"] { padding: 16px !important; } }\`}</style>
            </div>;
          }`,
        }],
      });

      const validation = validatePlan(snapshot, plan);
      expect(validation.issues.filter((issue) => issue.code === 'MISSING_DATA_ID')).toEqual([]);
    });

    it('detects unresolved relative imports', () => {
      const snapshot = createSnapshot(
        { projectId: 'proj-1', branchId: 'main' },
        1,
        new Map()
      );

      const plan = createPlan({
        scope: snapshot.scope,
        baseRevision: 1,
        operationId: 'op-import',
        changes: [
          {
            path: 'app/page.tsx',
            beforeHash: null,
            content: `import { Missing } from './MissingComponent';
            export default function Page() { return <div data-id="root" />; }`,
          },
        ],
      });

      const validation = validatePlan(snapshot, plan);
      expect(validation.ok).toBe(false);
      expect(validation.issues.some((i) => i.code === 'UNRESOLVED_IMPORT')).toBe(true);
    });
  });

  describe('Workflow Batch and Chain', () => {
    const snapshot = createSnapshot(
      { projectId: 'proj-1', branchId: 'main' },
      1,
      new Map([
        [
          'app/page.tsx',
          `export default function Page() { return <div data-id="root">Original</div>; }`,
        ],
      ])
    );
    const context = createOperationContext();

    it('workflow.batch successfully batches multiple operations', async () => {
      const result = await workflowBatchOperation.execute(
        snapshot,
        {
          operations: [
            {
              tool: 'meta.index',
              input: { page: 1, pageSize: 5 },
            },
            {
              tool: 'meta.guide',
              input: { topic: 'test' },
            },
          ],
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan.baseRevision).toBe(1);
    });

    it('coalesces sequential edits to the same file into one atomic change', async () => {
      const result = await workflowBatchOperation.execute(
        snapshot,
        {
          operations: [
            {
              tool: 'nodes.update',
              input: { filePath: 'app/page.tsx', nodeId: 'root', name: 'First Name' },
            },
            {
              tool: 'nodes.update',
              input: { filePath: 'app/page.tsx', nodeId: 'root', name: 'Final Name' },
            },
          ],
        },
        context,
      );

      expect(result.plan.changes).toHaveLength(1);
      expect(result.plan.changes[0].path).toBe('app/page.tsx');
      expect(result.plan.changes[0].beforeHash).toBe(
        createHash('sha256').update(snapshot.files.get('app/page.tsx')!).digest('hex'),
      );
      expect(result.plan.changes[0].content).toContain('data-name="Final Name"');
      expect(result.plan.changes[0].content).not.toContain('data-name="First Name"');
    });

    it('workflow.chain executes sequential steps and reports per-step receipts', async () => {
      const result = await workflowChainOperation.execute(
        snapshot,
        {
          steps: [
            {
              tool: 'meta.index',
              input: { page: 1, pageSize: 2 },
            },
            {
              tool: 'meta.tools',
              input: { name: 'meta.index' },
            },
          ],
        },
        context
      );

      expect(result.completed).toBe(2);
      expect(result.receipts).toHaveLength(2);
      expect(result.receipts[0].status).toBe('ok');
      expect(result.receipts[1].status).toBe('ok');
    });
  });
});
