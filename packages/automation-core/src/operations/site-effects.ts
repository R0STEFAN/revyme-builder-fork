// packages/automation-core/src/operations/site-effects.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parseSmoothScroll,
  serializeSmoothScroll,
  setSmoothScrollInMap,
  removeSmoothScrollFromMap,
  ownSmoothScroll,
  resolveSmoothScroll,
  createDefaultSmoothScroll,
  type SmoothScrollConfig,
} from '@/code/project/smooth-scroll-config';
import { ensureSmoothScrollInLayout } from '@/code/generation/smooth-scroll-layout';
import {
  parsePageEffects,
  serializePageEffects,
  createDefaultSide,
  upsertEffectInMap,
  removeEffectFromMap,
  listEffectsForPage,
  type PageEffect,
} from '@/code/project/page-effects-config';
import {
  addComponentCursorInCode,
  removeComponentCursorInCode,
} from '@/code/generation/cursor-gen';
import {
  getGlide,
  setGlideInCode,
  hasGlide,
  type GlideSpec,
} from '@/code/generation/glide-gen';

// ─── 1. Smooth Scroll ─────────────────────────────────────────────────────────

export const siteEffectsSmoothScrollSetOperation: Operation<
  {
    route?: string;
    enabled?: boolean;
    intensity?: number;
    smoothWheel?: boolean;
    smoothTouch?: boolean;
    orientation?: 'vertical' | 'horizontal';
    infinite?: boolean;
  },
  {
    changes: FileChange[];
    config: SmoothScrollConfig;
  }
> = {
  name: 'siteEffects.smoothScroll.set',
  description: 'Configure page-level smooth scroll (Lenis) for a specific route or the default route',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    route: z.string().optional().default('/'),
    enabled: z.boolean().optional(),
    intensity: z.number().int().min(1).max(100).optional(),
    smoothWheel: z.boolean().optional(),
    smoothTouch: z.boolean().optional(),
    orientation: z.enum(['vertical', 'horizontal']).optional(),
    infinite: z.boolean().optional(),
  }),
  async execute(snapshot, input) {
    const route = input.route ?? '/';
    const filePath = 'app/smooth-scroll.ts';
    const existingCode = snapshot.files.get(filePath) ?? '';
    const map = parseSmoothScroll(existingCode);

    const currentCfg = ownSmoothScroll(map, route) ?? createDefaultSmoothScroll();
    const nextCfg: SmoothScrollConfig = {
      enabled: input.enabled ?? currentCfg.enabled,
      intensity: input.intensity ?? currentCfg.intensity,
      smoothWheel: input.smoothWheel ?? currentCfg.smoothWheel,
      smoothTouch: input.smoothTouch ?? currentCfg.smoothTouch,
      orientation: input.orientation ?? currentCfg.orientation,
      infinite: input.infinite ?? currentCfg.infinite,
    };

    const nextMap = setSmoothScrollInMap(map, route, nextCfg);
    const newScrollCode = serializeSmoothScroll(nextMap);

    const changes: FileChange[] = [
      {
        path: filePath,
        beforeHash: null,
        content: newScrollCode,
      },
    ];

    // If layout exists, mount <SmoothScroll /> into layout if missing
    const layoutPath = 'app/layout.tsx';
    const layoutCode = snapshot.files.get(layoutPath);
    if (layoutCode) {
      const updatedLayout = ensureSmoothScrollInLayout(layoutCode);
      if (updatedLayout !== layoutCode) {
        changes.push({
          path: layoutPath,
          beforeHash: null,
          content: updatedLayout,
        });
      }
    }

    return {
      changes,
      config: nextCfg,
    };
  },
};

export const siteEffectsSmoothScrollGetOperation: Operation<
  {
    route?: string;
  },
  {
    config: SmoothScrollConfig | null;
  }
> = {
  name: 'siteEffects.smoothScroll.get',
  description: 'Read the smooth scroll configuration for a route',
  category: 'motion',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    route: z.string().optional().default('/'),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get('app/smooth-scroll.ts');
    if (!code) return { config: null };
    const map = parseSmoothScroll(code);
    return { config: resolveSmoothScroll(map, input.route ?? '/') };
  },
};

export const siteEffectsSmoothScrollRemoveOperation: Operation<
  {
    route?: string;
  },
  {
    changes: FileChange[];
    removedRoute: string;
  }
> = {
  name: 'siteEffects.smoothScroll.remove',
  description: 'Remove smooth scroll configuration for a route',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    route: z.string().optional().default('/'),
  }),
  async execute(snapshot, input) {
    const route = input.route ?? '/';
    const filePath = 'app/smooth-scroll.ts';
    const code = snapshot.files.get(filePath);
    if (!code) {
      return { changes: [], removedRoute: route };
    }

    const map = parseSmoothScroll(code);
    const nextMap = removeSmoothScrollFromMap(map, route);
    const newCode = serializeSmoothScroll(nextMap);

    return {
      changes: [
        {
          path: filePath,
          beforeHash: null,
          content: newCode,
        },
      ],
      removedRoute: route,
    };
  },
};

// ─── 2. Page Transitions ──────────────────────────────────────────────────────

function createPageEffect(preset: string, target = 'all', duration = 0.4): PageEffect {
  const enter = createDefaultSide();
  const exit = createDefaultSide();
  enter.transition.duration = duration;
  exit.transition.duration = duration;
  return {
    preset,
    target,
    enter,
    exit,
  };
}

export const siteEffectsPageTransitionSetOperation: Operation<
  {
    page?: string;
    preset?: string;
    duration?: number;
    target?: string;
  },
  {
    changes: FileChange[];
    effect: PageEffect;
  }
> = {
  name: 'siteEffects.pageTransition.set',
  description: 'Configure page view transitions (fade, crossfade, slide-left, etc.) in app/page-effects.ts',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    page: z.string().optional().default('/'),
    preset: z.string().optional().default('crossfade'),
    duration: z.number().positive().optional(),
    target: z.string().optional().default('all'),
  }),
  async execute(snapshot, input) {
    const page = input.page ?? '/';
    const filePath = 'app/page-effects.ts';
    const existingCode = snapshot.files.get(filePath) ?? '';
    const map = parsePageEffects(existingCode);

    const effect = createPageEffect(input.preset ?? 'crossfade', input.target ?? 'all', input.duration ?? 0.4);
    const nextMap = upsertEffectInMap(map, page, effect);
    const newCode = serializePageEffects(nextMap);

    return {
      changes: [
        {
          path: filePath,
          beforeHash: null,
          content: newCode,
        },
      ],
      effect,
    };
  },
};

export const siteEffectsPageTransitionGetOperation: Operation<
  {
    page?: string;
  },
  {
    effect: PageEffect | null;
  }
> = {
  name: 'siteEffects.pageTransition.get',
  description: 'Read page transition effect for a route',
  category: 'motion',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    page: z.string().optional().default('/'),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get('app/page-effects.ts');
    if (!code) return { effect: null };
    const map = parsePageEffects(code);
    const effects = listEffectsForPage(map, input.page ?? '/');
    return { effect: effects[0] ?? map.__default ?? null };
  },
};

export const siteEffectsPageTransitionRemoveOperation: Operation<
  {
    page?: string;
    target?: string;
  },
  {
    changes: FileChange[];
    removedPage: string;
  }
> = {
  name: 'siteEffects.pageTransition.remove',
  description: 'Remove page transition effect for a route',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    page: z.string().optional().default('/'),
    target: z.string().optional().default('all'),
  }),
  async execute(snapshot, input) {
    const page = input.page ?? '/';
    const filePath = 'app/page-effects.ts';
    const code = snapshot.files.get(filePath);
    if (!code) return { changes: [], removedPage: page };

    const map = parsePageEffects(code);
    const nextMap = removeEffectFromMap(map, page, input.target ?? 'all');
    const newCode = serializePageEffects(nextMap);

    return {
      changes: [
        {
          path: filePath,
          beforeHash: null,
          content: newCode,
        },
      ],
      removedPage: page,
    };
  },
};

// ─── 3. Custom Cursor ─────────────────────────────────────────────────────────

export const siteEffectsCursorSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    component: string;
    mode?: 'replace' | 'follow';
    side?: 'top' | 'right' | 'bottom' | 'left';
    offsetX?: number;
    offsetY?: number;
    variant?: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'siteEffects.cursor.set',
  description: 'Attach a custom cursor component to an element',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    component: z.string().min(1),
    mode: z.enum(['replace', 'follow']).optional(),
    side: z.enum(['top', 'right', 'bottom', 'left']).optional(),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    variant: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = addComponentCursorInCode(code, input.nodeId, {
      componentName: input.component,
      componentImportPath: `@/components/${input.component}`,
      mode: input.mode,
      side: input.side,
      offsetX: input.offsetX,
      offsetY: input.offsetY,
      variant: input.variant,
    });

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

export const siteEffectsCursorRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    removedId: string;
  }
> = {
  name: 'siteEffects.cursor.remove',
  description: 'Remove custom cursor attachment from an element',
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

    code = removeComponentCursorInCode(code, input.nodeId);

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

// ─── 4. Glide (Flow Layout Animation) ─────────────────────────────────────────

export const siteEffectsGlideSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    duration?: string;
    bounce?: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'siteEffects.glide.set',
  description: 'Attach Glide shared layout animation to a container node',
  category: 'motion',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T14',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    duration: z.string().optional(),
    bounce: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const spec: GlideSpec = {
      transition: {
        type: 'spring',
        duration: input.duration ?? '0.5',
        bounce: input.bounce ?? '0.25',
      },
    };

    code = setGlideInCode(code, input.nodeId, spec);

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

export const siteEffectsGlideGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    hasGlide: boolean;
    spec: GlideSpec | null;
  }
> = {
  name: 'siteEffects.glide.get',
  description: 'Read Glide shared layout animation configuration on a node',
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

    return {
      hasGlide: hasGlide(code, input.nodeId),
      spec: getGlide(code, input.nodeId),
    };
  },
};

export const siteEffectsGlideRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    removedId: string;
  }
> = {
  name: 'siteEffects.glide.remove',
  description: 'Remove Glide shared layout animation from a container',
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

    code = setGlideInCode(code, input.nodeId, null);

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

defaultRegistry.register(siteEffectsSmoothScrollSetOperation);
defaultRegistry.register(siteEffectsSmoothScrollGetOperation);
defaultRegistry.register(siteEffectsSmoothScrollRemoveOperation);
defaultRegistry.register(siteEffectsPageTransitionSetOperation);
defaultRegistry.register(siteEffectsPageTransitionGetOperation);
defaultRegistry.register(siteEffectsPageTransitionRemoveOperation);
defaultRegistry.register(siteEffectsCursorSetOperation);
defaultRegistry.register(siteEffectsCursorRemoveOperation);
defaultRegistry.register(siteEffectsGlideSetOperation);
defaultRegistry.register(siteEffectsGlideGetOperation);
defaultRegistry.register(siteEffectsGlideRemoveOperation);
