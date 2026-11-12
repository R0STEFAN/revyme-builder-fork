import { describe, expect, test, vi, beforeEach } from 'vitest';
import { copyNodes, getClipboardData, setClipboardData, CLIPBOARD_STORAGE_KEY } from './index';
import type { CanvasNode } from '@/code/parsing/parser';

function makeNode(id: string): CanvasNode {
  return {
    id,
    type: 'div',
    name: id,
    parentId: null,
    children: [],
    styles: { width: '100px', height: '100px' },
    attrs: {},
    textContent: '',
    hasMixedContent: false,
    order: 0,
    isCanvasNode: false,
    componentFile: null,
    componentInstanceId: null,
    isComponentRoot: false,
    motionVariants: null,
    motionVariantsRef: null,
    responsiveVariantMap: null,
    conditionalStyles: null,
    motionProps: null,
  } as CanvasNode;
}

describe('copy/get/set clipboard with in-memory fallback and quota recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    setClipboardData(null);
    vi.restoreAllMocks();
  });

  test('normal copy stores data in localStorage and in memory', () => {
    const nodes = new Map<string, CanvasNode>([['box-1', makeNode('box-1')]]);
    const res = copyNodes(['box-1'], nodes);
    expect(res.success).toBe(true);
    expect(res.nodeCount).toBe(1);

    const data = getClipboardData();
    expect(data).not.toBeNull();
    expect(data?.nodes[0].id).toBe('box-1');
  });

  test('survives QuotaExceededError and falls back to in-memory store', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new DOMException('QuotaExceededError: storage is full', 'QuotaExceededError');
      throw err;
    });

    const nodes = new Map<string, CanvasNode>([['box-2', makeNode('box-2')]]);
    const res = copyNodes(['box-2'], nodes);

    // Copy must succeed despite localStorage error!
    expect(res.success).toBe(true);
    expect(res.nodeCount).toBe(1);

    // Data is still accessible via getClipboardData through in-memory store
    const data = getClipboardData();
    expect(data).not.toBeNull();
    expect(data?.nodes[0].id).toBe('box-2');

    setItemSpy.mockRestore();
  });

  test('evicts expendable preview/recovery keys when localStorage quota is exceeded', () => {
    localStorage.setItem('revyme:project-preview:site1', 'data:image/png;base64,...');
    localStorage.setItem('revyme-project-recovery-site1', '{"files":{}}');
    localStorage.setItem('important-user-key', 'keep-me');

    let attempt = 0;
    const realSetItem = Storage.prototype.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, val) => {
      attempt++;
      if (attempt === 1 && key === CLIPBOARD_STORAGE_KEY) {
        throw new DOMException('QuotaExceeded', 'QuotaExceededError');
      }
      return realSetItem(key, val);
    });

    const nodes = new Map<string, CanvasNode>([['box-3', makeNode('box-3')]]);
    const res = copyNodes(['box-3'], nodes);

    expect(res.success).toBe(true);
    // Expendable keys should be removed
    expect(localStorage.getItem('revyme:project-preview:site1')).toBeNull();
    expect(localStorage.getItem('revyme-project-recovery-site1')).toBeNull();
    // Non-expendable keys preserved
    expect(localStorage.getItem('important-user-key')).toBe('keep-me');
    // Clipboard key successfully written on retry
    expect(localStorage.getItem(CLIPBOARD_STORAGE_KEY)).not.toBeNull();
  });
});
