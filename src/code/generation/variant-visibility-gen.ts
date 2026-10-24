// variant-visibility-gen.ts — Variant-aware show/hide using AnimatePresence
// + conditional rendering with `mode="popLayout"`.
//
// Why not just `variants['X'].display = 'none'`?
//   CSS `display` isn't animatable. Writing it via framer-motion variants
//   makes the element snap-hide, AND siblings can't FLIP-animate into the
//   gap because `display: 'none'` removes the element from layout flow
//   instantly — by the time `layout={true}`'s measure-then-animate pass
//   runs, siblings have already snapped to their new positions.
//
// the reference's approach (per motion-docs.md):
//   - Conditionally render: `{condition && <Element />}`
//   - Wrap in `<AnimatePresence mode="popLayout">` so the unmount removes
//     the element from layout flow IMMEDIATELY, letting siblings'
//     `layout={true}` FLIP into the gap.
//
// JSX shape produced:
//
//   <AnimatePresence mode="popLayout">
//     {variant !== 'variant-1' && (
//       <motion.div layout={true} key="<node-id>" data-id="<node-id>"
//                   style={{ ... }} exit={{ opacity: 0 }}>
//         ...children...
//       </motion.div>
//     )}
//   </AnimatePresence>
//
// Condition shape:
//   - Negative chain `variant !== 'A' && variant !== 'B'` when most
//     variants show the element (hidden in few).
//   - Positive chain `variant === 'C' || variant === 'D'` when most
//     variants hide the element (visible in few — e.g. solo entries).
//   - Picks whichever yields fewer comparisons (≤ half of total).
//
// When `hiddenOnVariants` becomes empty: UNWRAP — remove the
// AnimatePresence + conditional, leaving the element rendered inline.

import { parseJSX, findFirstElementByDataId } from '../parsing/ast-utils';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import { trace } from '@/shared/debug-trace';
import _traverse from '@babel/traverse';

// The Vite SSR bundle exposes @babel/traverse as `{ default: { default } }`,
// while Vitest returns the function directly. Normalize both shapes so visual
// visibility edits work in the running Builder as well as in tests.
export function normalizeBabelTraverse(value: unknown): typeof _traverse {
  const first = typeof value === 'function' ? value : (value as any)?.default;
  return (typeof first === 'function' ? first : first?.default) as typeof _traverse;
}

const traverse = normalizeBabelTraverse(_traverse);

// @babel/generator has the same CommonJS-to-ESM wrapping behavior under Vite
// SSR. A raw default import becomes an object and fails only when a visibility
// mutation reaches code generation.
export function normalizeBabelGenerator(value: unknown): typeof _generate {
  const first = typeof value === 'function' ? value : (value as any)?.default;
  return (typeof first === 'function' ? first : first?.default) as typeof _generate;
}

const generate = normalizeBabelGenerator(_generate);

/** Build the variant condition expression matching:
 *    visible when `<ident> !== 'A' && <ident> !== 'B' && ...`
 *  (or its positive inverse when fewer variants need to show it).
 *
 *  `ident` is `variant` when the component has connection-driven
 *  state (`const [variant, setVariant] = useState(initialVariant)`),
 *  otherwise `initialVariant` (the always-defined prop). Using
 *  `variant` makes the conditional REACTIVE to runtime transitions —
 *  click a connection → setVariant runs → the conditional re-evaluates
 *  → AnimatePresence unmounts the element → siblings FLIP into the
 *  gap. Using `initialVariant` only works for the initial render
 *  (prop never changes).
 *
 *  The parser's reverse-direction function (`parseVisibilityCondition`)
 *  accepts BOTH identifiers, so round-trips through either source form
 *  resolve correctly.
 *
 *  `hiddenVariants`: variants where element should be HIDDEN.
 *  `allVariants`: every variant name from variantConfig (for inversion).
 *  `identifierName`: 'variant' or 'initialVariant' (caller decides). */
/** Is this expression PURELY a variant-visibility condition (what
 *  buildVisibilityCondition emits)? Anything else on the left of the `&&` is a
 *  FOREIGN gate the element owner put there — e.g. an overlay's
 *  `{overlayXOpen && (<overlay/>)}` open-state. Overwriting it with the variant
 *  test made a hidden→unhidden overlay ALWAYS mounted (fixed at 0,0 on live,
 *  painted over its trigger on the canvas) and removal could no longer find
 *  its `{var && (` wrapper (live find 2026-09-06). */
function isVariantCondition(e: t.Node | null | undefined): boolean {
  if (!e) return false;
  if (t.isBooleanLiteral(e)) return true;
  if (t.isBinaryExpression(e)) {
    return (e.operator === '===' || e.operator === '!==')
      && t.isIdentifier(e.left) && (e.left.name === 'variant' || e.left.name === 'initialVariant')
      && t.isStringLiteral(e.right);
  }
  if (t.isLogicalExpression(e) && (e.operator === '&&' || e.operator === '||')) {
    return isVariantCondition(e.left) && isVariantCondition(e.right);
  }
  return false;
}

/** Split an existing wrapper condition into `{ gate, cond }`: `gate` is the
 *  foreign part to keep verbatim (or null), `cond` the variant part we own. */
function splitGate(left: t.Expression): { gate: t.Expression | null } {
  if (isVariantCondition(left)) return { gate: null };
  if (t.isLogicalExpression(left) && left.operator === '&&' && isVariantCondition(left.right) && !isVariantCondition(left.left)) {
    return { gate: left.left };
  }
  return { gate: left };
}

function buildVisibilityCondition(
  hiddenVariants: string[],
  allVariants: string[],
  identifierName: string,
): t.Expression {
  const visibleVariants = allVariants.filter(v => !hiddenVariants.includes(v));

  // Pick the shorter chain. Tie → negative (more natural to think about
  // "hidden on X").
  const usePositive = visibleVariants.length < hiddenVariants.length;
  const variantsToList = usePositive ? visibleVariants : hiddenVariants;
  const op = usePositive ? '===' : '!==';
  const joiner = usePositive ? '||' : '&&';

  if (variantsToList.length === 0) {
    // No comparisons needed. Direction matters for the empty boolean:
    //   - usePositive=true + empty visibleVariants = "visible on
    //     NONE" → condition `false` → element NEVER renders.
    //   - usePositive=false + empty hiddenVariants = "hidden on
    //     NONE" → condition `true` → element ALWAYS renders.
    //
    // The all-variants-hidden case (caller asked us to hide on every
    // variant — e.g. a drag-out commit that removes the element from
    // the source variant) hits the first branch and returns `false`.
    // Without this fix, the bug was: empty list always returned
    // `true`, so the element ended up rendering on EVERY variant
    // instead of NONE. Visible as "drag-out removed the element from
    // its source variant but added it to ALL variants in JSX".
    return t.booleanLiteral(!usePositive);
  }
  if (variantsToList.length === 1) {
    return t.binaryExpression(
      op,
      t.identifier(identifierName),
      t.stringLiteral(variantsToList[0]),
    );
  }
  // Chain: a !== X && b !== Y && c !== Z (or positive equivalent).
  return variantsToList.reduce<t.Expression>((acc, varName, i) => {
    const cmp = t.binaryExpression(
      op,
      t.identifier(identifierName),
      t.stringLiteral(varName),
    );
    if (i === 0) return cmp;
    return t.logicalExpression(joiner, acc, cmp);
  }, t.booleanLiteral(false));
}

/** Detect whether the source code has `const [variant, setVariant] = useState(...)`
 *  in the function body. This is the marker for connection-driven runtime
 *  variant state — present when the user has authored variant
 *  connections (see `generateConnectionCode`). */
function hasVariantState(code: string): boolean {
  return /const\s*\[\s*variant\s*,\s*setVariant\s*\]\s*=\s*useState\s*\(/.test(code);
}

/** Detect whether a JSX node is `<AnimatePresence mode="popLayout">{...}</AnimatePresence>` */
function isAnimatePresenceWrapper(node: t.JSXElement): boolean {
  const opening = node.openingElement;
  if (opening.name.type !== 'JSXIdentifier') return false;
  return opening.name.name === 'AnimatePresence';
}

/** Detect the wrapping pattern around a target element:
 *    <AnimatePresence ...>{cond && <target/>}</AnimatePresence>
 *  Returns the conditional expression container if matched. */
function findExistingWrapper(
  parent: t.JSXElement,
  targetIndex: number,
): { wrapperIdx: number; exprContainer: t.JSXExpressionContainer } | null {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (!t.isJSXElement(child)) continue;
    if (!isAnimatePresenceWrapper(child)) continue;
    // Look for `{cond && <target/>}` inside
    for (const innerChild of child.children) {
      if (!t.isJSXExpressionContainer(innerChild)) continue;
      const expr = innerChild.expression;
      if (!t.isLogicalExpression(expr) || expr.operator !== '&&') continue;
      // Check if the right side is a JSX element with our data-id
      // (caller already located target by data-id, so we just need to
      // confirm this wrapper contains the same element).
      void targetIndex;
      return { wrapperIdx: i, exprContainer: innerChild };
    }
  }
  return null;
}

/**
 * Set the visibility of `nodeId` per variant.
 *
 * `hiddenVariants` = list of variant names where the element is HIDDEN.
 * Empty list → element is always visible (unwrap any existing
 * AnimatePresence + conditional). Non-empty → wrap (or update existing
 * wrap) with `<AnimatePresence mode="popLayout">{condition && <node/>}</AnimatePresence>`.
 *
 * `allVariants` should come from `variantConfig` (used to invert the
 * condition when hiddenVariants is the larger side).
 */
/** Strip a lingering `display: 'none'` that would keep a node invisible even
 *  after its render gate says show. A component node can hold display:none in
 *  TWO places — its inline `style={{…}}` and the `default` entry of its
 *  `<node>Variants` object (which `animate={['default', variant]}` applies
 *  UNDER every variant). The unhide path only ever managed the AnimatePresence
 *  gate, and the inline-display auto-substitution is deliberately skipped on
 *  component files — so a node carrying both channels ignored Hide→No entirely:
 *  the gate already permitted the variant, nothing unwrapped, and display:none
 *  survived ("Hide No does nothing", 2026-08-08). */
function clearHiddenDisplay(el: t.JSXElement, ast: t.File, nodeId: string): void {
  // 1. inline style={{ …, display: 'none' }}
  for (const attr of el.openingElement.attributes) {
    if (!t.isJSXAttribute(attr) || attr.name.name !== 'style') continue;
    if (attr.value?.type !== 'JSXExpressionContainer') continue;
    const expr = attr.value.expression;
    if (!t.isObjectExpression(expr)) continue;
    expr.properties = expr.properties.filter((pr) => {
      if (!t.isObjectProperty(pr)) return true;
      const key = t.isIdentifier(pr.key) ? pr.key.name : t.isStringLiteral(pr.key) ? pr.key.value : '';
      return !(key === 'display' && t.isStringLiteral(pr.value) && pr.value.value === 'none');
    });
  }
  // 2. the `default` entry of the node's variants object.
  // Same derivation the writer uses (generator-styles.ts): kebab id → camel + 'Variants'.
  const variantsName = nodeId.replace(/-(.)/g, (_, c: string) => c.toUpperCase()).replace(/-/g, '') + 'Variants';
  traverse(ast, {
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id) || path.node.id.name !== variantsName) return;
      const init = path.node.init;
      if (!t.isObjectExpression(init)) return;
      for (const entry of init.properties) {
        if (!t.isObjectProperty(entry)) continue;
        const ename = t.isIdentifier(entry.key) ? entry.key.name : t.isStringLiteral(entry.key) ? entry.key.value : '';
        if (ename !== 'default' || !t.isObjectExpression(entry.value)) continue;
        entry.value.properties = entry.value.properties.filter((pr) => {
          if (!t.isObjectProperty(pr)) return true;
          const key = t.isIdentifier(pr.key) ? pr.key.name : t.isStringLiteral(pr.key) ? pr.key.value : '';
          return !(key === 'display' && t.isStringLiteral(pr.value) && pr.value.value === 'none');
        });
      }
      path.stop();
    },
  });
  trace.action('generator:setVariantVisibility:clear-hidden-display', { nodeId });
}

/** AnimatePresence layout animations require a Motion child. Promote a native
 *  JSX element and ensure both runtime imports and `layout` are present before
 *  wrapping it; the previous writer emitted the wrapper alone, which failed
 *  Oracle (missing AnimatePresence) and could not FLIP (missing layout). */
function ensureVisibilityMotionScaffold(target: t.JSXElement, ast: t.File): void {
  const name = target.openingElement.name;
  if (t.isJSXIdentifier(name) && /^[a-z]/.test(name.name)) {
    const oldName = name.name;
    const motionName = t.jsxMemberExpression(t.jsxIdentifier('motion'), t.jsxIdentifier(oldName));
    target.openingElement.name = motionName;
    if (target.closingElement && t.isJSXIdentifier(target.closingElement.name) && target.closingElement.name.name === oldName) {
      target.closingElement.name = t.jsxMemberExpression(t.jsxIdentifier('motion'), t.jsxIdentifier(oldName));
    }
  }

  if (!target.openingElement.attributes.some((attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'layout')) {
    target.openingElement.attributes.push(t.jsxAttribute(
      t.jsxIdentifier('layout'),
      t.jsxExpressionContainer(t.booleanLiteral(true)),
    ));
  }

  let motionImport = ast.program.body.find((node): node is t.ImportDeclaration =>
    t.isImportDeclaration(node) && t.isStringLiteral(node.source) && node.source.value === 'framer-motion');
  const ensureNamedImport = (imported: string) => {
    if (motionImport) {
      const exists = motionImport.specifiers.some((specifier) =>
        t.isImportSpecifier(specifier) && (t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value) === imported);
      if (!exists) motionImport.specifiers.push(t.importSpecifier(t.identifier(imported), t.identifier(imported)));
    } else {
      motionImport = t.importDeclaration(
        [t.importSpecifier(t.identifier(imported), t.identifier(imported))],
        t.stringLiteral('framer-motion'),
      );
      ast.program.body.unshift(motionImport);
    }
  };
  ensureNamedImport('AnimatePresence');
  if (t.isJSXMemberExpression(target.openingElement.name)
    && t.isJSXIdentifier(target.openingElement.name.object)
    && target.openingElement.name.object.name === 'motion') ensureNamedImport('motion');
}

export function setVariantVisibilityInCode(
  code: string,
  nodeId: string,
  hiddenVariants: string[],
  allVariants: string[],
): string {
  trace.fn('generator.setVariantVisibilityInCode', { nodeId, hiddenVariants, allVariants });

  const ast = parseJSX(code);
  if (!ast) return code;

  let foundTarget: t.JSXElement | undefined;
  let foundParent: t.JSXElement | undefined;
  findFirstElementByDataId(ast, nodeId, (path, element) => {
    foundTarget = element;
    // Walk up to the nearest JSXElement parent. IMPORTANT: skip any
    // intermediate `<AnimatePresence>` wrapper — that's a wrapper we
    // emit ourselves, not the "real" layout parent. The user's
    // siblings (the elements that need to FLIP into the gap) are
    // siblings of the wrapper, not siblings of the target.
    let p: any = path.parentPath;
    while (p) {
      if (t.isJSXElement(p.node)) {
        if (isAnimatePresenceWrapper(p.node)) {
          // Keep walking up — the real parent is above this wrapper.
          p = p.parentPath;
          continue;
        }
        foundParent = p.node;
        break;
      }
      p = p.parentPath;
    }
  });
  if (!foundTarget) {
    trace.error('generator:setVariantVisibility:target-not-found', { nodeId });
    return code;
  }
  if (!foundParent) {
    trace.error('generator:setVariantVisibility:no-parent', { nodeId });
    return code;
  }
  const target: t.JSXElement = foundTarget;
  const parent: t.JSXElement = foundParent;

  // Locate target's index in parent.children — accounting for direct
  // children AND existing AnimatePresence wrappers around it.
  let targetIdx = -1;
  let wrappedTargetIdx = -1;
  let existingWrapperIdx = -1;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child === target) {
      targetIdx = i;
      break;
    }
    // Existing AnimatePresence wrapper containing our target?
    if (t.isJSXElement(child) && isAnimatePresenceWrapper(child)) {
      for (const innerChild of child.children) {
        if (!t.isJSXExpressionContainer(innerChild)) continue;
        const expr = innerChild.expression;
        if (!t.isLogicalExpression(expr) || expr.operator !== '&&') continue;
        if (expr.right === target) {
          existingWrapperIdx = i;
          wrappedTargetIdx = i;
          targetIdx = i;
          break;
        }
      }
      if (existingWrapperIdx >= 0) break;
    }
  }
  if (targetIdx < 0) {
    trace.error('generator:setVariantVisibility:not-found-in-parent', { nodeId });
    return code;
  }

  // Ensure target carries a `key` prop (required by AnimatePresence).
  const ensureKeyProp = (el: t.JSXElement) => {
    const hasKey = el.openingElement.attributes.some(
      a => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'key',
    );
    if (!hasKey) {
      el.openingElement.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('key'), t.stringLiteral(nodeId)),
      );
    }
  };
  // No default `exit` prop. the reference's UX is INSTANT unmount on hide —
  // the element vanishes, siblings smoothly FLIP into the gap via
  // their `layout={true}` measurement. A default `exit={{ opacity: 0 }}`
  // makes the disappearing element fade out OVER the transition
  // duration, which reads as a glitch (siblings already moved, the
  // half-faded element trails behind). If the user wants a custom
  // exit animation, they can author `exit={...}` themselves and our
  // generator will preserve it via the round-trip.
  const ensureExitProp = (_el: t.JSXElement) => {
    // Intentionally a no-op — see comment above.
  };

  // ── Case 1: hiddenVariants empty → UNWRAP back to plain inline render ──
  // The GATE is the single source of truth for per-variant visibility, so any
  // display:none channel is at best redundant and at worst wrong: it lives on
  // the element inline and in the variants object's `default` entry, which
  // `animate={['default', variant]}` applies UNDER every variant — so it leaks
  // onto the variants the gate is making VISIBLE. Unhiding on one variant
  // therefore did nothing at all: hiddenVariants was still ['default'] (correct
  // — the gate keeps hiding there), so the unwrap branch never ran and the
  // display:none survived ("Hide No does nothing, eye icon does nothing",
  // 2026-08-08). Clear it on EVERY visibility write; the gate keeps doing the
  // hiding it was already doing.
  clearHiddenDisplay(target, ast, nodeId);

  if (hiddenVariants.length === 0) {
    if (existingWrapperIdx >= 0) {
      const wrapper = parent.children[existingWrapperIdx] as t.JSXElement;
      const gateExpr = wrapper.children.find(
        (c): c is t.JSXExpressionContainer => t.isJSXExpressionContainer(c) && t.isLogicalExpression(c.expression) && c.expression.operator === '&&',
      );
      const gate = gateExpr ? splitGate((gateExpr.expression as t.LogicalExpression).left).gate : null;
      if (gate && gateExpr) {
        // A foreign gate owns this wrapper (overlay open-state): restore
        // `{gate && <el/>}` and keep the AnimatePresence — never unwrap.
        (gateExpr.expression as t.LogicalExpression).left = gate;
        trace.action('generator:setVariantVisibility:restore-gate', { nodeId });
      } else {
        // Unwrap: replace AnimatePresence wrapper with the bare element.
        parent.children.splice(existingWrapperIdx, 1, target);
        trace.action('generator:setVariantVisibility:unwrap', { nodeId });
      }
    }
    // Element is now (or already was) plain — no further changes.
    void wrappedTargetIdx;
    return generate(ast, { retainLines: true, jsescOption: { minimal: true } }).code;
  }

  ensureVisibilityMotionScaffold(target, ast);

  // ── Case 2: hiddenVariants non-empty → WRAP (or update existing wrap) ──
  ensureKeyProp(target);
  ensureExitProp(target);
  // Use `variant` (reactive state) when the file has connection-driven
  // useState; falls back to `initialVariant` (the prop, set at mount)
  // otherwise. Reactive `variant` makes the AnimatePresence unmount
  // smoothly when the user clicks a connection at runtime.
  const identifierName = hasVariantState(code) ? 'variant' : 'initialVariant';
  const condition = buildVisibilityCondition(hiddenVariants, allVariants, identifierName);

  if (existingWrapperIdx >= 0) {
    // Update the existing wrapper's condition without re-mounting the element.
    const wrapper = parent.children[existingWrapperIdx] as t.JSXElement;
    for (const innerChild of wrapper.children) {
      if (!t.isJSXExpressionContainer(innerChild)) continue;
      const expr = innerChild.expression;
      if (!t.isLogicalExpression(expr) || expr.operator !== '&&') continue;
      // Mutate in-place: keep the same JSXExpressionContainer, swap the
      // condition — but KEEP a foreign gate: `{gate && <cond>}`.
      const { gate } = splitGate(expr.left);
      expr.left = gate ? t.logicalExpression('&&', gate, condition) : condition;
      if (gate) trace.action('generator:setVariantVisibility:keep-gate', { nodeId });
      break;
    }
    trace.action('generator:setVariantVisibility:update-condition', {
      nodeId, hiddenVariants,
    });
    return generate(ast, { retainLines: true, jsescOption: { minimal: true } }).code;
  }

  // Fresh wrap. Build:
  //   <AnimatePresence mode="popLayout">
  //     {<condition> && <target />}
  //   </AnimatePresence>
  const wrapper = t.jsxElement(
    t.jsxOpeningElement(
      t.jsxIdentifier('AnimatePresence'),
      [
        t.jsxAttribute(
          t.jsxIdentifier('mode'),
          t.stringLiteral('popLayout'),
        ),
      ],
      false,
    ),
    t.jsxClosingElement(t.jsxIdentifier('AnimatePresence')),
    [
      t.jsxExpressionContainer(
        t.logicalExpression('&&', condition, target),
      ),
    ],
    false,
  );

  parent.children.splice(targetIdx, 1, wrapper);
  trace.action('generator:setVariantVisibility:wrap', { nodeId, hiddenVariants });

  return generate(ast, { retainLines: true, jsescOption: { minimal: true } }).code;
}
