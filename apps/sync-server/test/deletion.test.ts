import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import { writeSyncStep1, writeSyncStep2, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';
import { isPureDeletion, readSyncUpdate } from '../src/deletion';

/** Captures the next update `fn` produces on `doc`. */
function updateOf(doc: Y.Doc, fn: () => void): Uint8Array {
  let update: Uint8Array | undefined;
  const on = (u: Uint8Array) => {
    update = u;
  };
  doc.on('update', on);
  fn();
  doc.off('update', on);
  if (!update) throw new Error('no update produced');
  return update;
}

/** A V1 update with no structs and one delete range, spelled out by hand (len may be 0). */
function deleteRange(client: number, clock: number, len: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // no structs
  encoding.writeVarUint(encoder, 1); // one client in the delete set
  encoding.writeVarUint(encoder, client);
  encoding.writeVarUint(encoder, 1); // one range
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarUint(encoder, len);
  return encoding.toUint8Array(encoder);
}

function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync
  write(encoder);
  return encoding.toUint8Array(encoder);
}

describe('readSyncUpdate', () => {
  it('returns the update of an Update or SyncStep2 frame', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, () => doc.getMap('m').set('a', 1));
    expect(readSyncUpdate(syncFrame((e) => writeUpdate(e, update)))).toEqual(update);
    const step2 = readSyncUpdate(syncFrame((e) => writeSyncStep2(e, doc)));
    expect(step2).toEqual(Y.encodeStateAsUpdate(doc));
  });

  it('returns null for SyncStep1, awareness, truncated frames and trailing bytes', () => {
    const doc = new Y.Doc();
    expect(readSyncUpdate(syncFrame((e) => writeSyncStep1(e, doc)))).toBeNull();
    expect(readSyncUpdate(Uint8Array.of(1, 0))).toBeNull();
    expect(readSyncUpdate(Uint8Array.of(0, 2, 9, 1))).toBeNull();
    const good = syncFrame((e) => writeUpdate(e, Y.encodeStateAsUpdate(doc)));
    expect(readSyncUpdate(Uint8Array.of(...good, 0))).toBeNull();
    expect(readSyncUpdate(new Uint8Array())).toBeNull();
  });
});

describe('isPureDeletion', () => {
  /** A server document and a client that has everything the server has. */
  function pair() {
    const server = new Y.Doc();
    const client = new Y.Doc();
    client.getMap('m').set('a', 'x'.repeat(100));
    client.getMap('m').set('b', 'y');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    return { server, client };
  }

  it('accepts an update that only deletes what the document has', () => {
    const { server, client } = pair();
    const update = updateOf(client, () => client.getMap('m').delete('a'));
    expect(isPureDeletion(update, server)).toBe(true);
  });

  it('accepts an update with nothing in it', () => {
    const { server, client } = pair();
    expect(isPureDeletion(Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)), server)).toBe(
      true,
    );
  });

  it('refuses an update that adds a struct', () => {
    const { server, client } = pair();
    const update = updateOf(client, () => client.getMap('m').set('c', 1));
    expect(isPureDeletion(update, server)).toBe(false);
  });

  it('refuses a deletion of content the document does not have', () => {
    const { server, client } = pair();
    client.getMap('m').set('unsent', 1); // never reaches the server
    const update = updateOf(client, () => client.getMap('m').delete('unsent'));
    expect(isPureDeletion(update, server)).toBe(false);
  });

  it('refuses bytes that are not an update', () => {
    expect(isPureDeletion(Uint8Array.of(9, 9, 9, 9), new Y.Doc())).toBe(false);
  });

  it('accepts the deletion of several whole entries in one range', () => {
    const { server, client } = pair();
    const update = updateOf(client, () => {
      client.getMap('m').delete('a');
      client.getMap('m').delete('b');
    });
    expect(isPureDeletion(update, server)).toBe(true);
    // Both entries are single structs the client wrote one after the other: one range holds both.
    expect(isPureDeletion(deleteRange(client.clientID, 0, 2), server)).toBe(true);
  });

  it('refuses a range that ends past what the document has, though it starts inside', () => {
    const { server, client } = pair();
    expect(isPureDeletion(deleteRange(client.clientID, 1, 5), server)).toBe(false);
  });

  it('refuses a deletion by a client the document has never seen', () => {
    const { server } = pair();
    const stranger = new Y.Doc();
    stranger.getMap('m').set('z', 1);
    const update = updateOf(stranger, () => stranger.getMap('m').delete('z'));
    expect(isPureDeletion(update, server)).toBe(false);
    expect(isPureDeletion(deleteRange(stranger.clientID, 0, 1), server)).toBe(false);
  });
});

describe('isPureDeletion and the structs a deletion would split', () => {
  const LENGTH = 2000;

  /** A server holding one text of a single struct, and the client that wrote it. */
  function textPair() {
    const server = new Y.Doc();
    const client = new Y.Doc();
    client.getText('t').insert(0, 'x'.repeat(LENGTH));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    return { server, client };
  }

  const encodedBytes = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc).byteLength;

  it('refuses a deletion of every other character, which would split the text into pieces', () => {
    const { server, client } = textPair();
    const text = client.getText('t');
    const update = updateOf(client, () =>
      client.transact(() => {
        for (let i = LENGTH - 1; i >= 1; i -= 2) text.delete(i, 1);
      }),
    );
    expect(isPureDeletion(update, server)).toBe(false);
    // The reason, in bytes: the room applying it grows the document about ten times.
    const before = encodedBytes(server);
    Y.applyUpdate(server, update);
    expect(encodedBytes(server)).toBeGreaterThan(before * 5);
  });

  it('accepts the deletion of a text from its first character to its last, in one range', () => {
    const { server, client } = textPair();
    const update = updateOf(client, () => client.getText('t').delete(0, LENGTH));
    expect(isPureDeletion(update, server)).toBe(true);
  });

  it('refuses a range that starts inside a struct that is not yet deleted', () => {
    const { server, client } = textPair();
    expect(isPureDeletion(deleteRange(client.clientID, 5, LENGTH - 5), server)).toBe(false);
  });

  it('refuses a range that ends inside a struct that is not yet deleted', () => {
    const { server, client } = textPair();
    expect(isPureDeletion(deleteRange(client.clientID, 0, LENGTH - 5), server)).toBe(false);
  });

  it('refuses a range of length zero, which deletes nothing', () => {
    const { server, client } = textPair();
    expect(isPureDeletion(deleteRange(client.clientID, 5, 0), server)).toBe(false);
  });

  it('accepts a range over content that is already deleted, whole or not', () => {
    const { server, client } = textPair();
    const update = updateOf(client, () => client.getText('t').delete(0, LENGTH));
    Y.applyUpdate(server, update);
    expect(isPureDeletion(update, server)).toBe(true);
    expect(isPureDeletion(deleteRange(client.clientID, 5, LENGTH - 10), server)).toBe(true);
  });
});
