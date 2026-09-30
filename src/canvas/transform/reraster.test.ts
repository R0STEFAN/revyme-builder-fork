import { describe, it, expect, afterEach } from 'vitest';
import { promotedDescendants, rerasterPromotedDescendants, willChangeSelectors } from './reraster';

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

function content(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('reraster — component instances inside the canvas iframe', () => {
  it('finds will-change set by a STYLESHEET rule too (page CSS), not only inline', () => {
    const style = document.createElement('style');
    style.textContent = `
      [data-id="card"] { will-change: transform; }
      @media (max-width: 9999px) { [data-id="nested"] { will-change: opacity; } }
      [data-id="plain"] { will-change: auto; color: red; }`;
    document.head.appendChild(style);
    const root = content('<div data-id="card"><p data-id="t">x</p></div><div data-id="nested"></div><div data-id="plain"></div>');
    expect(willChangeSelectors()).toEqual(['[data-id="card"]', '[data-id="nested"]']);
    expect(promotedDescendants([root]).map((e) => e.dataset.id)).toEqual(['card', 'nested']);
  });

  it('an instance root with the perf-isolation will-change (inline) is toggled off and restored', () => {
    const root = content('<div data-id="inst" style="contain: layout paint; will-change: transform"><h1 data-id="t">NEON</h1></div>');
    const inst = root.querySelector<HTMLElement>('[data-id="inst"]')!;
    let flush: () => void = () => {};
    expect(rerasterPromotedDescendants([root], (cb) => { flush = cb; })).toBe(1);
    expect(inst.style.willChange).toBe('auto');
    flush();
    expect(inst.style.willChange).toBe('transform');
  });

  it('a stylesheet-promoted element gets an inline auto for two frames, then its inline style back (empty)', () => {
    const style = document.createElement('style');
    style.textContent = '[data-id="card"] { will-change: transform; }';
    document.head.appendChild(style);
    const root = content('<div data-id="card"></div>');
    const card = root.querySelector<HTMLElement>('[data-id="card"]')!;
    let flush: () => void = () => {};
    expect(rerasterPromotedDescendants([root], (cb) => { flush = cb; })).toBe(1);
    expect(card.style.willChange).toBe('auto');
    flush();
    expect(card.style.willChange).toBe('');
  });

  it('overlapping settles never stack (an element already at auto is not re-captured as "auto")', () => {
    const root = content('<div data-id="inst" style="will-change: transform"></div>');
    const inst = root.querySelector<HTMLElement>('[data-id="inst"]')!;
    let first: () => void = () => {};
    rerasterPromotedDescendants([root], (cb) => { first = cb; });
    expect(rerasterPromotedDescendants([root], () => {})).toBe(0);
    first();
    expect(inst.style.willChange).toBe('transform');
  });
});
