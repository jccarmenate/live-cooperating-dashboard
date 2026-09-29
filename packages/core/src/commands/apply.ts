import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { MAX_CONNECTOR_LABEL } from '../schema/defaults';
import { getRoots } from '../schema/doc';
import { compareZ } from '../schema/normalize';
import { MAIN_DEFAULTS, MAIN_PAGE, pageIdOf } from '../schema/pages';
import { readVote, voteKey } from '../schema/session';
import type { CommentEntry, FrameColumn } from '../schema/types';
import { TEXT_TYPES } from '../schema/types';
import {
  COL_WIDTH_DEFAULT,
  COL_WIDTH_MAX,
  COL_WIDTH_MIN,
  cellKey,
  MAX_CELL_SRC,
  splitCellKey,
} from '../sheet/model';
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

/**
 * The map of a page that is not deleted; for the implicit main page, created with its
 * defaults on first write. Two peers may create main's map concurrently and one write
 * is lost, but deletes live in `pageTombstones`, so that can only lose a rename or move.
 * An entry that is not a map (a misbehaving client) is left alone: undefined.
 */
function pageEntry(
  pages: Y.Map<Y.Map<unknown>>,
  tombstones: Y.Map<boolean>,
  id: string,
): Y.Map<unknown> | undefined {
  if (tombstones.has(id)) return undefined;
  const existing: unknown = pages.get(id);
  if (existing !== undefined || id !== MAIN_PAGE) {
    return existing instanceof Y.Map ? (existing as Y.Map<unknown>) : undefined;
  }
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(MAIN_DEFAULTS)) m.set(k, v);
  pages.set(id, m);
  return m;
}

const isLocked = (m: Y.Map<unknown> | undefined): boolean => m?.get('locked') === true;

const zOf = (m: Y.Map<unknown>): string => {
  const z = m.get('z');
  return typeof z === 'string' ? z : 'a0';
};

/** `n` ascending keys above `edge` (front) or below it (back); tolerant of a malformed edge. */
function keysBeyond(edge: string | null, where: 'front' | 'back', n: number): string[] {
  try {
    return where === 'front'
      ? generateNKeysBetween(edge, null, n)
      : generateNKeysBetween(null, edge, n);
  } catch {
    // A malformed key from a misbehaving client must not block the command.
    return generateNKeysBetween(null, null, n);
  }
}

/** Gives the moving members of one layer fresh keys past every other member, keeping their order. */
function restack(
  members: [string, Y.Map<unknown>][],
  moving: ReadonlySet<string>,
  where: 'front' | 'back',
): void {
  const chosen = members
    .filter(([id]) => moving.has(id))
    .sort((a, b) => compareZ({ id: a[0], z: zOf(a[1]) }, { id: b[0], z: zOf(b[1]) }));
  if (chosen.length === 0) return;
  const rest = members
    .filter(([id]) => !moving.has(id))
    .map(([, m]) => zOf(m))
    .sort();
  const edge = where === 'front' ? (rest.at(-1) ?? null) : (rest[0] ?? null);
  const keys = keysBeyond(edge, where, chosen.length);
  chosen.forEach(([, m], i) => {
    m.set('z', keys[i]);
  });
}

interface SheetMaps {
  rows: Y.Map<unknown>;
  cols: Y.Map<unknown>;
  cells: Y.Map<unknown>;
}

/** The maps of a page's sheet; null when the page has no (well-formed) sheet. Commands never create one. */
function sheetMaps(sheets: Y.Map<Y.Map<unknown>>, pageId: string): SheetMaps | null {
  const sheet: unknown = sheets.get(pageId);
  if (!(sheet instanceof Y.Map)) return null;
  const rows: unknown = sheet.get('rows');
  const cols: unknown = sheet.get('cols');
  const cells: unknown = sheet.get('cells');
  return rows instanceof Y.Map && cols instanceof Y.Map && cells instanceof Y.Map
    ? { rows, cols, cells }
    : null;
}

const clampWidth = (w: number): number =>
  Number.isFinite(w)
    ? Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(w)))
    : COL_WIDTH_DEFAULT;

/** Deletes the cells whose row (part 0) or column (part 1) is in `ids`. */
function deleteCellsOf(cells: Y.Map<unknown>, ids: ReadonlySet<string>, part: 0 | 1): void {
  for (const key of [...cells.keys()]) {
    const parts = splitCellKey(key);
    if (parts && ids.has(parts[part])) cells.delete(key);
  }
}

function apply(doc: Y.Doc, cmd: Command): void {
  const {
    shapes,
    connectors,
    session,
    votes,
    comments,
    pages,
    pageTombstones,
    meta,
    sheets,
    calendars,
  } = getRoots(doc);
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
        if (!m || isLocked(m)) continue;
        m.set('x', x);
        m.set('y', y);
      }
      return;
    }
    case 'ResizeShapes': {
      for (const { id, x, y, w, h } of cmd.rects) {
        const m = shapes.get(id);
        if (!m || isLocked(m)) continue;
        m.set('x', x);
        m.set('y', y);
        m.set('w', w);
        m.set('h', h);
      }
      return;
    }
    case 'SetText': {
      const m = shapes.get(cmd.id);
      if (isLocked(m)) return;
      const text = m?.get('text');
      if (!(text instanceof Y.Text)) return;
      const index = clamp(cmd.index, 0, text.length);
      const deleteCount = clamp(cmd.deleteCount, 0, text.length - index);
      if (deleteCount > 0) text.delete(index, deleteCount);
      if (cmd.insert) text.insert(index, cmd.insert);
      return;
    }
    case 'DeleteShapes': {
      const ids = new Set(cmd.ids.filter((id) => !isLocked(shapes.get(id))));
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
      const label = fields.label?.trim().slice(0, MAX_CONNECTOR_LABEL);
      if (label) m.set('label', label);
      m.set('createdBy', fields.createdBy);
      if (fields.pageId) m.set('pageId', fields.pageId);
      m.set('z', z ?? keyAbove(topKey(connectors)));
      connectors.set(fields.id, m);
      return;
    }
    case 'SetConnectorLabel': {
      const m = connectors.get(cmd.id);
      if (!m) return;
      const label = cmd.label.trim().slice(0, MAX_CONNECTOR_LABEL);
      if (label) m.set('label', label);
      else if (m.has('label')) m.delete('label');
      return;
    }
    case 'SetRouting': {
      connectors.get(cmd.id)?.set('routing', cmd.routing);
      return;
    }
    case 'Reparent': {
      for (const { id, parentId, columnId } of cmd.moves) {
        const m = shapes.get(id);
        if (!m || isLocked(m)) continue;
        if (parentId) m.set('parentId', parentId);
        else m.delete('parentId');
        if (columnId) m.set('columnId', columnId);
        else m.delete('columnId');
      }
      return;
    }
    case 'RenameColumn': {
      const frame = shapes.get(cmd.frameId);
      if (isLocked(frame)) return;
      const cols = frame?.get('columns');
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
    case 'SetZ': {
      // Frames, other shapes and connectors stack independently (they render in that order).
      const moving = new Set(cmd.ids);
      const all = [...shapes.entries()];
      restack(
        all.filter(([, m]) => m.get('type') === 'frame'),
        moving,
        cmd.where,
      );
      restack(
        all.filter(([, m]) => m.get('type') !== 'frame'),
        moving,
        cmd.where,
      );
      restack([...connectors.entries()], moving, cmd.where);
      return;
    }
    case 'SetStyle': {
      for (const id of new Set(cmd.ids)) {
        const m = shapes.get(id);
        if (!m || isLocked(m)) continue;
        const current = m.get('style');
        const next: Record<string, unknown> =
          current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
        for (const [key, value] of Object.entries(cmd.patch)) {
          if (value !== undefined) next[key] = value;
        }
        m.set('style', next);
      }
      return;
    }
    case 'SetLocked': {
      for (const id of new Set(cmd.ids)) {
        const m = shapes.get(id);
        if (!m) continue;
        if (cmd.locked) m.set('locked', true);
        else m.delete('locked');
      }
      return;
    }
    case 'SetHead': {
      connectors.get(cmd.id)?.set('head', cmd.head);
      return;
    }
    case 'PasteItems': {
      const fresh = cmd.shapes.filter((s) => !shapes.has(s.id) && !connectors.has(s.id));
      const shapeKeys = keysBeyond(topZ(doc), 'front', fresh.length);
      fresh.forEach((shape, i) => {
        apply(doc, { type: 'CreateShape', shape: { ...shape, z: shapeKeys[i] } });
      });
      const connectorKeys = keysBeyond(topKey(connectors), 'front', cmd.connectors.length);
      cmd.connectors.forEach((connector, i) => {
        apply(doc, { type: 'Connect', connector: { ...connector, z: connectorKeys[i] } });
      });
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
      m.set('pageId', cmd.pageId);
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
    case 'CreatePage': {
      if (pages.has(cmd.page.id) || pageTombstones.has(cmd.page.id)) return;
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(cmd.page)) if (k !== 'id') m.set(k, v);
      pages.set(cmd.page.id, m);
      if (cmd.page.type === 'sheet' && cmd.sheet && !sheets.has(cmd.page.id)) {
        const sheet = new Y.Map<unknown>();
        sheets.set(cmd.page.id, sheet);
        const rows = new Y.Map<unknown>();
        const cols = new Y.Map<unknown>();
        sheet.set('rows', rows);
        sheet.set('cols', cols);
        sheet.set('cells', new Y.Map<unknown>());
        for (const r of cmd.sheet.rows) {
          const rm = new Y.Map<unknown>();
          rows.set(r.id, rm);
          rm.set('order', r.order);
        }
        for (const c of cmd.sheet.cols) {
          const cm = new Y.Map<unknown>();
          cols.set(c.id, cm);
          cm.set('order', c.order);
        }
      }
      if (cmd.page.type === 'calendar' && !calendars.has(cmd.page.id)) {
        const calendar = new Y.Map<unknown>();
        calendars.set(cmd.page.id, calendar);
        calendar.set('events', new Y.Map<unknown>());
      }
      return;
    }
    case 'RenamePage': {
      pageEntry(pages, pageTombstones, cmd.id)?.set('title', cmd.title);
      return;
    }
    case 'MovePage': {
      pageEntry(pages, pageTombstones, cmd.id)?.set('order', cmd.order);
      return;
    }
    case 'DeletePage': {
      // Main always exists (implicitly or not); any other page must be held here as a map.
      if (cmd.id !== MAIN_PAGE && !((pages.get(cmd.id) as unknown) instanceof Y.Map)) return;
      if (!pageTombstones.has(cmd.id)) pageTombstones.set(cmd.id, true);
      if (sheets.has(cmd.id)) sheets.delete(cmd.id);
      if (calendars.has(cmd.id)) calendars.delete(cmd.id);
      const onPage = (item: Y.Map<unknown>) => pageIdOf(item.get('pageId')) === cmd.id;
      const removed = new Set<string>();
      for (const [id, s] of [...shapes.entries()]) {
        if (!onPage(s)) continue;
        shapes.delete(id);
        removed.add(id);
      }
      // Connectors on other pages that point at a removed shape go too.
      for (const [id, c] of [...connectors.entries()]) {
        if (onPage(c) || refersTo(c.get('from'), removed) || refersTo(c.get('to'), removed)) {
          connectors.delete(id);
        }
      }
      for (const [id, c] of [...comments.entries()]) if (onPage(c)) comments.delete(id);
      return;
    }
    case 'SetCells': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      for (const c of cmd.cells) {
        if (!(s.rows.get(c.row) instanceof Y.Map) || !(s.cols.get(c.col) instanceof Y.Map))
          continue;
        const key = cellKey(c.row, c.col);
        const src = c.src.slice(0, MAX_CELL_SRC);
        if (!src && !c.fmt) {
          if (s.cells.has(key)) s.cells.delete(key);
        } else {
          s.cells.set(key, c.fmt ? { src, fmt: c.fmt } : { src });
        }
      }
      return;
    }
    case 'InsertRows': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      for (const r of cmd.rows) {
        if (s.rows.has(r.id)) continue;
        const m = new Y.Map<unknown>();
        s.rows.set(r.id, m);
        m.set('order', r.order);
      }
      return;
    }
    case 'InsertCols': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      for (const c of cmd.cols) {
        if (s.cols.has(c.id)) continue;
        const m = new Y.Map<unknown>();
        s.cols.set(c.id, m);
        m.set('order', c.order);
        if (c.width !== undefined) m.set('width', clampWidth(c.width));
      }
      return;
    }
    case 'DeleteRows': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      const ids = new Set(cmd.ids);
      for (const id of ids) if (s.rows.has(id)) s.rows.delete(id);
      deleteCellsOf(s.cells, ids, 0);
      return;
    }
    case 'DeleteCols': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      const ids = new Set(cmd.ids);
      for (const id of ids) if (s.cols.has(id)) s.cols.delete(id);
      deleteCellsOf(s.cells, ids, 1);
      return;
    }
    case 'MoveRow':
    case 'MoveCol': {
      const s = sheetMaps(sheets, cmd.pageId);
      const m: unknown = (cmd.type === 'MoveRow' ? s?.rows : s?.cols)?.get(cmd.id);
      if (m instanceof Y.Map) m.set('order', cmd.order);
      return;
    }
    case 'SetColWidth': {
      const m: unknown = sheetMaps(sheets, cmd.pageId)?.cols.get(cmd.id);
      if (m instanceof Y.Map) m.set('width', clampWidth(cmd.width));
      return;
    }
    case 'RenameBoard':
      meta.set('title', cmd.title);
      return;
  }
}

/** Applies a command atomically inside a Yjs transaction with the given origin. */
export function applyCommand(doc: Y.Doc, cmd: Command, origin: unknown = null): void {
  doc.transact(() => apply(doc, cmd), origin);
}
