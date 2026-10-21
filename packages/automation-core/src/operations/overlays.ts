// packages/automation-core/src/operations/overlays.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  createOverlayInCode,
  updateOverlayConfigInCode,
  removeOverlayInCode,
} from '@/code/generation/overlay-gen';
import {
  addCloseOverlayInCode,
  removeCloseOverlayInCode,
  setCloseOverlayDelayInCode,
} from '@/code/generation/close-overlay-gen';
import type { OverlayConfig, OverlayTriggerConfig } from '@/shared/types';

// 1. overlays.create
export const overlaysCreateOperation: Operation<
  {
    targetFile: string;
    triggerId: string;
    overlayId?: string;
    type?: 'relative' | 'fixed';
    trigger?: 'click' | 'hover';
    dismiss?: 'outside' | 'click' | 'escape';
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    offsetX?: number;
    offsetY?: number;
    fill?: string;
    dismissible?: boolean;
    zIndex?: number;
  },
  {
    changes: FileChange[];
    overlayId: string;
  }
> = {
  name: 'overlays.create',
  description: 'Create an overlay (modal, drawer, or dropdown) wired to a trigger element',
  category: 'overlays',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    triggerId: z.string().min(1),
    overlayId: z.string().optional(),
    type: z.enum(['relative', 'fixed']).optional(),
    trigger: z.enum(['click', 'hover']).optional(),
    dismiss: z.enum(['outside', 'click', 'escape']).optional(),
    side: z.enum(['top', 'right', 'bottom', 'left']).optional(),
    align: z.enum(['start', 'center', 'end']).optional(),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    fill: z.string().optional(),
    dismissible: z.boolean().optional(),
    zIndex: z.number().int().optional(),
  }),
  async execute(snapshot, input, context) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    if (!code.includes(`data-id="${input.triggerId}"`)) {
      throw new Error(`TRIGGER_NOT_FOUND: Trigger element with data-id "${input.triggerId}" not found in "${input.targetFile}"`);
    }

    const overlayId = input.overlayId ?? context.createId('overlay');
    const overlayType = input.type ?? 'fixed';

    const overlayConfig: OverlayConfig = {
      type: overlayType,
      triggerId: input.triggerId,
      side: input.side ?? (overlayType === 'relative' ? 'bottom' : 'bottom'),
      align: input.align ?? 'center',
      offsetX: input.offsetX ?? 0,
      offsetY: input.offsetY ?? 0,
      fill: input.fill ?? 'rgba(0,0,0,0.5)',
      dismissible: input.dismissible ?? true,
      zIndex: input.zIndex ?? 100,
    };

    const triggerConfig: OverlayTriggerConfig = {
      targetId: overlayId,
      trigger: input.trigger ?? 'click',
      dismiss: input.dismiss ?? 'outside',
    };

    const nextCode = createOverlayInCode(
      code,
      input.triggerId,
      overlayId,
      overlayConfig,
      triggerConfig,
    );

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      overlayId,
    };
  },
};

// 2. overlays.update
export const overlaysUpdateOperation: Operation<
  {
    targetFile: string;
    overlayId: string;
    patch: {
      side?: 'top' | 'right' | 'bottom' | 'left';
      align?: 'start' | 'center' | 'end';
      offsetX?: number;
      offsetY?: number;
      fill?: string;
      dismissible?: boolean;
      zIndex?: number;
      pageScroll?: 'auto' | 'block';
    };
    vpWidth?: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'overlays.update',
  description: 'Update placement, backdrop, or behavior config of an existing overlay',
  category: 'overlays',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    overlayId: z.string().min(1),
    patch: z.object({
      side: z.enum(['top', 'right', 'bottom', 'left']).optional(),
      align: z.enum(['start', 'center', 'end']).optional(),
      offsetX: z.number().optional(),
      offsetY: z.number().optional(),
      fill: z.string().optional(),
      dismissible: z.boolean().optional(),
      zIndex: z.number().int().optional(),
      pageScroll: z.enum(['auto', 'block']).optional(),
    }),
    vpWidth: z.number().int().positive().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const nextCode = updateOverlayConfigInCode(
      code,
      input.overlayId,
      input.patch,
      input.vpWidth ?? null,
    );

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 3. overlays.close
export const overlaysCloseOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    overlayId: string;
    trigger?: 'click' | 'hover' | 'tap';
    delay?: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'overlays.close',
  description: 'Attach a Close Overlay interaction to an element inside or outside the overlay',
  category: 'overlays',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    overlayId: z.string().min(1),
    trigger: z.enum(['click', 'hover', 'tap']).optional(),
    delay: z.number().nonnegative().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const trigger = input.trigger ?? 'click';
    let nextCode = addCloseOverlayInCode(
      code,
      input.nodeId,
      trigger,
      input.overlayId,
    );

    if (input.delay && input.delay > 0) {
      nextCode = setCloseOverlayDelayInCode(
        nextCode,
        input.nodeId,
        trigger,
        input.overlayId,
        input.delay,
      );
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 4. overlays.remove
export const overlaysRemoveOperation: Operation<
  {
    targetFile: string;
    overlayId: string;
    triggerId: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'overlays.remove',
  description: 'Remove an overlay and its trigger binding from a file',
  category: 'overlays',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    overlayId: z.string().min(1),
    triggerId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const nextCode = removeOverlayInCode(code, input.overlayId, input.triggerId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

defaultRegistry.register(overlaysCreateOperation);
defaultRegistry.register(overlaysUpdateOperation);
defaultRegistry.register(overlaysCloseOperation);
defaultRegistry.register(overlaysRemoveOperation);
