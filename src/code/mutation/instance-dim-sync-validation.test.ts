import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initMutationQueue,
  queueMutation,
  flushNow,
  getCurrentCode,
  validateGeneratedCode,
} from './mutation-queue';
import * as stores from '../stores/store';
import * as autoSize from '../features/instance-auto-size';

const TEMPLATE_INPUT = `function Card({ children, style }: any) {
  return <div style={style}>{children}</div>;
}
export default function LayoutClient({ children }: { children?: React.ReactNode }) {
  return (
    <div data-id="root">
      <Card data-id="card" style={{ position: 'relative', }} />
      {children}
    </div>
  );
}
`;

describe('instance dimension sync validation in flushNow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sync width commit on template instance commits valid JSX', () => {
    const spy = vi.spyOn(stores, 'getNodesSnapshot').mockReturnValue(
      new Map([['card', { id: 'card', componentFile: 'components/Card.tsx' } as any]]),
    );
    const onFlush = vi.fn();
    try {
      initMutationQueue(TEMPLATE_INPUT, onFlush);
      queueMutation({ type: 'updateStyles', nodeId: 'card', styles: { width: '100%' } });
      flushNow();
      expect(onFlush).toHaveBeenCalledTimes(1);
      const flushed = onFlush.mock.calls[0][0];
      expect(validateGeneratedCode(flushed)).toBeNull();
      expect(flushed).toContain("width: '100%'");
    } finally {
      spy.mockRestore();
    }
  });

  it('rolls back and notifies onError when writer produces corrupt syntax', () => {
    const spyNodes = vi.spyOn(stores, 'getNodesSnapshot').mockReturnValue(
      new Map([['card', { id: 'card', componentFile: 'components/Card.tsx' } as any]]),
    );
    // Simulate a corrupted writer result (e.g. double comma syntax error)
    const spyWriter = vi.spyOn(autoSize, 'setInstanceDimStyleWriteInCode').mockReturnValue(
      `function Card({ style }: any) { return <div style={style} />; }
export default function LayoutClient({ children }: any) {
  return <div data-id="root"><Card data-id="card" style={{ top: '0px',, width: '86%' }} />{children}</div>;
}`,
    );

    const onFlush = vi.fn();
    const onError = vi.fn();
    try {
      initMutationQueue(TEMPLATE_INPUT, onFlush, undefined, undefined, onError);
      queueMutation({ type: 'updateStyles', nodeId: 'card', styles: { width: '86%' } });
      flushNow();

      expect(onFlush).not.toHaveBeenCalled();
      expect(getCurrentCode()).toBe(TEMPLATE_INPUT);
      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0][0];
      expect(err.mutationTypes).toEqual(['updateStyles']);
      expect(err.message).toBeTruthy();
    } finally {
      spyNodes.mockRestore();
      spyWriter.mockRestore();
    }
  });

  it('permits preexisting-invalid code to avoid permanent edit-lockout', () => {
    const INVALID_INPUT = `function Card({ style }: any) { return <div style={style} />; }
export default function LayoutClient({ children }: any) {
  return <div data-id="root"><Card data-id="card" style={{ invalid ,, syntax }} />{children}</div>;
}`;
    const spyNodes = vi.spyOn(stores, 'getNodesSnapshot').mockReturnValue(
      new Map([['card', { id: 'card', componentFile: 'components/Card.tsx' } as any]]),
    );
    const onFlush = vi.fn();
    const onError = vi.fn();
    try {
      initMutationQueue(INVALID_INPUT, onFlush, undefined, undefined, onError);
      queueMutation({ type: 'updateStyles', nodeId: 'card', styles: { width: '100%' } });
      flushNow();
      // Preexisting invalid files are not rolled back by sync gate (traces warning instead)
      expect(onFlush).toHaveBeenCalledTimes(1);
    } finally {
      spyNodes.mockRestore();
    }
  });
});
