// AnimationTool/popups/AppearPopup.tsx — Appear animation popup editor.
// Supports both direct element Appear animation and child stagger animation.

import { useState, useCallback, useMemo } from 'react';
import { ControlLabel, ControlActionRow, ToolSegmentedControl } from '../../../controls';
import { SliderRow } from '../shared';
import { AnimationIcon } from '@/design-system/PropertyIcons';
import { useToolPopup } from '../../../ui/ToolPopup';
import MotionPropsEditor from '../motion/MotionPropsEditor';
import TransitionPanel from '../TransitionPanel';
import { queueMutation } from '@/code/mutation/mutation-queue';
import { getActiveAnimationScope } from '../animation-scope-source';
import { appearReveal, appearUnionKeys } from '../appear-utils';
import { TransitionRow } from './TransitionRow';
import { getNodeFromCache } from '@/code/stores/store';
import { trace } from '@/shared/debug-trace';

function getDirectChildIds(node: any): string[] {
  if (node?.collectionList?.templateIds) {
    return Object.values(node.collectionList.templateIds);
  }
  return node?.children || [];
}

// Appear = ENTER (From) only, standard. The element animates from `initial`
// (the scoped, responsive enter state) TO its resting state via `whileInView`,
// which we DERIVE as the neutral of every enter key (non-scoped — resting is the
// same on every viewport). No "To" row.
export function AppearPopup({ nodeId, node, enterProps, transition, isVariantMode, initialName, isStagger: initIsStagger, stagger: initStagger }: {
  nodeId: string; node: any; enterProps: Record<string, string>;
  transition: Record<string, string>; isVariantMode: boolean; initialName?: string;
  isStagger?: boolean; stagger?: string;
}) {
  const { pushPanel } = useToolPopup();

  const childIds = useMemo(() => getDirectChildIds(node), [node]);
  const hasStaggerAttr = !!node?.attrs?.['data-stagger'];
  const firstChild = childIds[0] ? getNodeFromCache(childIds[0]) : null;
  const childMp = firstChild?.motionProps;
  const childDelay = childMp?.transition?.delay;
  const isChildStagger = typeof childDelay === 'string' && /\b(index|idx|i)\s*\*/.test(childDelay);
  const canTargetChildren = childIds.length > 0 || !!node?.collectionList || hasStaggerAttr || isChildStagger || !!initIsStagger;

  const initialTarget = (initIsStagger || hasStaggerAttr || isChildStagger) ? 'children' : 'self';
  const [target, setTarget] = useState<'self' | 'children'>(initialTarget);

  let initialStagNum = 0.1;
  if (initStagger) {
    initialStagNum = parseFloat(initStagger) || 0.1;
  } else if (node?.attrs?.['data-stagger']) {
    initialStagNum = parseFloat(node.attrs['data-stagger']) || 0.1;
  } else if (isChildStagger && typeof childDelay === 'string') {
    const match = childDelay.match(/\b(?:index|idx|i)\s*\*\s*([\d.]+)/);
    if (match) initialStagNum = parseFloat(match[1]) || 0.1;
  }
  const [stagger, setStagger] = useState<number>(initialStagNum);

  // Inspect first child if present for its enter props and transition
  const initialChildEnter = (childMp?.initial && !childMp.initial._variantName)
    ? childMp.initial
    : (enterProps && Object.keys(enterProps).length > 0 ? enterProps : { opacity: '0', y: '30' });
  const initialChildTrans = (childMp?.transition && Object.keys(childMp.transition).length > 0)
    ? childMp.transition
    : (transition && Object.keys(transition).length > 0 ? transition : { type: 'spring', stiffness: '300', damping: '25' });

  const [currentEnterProps, setCurrentEnterProps] = useState<Record<string, string>>(
    initialTarget === 'children' ? initialChildEnter : enterProps
  );
  const [currentTransition, setCurrentTransition] = useState<Record<string, string>>(
    initialTarget === 'children' ? initialChildTrans : transition
  );

  const applyStaggerToChildren = useCallback((cIds: string[], enter: Record<string, string>, trans: Record<string, string>, stagVal: number) => {
    const isCms = !!node?.collectionList;
    const scope = getActiveAnimationScope();
    trace.action('appear-popup:apply-stagger-to-children', { count: cIds.length, isCms, stagVal });

    if (isCms) {
      const idxVar = node?.collectionList?.indexVar || 'index';
      for (const cid of cIds) {
        const cNode = getNodeFromCache(cid);
        queueMutation({ type: 'updateMotionProp', nodeId: cid, propName: 'initial', props: enter, scope });
        queueMutation({
          type: 'updateMotionProp', nodeId: cid, propName: 'whileInView',
          props: appearReveal(appearUnionKeys(cNode?.motionProps?.initial, enter), cNode?.styles),
        });
        queueMutation({ type: 'updateMotionProp', nodeId: cid, propName: 'viewport', props: { once: 'true' } });
        queueMutation({
          type: 'updateMotionProp', nodeId: cid, propName: 'transition',
          props: { ...trans, delay: `${idxVar} * ${stagVal}` },
        });
      }
    } else {
      cIds.forEach((cid, index) => {
        const cNode = getNodeFromCache(cid);
        const delay = parseFloat((index * stagVal).toFixed(2));
        queueMutation({ type: 'updateMotionProp', nodeId: cid, propName: 'initial', props: enter, scope });
        queueMutation({
          type: 'updateMotionProp', nodeId: cid, propName: 'whileInView',
          props: appearReveal(appearUnionKeys(cNode?.motionProps?.initial, enter), cNode?.styles),
        });
        queueMutation({ type: 'updateMotionProp', nodeId: cid, propName: 'viewport', props: { once: 'true' } });
        queueMutation({
          type: 'updateMotionProp', nodeId: cid, propName: 'transition',
          props: { ...trans, delay: String(delay) },
        });
      });
    }
  }, [node]);

  const handleTargetChange = (newTarget: 'self' | 'children') => {
    setTarget(newTarget);
    trace.action('appear-popup:target-change', { nodeId, from: target, to: newTarget });

    if (newTarget === 'children') {
      // 1. Remove appear from container
      queueMutation({ type: 'removeMotionProp', nodeId, propName: 'initial' });
      queueMutation({ type: 'removeMotionProp', nodeId, propName: 'whileInView' });
      queueMutation({ type: 'removeMotionProp', nodeId, propName: 'viewport' });
      queueMutation({ type: 'removeMotionProp', nodeId, propName: 'transition' });

      // 2. Add data-stagger to container
      queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { 'data-stagger': String(stagger) } });

      // 3. Apply to children
      applyStaggerToChildren(childIds, currentEnterProps, currentTransition, stagger);
    } else {
      // 1. Remove data-stagger from container
      queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { 'data-stagger': '' } });

      // 2. Remove appear from children
      for (const cid of childIds) {
        queueMutation({ type: 'removeMotionProp', nodeId: cid, propName: 'initial' });
        queueMutation({ type: 'removeMotionProp', nodeId: cid, propName: 'whileInView' });
        queueMutation({ type: 'removeMotionProp', nodeId: cid, propName: 'viewport' });
        queueMutation({ type: 'removeMotionProp', nodeId: cid, propName: 'transition' });
      }

      // 3. Apply appear directly to container
      queueMutation({ type: 'updateMotionProp', nodeId, propName: 'initial', props: currentEnterProps, scope: getActiveAnimationScope() });
      queueMutation({
        type: 'updateMotionProp', nodeId, propName: 'whileInView',
        props: appearReveal(appearUnionKeys(node?.motionProps?.initial, currentEnterProps), node?.styles),
      });
      queueMutation({ type: 'updateMotionProp', nodeId, propName: 'viewport', props: { once: 'true' } });
      queueMutation({ type: 'updateMotionProp', nodeId, propName: 'transition', props: currentTransition });
    }
  };

  const handleStaggerLive = (v: number) => {
    setStagger(v);
  };

  const handleStaggerCommit = (v: number) => {
    setStagger(v);
    trace.action('appear-popup:stagger-commit', { nodeId, stagger: v });
    queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { 'data-stagger': String(v) } });
    applyStaggerToChildren(childIds, currentEnterProps, currentTransition, v);
  };

  const writeEnter = (newProps: Record<string, string>) => {
    setCurrentEnterProps(newProps);
    if (target === 'children') {
      applyStaggerToChildren(childIds, newProps, currentTransition, stagger);
      return;
    }
    if (isVariantMode && initialName) {
      queueMutation({ type: 'updateVariantStyle', nodeId, variantName: initialName, styles: newProps });
      return;
    }
    // Scoped enter (responsive, like hover/tap) …
    queueMutation({ type: 'updateMotionProp', nodeId, propName: 'initial', props: newProps, scope: getActiveAnimationScope() });
    // … plus the derived reveal over the UNION of all enter keys.
    queueMutation({ type: 'updateMotionProp', nodeId, propName: 'whileInView',
      props: appearReveal(appearUnionKeys(node?.motionProps?.initial, newProps), node?.styles),
    });
  };

  const writeTransition = (t: Record<string, string>) => {
    setCurrentTransition(t);
    if (target === 'children') {
      applyStaggerToChildren(childIds, currentEnterProps, t, stagger);
      return;
    }
    queueMutation({ type: 'updateMotionProp', nodeId, propName: 'transition', props: t });
  };

  return (
    <div className="flex flex-col gap-2">
      {canTargetChildren && (
        <div className="flex items-center justify-between w-full">
          <ControlLabel label="Animate" property="" plain />
          <div className="w-full">
            <ToolSegmentedControl
              value={target}
              onChange={(v) => handleTargetChange(v as 'self' | 'children')}
              options={[
                { value: 'self', label: 'Element' },
                { value: 'children', label: 'Children' },
              ]}
              size="sm"
            />
          </div>
        </div>
      )}

      {target === 'children' && (
        <SliderRow
          label="Stagger"
          value={stagger}
          min={0}
          max={1}
          step={0.02}
          suffix="s"
          onChange={handleStaggerLive}
          onCommit={handleStaggerCommit}
        />
      )}

      <div className="flex items-center justify-between w-full">
        <ControlLabel label="Enter" property="" plain />
        <ControlActionRow onClick={() => pushPanel('Enter', (
          <MotionPropsEditor nodeId={nodeId} props={currentEnterProps} preview onChange={writeEnter} />
        ))}>
          <AnimationIcon width={20} height={20} className="shrink-0" />
          <span className="text-[var(--text-secondary)]">Effect</span>
        </ControlActionRow>
      </div>

      <TransitionRow transition={currentTransition}
        onClick={() => pushPanel('Transition', (
          <TransitionPanel initialTransition={currentTransition} onWrite={writeTransition} />
        ))} />
    </div>
  );
}
