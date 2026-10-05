import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

/** Yjs sync protocol message type byte. */
const MESSAGE_SYNC = 0;
/** Sync sub-types that carry a document update. */
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

/** The Yjs update inside a SyncStep2 or Update frame, or null for any other frame. */
export function readSyncUpdate(message: Uint8Array): Uint8Array | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return null;
    const sub = decoding.readVarUint(decoder);
    if (sub !== SYNC_STEP2 && sub !== SYNC_UPDATE) return null;
    const update = decoding.readVarUint8Array(decoder);
    return decoding.hasContent(decoder) ? null : update;
  } catch {
    return null;
  }
}

/**
 * Whether `update` only deletes content `doc` already has: it adds no structs, and every range
 * of its delete set lies inside the document's state. A delete set that pointed past it would
 * be stored as pending and grow the document, so it is refused.
 */
export function isPureDeletion(update: Uint8Array, doc: Y.Doc): boolean {
  try {
    const { structs, ds } = Y.decodeUpdate(update);
    if (structs.length > 0) return false;
    const known = Y.decodeStateVector(Y.encodeStateVector(doc));
    for (const [client, ranges] of ds.clients) {
      const end = known.get(client) ?? 0;
      for (const range of ranges) if (range.clock + range.len > end) return false;
    }
    return true;
  } catch {
    return false;
  }
}
