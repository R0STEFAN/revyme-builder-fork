// packages/automation-core/src/operations/motion.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  updateMotionPropInCode,
  removeMotionPropFromCode,
} from '@/code/generation/generator-motion-props';
import {
  getScrollFx,
  setScrollFxInCode,
  robustClearScrollFx,
  type ScrollFxSpec,
} from '@/code/generation/generator-motion-scroll-fx';
import { findJSXDataIdIndex, findTagClose } from '@/code/generation/generator-utils';
import { scanTagAttrs } from '@/code/components/jsx-tag-attrs';

export const PHYSICS_PRESETS = {
  snappy: { type: 'spring', stiffness: '400', damping: '30', mass: '1' },
  gentle: { type: 'spring', stiffness: '200', damping: '20', mass: '1' },
  bouncy: { type: 'spring', stiffness: '300', damping: '10', mass: '1' },
  slow: { type: 'spring', stiffness: '100', damping: '20', mass: '1' },
} as const;

export type PhysicsPresetKey = keyof typeof PHYSICS_PRESETS;

export const MOTION_PRESET_NAMES = [
  'lift-on-hover',
  'scale-on-hover',
  'fade-up',
  'fade-in',
  'slide-in-left',
  'slide-in-right',
] as const;

export type MotionPresetName = typeof MOTION_PRESET_NAMES[number];

// 1. motion.set
export const motionSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    prop: 'initial' | 'animate' | 'whileHover' | 'whileTap' | 'whileInView' | 'exit' | 'transition';
    values: Record<string, string>;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'motion.set',
  description: 'Set a framer-motion prop (initial, animate, whileHover, whileTap, whileInView, exit, transition) on an element',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    prop: z.enum(['initial', 'animate', 'whileHover', 'whileTap', 'whileInView', 'exit', 'transition']),
    values: z.record(z.string(), z.string()),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = updateMotionPropInCode(code, input.nodeId, input.prop, input.values);

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

// 2. motion.get
export const motionGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    isMotionElement: boolean;
    props: Record<string, string>;
    scrollFx: ScrollFxSpec | null;
  }
> = {
  name: 'motion.get',
  description: 'Read framer-motion and scroll animation properties on an element',
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

    const scrollFx = getScrollFx(code, input.nodeId);

    const idIndex = findJSXDataIdIndex(code, input.nodeId);
    if (idIndex === -1) {
      throw new Error(`NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const tagStart = code.lastIndexOf('<', idIndex);
    const tagEnd = findTagClose(code, idIndex);
    const tagStr = tagStart >= 0 && tagEnd > tagStart ? code.slice(tagStart, tagEnd + 1) : '';
    const isMotionElement = /^<motion\./i.test(tagStr);

    const scanned = scanTagAttrs(tagStr) ?? [];
    const props: Record<string, string> = {};
    for (const a of scanned) {
      if (['initial', 'animate', 'whileHover', 'whileTap', 'whileInView', 'exit', 'transition'].includes(a.name)) {
        if (a.value.kind === 'string') props[a.name] = a.value.text;
        else if (a.value.kind === 'expr') props[a.name] = a.value.source;
        else if (a.value.kind === 'bare') props[a.name] = 'true';
      }
    }

    return {
      isMotionElement,
      props,
      scrollFx,
    };
  },
};

// 3. motion.remove
export const motionRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    prop?: 'initial' | 'animate' | 'whileHover' | 'whileTap' | 'whileInView' | 'exit' | 'transition' | 'scrollFx';
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'motion.remove',
  description: 'Remove a specific motion prop or all scroll animations from an element',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    prop: z.enum(['initial', 'animate', 'whileHover', 'whileTap', 'whileInView', 'exit', 'transition', 'scrollFx']).optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    if (!input.prop || input.prop === 'scrollFx') {
      code = robustClearScrollFx(code, input.nodeId);
    }

    if (input.prop && input.prop !== 'scrollFx') {
      code = removeMotionPropFromCode(code, input.nodeId, input.prop);
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

// 4. motion.preset.apply
export const motionPresetApplyOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    preset: MotionPresetName;
    physics?: PhysicsPresetKey;
    targets?: Record<string, string>;
  },
  {
    changes: FileChange[];
    appliedPreset: string;
  }
> = {
  name: 'motion.preset.apply',
  description: 'Apply a high-level motion preset (lift-on-hover, scale-on-hover, fade-up, fade-in, slide-in-left, slide-in-right)',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    preset: z.enum(MOTION_PRESET_NAMES),
    physics: z.enum(['snappy', 'gentle', 'bouncy', 'slow']).optional(),
    targets: z.record(z.string(), z.string()).optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const physicsKey: PhysicsPresetKey = input.physics || (
      input.preset === 'scale-on-hover' ? 'snappy' : 'gentle'
    );
    const spring = { ...PHYSICS_PRESETS[physicsKey] };

    if (input.preset === 'lift-on-hover') {
      const targets = input.targets ?? { y: '-4', scale: '1.02' };
      code = updateMotionPropInCode(code, input.nodeId, 'whileHover', targets);
      code = updateMotionPropInCode(code, input.nodeId, 'transition', spring);
    } else if (input.preset === 'scale-on-hover') {
      const targets = input.targets ?? { scale: '1.03' };
      code = updateMotionPropInCode(code, input.nodeId, 'whileHover', targets);
      code = updateMotionPropInCode(code, input.nodeId, 'transition', spring);
    } else if (input.preset === 'fade-up') {
      code = setScrollFxInCode(code, input.nodeId, {
        appear: {
          initial: { opacity: '0', y: '30' },
          once: true,
          transition: spring,
        },
      });
    } else if (input.preset === 'fade-in') {
      code = setScrollFxInCode(code, input.nodeId, {
        appear: {
          initial: { opacity: '0' },
          once: true,
          transition: spring,
        },
      });
    } else if (input.preset === 'slide-in-left') {
      code = setScrollFxInCode(code, input.nodeId, {
        appear: {
          initial: { opacity: '0', x: '-40' },
          once: true,
          transition: spring,
        },
      });
    } else if (input.preset === 'slide-in-right') {
      code = setScrollFxInCode(code, input.nodeId, {
        appear: {
          initial: { opacity: '0', x: '40' },
          once: true,
          transition: spring,
        },
      });
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      appliedPreset: input.preset,
    };
  },
};

defaultRegistry.register(motionSetOperation);
defaultRegistry.register(motionGetOperation);
defaultRegistry.register(motionRemoveOperation);
defaultRegistry.register(motionPresetApplyOperation);
