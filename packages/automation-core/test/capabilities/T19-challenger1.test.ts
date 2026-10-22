// packages/automation-core/test/capabilities/T19-challenger1.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
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
  type FormFieldType,
} from '../../src/operations/form-fields';
import {
  formsStateMapOperation,
  formsStateGetOperation,
} from '../../src/operations/form-states';
import { projectFS } from '@/code/project/project-fs';
import { FORM_ROUTE_PATH, FORM_SUBMIT_ENDPOINT } from '@/code/generation/form-gen';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { checkFile } from '@/code/oracle/check-file';

const TEST_PAGE_TSX = `'use client';
import React from 'react';

export default function ContactUs() {
  return (
    <div data-id="page-root" style={{ width: '100%', minHeight: '100vh', padding: '32px' }}>
      <header data-id="page-header">
        <h1 data-id="main-heading">Customer Portal</h1>
      </header>
      <main data-id="content-container">
        <div data-id="form-slot" style={{ maxWidth: '640px', margin: '0 auto' }}></div>
      </main>
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'challenger1-project', branchId: 'main' }, 0, files);
}

describe('T19 Challenger 1: Adversarial Challenge Suite', () => {
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
  // 1. All 11 Field Types & Accessible Labels
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. All 11 Field Types & Accessible Labels', () => {
    it('creates valid JSX and accessible labels for all 11 field types in a single form', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      // 1. Create form container
      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot', name: 'All Fields Form' },
        context,
      );

      // Set destinations so Oracle passes
      await formsDestinationSetOperation.execute(
        snap,
        {
          filePath,
          nodeId: formId,
          emails: [{ recipient: 'contact@revyme.dev', subject: 'New Submission' }],
        },
        context,
      );

      const fieldDefs: Array<{
        type: FormFieldType;
        name: string;
        label: string;
        placeholder?: string;
        options?: string[];
        required?: boolean;
      }> = [
        { type: 'text', name: 'userText', label: 'Full Name', placeholder: 'Jane Doe', required: true },
        { type: 'email', name: 'userEmail', label: 'Email Address', placeholder: 'jane@example.com', required: true },
        { type: 'tel', name: 'userTel', label: 'Telephone', placeholder: '+1 555-0199', required: false },
        { type: 'url', name: 'userUrl', label: 'Personal Website', placeholder: 'https://example.com', required: false },
        { type: 'number', name: 'userNumber', label: 'Experience Years', placeholder: '5', required: true },
        { type: 'password', name: 'userPassword', label: 'Password', placeholder: 'Secret123', required: false },
        { type: 'date', name: 'userDate', label: 'Birth Date', required: false },
        { type: 'checkbox', name: 'userCheckbox', label: 'Opt-in Marketing', required: false },
        { type: 'radio', name: 'userRadio', label: 'Notification Preference', options: ['Email', 'SMS', 'None'], required: true },
        { type: 'textarea', name: 'userTextarea', label: 'Cover Letter', placeholder: 'Why us...', required: true },
        { type: 'select', name: 'userSelect', label: 'Department', options: ['Engineering', 'Design', 'Sales'], placeholder: 'Select dept...', required: true },
      ];

      expect(fieldDefs.length).toBe(11);
      expect(FIELD_TYPES.length).toBe(11);

      const addedFields = [];
      for (const def of fieldDefs) {
        const res = await formsFieldAddOperation.execute(
          snap,
          {
            filePath,
            parentId: formId,
            type: def.type,
            name: def.name,
            label: def.label,
            placeholder: def.placeholder,
            options: def.options,
            required: def.required,
          },
          context,
        );
        addedFields.push({ def, res });
      }

      // Add Submit button and Honeypot
      const btnRes = await formsSubmitButtonAddOperation.execute(
        snap,
        { filePath, parentId: formId, label: 'Send Form' },
        context,
      );
      const hpRes = await formsHoneypotAddOperation.execute(
        snap,
        { filePath, formId },
        context,
      );

      const finalCode = projectFS.readFile(filePath)!;

      // Ensure code is valid JSX parseable into CanvasNode tree
      const nodes = parseJSXToNodes(finalCode);
      expect(nodes.has(formId)).toBe(true);
      expect(nodes.has(btnRes.instanceId)).toBe(true);
      expect(nodes.has(hpRes.fieldId)).toBe(true);

      // Verify each field's JSX structure and accessibility
      for (const { def, res } of addedFields) {
        expect(nodes.has(res.fieldId)).toBe(true);
        expect(nodes.has(res.labelId)).toBe(true);

        if (def.type === 'radio') {
          // Radio: res.controlId is null because multiple radio inputs exist in the group
          expect(res.controlId).toBeNull();
          const labelNode = nodes.get(res.labelId)!;
          expect(labelNode.textContent).toBe(def.label);
          for (const opt of def.options!) {
            expect(finalCode).toContain(`value="${opt}"`);
          }
        } else {
          // Standard inputs, textarea, select, checkbox:
          expect(res.controlId).not.toBeNull();
          const controlNode = nodes.get(res.controlId!)!;
          expect(controlNode).toBeDefined();

          const labelNode = nodes.get(res.labelId)!;
          // Accessible label association: htmlFor on label matches control id
          expect(labelNode.attrs?.htmlFor).toBe(res.controlId!);
          expect(controlNode.attrs?.id).toBe(res.controlId!);
          expect(controlNode.attrs?.name).toBe(def.name);

          if (def.required) {
            expect(controlNode.attrs?.required).toBe('true');
            expect(finalCode).toContain('aria-required="true"');
          }
        }
      }

      // Oracle dialect validation: 0 FORM_* violations tier >= 2
      const violations = checkFile(finalCode, { kind: 'page' })
        .filter((v) => v.code.startsWith('FORM_') && v.tier >= 2);
      expect(violations).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Insecure Webhook URLs (http://...) Rejection
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Insecure Webhook URLs & Protocol Enforcement', () => {
    it('rejects plain HTTP webhook URLs with explicit error', () => {
      const insecureUrls = [
        'http://example.com/webhook',
        'http://api.mysite.com/hook',
        'http://localhost:8080/events',
        'http://127.0.0.1:3000/webhook',
        'http://192.168.1.1/relay',
      ];

      for (const url of insecureUrls) {
        expect(() => {
          formsDestinationSetOperation.inputSchema.parse({
            filePath: 'app/contact/page.client.tsx',
            nodeId: 'form-1',
            webhooks: [{ url }],
          });
        }).toThrow(/Webhooks must use HTTPS/);
      }
    });

    it('rejects invalid URL strings and non-HTTP protocols', () => {
      const invalidProtocols = [
        'ftp://files.example.com/upload',
        'javascript:alert("XSS")',
        'data:text/html;base64,PHNjcmlwdD4=',
        'file:///etc/passwd',
        '//schemeless.example.com/api',
        'not-a-valid-url',
      ];

      for (const url of invalidProtocols) {
        expect(() => {
          formsDestinationSetOperation.inputSchema.parse({
            filePath: 'app/contact/page.client.tsx',
            nodeId: 'form-1',
            webhooks: [{ url }],
          });
        }).toThrow();
      }
    });

    it('accepts valid HTTPS webhook URLs', () => {
      const validWebhooks = [
        'https://api.crm.com/v2/ingest',
        'https://hooks.slack.com/services/T00/B00/XXXX',
        'https://secure.example.com:8443/webhook?token=abc&src=revyme',
        'https://sub.sub.domain.org/path/to/target',
      ];

      for (const url of validWebhooks) {
        const parsed = formsDestinationSetOperation.inputSchema.parse({
          filePath: 'app/contact/page.client.tsx',
          nodeId: 'form-1',
          webhooks: [{ url, secret: 'whsec_test' }],
        });
        expect(parsed.webhooks?.[0].url).toBe(url);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Empty Destination Arrays Rejection
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Empty Destination Enforcement', () => {
    it('throws DESTINATION_REQUIRED when both emails and webhooks are empty arrays', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      await expect(
        formsDestinationSetOperation.execute(
          snap,
          {
            filePath,
            nodeId: formId,
            emails: [],
            webhooks: [],
          },
          context,
        ),
      ).rejects.toThrow(/DESTINATION_REQUIRED/);
    });

    it('throws DESTINATION_REQUIRED when both emails and webhooks are omitted/undefined', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      await expect(
        formsDestinationSetOperation.execute(
          snap,
          {
            filePath,
            nodeId: formId,
          },
          context,
        ),
      ).rejects.toThrow(/DESTINATION_REQUIRED/);
    });

    it('throws DESTINATION_REQUIRED when emails is empty array and webhooks is undefined', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      await expect(
        formsDestinationSetOperation.execute(
          snap,
          {
            filePath,
            nodeId: formId,
            emails: [],
          },
          context,
        ),
      ).rejects.toThrow(/DESTINATION_REQUIRED/);
    });

    it('throws DESTINATION_REQUIRED when emails is undefined and webhooks is empty array', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      await expect(
        formsDestinationSetOperation.execute(
          snap,
          {
            filePath,
            nodeId: formId,
            webhooks: [],
          },
          context,
        ),
      ).rejects.toThrow(/DESTINATION_REQUIRED/);
    });

    it('rejects invalid email formats in email destinations', () => {
      const invalidEmails = [
        'notanemail',
        '@nodomain.com',
        'username@.com',
        'username@domain..com',
        'username@ domain.com',
      ];

      for (const recipient of invalidEmails) {
        expect(() => {
          formsDestinationSetOperation.inputSchema.parse({
            filePath: 'app/contact/page.client.tsx',
            nodeId: 'form-1',
            emails: [{ recipient }],
          });
        }).toThrow(/Invalid email/);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Prototype Pollution & Malformed Input Defense
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Prototype Pollution & Malformed Input Defense', () => {
    it('blocks prototype pollution attempts via field names without polluting global Object prototype', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      const prototypeAttacks = [
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString',
      ];

      for (const attack of prototypeAttacks) {
        try {
          await formsFieldAddOperation.execute(
            snap,
            {
              filePath,
              parentId: formId,
              type: 'text',
              name: attack,
              label: 'Attack Test',
            },
            context,
          );
          expect.fail(`Expected attack name "${attack}" to be rejected`);
        } catch (err: any) {
          expect(err.message).toMatch(/(forbidden prototype property|Field name must be alphanumeric)/);
        }
      }

      // Verify Object prototype remains clean
      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any)[formId]).toBeUndefined();
    });

    it('blocks prototype pollution through destination objects without polluting Object.prototype', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      const maliciousPayload = JSON.parse('{"recipient":"admin@revyme.dev","__proto__":{"pollutedKey":"injected"}}');

      await formsDestinationSetOperation.execute(
        snap,
        {
          filePath,
          nodeId: formId,
          emails: [maliciousPayload],
        },
        context,
      );

      expect(({} as any).pollutedKey).toBeUndefined();
    });

    it('rejects field names starting with numbers, spaces, or special characters', () => {
      const invalidNames = [
        '123first',
        'user name',
        'field.with.dot',
        'field$dollar',
        '<script>',
        '-leadingdash',
        '_leadingunderscore',
        '',
      ];

      for (const name of invalidNames) {
        expect(() => {
          formsFieldAddOperation.inputSchema.parse({
            filePath: 'app/contact/page.client.tsx',
            parentId: 'form-1',
            type: 'text',
            name,
            label: 'Test Label',
          });
        }).toThrow(/Field name must be alphanumeric/);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Form Lifecycle, Honeypot & Deletion
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Form Lifecycle, Honeypot & Deletion', () => {
    it('deletes form container and its contents cleanly', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      const fieldRes = await formsFieldAddOperation.execute(
        snap,
        {
          filePath,
          parentId: formId,
          type: 'text',
          name: 'username',
          label: 'Username',
        },
        context,
      );

      const delRes = await formsDeleteOperation.execute(
        snap,
        { filePath, formId },
        context,
      );

      expect(delRes.formId).toBe(formId);
      const code = projectFS.readFile(filePath)!;
      expect(code).not.toContain(formId);
      expect(code).not.toContain(fieldRes.fieldId);
    });

    it('adds honeypot field with hidden styling and tabIndex -1 and rejects adding honeypot to non-form', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      const hpRes = await formsHoneypotAddOperation.execute(
        snap,
        { filePath, formId },
        context,
      );

      expect(hpRes.fieldId).toBeDefined();
      const code = projectFS.readFile(filePath)!;
      expect(code).toContain('name="_hp"');
      expect(code).toContain('tabIndex="-1"');
      expect(code).toContain("display: 'none'");
      expect(code).toContain('aria-hidden="true"');

      // Attempting honeypot on non-form node throws
      await expect(
        formsHoneypotAddOperation.execute(
          snap,
          { filePath, formId: 'page-header' },
          context,
        ),
      ).rejects.toThrow(/NOT_A_FORM/);
    });

    it('correctly reads back configured form destinations via forms.destination.get', async () => {
      const filePath = 'app/contact/page.client.tsx';
      const snap = createMockSnapshot({ [filePath]: TEST_PAGE_TSX });

      const { formId } = await formsCreateOperation.execute(
        snap,
        { filePath, parentId: 'form-slot' },
        context,
      );

      await formsDestinationSetOperation.execute(
        snap,
        {
          filePath,
          nodeId: formId,
          emails: [
            { recipient: 'ops@revyme.dev', subject: 'Ops Alert', name: 'Ops Team' },
          ],
          webhooks: [
            { url: 'https://webhook.site/test-hook', secret: 'whsec_999' },
          ],
          redirect: '/thank-you',
          antispam: 'block',
        },
        context,
      );

      const getRes = await formsDestinationGetOperation.execute(
        snap,
        { filePath, nodeId: formId },
        context,
      );

      expect(getRes.formId).toBe(formId);
      expect(getRes.sendTo).toHaveLength(2);
      expect(getRes.sendTo[0].type).toBe('email');
      expect(getRes.sendTo[0].recipient).toBe('ops@revyme.dev');
      expect(getRes.sendTo[0].subject).toBe('Ops Alert');
      expect(getRes.sendTo[0].name).toBe('Ops Team');
      expect(getRes.sendTo[1].type).toBe('webhook');
      expect(getRes.sendTo[1].url).toBe('https://webhook.site/test-hook');
      expect(getRes.sendTo[1].secret).toBe('whsec_999');
      expect(getRes.redirect).toBe('/thank-you');
      expect(getRes.antispam).toEqual({ mode: 'basic', filtering: 'block' });
    });
  });
});
