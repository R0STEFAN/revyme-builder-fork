// ImageTool.tsx — Image source, alt text, objectFit, and objectPosition controls.
// Shows only when an <img> or <Image> element is selected.
// Src/alt live on the node attrs; a CMS-bound src shows as a pill via ControlLabel.
// Uses ImageSearchModal for Unsplash/upload image selection.
//
// Layout — rows mirror the Fill control pattern: every value column is a
// `ControlLabel` + a single-row picker/pill, so binding menus, override
// indicators, and Used-By rows all show up automatically. The Source row
// uses a ColorSwatch thumbnail + label, identical to Fill's image swatch.

import { useState, useCallback, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { ToolSection, ToolInput, ToolSelect, ControlLabel, ControlActionRow, ColorSwatch } from '../controls';
import { useControl } from '../controls/ControlProvider';
import { CmsBoundPill } from '../controls/CmsBoundPill';
import { LegacyVariableBoundPill } from '../controls/VariableBoundPill';
import { queueMutation } from '@/code/mutation/mutation-queue';
import { getViewportPrefix } from '@/canvas/node-ops';
import { getCanvasBridge } from '@/canvas/canvas-bridge';
import { ExpressionBoundPill } from '../controls/ExpressionBoundPill';
import ExpressionEditorPopup from '../ui/ExpressionEditorPopup';
import ImageSearchModal from '../ui/ImageSearchModal';
import { trace } from '@/shared/debug-trace';

// ─── Options ────────────────────────────────────────────────────────────────

const OBJECT_FIT_OPTIONS = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'fill', label: 'Fill' },
  { value: 'none', label: 'None' },
  { value: 'scale-down', label: 'Scale Down' },
];

const OBJECT_POSITION_OPTIONS = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top left', label: 'Top Left' },
  { value: 'top right', label: 'Top Right' },
  { value: 'bottom left', label: 'Bottom Left' },
  { value: 'bottom right', label: 'Bottom Right' },
];

// Transparent-checker pattern for the empty source swatch — same as Fill
// uses for "no value yet". Drops into ColorSwatch's style prop.
const ALPHA_CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%), ' +
    'linear-gradient(-45deg, rgba(255,255,255,0.15) 25%, transparent 25%), ' +
    'linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.15) 75%), ' +
    'linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.15) 75%)',
  backgroundSize: '6px 6px',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
};

// ─── ImageTool ──────────────────────────────────────────────────────────────

export default function ImageTool() {
  const ctx = useControl();
  const { node, nodeId, styles, vpId, updateStyle, cmsBinding, getValueSource, removeVariable } = ctx;

  // Only show for img/Image/motion.img elements
  if (!node || (node.type !== 'img' && node.type !== 'Image' && node.type !== 'motion.img')) return null;

  return <ImageToolInner
    nodeId={nodeId!}
    node={node}
    styles={styles}
    vpId={vpId}
    updateStyle={updateStyle}
    cmsBinding={cmsBinding}
    getValueSource={getValueSource}
    removeVariable={removeVariable}
  />;
}

/** Inner component — avoids hooks-after-early-return issues */
function ImageToolInner({
  nodeId,
  node,
  styles,
  vpId,
  updateStyle,
  cmsBinding,
  getValueSource,
  removeVariable,
}: {
  nodeId: string;
  node: NonNullable<ReturnType<typeof useControl>['node']>;
  styles: Record<string, string>;
  vpId: string;
  updateStyle: (key: string, value: string) => void;
  cmsBinding: ReturnType<typeof useControl>['cmsBinding'];
  getValueSource: ReturnType<typeof useControl>['getValueSource'];
  removeVariable: ReturnType<typeof useControl>['removeVariable'];
}) {
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [expressionOpen, setExpressionOpen] = useState(false);

  // Source binding states — dynamic expression, CMS field, or component/page variable
  const isSrcExpressionBound = !!node?.srcExpression;
  const isSrcCmsBound = !isSrcExpressionBound && !!cmsBinding?.getBindingForProperty('src');
  const srcSource = getValueSource?.('src');
  const isSrcVarBound = !isSrcExpressionBound && !isSrcCmsBound && srcSource?.source === 'prop';
  const srcVarRef = srcSource?.ref;

  // Alt text binding states
  const isAltCmsBound = !!cmsBinding?.getBindingForProperty('alt');
  const altSource = getValueSource?.('alt');
  const isAltVarBound = !isAltCmsBound && altSource?.source === 'prop';
  const altVarRef = altSource?.ref;

  const rawSrc = node.attrs?.src ?? '';
  const src = rawSrc.startsWith('var:') ? '' : rawSrc;
  const alt = node.attrs?.alt ?? '';

  const [localAlt, setLocalAlt] = useState(alt);
  const objectFit = styles.objectFit || 'cover';
  const objectPosition = styles.objectPosition || 'center';

  // Sync local alt when the node changes
  useEffect(() => {
    setLocalAlt(alt);
  }, [nodeId, alt]);

  // ─── Image selection ──────────────────────────────────────────────
  const handleImageSelect = useCallback((url: string) => {
    trace.action('image-tool:select-image', { nodeId, url: url.slice(0, 80) });

    queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { src: url } });

    // Imperative canvas update for instant feedback — the canvas DOM lives
    // in the sandbox iframe, so the attribute patch goes through the bridge.
    getCanvasBridge().setAttribute(nodeId, getViewportPrefix(vpId), 'src', url);
  }, [nodeId, vpId]);

  // ─── Alt text ─────────────────────────────────────────────────────
  const commitAlt = useCallback((value: string) => {
    const trimmed = value.trim();
    trace.action('image-tool:update-alt', { nodeId, alt: trimmed });
    queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { alt: trimmed } });
  }, [nodeId]);

  // ─── Object Fit ───────────────────────────────────────────────────
  const handleFitChange = useCallback((value: string) => {
    trace.action('image-tool:update-object-fit', { nodeId, objectFit: value });
    updateStyle('objectFit', value);
  }, [nodeId, updateStyle]);

  // ─── Object Position ──────────────────────────────────────────────
  const handlePositionChange = useCallback((value: string) => {
    trace.action('image-tool:update-object-position', { nodeId, objectPosition: value });
    updateStyle('objectPosition', value);
  }, [nodeId, updateStyle]);

  trace.fn('ImageTool:render', { nodeId, src: src.slice(0, 60), alt: localAlt, objectFit, objectPosition, isSrcExpressionBound, isSrcCmsBound, isSrcVarBound, srcVarRef });

  // Source row — single ControlActionRow shape (just like Fill). The
  // swatch shows a thumbnail of the current image, or the alpha-checker
  // pattern when empty. Click anywhere on the row opens the search modal.
  const sourceSwatchStyle: React.CSSProperties = src
    ? { backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : ALPHA_CHECKER_STYLE;
  const sourceLabel = src ? 'Image' : 'Choose Image';

  return (
    <>
      <ToolSection title="Image" collapsible>
        {/* Source row — ControlLabel handles the binding menu (CMS, variable,
            override) automatically. When expression-bound, renders ExpressionBoundPill.
            When CMS-bound, renders CmsBoundPill; when variable-bound, LegacyVariableBoundPill.
            The [fx] button allows opening ExpressionEditorPopup for formula authoring. */}
        <div className="flex items-center justify-between w-full">
          <ControlLabel label="Source" property="src" />
          <div className="flex items-center gap-1.5 min-w-0">
            {isSrcExpressionBound ? (
              <ExpressionBoundPill
                expression={node.srcExpression!}
                onEdit={() => setExpressionOpen(true)}
                onClear={() => {
                  trace.action('image-tool:unbind-src-expression', { nodeId });
                  queueMutation({ type: 'unbindSrcExpression', nodeId });
                  getCanvasBridge().setAttribute(nodeId, getViewportPrefix(vpId), 'src', null);
                }}
              />
            ) : isSrcCmsBound ? (
              <>
                <CmsBoundPill property="src" fallbackValue={src} />
                <button
                  type="button"
                  onClick={() => setExpressionOpen(true)}
                  title="Dynamic Expression (Formula)"
                  className="shrink-0 h-[var(--control-height)] px-1.5 flex items-center justify-center rounded bg-[var(--control-bg)] hover:bg-purple-600/20 text-[var(--text-secondary)] hover:text-purple-300 border border-[var(--control-border)] hover:border-purple-500/50 cursor-pointer transition-colors text-[11px] font-mono font-bold"
                >
                  fx
                </button>
              </>
            ) : isSrcVarBound && srcVarRef ? (
              <>
                <LegacyVariableBoundPill
                  property="src"
                  propertyLabel="Source"
                  variableRef={srcVarRef}
                  currentValue={src}
                  removeVariable={removeVariable}
                />
                <button
                  type="button"
                  onClick={() => setExpressionOpen(true)}
                  title="Dynamic Expression (Formula)"
                  className="shrink-0 h-[var(--control-height)] px-1.5 flex items-center justify-center rounded bg-[var(--control-bg)] hover:bg-purple-600/20 text-[var(--text-secondary)] hover:text-purple-300 border border-[var(--control-border)] hover:border-purple-500/50 cursor-pointer transition-colors text-[11px] font-mono font-bold"
                >
                  fx
                </button>
              </>
            ) : (
              <>
                <ControlActionRow onClick={() => setImageModalOpen(true)}>
                  <ColorSwatch size="md" style={sourceSwatchStyle} />
                  <span className="text-xs text-[var(--text-primary)] truncate">
                    {sourceLabel}
                  </span>
                </ControlActionRow>
                <button
                  type="button"
                  onClick={() => setExpressionOpen(true)}
                  title="Dynamic Expression (Formula)"
                  className="shrink-0 h-[var(--control-height)] px-1.5 flex items-center justify-center rounded bg-[var(--control-bg)] hover:bg-purple-600/20 text-[var(--text-secondary)] hover:text-purple-300 border border-[var(--control-border)] hover:border-purple-500/50 cursor-pointer transition-colors text-[11px] font-mono font-bold"
                >
                  fx
                </button>
              </>
            )}
          </div>
        </div>

        {/* Alt text — full ControlLabel so users can bind alt
            text to a CMS field via the menu, same way Source binds. */}
        <div className="flex items-center justify-between w-full">
          <ControlLabel label="Alt Text" property="alt" />
          <div className="flex items-center gap-2 w-full">
            {isAltCmsBound ? (
              <CmsBoundPill property="alt" fallbackValue={alt} />
            ) : isAltVarBound && altVarRef ? (
              <LegacyVariableBoundPill
                property="alt"
                propertyLabel="Alt Text"
                variableRef={altVarRef}
                currentValue={alt}
                removeVariable={removeVariable}
              />
            ) : (
              <ToolInput
                value={localAlt}
                onChange={(val) => {
                  setLocalAlt(val);
                  commitAlt(val);
                }}
                text
              />
            )}
          </div>
        </div>

        {/* Object Fit */}
        <div className="flex items-center justify-between w-full">
          <ControlLabel label="Fit" property="objectFit" />
          <ToolSelect
            value={objectFit}
            onChange={handleFitChange}
            options={OBJECT_FIT_OPTIONS}
          />
        </div>

        {/* Object Position */}
        <div className="flex items-center justify-between w-full">
          <ControlLabel label="Position" property="objectPosition" />
          <ToolSelect
            value={objectPosition}
            onChange={handlePositionChange}
            options={OBJECT_POSITION_OPTIONS}
          />
        </div>
      </ToolSection>

      {/* Image Search Modal */}
      <ImageSearchModal
        isOpen={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        onSelect={handleImageSelect}
      />

      {/* Expression Editor modal for dynamic image source formulas */}
      <ExpressionEditorPopup
        isOpen={expressionOpen}
        onClose={() => setExpressionOpen(false)}
        onApply={(expr) => {
          trace.action('image-tool:bind-src-expression', { nodeId, expression: expr });
          if (isSrcCmsBound) {
            cmsBinding?.unbindField('src', '');
          }
          queueMutation({ type: 'bindSrcExpression', nodeId, expression: expr });
        }}
        initialExpression={
          node?.srcExpression ||
          (isSrcCmsBound ? `${cmsBinding?.itemVar || 'item'}.${cmsBinding?.getBindingForProperty('src')}` : '')
        }
        targetProperty="src"
        collectionSlug={cmsBinding?.slug}
        itemVar={cmsBinding?.itemVar}
        fields={cmsBinding?.fields}
      />
    </>
  );
}
