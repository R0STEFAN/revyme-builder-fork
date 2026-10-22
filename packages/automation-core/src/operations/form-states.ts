// packages/automation-core/src/operations/form-states.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { parseJSXToNodes } from '@/code/parsing/parser';
import {
  FORM_STATES,
  type FormState,
  type FormStateMapping,
  formStateVar,
  formStateSetter,
  enclosingFormIdInCode,
  setFormStateMappingInCode,
  parseFormStateMapping,
} from '@/code/generation/form-state-gen';
import { wireFormSubmitInCode } from '@/code/generation/form-gen';
import { syncFormsSnapshotToProjectFS } from './forms';
import { trace } from '@/shared/debug-trace';

// ─── 1. forms.state.map ──────────────────────────────────────────────────────

export const formStateMapSchema = z
  .object({
    loading: z.string().optional(),
    success: z.string().optional(),
    error: z.string().optional(),
    disabled: z.string().optional(),
  })
  .refine(
    (s) => Object.values(s).some((v) => v !== undefined && v !== ''),
    'At least one state mapping required',
  );

export const formsStateMapInputSchema = z.object({
  filePath: z.string().min(1),
  nodeId: z.string().min(1), // submit button instance ID
  states: formStateMapSchema,
});

export type FormsStateMapInput = z.infer<typeof formsStateMapInputSchema>;

export const formsStateMapOperation: Operation<
  FormsStateMapInput,
  {
    nodeId: string;
    formId: string;
    states: Record<string, string>;
    changes: FileChange[];
  }
> = {
  name: 'forms.state.map',
  description: 'Map submit button instance variants to form lifecycle states (loading, success, error, disabled)',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: formsStateMapInputSchema,
  async execute(snapshot, input) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);

    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const node = nodes.get(input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node with id "${input.nodeId}" not found in "${input.filePath}"`);
    }

    // Must be inside a form
    const formId = enclosingFormIdInCode(code, input.nodeId);
    if (!formId) {
      throw new Error(`NOT_IN_FORM: Node "${input.nodeId}" is not inside any <form>`);
    }

    // Must be a component instance (tag starts with uppercase letter)
    const firstChar = node.type.charAt(0);
    const isComponentInstance = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
    if (!isComponentInstance) {
      throw new Error(`NOT_A_COMPONENT_INSTANCE: Node "${input.nodeId}" is a <${node.type}>, not a component instance`);
    }

    const mapping: FormStateMapping = {};
    for (const s of FORM_STATES) {
      const val = input.states[s];
      if (val !== undefined && val !== '') {
        mapping[s] = val;
      }
    }

    if (Object.keys(mapping).length === 0) {
      throw new Error('NO_VALID_STATES: At least one non-empty variant mapping is required');
    }

    const stateVar = formStateVar(formId);
    code = setFormStateMappingInCode(code, input.nodeId, stateVar, mapping);
    code = wireFormSubmitInCode(code, formId, formStateSetter(stateVar));

    projectFS.writeFile(input.filePath, code);

    trace.action('forms.state.map:configured', {
      nodeId: input.nodeId,
      formId,
      states: mapping,
      filePath: input.filePath,
    });

    return {
      nodeId: input.nodeId,
      formId,
      states: mapping as Record<string, string>,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 2. forms.state.get ──────────────────────────────────────────────────────

export const formsStateGetInputSchema = z.object({
  filePath: z.string().min(1),
  nodeId: z.string().min(1),
});

export type FormsStateGetInput = z.infer<typeof formsStateGetInputSchema>;

export const formsStateGetOperation: Operation<
  FormsStateGetInput,
  {
    nodeId: string;
    formId: string;
    states: Record<string, string>;
  }
> = {
  name: 'forms.state.get',
  description: 'Retrieve form lifecycle state mapping from a component instance node inside a <form>',
  category: 'forms',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: formsStateGetInputSchema,
  async execute(snapshot, input) {
    const code = projectFS.readFile(input.filePath) ?? snapshot.files.get(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const node = nodes.get(input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node with id "${input.nodeId}" not found in "${input.filePath}"`);
    }

    const formId = enclosingFormIdInCode(code, input.nodeId);
    if (!formId) {
      throw new Error(`NOT_IN_FORM: Node "${input.nodeId}" is not inside any <form>`);
    }

    const mapping = parseFormStateMapping(code, input.nodeId);

    return {
      nodeId: input.nodeId,
      formId,
      states: mapping as Record<string, string>,
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(formsStateMapOperation);
defaultRegistry.register(formsStateGetOperation);

// Compatibility aliases
defaultRegistry.registerAlias('forms.state.set', 'forms.state.map');
defaultRegistry.registerAlias('forms.states.set', 'forms.state.map');
defaultRegistry.registerAlias('form-states.configure', 'forms.state.map');
defaultRegistry.registerAlias('forms.state.configure', 'forms.state.map');
defaultRegistry.registerAlias('forms.states.get', 'forms.state.get');
defaultRegistry.registerAlias('form-states.get', 'forms.state.get');
