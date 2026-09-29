import { describe, it, expect, vi } from 'vitest';

// Hovering a WORKSPACE font in the font picker previewed nothing on the canvas unless the font had
// been applied before: its FontFace lived only in the editor document, and the cross-origin canvas
// iframe had no face for the family. The hover now declares it inside the iframe (canvas CSS).
const injectCSS = vi.fn();
vi.mock('@/canvas/canvas-bridge', () => ({ getCanvasBridge: () => ({ injectCSS }) }));

describe('loadCustomFontInCanvas', () => {
  it('declares the face inside the canvas iframe with the same src the project rule uses', async () => {
    const { loadCustomFontInCanvas } = await import('./font-loader');
    await import('@/canvas/canvas-bridge');
    await new Promise((r) => setTimeout(r, 0)); // the loader binds the bridge through a dynamic import

    loadCustomFontInCanvas({ family: "Mitshuka's Personal", url: 'https://cdn.x/fonts/m.woff2', weight: 700, style: 'italic' });
    expect(injectCSS).toHaveBeenCalledTimes(1);
    const [selector, body] = injectCSS.mock.calls[0];
    expect(selector).toMatch(/^@font-face \/\* rv-font-preview Mitshukas Personal:700:italic \*\/$/);
    expect(body).toContain("font-family: 'Mitshuka\\'s Personal';");
    expect(body).toContain("src: url('https://cdn.x/fonts/m.woff2') format('woff2');");
    expect(body).toContain('font-weight: 700; font-style: italic;');

    // Each face is its own rule (weights don't overwrite each other).
    loadCustomFontInCanvas({ family: "Mitshuka's Personal", url: 'https://cdn.x/fonts/m-400.woff2' });
    expect(injectCSS.mock.calls[1][0]).toContain(':400:normal');
  });
});
