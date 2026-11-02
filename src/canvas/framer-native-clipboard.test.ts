import { expect, it } from 'vitest';
import { isNativeTransferClipboardText } from './framer-native-clipboard';
it('recognizes reordered envelopes, including malformed envelopes that must not paste as text', () => {
  expect(isNativeTransferClipboardText('{"version":1,"format":"revyme.framer.native"}')).toBe(true);
  expect(isNativeTransferClipboardText(' {"format": "revyme.framer.native", broken')).toBe(true);
  expect(isNativeTransferClipboardText('normal clipboard text')).toBe(false);
  expect(isNativeTransferClipboardText('{"format":"another-import"}')).toBe(false);
});
