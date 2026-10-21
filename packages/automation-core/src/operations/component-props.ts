// packages/automation-core/src/operations/component-props.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  createVariableInCode,
  removeVariableInCode,
  renameComponentVariableInCode,
} from '@/code/features/variable-ops';
import {
  parsePropMeta,
  setPropTypeInCode,
  setPropLabelInCode,
  setPropDescriptionInCode,
  setPropOptionsInCode,
  setPropNumberMetaInCode,
  removePropMetaInCode,
} from '@/code/components/prop-meta';
import {
  findInstanceTag,
  removeInstanceProp,
} from '@/code/components/instance-prop-overrides';
import {
  scanTagAttrs,
  writeTagAttr,
  formatStringAttr,
} from '@/code/components/jsx-tag-attrs';
import { addNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { ensureComponentImport } from './components';

// 1. components.instance.create
export const componentsInstanceCreateOperation: Operation<
  {
    componentName: string;
    targetFile: string;
    parentId: string;
    insertIndex?: number;
    props?: Record<string, unknown>;
    style?: Record<string, string>;
  },
  {
    changes: FileChange[];
    instanceId: string;
    componentName: string;
  }
> = {
  name: 'components.instance.create',
  description: 'Place an instance of a design component in a page or layout with initial props and styles',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    componentName: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Component name must be PascalCase'),
    targetFile: z.string().min(1),
    parentId: z.string().min(1),
    insertIndex: z.number().int().nonnegative().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    style: z.record(z.string(), z.string()).optional(),
  }),
  async execute(snapshot, input, context) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const componentPath = `components/${input.componentName}.tsx`;
    if (!snapshot.files.has(componentPath)) {
      throw new Error(`COMPONENT_NOT_FOUND: Component master "${input.componentName}" not found at "${componentPath}"`);
    }

    const instanceId = context.createId('inst');
    const def: AddNodeDef = {
      id: instanceId,
      type: input.componentName,
      styles: input.style ?? {},
    };

    code = addNodeInCode(code, input.parentId, def, input.insertIndex);
    code = ensureComponentImport(code, input.componentName);

    if (input.props && Object.keys(input.props).length > 0) {
      const tagRange = findInstanceTag(code, instanceId, input.componentName);
      if (tagRange) {
        let tagContent = code.slice(tagRange.tagStart, tagRange.tagEnd);
        for (const [propName, val] of Object.entries(input.props)) {
          if (val === '' || val === null || val === undefined) {
            const nextTag = writeTagAttr(tagContent, propName, null);
            if (nextTag !== null) tagContent = nextTag;
          } else if (typeof val === 'string') {
            const attrText = formatStringAttr(propName, val);
            const nextTag = writeTagAttr(tagContent, propName, attrText);
            if (nextTag !== null) tagContent = nextTag;
          } else if (typeof val === 'number' || typeof val === 'boolean') {
            const attrText = `${propName}={${val}}`;
            const nextTag = writeTagAttr(tagContent, propName, attrText);
            if (nextTag !== null) tagContent = nextTag;
          } else {
            const attrText = `${propName}={${JSON.stringify(val)}}`;
            const nextTag = writeTagAttr(tagContent, propName, attrText);
            if (nextTag !== null) tagContent = nextTag;
          }
        }
        code = code.slice(0, tagRange.tagStart) + tagContent + code.slice(tagRange.tagEnd);
      }
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      instanceId,
      componentName: input.componentName,
    };
  },
};

// 2. components.instance.props.get
export const componentsInstancePropsGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    nodeId: string;
    componentName: string;
    props: Record<string, unknown>;
  }
> = {
  name: 'components.instance.props.get',
  description: 'Read the current prop overrides configured on a component instance',
  category: 'components',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const tagMatch = code.match(new RegExp(`<([A-Z][A-Za-z0-9]*)[^>]*data-id="${input.nodeId}"[^>]*>`));
    if (!tagMatch) {
      throw new Error(`INSTANCE_NOT_FOUND: Component instance with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const componentName = tagMatch[1];
    const attrs = scanTagAttrs(tagMatch[0]) ?? [];
    const props: Record<string, unknown> = {};

    for (const a of attrs) {
      if (a.name === 'data-id' || a.name === 'data-name' || a.name === 'style') continue;
      if (a.value.kind === 'string') {
        props[a.name] = a.value.text;
      } else if (a.value.kind === 'expr') {
        try {
          props[a.name] = JSON.parse(a.value.source);
        } catch {
          props[a.name] = a.value.source;
        }
      } else if (a.value.kind === 'bare') {
        props[a.name] = true;
      }
    }

    return {
      nodeId: input.nodeId,
      componentName,
      props,
    };
  },
};

// 3. components.instance.props.set
export const componentsInstancePropsSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    props: Record<string, unknown>;
    vpId?: string;
  },
  {
    changes: FileChange[];
    updatedProps: Record<string, unknown>;
  }
> = {
  name: 'components.instance.props.set',
  description: 'Set or remove prop overrides on a component instance (empty string removes override, supports responsive viewports)',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    props: z.record(z.string(), z.unknown()),
    vpId: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const tagMatch = code.match(new RegExp(`<([A-Z][A-Za-z0-9]*)[^>]*data-id="${input.nodeId}"[^>]*>`));
    if (!tagMatch) {
      throw new Error(`INSTANCE_NOT_FOUND: Component instance with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const componentName = tagMatch[1];
    const tagRange = findInstanceTag(code, input.nodeId, componentName);
    if (!tagRange) {
      throw new Error(`INSTANCE_TAG_NOT_FOUND: Opening tag for "${input.nodeId}" not found`);
    }

    let tagContent = code.slice(tagRange.tagStart, tagRange.tagEnd);

    for (const [propName, val] of Object.entries(input.props)) {
      // Invariant 3: empty string means remove property
      if (val === '' || val === null || val === undefined) {
        const nextTag = writeTagAttr(tagContent, propName, null);
        if (nextTag !== null) tagContent = nextTag;
      } else if (typeof val === 'string') {
        const attrText = formatStringAttr(propName, val);
        const nextTag = writeTagAttr(tagContent, propName, attrText);
        if (nextTag !== null) tagContent = nextTag;
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        const attrText = `${propName}={${val}}`;
        const nextTag = writeTagAttr(tagContent, propName, attrText);
        if (nextTag !== null) tagContent = nextTag;
      } else {
        const attrText = `${propName}={${JSON.stringify(val)}}`;
        const nextTag = writeTagAttr(tagContent, propName, attrText);
        if (nextTag !== null) tagContent = nextTag;
      }
    }

    const nextCode = code.slice(0, tagRange.tagStart) + tagContent + code.slice(tagRange.tagEnd);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      updatedProps: input.props,
    };
  },
};

// 4. components.variables.create
export const componentsVariablesCreateOperation: Operation<
  {
    componentFile: string;
    nodeId: string;
    property: string;
    propName: string;
    defaultValue?: string;
    propType?: string;
    label?: string;
    description?: string;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
  },
  {
    changes: FileChange[];
    propName: string;
  }
> = {
  name: 'components.variables.create',
  description: 'Create a component variable binding in master, hoisting node style/prop to component signature with metadata',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.string().min(1),
    propName: z.string().min(1),
    defaultValue: z.string().optional(),
    propType: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    options: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    code = createVariableInCode(code, input.nodeId, input.property, input.propName, input.defaultValue);

    if (input.propType) {
      code = setPropTypeInCode(code, input.propName, input.propType);
    }
    if (input.label) {
      code = setPropLabelInCode(code, input.propName, input.label);
    }
    if (input.description) {
      code = setPropDescriptionInCode(code, input.propName, input.description);
    }
    if (input.options && input.options.length > 0) {
      code = setPropOptionsInCode(code, input.propName, input.options);
    }
    if (input.min !== undefined || input.max !== undefined || input.step !== undefined) {
      code = setPropNumberMetaInCode(code, input.propName, {
        min: input.min,
        max: input.max,
        step: input.step,
      });
    }

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: code,
        },
      ],
      propName: input.propName,
    };
  },
};

// 5. components.variables.rename
export const componentsVariablesRenameOperation: Operation<
  {
    componentFile: string;
    oldName: string;
    newName: string;
    updateInstances?: boolean;
  },
  {
    changes: FileChange[];
    oldName: string;
    newName: string;
    updatedInstances: number;
  }
> = {
  name: 'components.variables.rename',
  description: 'Rename a component prop/variable in master file and cascade update all instances project-wide',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    oldName: z.string().min(1),
    newName: z.string().min(1),
    updateInstances: z.boolean().optional().default(true),
  }),
  async execute(snapshot, input) {
    let masterCode = snapshot.files.get(input.componentFile);
    if (!masterCode) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    masterCode = renameComponentVariableInCode(masterCode, input.oldName, input.newName);

    // Update @propMeta if oldName exists
    const meta = parsePropMeta(masterCode);
    if (meta[input.oldName]) {
      const entry = meta[input.oldName];
      masterCode = removePropMetaInCode(masterCode, input.oldName);
      if (entry.type) masterCode = setPropTypeInCode(masterCode, input.newName, entry.type);
      if (entry.label) masterCode = setPropLabelInCode(masterCode, input.newName, entry.label);
      if (entry.description) masterCode = setPropDescriptionInCode(masterCode, input.newName, entry.description);
      if (entry.options) masterCode = setPropOptionsInCode(masterCode, input.newName, entry.options, entry.optionsLocked);
    }

    const changes: FileChange[] = [
      {
        path: input.componentFile,
        beforeHash: null,
        content: masterCode,
      },
    ];

    let updatedInstances = 0;
    if (input.updateInstances) {
      // Find component name from file path: components/Card.tsx -> Card
      const compNameMatch = input.componentFile.match(/\/([A-Z][A-Za-z0-9]*)\.tsx$/);
      if (compNameMatch) {
        const compName = compNameMatch[1];
        const attrRegex = new RegExp(`(<${compName}[^>]*\\b)${input.oldName}=`, 'g');

        for (const [filePath, content] of snapshot.files.entries()) {
          if (filePath === input.componentFile) continue;
          if (!content.includes(`<${compName}`)) continue;

          let fileHits = 0;
          const nextContent = content.replace(attrRegex, (_m, prefix) => {
            fileHits++;
            return `${prefix}${input.newName}=`;
          });

          if (fileHits > 0) {
            updatedInstances += fileHits;
            changes.push({
              path: filePath,
              beforeHash: null,
              content: nextContent,
            });
          }
        }
      }
    }

    return {
      changes,
      oldName: input.oldName,
      newName: input.newName,
      updatedInstances,
    };
  },
};

// 6. components.variables.remove
export const componentsVariablesRemoveOperation: Operation<
  {
    componentFile: string;
    nodeId: string;
    property: string;
    propName: string;
    defaultValue?: string;
  },
  {
    changes: FileChange[];
    removedProp: string;
  }
> = {
  name: 'components.variables.remove',
  description: 'Unbind a component variable, remove it from master signature, and strip the prop from all instances',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.string().min(1),
    propName: z.string().min(1),
    defaultValue: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let masterCode = snapshot.files.get(input.componentFile);
    if (!masterCode) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    masterCode = removeVariableInCode(
      masterCode,
      input.nodeId,
      input.property,
      input.propName,
      input.defaultValue ?? '',
      true, // deleteProp from signature
    );

    masterCode = removePropMetaInCode(masterCode, input.propName);

    const changes: FileChange[] = [
      {
        path: input.componentFile,
        beforeHash: null,
        content: masterCode,
      },
    ];

    // Strip prop from instances across project
    const compNameMatch = input.componentFile.match(/\/([A-Z][A-Za-z0-9]*)\.tsx$/);
    if (compNameMatch) {
      const compName = compNameMatch[1];
      for (const [filePath, content] of snapshot.files.entries()) {
        if (filePath === input.componentFile) continue;
        if (!content.includes(`<${compName}`)) continue;

        let nextContent = removeInstanceProp(content, input.nodeId, compName, input.propName);
        if (nextContent !== content) {
          changes.push({
            path: filePath,
            beforeHash: null,
            content: nextContent,
          });
        }
      }
    }

    return {
      changes,
      removedProp: input.propName,
    };
  },
};

// Register component props operations
defaultRegistry.register(componentsInstanceCreateOperation);
defaultRegistry.register(componentsInstancePropsGetOperation);
defaultRegistry.register(componentsInstancePropsSetOperation);
defaultRegistry.register(componentsVariablesCreateOperation);
defaultRegistry.register(componentsVariablesRenameOperation);
defaultRegistry.register(componentsVariablesRemoveOperation);
