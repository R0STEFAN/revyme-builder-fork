import { captureTabSource } from './transport.mjs';
import { decodeNativeTransfer } from './envelope.mjs';

const get = id => document.getElementById(id);
const capture = get('capture'), status = get('status'), summary = get('summary');
const download = get('download'), copy = get('copy'), scope = get('scope');
let transfer, text;

function report(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

capture.addEventListener('click', async () => {
  transfer = undefined; text = undefined;
  capture.disabled = true; download.disabled = true; copy.disabled = true;
  summary.hidden = true;
  report('Читаємо визначення та завантажуємо залежності…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    transfer = decodeNativeTransfer(await captureTabSource(chrome, tab, { mode: scope.value }));
    text = JSON.stringify(transfer, null, 2);
    summary.replaceChildren();
    for (const [label, value] of [['Коренів', transfer.rootIds.length], ['Визначень', transfer.definitions.length], ['Ресурсів', transfer.assets.length]]) {
      const term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label; description.textContent = String(value);
      summary.append(term, description);
    }
    summary.hidden = false;
    download.disabled = false;
    copy.disabled = !transfer.complete;
    report(transfer.complete ? 'Source захоплено. Збережи JSON для перевірки повноти.'
      : transfer.diagnostics.map(item => `${item.sourceId || item.code}: ${item.message}`).join('\n'), !transfer.complete);
  } catch (error) {
    report(error instanceof Error ? error.message : String(error), true);
  } finally {
    capture.disabled = false;
  }
});

download.addEventListener('click', async () => {
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    await chrome.downloads.download({ url, filename: `framer-native-${transfer.context.projectId}.json`, saveAs: true });
    report('Захоплення передано у завантаження браузера.');
  } catch (error) {
    report(String(error), true);
  } finally {
    URL.revokeObjectURL(url);
  }
});

copy.addEventListener('click', async () => {
  if (!transfer?.complete || !text) return;
  try { await navigator.clipboard.writeText(text); report('JSON скопійовано.'); }
  catch (error) { report(String(error), true); }
});
