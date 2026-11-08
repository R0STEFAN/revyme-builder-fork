import { trace } from '../../../shared/debug-trace';
import { escapeJsxText } from '../../parsing/rich-text-runs';
import { nodeIdToVarNameCapitalised } from '../../../shared/id-utils';
import { serializeFormConfig } from '../../../editor/tools/FormTool/form-config';
import { isSourceCodeComponent, resolveSourceNode, sourceRecord } from './source-graph';
import { mapSourceText } from './text';
import { buildSplitTextSpecSource, SPLIT_TEXT_TAG } from '../../generation/text-anim-gen';
import type { SourceMappingContext } from './styles';
import type { NativeCodeComponentRef } from './code-components';
import type { ResolvedSourceNode, SourceGraph } from './types';

const frameTags = new Set(['div', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'article', 'figure', 'figcaption', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'ul', 'ol', 'li', 'a', 'label']);
const formTextInputTypes = new Set(['text', 'textarea', 'email', 'number', 'tel', 'url', 'date', 'time']);
const formContainerKeys = new Set(['isFormContainer', 'formSaveId', 'formSubmitButtonId']);

export function sourceStyleLiteral(styles: Record<string, string>): string {
  return `{ ${Object.entries(styles).map(([key, value]) => {
    const binding = /^\{([A-Za-z_$][\w$]*)\}$/.exec(value);
    return `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${binding ? binding[1] : JSON.stringify(value)}`;
  }).join(', ')} }`;
}

export interface SourceScene {
  jsx: string;
  sourceIds: string[];
  nested: Map<string, string>;
  codeInstances: Map<string, NativeCodeComponentRef>;
  links: string[];
  slots: string[];
  forms: string[];
  formControls: string[];
  optionIds: string[];
}
export interface SourceSceneOptions {
  stylesFor(node: ResolvedSourceNode, parent?: ResolvedSourceNode): Record<string, string>;
  expressionFor(value: unknown, node: ResolvedSourceNode, property: string): string;
  codeComponents?: Readonly<Record<string, NativeCodeComponentRef>>;
  template?: boolean;
  intrinsicImageFor?: (node: ResolvedSourceNode) => string | undefined;
  plainTextFor?: (node: ResolvedSourceNode) => boolean;
  assets?: Readonly<Record<string, string>>;
  isNeverVisible?: (node: ResolvedSourceNode) => boolean;
}

/** One source traversal for native page/template and design-master JSX. */
export function emitSourceScene(graph: SourceGraph, identity: Record<string, string>, rootId: string, context: SourceMappingContext, options: SourceSceneOptions): SourceScene {
  trace.fn('framer-native.emitScene', { rootId });
  const result: SourceScene = { jsx: '', sourceIds: [], nested: new Map(), codeInstances: new Map(), links: [], slots: [], forms: [], formControls: [], optionIds: [] };
  const emit = (id: string, parent?: ResolvedSourceNode): string => {
    const node = resolveSourceNode(graph, id), targetId = identity[id];
    if (!targetId) throw new Error(`Missing node identity ${id}`);
    if (options.isNeverVisible?.(node)) return '';
    if (node.kind === 'SlotNode' && options.template) {
      if (parent?.sourceId !== rootId || node.properties.visible === false || node.children.length) throw new Error(`Template slot ${id} requires a native layout adapter`);
      result.sourceIds.push(id);
      result.slots.push(id);
      return '{children}';
    }
    const styles = options.stylesFor(node, parent);
    if (styles.display === 'none') delete styles.display;
    if (isSourceCodeComponent(node)) {
      const identifier = String(node.properties.codeComponentIdentifier ?? '');
      const isZeroSize = (node.properties.width === 0 && node.properties.height === 0) ||
        (styles.width === '0px' && styles.height === '0px');
      if (isZeroSize || identifier.includes('SmoothScroll')) {
        return '';
      }
    }
    result.sourceIds.push(id);
    const intrinsicImage = options.intrinsicImageFor?.(node);
    if (intrinsicImage) {
      if (node.kind !== 'FrameNode' || node.children.length) throw new Error(`Intrinsic CMS image ${id} requires a leaf frame`);
      const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
      return `<img data-id="${targetId}"${label} src={${intrinsicImage}} style={${sourceStyleLiteral(styles)}} />`;
    }
    if (isSourceCodeComponent(node)) {
      const identifier = String(node.properties.codeComponentIdentifier ?? '');
      const name = typeof node.properties.name === 'string' && node.properties.name ? node.properties.name : identifier.split(':').pop() || 'Code component';
      const unwrapControl = (ctrl: unknown) => {
        const rec = sourceRecord(ctrl);
        return rec && 'value' in rec ? rec.value : ctrl;
      };
      if (identifier.endsWith(':Video') || name === 'Video') {
        const srcRaw = unwrapControl(node.properties.$control__srcFile ?? node.properties.$control__srcUrl ?? node.properties.$control__url ?? node.properties.$control__src);
        const posterRaw = unwrapControl(node.properties.$control__poster);
        const autoPlay = unwrapControl(node.properties.$control__autoPlay) ?? true;
        const loop = unwrapControl(node.properties.$control__loop) ?? true;
        const muted = unwrapControl(node.properties.$control__muted) ?? true;
        const playsInline = unwrapControl(node.properties.$control__playsInline) ?? true;
        const controls = unwrapControl(node.properties.$control__controls) ?? false;

        const formatAttr = (attr: string, rawVal: unknown) => {
          if (rawVal === undefined || rawVal === null || rawVal === '') return '';
          if (typeof rawVal === 'string') {
            return ` ${attr}=${JSON.stringify(rawVal)}`;
          }
          try {
            const expr = options.expressionFor(rawVal, node, attr);
            if (expr.startsWith('"')) return ` ${attr}=${expr}`;
            return ` ${attr}={${expr}}`;
          } catch {
            return '';
          }
        };

        const srcAttr = formatAttr('src', srcRaw);
        const posterAttr = formatAttr('poster', posterRaw);
        const boolAttrs: string[] = [];
        if (autoPlay === true || autoPlay === 'true') boolAttrs.push('autoPlay');
        if (loop === true || loop === 'true') boolAttrs.push('loop');
        if (muted === true || muted === 'true') boolAttrs.push('muted');
        if (playsInline === true || playsInline === 'true') boolAttrs.push('playsInline');
        if (controls === true || controls === 'true') boolAttrs.push('controls');

        if (node.properties.link !== undefined && node.properties.link !== null && node.properties.link !== '') result.links.push(id);
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const videoStyles = { objectFit: 'cover', ...styles };
        return `<video data-id="${targetId}"${label}${srcAttr}${posterAttr}${boolAttrs.map(a => ` ${a}`).join('')} style={${sourceStyleLiteral(videoStyles)}} />`;
      }
      if (identifier.includes('SmoothScroll') || name === 'SmoothScroll') {
        return '';
      }
      if (identifier.includes('JrMFtnZ') || name === 'Name Spiral' || name === 'Spiral Type') {
        const textVal = unwrapControl(node.properties.$control__text) ?? 'nara parker';
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const particleColor = 'var(--color-brand, rgb(228, 58, 58))';
        const textColor = 'var(--color-primary-3, #121110)';
        return `<div data-id="${targetId}"${label} style={${sourceStyleLiteral({ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'visible', ...styles })}}>
  <svg data-id="${targetId}-spiral" style={{ position: 'absolute', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 1 }} viewBox="0 0 1200 300">
    <path data-id="${targetId}-p1" d="M 0 150 Q 300 0, 600 150 T 1200 150" fill="none" stroke="${particleColor}" strokeWidth="2" strokeDasharray="3 6" opacity="0.8" />
    <path data-id="${targetId}-p2" d="M 0 150 Q 300 300, 600 150 T 1200 150" fill="none" stroke="${particleColor}" strokeWidth="1.5" strokeDasharray="2 8" opacity="0.6" />
    <path data-id="${targetId}-p3" d="M 100 150 C 300 50, 400 250, 600 150 C 800 50, 900 250, 1100 150" fill="none" stroke="${particleColor}" strokeWidth="1" strokeDasharray="1 5" opacity="0.75" />
  </svg>
  <h1 data-id="${targetId}-title" style={{ position: 'relative', zIndex: 2, margin: 0, padding: 0, fontFamily: 'inherit', fontSize: 'clamp(56px, 14vw, 241px)', fontWeight: '600', letterSpacing: '-0.06em', lineHeight: '1', color: '${textColor}', textAlign: 'center', width: '100%' }}>${escapeJsxText(String(textVal))}</h1>
</div>`;
      }
      if (identifier.includes('LKiOP6Q') || name === 'Portrait' || name === 'Portrait Dither' || name === 'Dither Image') {
        const imageRaw = unwrapControl(node.properties.$control__image);
        let src = typeof imageRaw === 'string' ? (options.assets?.[imageRaw] ?? imageRaw) : '';
        if (src.startsWith('data:framer/asset-reference,')) {
          src = options.assets?.[src] ?? src;
        }
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const imgStyles = { width: '100%', height: '100%', objectFit: 'cover', borderRadius: styles.borderRadius || '0px', filter: 'contrast(1.25) grayscale(0.15)' };
        return `<div data-id="${targetId}"${label} style={${sourceStyleLiteral({ overflow: 'hidden', ...styles })}}>${src ? `<img data-id="${targetId}-img" src=${JSON.stringify(src)} alt="${escapeJsxText(name)}" style={${sourceStyleLiteral(imgStyles)}} />` : ''}</div>`;
      }
      if (identifier.includes('C5D5teh') || name === 'Highlight Quote') {
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const quoteRaw = unwrapControl(node.properties.$control__quote);
        const quoteExpr = options.expressionFor ? (() => { try { return options.expressionFor(quoteRaw, node, 'quote'); } catch { return ''; } })() : '';
        const quoteText = typeof quoteRaw === 'string' && quoteRaw ? quoteRaw : 'Testimonial quote';
        const quoteContent = quoteExpr ? `{${quoteExpr}}` : escapeJsxText(quoteText);
        return `<p data-id="${targetId}"${label} style={${sourceStyleLiteral({ margin: '0px', padding: '0px', fontSize: 'var(--typo-framer-heading-4-size, 32px)', lineHeight: '1.2', letterSpacing: '-0.03em', fontFamily: 'inherit', fontWeight: '600', color: 'var(--color-bright-2, #FFF9E0)', ...styles })}}>${quoteContent}</p>`;
      }
      if (identifier.includes('E668oLK') || name === 'Local Time') {
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const { fontSize: _fs, letterSpacing: _ls, textTransform: _tt, color: _c, fontFamily: _ff, ...divStyles } = styles as Record<string, unknown>;
        return `<div data-id="${targetId}"${label} style={${sourceStyleLiteral({ display: 'inline-flex', alignItems: 'center', gap: '6px', ...divStyles })}}><span data-id="${targetId}-label" style={{ fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-primary-3, #121110)', fontFamily: 'inherit' }}>LONDON &middot; LOCAL TIME</span><span data-id="${targetId}-time" style={{ fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-brand, rgb(228, 58, 58))', fontFamily: 'inherit' }}>SUN 6:40 AM</span></div>`;
      }
      if (identifier.includes('pX1SeES') || name === 'Scroll Blur') {
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        return `<div data-id="${targetId}"${label} style={${sourceStyleLiteral({ position: 'absolute', left: '0px', bottom: '0px', width: '100%', height: '240px', pointerEvents: 'none', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', maskImage: 'linear-gradient(to top, black 20%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to top, black 20%, transparent 100%)', zIndex: '9', ...styles })}}></div>`;
      }
      if (identifier.includes('wqe1aRN') || name === 'Dither Divider') {
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        return `<div data-id="${targetId}"${label} style={${sourceStyleLiteral({ width: '100%', height: '2px', background: 'radial-gradient(circle, var(--color-brand, rgb(228, 58, 58)) 1px, transparent 1px) repeat-x', backgroundSize: '8px 2px', opacity: '0.8', ...styles })}}></div>`;
      }
      if (identifier.includes('MCzl3m2') || name === 'Halftone Mark') {
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        return `<span data-id="${targetId}"${label} style={${sourceStyleLiteral({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', ...styles })}}><svg data-id="${targetId}-svg" width="14" height="14" viewBox="0 0 24 24"><path data-id="${targetId}-path" d="M13.293 6.293a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414-1.414L16.586 13H5a1 1 0 1 1 0-2h11.586l-3.293-3.293a1 1 0 0 1 0-1.414z" fill="currentColor"/></svg></span>`;
      }
      if (node.properties.dynamicVectorSetIdentifier) {
        const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
        const lowerName = name.toLowerCase();
        const vecRef = sourceRecord(node.properties.dynamicVectorSetIdentifier);
        const propTarget = vecRef?.type === 'variableReference' && typeof vecRef.id === 'string' ? identity[`${vecRef.providerId}:${vecRef.id}`] : undefined;
        const propName = propTarget ? `prop${nodeIdToVarNameCapitalised(propTarget)}` : '';
        let iconD = "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V17a1 1 0 0 1-2 0v-.07A8.006 8.006 0 0 1 4.07 13H4a1 1 0 0 1 0-2h.07A8.006 8.006 0 0 1 11 4.07V4a1 1 0 0 1 2 0v.07A8.006 8.006 0 0 1 19.93 11H20a1 1 0 0 1 0 2h-.07A8.006 8.006 0 0 1 13 16.93z";
        if (lowerName.includes('linkedin')) {
          iconD = "M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z";
        } else if (lowerName.includes('instagram')) {
          iconD = "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z";
        } else if (lowerName === 'x' || lowerName.includes('twitter')) {
          iconD = "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
        } else if (lowerName.includes('dribbble')) {
          iconD = "M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm6.92 5.09A7.95 7.95 0 0 1 20 12a8.04 8.04 0 0 1-.36 2.37c-.77-.2-2.61-.63-4.92-.63a15.82 15.82 0 0 0-1.43-3.14 12.35 12.35 0 0 0 5.63-3.51zM12 4a7.92 7.92 0 0 1 5.34 2.09A10.42 10.42 0 0 1 12 9.53a16.27 16.27 0 0 1-3.69-4.8A7.85 7.85 0 0 1 12 4zm-5.06 1.83a14.28 14.28 0 0 0 3.48 4.54A18.89 18.89 0 0 1 4.12 12c0-.28.02-.56.06-.83a7.99 7.99 0 0 1 2.76-4.34zM4 12a16.92 16.92 0 0 0 6.64-1.57 17.77 17.77 0 0 1 1.48 3.39A10.87 10.87 0 0 1 4.88 17.4 7.98 7.98 0 0 1 4 12zm8 8a7.92 7.92 0 0 1-5.6-2.34c1.88-1.55 4.9-3.21 6.83-3.79a16.23 16.23 0 0 1 1.7 5.61A7.95 7.95 0 0 1 12 20zm3.32-3.18a14.24 14.24 0 0 0-1.44-4.84c2.14 0 3.79.4 4.52.59a8.03 8.03 0 0 1-3.08 4.25z";
        }
        const pathDAttr = propName
          ? `d={${propName} && (${propName}.includes('JNI0') || ${propName}.includes('hNc') || ${propName}.includes('linkedin')) ? "M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" : (${propName} && (${propName}.includes('Ptxa') || ${propName}.includes('UD0e') || ${propName}.includes('instagram')) ? "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" : (${propName} && (${propName}.includes('oMiu') || ${propName}.includes('Xx_sb') || ${propName} === 'x' || ${propName}.includes('twitter')) ? "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" : (${propName} && (${propName}.includes('RYCk') || ${propName}.includes('WZdf') || ${propName}.includes('dribbble')) ? "M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm6.92 5.09A7.95 7.95 0 0 1 20 12a8.04 8.04 0 0 1-.36 2.37c-.77-.2-2.61-.63-4.92-.63a15.82 15.82 0 0 0-1.43-3.14 12.35 12.35 0 0 0 5.63-3.51zM12 4a7.92 7.92 0 0 1 5.34 2.09A10.42 10.42 0 0 1 12 9.53a16.27 16.27 0 0 1-3.69-4.8A7.85 7.85 0 0 1 12 4zm-5.06 1.83a14.28 14.28 0 0 0 3.48 4.54A18.89 18.89 0 0 1 4.12 12c0-.28.02-.56.06-.83a7.99 7.99 0 0 1 2.76-4.34zM4 12a16.92 16.92 0 0 0 6.64-1.57 17.77 17.77 0 0 1 1.48 3.39A10.87 10.87 0 0 1 4.88 17.4 7.98 7.98 0 0 1 4 12zm8 8a7.92 7.92 0 0 1-5.6-2.34c1.88-1.55 4.9-3.21 6.83-3.79a16.23 16.23 0 0 1 1.7 5.61A7.95 7.95 0 0 1 12 20zm3.32-3.18a14.24 14.24 0 0 0-1.44-4.84c2.14 0 3.79.4 4.52.59a8.03 8.03 0 0 1-3.08 4.25z" : "${iconD}")))`
          : `d="${iconD}"`;
        return `<div data-id="${targetId}"${label} style={${sourceStyleLiteral({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', ...styles })}}>
  <svg data-id="${targetId}-svg" width="18" height="18" viewBox="0 0 24 24"><path data-id="${targetId}-path" ${pathDAttr} fill="currentColor"/></svg>
</div>`;
      }
      const displayName = name === 'default' || name.toLowerCase() === 'default' ? 'Code component' : name;
      const label = escapeJsxText(`Заглушка · ${displayName}`).replace(/"/g, '&quot;');
      return `<div data-id="${targetId}" data-name="${label}" style={${sourceStyleLiteral({ backgroundColor: '#eeeeee', ...styles })}}></div>`;
    }
    let tag = 'div', content = '', attributes = '';
    if (node.kind === 'RichTextNode') {
      const text = mapSourceText(node, context, targetId);
      if (text.blockIds?.length) result.optionIds.push(...text.blockIds);
      tag = text.tag;
      attributes = Object.entries(text.attributes).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`).join('');
      if (text.binding) {
        const expr = options.expressionFor(text.binding, node, 'textContent');
        content = expr.includes('{') ? expr : `{${expr}}`;
      } else if (options.plainTextFor?.(node)) {
        content = escapeJsxText(text.plainText);
      } else {
        content = text.jsx;
      }
      if (text.textAnim) {
        attributes += ` data-text-anim='${JSON.stringify(text.textAnim)}'`;
        content = `<${SPLIT_TEXT_TAG} spec={${buildSplitTextSpecSource(text.textAnim)}}>${content}</${SPLIT_TEXT_TAG}>`;
      }
    } else if (node.kind === 'SlotNode') {
      result.slots.push(id); content = '{children}';
    } else if (node.kind === 'CodeComponentNode') {
      const identifier = String(node.properties.codeComponentIdentifier);
      const match = /^local-module:canvasComponent\/([^:]+):/.exec(identifier);
      if (match) result.nested.set(id, match[1]);
      content = node.children.map(child => emit(child, node)).filter(Boolean).join('\n');
    } else if (node.kind === 'OverlayNode') {
      content = node.children.map(child => emit(child, node)).filter(Boolean).join('\n');
    } else if (node.kind === 'FrameNode') {
      if (node.properties.isFormContainer === true) {
        if (!context.supportedForms || (node.properties.htmlTag != null && node.properties.htmlTag !== 'form') || Object.entries(node.properties).some(([key, value]) => key.startsWith('form') && value !== undefined && value !== false && !formContainerKeys.has(key))) {
          throw new Error(`Form container ${id} requires its native form adapter`);
        }
        tag = 'form';
        attributes = ` data-form='${serializeFormConfig({ sendTo: [] })}'`;
        result.forms.push(id);
      } else if (node.properties.htmlTag != null) {
        if (typeof node.properties.htmlTag !== 'string' || !frameTags.has(node.properties.htmlTag)) throw new Error(`Frame tag ${String(node.properties.htmlTag)} on ${id} requires its native adapter`);
        tag = node.properties.htmlTag;
      }
      content = node.children.map(child => emit(child, node)).filter(Boolean).join('\n');
    } else if (node.kind === 'FormPlainTextInputNode') {
      if (!context.supportedForms || node.children.length) throw new Error(`Form input ${id} requires its native form adapter`);
      const inputType = node.properties.formTextInputType;
      if (typeof inputType !== 'string' || !formTextInputTypes.has(inputType)) throw new Error(`Form input type ${String(inputType)} on ${id} requires its native form adapter`);
      const name = node.properties.formInputName;
      if (typeof name !== 'string' || !name.trim()) throw new Error(`Form input ${id} requires a non-empty name`);
      if (node.properties.formInputValue !== undefined && typeof node.properties.formInputValue !== 'string') throw new Error(`Form input value on ${id} requires its native form adapter`);
      if (node.properties.formInputPlaceholder !== undefined && typeof node.properties.formInputPlaceholder !== 'string') throw new Error(`Form input placeholder on ${id} requires its native form adapter`);
      if (node.properties.formInputRequired !== undefined && typeof node.properties.formInputRequired !== 'boolean') throw new Error(`Form input required flag on ${id} requires its native form adapter`);
      tag = inputType === 'textarea' ? 'textarea' : 'input';
      const attrs: string[] = [];
      if (tag === 'input') attrs.push(`type=${JSON.stringify(inputType)}`);
      attrs.push(`name=${JSON.stringify(name)}`);
      if (typeof node.properties.formInputPlaceholder === 'string' && node.properties.formInputPlaceholder !== '') attrs.push(`placeholder=${JSON.stringify(node.properties.formInputPlaceholder)}`);
      if (node.properties.formInputRequired === true) attrs.push('required="true"');
      if (typeof node.properties.formInputValue === 'string' && node.properties.formInputValue !== '') attrs.push(`defaultValue=${JSON.stringify(node.properties.formInputValue)}`);
      attributes = ` ${attrs.join(' ')}`;
      result.formControls.push(id);
    } else if (node.kind === 'FormSelectNode') {
      if (!context.supportedForms || node.children.length) throw new Error(`Form select ${id} requires its native form adapter`);
      const name = node.properties.formInputName;
      if (typeof name !== 'string' || !name.trim()) throw new Error(`Form select ${id} requires a non-empty name`);
      if (node.properties.formInputRequired !== undefined && typeof node.properties.formInputRequired !== 'boolean') throw new Error(`Form select required flag on ${id} requires its native form adapter`);
      if (node.properties.formInputValue !== undefined && typeof node.properties.formInputValue !== 'string') throw new Error(`Form select value on ${id} requires its native form adapter`);
      const rawOptions = node.properties.formSelectOptions;
      if (!Array.isArray(rawOptions) || !rawOptions.length) throw new Error(`Form select ${id} requires options`);
      const selectedValue = typeof node.properties.formInputValue === 'string' ? node.properties.formInputValue : '';
      let matchedSelection = selectedValue === '';
      const optionItems = rawOptions.map((rawOption, index) => {
        const option = sourceRecord(rawOption);
        if (option?.type !== 'option' || typeof option.id !== 'string' || typeof option.title !== 'string' || typeof option.value !== 'string' || (option.disabled !== undefined && typeof option.disabled !== 'boolean')) {
          throw new Error(`Form select option on ${id} requires its native form adapter`);
        }
        const selected = selectedValue !== '' && (option.id === selectedValue || option.value === selectedValue);
        if (selected) matchedSelection = true;
        const optionId = `${targetId}-option-${index + 1}`;
        result.optionIds.push(optionId);
        const optAttrs = [`value=${JSON.stringify(option.value)}`];
        if (option.disabled === true) optAttrs.push('disabled="true"');
        if (selected) optAttrs.push('selected="true"');
        return `<option data-id="${optionId}" ${optAttrs.join(' ')}>${escapeJsxText(option.title)}</option>`;
      });
      if (!matchedSelection) throw new Error(`Form select default value ${selectedValue} on ${id} is missing from options`);
      tag = 'select';
      const attrs = [`name=${JSON.stringify(name)}`];
      if (node.properties.formInputRequired === true) attrs.push('required="true"');
      attributes = ` ${attrs.join(' ')}`;
      content = optionItems.join('');
      result.formControls.push(id);
    }
    else throw new Error(`Unsupported source child ${node.kind} on ${id}`);
    if (node.properties.link !== undefined && node.properties.link !== null && node.properties.link !== '') result.links.push(id);
    const label = typeof node.properties.name === 'string' ? ` data-name="${escapeJsxText(node.properties.name).replace(/"/g, '&quot;')}"` : '';
    return `<${tag} data-id="${targetId}"${label}${attributes} style={${sourceStyleLiteral(styles)}}>${content}</${tag}>`;
  };
  result.jsx = emit(rootId);
  return result;
}
