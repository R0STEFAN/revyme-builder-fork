// src/ai/agent/tools/manage-component-variant.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { projectFS, resetProjectFS, projectVersionAtom } from '@/code/project/project-fs';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { manageComponentVariantTool } from './manage-component-variant';
import type { ToolContext } from '@/ai/agent';

const MASTER_CODE = `'use client';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Button" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
];

export const variantConnections = [];

function Button({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return (
    <button data-id="btn-root" style={{ padding: '12px 24px', backgroundColor: '#6366f1', color: '#ffffff', borderRadius: '8px', ...style }}>
      <span data-id="btn-label" style={{ fontSize: '16px' }}>Click me</span>
    </button>
  );
}

export default withResponsiveProps(Button);
`;

function makeCtx(): ToolContext {
  return { ensureCheckpoint: vi.fn(), vpWidth: 1440, signal: new AbortController().signal };
}

describe('manageComponentVariantTool', () => {
  beforeEach(() => {
    resetProjectFS(new Map([['components/Button.tsx', MASTER_CODE]]));
    getDefaultStore().set(activeFilePathAtom, 'components/Button.tsx');
    getDefaultStore().set(projectVersionAtom, 1);
  });

  it('lists existing variants for a component', async () => {
    const ctx = makeCtx();
    const result = await manageComponentVariantTool.execute(
      {
        component: 'Button',
        action: 'list',
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse((result.content[0] as any).text);
    expect(data.variants).toHaveLength(1);
    expect(data.variants[0].name).toBe('default');
  });

  it('adds an interactive hover state with auto-wired connections and styles', async () => {
    const ctx = makeCtx();
    const result = await manageComponentVariantTool.execute(
      {
        component: 'Button',
        action: 'add_interaction',
        interaction: 'hover',
        parent_variant: 'default',
        styles: {
          backgroundColor: '#4f46e5',
          transform: 'scale(1.03)',
        },
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse((result.content[0] as any).text);
    expect(data.variant).toBe('default-hover');
    expect(data.interaction).toBe('hover');
    expect(data.connections).toContain('mouseEnter');
    expect(data.connections).toContain('mouseLeave');

    const updatedCode = projectFS.readFile('components/Button.tsx')!;
    // variantConfig must contain default-hover
    expect(updatedCode).toContain("name: 'default-hover'");
    // variantConnections must contain mouseEnter and mouseLeave
    expect(updatedCode).toContain('mouseEnter');
    expect(updatedCode).toContain('mouseLeave');
    // Button root must have hover styles
    expect(updatedCode).toContain('#4f46e5');
  });

  it('adds interactive hover state styling an internal child element', async () => {
    const ctx = makeCtx();
    const result = await manageComponentVariantTool.execute(
      {
        component: 'Button',
        action: 'add_interaction',
        interaction: 'hover',
        parent_variant: 'default',
        element: 'btn-label',
        styles: {
          color: '#fbbf24',
        },
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const updatedCode = projectFS.readFile('components/Button.tsx')!;
    expect(updatedCode).toContain("name: 'default-hover'");
    expect(updatedCode).toContain('#fbbf24');
  });
});
