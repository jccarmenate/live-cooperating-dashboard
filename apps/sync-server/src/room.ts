import { initMeta, isTimeRequest, type ServerMessage } from '@relay/core';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import { applyAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DEMO_ROOM, deriveKey, ROLE_HEADER, type Role, sessionId } from './auth';
import {
  encodeAwarenessUpdate,
  filterAwareness,
  readAwarenessMessage,
  wrapAwareness,
} from './awareness';
import type { Env } from './env';
import { LIMITS, messageBytes, TokenBucket } from './limits';

/**
 * What the room keeps on a connection. It survives hibernation. `__ypsAwarenessIds` is
 * y-partyserver's own key: on close it removes the awareness states of the ids listed there, so
 * the room records ownership in the same place.
 */
interface ConnState {
  role?: Role;
  sid?: string;
  rejected?: boolean;
  __ypsAwarenessIds?: unknown;
}

const stateOf = (connection: Connection): ConnState => (connection.state as ConnState | null) ?? {};

const patchState = (connection: Connection, patch: ConnState): void => {
  connection.setState((prev: unknown) => ({ ...((prev as object | null) ?? {}), ...patch }));
};

const roleOf = (connection: Connection): Role | undefined => stateOf(connection).role;

/** The awareness client ids this connection owns. */
function ownedIds(connection: Connection): number[] {
  const ids = stateOf(connection).__ypsAwarenessIds;
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
}

/** Yjs sync protocol message type byte for a document-update (`messageSync`) frame. */
const MESSAGE_SYNC = 0;
/** Yjs awareness protocol message type byte. */
const MESSAGE_AWARENESS = 1;
/** Sync-protocol sub-types (the varuint right after the message-type byte). */
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

function toBytes(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  return message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

/** First byte of a binary message, or null for a string (custom) message or an empty frame. */
function messageTypeByte(message: WSMessage): number | null {
  if (typeof message === 'string') return null;
  return toBytes(message)[0] ?? null;
}

/** True for a binary awareness-protocol frame. */
function isAwarenessMessage(message: WSMessage): boolean {
  return messageTypeByte(message) === MESSAGE_AWARENESS;
}

/**
 * The sync sub-type (SyncStep1/SyncStep2/Update) of a sync-protocol message,
 * i.e. the varuint immediately after the type byte. For these three values
 * (0, 1, 2) the varuint is always a single byte, so byte[1] suffices.
 */
function syncSubType(message: WSMessage): number | null {
  if (typeof message === 'string' || messageTypeByte(message) !== MESSAGE_SYNC) return null;
  return toBytes(message)[1] ?? null;
}

const encode = (message: ServerMessage): string => JSON.stringify(message);

/** One Durable Object per room: Yjs sync, capability roles, limits, SQLite persistence. */
export class Room extends YServer {
  static options = { hibernate: true };
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10_000, timeout: 5000 };

  /** YServer types `env` as the empty `Cloudflare.Env`; narrow it to this worker's bindings. */
  declare protected env: Env;

  /** Set when the persisted document exceeds LIMITS.maxDocBytes; the room becomes read-only. */
  #frozen = false;
  /**
   * Running estimate of the document's encoded size: the last saved/loaded
   * snapshot's byte length, plus every accepted sync-protocol message byte
   * count from edit-role connections since. Checked on arrival (via
   * `isReadOnly`) so a burst of updates can't blow past `maxDocBytes` between
   * debounced saves.
   */
  #estimatedBytes = 0;
  readonly #buckets = new Map<string, TokenBucket>();

  async onLoad(): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), data BLOB NOT NULL, updated_at INTEGER NOT NULL)',
    );
    const row = sql
      .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot WHERE id = 1')
      .toArray()[0];
    if (row) {
      const update = new Uint8Array(row.data);
      this.#frozen = update.byteLength > LIMITS.maxDocBytes;
      this.#estimatedBytes = update.byteLength;
      Y.applyUpdate(this.document, update);
    }
    initMeta(
      this.document,
      this.name === DEMO_ROOM
        ? { title: 'Sprint 14 Retro', breadcrumb: ['Q3 Planning'] }
        : { title: 'Untitled board', breadcrumb: [] },
    );
  }

  async onSave(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.document);
    this.#estimatedBytes = update.byteLength;
    this.#frozen = update.byteLength > LIMITS.maxDocBytes;
    if (update.byteLength > LIMITS.maxRowBytes) {
      // Writing this would exceed Cloudflare's per-row BLOB limit and throw;
      // skip the write rather than lose the room to an uncaught save error.
      console.error(
        `Room ${this.name}: snapshot too large to persist (${update.byteLength} bytes)`,
      );
      return;
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      new Uint8Array(update).buffer,
      Date.now(),
    );
  }

  isReadOnly(connection: Connection): boolean {
    return (
      this.#frozen || this.#estimatedBytes > LIMITS.maxDocBytes || roleOf(connection) !== 'edit'
    );
  }

  onConnect(connection: Connection, ctx: ConnectionContext): void {
    const header = ctx.request.headers.get(ROLE_HEADER);
    const role: Role | null = header === 'edit' || header === 'view' ? header : null;
    if (!role) {
      connection.close(4401, 'unauthorized');
      return;
    }
    const sid = sessionId(new URL(ctx.request.url).searchParams.get('sid'));
    // By socket, not by id: the provider keeps its connection id across reconnects, so the
    // socket a reconnecting tab left behind has the same id as the new one.
    const others = [...this.getConnections()].filter((c) => c !== connection);
    // One tab has one socket, so an older connection with this session id is dead. It is
    // retired before counting, or a reconnecting user would be locked out by their own ghost.
    const stale = sid ? others.filter((c) => stateOf(c).sid === sid) : [];
    if (others.length - stale.length >= LIMITS.maxConnections) {
      connection.close(4503, 'room full');
      return;
    }
    const inherited: number[] = [];
    for (const old of stale) {
      inherited.push(...ownedIds(old));
      // Emptied first: closing the stale socket must not remove the states the new one keeps.
      patchState(old, { __ypsAwarenessIds: [] });
      old.close(4409, 'superseded');
    }
    patchState(connection, {
      role,
      ...(sid ? { sid } : {}),
      __ypsAwarenessIds: [...new Set(inherited)].slice(0, LIMITS.maxAwarenessIds),
    });
    super.onConnect(connection, ctx);
    // Tell the client its capability and the server clock (vote timers use server time).
    void this.#sendHello(connection, role);
  }

  /**
   * Capability, server clock, whether the board is full and — for editors only — the view key for
   * sharing a read-only link.
   */
  async #sendHello(connection: Connection, role: Role): Promise<void> {
    let viewKey: string | undefined;
    // Every key edits the demo room, so a "view" link there would open an editable board.
    if (role === 'edit' && this.name !== DEMO_ROOM) {
      try {
        viewKey = await deriveKey(this.env.ROOM_SECRET, this.name, 'view');
      } catch {
        viewKey = undefined; // no secret configured: editors simply cannot share a view link
      }
    }
    this.sendCustomMessage(
      connection,
      encode({
        type: 'hello',
        role,
        now: Date.now(),
        full: this.#frozen,
        ...(viewKey ? { viewKey } : {}),
      }),
    );
  }

  onMessage(connection: Connection, message: WSMessage): void {
    // A socket whose role was rejected in onConnect (close() is not
    // instantaneous — the client can keep sending until the close handshake
    // completes) must never reach the Yjs protocol handler.
    if (!roleOf(connection)) return;
    if (messageBytes(message) > LIMITS.maxMessageBytes) {
      connection.close(1009, 'message too large');
      return;
    }
    let bucket = this.#buckets.get(connection.id);
    if (!bucket) {
      bucket = new TokenBucket(LIMITS.ratePerSecond, LIMITS.burst);
      this.#buckets.set(connection.id, bucket);
    }
    if (!bucket.take()) {
      // Closing (not dropping) keeps clients consistent: the reconnect re-runs a full sync.
      connection.close(4429, 'rate limited');
      return;
    }
    if (typeof message !== 'string' && isAwarenessMessage(message)) {
      this.#onAwareness(connection, toBytes(message));
      return;
    }
    // Only Update and SyncStep2 sub-messages can grow the document; SyncStep1
    // (a state-vector request, sent on every connect) never does and must
    // not be mistaken for document growth.
    const subType = roleOf(connection) === 'edit' ? syncSubType(message) : null;
    const countsTowardSize = subType === SYNC_STEP2 || subType === SYNC_UPDATE;
    const wasUnderLimit = this.#estimatedBytes <= LIMITS.maxDocBytes;
    if (countsTowardSize) this.#estimatedBytes += messageBytes(message);

    super.onMessage(connection, message);

    // The running estimate over-counts no-op resends (a reconnecting editor
    // re-sending updates the room already has). Rather than trust it forever
    // once it crosses the cap, re-measure the real encoded size exactly once
    // per crossing and only freeze if that's actually over.
    if (countsTowardSize && wasUnderLimit && this.#estimatedBytes > LIMITS.maxDocBytes) {
      const real = Y.encodeStateAsUpdate(this.document).byteLength;
      this.#estimatedBytes = real;
      this.#frozen = real > LIMITS.maxDocBytes;
    }
  }

  /**
   * Awareness is handled here, not by y-partyserver, which would apply and relay any frame
   * as-is: a connection could then rewrite a peer's state, and every echo of a peer's state
   * would be relayed to the whole room again.
   */
  #onAwareness(connection: Connection, bytes: Uint8Array): void {
    if (bytes.byteLength > LIMITS.maxAwarenessBytes) return;
    const entries = readAwarenessMessage(bytes);
    if (!entries) {
      connection.close(4400, 'bad frame');
      return;
    }
    const ownedByOthers = new Set<number>();
    for (const other of this.getConnections()) {
      // By socket, not by id: a reconnecting tab keeps its connection id.
      if (other !== connection) for (const id of ownedIds(other)) ownedByOthers.add(id);
    }
    const verdict = filterAwareness(entries, {
      owned: ownedIds(connection),
      ownedByOthers,
      maxIds: LIMITS.maxAwarenessIds,
    });
    if (verdict.tooMany) {
      connection.close(4429, 'too many awareness identities');
      return;
    }
    if (verdict.accepted.length === 0) return;
    const update = encodeAwarenessUpdate(verdict.accepted);
    const { awareness } = this.document;
    applyAwarenessUpdate(awareness, update, connection);
    // An id stays owned while its state is there: a removal the protocol ignored frees nothing.
    const states = awareness.getStates();
    patchState(connection, { __ypsAwarenessIds: verdict.owned.filter((id) => states.has(id)) });
    const frame = wrapAwareness(update);
    for (const peer of this.getConnections()) {
      try {
        peer.send(frame);
      } catch {
        // A peer that is closing: its own close handler cleans up.
      }
    }
  }

  onCustomMessage(connection: Connection, message: string): void {
    if (!roleOf(connection)) return;
    if (isTimeRequest(message)) {
      this.sendCustomMessage(connection, encode({ type: 'time', now: Date.now() }));
    }
  }

  onClose(connection: Connection, code: number, reason: string, wasClean: boolean): void {
    this.#buckets.delete(connection.id);
    super.onClose(connection, code, reason, wasClean);
  }

  onError(connection: Connection, error: unknown): void | Promise<void> {
    this.#buckets.delete(connection.id);
    return super.onError(connection, error);
  }
}
