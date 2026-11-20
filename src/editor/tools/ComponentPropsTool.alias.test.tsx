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

it('edits a preset-backed font size on just the selected instance', async () => {
  const code = `import Card from '@/components/Card';
    export default function Page(){return <div data-id="root"><Card data-id="first" /><Card data-id="second" /></div>;}`;
  const master = `/** @propMeta {"size":{"type":"number","label":"Font Size"}} */
    export default function Card({ size = "var(--typo-heading-size)" }) {
      return <p data-id="label" style={{ fontSize: size }}>Heading</p>;
    }`;
  resetProjectFS(new Map([
    ['app/page.tsx', code],
    ['app/globals.css', ':root { --typo-heading-size: clamp(4.375rem, 10.82vw, 11.25rem); }'],
    ['components/Card.tsx', master],
  ]));
  const store = createStore();
  store.set(activeFilePathAtom, 'app/page.tsx');
  store.set(codeAtom, code);
  store.set(stableCodeAtom, code);
  store.set(selectedIdsAtom, ['first']);
  const { getByDisplayValue, getByText } = render(<Provider store={store}><ComponentPropsTool /></Provider>);
  expect(getByText('clamp')).toBeDefined();
  expect(getByDisplayValue('10.82')).toBeDefined();
  expect(getByDisplayValue('11.25')).toBeDefined();
  const minimum = getByDisplayValue('4.375');
  fireEvent.focus(minimum);
  fireEvent.change(minimum, { target: { value: '5' } });
  fireEvent.blur(minimum);
  await waitFor(() => expect(projectFS.readFile('app/page.tsx')).toContain('size="clamp(5rem, 10.82vw, 11.25rem)"'));
  expect(projectFS.readFile('app/page.tsx')).toContain('<Card data-id="second" />');
  expect(projectFS.readFile('components/Card.tsx')).toBe(master);
});
