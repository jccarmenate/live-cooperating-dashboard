import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { getRoots } from '../schema/doc';
import { TEXT_TYPES } from '../schema/types';
import type { Command } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Highest z key among current shapes, or null if there are none. */
export function topZ(doc: Y.Doc): string | null {
  let max: string | null = null;
  for (const m of getRoots(doc).shapes.values()) {
    const z = m.get('z');
    if (typeof z === 'string' && (max === null || z > max)) max = z;
  }
  return max;
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
  const { shapes, connectors } = getRoots(doc);
  switch (cmd.type) {
    case 'CreateShape': {
      const { text, z, ...fields } = cmd.shape;
      if (shapes.has(fields.id)) return;
      const m = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) m.set(key, value);
      }
      m.set('z', z ?? keyAbove(topZ(doc)));
      if (TEXT_TYPES.has(fields.type)) m.set('text', new Y.Text(text ?? ''));
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
      const doomed: string[] = [];
      for (const [cid, c] of connectors.entries()) {
        if (refersTo(c.get('from'), ids) || refersTo(c.get('to'), ids)) doomed.push(cid);
      }
      for (const cid of doomed) connectors.delete(cid);
      return;
    }
  }
}

/** Applies a command atomically inside a Yjs transaction with the given origin. */
export function applyCommand(doc: Y.Doc, cmd: Command, origin: unknown = null): void {
  doc.transact(() => apply(doc, cmd), origin);
}
