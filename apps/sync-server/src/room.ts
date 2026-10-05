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
import { isPureDeletion, readSyncUpdate } from './deletion';
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

/** Yjs awareness protocol message type byte. */
const MESSAGE_AWARENESS = 1;

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

const encode = (message: ServerMessage): string => JSON.stringify(message);

/** One Durable Object per room: Yjs sync, capability roles, limits, SQLite persistence. */
export class Room extends YServer {
  static options = { hibernate: true };
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10_000, timeout: 5000 };

  /** YServer types `env` as the empty `Cloudflare.Env`; narrow it to this worker's bindings. */
  declare protected env: Env;

  /**
   * The document is over LIMITS.maxDocBytes: only deletions are accepted until a save measures
   * LIMITS.resumeDocBytes or less. In memory only, so a room that reloads between the two sizes
   * starts editable.
   */
  #full = false;
  /**
   * Running estimate of the document's encoded size: the last exact size plus the bytes of every
   * update the document has emitted since. Yjs emits only what was new, so a client re-sending
   * what the room already has adds nothing. It is exact about what the document holds because the
   * room holds nothing parked (see `#dropParked`).
   */
  #estimatedBytes = 0;
  readonly #buckets = new WeakMap<Connection, TokenBucket>();

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
      Y.applyUpdate(this.document, update);
      // A snapshot saved before the room refused parked data may carry some; without it the
      // document is smaller than the snapshot.
      const size = this.#dropParked()
        ? Y.encodeStateAsUpdate(this.document).byteLength
        : update.byteLength;
      this.#full = size > LIMITS.maxDocBytes;
      this.#estimatedBytes = size;
    }
    this.document.on('update', this.#onDocUpdate);
    initMeta(
      this.document,
      this.name === DEMO_ROOM
        ? { title: 'Sprint 14 Retro', breadcrumb: ['Q3 Planning'] }
        : { title: 'Untitled board', breadcrumb: [] },
    );
  }

  /** Counts what the document really gained, and measures exactly when the estimate crosses the cap. */
  readonly #onDocUpdate = (update: Uint8Array): void => {
    this.#estimatedBytes += update.byteLength;
    if (this.#full || this.#estimatedBytes <= LIMITS.maxDocBytes) return;
    const real = Y.encodeStateAsUpdate(this.document).byteLength;
    this.#estimatedBytes = real;
    if (real > LIMITS.maxDocBytes) this.#setFull(true);
  };

  #setFull(full: boolean): void {
    if (this.#full === full) return;
    this.#full = full;
    this.broadcastCustomMessage(encode({ type: 'room', full, now: Date.now() }));
  }

  /**
   * An update that depends on content the room has not received cannot be applied. Yjs parks it
   * in the store: it emits no update, so the size estimate never sees it; it is saved with the
   * document and handed to every client that syncs; and no deletion can remove it. So the room
   * keeps none. True when there was something to drop.
   */
  #dropParked(): boolean {
    const { store } = this.document;
    if (!store.pendingStructs && !store.pendingDs) return false;
    store.pendingStructs = null;
    store.pendingDs = null;
    return true;
  }

  async onSave(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.document);
    this.#estimatedBytes = update.byteLength;
    if (update.byteLength > LIMITS.maxDocBytes) this.#setFull(true);
    else if (update.byteLength <= LIMITS.resumeDocBytes) this.#setFull(false);
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
    return this.#full || roleOf(connection) !== 'edit';
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
        full: this.#full,
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
    let bucket = this.#buckets.get(connection);
    if (!bucket) {
      bucket = new TokenBucket(LIMITS.ratePerSecond, LIMITS.burst);
      this.#buckets.set(connection, bucket);
    }
    if (!bucket.take()) {
      // Closing (not dropping) keeps clients consistent: the reconnect re-runs a full sync.
      connection.close(4429, 'rate limited');
      return;
    }
    if (typeof message !== 'string') {
      if (isAwarenessMessage(message)) {
        this.#onAwareness(connection, toBytes(message));
        return;
      }
      if (this.#full && roleOf(connection) === 'edit') {
        const update = readSyncUpdate(toBytes(message));
        if (update) {
          this.#onUpdateWhileFull(connection, update);
          return;
        }
      }
    }
    super.onMessage(connection, message);
    // The sender's reconnect syncs from what the room really has: a client that was only ahead of
    // the room gets its change in that way.
    if (typeof message !== 'string' && this.#dropParked()) connection.close(4400, 'bad frame');
  }

  /**
   * A full board still takes deletions, so people can make room. y-partyserver would drop the
   * update (the room is read-only), so a pure deletion is applied here; its own update handler
   * then relays it to everyone.
   */
  #onUpdateWhileFull(connection: Connection, update: Uint8Array): void {
    if (isPureDeletion(update, this.document)) {
      Y.applyUpdate(this.document, update, connection);
      return;
    }
    if (stateOf(connection).rejected) return;
    patchState(connection, { rejected: true });
    this.sendCustomMessage(connection, encode({ type: 'rejected', now: Date.now() }));
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
    this.#buckets.delete(connection);
    super.onClose(connection, code, reason, wasClean);
  }

  onError(connection: Connection, error: unknown): void | Promise<void> {
    this.#buckets.delete(connection);
    return super.onError(connection, error);
  }
}
