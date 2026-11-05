import { expect, it } from 'vitest';
import { isNativeTransferClipboardText, nativeTransferPasteMode } from './framer-native-clipboard';
it('recognizes reordered envelopes, including malformed envelopes that must not paste as text', () => {
  expect(isNativeTransferClipboardText('{"version":1,"format":"revyme.framer.native"}')).toBe(true);
  expect(isNativeTransferClipboardText(' {"format": "revyme.framer.native", broken')).toBe(true);
  expect(isNativeTransferClipboardText('normal clipboard text')).toBe(false);
  expect(isNativeTransferClipboardText('{"format":"another-import"}')).toBe(false);
});
it('requires an explicit shifted paste to replace the active page', () => {
  expect(nativeTransferPasteMode({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('create');
  expect(nativeTransferPasteMode({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe('replace');
  expect(nativeTransferPasteMode({ shiftKey: true, ctrlKey: false, metaKey: true })).toBe('replace');
  expect(nativeTransferPasteMode({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe('create');
});
