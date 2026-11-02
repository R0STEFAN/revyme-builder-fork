import { expect, it } from 'vitest';
import { applyFramerColorTokens } from './framer-token-gen';
it('rejects an existing reference or escaped CSS variable instead of changing its meaning', () => {
  const token = { name: 'color-framer-x', value: '#abcdef' };
  expect(() => applyFramerColorTokens('body {color:var(--color-framer-x)}', [token])).toThrow(/COLLISION/);
  expect(() => applyFramerColorTokens(':root {--color-framer-\\78: red}', [token])).toThrow(/ESCAPED_PROPERTY/);
});
it('does not permit a token recipe to inject selectors or imports', () => {
  expect(() => applyFramerColorTokens('', [{ name: 'color-framer-x', value: 'red; } body { display:none' }])).toThrow(/TOKEN_PATCH/);
  expect(() => applyFramerColorTokens('', [{ name: 'unscoped', value: 'red' }])).toThrow(/TOKEN_PATCH/);
  expect(() => applyFramerColorTokens('', [{ name: 'color-framer-x', value: '#12345' }])).toThrow(/TOKEN_PATCH/);
  expect(() => applyFramerColorTokens('', [{ name: 'color-framer-x', value: 'rgb(1)' }])).toThrow(/TOKEN_PATCH/);
});
