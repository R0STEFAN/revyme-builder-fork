// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { addTextAnimInCode } from './text-anim-gen';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { DEFAULT_TEXT_ANIM } from '@/editor/tools/AnimationTool/motion/text-anim-presets';

describe('text animation with nested spans and styled words', () => {
  it('Case 1: h1 with nested span having data-id', () => {
    const src = `import React from 'react';
export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="hero">Hello <span data-id="span-1" style={{ color: '#3b82f6' }}>World</span></h1>
    </div>
  );
}`;
    const animatedCode = addTextAnimInCode(src, 'hero', DEFAULT_TEXT_ANIM);
    console.log('--- Case 1 animated code ---');
    console.log(animatedCode);

    expect(animatedCode).toContain('<RevymeSplitText');
    expect(animatedCode).toContain('data-id="span-1"');

    const nodes = parseJSXToNodes(animatedCode);
    const heroNode = nodes.get('hero');
    const spanNode = nodes.get('span-1');

    console.log('heroNode:', heroNode);
    console.log('spanNode:', spanNode);

    expect(spanNode).toBeDefined();
    expect(heroNode?.children).toContain('span-1');
  });

  it('Case 2: h1 with styled word (span without data-id)', async () => {
    const src = `import React from 'react';
export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="hero">Hello <span style={{ color: 'rgb(255, 0, 0)' }}>World</span></h1>
    </div>
  );
}`;
    const animatedCode = addTextAnimInCode(src, 'hero', DEFAULT_TEXT_ANIM);

    expect(animatedCode).toContain('<RevymeSplitText');
    expect(animatedCode).toContain("color: 'rgb(255, 0, 0)'");

    const nodes = parseJSXToNodes(animatedCode);
    const heroNode = nodes.get('hero');
    expect(heroNode?.hasMixedContent).toBe(true);

    const container = document.createElement('div');
    const viewports = [{ id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true }] as any;
    const { renderNodes } = await import('@/canvas/Renderer');
    renderNodes(container, nodes, null, () => {}, viewports, animatedCode);

    const renderedHero = container.querySelector('[data-node-id="hero"]') as HTMLElement;
    expect(renderedHero?.innerHTML).toContain('color: rgb(255, 0, 0)');
  }, 20000);

  it('Case 2 full flow: updateNodeChildrenFromHTML then addTextAnimInCode', async () => {
    const { updateNodeChildrenFromHTML } = await import('./generator-crud');
    const basePage = `import React from 'react';
export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="hero">Hello World</h1>
    </div>
  );
}`;
    // Step 1: User styles word "World" with color
    const htmlFromTipTap = 'Hello <span style="color: rgb(255, 0, 0);">World</span>';
    const styledCode = updateNodeChildrenFromHTML(basePage, 'hero', htmlFromTipTap);

    // Step 2: User applies Text Animation
    const animatedCode = addTextAnimInCode(styledCode, 'hero', DEFAULT_TEXT_ANIM);

    expect(animatedCode).toContain('color:');
    expect(animatedCode).toContain('World');
  });

  it('Case 2 editing flow: updateChildrenHTML on a node that already has text animation', async () => {
    const { initMutationQueue, queueMutation, flushNow } = await import('@/code/mutation/mutation-queue');
    const animatedPage = `import { RevymeSplitText } from '@revyme/runtime';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="hero" data-text-anim='{"animationType":"character","delay":0.05,"opacity":0,"y":20,"transition":{"type":"spring","stiffness":300,"damping":30}}'><RevymeSplitText spec={{ animationType: "character", opacity: 0, y: 20, delay: 0.05, transition: { type: "spring", stiffness: 300, damping: 30 } }}>Hello World</RevymeSplitText></h1>
    </div>
  );
}`;
    let result = '';
    initMutationQueue(animatedPage, (code) => { result = code; }, () => {}, () => {});

    // User highlights "World" and styles it with color
    const htmlWithStyledWord = '<p>Hello <span style="color: rgb(255, 0, 0);">World</span></p>';
    queueMutation({ type: 'updateChildrenHTML', nodeId: 'hero', html: htmlWithStyledWord } as any);
    flushNow();

    expect(result).toContain('<RevymeSplitText');
    expect(result).toContain('color:');
    expect(result).toContain('World');

    const nodes = parseJSXToNodes(result);
    const heroNode = nodes.get('hero');
    expect(heroNode?.hasMixedContent).toBe(true);
  });

  it('Case 3: h1 with vertical flex and 2 spans', async () => {
    const src = `import React from 'react';
export default function Page() {
  return (
    <div data-id="root">
      <h1 data-id="hero" style={{ display: 'flex', flexDirection: 'column' }}>
        <span data-id="span-1">Line 1</span>
        <span data-id="span-2">Line 2</span>
      </h1>
    </div>
  );
}`;
    const animatedCode = addTextAnimInCode(src, 'hero', DEFAULT_TEXT_ANIM);
    console.log('--- Case 3 animated code ---');
    console.log(animatedCode);

    const nodes = parseJSXToNodes(animatedCode);
    const heroNode = nodes.get('hero');
    const span1Node = nodes.get('span-1');
    const span2Node = nodes.get('span-2');

    console.log('heroNode styles:', heroNode?.styles);
    console.log('heroNode children:', heroNode?.children);
    console.log('span1Node:', span1Node);
    console.log('span2Node:', span2Node);

    // 1. AST Parser assertions: structural child spans are retained under hero
    expect(heroNode?.children).toEqual(['span-1', 'span-2']);
    expect(span1Node?.textContent).toBe('Line 1');
    expect(span2Node?.textContent).toBe('Line 2');

    const container = document.createElement('div');
    const viewports = [{ id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true }] as any;
    const { renderNodes } = await import('@/canvas/Renderer');
    renderNodes(container, nodes, null, () => {}, viewports, animatedCode);

    // 2. Canvas DOM assertions: h1 has flex column styles and child spans
    const renderedHero = container.querySelector('[data-node-id="hero"]') as HTMLElement;
    expect(renderedHero).not.toBeNull();
    expect(renderedHero.style.display).toBe('flex');
    expect(renderedHero.style.flexDirection).toBe('column');
    expect(renderedHero.querySelector('[data-node-id="span-1"]')?.textContent).toBe('Line 1');
    expect(renderedHero.querySelector('[data-node-id="span-2"]')?.textContent).toBe('Line 2');

    // 3. React Runtime assertions: RevymeSplitText uses display: contents
    // so child spans participate directly in the parent's flex column layout
    const React = await import('react');
    const { render: renderReact } = await import('@testing-library/react');
    const { RevymeSplitText } = await import('@revyme/runtime');
    const { container: reactContainer } = renderReact(
      React.createElement('h1', { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement(RevymeSplitText, { spec: { animationType: 'character' } },
          React.createElement('span', { 'data-id': 'span-1' }, 'Line 1'),
          React.createElement('span', { 'data-id': 'span-2' }, 'Line 2'),
        ),
      ),
    );
    const reactH1 = reactContainer.firstElementChild as HTMLElement;
    expect(reactH1.style.display).toBe('flex');
    expect(reactH1.style.flexDirection).toBe('column');

    const splitWrapper = reactH1.firstElementChild as HTMLElement;
    expect(splitWrapper.style.display).toBe('contents');

    const span1El = splitWrapper.querySelector('[data-id="span-1"]') as HTMLElement;
    const span2El = splitWrapper.querySelector('[data-id="span-2"]') as HTMLElement;
    expect(span1El).not.toBeNull();
    expect(span2El).not.toBeNull();
    expect(span1El.textContent).toBe('Line 1');
    expect(span2El.textContent).toBe('Line 2');
  }, 20000);

  it('Case 4: h1 with vertical flex and line animation preserves separate lines', async () => {
    const React = await import('react');
    const { render: renderReact } = await import('@testing-library/react');
    const { RevymeSplitText } = await import('@revyme/runtime');
    const { container } = renderReact(
      React.createElement('h1', { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement(RevymeSplitText, { spec: { animationType: 'line' } },
          React.createElement('span', { 'data-id': 'span-1' }, 'First line'),
          React.createElement('span', { 'data-id': 'span-2' }, 'Second line'),
        ),
      ),
    );
    const splitWrapper = container.querySelector('h1 > span') as HTMLElement;
    expect(splitWrapper.style.display).toBe('contents');
    expect(container.querySelector('[data-id="span-1"]')?.textContent).toBe('First line');
    expect(container.querySelector('[data-id="span-2"]')?.textContent).toBe('Second line');
  });

  it('Case 5: RevymeSplitText with styled word in React', async () => {
    const React = await import('react');
    const { render: renderReact } = await import('@testing-library/react');
    const { RevymeSplitText } = await import('@revyme/runtime');
    const { container } = renderReact(
      React.createElement('h1', null,
        React.createElement(RevymeSplitText, { spec: { animationType: 'character' } },
          'This Text and This ',
          React.createElement('span', { style: { color: 'rgb(216, 16, 16)' } }, 'Awesome'),
          ' text',
        ),
      ),
    );
    console.log('--- Case 5 Rendered React HTML ---');
    console.log(container.innerHTML);

    const styledSpan = container.querySelector('span[style*="rgb(216, 16, 16)"]') as HTMLElement;
    console.log('styledSpan:', styledSpan);
    expect(styledSpan).not.toBeNull();
    expect(styledSpan.textContent).toBe('Awesome');
  });
});
