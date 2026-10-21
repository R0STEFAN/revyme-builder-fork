// packages/automation-core/src/operations/drawing.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  setSketchAnimInCode,
  removeSketchAnimInCode,
  readSketchAnimFromCode,
  listSketchAnimsInCode,
  createDefaultSketchAnim,
} from '@/code/sketch/sketch-anim-gen';
import type { SketchAnimConfig } from '@/code/sketch/sketch-anim-config';

// 1. drawing.sketchAnim.set
export const drawingSketchAnimSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    trigger?: 'inView' | 'hover' | 'click';
    mode?: 'draw' | 'erase';
    durationScale?: number;
    stagger?: number;
    transition?: {
      type?: 'spring' | 'tween';
      duration?: number;
      ease?: string;
      stiffness?: number;
      damping?: number;
      mass?: number;
    };
  },
  {
    changes: FileChange[];
    config: SketchAnimConfig;
  }
> = {
  name: 'drawing.sketchAnim.set',
  description: 'Attach or update a sketch draw animation on an SVG/sketch element',
  category: 'drawing',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    trigger: z.enum(['inView', 'hover', 'click']).optional(),
    mode: z.enum(['draw', 'erase']).optional(),
    durationScale: z.number().positive().optional(),
    stagger: z.number().nonnegative().optional(),
    transition: z.object({
      type: z.enum(['spring', 'tween']).optional(),
      duration: z.number().positive().optional(),
      ease: z.string().optional(),
      stiffness: z.number().positive().optional(),
      damping: z.number().positive().optional(),
      mass: z.number().positive().optional(),
    }).optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const currentConfig = readSketchAnimFromCode(code, input.nodeId) ?? createDefaultSketchAnim();

    const nextConfig: SketchAnimConfig = {
      trigger: input.trigger ?? currentConfig.trigger,
      mode: input.mode ?? currentConfig.mode,
      durationScale: input.durationScale ?? currentConfig.durationScale,
      stagger: input.stagger ?? currentConfig.stagger,
      transition: input.transition
        ? {
            type: input.transition.type ?? currentConfig.transition.type,
            duration: input.transition.duration ?? currentConfig.transition.duration,
            ease: input.transition.ease ?? currentConfig.transition.ease,
            stiffness: input.transition.stiffness ?? currentConfig.transition.stiffness,
            damping: input.transition.damping ?? currentConfig.transition.damping,
            mass: input.transition.mass ?? currentConfig.transition.mass,
          }
        : currentConfig.transition,
    };

    code = setSketchAnimInCode(code, input.nodeId, nextConfig);

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

// 2. drawing.sketchAnim.get
export const drawingSketchAnimGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    config: SketchAnimConfig | null;
  }
> = {
  name: 'drawing.sketchAnim.get',
  description: 'Read the sketch animation configuration from an element',
  category: 'drawing',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const config = readSketchAnimFromCode(code, input.nodeId);
    return { config };
  },
};

// 3. drawing.sketchAnim.remove
export const drawingSketchAnimRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    removedId: string;
  }
> = {
  name: 'drawing.sketchAnim.remove',
  description: 'Remove sketch draw animation and its effect hook from the file',
  category: 'drawing',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = removeSketchAnimInCode(code, input.nodeId);

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

// 4. drawing.sketchAnim.list
export const drawingSketchAnimListOperation: Operation<
  {
    targetFile: string;
  },
  {
    animatedNodeIds: string[];
  }
> = {
  name: 'drawing.sketchAnim.list',
  description: 'List all element IDs in a file that have sketch draw animations attached',
  category: 'drawing',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const animatedNodeIds = listSketchAnimsInCode(code);
    return { animatedNodeIds };
  },
};

defaultRegistry.register(drawingSketchAnimSetOperation);
defaultRegistry.register(drawingSketchAnimGetOperation);
defaultRegistry.register(drawingSketchAnimRemoveOperation);
defaultRegistry.register(drawingSketchAnimListOperation);
