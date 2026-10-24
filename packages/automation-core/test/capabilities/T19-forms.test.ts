// packages/automation-core/test/capabilities/T19-forms.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  formsCreateOperation,
  formsDestinationSetOperation,
  formsDestinationGetOperation,
  formsDeleteOperation,
  formsHoneypotAddOperation,
} from '../../src/operations/forms';
import {
  formsFieldAddOperation,
  formsFieldRemoveOperation,
  formsSelectCaretSetOperation,
  formsSubmitButtonAddOperation,
  formsFieldUpdateOperation,
  FIELD_TYPES,
} from '../../src/operations/form-fields';
import {
  formsStateMapOperation,
  formsStateGetOperation,
} from '../../src/operations/form-states';
import { projectFS } from '@/code/project/project-fs';
import { FORM_ROUTE_PATH, FORM_SUBMIT_ENDPOINT } from '@/code/generation/form-gen';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { checkFile } from '@/code/oracle/check-file';

const BASE_PAGE = `'use client';
import React from 'react';

export default function ContactPage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="title">Get In Touch</h1>
      <div data-id="form-wrapper" style={{ width: '100%', maxWidth: '600px' }}></div>
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

describe('T19: Forms, Inputs, Validation & Destinations', () => {
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
  // 1. Registry & Aliases Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Registry Registration & Aliases', () => {
    it('registers all primary T19 operations in defaultRegistry', () => {
      expect(defaultRegistry.get('forms.create')).toBeDefined();
      expect(defaultRegistry.get('forms.destination.set')).toBeDefined();
      expect(defaultRegistry.get('forms.destination.get')).toBeDefined();
      expect(defaultRegistry.get('forms.delete')).toBeDefined();
      expect(defaultRegistry.get('forms.honeypot.add')).toBeDefined();
      expect(defaultRegistry.get('forms.field.add')).toBeDefined();
      expect(defaultRegistry.get('forms.field.remove')).toBeDefined();
      expect(defaultRegistry.get('forms.selectCaret.set')).toBeDefined();
      expect(defaultRegistry.get('forms.submitButton.add')).toBeDefined();
      expect(defaultRegistry.get('forms.field.update')).toBeDefined();
      expect(defaultRegistry.get('forms.state.map')).toBeDefined();
      expect(defaultRegistry.get('forms.state.get')).toBeDefined();
    });

    it('resolves compatibility aliases to their target operations', () => {
      expect(defaultRegistry.get('forms.add')).toBe(formsCreateOperation);
      expect(defaultRegistry.get('forms.destinations.set')).toBe(formsDestinationSetOperation);
      expect(defaultRegistry.get('forms.config.set')).toBe(formsDestinationSetOperation);
      expect(defaultRegistry.get('forms.configure')).toBe(formsDestinationSetOperation);
      expect(defaultRegistry.get('forms.config.get')).toBe(formsDestinationGetOperation);
      expect(defaultRegistry.get('form-fields.add')).toBe(formsFieldAddOperation);
      expect(defaultRegistry.get('form-fields.remove')).toBe(formsFieldRemoveOperation);
      expect(defaultRegistry.get('forms.caret.set')).toBe(formsSelectCaretSetOperation);
      expect(defaultRegistry.get('forms.submit.add')).toBe(formsSubmitButtonAddOperation);
      expect(defaultRegistry.get('forms.state.set')).toBe(formsStateMapOperation);
      expect(defaultRegistry.get('form-states.configure')).toBe(formsStateMapOperation);
      expect(defaultRegistry.get('form-states.get')).toBe(formsStateGetOperation);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Form Container Creation & Lifecycle
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Form Container Lifecycle (forms.create, forms.delete)', () => {
    it('creates a standard <form> with flex column layout, gap 16px, width 100%, and onSubmit relay', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const res = await formsCreateOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: 'form-wrapper',
          name: 'Customer Inquiry Form',
        },
        context,
      );

      expect(res.formId).toBeDefined();
      expect(res.changes.length).toBeGreaterThanOrEqual(1);

      // Check modified page code
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain(`data-id="${res.formId}"`);
      expect(updatedCode).toContain("display: 'flex'");
      expect(updatedCode).toContain("flexDirection: 'column'");
      expect(updatedCode).toContain("gap: '16px'");
      expect(updatedCode).toContain("width: '100%'");
      expect(updatedCode).toContain('onSubmit={');
      expect(updatedCode).toContain(FORM_SUBMIT_ENDPOINT);

      // Check relay route creation in projectFS
      expect(projectFS.readFile(FORM_ROUTE_PATH)).not.toBeNull();
      expect(projectFS.readFile(FORM_ROUTE_PATH)).toContain('REVYME_FORMS_URL');
    });

    it('creates a <motion.form> with motion imports when motion is true', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const res = await formsCreateOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: 'form-wrapper',
          motion: true,
        },
        context,
      );

      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain('<motion.form');
      expect(updatedCode).toContain('from \'framer-motion\'');
      expect(updatedCode).toContain(`data-id="${res.formId}"`);
    });

    it('deletes a form container cleanly with all children removed', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const createRes = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      // Delete form
      const delRes = await formsDeleteOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', formId: createRes.formId },
        context,
      );

      expect(delRes.formId).toBe(createRes.formId);
      const codeAfterDel = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(codeAfterDel).not.toContain(createRes.formId);
    });

    it('throws error when target file or parent node does not exist', async () => {
      const snap = createMockSnapshot({});
      await expect(
        formsCreateOperation.execute(
          snap,
          { filePath: 'nonexistent/page.tsx', parentId: 'root' },
          context,
        ),
      ).rejects.toThrow(/FILE_NOT_FOUND/);

      const snap2 = createMockSnapshot({ 'app/contact/page.client.tsx': BASE_PAGE });
      await expect(
        formsCreateOperation.execute(
          snap2,
          { filePath: 'app/contact/page.client.tsx', parentId: 'missing-parent' },
          context,
        ),
      ).rejects.toThrow(/PARENT_NOT_FOUND/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Form Destinations & Antispam Configuration
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Form Destinations & Antispam Configuration (forms.destination.set / get)', () => {
    it('configures email and HTTPS webhook destinations, redirect URL, and antispam mode', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      let snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      // Set destinations
      const setRes = await formsDestinationSetOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          nodeId: formId,
          emails: [
            { recipient: 'support@example.com', subject: 'New Support Ticket', name: 'Support Queue' },
            { recipient: 'admin@example.com' },
          ],
          webhooks: [
            { url: 'https://api.crm.example.com/v1/leads', secret: 'whsec_test123' },
          ],
          redirect: '/thank-you',
          antispam: 'block',
        },
        context,
      );

      expect(setRes.formId).toBe(formId);
      expect(setRes.sendToCount).toBe(3);
      expect(setRes.redirect).toBe('/thank-you');
      expect(setRes.antispam).toBe('block');

      // Verify with forms.destination.get
      const getRes = await formsDestinationGetOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', nodeId: formId },
        context,
      );

      expect(getRes.formId).toBe(formId);
      expect(getRes.sendTo).toHaveLength(3);
      expect(getRes.sendTo[0].type).toBe('email');
      expect(getRes.sendTo[0].recipient).toBe('support@example.com');
      expect(getRes.sendTo[0].subject).toBe('New Support Ticket');
      expect(getRes.sendTo[2].type).toBe('webhook');
      expect(getRes.sendTo[2].url).toBe('https://api.crm.example.com/v1/leads');
      expect(getRes.sendTo[2].secret).toBe('whsec_test123');
      expect(getRes.redirect).toBe('/thank-you');
      expect(getRes.antispam).toEqual({ mode: 'basic', filtering: 'block' });
    });

    it('enforces HTTPS for webhooks, rejecting plain HTTP URLs', () => {
      expect(() => {
        formsDestinationSetOperation.inputSchema.parse({
          filePath: 'app/contact/page.client.tsx',
          nodeId: 'form-1',
          webhooks: [{ url: 'http://insecure-endpoint.example.com/webhook' }],
        });
      }).toThrow(/Webhooks must use HTTPS/);
    });

    it('enforces email format validation for email destinations', () => {
      expect(() => {
        formsDestinationSetOperation.inputSchema.parse({
          filePath: 'app/contact/page.client.tsx',
          nodeId: 'form-1',
          emails: [{ recipient: 'not-an-email-address' }],
        });
      }).toThrow(/Invalid email/);
    });

    it('rejects destination configuration when both emails and webhooks are empty', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      await expect(
        formsDestinationSetOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            nodeId: formId,
            emails: [],
            webhooks: [],
          },
          context,
        ),
      ).rejects.toThrow(/DESTINATION_REQUIRED/);
    });

    it('throws error when setting destination on a node that is not a form', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      await expect(
        formsDestinationSetOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            nodeId: 'title', // <h1> tag
            emails: [{ recipient: 'admin@example.com' }],
          },
          context,
        ),
      ).rejects.toThrow(/NOT_A_FORM/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Form Fields Creation (All 11 Field Types)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Form Fields Creation & Management (forms.field.add / remove / update)', () => {
    it('adds text, email, tel, url, number, password, and date inputs with accessible labels and attributes', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      let snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const standardTypes: Array<'text' | 'email' | 'tel' | 'url' | 'number' | 'password' | 'date'> = [
        'text',
        'email',
        'tel',
        'url',
        'number',
        'password',
        'date',
      ];

      for (const t of standardTypes) {
        const fieldRes = await formsFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            parentId: formId,
            type: t,
            name: `user_${t}`,
            label: `Your ${t.toUpperCase()}`,
            placeholder: `Enter ${t}`,
            required: true,
          },
          context,
        );

        expect(fieldRes.formId).toBe(formId);
        expect(fieldRes.fieldId).toBeDefined();
        expect(fieldRes.labelId).toBeDefined();
        expect(fieldRes.controlId).toBeDefined();
        expect(fieldRes.name).toBe(`user_${t}`);
        expect(fieldRes.type).toBe(t);
      }

      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      for (const t of standardTypes) {
        expect(updatedCode).toContain(`name="user_${t}"`);
        expect(updatedCode).toContain(`type="${t}"`);
        expect(updatedCode).toContain(`Your ${t.toUpperCase()}`);
        expect(updatedCode).toContain('required="true"');
        expect(updatedCode).toContain('aria-required="true"');
      }
    });

    it('adds a textarea field with multiline styling and vertical resize', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const res = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'textarea',
          name: 'message',
          label: 'Your Message',
          placeholder: 'Type your inquiry here...',
          required: true,
        },
        context,
      );

      expect(res.type).toBe('textarea');
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain('<textarea');
      expect(updatedCode).toContain('name="message"');
      expect(updatedCode).toContain("minHeight: '120px'");
      expect(updatedCode).toContain("resize: 'vertical'");
    });

    it('adds a select dropdown with options array and placeholder option', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const res = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'select',
          name: 'department',
          label: 'Department',
          placeholder: 'Select a department...',
          options: ['Support', 'Sales', 'Billing', 'Partnerships'],
          required: true,
        },
        context,
      );

      expect(res.type).toBe('select');
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain('<select');
      expect(updatedCode).toContain('name="department"');
      expect(updatedCode).toContain('Select a department...');
      expect(updatedCode).toContain('value="Support"');
      expect(updatedCode).toContain('value="Sales"');
      expect(updatedCode).toContain('value="Billing"');
      expect(updatedCode).toContain('value="Partnerships"');
    });

    it('adds a checkbox field with inline flex layout and accessible label', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const res = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'checkbox',
          name: 'newsletter',
          label: 'Subscribe to newsletter updates',
          required: false,
        },
        context,
      );

      expect(res.type).toBe('checkbox');
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain('type="checkbox"');
      expect(updatedCode).toContain('name="newsletter"');
      expect(updatedCode).toContain('Subscribe to newsletter updates');
      expect(updatedCode).toContain("flexDirection: 'row'");
    });

    it('adds a radio group with group label and option rows (controlId is null)', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const res = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'radio',
          name: 'contact_pref',
          label: 'Preferred Contact Method',
          options: ['Email', 'Phone', 'SMS'],
          required: true,
        },
        context,
      );

      expect(res.type).toBe('radio');
      expect(res.controlId).toBeNull(); // Multiple radio controls in group
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain('Preferred Contact Method');
      expect(updatedCode).toContain('type="radio"');
      expect(updatedCode).toContain('value="Email"');
      expect(updatedCode).toContain('value="Phone"');
      expect(updatedCode).toContain('value="SMS"');
    });

    it('adds an anti-spam honeypot field (_hp) with hidden styling and tabIndex -1', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const res = await formsHoneypotAddOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', formId },
        context,
      );

      expect(res.fieldId).toBeDefined();
      expect(res.formId).toBe(formId);
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain('name="_hp"');
      expect(updatedCode).not.toContain("display: 'none'");
      expect(updatedCode).toContain("width: '1px'");
      expect(updatedCode).toContain("left: '-9999px'");
      expect(updatedCode).toContain('tabIndex="-1"');
      expect(updatedCode).toContain('autoComplete="off"');
      expect(checkFile(updatedCode, { kind: 'page' }).filter((v) => v.code === 'DISPLAY_TOGGLE_VISIBILITY')).toEqual([]);
    });

    it('removes a form field wrapper, label, and control cleanly', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const fieldRes = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'text',
          name: 'company',
          label: 'Company Name',
        },
        context,
      );

      const delRes = await formsFieldRemoveOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', fieldId: fieldRes.fieldId },
        context,
      );

      expect(delRes.fieldId).toBe(fieldRes.fieldId);
      const codeAfterDel = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(codeAfterDel).not.toContain(fieldRes.fieldId);
      expect(codeAfterDel).not.toContain('Company Name');
    });

    it('updates form field label, placeholder, and validation rules', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const fieldRes = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'text',
          name: 'nickname',
          label: 'Nickname',
          placeholder: 'Old placeholder',
          required: false,
        },
        context,
      );

      await formsFieldUpdateOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          fieldId: fieldRes.fieldId,
          label: 'Preferred Alias',
          placeholder: 'New cool placeholder',
          required: true,
        },
        context,
      );

      const codeAfterUpdate = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(codeAfterUpdate).toContain('Preferred Alias');
      expect(codeAfterUpdate).toContain('New cool placeholder');
      expect(codeAfterUpdate).toContain('required="true"');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Select Caret Styling (forms.selectCaret.set)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Select Caret Styling (forms.selectCaret.set)', () => {
    it('injects custom CSS caret rule into page <style> block and updates/removes it', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const fieldRes = await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'select',
          name: 'country',
          label: 'Country',
          options: ['Canada', 'Germany', 'Japan', 'Ukraine'],
        },
        context,
      );

      const selectId = fieldRes.controlId!;
      const customCaretCSS = '      background-image: url("data:image/svg+xml,...");\n      background-position: right 14px center;';

      // 1. Inject custom caret CSS
      const setRes = await formsSelectCaretSetOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          nodeId: selectId,
          cssBody: customCaretCSS,
          icon: 'lucide:chevron-down',
          color: '#ABABAB',
        },
        context,
      );

      expect(setRes.nodeId).toBe(selectId);
      let updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain(`<style>`);
      expect(updatedCode).toContain(`select[data-id="${selectId}"]`);
      expect(updatedCode).toContain('background-position: right 14px center');
      expect(updatedCode).toContain(`data-select-icon='{"icon":"lucide:chevron-down","color":"#ABABAB"}'`);
      expect(checkFile(updatedCode, { kind: 'page' }).filter((v) => v.code === 'SELECT_ICON_MARKER_MISMATCH')).toEqual([]);

      // 2. Remove custom caret CSS with null
      await formsSelectCaretSetOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          nodeId: selectId,
          cssBody: null,
        },
        context,
      );

      updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).not.toContain(`select[data-id="${selectId}"]`);
      expect(updatedCode).not.toContain('data-select-icon=');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Submit Button & Form Lifecycle States Mapping
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Submit Button & Lifecycle States (forms.submitButton.add, forms.state.map / get)', () => {
    it('materializes FormSubmit component and places instance in form with default states', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const btnRes = await formsSubmitButtonAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          label: 'Send Message',
        },
        context,
      );

      expect(btnRes.instanceId).toBeDefined();
      expect(btnRes.formId).toBe(formId);

      // Verify component master was created
      expect(projectFS.readFile('components/FormSubmit.tsx')).not.toBeNull();
      expect(projectFS.readFile('components/Spinner.tsx')).not.toBeNull();

      // Verify page imports and instance
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain("import FormSubmit from '@/components/FormSubmit';");
      expect(updatedCode).toContain('<FormSubmit');
      expect(updatedCode).toContain(`data-id="${btnRes.instanceId}"`);
      expect(updatedCode).toContain('label="Send Message"');
      expect(updatedCode).toContain('data-form-state=');
      expect(updatedCode).toContain('initialVariant=');
      expect(updatedCode).toMatch(/import[^;\n]*\buseState\b[^;\n]*from\s+['"]react['"]/);
      expect(checkFile(updatedCode, { kind: 'page' }).filter((v) => v.code === 'WOULD_CRASH' && /undefined identifier: useState/.test(v.message))).toEqual([]);

      // Verify default state mapping
      const stateGet = await formsStateGetOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', nodeId: btnRes.instanceId },
        context,
      );

      expect(stateGet.formId).toBe(formId);
      expect(stateGet.states.loading).toBe('loading');
      expect(stateGet.states.success).toBe('success');
    });

    it('customizes lifecycle state mapping for loading, success, error, and disabled states', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const { instanceId } = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: formId },
        context,
      );

      // Map custom state variants
      const mapRes = await formsStateMapOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          nodeId: instanceId,
          states: {
            loading: 'spin-loading',
            success: 'confetti-success',
            error: 'alert-error',
            disabled: 'grey-disabled',
          },
        },
        context,
      );

      expect(mapRes.nodeId).toBe(instanceId);
      expect(mapRes.formId).toBe(formId);
      expect(mapRes.states).toEqual({
        loading: 'spin-loading',
        success: 'confetti-success',
        error: 'alert-error',
        disabled: 'grey-disabled',
      });

      // Verify via forms.state.get
      const stateGet = await formsStateGetOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', nodeId: instanceId },
        context,
      );

      expect(stateGet.states.loading).toBe('spin-loading');
      expect(stateGet.states.success).toBe('confetti-success');
      expect(stateGet.states.error).toBe('alert-error');
      expect(stateGet.states.disabled).toBe('grey-disabled');

      // Verify JSX code ternary reflects new variant mappings
      const updatedCode = projectFS.readFile('app/contact/page.client.tsx')!;
      expect(updatedCode).toContain("=== 'loading' ? 'spin-loading'");
      expect(updatedCode).toContain("=== 'success' ? 'confetti-success'");
      expect(updatedCode).toContain("=== 'error' ? 'alert-error'");
      expect(updatedCode).toContain("=== 'disabled' ? 'grey-disabled'");
    });

    it('rejects state mapping on non-component instances or outside form', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      await expect(
        formsStateMapOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            nodeId: 'title', // <h1> tag, not inside form
            states: { loading: 'loading' },
          },
          context,
        ),
      ).rejects.toThrow(/NOT_IN_FORM/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Security, Prototype Safety & Boundary Cases
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Security, Prototype Safety & Boundary Cases', () => {
    it('prevents prototype pollution field names (constructor, prototype, __proto__, toString)', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      const forbidden = ['constructor', 'prototype', '__proto__', 'toString', 'valueOf'];
      for (const badName of forbidden) {
        // Schema regex might reject or execute will catch
        try {
          await formsFieldAddOperation.execute(
            snap,
            {
              filePath: 'app/contact/page.client.tsx',
              parentId: formId,
              type: 'text',
              name: badName,
              label: 'Test',
            },
            context,
          );
          expect.fail(`Should have thrown for forbidden field name "${badName}"`);
        } catch (err: any) {
          expect(err.message).toMatch(/(forbidden prototype property|Field name must be alphanumeric)/);
        }
      }
    });

    it('rejects adding fields when parent is outside any form', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      await expect(
        formsFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            parentId: 'root', // Outer div, not inside a form
            type: 'text',
            name: 'loose_field',
            label: 'Loose Field',
          },
          context,
        ),
      ).rejects.toThrow(/NOT_IN_FORM/);
    });

    it('rejects select and radio creation when options array is missing or empty', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      await expect(
        formsFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            parentId: formId,
            type: 'select',
            name: 'category',
            label: 'Category',
            options: [],
          },
          context,
        ),
      ).rejects.toThrow(/OPTIONS_REQUIRED/);

      await expect(
        formsFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/contact/page.client.tsx',
            parentId: formId,
            type: 'radio',
            name: 'priority',
            label: 'Priority',
            options: [],
          },
          context,
        ),
      ).rejects.toThrow(/OPTIONS_REQUIRED/);
    });

    it('verifies generated form page passes Oracle form dialect conformance check', async () => {
      const files: Record<string, string> = { 'app/contact/page.client.tsx': BASE_PAGE };
      const snap = createMockSnapshot(files);

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath: 'app/contact/page.client.tsx', parentId: 'form-wrapper' },
        context,
      );

      await formsDestinationSetOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          nodeId: formId,
          emails: [{ recipient: 'admin@example.com' }],
        },
        context,
      );

      await formsFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/contact/page.client.tsx',
          parentId: formId,
          type: 'email',
          name: 'email',
          label: 'Email',
          required: true,
        },
        context,
      );

      const finalCode = projectFS.readFile('app/contact/page.client.tsx')!;
      const violations = checkFile(finalCode, { kind: 'page' })
        .filter((v) => v.code.startsWith('FORM_') && v.tier >= 2);

      expect(violations).toEqual([]);
    });
  });
});
