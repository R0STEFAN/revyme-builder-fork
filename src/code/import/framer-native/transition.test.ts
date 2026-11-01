import { expect, it } from 'vitest';
import { formatTransitionObj } from '../../generation/generator-motion-transition';
it('emits the captured cubic bezier as a numeric Motion easing tuple', () => {
  expect(formatTransitionObj({ type: 'tween', duration: '0.6', ease: '[0.62,0.2,0.13,0.93]' })).toBe("{ type: 'tween', duration: 0.6, ease: [0.62,0.2,0.13,0.93] }");
});
