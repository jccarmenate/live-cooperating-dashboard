import { initMeta } from '@relay/core';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import { DEMO_ROOM, ROLE_HEADER, type Role } from './auth';
import { LIMITS, messageBytes, TokenBucket } from './limits';

const roleOf = (connection: Connection): Role | undefined =>
  (connection.state as { role?: Role } | null)?.role;

/** Yjs sync protocol message type byte for a document-update (`messageSync`) frame. */
const MESSAGE_SYNC = 0;
/** Yjs awareness protocol message type byte. */
const MESSAGE_AWARENESS = 1;
/** Sync-protocol sub-types (the varuint right after the message-type byte). */
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

function toBytes(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  return message instanceof ArrayBuffer ? new Uint8Array(message) : new Uint8Array(message.buffer);
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

/** Number of awareness client ids this connection currently controls (y-partyserver tracked). */
function awarenessIdCount(connection: Connection): number {
  const ids = (connection.state as { __ypsAwarenessIds?: unknown[] } | null)?.__ypsAwarenessIds;
  return Array.isArray(ids) ? ids.length : 0;
}

/** One Durable Object per room: Yjs sync, capability roles, limits, SQLite persistence. */
export class Room extends YServer {
  static options = { hibernate: true };
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10_000, timeout: 5000 };

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
    if ([...this.getConnections()].length > LIMITS.maxConnections) {
      connection.close(4503, 'room full');
      return;
    }
    connection.setState((prev: unknown) => ({ ...((prev as object | null) ?? {}), role }));
    super.onConnect(connection, ctx);
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
    if (isAwarenessMessage(message) && messageBytes(message) > LIMITS.maxAwarenessBytes) {
      connection.close(1009, 'awareness frame too large');
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
    if (isAwarenessMessage(message) && awarenessIdCount(connection) > LIMITS.maxAwarenessIds) {
      connection.close(4429, 'too many awareness identities');
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
