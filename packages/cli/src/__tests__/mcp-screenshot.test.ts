import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBridgeScreenshotService,
  formatMcpToolResult,
} from '../mcp';

function makeFakeScreenshotBuffer(): Buffer {
  // Valid minimal buffer (>0 bytes) representing a captured PNG
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
}

describe('Task 4: Autonomous browserless screenshot fallback & MCP image blocks', () => {
  const createdFiles: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const file of createdFiles.splice(0)) {
      try { fs.unlinkSync(file); } catch {}
    }
  });

  it('falls back to headless Playwright at 1200x900 on EDITOR_NOT_CONNECTED when preview server responds', async () => {
    const fakePng = makeFakeScreenshotBuffer();
    const setViewportSize = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const waitForFunction = vi.fn().mockResolvedValue(undefined);
    const pageScreenshot = vi.fn().mockResolvedValue(fakePng);
    const locatorScreenshot = vi.fn().mockResolvedValue(fakePng);
    const locator = vi.fn().mockReturnValue({ first: () => ({ screenshot: locatorScreenshot }) });
    const close = vi.fn().mockResolvedValue(undefined);
    const page = {
      setViewportSize,
      goto,
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      evaluate,
      waitForFunction,
      screenshot: pageScreenshot,
      locator,
    };
    const launchBrowser = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close,
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':8082/rpc')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: 'No editor tab connected for project "proj-headless"' }),
        } as any;
      }
      if (url.includes(':5175/preview/proj-headless')) {
        return { ok: true, status: 200 } as any;
      }
      return { ok: false, status: 404 } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const svc = createBridgeScreenshotService(undefined, { launchBrowser });
    const res = await svc.captureScreenshot({
      snapshot: {
        scope: { projectId: 'proj-headless', branchId: 'main', filePath: 'app/page.client.tsx' },
        revision: 3,
        files: new Map([['app/page.client.tsx', '<div data-id="root" />']]),
      },
      viewport: 'desktop',
      nodeId: 'root',
      format: 'png',
    });

    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(setViewportSize).toHaveBeenCalledWith({ width: 1200, height: 900 });
    expect(goto).toHaveBeenCalledWith(expect.stringContaining(':5175/preview/proj-headless'), expect.any(Object));
    expect(pageScreenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true });
    expect(res.available).toBe(true);
    expect(res.status).toBe('ready');
    expect(res.source).toBe('headless-chromium');
    expect(res.width).toBe(1200);
    expect(res.height).toBe(900);
    expect(typeof res.filePath).toBe('string');
    createdFiles.push(res.filePath);
    expect(res.filePath).toContain(path.join(os.tmpdir(), 'revyme-screenshots'));
    expect(fs.existsSync(res.filePath)).toBe(true);
    expect(fs.readFileSync(res.filePath).equals(fakePng)).toBe(true);
  });

  it('captures element locator screenshot and returns structured HEADLESS_CAPTURE_FAILED on AbortError when no server is reachable', async () => {
    const fakePng = makeFakeScreenshotBuffer();
    const locatorScreenshot = vi.fn().mockResolvedValue(fakePng);
    const locator = vi.fn().mockReturnValue({ first: () => ({ screenshot: locatorScreenshot }) });
    const launchBrowser = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewportSize: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(fakePng),
        locator,
      }),
      close: vi.fn().mockResolvedValue(undefined),
    });

    // 1. AbortError with reachable builder fallback
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(':8082/rpc')) {
        const err: any = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (url.includes(':3333/builder/proj-node')) {
        return { ok: true, status: 200 } as any;
      }
      return { ok: false, status: 404 } as any;
    }));

    const svc = createBridgeScreenshotService(undefined, { launchBrowser });
    const nodeShot = await svc.captureScreenshot({
      snapshot: {
        scope: { projectId: 'proj-node', branchId: 'main', filePath: 'app/page.client.tsx' },
        revision: 1,
        files: new Map([['app/page.client.tsx', '<div data-id="root"><div data-id="hero-card" /></div>']]),
      },
      viewport: 'desktop',
      nodeId: 'hero-card',
      format: 'png',
    });

    expect(locator).toHaveBeenCalledWith('[data-id="hero-card"]');
    expect(locatorScreenshot).toHaveBeenCalledWith({ type: 'png' });
    expect(nodeShot.available).toBe(true);
    createdFiles.push(nodeShot.filePath);

    // 2. AbortError with NO reachable preview/builder server -> structured unavailable instead of throwing
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(':8082/rpc')) {
        const err: any = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      throw new Error('ECONNREFUSED');
    }));

    const failed = await svc.captureScreenshot({
      snapshot: {
        scope: { projectId: 'proj-offline', branchId: 'main', filePath: 'app/page.client.tsx' },
        revision: 1,
        files: new Map([['app/page.client.tsx', '<div data-id="root" />']]),
      },
      viewport: 'desktop',
      nodeId: 'root',
      format: 'png',
    });

    expect(failed).toMatchObject({
      available: false,
      status: 'unavailable',
      reason: 'HEADLESS_CAPTURE_FAILED',
    });
  });

  it('emits MCP image content blocks and omits large/file-backed dataUrl from JSON text output', () => {
    const bigBase64 = 'A'.repeat(700);
    const result = {
      ok: true,
      data: {
        available: true,
        primary: {
          viewport: 'desktop',
          nodeId: 'root',
          available: true,
          status: 'ready',
          filePath: '/tmp/revyme-screenshots/proj-desktop-root.png',
          dataUrl: `data:image/png;base64,${bigBase64}`,
          bytes: 512,
          width: 1200,
          height: 900,
          source: 'headless-chromium',
        },
        captures: [
          {
            viewport: 'desktop',
            nodeId: 'root',
            available: true,
            status: 'ready',
            filePath: '/tmp/revyme-screenshots/proj-desktop-root.png',
            dataUrl: `data:image/png;base64,${bigBase64}`,
            bytes: 512,
            width: 1200,
            height: 900,
            source: 'headless-chromium',
          },
        ],
      },
      meta: { commitStatus: 'not_committed', revision: 1 },
    };

    const mcpRes = formatMcpToolResult('observe.screenshot', result);
    expect(mcpRes.isError).toBe(false);
    expect(mcpRes.content.length).toBeGreaterThanOrEqual(2);

    const textBlock = mcpRes.content[0] as { type: string; text: string };
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).not.toContain(bigBase64);

    const parsedText = JSON.parse(textBlock.text);
    expect(parsedText.data.primary.filePath).toBe('/tmp/revyme-screenshots/proj-desktop-root.png');
    expect(parsedText.data.primary.dataUrl).toBeUndefined();
    expect(parsedText.data.primary.width).toBe(1200);

    const imageBlock = mcpRes.content[1] as { type: string; mimeType: string; data: string };
    expect(imageBlock).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: bigBase64,
    });
  });
});
