import * as encoding from 'lib0/encoding';
import type YProvider from 'y-partyserver/provider';
import { type Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

const MESSAGE_AWARENESS = 1;

export interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/** The awareness frame for a change, or null when the change does not involve this client. */
export function ownAwarenessFrame(
  awareness: Awareness,
  change: AwarenessChange,
): Uint8Array | null {
  const own = awareness.clientID;
  const mine =
    change.added.includes(own) || change.updated.includes(own) || change.removed.includes(own);
  if (!mine) return null;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [own]));
  return encoding.toUint8Array(encoder);
}

/** The provider's fields this module reaches into; they are not in its public types. */
interface ProviderInternals {
  _awarenessUpdateHandler: (change: AwarenessChange, origin: unknown) => void;
  ws: { OPEN: number; readyState: number; send(data: Uint8Array): void } | null;
  wsconnected: boolean;
}

/**
 * The stock provider re-sends every awareness change it sees, peers' included: with N people
 * moving, each client sends about 20 × (N − 1) extra messages a second and hits the server's
 * rate limit. This replaces its handler with one that sends only this client's changes. The
 * provider's destroy() removes whatever `_awarenessUpdateHandler` holds, so it removes this one.
 */
export function sendOnlyOwnAwareness(provider: YProvider): void {
  const internals = provider as unknown as ProviderInternals;
  provider.awareness.off('change', internals._awarenessUpdateHandler);
  internals._awarenessUpdateHandler = (change) => {
    const frame = ownAwarenessFrame(provider.awareness, change);
    const ws = internals.ws;
    if (frame && internals.wsconnected && ws && ws.readyState === ws.OPEN) ws.send(frame);
  };
  provider.awareness.on('change', internals._awarenessUpdateHandler);
}
