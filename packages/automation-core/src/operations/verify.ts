// packages/automation-core/src/operations/verify.ts
import { z } from 'zod';
import type { Operation, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { PHYSICS_PRESETS } from './motion';
import { verifyEffect as runSharedVerifyEffect, type EffectVerdict } from '@/ai/agent/tools/verify-effect';

const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

export const mechanismStateSchema = z.enum(['wired', 'fake', 'noop', 'mis-scoped', 'absent']);
export type MechanismState = z.infer<typeof mechanismStateSchema>;

export const verifyEffectInputSchema = z.object({
  filePath: z.string().optional().describe('File path of the component or page to verify'),
  targetFile: z.string().optional().describe('File path of the component or page to verify (alias)'),
  request: z.string().min(1).describe('Natural language request or effect description'),
  nodeId: z.string().optional().describe('Specific node data-id to inspect'),
  nodeIds: z.array(z.string()).optional().describe('Multiple node IDs to inspect'),
  node_ids: z.array(z.string()).optional().describe('Multiple node IDs to inspect (alias)'),
  effectType: z.enum(['hover', 'scroll', 'tap', 'motion', 'spring', 'interactive', 'all']).optional(),
  expectedRoles: z.array(z.string()).optional().describe('Expected structural roles (e.g. ["pricing", "card", "button"])'),
  expected_roles: z.array(z.string()).optional().describe('Expected structural roles (alias)'),
  expectedCount: z.number().int().positive().optional().describe('Expected count of repeated items'),
  expected_count: z.number().int().positive().optional().describe('Expected count of repeated items (alias)'),
  expectedMechanism: z.array(z.string()).optional().describe('Expected tokens (e.g. ["whileHover", "spring", "whileInView"])'),
  expected_mechanism: z.array(z.string()).optional().describe('Expected tokens (alias)'),
  keyTexts: z.array(z.string()).optional().describe('Key text fragments to check in content leaves'),
  key_texts: z.array(z.string()).optional().describe('Key text fragments (alias)'),
  checks: z.array(z.string()).optional(),
});

export const verifyCheckItemSchema = z.object({
  label: z.string(),
  present: z.boolean(),
  filled: z.union([z.boolean(), z.number()]).optional(),
  count: z.number().int().nonnegative(),
  required: z.union([z.string(), z.boolean()]),
  state: mechanismStateSchema.optional(),
});

export const motionPhysicsSchema = z.object({
  type: z.string(),
  stiffness: z.number().optional(),
  damping: z.number().optional(),
  mass: z.number().optional(),
  presetMatch: z.string().optional(),
  valid: z.boolean(),
});

export const motionAnalysisItemSchema = z.object({
  isMotionElement: z.boolean(),
  tag: z.string(),
  props: z.record(z.string(), z.string()),
  physics: motionPhysicsSchema.optional(),
  hasHover: z.boolean(),
  hasScrollTrigger: z.boolean(),
  hasSpringPhysics: z.boolean(),
});

export const verifyEffectOutputSchema = z.object({
  satisfied: z.boolean(),
  concept: z.string(),
  scope: z.string(),
  checks: z.array(verifyCheckItemSchema),
  states: z.array(
    z.object({
      label: z.string(),
      state: mechanismStateSchema,
      fixHint: z.string().optional(),
    })
  ),
  motionAnalysis: z.record(z.string(), motionAnalysisItemSchema).optional(),
  missing: z.array(z.string()),
  feedback: z.string(),
  inconclusive: z.boolean().optional(),
});

export type VerifyEffectInput = z.infer<typeof verifyEffectInputSchema>;
export type VerifyEffectOutput = z.infer<typeof verifyEffectOutputSchema>;

function getOpeningTagName(nameNode: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') return `${getOpeningTagName(nameNode.object)}.${nameNode.property.name}`;
  return `${nameNode.namespace.name}:${nameNode.name.name}`;
}

export const verifyEffectOperation: Operation<
  VerifyEffectInput,
  VerifyEffectOutput
> = {
  name: 'verify.effect',
  description: 'Pure Babel AST verification of hover animations, scroll triggers, Framer Motion tags, and spring physics',
  category: 'verify',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: verifyEffectInputSchema,
  outputSchema: verifyEffectOutputSchema,
  async execute(snapshot: Snapshot, input: VerifyEffectInput, _context: OperationContext) {
    const targetPath = input.filePath ?? input.targetFile ?? (function () {
      for (const k of snapshot.files.keys()) {
        if (k.endsWith('page.client.tsx') || k.endsWith('page.tsx')) return k;
      }
      return Array.from(snapshot.files.keys())[0] ?? 'app/page.client.tsx';
    })();

    const code = snapshot.files.get(targetPath);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetPath}" not found in snapshot`);
    }

    // 1. Parse AST
    let ast: t.File;
    try {
      ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });
    } catch (err) {
      return {
        satisfied: false,
        concept: input.request,
        scope: targetPath,
        checks: [],
        states: [],
        missing: ['File contains syntax errors and could not be parsed as JSX'],
        feedback: `Syntax error: ${err instanceof Error ? err.message : String(err)}`,
        inconclusive: true,
      };
    }

    // 2. Motion and Interactive AST Analysis
    const targetNodeIds = input.nodeIds ?? input.node_ids ?? (input.nodeId ? [input.nodeId] : undefined);
    const motionNodes: Record<string, z.infer<typeof motionAnalysisItemSchema>> = {};

    let hasHover = false;
    let hasScroll = false;
    let hasSpring = false;
    let hasTap = false;
    let hasAnyMotionElement = false;
    let invalidMotionOnIntrinsic = false;

    traverse(ast, {
      JSXElement(pathNode) {
        const opening = pathNode.node.openingElement;
        const tagName = getOpeningTagName(opening.name);
        const isMotion = tagName.startsWith('motion.');
        if (isMotion) hasAnyMotionElement = true;

        let dataId: string | undefined;
        for (const attr of opening.attributes) {
          if (attr.type === 'JSXAttribute' && attr.name.name === 'data-id') {
            if (attr.value?.type === 'StringLiteral') {
              dataId = attr.value.value;
            }
          }
        }

        if (targetNodeIds && targetNodeIds.length > 0) {
          if (!dataId || !targetNodeIds.includes(dataId)) return;
        }

        const propsMap: Record<string, string> = {};
        for (const attr of opening.attributes) {
          if (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier') {
            const name = attr.name.name;
            if (attr.value?.type === 'StringLiteral') {
              propsMap[name] = attr.value.value;
            } else if (attr.value?.type === 'JSXExpressionContainer') {
              propsMap[name] = code.slice(attr.value.expression.start!, attr.value.expression.end!);
            } else if (attr.value === null) {
              propsMap[name] = 'true';
            }
          }
        }

        // Motion props on intrinsic tags check (Oracle violation checkMotionPropsNeedMotionTag)
        if (!isMotion && (propsMap['whileHover'] || propsMap['whileTap'] || propsMap['whileInView'] || propsMap['animate'])) {
          invalidMotionOnIntrinsic = true;
        }

        if (propsMap['whileHover']) hasHover = true;
        if (propsMap['whileTap']) hasTap = true;
        if (propsMap['whileInView'] || propsMap['data-scroll-fx']) hasScroll = true;

        let physicsInfo: z.infer<typeof motionPhysicsSchema> | undefined;
        if (propsMap['transition'] && propsMap['transition'].includes('spring')) {
          hasSpring = true;
          const stiffnessMatch = propsMap['transition'].match(/stiffness:\s*['"]?(\d+)['"]?/);
          const dampingMatch = propsMap['transition'].match(/damping:\s*['"]?(\d+)['"]?/);
          const massMatch = propsMap['transition'].match(/mass:\s*['"]?(\d+)['"]?/);

          const stiffness = stiffnessMatch ? parseInt(stiffnessMatch[1], 10) : undefined;
          const damping = dampingMatch ? parseInt(dampingMatch[1], 10) : undefined;
          const mass = massMatch ? parseInt(massMatch[1], 10) : undefined;

          // Preset matching
          let presetMatch: string | undefined;
          for (const [pKey, preset] of Object.entries(PHYSICS_PRESETS)) {
            if (stiffness !== undefined && Math.abs(stiffness - parseInt(preset.stiffness, 10)) <= 50) {
              presetMatch = pKey;
              break;
            }
          }

          physicsInfo = {
            type: 'spring',
            stiffness,
            damping,
            mass,
            presetMatch,
            valid: (stiffness === undefined || stiffness > 0) && (damping === undefined || damping > 0),
          };
        }

        const effectiveId = dataId ?? `${tagName}-${pathNode.node.start ?? 0}`;
        motionNodes[effectiveId] = {
          isMotionElement: isMotion,
          tag: tagName,
          props: propsMap,
          physics: physicsInfo,
          hasHover: Boolean(propsMap['whileHover']),
          hasScrollTrigger: Boolean(propsMap['whileInView'] || propsMap['data-scroll-fx']),
          hasSpringPhysics: Boolean(physicsInfo),
        };
      },
    });

    // 3. Shared Role & Concept Verification
    const expectedRoles = input.expectedRoles ?? input.expected_roles;
    const expectedCount = input.expectedCount ?? input.expected_count;
    const expectedMechanism = input.expectedMechanism ?? input.expected_mechanism;
    const keyTexts = input.keyTexts ?? input.key_texts;

    let sharedVerdict: EffectVerdict | undefined;
    try {
      sharedVerdict = runSharedVerifyEffect(code, input.request, {
        expected_roles: expectedRoles,
        expected_count: expectedCount,
        expected_mechanism: expectedMechanism,
        key_texts: keyTexts,
      });
    } catch {
      // Shared scan fallback
    }

    // 4. Synthesize checks and states
    const checks: z.infer<typeof verifyCheckItemSchema>[] = [];
    const states: { label: string; state: MechanismState; fixHint?: string }[] = [];
    const missing: string[] = [];

    if (sharedVerdict) {
      for (const c of sharedVerdict.checks) {
        checks.push({
          label: c.label,
          present: c.present,
          filled: c.filled,
          count: c.count,
          required: c.required,
          state: c.state,
        });
      }
      for (const s of sharedVerdict.states) {
        states.push({
          label: s.label,
          state: s.state,
        });
      }
      for (const m of sharedVerdict.missing) {
        missing.push(m);
      }
    }

    // Add motion-specific checks
    const reqLower = input.request.toLowerCase();
    const needsHover = input.effectType === 'hover' || reqLower.includes('hover');
    const needsScroll = input.effectType === 'scroll' || reqLower.includes('scroll');
    const needsSpring = input.effectType === 'spring' || reqLower.includes('spring');
    const needsMotion = input.effectType === 'motion' || reqLower.includes('motion') || reqLower.includes('animate') || reqLower.includes('animation');

    if (needsHover) {
      checks.push({
        label: 'hover-animation',
        present: hasHover,
        count: hasHover ? 1 : 0,
        required: true,
        state: hasHover ? 'wired' : 'absent',
      });
      states.push({
        label: 'hover',
        state: hasHover ? 'wired' : 'absent',
        fixHint: 'Add whileHover={{ scale: 1.03 }} on motion element',
      });
      if (!hasHover) {
        missing.push('Missing whileHover attribute on motion element');
      }
    }

    if (needsScroll) {
      checks.push({
        label: 'scroll-trigger',
        present: hasScroll,
        count: hasScroll ? 1 : 0,
        required: true,
        state: hasScroll ? 'wired' : 'absent',
      });
      states.push({
        label: 'scroll',
        state: hasScroll ? 'wired' : 'absent',
        fixHint: 'Add whileInView={{ opacity: 1, y: 0 }} and viewport={{ once: true }}',
      });
      if (!hasScroll) {
        missing.push('Missing whileInView or data-scroll-fx attribute for scroll trigger');
      }
    }

    if (needsSpring) {
      checks.push({
        label: 'spring-physics',
        present: hasSpring,
        count: hasSpring ? 1 : 0,
        required: true,
        state: hasSpring ? 'wired' : 'absent',
      });
      states.push({
        label: 'spring',
        state: hasSpring ? 'wired' : 'absent',
        fixHint: 'Add transition={{ type: "spring", stiffness: 300, damping: 20 }}',
      });
      if (!hasSpring) {
        missing.push('Missing spring physics transition configuration');
      }
    }

    if (invalidMotionOnIntrinsic) {
      missing.push('Motion attributes (whileHover/animate) declared on intrinsic HTML tags instead of <motion.*>');
    }

    // Determine final satisfied verdict
    let satisfied = missing.length === 0;
    if (sharedVerdict && !sharedVerdict.satisfied) {
      satisfied = false;
    }

    if (input.effectType === 'hover' && !hasHover) satisfied = false;
    if (input.effectType === 'scroll' && !hasScroll) satisfied = false;
    if (input.effectType === 'spring' && !hasSpring) satisfied = false;

    const feedback = satisfied
      ? (sharedVerdict?.feedback ?? 'Effect verified and fully satisfied in AST.')
      : missing.join('; ');

    return {
      satisfied,
      concept: sharedVerdict?.concept ?? expectedRoles?.[0] ?? input.request,
      scope: targetPath,
      checks,
      states,
      motionAnalysis: motionNodes,
      missing,
      feedback,
      inconclusive: sharedVerdict?.inconclusive,
    };
  },
};

// ─── Operation Registrations & Aliases ─────────────────────────────────────────

defaultRegistry.register(verifyEffectOperation);

defaultRegistry.registerAlias('verify.animation', 'verify.effect');
defaultRegistry.registerAlias('verify.motion', 'verify.effect');
defaultRegistry.registerAlias('animation.verify', 'verify.effect');
defaultRegistry.registerAlias('effect.verify', 'verify.effect');
defaultRegistry.registerAlias('verify_effect', 'verify.effect');
defaultRegistry.registerAlias('verify.requirement', 'verify.effect');
defaultRegistry.registerAlias('verify.request', 'verify.effect');
