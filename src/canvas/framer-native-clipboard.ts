/** Recognize our envelope before ordinary text/internal-node paste routes. */
export function isNativeTransferClipboardText(text: string): boolean {
  return text.trimStart().startsWith('{') && /"format"\s*:\s*"revyme\.framer\.native"/.test(text);
}
