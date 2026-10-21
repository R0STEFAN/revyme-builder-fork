// packages/automation-core/src/operations/catalog.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { CATEGORIES, CREATIVE_CATEGORIES, type InsertItem } from '@/shared/insert-items/element-data';
import { getInsertItem } from '@/shared/insert-items/insert-item-lookup';
import { addNodeInCode, type AddNodeDef } from '@/code/generation/generator-crud';
import { ensureComponentImport } from './components';

export interface CatalogItemDescriptor {
  id: string;
  name: string;
  category: string;
  description?: string;
  iconKey: string;
}

const DEFAULT_ITEM_SPECS: Record<
  string,
  {
    tag: string;
    defaultStyles: Record<string, string>;
    defaultAttrs?: Record<string, string>;
    textContent?: string;
  }
> = {
  frame: {
    tag: 'div',
    defaultStyles: { position: 'relative', width: '300px', height: '200px', backgroundColor: '#f3f4f6' },
  },
  column: {
    tag: 'div',
    defaultStyles: { display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', width: '100%' },
  },
  row: {
    tag: 'div',
    defaultStyles: { display: 'flex', flexDirection: 'row', gap: '16px', position: 'relative', width: '100%' },
  },
  button: {
    tag: 'button',
    defaultStyles: { padding: '10px 20px', backgroundColor: '#2563eb', color: '#ffffff', borderRadius: '6px', border: 'none' },
    textContent: 'Button',
  },
  heading: {
    tag: 'h2',
    defaultStyles: { fontSize: '24px', fontWeight: 'bold', margin: '0' },
    textContent: 'Heading',
  },
  paragraph: {
    tag: 'p',
    defaultStyles: { fontSize: '16px', color: '#4b5563', margin: '0' },
    textContent: 'Paragraph text goes here.',
  },
  image: {
    tag: 'img',
    defaultStyles: { width: '100%', height: 'auto', display: 'block' },
    defaultAttrs: { src: '/placeholder.jpg', alt: 'Image' },
  },
  video: {
    tag: 'video',
    defaultStyles: { width: '100%', height: 'auto' },
    defaultAttrs: { controls: '', src: '/sample.mp4' },
  },
  input: {
    tag: 'input',
    defaultStyles: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '4px' },
    defaultAttrs: { type: 'text', placeholder: 'Enter text...' },
  },
  'cs-carousel': {
    tag: 'Carousel',
    defaultStyles: { width: '600px', height: '400px', position: 'relative' },
  },
  'cs-emblaCarousel': {
    tag: 'EmblaCarousel',
    defaultStyles: { width: '800px', height: '450px', position: 'relative' },
  },
  'cs-marquee': {
    tag: 'Marquee',
    defaultStyles: { width: '800px', height: '160px', position: 'relative' },
  },
  'cs-ribbonMarquee': {
    tag: 'RibbonMarquee',
    defaultStyles: { width: '700px', height: '320px', position: 'relative' },
  },
  'cs-threeDMarquee': {
    tag: 'Marquee3D',
    defaultStyles: { width: '720px', height: '520px', position: 'relative' },
  },
  'cs-lensBox': {
    tag: 'LensBox',
    defaultStyles: { width: '400px', height: '300px', position: 'relative' },
  },
  'cs-magnetBox': {
    tag: 'MagnetBox',
    defaultStyles: { width: '400px', height: '300px', position: 'relative' },
  },
  'cs-counter': {
    tag: 'AnimatedCounter',
    defaultStyles: { width: '200px', height: '80px', position: 'relative' },
  },
};

function resolveItemTag(itemId: string): string {
  if (DEFAULT_ITEM_SPECS[itemId]) return DEFAULT_ITEM_SPECS[itemId].tag;
  if (itemId.startsWith('cs-')) {
    const raw = itemId.slice(3);
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  if (itemId.startsWith('shape-')) return 'svg';
  return 'div';
}

// 1. catalog.list
export const catalogListOperation: Operation<
  { category?: string },
  { items: CatalogItemDescriptor[] }
> = {
  name: 'catalog.list',
  description: 'List all available built-in catalog elements and code components',
  category: 'catalog',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    category: z.string().optional(),
  }),
  async execute(_snapshot, input) {
    const allCategories = [...CATEGORIES, ...CREATIVE_CATEGORIES];
    const items: CatalogItemDescriptor[] = [];

    for (const cat of allCategories) {
      if (input.category && cat.id !== input.category) continue;
      for (const section of cat.sections) {
        for (const it of section.items) {
          items.push({
            id: it.id,
            name: it.name,
            category: cat.id,
            description: it.description,
            iconKey: it.iconKey,
          });
        }
      }
    }

    return { items };
  },
};

// 2. catalog.get
export const catalogGetOperation: Operation<
  { itemId: string },
  { item: CatalogItemDescriptor | null; tag: string }
> = {
  name: 'catalog.get',
  description: 'Get details and default tag specification for a catalog item',
  category: 'catalog',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    itemId: z.string().min(1),
  }),
  async execute(_snapshot, input) {
    const it = getInsertItem(input.itemId);
    const tag = resolveItemTag(input.itemId);

    if (!it) {
      return { item: null, tag };
    }

    let category = 'general';
    for (const cat of [...CATEGORIES, ...CREATIVE_CATEGORIES]) {
      if (cat.sections.some((s) => s.items.some((i) => i.id === input.itemId))) {
        category = cat.id;
        break;
      }
    }

    return {
      item: {
        id: it.id,
        name: it.name,
        category,
        description: it.description,
        iconKey: it.iconKey,
      },
      tag,
    };
  },
};

// 3. catalog.place
export const catalogPlaceOperation: Operation<
  {
    targetFile: string;
    parentId: string;
    itemId: string;
    insertIndex?: number;
    name?: string;
    styles?: Record<string, string>;
    attrs?: Record<string, string>;
    textContent?: string;
  },
  {
    changes: FileChange[];
    nodeId: string;
    tag: string;
  }
> = {
  name: 'catalog.place',
  description: 'Place a built-in catalog element or code component into a page or layout',
  category: 'catalog',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    parentId: z.string().min(1),
    itemId: z.string().min(1),
    insertIndex: z.number().int().nonnegative().optional(),
    name: z.string().optional(),
    styles: z.record(z.string(), z.string()).optional(),
    attrs: z.record(z.string(), z.string()).optional(),
    textContent: z.string().optional(),
  }),
  async execute(snapshot, input, context) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const spec = DEFAULT_ITEM_SPECS[input.itemId];
    const tag = spec?.tag ?? resolveItemTag(input.itemId);
    const defaultStyles = spec?.defaultStyles ?? { position: 'relative' };
    const defaultAttrs = spec?.defaultAttrs ?? {};
    const defaultText = spec?.textContent;

    const nodeId = context.createId(tag.toLowerCase());

    const def: AddNodeDef = {
      id: nodeId,
      type: tag,
      name: input.name ?? spec?.tag ?? input.itemId,
      styles: {
        ...defaultStyles,
        ...(input.styles ?? {}),
      },
      attrs: {
        ...defaultAttrs,
        ...(input.attrs ?? {}),
      },
      textContent: input.textContent ?? defaultText,
    };

    code = addNodeInCode(code, input.parentId, def, input.insertIndex);

    // If tag is uppercase (component), ensure import
    if (/^[A-Z]/.test(tag)) {
      code = ensureComponentImport(code, tag);
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      nodeId,
      tag,
    };
  },
};

defaultRegistry.register(catalogListOperation);
defaultRegistry.register(catalogGetOperation);
defaultRegistry.register(catalogPlaceOperation);
