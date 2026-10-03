import { type PresenceState, parsePresence } from '@relay/core';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** Yjs awareness protocol message type byte. */
const MESSAGE_AWARENESS = 1;

/**
 * Maximum value for Yjs client id and awareness clock (uint32).
 * lib0's readVarUint can return Infinity, NaN, or non-integers for over-long varints; encoding such
 * values back never terminates.
 */
const MAX_UINT32 = 0xffffffff;

/**
 * One client's state in an awareness update. `state` is JSON text; `'null'` removes the state.
 * clientId and clock are guaranteed to be integers in range [0, 0xffffffff] (uint32).
 */
export interface AwarenessEntry {
  clientId: number;
  clock: number;
  state: string;
}

function readEntries(update: Uint8Array): AwarenessEntry[] | null {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessEntry[] = [];
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    // Validate that clientId and clock are integers in range [0, MAX_UINT32]
    if (
      !Number.isInteger(clientId) ||
      clientId < 0 ||
      clientId > MAX_UINT32 ||
      !Number.isInteger(clock) ||
      clock < 0 ||
      clock > MAX_UINT32
    ) {
      return null;
    }
    const state = decoding.readVarString(decoder);
    entries.push({ clientId, clock, state });
  }
  return decoding.hasContent(decoder) ? null : entries;
}

/**
 * The entries of a wire awareness frame (type byte, then the update), or null when the frame is
 * not awareness, is truncated or carries bytes past its end.
 */
export function readAwarenessMessage(message: Uint8Array): AwarenessEntry[] | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== MESSAGE_AWARENESS) return null;
    const update = decoding.readVarUint8Array(decoder);
    if (decoding.hasContent(decoder)) return null;
    return readEntries(update);
  } catch {
    return null;
  }
}

/** An awareness update in the form `applyAwarenessUpdate` takes. */
export function encodeAwarenessUpdate(entries: readonly AwarenessEntry[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const e of entries) {
    encoding.writeVarUint(encoder, e.clientId);
    encoding.writeVarUint(encoder, e.clock);
    encoding.writeVarString(encoder, e.state);
  }
  return encoding.toUint8Array(encoder);
}

/** The wire frame for an awareness update. */
export function wrapAwareness(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** null: a removal. undefined: not JSON, or not valid presence. */
function sanitize(json: string): PresenceState | null | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (raw === null) return null;
  return parsePresence(raw) ?? undefined;
}

export interface AwarenessVerdict {
  /** Entries to apply and relay, with each state re-encoded from the validated value. */
  accepted: AwarenessEntry[];
  /** The ids the sender owns after this frame. */
  owned: number[];
  /** The sender tried to hold more ids than allowed; nothing from the frame is accepted. */
  tooMany: boolean;
}

/**
 * Decides what a connection may say in an awareness frame. An id belongs to the connection that
 * first claimed it, so entries for ids other connections own are dropped (older clients echo
 * their peers' states; that is not an error). States must pass `parsePresence`.
 */
export function filterAwareness(
  entries: readonly AwarenessEntry[],
  ctx: { owned: readonly number[]; ownedByOthers: ReadonlySet<number>; maxIds: number },
): AwarenessVerdict {
  const owned = [...ctx.owned];
  const accepted: AwarenessEntry[] = [];
  for (const e of entries) {
    if (ctx.ownedByOthers.has(e.clientId)) continue;
    const state = sanitize(e.state);
    if (state === undefined) continue;
    const at = owned.indexOf(e.clientId);
    if (state === null) {
      if (at === -1) continue;
      owned.splice(at, 1);
      accepted.push({ clientId: e.clientId, clock: e.clock, state: 'null' });
      continue;
    }
    if (at === -1) {
      if (owned.length >= ctx.maxIds) return { accepted: [], owned: [...ctx.owned], tooMany: true };
      owned.push(e.clientId);
    }
    accepted.push({ clientId: e.clientId, clock: e.clock, state: JSON.stringify(state) });
  }
  return { accepted, owned, tooMany: false };
}
