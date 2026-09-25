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

/** True for a binary sync-protocol frame (not awareness, not a string custom message). */
function isSyncMessage(message: WSMessage): boolean {
  if (typeof message === 'string') return false;
  const view =
    message instanceof ArrayBuffer ? new Uint8Array(message) : new Uint8Array(message.buffer);
  return view.length > 0 && view[0] === MESSAGE_SYNC;
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
    if (roleOf(connection) === 'edit' && isSyncMessage(message)) {
      this.#estimatedBytes += messageBytes(message);
    }
    super.onMessage(connection, message);
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
