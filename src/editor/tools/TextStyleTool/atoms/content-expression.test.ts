import { describe, expect, it } from 'vitest';
import { toTextExpressionLiteral } from './content-expression';

describe('toTextExpressionLiteral', () => {
  it('starts empty content with an empty formula', () => {
    expect(toTextExpressionLiteral('')).toBe('');
  });

  it('quotes and escapes the Content value for the expression editor', () => {
    const content = 'A "long" line\nwith \\ a path';
    const expression = toTextExpressionLiteral(content);
    expect(expression).toBe('"A \\"long\\" line\\nwith \\\\ a path"');
    expect(JSON.parse(expression)).toBe(content);
  });
});
