// packages/automation-core/test/coverage.ts
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export interface CoverageReport {
  schemaVersion: number;
  generatedAt: string;
  summary: {
    registeredAgentTools: number;
    mutationTypes: number;
    sdkMethods: number;
    legacyPublicTools: number;
    namedBridgeMethods: number;
    leafStylesControls: number;
    leafPropTypes: number;
    leafMotionScopes: number;
    leafFormFields: number;
    leafCmsFields: number;
    leafExportFormats: number;
  };
  agentTools: Array<{
    legacyName: string;
    symbol: string;
    file: string;
    line: number;
    category: string;
    inputKeys: string[];
    ownerTask: string;
    canonicalOperation: string;
    status: string;
    acceptanceId: string;
  }>;
  mutations: Array<{
    name: string;
    file: string;
    line: number;
    ownerTask: string;
    status: string;
    acceptanceId: string;
  }>;
  sdkMethods: Array<{
    name: string;
    file: string;
    line: number;
    ownerTask: string;
    classification: string;
    status: string;
  }>;
  legacyPublicTools: Array<{
    legacyName: string;
    file: string;
    line: number;
    ownerTask: string;
    status: string;
  }>;
  bridgeMethods: Array<{
    name: string;
    file: string;
    line: number;
    ownerTask: string;
    actions: string[];
    status: string;
  }>;
  leafCategories: Record<string, any[]>;
}

export function loadCoverageReport(): CoverageReport {
  // Try several candidate locations relative to current working directory or test file
  const candidates = [
    path.resolve(process.cwd(), 'docs/automation/coverage.json'),
    path.resolve(__dirname, '../../../docs/automation/coverage.json'),
  ];
  let foundPath: string | null = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }
  assert(foundPath, `Coverage report not found. Checked: ${candidates.join(', ')}`);
  const raw = fs.readFileSync(foundPath, 'utf8');
  return JSON.parse(raw);
}

export function verifyBaselineCompleteness(report: CoverageReport = loadCoverageReport()): void {
  assert.equal(report.agentTools.length, 172, 'Must map all 172 baseline agent tools');
  assert.equal(report.mutations.length, 175, 'Must map all 175 baseline mutations');
  assert.equal(report.sdkMethods.length, 114, 'Must map all 114 baseline SDK methods');
  assert.equal(report.legacyPublicTools.length, 33, 'Must map all 33 legacy public tools');
  assert.equal(report.bridgeMethods.length, 14, 'Must map all 14 bridge methods');

  for (const tool of report.agentTools) {
    assert.ok(tool.ownerTask.startsWith('T'), `Tool ${tool.legacyName} must have an owner task Txx`);
    assert.ok(tool.canonicalOperation, `Tool ${tool.legacyName} must map to a canonical operation`);
  }

  for (const mutation of report.mutations) {
    assert.ok(mutation.ownerTask.startsWith('T'), `Mutation ${mutation.name} must have an owner task Txx`);
  }

  for (const sdk of report.sdkMethods) {
    assert.ok(sdk.ownerTask.startsWith('T'), `SDK method ${sdk.name} must have an owner task Txx`);
    assert.ok(
      ['product-capability', 'retired-sdk-compatibility', 'editor-ui-adapter'].includes(sdk.classification),
      `SDK method ${sdk.name} has invalid classification: ${sdk.classification}`
    );
  }

  const leaves = report.leafCategories;
  assert.ok(leaves.stylesControls.length >= 20, 'Styles controls leaf coverage must be >= 20');
  assert.ok(leaves.propTypes.length >= 10, 'Prop types leaf coverage must be >= 10');
  assert.ok(leaves.motionScopes.length >= 8, 'Motion scopes leaf coverage must be >= 8');
  assert.ok(leaves.formFieldTypes.length >= 5, 'Form fields leaf coverage must be >= 5');
  assert.ok(leaves.cmsFields.length >= 6, 'CMS fields leaf coverage must be >= 6');
  assert.ok(leaves.exportFormats.length >= 3, 'Export formats leaf coverage must be >= 3');
}
