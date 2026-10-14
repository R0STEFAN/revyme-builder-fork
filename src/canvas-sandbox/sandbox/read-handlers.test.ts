// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import sandboxConfig from '../../../vite.sandbox.config';
import previewConfig from '../../../vite.preview.config';
import { setContentRoot } from './sandbox-state';
import { captureElement } from './read-handlers';

const toPngMock = vi.fn().mockResolvedValue('data:image/png;base64,ok');
const toJpegMock = vi.fn().mockResolvedValue('data:image/jpeg;base64,ok');
const toSvgMock = vi.fn().mockResolvedValue('data:image/svg+xml;charset=utf-8,<svg/>');

vi.mock('html-to-image', () => ({
  toPng: (...args: unknown[]) => toPngMock(...args),
  toJpeg: (...args: unknown[]) => toJpegMock(...args),
  toSvg: (...args: unknown[]) => toSvgMock(...args),
}));

describe('vite sandbox & preview publicDir configuration', () => {
  const expectedPublicDir = path.resolve(__dirname, '../../../public');

  it('configures publicDir in vite.sandbox.config.ts to the root public directory', () => {
    expect(sandboxConfig.publicDir).toBe(expectedPublicDir);
  });

  it('configures publicDir in vite.preview.config.ts to the root public directory', () => {
    expect(previewConfig.publicDir).toBe(expectedPublicDir);
  });
});

describe('captureElement', () => {
  beforeEach(() => {
    toPngMock.mockClear();
    toJpegMock.mockClear();
    toSvgMock.mockClear();
  });

  it('passes onImageErrorHandler returning true to html-to-image so broken image decodes resolve gracefully', async () => {
    const root = document.createElement('div');
    const target = document.createElement('div');
    target.setAttribute('data-node-id', 'vp1_node-1');
    root.appendChild(target);
    setContentRoot(root);

    const res = await captureElement('node-1', 'vp1_', { format: 'png', pixelRatio: 1 });
    expect(res).toBe('data:image/png;base64,ok');
    expect(toPngMock).toHaveBeenCalledTimes(1);

    const passedOptions = toPngMock.mock.calls[0][1] as { onImageErrorHandler?: () => boolean };
    expect(typeof passedOptions.onImageErrorHandler).toBe('function');
    expect(passedOptions.onImageErrorHandler!()).toBe(true);
  });

  it('provides a filter to html-to-image that skips external cross-origin images to prevent CORS network errors', async () => {
    const root = document.createElement('div');
    const target = document.createElement('div');
    target.setAttribute('data-node-id', 'vp1_node-1');
    root.appendChild(target);
    setContentRoot(root);

    await captureElement('node-1', 'vp1_', { format: 'jpeg', pixelRatio: 1 });
    expect(toJpegMock).toHaveBeenCalledTimes(1);

    const passedOptions = toJpegMock.mock.calls[0][1] as { filter?: (node: Node) => boolean };
    expect(typeof passedOptions.filter).toBe('function');

    const filter = passedOptions.filter!;

    // Non-img node should pass
    const div = document.createElement('div');
    expect(filter(div)).toBe(true);

    // Data URI img should pass
    const dataImg = document.createElement('img');
    dataImg.src = 'data:image/png;base64,aaa';
    expect(filter(dataImg)).toBe(true);

    // Same-origin img should pass
    const sameOriginImg = document.createElement('img');
    sameOriginImg.src = `${window.location.origin}/test.png`;
    expect(filter(sameOriginImg)).toBe(true);

    // Cross-origin img should be skipped (returns false)
    const crossOriginImg = document.createElement('img');
    crossOriginImg.src = 'https://api.tattoozp.com/assets/59dd35bc-2953-448a-9832-cae3bc2e4357?width=500';
    expect(filter(crossOriginImg)).toBe(false);
  });
});
