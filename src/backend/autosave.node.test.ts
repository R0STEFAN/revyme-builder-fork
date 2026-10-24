// @vitest-environment node

import { afterEach, expect, it, vi } from 'vitest';
import { cancelPendingAutosave, triggerAutosave } from './autosave';

afterEach(() => {
  cancelPendingAutosave();
  vi.useRealTimers();
});

it('does not schedule a browser autosave in a standalone Node process', () => {
  vi.useFakeTimers();

  triggerAutosave();

  expect(vi.getTimerCount()).toBe(0);
});
