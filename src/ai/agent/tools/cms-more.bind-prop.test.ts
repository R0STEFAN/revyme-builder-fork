import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';
import type { ToolContext } from '@/ai/agent';

const state = vi.hoisted(() => ({ code: '' }));
vi.mock('@/ai/agent/workspace', () => ({
  getToolCode: () => state.code,
  getToolNodes: () => new Map(),
  resolveToolFile: () => 'app/page.tsx',
  isBranchedRun: () => false,
  flushTool: () => {},
  queueToolMutation: () => {},
}));
vi.mock('@/code/project/modify-file', async () => {
  const fs = await import('@/code/project/project-fs');
  return {
    modifyProjectFile: (path: string, transform: (code: string) => string) => {
      const before = fs.projectFS.readFile(path);
      if (before == null) return null;
      const after = transform(before);
      fs.projectFS.writeFile(path, after);
      return after;
    },
  };
});

import { bindCmsPropTool } from './cms-more';

const master = 'export default function Card({ title = "Default" }) { return <div data-id="card-root">{title}</div>; }';
const page = (instances: string) => `import blog from '@/cms/blog.json'; import Tile from '@/components/Card'; export default function Page(){return <div data-id="root">{blog.map((item) => (${instances}))}</div>;}`;
const ctx = (): ToolContext => ({ ensureCheckpoint: vi.fn(), vpWidth: 1440, signal: new AbortController().signal });
const args = { node_id: 'instance', component_name: 'Card', prop: 'title', field_id: 'title' };

async function call(overrides: Record<string, unknown> = {}) {
  const result = await bindCmsPropTool.execute({ ...args, ...overrides }, ctx());
  return { error: !!result.isError, data: JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}') };
}

beforeEach(() => {
  state.code = page('<Tile data-id="instance" title="B"/>');
  resetProjectFS(new Map([
    ['app/page.tsx', state.code],
    ['components/Card.tsx', master],
    ['cms/blog.schema.json', JSON.stringify({ slug: 'blog', name: 'Blog', fields: [{ id: 'title', name: 'Title', type: 'text' }] })],
  ]));
  getDefaultStore().set(activeFilePathAtom, 'app/page.tsx');
});

describe('bind_cms_prop exact component identity', () => {
  it('binds registry Card through the selected local Tile alias', async () => {
    expect((await call()).error).toBe(false);
    expect(projectFS.readFile('app/page.tsx')).toContain('<Tile data-id="instance" title={item.title}');
  });

  it('refuses a requested component name unrelated to the selected instance', async () => {
    const before = projectFS.readFile('app/page.tsx');
    expect((await call({ component_name: 'Other' })).error).toBe(true);
    expect(projectFS.readFile('app/page.tsx')).toBe(before);
  });

  it('refuses duplicate source identities without changing either instance', async () => {
    state.code = page('<><Tile data-id="instance" title="B"/><Tile data-id="instance" title="C"/></>');
    projectFS.writeFile('app/page.tsx', state.code);
    const before = projectFS.readFile('app/page.tsx');
    expect((await call()).error).toBe(true);
    expect(projectFS.readFile('app/page.tsx')).toBe(before);
  });

  it('treats an already-correct binding as a successful idempotent request', async () => {
    state.code = page('<Tile data-id="instance" title={item.title}/>');
    projectFS.writeFile('app/page.tsx', state.code);
    expect((await call()).error).toBe(false);
    expect(projectFS.readFile('app/page.tsx')).toBe(state.code);
  });
});
