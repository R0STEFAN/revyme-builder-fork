import { describe, expect, it } from 'vitest';
import { InMemoryProjectFS } from '@/code/project/project-fs';
import { parseProjectFile } from '@/code/parsing/project-parser';
import { parseInstanceProps, setInstanceProp } from './instance-props';
import { resolveSelectedInstanceTag } from './instance-tag';

describe('selected component instance tag', () => {
  const card = 'export default function Card({title = "Default"}) { return <div data-id="root">{title}</div>; }';

  for (const [idSource, id] of [["'literal'", 'literal'], ['{"expression"}', 'expression']] as const) {
    it(`edits an imported alias with ${idSource} identity`, () => {
      const code = `import Tile from '@/components/Card'; export default function Page(){return <Tile data-id=${idSource} title="B"/>;}`;
      const fs = new InMemoryProjectFS(new Map([['app/page.tsx', code], ['components/Card.tsx', card]]));
      const node = parseProjectFile('app/page.tsx', fs).get(id);
      expect(node?.isComponentInstance).toBe(true);
      const tag = resolveSelectedInstanceTag(code, 'app/page.tsx', node ?? null);
      expect(tag).toBe('Tile');
      expect(parseInstanceProps(code, id, tag ?? '').get('title')).toBe('B');
      expect(setInstanceProp(code, id, tag ?? '', 'title', 'New')).toContain('title="New"');
    });
  }

  it('refuses a foreign tag with matching generated-looking id', () => {
    const code = `import Tile from '@/components/Card'; export default function Page(){return <Other data-id="Other-x" data-name="Other"/>;}`;
    const fs = new InMemoryProjectFS(new Map([['app/page.tsx', code], ['components/Card.tsx', card]]));
    const fake = { ...parseProjectFile('app/page.tsx', fs).get('Other-x')!, type: 'Tile', componentFile: 'components/Card.tsx', isComponentInstance: true };
    expect(resolveSelectedInstanceTag(code, 'app/page.tsx', fake)).toBeNull();
  });

  it('refuses a named export even when its file also exports the default component', () => {
    const code = `import { Helper } from '@/components/Card'; export default function Page(){return <Helper data-id="helper"/>;}`;
    const fs = new InMemoryProjectFS(new Map([['app/page.tsx', code], ['components/Card.tsx', card]]));
    const fake = { ...parseProjectFile('app/page.tsx', fs).get('helper')!, componentFile: 'components/Card.tsx', isComponentInstance: true };
    expect(resolveSelectedInstanceTag(code, 'app/page.tsx', fake)).toBeNull();
  });

  it('accepts an import-specifier alias of the default export', () => {
    const code = `import { default as Tile } from '@/components/Card'; export default function Page(){return <Tile data-id="tile"/>;}`;
    const fs = new InMemoryProjectFS(new Map([['app/page.tsx', code], ['components/Card.tsx', card]]));
    const node = parseProjectFile('app/page.tsx', fs).get('tile') ?? null;
    expect(resolveSelectedInstanceTag(code, 'app/page.tsx', node)).toBe('Tile');
  });

  it('keeps the unique idless legacy instance while refusing an ambiguous one', () => {
    const code = `import Tile from '@/components/Card'; export default function Page(){return <Tile title="B"/>;}`;
    const fs = new InMemoryProjectFS(new Map([['app/page.tsx', code], ['components/Card.tsx', card]]));
    const node = [...parseProjectFile('app/page.tsx', fs).values()].find(n => n.type === 'Tile')!;
    expect(node.id).toMatch(/^auto_\d+$/);
    expect(resolveSelectedInstanceTag(code, 'app/page.tsx', node)).toBe('Tile');
    const ambiguous = code.replace('<Tile title="B"/>', '<><Tile title="B"/><Tile title="C"/></>');
    expect(resolveSelectedInstanceTag(ambiguous, 'app/page.tsx', node)).toBeNull();
  });
});
