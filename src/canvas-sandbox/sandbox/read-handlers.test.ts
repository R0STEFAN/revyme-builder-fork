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
});
