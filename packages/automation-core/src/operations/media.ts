// packages/automation-core/src/operations/media.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { updateHtmlAttrsInCode } from '@/code/generation/generator-attrs';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import { setVideoFillInCode, removeVideoFillInCode, type BgVideoOpts } from '@/code/generation/generator-video';
import { scanTagAttrs, readTagAttr } from '@/code/components/jsx-tag-attrs';
import { findJSXDataIdIndex, findTagClose } from '@/code/generation/generator-utils';
import { inferImageSizes } from '@/shared/image-utils';

// 1. media.image.get
export const mediaImageGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    src: string | null;
    alt: string | null;
    sizes: string | null;
    loading: string | null;
    objectFit: string | null;
  }
> = {
  name: 'media.image.get',
  description: 'Read image attributes and styling on an element',
  category: 'media',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const idIndex = findJSXDataIdIndex(code, input.nodeId);
    if (idIndex === -1) {
      throw new Error(`NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const tagStart = code.lastIndexOf('<', idIndex);
    const tagEnd = findTagClose(code, idIndex);
    if (tagStart === -1 || tagEnd === -1) {
      throw new Error(`TAG_NOT_FOUND: Could not locate tag boundaries for "${input.nodeId}"`);
    }

    const tagStr = code.slice(tagStart, tagEnd + 1);
    const srcAttr = readTagAttr(tagStr, 'src');
    const altAttr = readTagAttr(tagStr, 'alt');
    const sizesAttr = readTagAttr(tagStr, 'sizes');
    const loadingAttr = readTagAttr(tagStr, 'loading');

    // Check style for objectFit
    const styleMatch = tagStr.match(/objectFit:\s*['"]([^'"]+)['"]/);

    const attrToString = (attr: ReturnType<typeof readTagAttr>): string | null => {
      if (!attr) return null;
      if (attr.kind === 'string') return attr.text;
      if (attr.kind === 'expr') return attr.source;
      return '';
    };

    return {
      src: attrToString(srcAttr),
      alt: attrToString(altAttr),
      sizes: attrToString(sizesAttr),
      loading: attrToString(loadingAttr),
      objectFit: styleMatch ? styleMatch[1] : null,
    };
  },
};

// 2. media.image.set
export const mediaImageSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    src?: string;
    alt?: string;
    sizes?: string;
    loading?: 'lazy' | 'eager' | '';
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down' | '';
    autoSizes?: boolean;
    elementWidth?: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'media.image.set',
  description: 'Set or remove image attributes and responsive sizes (Invariant 3: empty string removes property)',
  category: 'media',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    src: z.string().optional(),
    alt: z.string().optional(),
    sizes: z.string().optional(),
    loading: z.enum(['lazy', 'eager', '']).optional(),
    objectFit: z.enum(['cover', 'contain', 'fill', 'none', 'scale-down', '']).optional(),
    autoSizes: z.boolean().optional(),
    elementWidth: z.number().int().positive().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const attrsToUpdate: Record<string, string> = {};
    if (input.src !== undefined) attrsToUpdate.src = input.src;
    if (input.alt !== undefined) attrsToUpdate.alt = input.alt;
    if (input.loading !== undefined) attrsToUpdate.loading = input.loading;

    if (input.sizes !== undefined) {
      attrsToUpdate.sizes = input.sizes;
    } else if (input.autoSizes && input.elementWidth) {
      attrsToUpdate.sizes = inferImageSizes({ width: input.elementWidth });
    }

    if (Object.keys(attrsToUpdate).length > 0) {
      code = updateHtmlAttrsInCode(code, input.nodeId, attrsToUpdate);
    }

    if (input.objectFit !== undefined) {
      code = updateNodeInCode(code, input.nodeId, { objectFit: input.objectFit });
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

// 3. media.video.set
export const mediaVideoSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    src?: string;
    poster?: string;
    autoPlay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
    playsInline?: boolean;
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
    asBackground?: boolean;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'media.video.set',
  description: 'Configure video properties or insert a background video fill into a container element',
  category: 'media',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    src: z.string().optional(),
    poster: z.string().optional(),
    autoPlay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    controls: z.boolean().optional(),
    playsInline: z.boolean().optional(),
    objectFit: z.enum(['cover', 'contain', 'fill', 'none', 'scale-down']).optional(),
    asBackground: z.boolean().optional().default(false),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }
    if (input.asBackground) {
      const opts: BgVideoOpts = {};
      if (input.src !== undefined) opts.src = input.src;
      if (input.poster !== undefined) opts.poster = input.poster;
      if (input.autoPlay !== undefined) opts.autoPlay = input.autoPlay;
      if (input.muted !== undefined) opts.muted = input.muted;
      if (input.loop !== undefined) opts.loop = input.loop;
      if (input.controls !== undefined) opts.controls = input.controls;
      if (input.playsInline !== undefined) opts.playsInline = input.playsInline;
      if (input.objectFit !== undefined) opts.objectFit = input.objectFit;
      code = setVideoFillInCode(code, input.nodeId, opts);
    } else {
      const attrsToUpdate: Record<string, string> = {};
      if (input.src !== undefined) attrsToUpdate.src = input.src;
      if (input.poster !== undefined) attrsToUpdate.poster = input.poster;
      if (input.autoPlay !== undefined) attrsToUpdate.autoPlay = input.autoPlay ? 'true' : '';
      if (input.muted !== undefined) attrsToUpdate.muted = input.muted ? 'true' : '';
      if (input.loop !== undefined) attrsToUpdate.loop = input.loop ? 'true' : '';
      if (input.controls !== undefined) attrsToUpdate.controls = input.controls ? 'true' : '';

      code = updateHtmlAttrsInCode(code, input.nodeId, attrsToUpdate);
      if (input.objectFit !== undefined) {
        code = updateNodeInCode(code, input.nodeId, { objectFit: input.objectFit });
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
    };
  },
};

// 4. media.video.remove
export const mediaVideoRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    asBackground?: boolean;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'media.video.remove',
  description: 'Remove background video fill or video element sources',
  category: 'media',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    asBackground: z.boolean().optional().default(false),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    if (input.asBackground) {
      code = removeVideoFillInCode(code, input.nodeId);
    } else {
      code = updateHtmlAttrsInCode(code, input.nodeId, {
        src: '',
        poster: '',
        controls: '',
        autoPlay: '',
        muted: '',
        loop: '',
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
    };
  },
};

defaultRegistry.register(mediaImageGetOperation);
defaultRegistry.register(mediaImageSetOperation);
defaultRegistry.register(mediaVideoSetOperation);
defaultRegistry.register(mediaVideoRemoveOperation);
