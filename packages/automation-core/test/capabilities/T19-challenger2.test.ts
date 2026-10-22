// packages/automation-core/test/capabilities/T19-challenger2.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  formsCreateOperation,
} from '../../src/operations/forms';
import {
  formsFieldAddOperation,
  formsFieldRemoveOperation,
  formsSelectCaretSetOperation,
  formsSubmitButtonAddOperation,
} from '../../src/operations/form-fields';
import {
  formsStateMapOperation,
  formsStateGetOperation,
} from '../../src/operations/form-states';
import { projectFS } from '@/code/project/project-fs';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { parseJSX } from '@/code/parsing/ast-utils';
import { checkFile } from '@/code/oracle/check-file';

const MULTI_FORM_PAGE = `'use client';
import React, { useState } from 'react';

export default function MultiFormPage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="title">Multiple Forms Testing</h1>
      <div data-id="form1-container" style={{ marginBottom: '32px' }}></div>
      <div data-id="form2-container"></div>
      <div data-id="loose-container">
        <button data-id="raw-btn" type="button">Raw Button</button>
        <div data-id="loose-box">Loose Box</div>
      </div>
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

describe('T19 Challenger 2: Adversarial Tests for Submit Buttons, Select Carets, and Form States', () => {
  const context = createOperationContext();

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Submit Button Add & Collision Avoidance
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. forms.submitButton.add Verification', () => {
    it('creates FormSubmit.tsx and Spinner.tsx master files if missing', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      expect(projectFS.readFile('components/FormSubmit.tsx')).toBeNull();
      expect(projectFS.readFile('components/Spinner.tsx')).toBeNull();

      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, label: 'Submit Now' },
        context,
      );

      expect(btn.instanceId).toBeDefined();
      expect(btn.formId).toBe(form.formId);

      const formSubmitMaster = projectFS.readFile('components/FormSubmit.tsx');
      const spinnerMaster = projectFS.readFile('components/Spinner.tsx');
      expect(formSubmitMaster).not.toBeNull();
      expect(spinnerMaster).not.toBeNull();
      expect(formSubmitMaster).toContain("/* @formsubmit-gen v3 */");
      expect(formSubmitMaster).toContain("function FormSubmit(");
      expect(formSubmitMaster).toContain("export default withResponsiveProps(FormSubmit)");
    });

    it('verifies onSubmit lifecycle state wiring and hook presence', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, label: 'Submit' },
        context,
      );

      const code = projectFS.readFile('app/page.client.tsx')!;
      // Verify useState hook was declared
      expect(code).toMatch(/const\s+\[formState[A-Za-z0-9]+,\s*setFormState[A-Za-z0-9]+\]\s*=\s*useState\('idle'\);/);
      
      // Verify FormSubmit initialVariant binds to formState
      expect(code).toContain('initialVariant={formState');
      expect(code).toContain("data-form-state='{\"loading\":\"loading\",\"success\":\"success\"}'");
    });

    it('does not duplicate FormSubmit import when adding multiple submit buttons', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, label: 'Primary Submit' },
        context,
      );

      await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, label: 'Secondary Submit' },
        context,
      );

      const code = projectFS.readFile('app/page.client.tsx')!;
      const importMatches = code.match(/import\s+FormSubmit\s+from\s+['"]@\/components\/FormSubmit['"];/g);
      expect(importMatches).not.toBeNull();
      expect(importMatches?.length).toBe(1);
    });

    it('handles multiple forms on the same page with isolated state variables without collision', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const f1 = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container', name: 'Form 1' },
        context,
      );

      const f2 = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form2-container', name: 'Form 2' },
        context,
      );

      const btn1 = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: f1.formId, label: 'Submit Form 1' },
        context,
      );

      const btn2 = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: f2.formId, label: 'Submit Form 2' },
        context,
      );

      expect(btn1.formId).toBe(f1.formId);
      expect(btn2.formId).toBe(f2.formId);

      const code = projectFS.readFile('app/page.client.tsx')!;
      const ast = parseJSX(code);
      expect(ast).not.toBeNull();

      // Ensure distinct state hooks exist for each form
      const f1Clean = f1.formId.replace(/[^a-zA-Z0-9]/g, '');
      const f2Clean = f2.formId.replace(/[^a-zA-Z0-9]/g, '');
      expect(code).toContain(`formState${f1Clean.charAt(0).toUpperCase() + f1Clean.slice(1)}`);
      expect(code).toContain(`formState${f2Clean.charAt(0).toUpperCase() + f2Clean.slice(1)}`);
    });

    it('works when submit button is placed in a nested container inside a form', async () => {
      const pageWithNestedContainer = `'use client';
import React from 'react';

export default function DeepPage() {
  return (
    <div data-id="root">
      <form data-id="nested-form" style={{ display: 'flex', flexDirection: 'column' }}>
        <div data-id="actions-row" style={{ display: 'flex', gap: '8px' }}></div>
      </form>
    </div>
  );
}
`;
      const snap = createMockSnapshot({ 'app/deep/page.client.tsx': pageWithNestedContainer });

      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/deep/page.client.tsx', parentId: 'actions-row', label: 'Nested Submit' },
        context,
      );

      expect(btn.formId).toBe('nested-form');
      const code = projectFS.readFile('app/deep/page.client.tsx')!;
      expect(code).toContain('<FormSubmit');
      expect(code).toContain('data-id="' + btn.instanceId + '"');
      expect(code).toContain('formStateNestedform');
    });

    it('throws error when parentId does not exist or is outside form', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      await expect(
        formsSubmitButtonAddOperation.execute(
          snap,
          { filePath: 'app/page.client.tsx', parentId: 'non-existent-parent' },
          context,
        ),
      ).rejects.toThrow(/PARENT_NOT_FOUND/);

      await expect(
        formsSubmitButtonAddOperation.execute(
          snap,
          { filePath: 'app/page.client.tsx', parentId: 'loose-container' }, // Outside any form
          context,
        ),
      ).rejects.toThrow(/NOT_IN_FORM/);

      await expect(
        formsSubmitButtonAddOperation.execute(
          snap,
          { filePath: 'app/missing.client.tsx', parentId: 'root' },
          context,
        ),
      ).rejects.toThrow(/FILE_NOT_FOUND/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Select Caret Styling & Removal
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. forms.selectCaret.set Verification', () => {
    it('injects select caret into a newly created <style> block and updates it cleanly', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const field = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          parentId: form.formId,
          type: 'select',
          name: 'currency',
          label: 'Currency',
          options: ['USD', 'EUR', 'GBP'],
        },
        context,
      );

      const selectId = field.controlId!;
      const caret1 = '      background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E");\n      background-position: right 12px center;\n      background-repeat: no-repeat;';

      // 1. First injection
      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: selectId, cssBody: caret1 },
        context,
      );

      let code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).toContain('<style>');
      expect(code).toContain(`select[data-id="${selectId}"]`);
      expect(code).toContain('background-position: right 12px center');

      // 2. Update existing rule
      const caret2 = '      background-image: url("data:image/svg+xml,%3Csvg%3E%3Cpath d=\'M7 10l5 5 5-5z\'/%3E%3C/svg%3E");\n      background-position: right 16px center;';
      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: selectId, cssBody: caret2 },
        context,
      );

      code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).toContain('background-position: right 16px center');
      expect(code).not.toContain('background-position: right 12px center');
      // Count selector occurrences - must be exactly 1
      const count = (code.match(new RegExp(`select\\[data-id="${selectId}"\\]`, 'g')) || []).length;
      expect(count).toBe(1);
    });

    it('removes custom select caret cleanly when cssBody is null', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const field = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          parentId: form.formId,
          type: 'select',
          name: 'country',
          label: 'Country',
          options: ['USA', 'Canada'],
        },
        context,
      );

      const selectId = field.controlId!;
      const caretCSS = '      background-image: url("data:image/svg+xml;utf8,<svg></svg>");';

      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: selectId, cssBody: caretCSS },
        context,
      );

      // Now remove with null
      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: selectId, cssBody: null },
        context,
      );

      const code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).not.toContain(`select[data-id="${selectId}"]`);
      expect(code).not.toContain(caretCSS);
      // Valid JSX after removal
      expect(parseJSX(code)).not.toBeNull();
    });

    it('preserves other rules in <style> block when updating or removing one select caret', async () => {
      const pageWithExistingStyle = `'use client';
import React from 'react';

export default function StyledPage() {
  return (
    <div data-id="root">
      <style>{\`
        .existing-custom-class { color: red; }
      \`}</style>
      <form data-id="form-styled">
        <select data-id="sel-1"><option>1</option></select>
        <select data-id="sel-2"><option>2</option></select>
      </form>
    </div>
  );
}
`;
      const snap = createMockSnapshot({ 'app/styled/page.client.tsx': pageWithExistingStyle });

      // Add caret to sel-1 and sel-2
      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/styled/page.client.tsx', nodeId: 'sel-1', cssBody: 'background: red;' },
        context,
      );

      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/styled/page.client.tsx', nodeId: 'sel-2', cssBody: 'background: blue;' },
        context,
      );

      let code = projectFS.readFile('app/styled/page.client.tsx')!;
      expect(code).toContain('.existing-custom-class { color: red; }');
      expect(code).toContain('select[data-id="sel-1"]');
      expect(code).toContain('select[data-id="sel-2"]');

      // Remove caret on sel-1
      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/styled/page.client.tsx', nodeId: 'sel-1', cssBody: null },
        context,
      );

      code = projectFS.readFile('app/styled/page.client.tsx')!;
      expect(code).toContain('.existing-custom-class { color: red; }');
      expect(code).not.toContain('select[data-id="sel-1"]');
      expect(code).toContain('select[data-id="sel-2"]');
      expect(code).toContain('background: blue;');
    });

    it('tests select caret cleanup behavior when removing a select field wrapper', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const field = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          parentId: form.formId,
          type: 'select',
          name: 'role',
          label: 'User Role',
          options: ['Admin', 'Editor', 'Viewer'],
        },
        context,
      );

      const selectId = field.controlId!;
      const caretCSS = 'background-image: url("caret.svg");';

      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: selectId, cssBody: caretCSS },
        context,
      );

      let code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).toContain(`select[data-id="${selectId}"]`);

      // 1. Cleanly remove custom select caret using forms.selectCaret.set with null
      await formsSelectCaretSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: selectId, cssBody: null },
        context,
      );
      code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).not.toContain(`select[data-id="${selectId}"]`);

      // 2. Remove field wrapper
      await formsFieldRemoveOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', fieldId: field.fieldId },
        context,
      );
      code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).not.toContain(field.fieldId);
    });

    it('throws error when nodeId or file is not found', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      await expect(
        formsSelectCaretSetOperation.execute(
          snap,
          { filePath: 'app/page.client.tsx', nodeId: 'non-existent-select', cssBody: 'color: red;' },
          context,
        ),
      ).rejects.toThrow(/NODE_NOT_FOUND/);

      await expect(
        formsSelectCaretSetOperation.execute(
          snap,
          { filePath: 'app/missing.client.tsx', nodeId: 'sel', cssBody: null },
          context,
        ),
      ).rejects.toThrow(/FILE_NOT_FOUND/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Form State Mapping (forms.state.map / get)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. forms.state.map and forms.state.get Verification', () => {
    it('properly binds button variants (loading, success, error, disabled) to enclosing form state', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, label: 'Sign Up' },
        context,
      );

      // Map all 4 states
      const mapRes = await formsStateMapOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: btn.instanceId,
          states: {
            loading: 'button-loading-spinner',
            success: 'button-success-checkmark',
            error: 'button-error-shake',
            disabled: 'button-disabled-muted',
          },
        },
        context,
      );

      expect(mapRes.nodeId).toBe(btn.instanceId);
      expect(mapRes.formId).toBe(form.formId);

      // Read back with forms.state.get
      const stateGet = await formsStateGetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: btn.instanceId },
        context,
      );

      expect(stateGet.states).toEqual({
        loading: 'button-loading-spinner',
        success: 'button-success-checkmark',
        error: 'button-error-shake',
        disabled: 'button-disabled-muted',
      });

      // Verify code JSX ternary expression
      const code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).toContain("=== 'loading' ? 'button-loading-spinner'");
      expect(code).toContain("=== 'success' ? 'button-success-checkmark'");
      expect(code).toContain("=== 'error' ? 'button-error-shake'");
      expect(code).toContain("=== 'disabled' ? 'button-disabled-muted'");
    });

    it('supports partial state mappings (e.g. only loading and error)', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId },
        context,
      );

      await formsStateMapOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: btn.instanceId,
          states: {
            loading: 'spin',
            error: 'retry',
          },
        },
        context,
      );

      const stateGet = await formsStateGetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: btn.instanceId },
        context,
      );

      expect(stateGet.states).toEqual({
        loading: 'spin',
        error: 'retry',
      });

      const code = projectFS.readFile('app/page.client.tsx')!;
      expect(code).toContain("=== 'loading' ? 'spin'");
      expect(code).toContain("=== 'error' ? 'retry'");
      expect(code).not.toContain("=== 'success'");
    });

    it('is idempotent and allows re-mapping states multiple times without duplicating attributes', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container' },
        context,
      );

      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId },
        context,
      );

      // Map 1
      await formsStateMapOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: btn.instanceId, states: { loading: 'v1-loading' } },
        context,
      );

      // Map 2
      await formsStateMapOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: btn.instanceId, states: { loading: 'v2-loading', success: 'v2-success' } },
        context,
      );

      // Map 3
      await formsStateMapOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: btn.instanceId, states: { success: 'v3-success' } },
        context,
      );

      const code = projectFS.readFile('app/page.client.tsx')!;
      expect(parseJSX(code)).not.toBeNull();

      // Only one data-form-state attribute should exist on this instance
      const btnTagMatch = code.match(/<FormSubmit[^>]*data-id="[^"]+"[^>]*>/);
      expect(btnTagMatch).not.toBeNull();
      const dataFormStateCount = (btnTagMatch![0].match(/data-form-state=/g) || []).length;
      expect(dataFormStateCount).toBe(1);
      const initialVariantCount = (btnTagMatch![0].match(/initialVariant=/g) || []).length;
      expect(initialVariantCount).toBe(1);

      const stateGet = await formsStateGetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', nodeId: btn.instanceId },
        context,
      );
      expect(stateGet.states).toEqual({ success: 'v3-success' });
    });

    it('rejects state mapping on non-existent node, non-component tag, or outside form', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      // 1. Non-existent node
      await expect(
        formsStateMapOperation.execute(
          snap,
          { filePath: 'app/page.client.tsx', nodeId: 'ghost-node', states: { loading: 'loading' } },
          context,
        ),
      ).rejects.toThrow(/NODE_NOT_FOUND/);

      // 2. Node outside form
      await expect(
        formsStateMapOperation.execute(
          snap,
          { filePath: 'app/page.client.tsx', nodeId: 'raw-btn', states: { loading: 'loading' } },
          context,
        ),
      ).rejects.toThrow(/NOT_IN_FORM/);

      // 3. HTML element tag inside form (<button>)
      const pageWithRawButtonInForm = `'use client';
import React from 'react';

export default function RawPage() {
  return (
    <div data-id="root">
      <form data-id="form-raw">
        <button data-id="native-button" type="submit">Submit</button>
      </form>
    </div>
  );
}
`;
      const snap2 = createMockSnapshot({ 'app/raw/page.client.tsx': pageWithRawButtonInForm });
      await expect(
        formsStateMapOperation.execute(
          snap2,
          { filePath: 'app/raw/page.client.tsx', nodeId: 'native-button', states: { loading: 'loading' } },
          context,
        ),
      ).rejects.toThrow(/NOT_A_COMPONENT_INSTANCE/);
    });

    it('rejects mapping when states object is empty', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      expect(() => {
        formsStateMapOperation.inputSchema.parse({
          filePath: 'app/page.client.tsx',
          nodeId: 'btn-1',
          states: {},
        });
      }).toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. End-to-End AST & Oracle Integrity Check
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Full Lifecycle & Oracle Dialect Conformance', () => {
    it('produces valid AST and clean Oracle check throughout lifecycle', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': MULTI_FORM_PAGE });

      // 1. Create form
      const form = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: 'form1-container', name: 'Lead Form' },
        context,
      );

      // 2. Add text field
      await formsFieldAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, type: 'text', name: 'full_name', label: 'Full Name', required: true },
        context,
      );

      // 3. Add select field
      const selectField = await formsFieldAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, type: 'select', name: 'plan', label: 'Subscription Plan', options: ['Free', 'Pro', 'Enterprise'] },
        context,
      );

      // 4. Style select caret
      await formsSelectCaretSetOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: selectField.controlId!,
          cssBody: 'background-position: right 14px center;',
        },
        context,
      );

      // 5. Add submit button
      const btn = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', parentId: form.formId, label: 'Get Started' },
        context,
      );

      // 6. Map form state variants
      await formsStateMapOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: btn.instanceId,
          states: { loading: 'loading-state', success: 'success-state' },
        },
        context,
      );

      // 7. Verify code passes Oracle tier >= 2
      const finalCode = projectFS.readFile('app/page.client.tsx')!;
      const violations = checkFile(finalCode, { kind: 'page' })
        .filter((v) => v.code.startsWith('FORM_') && v.tier >= 2);

      expect(violations).toEqual([]);
    });
  });
});
