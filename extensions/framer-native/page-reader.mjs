import { resolveEditorSourceAdapter } from './source-adapters.mjs';
import { captureNativeTransfer } from './capture.mjs';

export async function readEditorSource(request) {
  if (!['selection', 'component', 'page', 'project'].includes(request?.mode)) throw new Error('SOURCE_MODE_INVALID');
  console.debug('[framer-native] source capture started', { mode: request.mode });
  const adapter = await resolveEditorSourceAdapter({
    scriptUrls: Array.from(document.scripts, script => script.src).filter(Boolean),
    resourceUrls: performance.getEntriesByType('resource').map(entry => entry.name),
    href: () => location.href,
    importModule: url => import(url),
  });
  const result = await captureNativeTransfer(adapter, request, new AbortController().signal);
  console.debug('[framer-native] source capture finished', { complete: result.complete, definitions: result.definitions.length });
  return JSON.parse(JSON.stringify(result));
}
