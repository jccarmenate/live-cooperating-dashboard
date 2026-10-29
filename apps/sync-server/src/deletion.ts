import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import { MESSAGE_SYNC, SYNC_STEP2, SYNC_UPDATE } from './protocol';

/** A sync frame that carries a document update: which kind it is, and the update. */
export interface SyncFrame {
  sub: typeof SYNC_STEP2 | typeof SYNC_UPDATE;
  update: Uint8Array;
}

/**
 * The sub-type and the update of a SyncStep2 or Update frame, or null for any other frame
 * (SyncStep1, awareness, a sub-type this protocol does not have, a truncated frame, bytes past
 * its end). Type and sub-type are read as varints, as y-protocols reads them: a sub-type written
 * in a longer spelling of 2 is an Update.
 */
export function readSyncFrame(message: Uint8Array): SyncFrame | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return null;
    const sub = decoding.readVarUint(decoder);
    if (sub !== SYNC_STEP2 && sub !== SYNC_UPDATE) return null;
    const update = decoding.readVarUint8Array(decoder);
    return decoding.hasContent(decoder) ? null : { sub, update };
  } catch {
    return null;
  }
}

/** The Yjs update inside a SyncStep2 or Update frame, or null for any other frame. */
export function readSyncUpdate(message: Uint8Array): Uint8Array | null {
  return readSyncFrame(message)?.update ?? null;
}

/**
 * The encoded size of what `doc` holds. `Y.encodeStateAsUpdate` also encodes whatever is parked in
 * the store (an update that depends on content the document lacks), and the room keeps none of it:
 * it drops it as soon as the frame has been handled, which is after the document has announced
 * the part that applied. Measured in between, the parked rest would be counted. The parked data is
 * set aside for the measure and put back.
 */
export function heldBytes(doc: Y.Doc): number {
  const { store } = doc;
  const { pendingStructs, pendingDs } = store;
  store.pendingStructs = null;
  store.pendingDs = null;
  try {
    return Y.encodeStateAsUpdate(doc).byteLength;
  } finally {
    store.pendingStructs = pendingStructs;
    store.pendingDs = pendingDs;
  }
}

/**
 * Whether `update` only deletes content `doc` already has, and does so without growing it: it
 * adds no structs, every range of its delete set lies inside the document's state, and no range
 * cuts a struct that is not yet deleted. A delete set that pointed past the state would be stored
 * as pending, and Yjs splits a live struct that a range starts or ends inside (each split is a
 * struct more in the encoding: a delete set of every other character of a text makes a document
 * about eleven times its size, though it removes half the text). A range of length zero deletes
 * nothing, so it is refused too. Re-deleting what is already deleted splits nothing.
 */
export function isPureDeletion(update: Uint8Array, doc: Y.Doc): boolean {
  try {
    const { structs, ds } = Y.decodeUpdate(update);
    if (structs.length > 0) return false;
    for (const [client, ranges] of ds.clients) {
      const held = doc.store.clients.get(client);
      if (!held) return false;
      const end = Y.getState(doc.store, client);
      for (const { clock, len } of ranges) {
        if (len === 0 || clock + len > end) return false;
        const first = held[Y.findIndexSS(held, clock)];
        if (first && !first.deleted && first.id.clock < clock) return false;
        const last = held[Y.findIndexSS(held, clock + len - 1)];
        if (last && !last.deleted && last.id.clock + last.length > clock + len) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
