// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { renderNodes, resolveCanvasTagName } from '@/canvas/Renderer';

const BEFORE_CONVERT = `
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}></div>
  );
}
const canvasNodes = (<>
  <div data-id="free-bg" data-canvas-node="true" style={{ position: 'absolute', left: '100px', top: '100px', width: '200px', height: '150px', backgroundImage: 'url("https://example.com/photo.jpg")' }}></div>
</>);`;

const AFTER_CONVERT = `
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}></div>
  );
}
const canvasNodes = (<>
  <img data-id="free-bg" data-canvas-node="true" src="https://example.com/photo.jpg" alt="" loading="lazy" decoding="async" style={{ position: 'absolute', left: '100px', top: '100px', width: '200px', height: '150px', objectFit: 'cover' }} />
</>);`;

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

describe('free canvas node tag mismatch replacement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolveCanvasTagName correctly maps tags and Next.js components', () => {
    expect(resolveCanvasTagName('div')).toBe('div');
    expect(resolveCanvasTagName('img')).toBe('img');
    expect(resolveCanvasTagName('Image')).toBe('img');
    expect(resolveCanvasTagName('motion.div')).toBe('div');
    expect(resolveCanvasTagName('motion.img')).toBe('img');
    expect(resolveCanvasTagName('Link')).toBe('a');
  });

  it('replaces a canvas node HTMLDivElement with an HTMLImageElement on tag conversion in-place', () => {
    const container = setup();

    // 1. Initial render: div on free canvas
    renderNodes(container, parseJSXToNodes(BEFORE_CONVERT), null, () => {}, viewports, BEFORE_CONVERT);
    const initialEl = container.querySelector('[data-id="free-bg"]');
    expect(initialEl).not.toBeNull();
    expect(initialEl?.tagName.toLowerCase()).toBe('div');
    expect(initialEl instanceof HTMLDivElement).toBe(true);

    // 2. Re-render with converted code: should replace HTMLDivElement with HTMLImageElement
    renderNodes(container, parseJSXToNodes(AFTER_CONVERT), null, () => {}, viewports, AFTER_CONVERT);
    const convertedEl = container.querySelector('[data-id="free-bg"]');
    expect(convertedEl).not.toBeNull();
    expect(convertedEl?.tagName.toLowerCase()).toBe('img');
    expect(convertedEl instanceof HTMLImageElement).toBe(true);
    expect(convertedEl?.getAttribute('src')).toBe('https://example.com/photo.jpg');
    expect((convertedEl as HTMLElement)?.style.position).toBe('absolute');
  });
});
