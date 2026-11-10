// connection-parse.ts — LEAF module for extracting variant connections from component source code.
// Free of circular dependencies with ProjectFS, mutation queue, and editor stores.

import { trace } from '@/shared/debug-trace';

export type ConnectionTrigger = 'click' | 'clickStart' | 'mouseEnter' | 'mouseLeave' | 'inView' | 'afterDelay';

export interface Connection {
  from: string;           // source variant name
  to: string;             // target variant name
  trigger: ConnectionTrigger;
  delay?: number;         // seconds (0-2)
  // data-id of the JSX element where the trigger handler is attached.
  // When undefined, the handler lands on the root motion element
  sourceNode?: string;
  pauseOffscreen?: boolean; // inView delay pause
}

/**
 * Parse connections from a component file.
 * Looks for: const connections = [...];
 */
export function parseConnections(code: string): Connection[] {
  const match = code.match(/const\s+connections\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];

  try {
    const jsonStr = match[1]
      .replace(/'/g, '"')
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/,\s*([}\]])/g, '$1');

    return JSON.parse(jsonStr) as Connection[];
  } catch (e) {
    trace.error('connection-config:parse-failed', { error: String(e) });
    return [];
  }
}
