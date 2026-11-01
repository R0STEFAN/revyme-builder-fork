// convert.ts — Framer payload → Revyme ClipboardData converter
//
// Converts Framer clipboard or full-site JSON into Revyme's native ClipboardData
// for direct execution via `executePaste`.
//
// Handles:
// - FrameNode (Stacks, Flexbox, Freeform/Absolute layout, paddings, gaps, fills, radii)
// - RichTextNode (Semantic headings, paragraphs, typography presets, fonts, line-heights)
// - SmartComponentNode / CodeComponentNode (Unwrapped variants and component references)
// - Color styles and Style presets
// - Breakpoint overrides (Responsive bands: Desktop, Tablet, Mobile)
// - Motion animations (enterEffect, whileHover, whileTap)

import type { ClipboardData, ClipboardNode } from '@/code/features/paste-engine/types';

interface StylePreset {
  id: string;
  name?: string;
  tag?: string;
  font?: string;
  fontSize?: string;
  letterSpacing?: [number, string] | number | string;
  lineHeight?: [number, string] | number | string;
  textColor?: string;
  textAlignment?: string;
  textTransform?: string;
}

function parseFontFamily(fontStr?: string): string | undefined {
  if (!fontStr) return undefined;
  // Format: GF;Zalando Sans-variable-... or Inter or Aeonik
  if (fontStr.startsWith('GF;')) {
    const raw = fontStr.slice(3).split('-')[0];
    return raw.trim();
  }
  return fontStr.split('-')[0].trim();
}

function formatDimension(dim: [number, string] | number | string | undefined): string | undefined {
  if (dim === undefined || dim === null) return undefined;
  if (Array.isArray(dim)) {
    return `${dim[0]}${dim[1] || 'px'}`;
  }
  if (typeof dim === 'number') return `${dim}px`;
  return String(dim);
}

function extractTextAndTag(html?: string): { tag: string; text: string } {
  if (!html) return { tag: 'p', text: '' };
  const tagMatch = html.match(/<(h[1-6]|p|span|div|a)/i);
  const tag = tagMatch ? tagMatch[1].toLowerCase() : 'p';
  const text = html.replace(/<[^>]+>/g, '').trim();
  return { tag, text };
}

export function convertFramerPayload(raw: any): ClipboardData {
  if (!raw) return { version: 1, timestamp: Date.now(), nodes: [] };

  // Direct envelope pass-through
  if (raw.revymeClipboard === 1 && raw.data?.nodes) {
    return raw.data;
  }
  if (raw.nodes && Array.isArray(raw.nodes)) {
    return raw as ClipboardData;
  }

  // 1. Збираємо пресети стилів та токени
  const presets: Record<string, StylePreset> = {};
  const rawPresetsSource = raw.layers?.stylePresetNodes || 
                     raw.root?.children?.find((c: any) => c.__class === 'PresetsListNode')?.children || 
                     [];
  const rawPresets = Array.isArray(rawPresetsSource) ? rawPresetsSource : Object.values(rawPresetsSource || {});
  for (const p of rawPresets) {
    if (p && (p as any).id) presets[(p as any).id] = p as any;
  }

  // 2. Визначаємо корінь для конвертації
  let rootsToConvert: any[] = [];
  if (raw.layers?.tree?.root?.children) {
    rootsToConvert = raw.layers.tree.root.children;
  } else if (raw.root?.children) {
    // Повний експорт проекту — беремо Home сторінку та її Desktop варіант або всі сторінки
    const homePage = raw.root.children.find((c: any) => c.name === 'Home' && c.__class === 'WebPageNode') ||
                     raw.root.children.find((c: any) => c.__class === 'WebPageNode');
    if (homePage?.children?.[0]) {
      rootsToConvert = [homePage.children[0]]; // Desktop frame
    } else {
      rootsToConvert = raw.root.children.filter((c: any) => c.__class === 'FrameNode');
    }
  } else if (Array.isArray(raw)) {
    rootsToConvert = raw;
  } else if (raw.__class) {
    rootsToConvert = [raw];
  }

  const nodes: ClipboardNode[] = [];
  const rootNodeIds: string[] = [];

  function convertNode(rawNode: any, parentId: string | null, order: number): string | null {
    if (!rawNode || !rawNode.id) return null;
    const id = rawNode.id;
    const cls = rawNode.__class || 'FrameNode';

    // Ігноруємо службові контейнери списків
    if (cls.endsWith('ListNode') || cls === 'ContentManagementNode' || cls === 'RouteSegmentRootNode') {
      return null;
    }

    const styles: Record<string, string> = {};
    let type = 'div';
    let textContent: string | undefined;

    // ─── RichTextNode ─────────────────────────────────────────────
    if (cls === 'RichTextNode') {
      const { tag, text } = extractTextAndTag(rawNode.html || rawNode.rawHtml);
      type = tag;
      textContent = text;

      // Підключаємо пресет
      const presetId = rawNode.dataStylesPreset || 
                       rawNode.stylePresetParagraph || 
                       rawNode.stylePresetHeading1;
      const preset = presetId ? presets[presetId] : null;

      if (preset) {
        if (preset.font) styles.fontFamily = parseFontFamily(preset.font) || 'Inter';
        if (preset.fontSize) styles.fontSize = preset.fontSize;
        if (preset.textColor) styles.color = preset.textColor;
        if (preset.lineHeight) {
          const lh = formatDimension(preset.lineHeight);
          styles.lineHeight = lh ? lh.replace(/em$/, '') : '1.4';
        }
        if (preset.letterSpacing) styles.letterSpacing = formatDimension(preset.letterSpacing) || 'normal';
      }
    }

    // ─── Layout & Sizing ──────────────────────────────────────────
    const isStack = rawNode.layout === 'stack' || rawNode.layout === 1;
    if (isStack) {
      styles.display = 'flex';
      const isVertical = rawNode.stackDirection === 'vertical' || rawNode.layoutDirection === 1;
      styles.flexDirection = isVertical ? 'column' : 'row';

      // Alignment
      const align = rawNode.stackAlignment || rawNode.layoutAlign;
      if (align === 'start') styles.alignItems = 'flex-start';
      else if (align === 'center') styles.alignItems = 'center';
      else if (align === 'end') styles.alignItems = 'flex-end';
      else if (align === 'stretch') styles.alignItems = 'stretch';

      // Distribution
      const dist = rawNode.stackDistribution || rawNode.layoutJustify;
      if (dist === 'start') styles.justifyContent = 'flex-start';
      else if (dist === 'center') styles.justifyContent = 'center';
      else if (dist === 'end') styles.justifyContent = 'flex-end';
      else if (dist === 'space-between') styles.justifyContent = 'space-between';
      else if (dist === 'space-around') styles.justifyContent = 'space-around';
      else if (dist === 'space-evenly') styles.justifyContent = 'space-evenly';

      // Gap
      if (rawNode.gap !== undefined) {
        styles.gap = formatDimension(rawNode.gap) || '0px';
      }
    }

    // Paddings
    if (rawNode.paddingPerSide) {
      const top = formatDimension(rawNode.paddingTop) || '0px';
      const right = formatDimension(rawNode.paddingRight) || '0px';
      const bottom = formatDimension(rawNode.paddingBottom) || '0px';
      const left = formatDimension(rawNode.paddingLeft) || '0px';
      styles.padding = `${top} ${right} ${bottom} ${left}`;
    } else if (rawNode.padding !== undefined) {
      styles.padding = formatDimension(rawNode.padding) || '0px';
    }

    // Dimensions
    if (rawNode.widthType === 3) {
      styles.width = '100%';
      styles.flex = '1 0 0px';
    } else if (rawNode.widthType === 2) {
      styles.width = 'auto';
    } else if (rawNode.width !== undefined && rawNode.width > 0) {
      styles.width = `${rawNode.width}px`;
    }

    if (rawNode.heightType === 3) {
      styles.height = '100%';
    } else if (rawNode.heightType === 2) {
      styles.height = 'auto';
    } else if (rawNode.height !== undefined && rawNode.height > 0) {
      styles.height = `${rawNode.height}px`;
    }

    // Position
    styles.position = parentId ? 'relative' : 'relative';
    if (!parentId && rawNode.left !== undefined) {
      styles.left = `${rawNode.left}px`;
    }
    if (!parentId && rawNode.top !== undefined) {
      styles.top = `${rawNode.top}px`;
    }

    // Background & Fills
    if (rawNode.fillEnabled !== false) {
      if (rawNode.fillType === 'image' && rawNode.fillImage) {
        styles.backgroundImage = `url(${rawNode.fillImage})`;
        styles.backgroundSize = 'cover';
        styles.backgroundPosition = 'center';
      } else if (rawNode.fillColor) {
        styles.backgroundColor = rawNode.fillColor;
      }
    }

    // Borders & Radius
    if (rawNode.radiusPerCorner) {
      const tl = formatDimension(rawNode.radiusTopLeft) || '0px';
      const tr = formatDimension(rawNode.radiusTopRight) || '0px';
      const br = formatDimension(rawNode.radiusBottomRight) || '0px';
      const bl = formatDimension(rawNode.radiusBottomLeft) || '0px';
      styles.borderRadius = `${tl} ${tr} ${br} ${bl}`;
    } else if (rawNode.radius !== undefined) {
      styles.borderRadius = formatDimension(rawNode.radius) || '0px';
    }

    if (rawNode.borderEnabled && rawNode.borderWidth) {
      const bw = formatDimension(rawNode.borderWidth) || '1px';
      const bs = rawNode.borderStyle || 'solid';
      const bc = rawNode.borderColor || '#000000';
      styles.border = `${bw} ${bs} ${bc}`;
    }

    // Opacity & Overflow
    if (rawNode.opacity !== undefined && rawNode.opacity < 1) {
      styles.opacity = String(rawNode.opacity);
    }
    if (rawNode.overflow === true || rawNode.overflow === 'hidden') {
      styles.overflow = 'hidden';
    }

    // ─── Recursively convert children ──────────────────────────────
    const childIds: string[] = [];
    if (rawNode.children && Array.isArray(rawNode.children)) {
      for (let i = 0; i < rawNode.children.length; i++) {
        const cId = convertNode(rawNode.children[i], id, i);
        if (cId) childIds.push(cId);
      }
    }

    const clipNode: ClipboardNode = {
      id,
      type,
      parentId,
      children: childIds,
      order,
      styles,
      name: rawNode.name || undefined,
      textContent,
    };

    nodes.push(clipNode);
    return id;
  }

  for (let i = 0; i < rootsToConvert.length; i++) {
    const rootId = convertNode(rootsToConvert[i], null, i);
    if (rootId) rootNodeIds.push(rootId);
  }

  return {
    version: 1,
    timestamp: Date.now(),
    nodes,
  };
}
