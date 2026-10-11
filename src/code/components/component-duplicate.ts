// component-duplicate.ts — Clones design and code components with clean ID and reference remapping.
import { projectFS } from '@/code/project/project-fs';
import { flushNow, validateGeneratedCode } from '@/code/mutation/mutation-queue';
import {
  generateInternalName,
  setComponentName,
  parseComponentName,
  getComponentExportName,
} from './component-ops';
import { getFileDisplayName } from '@/code/project/active-file-store';
import { hasComponentControls } from './controls-parser';
import {
  generateNodeId,
  nodeIdToVarName,
  nodeIdToVarNameCapitalised,
} from '@/shared/id-utils';
import { slotConstName } from '@/code/generation/slot-ops';
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { escapeRegExp } from '@/shared/regex-utils';
import { checkFile } from '@/code/oracle/check-file';
import { captureHistoryFileOpBefore, pushHistoryFileOp } from '@/code/mutation/history';
import { clearComponentCache } from './component-registry';
import { triggerAutosave } from '@/backend/autosave';
import { trace } from '@/shared/debug-trace';

/**
 * Generate a unique display name for a duplicated component (e.g. "Card Copy", "Card Copy 2").
 */
export function generateDuplicateDisplayName(originalName: string, existingNames: Set<string>): string {
  const match = originalName.match(/^(.*?)(?:\s+Copy(?:\s+(\d+))?)?$/);
  const basePrefix = match && match[1] && match[1].trim() ? match[1].trim() : originalName.trim();
  const copyBase = `${basePrefix} Copy`;
  if (!existingNames.has(copyBase)) {
    return copyBase;
  }
  let counter = 2;
  while (existingNames.has(`${copyBase} ${counter}`)) {
    counter++;
  }
  return `${copyBase} ${counter}`;
}

/**
 * Transform code for duplicating a code component.
 * Preserves controls, docblocks, comments, and updates label, function, and export identifiers.
 */
export function duplicateCodeComponentSource(
  sourceCode: string,
  newInternalName: string,
  newDisplayName: string,
): { code: string } {
  let code = setComponentName(sourceCode, newDisplayName);
  const oldExport = getComponentExportName(sourceCode);
  if (oldExport && oldExport !== newInternalName) {
    code = code.replace(
      new RegExp(`\\bfunction\\s+${escapeRegExp(oldExport)}\\b`, 'g'),
      `function ${newInternalName}`,
    );
    code = code.replace(
      new RegExp(`\\bwithResponsiveProps\\(\\s*${escapeRegExp(oldExport)}\\s*\\)`, 'g'),
      `withResponsiveProps(${newInternalName})`,
    );
    code = code.replace(
      new RegExp(`\\bexport\\s+default\\s+${escapeRegExp(oldExport)}\\b`, 'g'),
      `export default ${newInternalName}`,
    );
    code = code.replace(
      new RegExp(`\\bconst\\s+${escapeRegExp(oldExport)}\\s*=`, 'g'),
      `const ${newInternalName} =`,
    );
  }
  return { code };
}

/**
 * Transform code for duplicating a design component.
 * Remaps all node IDs, slot declarations and references, variant consts and references,
 * effect variable references, and updates component function name and primary label.
 */
export function duplicateDesignComponentSource(
  sourceCode: string,
  newInternalName: string,
  newDisplayName: string,
): { code: string; idMap: Map<string, string> } {
  let code = setComponentName(sourceCode, newDisplayName);
  const oldDisplayName = parseComponentName(sourceCode) || '';
  const oldExport = getComponentExportName(sourceCode);

  // 1. Rename export function and default export
  if (oldExport && oldExport !== newInternalName) {
    code = code.replace(
      new RegExp(`\\bfunction\\s+${escapeRegExp(oldExport)}\\b`, 'g'),
      `function ${newInternalName}`,
    );
    code = code.replace(
      new RegExp(`\\bwithResponsiveProps\\(\\s*${escapeRegExp(oldExport)}\\s*\\)`, 'g'),
      `withResponsiveProps(${newInternalName})`,
    );
    code = code.replace(
      new RegExp(`\\bexport\\s+default\\s+${escapeRegExp(oldExport)}\\b`, 'g'),
      `export default ${newInternalName}`,
    );
    code = code.replace(
      new RegExp(`\\bconst\\s+${escapeRegExp(oldExport)}\\s*=`, 'g'),
      `const ${newInternalName} =`,
    );
  }

  // 2. Parse AST to collect all data-id attributes and variant references in JSX
  const ast = parseJSX(code);
  const originalIds: string[] = [];
  const elementVariants = new Map<string, string>(); // oldId -> variantIdentifier

  if (ast) {
    traverse(ast, {
      JSXElement(path) {
        const opening = path.node.openingElement;
        let elementId: string | null = null;
        let variantRef: string | null = null;

        for (const attr of opening.attributes) {
          if (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier') {
            if (attr.name.name === 'data-id' && attr.value?.type === 'StringLiteral') {
              elementId = attr.value.value;
            }
            if (
              attr.name.name === 'variants' &&
              attr.value?.type === 'JSXExpressionContainer' &&
              attr.value.expression.type === 'Identifier'
            ) {
              variantRef = attr.value.expression.name;
            }
          }
        }

        if (elementId) {
          if (!originalIds.includes(elementId)) {
            originalIds.push(elementId);
          }
          if (variantRef) {
            elementVariants.set(elementId, variantRef);
          }
        }
      },
    });
  }

  // 3. Build idMap
  const idMap = new Map<string, string>();
  for (const oldId of originalIds) {
    let prefix = 'frame';
    if (oldId === 'root' || oldId.endsWith('-root')) {
      prefix = `${newInternalName.toLowerCase()}-root`;
      idMap.set(oldId, prefix);
    } else {
      if (oldId.includes('-')) {
        prefix = oldId.split('-')[0];
      }
      idMap.set(oldId, generateNodeId(prefix));
    }
  }

  // Sort originalIds by length descending so longer IDs are replaced before their substrings
  const sortedOldIds = [...originalIds].sort((a, b) => b.length - a.length);

  // 4. Remap data-id and layoutId attributes
  for (const oldId of sortedOldIds) {
    const newId = idMap.get(oldId)!;
    // Remap data-id="..."
    code = code.replace(
      new RegExp(`data-id=(["'])${escapeRegExp(oldId)}\\1`, 'g'),
      `data-id=$1${newId}$1`,
    );
    // Remap layoutId="..."
    code = code.replace(
      new RegExp(`layoutId=(["'])${escapeRegExp(oldId)}\\1`, 'g'),
      `layoutId=$1${newId}$1`,
    );
    // Remap CSS selector: [data-id="..."]
    code = code.replace(
      new RegExp(`\\[data-id=(["'])${escapeRegExp(oldId)}\\1\\]`, 'g'),
      `[data-id=$1${newId}$1]`,
    );

    // 5. Remap slot consts: const cn_<oldId> = ... and {cn_<oldId>}
    const oldCn = slotConstName(oldId);
    const newCn = slotConstName(newId);
    if (oldCn !== newCn) {
      code = code.replace(new RegExp(`\\bconst\\s+${escapeRegExp(oldCn)}\\b`, 'g'), `const ${newCn}`);
      code = code.replace(new RegExp(`\\{\\s*${escapeRegExp(oldCn)}\\s*\\}`, 'g'), `{${newCn}}`);
    }

    // 6. Remap variant consts:
    // First, check if element explicitly referenced a variant identifier
    const explicitVariantRef = elementVariants.get(oldId);
    const targetVarName = nodeIdToVarName(newId) + 'Variants';
    if (explicitVariantRef && explicitVariantRef !== targetVarName) {
      code = code.replace(new RegExp(`\\bconst\\s+${escapeRegExp(explicitVariantRef)}\\b`, 'g'), `const ${targetVarName}`);
      code = code.replace(new RegExp(`variants=\\{\\s*${escapeRegExp(explicitVariantRef)}\\s*\\}`, 'g'), `variants={${targetVarName}}`);
      code = code.replace(new RegExp(`variants:\\s*${escapeRegExp(explicitVariantRef)}\\b`, 'g'), `variants: ${targetVarName}`);
    }

    // Also remap conventional <oldId>Variants if present
    const oldVar = nodeIdToVarName(oldId) + 'Variants';
    if (oldVar !== targetVarName) {
      code = code.replace(new RegExp(`\\bconst\\s+${escapeRegExp(oldVar)}\\b`, 'g'), `const ${targetVarName}`);
      code = code.replace(new RegExp(`variants=\\{\\s*${escapeRegExp(oldVar)}\\s*\\}`, 'g'), `variants={${targetVarName}}`);
      code = code.replace(new RegExp(`variants:\\s*${escapeRegExp(oldVar)}\\b`, 'g'), `variants: ${targetVarName}`);
    }

    // 7. Remap effect hooks/identifiers: e.g. frameXxxRef, handleFrameXxxEnter
    const oldEffectVar = nodeIdToVarName(oldId);
    const newEffectVar = nodeIdToVarName(newId);
    const oldEffectCap = nodeIdToVarNameCapitalised(oldId);
    const newEffectCap = nodeIdToVarNameCapitalised(newId);
    if (oldEffectVar !== newEffectVar) {
      code = code.replace(new RegExp(`\\b${escapeRegExp(oldEffectVar)}([A-Z]\\w*)\\b`, 'g'), `${newEffectVar}$1`);
      code = code.replace(new RegExp(`\\b(\\w*)${escapeRegExp(oldEffectCap)}(\\w*)\\b`, 'g'), `$1${newEffectCap}$2`);
    }
  }

  // 8. Update primary variant label in variantConfig if it matches oldDisplayName
  if (oldDisplayName) {
    code = code.replace(
      new RegExp(`(name:\\s*['"]default['"],\\s*label:\\s*)(['"])${escapeRegExp(oldDisplayName)}\\2`, 'g'),
      `$1$2${newDisplayName}$2`,
    );
    // Also data-name on root if matching
    code = code.replace(
      new RegExp(`data-name=(["'])${escapeRegExp(oldDisplayName)}\\1`, 'g'),
      `data-name=$1${newDisplayName}$1`,
    );
  }

  return { code, idMap };
}

/**
 * Duplicate a library component (either design component or code component).
 *
 * Flushes pending mutations, chooses a unique file name and display name,
 * remaps internal IDs and references, validates generated code against syntax and oracle,
 * writes the new file into ProjectFS, records history with undo/redo support,
 * and clears caches.
 */
export function duplicateComponent(
  sourceFilePath: string,
  options?: { newDisplayName?: string; activeFileBefore?: string },
): { success: boolean; newFilePath?: string; newDisplayName?: string; error?: string } {
  flushNow();

  const sourceCode = projectFS.readFile(sourceFilePath);
  if (!sourceCode) {
    return { success: false, error: `Component file not found: ${sourceFilePath}` };
  }

  const isCode = hasComponentControls(sourceCode);
  const oldDisplayName =
    parseComponentName(sourceCode) ||
    getFileDisplayName(sourceFilePath) ||
    (isCode ? 'Code Component' : 'Component');

  // Determine all existing component names
  const allComponentFiles = projectFS.listFiles('components/').filter((f) => f.endsWith('.tsx'));
  const existingNames = new Set<string>();
  for (const f of allComponentFiles) {
    const c = projectFS.readFile(f);
    if (c) {
      const n = parseComponentName(c) || getFileDisplayName(f);
      if (n) existingNames.add(n);
    }
  }

  const newDisplayName =
    options?.newDisplayName ?? generateDuplicateDisplayName(oldDisplayName, existingNames);

  // Pick unique internal name and file path
  let newInternalName = generateInternalName();
  let newFilePath = `components/${newInternalName}.tsx`;
  let attempts = 0;
  while (projectFS.exists(newFilePath) && attempts < 50) {
    newInternalName = generateInternalName();
    newFilePath = `components/${newInternalName}.tsx`;
    attempts++;
  }
  if (projectFS.exists(newFilePath)) {
    return { success: false, error: 'Could not generate a unique component path' };
  }

  // Generate new code
  let newCode = '';
  if (isCode) {
    const res = duplicateCodeComponentSource(sourceCode, newInternalName, newDisplayName);
    newCode = res.code;
  } else {
    const res = duplicateDesignComponentSource(sourceCode, newInternalName, newDisplayName);
    newCode = res.code;
  }

  // Validate generated code
  const syntaxError = validateGeneratedCode(newCode);
  if (syntaxError) {
    trace.error('component:duplicate-validation-error', { syntaxError });
    return { success: false, error: `Invalid generated code: ${syntaxError}` };
  }

  const oracleViolations = checkFile(newCode, {
    kind: isCode ? 'code-component' : 'component',
    path: newFilePath,
  });
  const blockingViolations = oracleViolations.filter((v) => v.tier === 1 || v.tier === 3);
  if (blockingViolations.length > 0) {
    const msg = blockingViolations.map((v) => v.message).join('; ');
    trace.error('component:duplicate-oracle-blocked', { blockingViolations });
    return { success: false, error: `Oracle blocked duplicate: ${msg}` };
  }

  const activeFileBefore = options?.activeFileBefore ?? sourceFilePath;
  const historyBefore = captureHistoryFileOpBefore();

  // Write file
  projectFS.writeFile(newFilePath, newCode);
  clearComponentCache();
  triggerAutosave();

  // Push history
  pushHistoryFileOp(activeFileBefore, historyBefore);

  trace.action('component:duplicate-success', {
    sourceFilePath,
    newFilePath,
    newDisplayName,
    isCode,
  });

  return {
    success: true,
    newFilePath,
    newDisplayName,
  };
}
