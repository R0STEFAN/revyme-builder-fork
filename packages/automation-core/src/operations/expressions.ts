// packages/automation-core/src/operations/expressions.ts
import { z } from 'zod';
import { parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  bindTextExpressionInCode,
  unbindTextExpressionInCode,
  bindHrefExpressionInCode,
  unbindHrefExpressionInCode,
  bindSrcExpressionInCode,
  unbindSrcExpressionInCode,
} from '@/code/generation/expression-gen';
import { parseJSX, findFirstElementByDataId } from '@/code/parsing/ast-utils';
import { generate } from '@/code/generation/generator-utils';

export const expressionKindSchema = z.enum(['text', 'href', 'src']);
export type ExpressionKind = z.infer<typeof expressionKindSchema>;

// Validate expression syntax without evaluating arbitrary authoring JS
export function validateExpressionSyntax(expression: string): void {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error('Expression cannot be empty');
  }
  try {
    parseExpression(trimmed, { plugins: ['jsx', 'typescript'] });
  } catch (err: any) {
    throw new Error(`Invalid JS expression syntax: ${err.message}`);
  }
}

// 1. expressions.bind
export const expressionsBindOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    kind: ExpressionKind;
    expression: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'expressions.bind',
  description: 'Bind a dynamic expression to text, href, or src',
  category: 'expressions',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    kind: expressionKindSchema,
    expression: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    validateExpressionSyntax(input.expression);

    switch (input.kind) {
      case 'text':
        code = bindTextExpressionInCode(code, input.nodeId, input.expression);
        break;
      case 'href':
        code = bindHrefExpressionInCode(code, input.nodeId, input.expression);
        break;
      case 'src':
        code = bindSrcExpressionInCode(code, input.nodeId, input.expression);
        break;
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 2. expressions.unbind
export const expressionsUnbindOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    kind: ExpressionKind;
    fallbackValue?: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'expressions.unbind',
  description: 'Unbind a dynamic expression and restore a static fallback value',
  category: 'expressions',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    kind: expressionKindSchema,
    fallbackValue: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    switch (input.kind) {
      case 'text':
        code = unbindTextExpressionInCode(code, input.nodeId, input.fallbackValue ?? 'Text');
        break;
      case 'href':
        code = unbindHrefExpressionInCode(code, input.nodeId, input.fallbackValue ?? '#');
        break;
      case 'src':
        code = unbindSrcExpressionInCode(code, input.nodeId, input.fallbackValue ?? '');
        break;
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 3. expressions.get
export const expressionsGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    targetFile: string;
    nodeId: string;
    text?: string;
    href?: string;
    src?: string;
  }
> = {
  name: 'expressions.get',
  description: 'Get any dynamic expressions bound to an element (text, href, src)',
  category: 'expressions',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    const ast = parseJSX(code);
    const result: { targetFile: string; nodeId: string; text?: string; href?: string; src?: string } = {
      targetFile: input.targetFile,
      nodeId: input.nodeId,
    };

    if (!ast) return result;

    findFirstElementByDataId(ast, input.nodeId, (path) => {
      const opening = path.node.openingElement;
      for (const attr of opening.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
        const attrName = attr.name.name;
        if (attrName === 'href') {
          if (attr.value && t.isJSXExpressionContainer(attr.value)) {
            result.href = generate(attr.value.expression).code;
          }
        } else if (attrName === 'data-dormant-href') {
          if (attr.value && t.isStringLiteral(attr.value)) {
            result.href = attr.value.value;
          }
        } else if (attrName === 'src') {
          if (attr.value && t.isJSXExpressionContainer(attr.value)) {
            result.src = generate(attr.value.expression).code;
          }
        } else if (attrName === 'data-dormant-src') {
          if (attr.value && t.isStringLiteral(attr.value)) {
            result.src = attr.value.value;
          }
        } else if (attrName === 'data-dormant-text') {
          if (attr.value && t.isStringLiteral(attr.value)) {
            result.text = attr.value.value;
          }
        }
      }

      if (!result.text && path.node.children) {
        for (const child of path.node.children) {
          if (t.isJSXExpressionContainer(child)) {
            result.text = generate(child.expression).code;
            break;
          }
        }
      }
    });

    return result;
  },
};

defaultRegistry.register(expressionsBindOperation);
defaultRegistry.register(expressionsUnbindOperation);
defaultRegistry.register(expressionsGetOperation);
