// turn-hooks.ts — let a panel get its house in order before the agent looks.
//
// The agent reads FILES. A panel that edits a buffer — the code-component
// editor holds the user's typing in Monaco until they press Save — shows the
// user one thing while the agent would read another: "make the glow bigger"
// lands on a file that does not yet contain the glow they just typed.
//
// A panel registers a hook that settles that (the component editor saves its
// buffer, exactly as its Save button would); the chat runs the hooks before it
// builds the turn's context. Deliberately tiny and synchronous: a hook can
// refuse a turn, but cannot wait on network persistence.

import { trace } from '@/shared/debug-trace';

type BeforeTurnHook = () => boolean | void;

const hooks = new Set<BeforeTurnHook>();

/** Register a hook; returns its unregister function (use as an effect cleanup). */
export function registerBeforeAgentTurn(hook: BeforeTurnHook): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

/** Settle every panel synchronously. A refusal keeps the draft in the chat;
 *  callers must not start a turn against stale ProjectFS content. */
export function runBeforeAgentTurn(): boolean {
  let ready = true;
  for (const hook of [...hooks]) {
    try {
      if (hook() === false) ready = false;
    } catch (err) {
      trace.error('agent-turn-hooks:hook-threw', err);
      ready = false;
    }
  }
  return ready;
}
