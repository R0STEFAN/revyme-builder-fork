import { expect, it } from 'vitest';
import * as templates from '@/code/project/default-code-components';
import { compileCodeComponent } from './code-component-runtime';

it('compiles every shipped template in canvas and preview modes', () => {
  const entries = Object.entries(templates).filter(([name, value]) => name.endsWith('_COMPONENT') && typeof value === 'string');
  expect(entries.length).toBeGreaterThan(0);
  for (const previewMode of [false, true]) {
    const failures: string[] = [];
    for (const [name, source] of entries) {
      if (!compileCodeComponent(source, name, { previewMode, skipCache: true })) failures.push(name);
    }
    expect(failures, `previewMode=${previewMode}`).toEqual([]);
  }
});
