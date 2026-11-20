/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { resetProjectFS } from '@/code/project/project-fs';
import { createVariableInCode } from '@/code/features/variable-ops';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { styleControlVariableSpec } from '@/editor/controls/control-variable-type';
import VariableModal from './VariableModal';

it('keeps a typography preset as the default of a new font size variable', () => {
  const filePath = 'components/Card.tsx';
  const preset = 'var(--typo-heading-size)';
  const code = `export default function Card() {
    return <p data-id="root" style={{ fontSize: '${preset}' }}>Heading</p>;
  }`;
  resetProjectFS(new Map([
    [filePath, code],
    ['app/globals.css', ':root { --typo-heading-size: clamp(4.375rem, 10.82vw, 11.25rem); }'],
  ]));
  const store = createStore();
  store.set(activeFilePathAtom, filePath);
  const onCreate = vi.fn();
  render(<Provider store={store}>
    <VariableModal isOpen onClose={vi.fn()} property="fontSize" propertyLabel="Font Size"
      currentValue={preset} initialName="headingSize" onCreateVariable={onCreate} />
  </Provider>);

  expect(screen.getByDisplayValue('4.375')).toBeDefined();
  expect(screen.getByDisplayValue('10.82')).toBeDefined();
  expect(screen.getByDisplayValue('11.25')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Create Variable' }));
  expect(onCreate).toHaveBeenCalledWith('headingSize', preset, undefined);

  const spec = styleControlVariableSpec('fontSize');
  const result = createVariableInCode(code, 'root', 'fontSize', 'headingSize', preset, undefined, spec?.literalKind);
  expect(spec?.typeId).toBe('fontSize');
  expect(parseJSXToNodes(result).get('root')?.styles.fontSize).toBe(preset);
  expect(parseJSXToNodes(result, { headingSize: '2rem' }).get('root')?.styles.fontSize).toBe('2rem');
});
