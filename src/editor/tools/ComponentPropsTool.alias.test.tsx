/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { resetProjectFS, projectFS } from '@/code/project/project-fs';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { codeAtom, stableCodeAtom, selectedIdsAtom } from '@/code/stores/store';
import ComponentPropsTool from './ComponentPropsTool';

describe('ComponentPropsTool selected import alias', () => {
  for (const [idSource, id] of [["'literal'", 'literal'], ['{"expression"}', 'expression']] as const) {
    it(`reads and edits the ${idSource} instance while registry name differs`, async () => {
      const code = `import Tile from '@/components/Card'; export default function Page(){return <Tile data-id=${idSource} title="B"/>;}`;
      resetProjectFS(new Map([
        ['app/page.tsx', code],
        ['components/Card.tsx', 'export default function Card({title = "Default"}) { return <div data-id="root">{title}</div>; }'],
      ]));
      const store = createStore();
      store.set(activeFilePathAtom, 'app/page.tsx');
      store.set(codeAtom, code);
      store.set(stableCodeAtom, code);
      store.set(selectedIdsAtom, [id]);
      render(<Provider store={store}><ComponentPropsTool /></Provider>);
      const input = screen.getByDisplayValue('B');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'New' } });
      fireEvent.blur(input);
      await waitFor(() => expect(projectFS.readFile('app/page.tsx')).toContain('title="New"'));
    });
  }
});
