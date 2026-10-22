// packages/automation-core/src/operations/form-fields.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { addNodeInCode, removeNodeInCode, updateNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { updateHtmlAttrsInCode } from '@/code/generation/generator-attrs';
import {
  updateSelectCaretRuleInCode,
  removeSelectCaretRuleInCode,
} from '@/code/generation/generator-styles';
import {
  ensureFormSubmitComponentFile,
  ensureFormSubmitSpinnerFile,
} from '@/code/generation/form-submit-gen';
import {
  formStateVar,
  formStateSetter,
  enclosingFormIdInCode,
  setFormStateMappingInCode,
  DEFAULT_FORM_STATE_MAPPING,
} from '@/code/generation/form-state-gen';
import { wireFormSubmitInCode } from '@/code/generation/form-gen';
import { ensureComponentImport } from './components';
import { syncFormsSnapshotToProjectFS } from './forms';
import { trace } from '@/shared/debug-trace';

export const FIELD_TYPES = [
  'text',
  'email',
  'tel',
  'url',
  'number',
  'password',
  'date',
  'checkbox',
  'radio',
  'textarea',
  'select',
] as const;

export type FormFieldType = (typeof FIELD_TYPES)[number];

const FORBIDDEN_FIELD_NAMES = new Set([
  'constructor',
  'prototype',
  '__proto__',
  'tostring',
  'valueof',
  'hasownproperty',
  'isprototypeof',
  'propertyisenumerable',
  'tolocalestring',
]);

// ─── 1. forms.field.add ──────────────────────────────────────────────────────

export const formsFieldAddInputSchema = z.object({
  filePath: z.string().min(1),
  parentId: z.string().min(1), // Form ID or container within form
  type: z.enum(FIELD_TYPES),
  name: z.string().regex(/^[a-zA-Z][\w-]*$/, 'Field name must be alphanumeric with dashes/underscores'),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  index: z.number().int().nonnegative().optional(),
});

export type FormsFieldAddInput = z.infer<typeof formsFieldAddInputSchema>;

export const formsFieldAddOperation: Operation<
  FormsFieldAddInput,
  {
    formId: string;
    fieldId: string;
    labelId: string;
    controlId: string | null;
    name: string;
    type: string;
    changes: FileChange[];
  }
> = {
  name: 'forms.field.add',
  description: 'Add a form field with accessible label and input/textarea/select/checkbox/radio control inside a <form>',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: formsFieldAddInputSchema,
  async execute(snapshot, input, context) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);

    // 1. Prototype safety validation
    const lowerName = input.name.toLowerCase();
    if (FORBIDDEN_FIELD_NAMES.has(lowerName)) {
      throw new Error(`INVALID_FIELD_NAME: Field name "${input.name}" is a forbidden prototype property`);
    }

    // 2. Read target source file
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    // 3. Verify parent exists and is inside a form
    const nodes = parseJSXToNodes(code);
    const parent = nodes.get(input.parentId);
    if (!parent) {
      throw new Error(`PARENT_NOT_FOUND: Parent node "${input.parentId}" not found in "${input.filePath}"`);
    }

    const formId = parent.type === 'form' || parent.type === 'motion.form'
      ? parent.id
      : enclosingFormIdInCode(code, input.parentId);

    if (!formId) {
      throw new Error(`NOT_IN_FORM: Parent node "${input.parentId}" is not inside any <form>`);
    }

    // 4. Validate options requirement for select and radio
    if ((input.type === 'select' || input.type === 'radio') && (!input.options || input.options.length === 0)) {
      throw new Error(`OPTIONS_REQUIRED: Field type "${input.type}" requires a non-empty options array`);
    }

    const fieldId = context.createId(`field-${input.name}`);
    const labelId = context.createId(`${input.name}-label`);
    const controlId = input.type === 'radio' ? null : context.createId(`${input.name}-input`);

    // Common attributes
    const commonAttrs: Record<string, string> = {
      name: input.name,
      ...(input.required ? { required: 'true', 'aria-required': 'true' } : {}),
    };

    let fieldWrapperDef: AddNodeDef;

    if (input.type === 'checkbox') {
      fieldWrapperDef = {
        id: fieldId,
        type: 'div',
        name: `${input.label} field`,
        styles: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
        },
        children: [
          {
            id: controlId!,
            type: 'input',
            name: `${input.label} Checkbox`,
            styles: {
              position: 'relative',
              flex: '0 0 auto',
              width: '16px',
              height: '16px',
              cursor: 'pointer',
            },
            attrs: {
              ...commonAttrs,
              id: controlId!,
              type: 'checkbox',
            },
          },
          {
            id: labelId,
            type: 'label',
            name: 'Label',
            styles: {
              position: 'relative',
              fontSize: '14px',
              cursor: 'pointer',
              userSelect: 'none',
            },
            attrs: {
              htmlFor: controlId!,
            },
            textContent: input.label,
          },
        ],
      };
    } else if (input.type === 'radio') {
      const radioOptions = (input.options ?? []).map((opt) => {
        const rowId = context.createId(`${input.name}-row`);
        const radioInputId = context.createId(`${input.name}-radio`);
        const rowDef: AddNodeDef = {
          id: rowId,
          type: 'label',
          name: `${opt} option`,
          styles: {
            position: 'relative',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
          },
          children: [
            {
              id: radioInputId,
              type: 'input',
              name: `${opt} radio`,
              styles: {
                position: 'relative',
                flex: '0 0 auto',
                width: '16px',
                height: '16px',
              },
              attrs: {
                ...commonAttrs,
                type: 'radio',
                value: opt,
              },
            },
            {
              id: context.createId(`${input.name}-text`),
              type: 'span',
              name: 'Option text',
              styles: {
                position: 'relative',
                fontSize: '14px',
              },
              textContent: opt,
            },
          ],
        };
        return rowDef;
      });

      fieldWrapperDef = {
        id: fieldId,
        type: 'div',
        name: `${input.label} field`,
        styles: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%',
        },
        children: [
          {
            id: labelId,
            type: 'span',
            name: 'Group Label',
            styles: {
              position: 'relative',
              fontSize: '14px',
              fontWeight: '500',
            },
            textContent: input.label,
          },
          ...radioOptions,
        ],
      };
    } else if (input.type === 'select') {
      const optionNodes: AddNodeDef[] = [];
      if (input.placeholder) {
        optionNodes.push({
          id: context.createId(`${input.name}-placeholder`),
          type: 'option',
          name: 'Placeholder',
          styles: {},
          attrs: {
            value: '',
            disabled: 'true',
            selected: 'true',
          },
          textContent: input.placeholder,
        });
      }
      for (const opt of input.options ?? []) {
        optionNodes.push({
          id: context.createId(`${input.name}-opt`),
          type: 'option',
          name: opt,
          styles: {},
          attrs: { value: opt },
          textContent: opt,
        });
      }

      fieldWrapperDef = {
        id: fieldId,
        type: 'div',
        name: `${input.label} field`,
        styles: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          width: '100%',
        },
        children: [
          {
            id: labelId,
            type: 'label',
            name: 'Label',
            styles: {
              position: 'relative',
              fontSize: '14px',
              fontWeight: '500',
            },
            attrs: {
              htmlFor: controlId!,
            },
            textContent: input.label,
          },
          {
            id: controlId!,
            type: 'select',
            name: `${input.label} select`,
            styles: {
              position: 'relative',
              width: '100%',
              padding: '10px 12px',
              fontSize: '14px',
              borderRadius: '8px',
              border: '1px solid #d4d4d8',
              backgroundColor: '#ffffff',
            },
            attrs: {
              ...commonAttrs,
              id: controlId!,
            },
            children: optionNodes,
          },
        ],
      };
    } else if (input.type === 'textarea') {
      fieldWrapperDef = {
        id: fieldId,
        type: 'div',
        name: `${input.label} field`,
        styles: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          width: '100%',
        },
        children: [
          {
            id: labelId,
            type: 'label',
            name: 'Label',
            styles: {
              position: 'relative',
              fontSize: '14px',
              fontWeight: '500',
            },
            attrs: {
              htmlFor: controlId!,
            },
            textContent: input.label,
          },
          {
            id: controlId!,
            type: 'textarea',
            name: `${input.label} textarea`,
            styles: {
              position: 'relative',
              width: '100%',
              minHeight: '120px',
              padding: '10px 12px',
              fontSize: '14px',
              borderRadius: '8px',
              border: '1px solid #d4d4d8',
              backgroundColor: '#ffffff',
              resize: 'vertical',
            },
            attrs: {
              ...commonAttrs,
              id: controlId!,
              ...(input.placeholder ? { placeholder: input.placeholder } : {}),
            },
          },
        ],
      };
    } else {
      // Input tags: text, email, tel, url, number, password, date
      fieldWrapperDef = {
        id: fieldId,
        type: 'div',
        name: `${input.label} field`,
        styles: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          width: '100%',
        },
        children: [
          {
            id: labelId,
            type: 'label',
            name: 'Label',
            styles: {
              position: 'relative',
              fontSize: '14px',
              fontWeight: '500',
            },
            attrs: {
              htmlFor: controlId!,
            },
            textContent: input.label,
          },
          {
            id: controlId!,
            type: 'input',
            name: `${input.label} input`,
            styles: {
              position: 'relative',
              width: '100%',
              padding: '10px 12px',
              fontSize: '14px',
              borderRadius: '8px',
              border: '1px solid #d4d4d8',
              backgroundColor: '#ffffff',
            },
            attrs: {
              ...commonAttrs,
              id: controlId!,
              type: input.type,
              ...(input.placeholder ? { placeholder: input.placeholder } : {}),
            },
          },
        ],
      };
    }

    code = addNodeInCode(code, input.parentId, fieldWrapperDef, input.index);
    projectFS.writeFile(input.filePath, code);

    trace.action('forms.field.add:inserted', {
      formId,
      fieldId,
      controlId,
      name: input.name,
      type: input.type,
      filePath: input.filePath,
    });

    return {
      formId,
      fieldId,
      labelId,
      controlId,
      name: input.name,
      type: input.type,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 2. forms.field.remove ───────────────────────────────────────────────────

export const formsFieldRemoveOperation: Operation<
  { filePath: string; fieldId: string },
  { fieldId: string; changes: FileChange[] }
> = {
  name: 'forms.field.remove',
  description: 'Remove a form field wrapper, label, and control from JSX source',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: z.object({
    filePath: z.string().min(1),
    fieldId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    if (!nodes.has(input.fieldId)) {
      throw new Error(`NODE_NOT_FOUND: Node with id "${input.fieldId}" not found in "${input.filePath}"`);
    }

    code = removeNodeInCode(code, input.fieldId);
    code = removeSelectCaretRuleInCode(code, input.fieldId);
    projectFS.writeFile(input.filePath, code);

    trace.action('forms.field.remove:removed', { fieldId: input.fieldId, filePath: input.filePath });

    return {
      fieldId: input.fieldId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 3. forms.selectCaret.set ────────────────────────────────────────────────

export const formsSelectCaretSetOperation: Operation<
  { filePath: string; nodeId: string; cssBody: string | null },
  { nodeId: string; changes: FileChange[] }
> = {
  name: 'forms.selectCaret.set',
  description: 'Update or inject a custom select[data-id="..."] CSS caret rule into the page <style> block',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: z.object({
    filePath: z.string().min(1),
    nodeId: z.string().min(1),
    cssBody: z.string().nullable(),
  }),
  async execute(snapshot, input) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    if (!nodes.has(input.nodeId)) {
      throw new Error(`NODE_NOT_FOUND: Node with id "${input.nodeId}" not found in "${input.filePath}"`);
    }

    code = updateSelectCaretRuleInCode(code, input.nodeId, input.cssBody);
    projectFS.writeFile(input.filePath, code);

    trace.action('forms.selectCaret.set:updated', { nodeId: input.nodeId, removed: input.cssBody === null });

    return {
      nodeId: input.nodeId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 4. forms.submitButton.add ───────────────────────────────────────────────

export const formsSubmitButtonAddOperation: Operation<
  { filePath: string; parentId: string; label?: string; index?: number },
  { instanceId: string; formId: string; changes: FileChange[] }
> = {
  name: 'forms.submitButton.add',
  description: 'Ensure FormSubmit component exists and insert a multi-variant submit button instance inside a <form>',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: z.object({
    filePath: z.string().min(1),
    parentId: z.string().min(1),
    label: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  async execute(snapshot, input, context) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);

    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const parent = nodes.get(input.parentId);
    if (!parent) {
      throw new Error(`PARENT_NOT_FOUND: Parent node "${input.parentId}" not found in "${input.filePath}"`);
    }

    const formId = parent.type === 'form' || parent.type === 'motion.form'
      ? parent.id
      : enclosingFormIdInCode(code, input.parentId);

    if (!formId) {
      throw new Error(`NOT_IN_FORM: Parent node "${input.parentId}" is not inside any <form>`);
    }

    // Ensure components/FormSubmit.tsx and components/Spinner.tsx exist
    ensureFormSubmitComponentFile();
    ensureFormSubmitSpinnerFile();

    code = ensureComponentImport(code, 'FormSubmit');

    const instanceId = context.createId('submit-btn');
    const nodeDef: AddNodeDef = {
      id: instanceId,
      type: 'FormSubmit',
      name: 'Submit',
      styles: {
        width: '100%',
      },
      attrs: {
        label: input.label ?? 'Submit',
      },
    };

    code = addNodeInCode(code, input.parentId, nodeDef, input.index);

    // Wire default form lifecycle state mapping and hook
    const stateVar = formStateVar(formId);
    code = setFormStateMappingInCode(code, instanceId, stateVar, DEFAULT_FORM_STATE_MAPPING);
    code = wireFormSubmitInCode(code, formId, formStateSetter(stateVar));

    projectFS.writeFile(input.filePath, code);

    trace.action('forms.submitButton.add:inserted', { instanceId, formId, filePath: input.filePath });

    return {
      instanceId,
      formId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 5. forms.field.update ───────────────────────────────────────────────────

export const formsFieldUpdateOperation: Operation<
  {
    filePath: string;
    fieldId: string;
    label?: string;
    placeholder?: string;
    required?: boolean;
    name?: string;
  },
  { fieldId: string; changes: FileChange[] }
> = {
  name: 'forms.field.update',
  description: 'Update form field label text, placeholder, required validation, or submission name',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: z.object({
    filePath: z.string().min(1),
    fieldId: z.string().min(1),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    name: z.string().regex(/^[a-zA-Z][\w-]*$/).optional(),
  }),
  async execute(snapshot, input) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const wrapper = nodes.get(input.fieldId);
    if (!wrapper) {
      throw new Error(`NODE_NOT_FOUND: Field node "${input.fieldId}" not found in "${input.filePath}"`);
    }

    // If label text update is requested, find the child label/span
    if (input.label !== undefined) {
      for (const childId of wrapper.children) {
        const child = nodes.get(childId);
        if (child && (child.type === 'label' || child.type === 'span')) {
          code = updateNodeInCode(code, child.id, {});
          // Replace textContent in label
          const idIdx = code.indexOf(`data-id="${child.id}"`);
          if (idIdx !== -1) {
            const closeTag = code.indexOf('</', idIdx);
            const openTagEnd = code.indexOf('>', idIdx);
            if (openTagEnd !== -1 && closeTag !== -1 && openTagEnd < closeTag) {
              code = code.slice(0, openTagEnd + 1) + input.label + code.slice(closeTag);
            }
          }
          break;
        }
      }
    }

    // If control attributes update is requested, find child control
    if (input.placeholder !== undefined || input.required !== undefined || input.name !== undefined) {
      for (const childId of wrapper.children) {
        const child = nodes.get(childId);
        if (child && (child.type === 'input' || child.type === 'textarea' || child.type === 'select')) {
          const attrsToUpdate: Record<string, string> = {};
          if (input.name !== undefined) attrsToUpdate.name = input.name;
          if (input.placeholder !== undefined) attrsToUpdate.placeholder = input.placeholder;
          if (input.required !== undefined) {
            attrsToUpdate.required = input.required ? 'true' : '';
            attrsToUpdate['aria-required'] = input.required ? 'true' : '';
          }
          code = updateHtmlAttrsInCode(code, child.id, attrsToUpdate);
          break;
        }
      }
    }

    projectFS.writeFile(input.filePath, code);
    return {
      fieldId: input.fieldId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(formsFieldAddOperation);
defaultRegistry.register(formsFieldRemoveOperation);
defaultRegistry.register(formsSelectCaretSetOperation);
defaultRegistry.register(formsSubmitButtonAddOperation);
defaultRegistry.register(formsFieldUpdateOperation);

// Compatibility aliases
defaultRegistry.registerAlias('form-fields.add', 'forms.field.add');
defaultRegistry.registerAlias('forms.field.create', 'forms.field.add');
defaultRegistry.registerAlias('form-fields.remove', 'forms.field.remove');
defaultRegistry.registerAlias('forms.field.delete', 'forms.field.remove');
defaultRegistry.registerAlias('forms.caret.set', 'forms.selectCaret.set');
defaultRegistry.registerAlias('forms.selectCaret.update', 'forms.selectCaret.set');
defaultRegistry.registerAlias('forms.submit.add', 'forms.submitButton.add');
defaultRegistry.registerAlias('forms.button.add', 'forms.submitButton.add');
defaultRegistry.registerAlias('forms.submitButton.create', 'forms.submitButton.add');
defaultRegistry.registerAlias('form-fields.update', 'forms.field.update');
