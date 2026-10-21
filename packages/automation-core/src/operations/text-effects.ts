// packages/automation-core/src/operations/text-effects.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  nodeHasTextAnim,
  addTextAnimInCode,
  updateTextAnimInCode,
  removeTextAnimFromCode,
  readTextAnimConfig,
} from '@/code/generation/text-anim-gen';

export interface TextAnimConfig {
  disabled?: boolean;
  animationType: 'character' | 'word' | 'line' | 'full';
  mask?: boolean;
  trigger?: 'appear' | 'view' | 'section' | 'scroll';
  viewport?: 'top' | 'middle' | 'bottom';
  replay?: boolean;
  sectionId?: string;
  scrollStart?: number;
  scrollEnd?: number;
  stagger?: number;
  from?: 'start' | 'end' | 'center' | 'random';
  opacity?: number;
  scale?: number;
  blur?: number;
  x?: number | string;
  y?: number | string;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  skewX?: number;
  skewY?: number;
  transition?: {
    type?: 'spring' | 'tween' | 'ease';
    duration?: number;
    delay?: number;
    ease?: string;
    stiffness?: number;
    damping?: number;
    mass?: number;
    bounce?: number;
  };
}

// 1. textEffects.set
export const textEffectsSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    animationType?: 'character' | 'word' | 'line' | 'full';
    split?: 'chars' | 'words' | 'lines';
    mask?: boolean;
    trigger?: 'appear' | 'view' | 'section' | 'scroll';
    from?: 'start' | 'end' | 'center' | 'random';
    stagger?: number;
    opacity?: number;
    scale?: number;
    blur?: number;
    x?: number | string;
    y?: number | string;
    rotateZ?: number;
    transition?: {
      type?: 'spring' | 'tween' | 'ease';
      duration?: number;
      delay?: number;
      ease?: string;
      stiffness?: number;
      damping?: number;
    };
  },
  {
    changes: FileChange[];
    config: TextAnimConfig;
  }
> = {
  name: 'textEffects.set',
  description: 'Attach or update split-text animation on a text node',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    animationType: z.enum(['character', 'word', 'line', 'full']).optional(),
    split: z.enum(['chars', 'words', 'lines']).optional(),
    mask: z.boolean().optional(),
    trigger: z.enum(['appear', 'view', 'section', 'scroll']).optional(),
    from: z.enum(['start', 'end', 'center', 'random']).optional(),
    stagger: z.number().nonnegative().optional(),
    opacity: z.number().min(0).max(1).optional(),
    scale: z.number().optional(),
    blur: z.number().optional(),
    x: z.union([z.number(), z.string()]).optional(),
    y: z.union([z.number(), z.string()]).optional(),
    rotateZ: z.number().optional(),
    transition: z.object({
      type: z.enum(['spring', 'tween', 'ease']).optional(),
      duration: z.number().positive().optional(),
      delay: z.number().nonnegative().optional(),
      ease: z.string().optional(),
      stiffness: z.number().positive().optional(),
      damping: z.number().positive().optional(),
    }).optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    // Map split alias to animationType
    let animType: 'character' | 'word' | 'line' | 'full' = input.animationType ?? 'word';
    if (input.split) {
      if (input.split === 'chars') animType = 'character';
      else if (input.split === 'words') animType = 'word';
      else if (input.split === 'lines') animType = 'line';
    }

    const currentConfig = (readTextAnimConfig(code, input.nodeId) as TextAnimConfig | null) ?? {
      animationType: animType,
      opacity: 0,
      y: 20,
      stagger: 0.05,
      from: 'start',
      transition: { type: 'spring', stiffness: 200, damping: 20 },
    };

    const nextConfig: TextAnimConfig = {
      ...currentConfig,
      animationType: animType,
      mask: input.mask ?? currentConfig.mask ?? false,
      trigger: input.trigger ?? currentConfig.trigger ?? 'view',
      from: input.from ?? currentConfig.from ?? 'start',
      stagger: input.stagger ?? currentConfig.stagger ?? 0.05,
      opacity: input.opacity ?? currentConfig.opacity ?? 0,
      scale: input.scale ?? currentConfig.scale,
      blur: input.blur ?? currentConfig.blur,
      x: input.x ?? currentConfig.x,
      y: input.y ?? currentConfig.y ?? 20,
      rotateZ: input.rotateZ ?? currentConfig.rotateZ,
      transition: input.transition
        ? {
            type: input.transition.type ?? currentConfig.transition?.type ?? 'spring',
            duration: input.transition.duration ?? currentConfig.transition?.duration,
            delay: input.transition.delay ?? currentConfig.transition?.delay,
            ease: input.transition.ease ?? currentConfig.transition?.ease,
            stiffness: input.transition.stiffness ?? currentConfig.transition?.stiffness,
            damping: input.transition.damping ?? currentConfig.transition?.damping,
          }
        : currentConfig.transition,
    };

    if (nodeHasTextAnim(code, input.nodeId)) {
      code = updateTextAnimInCode(code, input.nodeId, nextConfig as any);
    } else {
      code = addTextAnimInCode(code, input.nodeId, nextConfig as any);
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      config: nextConfig,
    };
  },
};

// 2. textEffects.get
export const textEffectsGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    hasTextAnim: boolean;
    config: TextAnimConfig | null;
  }
> = {
  name: 'textEffects.get',
  description: 'Read the split-text animation configuration from a text node',
  category: 'motion',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const has = nodeHasTextAnim(code, input.nodeId);
    const config = (readTextAnimConfig(code, input.nodeId) as TextAnimConfig | null) ?? null;

    return {
      hasTextAnim: has,
      config,
    };
  },
};

// 3. textEffects.remove
export const textEffectsRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    removedId: string;
  }
> = {
  name: 'textEffects.remove',
  description: 'Remove split-text animation from a text node',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = removeTextAnimFromCode(code, input.nodeId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      removedId: input.nodeId,
    };
  },
};

defaultRegistry.register(textEffectsSetOperation);
defaultRegistry.register(textEffectsGetOperation);
defaultRegistry.register(textEffectsRemoveOperation);
