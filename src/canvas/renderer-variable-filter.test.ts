// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { parseJSXToNodes } from '../code/parsing/parser';
import { renderNodes, setRendererListDatasets } from './Renderer';

afterEach(() => { document.body.innerHTML = ''; setRendererListDatasets(null); });

it('renders and patches a component-prop query with strict empty and case-sensitive matching', () => {
  const code = `import rows from '@/cms/rows.json';
    export default function Card({category = 'A'}) { return <div data-id="root" style={{ position: 'relative' }}><div data-id="list" style={{ position: 'relative' }}>{rows.filter(item => item._id === category).map(item => <p data-id="row" style={{position:'relative'}}>{item.title}</p>)}</div></div>; }`;
  const listData = { list: [{ _id: 'A', title: 'First title' }, { _id: 'B', title: 'Second title' }, { _id: 'a', title: 'Different case title' }] };
  const viewports = [{ id: 'desktop', label: 'Desktop', order: 0, width: 1200, x: 0, y: 0, isPrimary: true }];
  const container = document.createElement('div'); document.body.append(container);
  const paint = (category: string) => renderNodes(container, parseJSXToNodes(code, { category }), null, () => {}, viewports, code, undefined, undefined, undefined, undefined, { data: {}, schemas: {}, listData }, listData);
  paint('A');
  expect(container.querySelector('[data-id="list"]')?.textContent).toBe('First title');
  paint('B');
  expect(container.querySelector('[data-id="list"]')?.textContent).toBe('Second title');
  paint('');
  expect(container.textContent).not.toContain('First title');
  expect(container.textContent).not.toContain('Second title');
});
