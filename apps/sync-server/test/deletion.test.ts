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
});
