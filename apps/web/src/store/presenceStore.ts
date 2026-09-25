import { type Peer, peersFrom } from '@relay/core';
import type { Awareness } from 'y-protocols/awareness';
import { createStore, type StoreApi } from 'zustand/vanilla';

export function createPresenceStore(awareness: Awareness): {
  store: StoreApi<{ peers: Peer[] }>;
  destroy(): void;
} {
  const store = createStore<{ peers: Peer[] }>(() => ({ peers: [] }));
  const update = () =>
    store.setState({ peers: peersFrom(awareness.getStates(), awareness.clientID) });
  awareness.on('change', update);
  update();
  return { store, destroy: () => awareness.off('change', update) };
}
