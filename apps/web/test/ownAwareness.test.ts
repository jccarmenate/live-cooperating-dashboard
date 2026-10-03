import * as decoding from 'lib0/decoding';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YProvider from 'y-partyserver/provider';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ownAwarenessFrame, sendOnlyOwnAwareness } from '../src/sync/ownAwareness';

const providers: YProvider[] = [];
afterEach(() => {
  for (const p of providers.splice(0)) p.destroy();
});

/** A provider that never dials out, with a fake open socket recording what it would send. */
function offlineProvider() {
  const provider = new YProvider('localhost:1', 'room', new Y.Doc(), {
    party: 'room',
    connect: false,
    disableBc: true,
  });
  providers.push(provider);
  const send = vi.fn();
  const internals = provider as unknown as { ws: unknown; wsconnected: boolean };
  internals.ws = { OPEN: 1, readyState: 1, send, close() {} };
  internals.wsconnected = true;
  return { provider, send };
}

/** An awareness update from another client, as the server relays it. */
function peerUpdate(): Uint8Array {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState({ user: { name: 'Peer' } });
  const update = encodeAwarenessUpdate(peer, [peer.clientID]);
  peer.destroy();
  return update;
}

describe('awareness echo', () => {
  it("the stock provider sends a peer's change back (why this module exists)", () => {
    const { provider, send } = offlineProvider();
    applyAwarenessUpdate(provider.awareness, peerUpdate(), 'server');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a peer's change once the handler is replaced", () => {
    const { provider, send } = offlineProvider();
    sendOnlyOwnAwareness(provider);
    applyAwarenessUpdate(provider.awareness, peerUpdate(), 'server');
    expect(send).not.toHaveBeenCalled();
  });

  it("still sends this client's changes, carrying only its own id", () => {
    const { provider, send } = offlineProvider();
    sendOnlyOwnAwareness(provider);
    applyAwarenessUpdate(provider.awareness, peerUpdate(), 'server');
    provider.awareness.setLocalState({ user: { name: 'Me' } });
    expect(send).toHaveBeenCalledTimes(1);
    const outer = decoding.createDecoder(send.mock.calls[0]?.[0] as Uint8Array);
    expect(decoding.readVarUint(outer)).toBe(1); // messageAwareness
    const inner = decoding.createDecoder(decoding.readVarUint8Array(outer));
    expect(decoding.readVarUint(inner)).toBe(1); // one entry
    expect(decoding.readVarUint(inner)).toBe(provider.awareness.clientID);
  });

  it('builds no frame for a change that leaves this client out', () => {
    const awareness = new Awareness(new Y.Doc());
    expect(ownAwarenessFrame(awareness, { added: [7], updated: [], removed: [] })).toBeNull();
    awareness.destroy();
  });
});
