// version-history-store.ts — Jotai atom for version history update notifications.
import { atom, getDefaultStore } from 'jotai';

export const versionHistorySignalAtom = atom(0);

export function bumpVersionHistorySignal(): void {
  getDefaultStore().set(versionHistorySignalAtom, (v) => v + 1);
}
