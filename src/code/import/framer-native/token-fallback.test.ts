import { expect, it } from 'vitest';
import { resolveMissingSourceTokenFallbacks } from './token-fallback';

it('uses the captured color when an orphan token has a nested rgb fallback', () => {
  expect(resolveMissingSourceTokenFallbacks('conic-gradient(var(--token-missing, rgb(255, 255, 255)) /* White */ 100%)'))
    .toBe('conic-gradient(rgb(255, 255, 255) /* White */ 100%)');
});

it('leaves a token without a fallback visible to the compiler diagnostic', () => {
  expect(resolveMissingSourceTokenFallbacks('var(--token-missing)')).toBe('var(--token-missing)');
});
