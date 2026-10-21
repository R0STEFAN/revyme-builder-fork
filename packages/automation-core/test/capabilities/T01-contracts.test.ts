// packages/automation-core/test/capabilities/T01-contracts.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultRegistry,
  OperationRegistry,
  metaIndexOperation,
  metaToolsOperation,
  metaGuideOperation,
} from '../../src/registry';
import {
  createSnapshot,
  createOperationContext,
  prepareOperation,
} from '../../src/session';
import { runCase, createSeedFiles } from '../fixture';
import { loadCoverageReport, verifyBaselineCompleteness } from '../coverage';
import { z } from 'zod';

describe('T01: Operation Contracts, Registry, Coverage and Fixture', () => {
  describe('Coverage and Baseline Completeness', () => {
    it('maps all 172 baseline agent tools and 175 mutations to canonical operations and owner tasks', () => {
      const report = loadCoverageReport();
      verifyBaselineCompleteness(report);
      expect(report.agentTools.length).toBe(172);
      expect(report.mutations.length).toBe(175);
      expect(report.sdkMethods.length).toBe(114);
      expect(report.legacyPublicTools.length).toBe(33);
      expect(report.bridgeMethods.length).toBe(14);
    });

    it('enforces that every leaf category has comprehensive definitions', () => {
      const report = loadCoverageReport();
      const leaves = report.leafCategories;
      expect(leaves.stylesControls.length).toBeGreaterThanOrEqual(20);
      expect(leaves.propTypes.length).toBeGreaterThanOrEqual(10);
      expect(leaves.motionScopes.length).toBeGreaterThanOrEqual(8);
      expect(leaves.formFieldTypes.length).toBeGreaterThanOrEqual(5);
      expect(leaves.cmsFields.length).toBeGreaterThanOrEqual(6);
      expect(leaves.exportFormats.length).toBeGreaterThanOrEqual(3);

      // Verify source-backed classification on SDK methods
      for (const sdk of report.sdkMethods) {
        expect(['product-capability', 'retired-sdk-compatibility', 'editor-ui-adapter']).toContain(
          sdk.classification
        );
      }
    });
  });

  describe('Registry Operations & Uniqueness', () => {
    it('registers unique operations and rejects duplicate registrations', () => {
      const registry = new OperationRegistry();
      registry.register({
        name: 'test.op1',
        description: 'Test op 1',
        category: 'test',
        kind: 'read',
        permit: 'read',
        environment: 'headless',
        ownerTask: 'T01',
        inputSchema: z.object({ id: z.string() }),
        async execute() {
          return { success: true };
        },
      });

      expect(() => {
        registry.register({
          name: 'test.op1',
          description: 'Duplicate',
          category: 'test',
          kind: 'read',
          permit: 'read',
          environment: 'headless',
          ownerTask: 'T01',
          inputSchema: z.object({}),
          async execute() {
            return {};
          },
        });
      }).toThrow(/already registered/);
    });

    it('finds near matches for misspelled tool names', () => {
      const near = defaultRegistry.findNearMatches('meta.indxe');
      expect(near).toContain('meta.index');
    });

    it('validates schema and returns exact JSON path for issues', () => {
      const validation = defaultRegistry.validateInput('meta.index', {
        page: -5, // Invalid: must be positive
      });
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.issues.length).toBeGreaterThan(0);
        expect(validation.issues[0].path).toContain('page');
      }
    });
  });

  describe('Meta Tools (meta.index, meta.tools, meta.guide)', () => {
    const snapshot = createSnapshot(
      { projectId: 'p1', branchId: 'main' },
      1,
      new Map([['app/page.tsx', 'export default function Page() { return <div>Hello</div>; }']])
    );
    const context = createOperationContext();

    it('meta.index returns registered operations with pagination', async () => {
      const result = await metaIndexOperation.execute(
        snapshot,
        { page: 1, pageSize: 10 },
        context
      );
      expect(result.operations.length).toBeGreaterThanOrEqual(3);
      expect(result.pagination.total).toBeGreaterThanOrEqual(3);
      expect(result.operations.map((o) => o.name)).toContain('meta.index');
      expect(result.operations.map((o) => o.name)).toContain('meta.tools');
      expect(result.operations.map((o) => o.name)).toContain('meta.guide');
    });

    it('meta.tools outputs schema details and examples', async () => {
      const result = await metaToolsOperation.execute(
        snapshot,
        { name: 'meta.index' },
        context
      );
      expect(result.tools.length).toBe(1);
      const tool = result.tools[0];
      expect(tool.name).toBe('meta.index');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.example).toBeDefined();
    });

    it('meta.tools returns near match suggestions for unknown tools', async () => {
      const result = await metaToolsOperation.execute(
        snapshot,
        { name: 'meta.gudie' },
        context
      );
      expect(result.unresolved).toContain('meta.gudie');
      expect(result.suggestions?.['meta.gudie']).toContain('meta.guide');
    });

    it('meta.guide returns workflow steps and recipes', async () => {
      const result = await metaGuideOperation.execute(
        snapshot,
        { topic: 'bootstrap' },
        context
      );
      expect(result.recommendedWorkflow.length).toBeGreaterThan(3);
      expect(result.recipes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Dependency Boundary Enforcement', () => {
    it('ensures core modules do not import editor, canvas, or singleton store modules', () => {
      const srcDir = path.resolve(__dirname, '../../src');
      const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

      const forbiddenPatterns = [
        /from\s+['"][^'"]*editor/i,
        /from\s+['"][^'"]*canvas/i,
        /from\s+['"][^'"]*stores/i,
        /window\./,
        /document\./,
      ];

      for (const file of files) {
        const fullPath = path.join(srcDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          expect(
            pattern.test(content),
            `File ${file} violated dependency boundary with pattern ${pattern}`
          ).toBe(false);
        }
      }
    });
  });

  describe('runCase Fixture and Seed Factories', () => {
    it('creates valid seeds for empty, landing, and complete', () => {
      const empty = createSeedFiles('empty');
      expect(empty.has('app/layout.tsx')).toBe(true);
      expect(empty.has('app/page.tsx')).toBe(true);
      expect(empty.has('revyme.config.json')).toBe(true);

      const landing = createSeedFiles('landing');
      expect(landing.has('components/Navbar.tsx')).toBe(true);
      expect(landing.has('components/Hero.tsx')).toBe(true);
      expect(landing.has('components/Footer.tsx')).toBe(true);

      const complete = createSeedFiles('complete');
      expect(complete.has('cms/case-studies.json')).toBe(true);
      expect(complete.has('app/about/page.tsx')).toBe(true);
    });

    it('executes runCase successfully for valid meta read step', async () => {
      const res = await runCase({
        seed: 'empty',
        steps: [
          {
            tool: 'meta.index',
            input: { page: 1, pageSize: 5 },
            expectedStatus: 'ok',
          },
        ],
        expect: {
          ok: true,
          revisionDelta: 0,
          unchangedFiles: ['app/layout.tsx', 'app/page.tsx', 'revyme.config.json'],
        },
      });

      expect(res.results.length).toBe(1);
      expect(res.results[0].ok).toBe(true);
    });

    it('enforces that negative cases leave files completely unchanged', async () => {
      const res = await runCase({
        seed: 'empty',
        steps: [
          {
            tool: 'meta.tools',
            input: { name: 'non_existent_tool_12345' },
            expectedStatus: 'ok', // reading an unknown tool succeeds with unresolved list, without modifying files
          },
          {
            tool: 'unknown.operation',
            input: {},
            expectedStatus: 'error',
          },
        ],
        expect: {
          unchangedFiles: ['app/layout.tsx', 'app/page.tsx', 'revyme.config.json'],
        },
      });

      expect(res.results[1].ok).toBe(false);
      expect(res.results[1].error?.code).toBe('UNKNOWN_OPERATION');
    });
  });
});
