export async function captureTabSource(api, tab, request) {
  const url = new URL(tab?.url || 'about:blank');
  if (!Number.isInteger(tab?.id) || url.origin !== 'https://framer.com' || !url.pathname.startsWith('/projects/')) {
    throw new Error('FRAMER_EDITOR_REQUIRED: Відкрий потрібний проєкт у редакторі Framer.');
  }
  const responses = await api.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    func: async (moduleUrl, captureRequest) => {
      try {
        const { readEditorSource } = await import(moduleUrl);
        return { ok: true, transfer: await readEditorSource(captureRequest) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    args: [api.runtime.getURL('page-reader.mjs'), request],
  });
  if (responses.length !== 1 || responses[0].frameId !== 0 || !responses[0].result) {
    throw new Error('CAPTURE_RESPONSE_INVALID: Редактор не повернув результат захоплення.');
  }
  const response = responses[0].result;
  if (!response.ok) throw new Error(response.error || 'CAPTURE_FAILED');
  return response.transfer;
}
