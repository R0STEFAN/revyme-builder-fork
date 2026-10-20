// src/code/oracle/preflight-validation.ts
//
// Shift-left preflight validation for MCP tools and agent semantic tools.
// Catches Oracle violations, dialect mismatches, and GUI uninspectable patterns
// AT THE TOOL CALL BOUNDARY, before writing to ProjectFS or the mutation queue.

import { TEXT_TAGS } from '@/shared/constants';
import { installBuiltInCodeComponent } from '@/code/project/project-fs';
import { FRAMEWORK_TAGS } from '@/ai/agent/tools/insert-fragment';
import { isAllowedImageSource, extractCssUrl, IMAGE_ATTR_KEYS } from './checks/image-source';

export const KNOWN_SLOT_COMPONENTS = new Set([
  'Marquee',
  'Carousel',
  'Slider',
  'EmblaCarousel',
  'LensBox',
]);

export const UNSUPPORTED_TAGS: Record<string, string> = {
  ul: 'lists are stacked FRAMES here: a flex column of row frames (icon + text), giving full control of spacing and markers',
  ol: 'lists are stacked FRAMES here: a flex column of row frames with a number text per row',
  li: 'list items are row FRAMES inside a flex column',
  dl: 'definition lists are stacked frames',
  dt: 'use a text element inside a frame',
  dd: 'use a text element inside a frame',
  menu: 'use a flex column of frames',
  table: 'tables are a GRID here: a frame with display grid and per-cell frames — fully editable, responsive per viewport',
  thead: 'use grid rows',
  tbody: 'use grid rows',
  tr: 'a grid row is just the next N cells',
  td: 'use a frame as the cell',
  th: 'use a text frame as the header cell',
  details: 'an accordion is a design COMPONENT with closed/open VARIANTS driven by a click connection (see the FAQ pattern)',
  summary: 'the accordion header is a frame inside the closed/open variants component',
  dialog: 'a modal is the OVERLAY dialect: data-overlay type "fixed", opened by a trigger, last child of root',
  iframe: 'embeds are CODE COMPONENTS (YouTubeEmbed, CalendlyEmbed, …) — a raw iframe has no editable surface',
};

export const SPACING_PX_KEYS = new Set([
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
]);

export const MINMAX_SIZE_KEYS = new Set(['minWidth', 'maxWidth', 'minHeight', 'maxHeight']);

export const TEXT_STYLE_PROPS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textAlign',
  'textDecoration',
  'textDecorationLine',
  'textDecorationStyle',
  'textDecorationColor',
  'textDecorationThickness',
  'textUnderlineOffset',
  'textShadow',
  'whiteSpace',
  'textOverflow',
  'wordBreak',
  'textIndent',
  'color',
  'WebkitTextStroke',
  'WebkitTextStrokeWidth',
  'WebkitTextStrokeColor',
  'WebkitTextFillColor',
]);

export const PURE_TYPOGRAPHY_PROPS = new Set([
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textAlign',
]);

const SHORTHAND_FAMILIES: Array<[string, string[]]> = [
  ['padding', ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingBlock', 'paddingInline']],
  ['margin', ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginBlock', 'marginInline']],
  ['borderRadius', ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']],
  [
    'border',
    [
      'borderWidth', 'borderStyle', 'borderColor', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    ],
  ],
  ['borderWidth', ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']],
  ['borderColor', ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']],
  ['borderStyle', ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle']],
  ['gap', ['rowGap', 'columnGap']],
  ['overflow', ['overflowX', 'overflowY']],
];

/**
 * Validates style payload before execution.
 * Catches CSS transitions/animations, invalid units, shorthand conflicts, and pseudo-classes.
 */
export function validateStyleInput(
  styles: Record<string, unknown> | undefined,
  opts?: { isTextNode?: boolean; tagName?: string; fs?: { readFile: (p: string) => string | null } }
): string | null {
  if (!styles || typeof styles !== 'object') return null;

  // 1. Background color + Image conflict
  if (
    (('backgroundColor' in styles && Boolean(styles.backgroundColor)) || ('background' in styles && Boolean(styles.background))) &&
    ('backgroundImage' in styles && Boolean(styles.backgroundImage))
  ) {
    return `Cannot set both backgroundColor and backgroundImage on the same element. In Revyme, background colors must be part of the fill gradient/layer or standalone.`;
  }

  const keys = Object.keys(styles);

  for (const key of keys) {
    const val = styles[key];
    const strVal = typeof val === 'string' ? val.trim() : typeof val === 'number' ? String(val) : '';

    // Check backgroundImage / background for url(...)
    if ((key === 'backgroundImage' || key === 'background') && strVal.includes('url(')) {
      const extracted = extractCssUrl(strVal);
      if (extracted && !isAllowedImageSource(extracted, opts?.fs ? new Set() : undefined)) {
        return `Invalid ${key} url "${extracted}". In Revyme, image assets must either be an external link (URL: https://...) or uploaded directly into this project via upload (e.g. /api/uploads/...). Arbitrary local filesystem paths outside this project (such as /images/...) are forbidden.`;
      }
    }

    // 1. Pseudo-classes or CSS selectors inside style keys
    if (key.startsWith(':') || key.startsWith('&') || key.includes(':') || key.startsWith('.')) {
      return `CSS pseudo-class or selector "${key}" cannot be passed in inline styles. In Revyme, use revyme_insert_fragment with the 'hover' property, apply component variants via revyme_set_variant / revyme_add_connection, or call revyme_apply_motion_preset.`;
    }

    // 2. CSS transition or animation properties
    if (/^transition(Property|Duration|Delay|TimingFunction)?$/i.test(key) && strVal !== '') {
      return `CSS property "${key}" cannot be edited visually in Revyme. Transitions and animations must be defined using Framer Motion (whileHover, motion presets, or motion components).`;
    }
    if (/^animation.*$/i.test(key) && strVal !== '') {
      return `CSS property "${key}" cannot be edited visually in Revyme. Transitions and animations must be defined using Framer Motion (whileHover, motion presets, or motion components).`;
    }

    // 3. CSS custom properties (--*)
    if (key.startsWith('--')) {
      return `Custom CSS property "${key}" has no editable surface in Revyme panels. Write concrete values directly or reference design token presets (e.g. globals.css presets).`;
    }

    // 4. Spacing px-only validation
    if (SPACING_PX_KEYS.has(key) && strVal !== '' && strVal !== 'auto') {
      if (strVal !== '0' && strVal !== '0px') {
        if (/rem|em|%|vh|vw|calc/i.test(strVal)) {
          return `Property "${key}" value "${strVal}" must be in pixels (e.g. "24px"). Percentages, rem, and em are not supported in spacing properties.`;
        }
      }
    }

    // 5. Min/Max size unit constraints
    if (MINMAX_SIZE_KEYS.has(key) && strVal !== '' && strVal !== 'none' && strVal !== 'auto') {
      if (/vh|vw|em|rem|calc|min-content|max-content|fit-content/i.test(strVal)) {
        return `Property "${key}" value "${strVal}" is invalid. Size constraints (min/max) only accept plain 'px' or '%' values (e.g. '100%', '400px'). Viewport units (vh/vw) and calc() are unsupported by visual controls.`;
      }
    }

    // 6. Unitless lineHeight
    if (key === 'lineHeight' && strVal !== '' && strVal !== 'normal') {
      if (/px|rem|em|%/i.test(strVal)) {
        return `lineHeight must be a unitless multiplier (e.g. '1.2', '1.5'), not a pixel or unit value like "${strVal}".`;
      }
    }

    // 7. Typography on container frames
    if (opts?.isTextNode === false && PURE_TYPOGRAPHY_PROPS.has(key) && strVal !== '') {
      const tag = opts.tagName ?? 'container';
      return `Typography property "${key}" cannot be placed on container "<${tag}>". In Revyme, text styles live ON the text element itself (<p>, <span>, <h1>-<h6>, <a>) — never on a parent wrapper.`;
    }
  }


  // 9. Shorthand / Longhand mix
  for (const [short, longs] of SHORTHAND_FAMILIES) {
    const si = keys.indexOf(short);
    if (si === -1) continue;
    const dead = keys.filter((k) => longs.includes(k) && keys.indexOf(k) < si);
    if (dead.length > 0) {
      return `Cannot mix longhand property "${dead[0]}" before shorthand "${short}" in the same style object. React applies style keys in object order, so the later "${short}" resets it. Write ONE form: use either shorthand alone or longhands alone.`;
    }
  }

  return null;
}

/**
 * Validates node tag before creation.
 * Checks for unsupported HTML tags, slot parent restrictions, and unknown components.
 */
export function validateTagInput(
  tag: string | undefined,
  parentNode?: { type?: string; id?: string } | null,
  fs?: { readFile: (p: string) => string | null }
): string | null {
  const t = (tag ?? 'div').trim();
  const base = t.startsWith('motion.') ? t.slice(7) : t;

  // 1. Parent is a slot component
  if (parentNode?.type) {
    const parentTag = parentNode.type.startsWith('motion.') ? parentNode.type.slice(7) : parentNode.type;
    if (KNOWN_SLOT_COMPONENTS.has(parentTag)) {
      return `<${parentTag}> (data-id="${parentNode.id ?? '?'}") is a slot component. The canvas renders code-component slot items ONLY as connected free-canvas nodes. Inline children deploy to the live site but stay invisible on the canvas. Create items via revyme_add_canvas_node, and connect them with revyme_connect_slot (slot="children").`;
    }
  }

  // 2. Unsupported HTML tags
  if (UNSUPPORTED_TAGS[base]) {
    return `<${base}> is not supported by Revyme visual engine: ${UNSUPPORTED_TAGS[base]}. Build it natively instead.`;
  }

  // 3. Unknown components
  if (/^[A-Z]/.test(base)) {
    if (fs) {
      installBuiltInCodeComponent(fs as any, base);
      const inComp = fs.readFile(`components/${base}.tsx`) != null;
      const inIcons = fs.readFile(`icons/${base}.tsx`) != null;
      if (!inComp && !inIcons && !FRAMEWORK_TAGS.has(base)) {
        return `Component "${base}" does not exist in components/. Following Revyme's Design-System-First (DS-First) protocol, please create this component first via create_component (revyme_agent_tool) or revyme_add_built_in_component before referencing it.`;
      }
    }
  }

  return null;
}

/**
 * Validates individual image source string.
 */
export function validateImageSourceInput(
  src: string | undefined,
  propName = 'src',
  fs?: { readFile: (p: string) => string | null }
): string | null {
  if (typeof src !== 'string' || !src.trim()) return null;
  const projectFiles = fs ? new Set<string>() : undefined;
  if (!isAllowedImageSource(src, projectFiles)) {
    return `Invalid image source "${src}" on attribute "${propName}". In Revyme, images must either be an external link (URL: https://...) or uploaded directly into this project via upload (e.g. /api/uploads/...). Arbitrary local filesystem paths outside this project (such as /images/...) are forbidden.`;
  }
  return null;
}

/**
 * Validates HTML attributes / component props map before execution.
 * Checks for invalid image paths on src, image, thumbnail, avatar, and poster attributes.
 */
export function validateAttributesInput(
  attrs: Record<string, unknown> | undefined,
  fs?: { readFile: (p: string) => string | null }
): string | null {
  if (!attrs || typeof attrs !== 'object') return null;
  for (const key of Object.keys(attrs)) {
    if (IMAGE_ATTR_KEYS.has(key)) {
      const val = attrs[key];
      if (typeof val === 'string') {
        const err = validateImageSourceInput(val, key, fs);
        if (err) return err;
      }
    }
  }
  return null;
}
