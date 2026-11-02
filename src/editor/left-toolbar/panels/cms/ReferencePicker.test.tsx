import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';
import { ReferencePicker } from './FieldControl';

afterEach(() => { cleanup(); resetProjectFS(); });

it('selects a real CMS record by label and returns its native identity', () => {
  resetProjectFS();
  projectFS.writeFile('cms/categories.schema.json', JSON.stringify({ slug: 'categories', name: 'Categories', fields: [{ id: 'title', name: 'Title', type: 'text' }] }));
  projectFS.writeFile('cms/categories.json', JSON.stringify([{ _id: 'a', _slug: 'alpha', title: 'Alpha' }, { _id: 'b', _slug: 'beta', title: 'Beta' }]));
  let selected = '';
  render(<Provider store={createStore()}><ReferencePicker field={{ id: 'category', name: 'Category', type: 'reference', referenceCollection: 'categories' }} value="a" onChange={(value: string) => { selected = value; }} multi={false} /></Provider>);
  expect(screen.getByRole('option', { name: 'Alpha' })).toHaveProperty('selected', true);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
  expect(selected).toBe('b');
});
