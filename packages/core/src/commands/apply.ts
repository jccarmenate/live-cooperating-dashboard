import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { getRoots } from '../schema/doc';
import { readVote, voteKey } from '../schema/session';
import type { CommentEntry, FrameColumn } from '../schema/types';
import { TEXT_TYPES } from '../schema/types';
import type { Command } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function topKey(map: Y.Map<Y.Map<unknown>>): string | null {
  let max: string | null = null;
  for (const m of map.values()) {
    const z = m.get('z');
    if (typeof z === 'string' && (max === null || z > max)) max = z;
  }
  return max;
}

/** Highest z key among current shapes, or null if there are none. */
export function topZ(doc: Y.Doc): string | null {
  return topKey(getRoots(doc).shapes);
}

function keyAbove(top: string | null): string {
  try {
    return generateKeyBetween(top, null);
  } catch {
    // A malformed key from a misbehaving client must not block creation.
    return generateKeyBetween(null, null);
  }
}

function refersTo(end: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof end !== 'object' || end === null || !('shapeId' in end)) return false;
  const shapeId = (end as { shapeId: unknown }).shapeId;
  return typeof shapeId === 'string' && ids.has(shapeId);
}

function apply(doc: Y.Doc, cmd: Command): void {
  const { shapes, connectors, session, votes, comments } = getRoots(doc);
  switch (cmd.type) {
    case 'CreateShape': {
      const { text, z, columns, ...fields } = cmd.shape;
      if (shapes.has(fields.id) || connectors.has(fields.id)) return;
      const m = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) m.set(key, value);
      }
      m.set('z', z ?? keyAbove(topZ(doc)));
      if (TEXT_TYPES.has(fields.type)) m.set('text', new Y.Text(text ?? ''));
      if (fields.type === 'frame') {
        const arr = new Y.Array<FrameColumn>();
        arr.push((columns ?? []).map((c) => ({ id: c.id, title: c.title })));
        m.set('columns', arr);
      }
      shapes.set(fields.id, m);
      return;
    }
    case 'MoveShapes': {
      for (const { id, x, y } of cmd.moves) {
        const m = shapes.get(id);
        if (!m) continue;
        m.set('x', x);
        m.set('y', y);
      }
      return;
    }
    case 'ResizeShapes': {
      for (const { id, x, y, w, h } of cmd.rects) {
        const m = shapes.get(id);
        if (!m) continue;
        m.set('x', x);
        m.set('y', y);
        m.set('w', w);
        m.set('h', h);
      }
      return;
    }
    case 'SetText': {
      const text = shapes.get(cmd.id)?.get('text');
      if (!(text instanceof Y.Text)) return;
      const index = clamp(cmd.index, 0, text.length);
      const deleteCount = clamp(cmd.deleteCount, 0, text.length - index);
      if (deleteCount > 0) text.delete(index, deleteCount);
      if (cmd.insert) text.insert(index, cmd.insert);
      return;
    }
    case 'DeleteShapes': {
      const ids = new Set(cmd.ids);
      for (const id of ids) shapes.delete(id);
      for (const id of ids) if (connectors.has(id)) connectors.delete(id);
      const doomed: string[] = [];
      for (const [cid, c] of connectors.entries()) {
        if (refersTo(c.get('from'), ids) || refersTo(c.get('to'), ids)) doomed.push(cid);
      }
      for (const cid of doomed) connectors.delete(cid);
      return;
    }
    case 'Connect': {
      const { z, ...fields } = cmd.connector;
      if (shapes.has(fields.id) || connectors.has(fields.id)) return;
      const m = new Y.Map<unknown>();
      m.set('from', fields.from);
      m.set('to', fields.to);
      m.set('routing', fields.routing);
      m.set('head', fields.head);
      m.set('createdBy', fields.createdBy);
      m.set('z', z ?? keyAbove(topKey(connectors)));
      connectors.set(fields.id, m);
      return;
    }
    case 'SetRouting': {
      connectors.get(cmd.id)?.set('routing', cmd.routing);
      return;
    }
    case 'Reparent': {
      for (const { id, parentId, columnId } of cmd.moves) {
        const m = shapes.get(id);
        if (!m) continue;
        if (parentId) m.set('parentId', parentId);
        else m.delete('parentId');
        if (columnId) m.set('columnId', columnId);
        else m.delete('columnId');
      }
      return;
    }
    case 'RenameColumn': {
      const cols = shapes.get(cmd.frameId)?.get('columns');
      if (!(cols instanceof Y.Array)) return;
      const indexes: number[] = [];
      cols.toArray().forEach((c: unknown, i: number) => {
        if ((c as { id?: unknown } | null)?.id === cmd.columnId) indexes.push(i);
      });
      if (indexes.length === 0) return;
      // Delete highest index first so earlier indices stay valid, then
      // compact any duplicate entries a prior concurrent rename left behind.
      for (let i = indexes.length - 1; i >= 0; i--) {
        const idx = indexes[i];
        if (idx !== undefined) cols.delete(idx, 1);
      }
      cols.insert(indexes[0] as number, [{ id: cmd.columnId, title: cmd.title }]);
      return;
    }
    case 'StartVote': {
      session.set('vote', {
        open: true,
        endsAt: cmd.endsAt,
        maxPerUser: cmd.maxPerUser,
        startedBy: cmd.startedBy,
      });
      for (const key of [...votes.keys()]) votes.delete(key);
      return;
    }
    case 'EndVote': {
      const vote = readVote(session);
      if (vote?.open) session.set('vote', { ...vote, open: false });
      return;
    }
    case 'CastVote':
      votes.set(voteKey(cmd.shapeId, cmd.userId), true);
      return;
    case 'RetractVote':
      votes.delete(voteKey(cmd.shapeId, cmd.userId));
      return;
    case 'AddComment': {
      if (comments.has(cmd.id)) return;
      const m = new Y.Map<unknown>();
      m.set('anchor', cmd.anchor);
      m.set('resolved', false);
      m.set('createdBy', cmd.createdBy);
      m.set('createdAt', cmd.createdAt);
      const thread = new Y.Array<CommentEntry>();
      thread.push([cmd.entry]);
      m.set('thread', thread);
      comments.set(cmd.id, m);
      return;
    }
    case 'ReplyComment': {
      const thread = comments.get(cmd.commentId)?.get('thread');
      if (thread instanceof Y.Array) thread.push([cmd.entry]);
      return;
    }
    case 'ResolveComment':
      comments.get(cmd.id)?.set('resolved', cmd.resolved);
      return;
  }
}

/** Applies a command atomically inside a Yjs transaction with the given origin. */
export function applyCommand(doc: Y.Doc, cmd: Command, origin: unknown = null): void {
  doc.transact(() => apply(doc, cmd), origin);
}
