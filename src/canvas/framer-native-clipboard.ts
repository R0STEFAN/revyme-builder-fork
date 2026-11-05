/** Recognize our envelope before ordinary text/internal-node paste routes. */
export function isNativeTransferClipboardText(text: string): boolean {
  return text.trimStart().startsWith('{') && /"format"\s*:\s*"revyme\.framer\.native"/.test(text);
}

/** A shifted keyboard paste is the explicit destructive replace action. */
export function nativeTransferPasteMode(event: Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): 'create' | 'replace' {
  return event.shiftKey && (event.ctrlKey || event.metaKey) ? 'replace' : 'create';
}
