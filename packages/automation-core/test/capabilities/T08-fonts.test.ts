import { describe, it, expect } from 'vitest';
import { createSnapshot, createOperationContext } from '../../src/session';
import { fontsImportOperation } from '../../src/operations/fonts';

describe('Task 9: fonts.import italic weight variants', () => {
  const context = createOperationContext();

  it('emits :ital,wght@0,400;1,400 when 400italic is requested', async () => {
    const snapshot = createSnapshot({ projectId: 'test-proj', branchId: 'main' }, 0, {
      'app/globals.css': ':root {}\n',
    });

    const res = await fontsImportOperation.execute(
      snapshot,
      {
        family: 'Instrument Serif',
        weights: ['400', '400italic'],
        display: 'swap',
        targetFile: 'app/globals.css',
      },
      context
    );

    expect(res.importUrl).toBe(
      'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital,wght@0,400;1,400&display=swap'
    );
    expect(res.importedWeights).toEqual(['400', '400italic']);
    expect(res.changes[0].content).toContain(res.importUrl);
  });

  it('supports shorthand "italic" and multi-weight italic sorting while preserving non-italic :wght@', async () => {
    const snapshot = createSnapshot({ projectId: 'test-proj', branchId: 'main' }, 0, {
      'app/globals.css': ':root {}\n',
    });

    const italicRes = await fontsImportOperation.execute(
      snapshot,
      {
        family: 'Playfair Display',
        weights: ['700italic', 'regular', 'italic', '700'],
        display: 'swap',
      },
      context
    );
    expect(italicRes.importUrl).toContain(
      'family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700'
    );

    const uprightRes = await fontsImportOperation.execute(
      snapshot,
      {
        family: 'Inter',
        weights: ['400', '700'],
        display: 'swap',
      },
      context
    );
    expect(uprightRes.importUrl).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'
    );
  });
});
