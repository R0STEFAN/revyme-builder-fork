// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/code/project/project-fs', () => ({
  projectFS: {
    readFile: () => '', listFiles: () => [], exists: () => false,
    writeFile: () => {}, deleteFile: () => {},
  },
}));

import { parseJSXToNodes } from '@/code/parsing/parser';
import { renderNodes } from '@/canvas/Renderer';

const pageWithSpan = (text: string, spanText: string) => `
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
      <h1 data-id="heading" style={{ position: 'relative' }}>
        ${text}
        <span data-id="span-1" style={{ color: '#3b82f6' }}>${spanText}</span>
      </h1>
    </div>
  );
}
`;

const viewports = [{ id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true }] as any;

function setup() {
  (globalThis as any).CSS = (globalThis as any).CSS ?? {};
  (globalThis as any).CSS.escape = (globalThis as any).CSS.escape ?? ((s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c: string) => `\\${c}`));
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.setAttribute('data-content-root', 'true');
  document.body.appendChild(container);
  return container;
}

describe('Renderer with text container and span children', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders heading text together with child span', () => {
    const container = setup();
    const src = pageWithSpan('Title text ', 'highlighted');
    renderNodes(container, parseJSXToNodes(src), null, () => {}, viewports, src);

    const headingEl = container.querySelector('[data-node-id="heading"]') as HTMLElement;
    expect(headingEl).not.toBeNull();

    const spanEl = headingEl.querySelector('[data-node-id="span-1"]') as HTMLElement;
    expect(spanEl).not.toBeNull();
    expect(spanEl.textContent).toBe('highlighted');

    // The heading must include its own text as well as the span text
    expect(headingEl.textContent).toContain('Title text');
    expect(headingEl.textContent).toContain('highlighted');
  });

  it('updates text on patch while keeping child span intact', () => {
    const container = setup();
    const src1 = pageWithSpan('Initial text ', 'highlighted');
    renderNodes(container, parseJSXToNodes(src1), null, () => {}, viewports, src1);

    const src2 = pageWithSpan('Updated text ', 'highlighted');
    renderNodes(container, parseJSXToNodes(src2), null, () => {}, viewports, src2);

    const headingEl = container.querySelector('[data-node-id="heading"]') as HTMLElement;
    const spanEl = headingEl.querySelector('[data-node-id="span-1"]') as HTMLElement;
    expect(spanEl).not.toBeNull();
    expect(headingEl.textContent).toContain('Updated text');
    expect(headingEl.textContent).toContain('highlighted');
  });
});
