// packages/automation-core/src/operations/forms.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { addNodeInCode, removeNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { updateHtmlAttrsInCode } from '@/code/generation/generator-attrs';
import {
  ensureFormRouteFile,
  wireFormSubmitInCode,
} from '@/code/generation/form-gen';
import {
  readFormConfig,
  serializeFormConfig,
  newDestId,
  type FormConfig,
  type FormDestination,
} from '@/editor/tools/FormTool/form-config';
import { trace } from '@/shared/debug-trace';
import { insertAfterLastImportLine } from '@/code/generation/generator-utils';

// Synchronize Snapshot files to ProjectFS before running an operation,
// and collect any added, modified, or deleted files as FileChange[].
export function syncFormsSnapshotToProjectFS(snapshot?: Snapshot): {
  collectChanges: () => FileChange[];
} {
  const beforeFiles = new Map<string, string>();
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) {
      beforeFiles.set(path, content);
    }
  }
  if (snapshot && snapshot.files.size > 0) {
    for (const [path, content] of snapshot.files) {
      beforeFiles.set(path, content);
      if (projectFS.readFile(path) !== content) {
        projectFS.writeFile(path, content);
      }
    }
  }

  return {
    collectChanges() {
      const changes: FileChange[] = [];
      const currentPaths = new Set(projectFS.listFiles());

      for (const path of currentPaths) {
        const currentContent = projectFS.readFile(path);
        const beforeContent = beforeFiles.get(path);
        if (currentContent !== null && currentContent !== beforeContent) {
          changes.push({
            path,
            beforeHash: null,
            content: currentContent,
          });
        }
      }

      for (const [path] of beforeFiles) {
        if (!currentPaths.has(path)) {
          changes.push({
            path,
            beforeHash: null,
            content: null,
          });
        }
      }

      // Automatically keep in-memory snapshot in sync for sequential operations
      if (snapshot && 'set' in snapshot.files) {
        const map = snapshot.files as Map<string, string>;
        for (const c of changes) {
          if (c.content === null) {
            map.delete(c.path);
          } else {
            map.set(c.path, c.content);
          }
        }
      }

      return changes;
    },
  };
}

function ensureMotionImport(code: string): string {
  if (code.includes('framer-motion')) return code;
  return insertAfterLastImportLine(code, "import { motion } from 'framer-motion';") ?? code;
}

// ─── 1. forms.create ──────────────────────────────────────────────────────────

export const formsCreateInputSchema = z.object({
  filePath: z.string().min(1),
  parentId: z.string().min(1),
  name: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
  motion: z.boolean().optional(),
});

export type FormsCreateInput = z.infer<typeof formsCreateInputSchema>;

export const formsCreateOperation: Operation<
  FormsCreateInput,
  {
    formId: string;
    changes: FileChange[];
  }
> = {
  name: 'forms.create',
  description: 'Create a <form> or <motion.form> node with flex column layout, 16px gap, and width 100%',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: formsCreateInputSchema,
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

    const formId = context.createId('form');
    const isMotion = input.motion === true;
    const tagName = isMotion ? 'motion.form' : 'form';

    if (isMotion) {
      code = ensureMotionImport(code);
    }

    const nodeDef: AddNodeDef = {
      id: formId,
      type: tagName,
      name: input.name ?? 'Contact Form',
      styles: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
      },
      attrs: {
        'data-form': serializeFormConfig({ sendTo: [] }),
      },
    };

    code = addNodeInCode(code, input.parentId, nodeDef, input.index);

    // Wire inline onSubmit handler and ensure relay route file exists
    code = wireFormSubmitInCode(code, formId);
    ensureFormRouteFile();

    projectFS.writeFile(input.filePath, code);
    trace.action('forms.create:inserted', { formId, filePath: input.filePath, parentId: input.parentId, isMotion });

    return {
      formId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 2. forms.destination.set ────────────────────────────────────────────────

export const emailDestinationSchema = z.object({
  recipient: z.string().email('Invalid email address format'),
  subject: z.string().optional(),
  name: z.string().optional(),
});

export const webhookDestinationSchema = z.object({
  url: z.string().url('Invalid URL format').refine(u => u.startsWith('https://'), 'Webhooks must use HTTPS'),
  secret: z.string().optional(),
});

export const formsDestinationSetInputSchema = z.object({
  filePath: z.string().min(1),
  nodeId: z.string().min(1), // Target form node
  emails: z.array(emailDestinationSchema).optional(),
  webhooks: z.array(webhookDestinationSchema).optional(),
  redirect: z.string().optional(),
  antispam: z.enum(['block', 'pass', 'off']).optional(),
});

export type FormsDestinationSetInput = z.infer<typeof formsDestinationSetInputSchema>;

export const formsDestinationSetOperation: Operation<
  FormsDestinationSetInput,
  {
    formId: string;
    sendToCount: number;
    redirect?: string;
    antispam: string;
    changes: FileChange[];
  }
> = {
  name: 'forms.destination.set',
  description: 'Configure SendTo destinations (emails, webhooks), redirect URL, and antispam for a form',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: formsDestinationSetInputSchema,
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

    if (node.type !== 'form' && node.type !== 'motion.form') {
      throw new Error(`NOT_A_FORM: Node "${input.nodeId}" is a <${node.type}>, not a <form>`);
    }

    const hasEmails = input.emails && input.emails.length > 0;
    const hasWebhooks = input.webhooks && input.webhooks.length > 0;
    if (!hasEmails && !hasWebhooks) {
      throw new Error('DESTINATION_REQUIRED: A form needs at least one destination (emails or webhooks)');
    }

    const destinations: FormDestination[] = [];
    for (const e of input.emails ?? []) {
      destinations.push({
        id: newDestId(),
        type: 'email',
        recipient: e.recipient,
        ...(e.subject ? { subject: e.subject } : {}),
        ...(e.name ? { name: e.name } : {}),
      });
    }

    for (const w of input.webhooks ?? []) {
      destinations.push({
        id: newDestId(),
        type: 'webhook',
        url: w.url,
        ...(w.secret ? { secret: w.secret } : {}),
      });
    }

    const antispamFiltering = input.antispam ?? 'block';
    const config: FormConfig = {
      sendTo: destinations,
      ...(typeof input.redirect === 'string' && input.redirect !== '' ? { redirect: input.redirect } : {}),
      antispam: antispamFiltering === 'off' ? null : { mode: 'basic', filtering: antispamFiltering },
    };

    const serialized = serializeFormConfig(config);
    code = updateHtmlAttrsInCode(code, input.nodeId, { 'data-form': serialized });

    // Make sure form relay route and submit handler are present
    ensureFormRouteFile();
    code = wireFormSubmitInCode(code, input.nodeId);

    projectFS.writeFile(input.filePath, code);
    trace.action('forms.destination.set:updated', { formId: input.nodeId, destinations: destinations.length, antispam: antispamFiltering });

    return {
      formId: input.nodeId,
      sendToCount: destinations.length,
      redirect: config.redirect,
      antispam: antispamFiltering,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 3. forms.destination.get ────────────────────────────────────────────────

export const formsDestinationGetInputSchema = z.object({
  filePath: z.string().min(1),
  nodeId: z.string().min(1),
});

export type FormsDestinationGetInput = z.infer<typeof formsDestinationGetInputSchema>;

export const formsDestinationGetOperation: Operation<
  FormsDestinationGetInput,
  {
    formId: string;
    sendTo: Array<{ id: string; type: 'email' | 'webhook'; recipient?: string; url?: string; subject?: string; name?: string; secret?: string }>;
    redirect?: string;
    antispam: { mode: string; filtering: string } | null;
  }
> = {
  name: 'forms.destination.get',
  description: 'Retrieve SendTo destination configuration, redirect URL, and antispam mode from form node',
  category: 'forms',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: formsDestinationGetInputSchema,
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

    if (node.type !== 'form' && node.type !== 'motion.form') {
      throw new Error(`NOT_A_FORM: Node "${input.nodeId}" is a <${node.type}>, not a <form>`);
    }

    const config = readFormConfig(node.attrs?.['data-form']);
    const sendTo = config.sendTo.map(d => ({
      id: d.id,
      type: d.type as 'email' | 'webhook',
      ...(d.type === 'email' ? { recipient: d.recipient, subject: d.subject, name: d.name } : {}),
      ...(d.type === 'webhook' ? { url: d.url, secret: d.secret } : {}),
    }));

    return {
      formId: input.nodeId,
      sendTo,
      redirect: config.redirect,
      antispam: config.antispam ?? null,
    };
  },
};

// ─── 4. forms.delete ─────────────────────────────────────────────────────────

export const formsDeleteOperation: Operation<
  { filePath: string; formId: string },
  { formId: string; changes: FileChange[] }
> = {
  name: 'forms.delete',
  description: 'Delete a <form> container and all its fields and child nodes',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: z.object({
    filePath: z.string().min(1),
    formId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    if (!nodes.has(input.formId)) {
      throw new Error(`NODE_NOT_FOUND: Form with id "${input.formId}" not found in "${input.filePath}"`);
    }

    code = removeNodeInCode(code, input.formId);
    projectFS.writeFile(input.filePath, code);

    return {
      formId: input.formId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 5. forms.honeypot.add ───────────────────────────────────────────────────

export const formsHoneypotAddOperation: Operation<
  { filePath: string; formId: string },
  { fieldId: string; formId: string; changes: FileChange[] }
> = {
  name: 'forms.honeypot.add',
  description: 'Add an anti-spam honeypot input (_hp) to a form',
  category: 'forms',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T19',
  inputSchema: z.object({
    filePath: z.string().min(1),
    formId: z.string().min(1),
  }),
  async execute(snapshot, input, context) {
    const sync = syncFormsSnapshotToProjectFS(snapshot);
    let code = projectFS.readFile(input.filePath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found`);
    }

    const nodes = parseJSXToNodes(code);
    const formNode = nodes.get(input.formId);
    if (!formNode || (formNode.type !== 'form' && formNode.type !== 'motion.form')) {
      throw new Error(`NOT_A_FORM: Target node "${input.formId}" is not a <form>`);
    }

    const fieldId = context.createId('hp');
    const nodeDef: AddNodeDef = {
      id: fieldId,
      type: 'input',
      name: 'Honeypot',
      styles: {
        display: 'none',
        position: 'absolute',
        opacity: '0',
        pointerEvents: 'none',
      },
      attrs: {
        type: 'text',
        name: '_hp',
        tabIndex: '-1',
        autoComplete: 'off',
        'aria-hidden': 'true',
      },
    };

    code = addNodeInCode(code, input.formId, nodeDef);
    projectFS.writeFile(input.filePath, code);

    return {
      fieldId,
      formId: input.formId,
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(formsCreateOperation);
defaultRegistry.register(formsDestinationSetOperation);
defaultRegistry.register(formsDestinationGetOperation);
defaultRegistry.register(formsDeleteOperation);
defaultRegistry.register(formsHoneypotAddOperation);

// Compatibility aliases
defaultRegistry.registerAlias('forms.add', 'forms.create');
defaultRegistry.registerAlias('forms.container.create', 'forms.create');
defaultRegistry.registerAlias('forms.destinations.set', 'forms.destination.set');
defaultRegistry.registerAlias('forms.config.set', 'forms.destination.set');
defaultRegistry.registerAlias('forms.configure', 'forms.destination.set');
defaultRegistry.registerAlias('forms.destination.add', 'forms.destination.set');
defaultRegistry.registerAlias('forms.config.get', 'forms.destination.get');
defaultRegistry.registerAlias('forms.destinations.get', 'forms.destination.get');
