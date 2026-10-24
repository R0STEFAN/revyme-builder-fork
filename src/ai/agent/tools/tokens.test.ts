import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenTool, setTypographyPresetTool } from './tokens';

const tokenTestMocks = vi.hoisted(() => ({
  tokens: [] as Array<{ name: string; value: string; category: any }>,
  queueToolMutation: vi.fn(),
  flushTool: vi.fn(),
}));

vi.mock('@/ai/agent/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/agent/workspace')>();
  return {
    ...actual,
    queueToolMutation: tokenTestMocks.queueToolMutation,
    flushTool: tokenTestMocks.flushTool,
    isBranchedRun: () => false,
  };
});

vi.mock('@/code/project/preset-ops', () => ({
  getPresetTokens: () => tokenTestMocks.tokens,
  ensureGoogleFontImport: vi.fn(),
}));

vi.mock('@/code/stores/preset-store', () => ({ scanPresetUsage: () => new Map() }));
vi.mock('@/canvas/node-ops', () => ({ refreshCanvasTokens: vi.fn() }));

const makeContext = () => ({ ensureCheckpoint: vi.fn(), signal: new AbortController().signal }) as any;
const errorOf = (result: any) => JSON.parse(result.content[0].text).error as string;

describe('agent token tools — dimension preset values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenTestMocks.tokens = [];
  });

  it.each([
    ['space-card', 'clamp(8px, 2vw, 24px)', 'spacing'],
    ['space-card', '1rem', 'spacing'],
    ['radius-card', '8%', 'radius'],
    ['margin-card', 'calc(8px + 4px)', 'margin'],
  ])('rejects invalid %s values before queuing or checkpointing', async (name, value, category) => {
    const ctx = makeContext();
    const result = await createTokenTool.execute({ name, value, category }, ctx);

    expect(result.isError).toBe(true);
    expect(errorOf(result)).toContain('pixels');
    expect(tokenTestMocks.queueToolMutation).not.toHaveBeenCalled();
    expect(ctx.ensureCheckpoint).not.toHaveBeenCalled();
  });

  it('infers the category and accepts pixel shorthand and Margin auto', async () => {
    const ctx = makeContext();
    const space = await createTokenTool.execute({ name: 'space-card', value: '8px 16px' }, ctx);
    expect(space.isError).toBeUndefined();
    expect(tokenTestMocks.queueToolMutation).toHaveBeenCalledWith(ctx, expect.objectContaining({
      type: 'addPresetToken', token: expect.objectContaining({ name: 'space-card', value: '8px 16px', category: 'spacing' }),
    }));

    tokenTestMocks.queueToolMutation.mockClear();
    const margin = await createTokenTool.execute({ name: 'margin-center', value: '0 auto' }, ctx);
    expect(margin.isError).toBeUndefined();
    expect(tokenTestMocks.queueToolMutation).toHaveBeenCalledWith(ctx, expect.objectContaining({
      type: 'addPresetToken', token: expect.objectContaining({ name: 'margin-center', value: '0 auto', category: 'margin' }),
    }));
  });

  it('keeps the Utopia clamp path available to typography presets', async () => {
    const result = await setTypographyPresetTool.execute({
      name: 'display', values: { size: 'clamp(32px, 8vw, 96px)' },
    }, makeContext());

    expect(result.isError).toBeUndefined();
    expect(tokenTestMocks.queueToolMutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'addPresetToken', token: expect.objectContaining({ name: 'typo-display-size', value: 'clamp(32px, 8vw, 96px)', category: 'typography' }),
    }));
  });
});
