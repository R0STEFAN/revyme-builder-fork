import { captureTabSource } from './transport.mjs';
import { decodeNativeTransfer } from './envelope.mjs';

const get = id => document.getElementById(id);
const capture = get('capture'), status = get('status'), summary = get('summary');
const download = get('download'), copy = get('copy'), sendRevyme = get('send-revyme'), scope = get('scope');
let transfer, text;

function report(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

capture.addEventListener('click', async () => {
  transfer = undefined; text = undefined;
  capture.disabled = true; download.disabled = true; copy.disabled = true;
  if (sendRevyme) sendRevyme.disabled = true;
  summary.hidden = true;
  report('Reading definitions and fetching dependencies…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    transfer = decodeNativeTransfer(await captureTabSource(chrome, tab, { mode: scope.value }));
    text = JSON.stringify(transfer, null, 2);
    summary.replaceChildren();
    for (const [label, value] of [['Roots', transfer.rootIds.length], ['Definitions', transfer.definitions.length], ['Assets', transfer.assets.length]]) {
      const term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label; description.textContent = String(value);
      summary.append(term, description);
    }
    summary.hidden = false;
    download.disabled = false;
    copy.disabled = !transfer.complete;
    if (sendRevyme) sendRevyme.disabled = !transfer.complete;
    report(transfer.complete ? 'Source captured. Ready to send to Revyme or save.'
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
    report('Capture sent to browser downloads.');
  } catch (error) {
    report(String(error), true);
  } finally {
    URL.revokeObjectURL(url);
  }
});

copy.addEventListener('click', async () => {
  if (!transfer?.complete || !text) return;
  try { await navigator.clipboard.writeText(text); report('JSON copied to clipboard.'); }
  catch (error) { report(String(error), true); }
});

if (sendRevyme) {
  sendRevyme.addEventListener('click', async () => {
    if (!transfer?.complete || !text) return;
    sendRevyme.disabled = true;
    report('Locating active Revyme builder tab…');
    try {
      const allTabs = await chrome.tabs.query({});
      const builderTabs = allTabs.filter(t => t.url && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/builder\//.test(t.url) || t.url.includes('/builder/proj-')));
      if (!builderTabs.length) {
        report('No open Revyme builder tab found. Please open your project in Revyme.', true);
        return;
      }
      const targetTab = builderTabs.find(t => t.active) || builderTabs[0];
      if (!targetTab.id) throw new Error('Target tab has no ID');

      report('Sending transfer to Revyme…');
      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: (transferPayload) => {
          if (typeof window.__revymeImportFramerNative === 'function') {
            window.__revymeImportFramerNative(transferPayload);
          } else {
            window.postMessage({ type: 'revyme:framer-native-paste', transfer: transferPayload }, '*');
          }
        },
        args: [transfer],
      });

      await chrome.tabs.update(targetTab.id, { active: true });
      if (targetTab.windowId) {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      }
      report('Transfer sent to Revyme!');
    } catch (error) {
      report(error instanceof Error ? error.message : String(error), true);
    } finally {
      sendRevyme.disabled = false;
    }
  });
}
