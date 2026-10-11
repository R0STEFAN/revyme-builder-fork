// ComponentLivePreview.tsx — In-builder live preview of a component master.
// Compiles the component (and any nested @/components imports) in-process via
// compileCodeComponent. No iframe, no preview server — just React.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { projectFS } from '@/code/project/project-fs';
import { compileCodeComponent } from '@/canvas/code-component-runtime';
import { trace } from '@/shared/debug-trace';

interface Props {
  /** Path of the active component master (e.g. "components/Card.tsx") */
  componentFilePath: string;
}

interface CompilationResult {
  component: React.ComponentType<any> | null;
  error: string | null;
}

/** Compile each reachable file once for this root preview compilation. */
function compileWithDependencies(rootPath: string): CompilationResult {
  const completed = new Map<string, React.ComponentType<any>>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const compile = (filePath: string): React.ComponentType<any> => {
    const cached = completed.get(filePath);
    if (cached) return cached;
    if (visiting.has(filePath)) {
      const cycleStart = path.indexOf(filePath);
      const cycle = [...path.slice(cycleStart), filePath];
      trace.action('component-live-preview:cycle', { path: cycle });
      throw new Error(`Circular component dependency: ${cycle.join(' → ')}`);
    }

    const code = projectFS.readFile(filePath);
    if (!code) {
      trace.error('component-live-preview:file-missing', { path: filePath });
      throw new Error(`Component file not found: ${filePath}`);
    }

    visiting.add(filePath);
    path.push(filePath);
    try {
      // Gather the complete local import list before recursing. A fresh regex
      // per file avoids carrying global lastIndex state across nested walks.
      const imports = [...code.matchAll(/import\s+(\w+)\s+from\s+['"](@\/components\/[^'"]+|components\/[^'"]+)['"]/g)]
        .map((match) => match[2]);
      const extraModules: Record<string, any> = {};
      for (const importSpec of imports) {
        const relativePath = importSpec.replace(/^@\//, '');
        const childPath = relativePath.endsWith('.tsx') ? relativePath : `${relativePath}.tsx`;
        if (!projectFS.exists(childPath)) continue;

        const ChildComponent = compile(childPath);
        const shortSpec = importSpec.replace(/^@\//, '');
        extraModules[importSpec] = { default: ChildComponent };
        extraModules[shortSpec] = { default: ChildComponent };
      }

      const componentName = filePath.replace(/^components\//, '').replace(/\.tsx$/, '');
      const component = compileCodeComponent(code, componentName, {
        previewMode: true,
        extraModules,
        skipCache: true,
      });
      if (!component) throw new Error(`Unable to compile component: ${filePath}`);
      completed.set(filePath, component);
      return component;
    } finally {
      path.pop();
      visiting.delete(filePath);
    }
  };

  try {
    return { component: compile(rootPath), error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    trace.error('component-live-preview:compile-threw', { error });
    return { component: null, error };
  }
}

export default function ComponentLivePreview({ componentFilePath }: Props) {
  const [version, setVersion] = useState(0);

  // Recompile whenever projectFS changes — the component itself or any of its deps
  useEffect(() => {
    const unsub = projectFS.subscribe(() => setVersion((v) => v + 1));
    return () => { unsub(); };
  }, []);

  const compilation = useMemo(() => compileWithDependencies(componentFilePath), [componentFilePath, version]);
  const Compiled = compilation.component;

  trace.fn('ComponentLivePreview.render', { componentFilePath, hasCompiled: !!Compiled, version });

  // Reset the master root's positioning so the flex-centering wrapper
  // around `<Compiled />` actually works. The generator bakes the
  // master's canvas-space coords into the root's inline `style` (e.g.
  // `position: 'absolute', left: '1135px', top: '161px'`) — at canvas
  // those values are overridden by the Renderer per-variant viewport,
  // but in preview the component renders bare and the inline coords
  // shove it to that exact pixel offset (visible bug: master ends up
  // glued to the right edge of the preview, miles below the title bar).
  //
  // Passing a `style` prop overriding via the component's `...style`
  // spread DOESN'T work in this preview pipeline — framer-motion's
  // `motion.div` and the layout/layoutId props process the style prop
  // in a way that the inline `position: 'absolute'` survives even when
  // the spread should have overwritten it. The reliable fix is a
  // scoped CSS rule with `!important` targeting the immediate
  // `data-id` child of the preview container; CSS specificity beats
  // inline-style without depending on how the generated JSX assembles
  // its style object.
  const previewScopeId = useMemo(
    () => `preview-${componentFilePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
    [componentFilePath],
  );

  // Centering is done with AUTO MARGINS on the child, NOT with
  // `align-items/justify-content: center` on this scroll container. Flex
  // container centering distributes overflow to BOTH sides, and the part
  // above/left of the scroll origin is unreachable — a component variant
  // taller than the window had its top cut off with no way to scroll to it
  // (tall single-column pricing variant, 2026-08-11). Auto margins center a
  // smaller-than-viewport component identically, but collapse to 0 once the
  // component overflows, so it starts at the padding edge and the whole
  // thing scrolls.
  //
  // The `>` child selector alone is fragile: any wrapper DOM between the
  // container and the master root (a providers element, the runtime's
  // ref socket) silently kills the rule and the root's baked
  // `position: absolute` comes back — the preview-sandbox hit exactly that
  // through the generated locale providers. Tag the first `[data-id]`
  // descendant before paint and target the tag as well.
  const hostRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const tag = () => {
      const root = host.querySelector('[data-id]');
      if (root && !root.hasAttribute('data-preview-master-root')) {
        root.setAttribute('data-preview-master-root', '');
      }
    };
    tag();
    const mo = new MutationObserver(tag);
    mo.observe(host, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      id={previewScopeId}
      style={{
        width: '100%', height: '100%', display: 'flex',
        background: 'var(--bg-canvas, #1a1a2e)', overflow: 'auto', padding: 40,
      }}
    >
      <style>{`
        #${previewScopeId} > [data-id],
        #${previewScopeId} [data-id][data-preview-master-root] {
          position: relative !important;
          left: auto !important;
          top: auto !important;
          right: auto !important;
          bottom: auto !important;
          margin: auto !important;
          flex-shrink: 0;
        }
      `}</style>
      {Compiled ? (
        <ErrorBoundary key={`${componentFilePath}#${version}`}>
          <Compiled />
        </ErrorBoundary>
      ) : (
        <div style={{ color: '#888', fontFamily: 'monospace', fontSize: 12, margin: 'auto' }}>
          Failed to compile {componentFilePath}: {compilation.error ?? 'unknown compilation error'}
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidUpdate(prevProps: any) {
    if (prevProps.children !== this.props.children && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          maxWidth: 480, padding: 16, borderRadius: 8,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
          color: '#fca5a5', fontFamily: 'monospace', fontSize: 11,
          whiteSpace: 'pre-wrap', margin: 'auto',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Render Error</div>
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}
