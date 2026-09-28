import type { NewConnector, NewShape } from '../commands/types';
import { isAttached } from '../geometry/connectors';
import { childrenOf, dropTarget } from '../geometry/frames';
import { centerOf, unionRects } from '../geometry/rect';
import { shapeBounds } from '../geometry/shapes';
import { DEFAULT_SIZE, DEFAULT_STYLE } from '../schema/defaults';
import { compareZ } from '../schema/normalize';
import { parseConnector, parseShape } from '../schema/snapshot';
import type { Connector, Endpoint, Point, Rect, Shape } from '../schema/types';

export const CLIP_PREFIX = 'relay-clip:v1:';
export const MAX_PASTE_SHAPES = 500;
export const MAX_PASTE_CONNECTORS = 1000;
export const MAX_PLAIN_PASTE = 2000;
export const PASTE_OFFSET = 24;

export type ClipShape = Omit<Shape, 'z' | 'pageId'>;
export type ClipConnector = Omit<Connector, 'z' | 'pageId'>;

/** What a copy carries: shapes and connectors in z order, without page or z. */
export interface ClipPayload {
  shapes: ClipShape[];
  connectors: ClipConnector[];
}

const stripShape = ({ z: _z, pageId: _page, ...rest }: Shape): ClipShape => rest;
const stripConnector = ({ z: _z, pageId: _page, ...rest }: Connector): ClipConnector => rest;

/**
 * The copy of a selection: the selected shapes plus the children of selected frames, and each
 * connector whose attached ends are all copied and that is selected or attached to a copied
 * shape. Null when nothing is copyable.
 */
export function copyPayload(
  selection: readonly string[],
  shapes: Readonly<Record<string, Shape>>,
  connectors: Readonly<Record<string, Connector>>,
): ClipPayload | null {
  const ids = new Set<string>();
  for (const id of selection) {
    const s = shapes[id];
    if (!s) continue;
    ids.add(id);
    if (s.type === 'frame') for (const child of childrenOf(shapes, id)) ids.add(child);
  }
  const picked = new Set(selection);
  const copiedShapes = [...ids]
    .flatMap((id) => {
      const s = shapes[id];
      return s ? [s] : [];
    })
    .sort(compareZ)
    .map(stripShape);
  const copiedConnectors = Object.values(connectors)
    .filter((c) => {
      const ends = [c.from, c.to].filter(isAttached);
      if (!ends.every((e) => ids.has(e.shapeId))) return false;
      return picked.has(c.id) || ends.length > 0;
    })
    .sort(compareZ)
    .map(stripConnector);
  if (copiedShapes.length === 0 && copiedConnectors.length === 0) return null;
  return { shapes: copiedShapes, connectors: copiedConnectors };
}

export const serializeClip = (p: ClipPayload): string => CLIP_PREFIX + JSON.stringify(p);

/** Clipboard text as a payload (every item validated, lists capped), or null if it is not a Relay clip. */
export function parseClip(text: string): ClipPayload | null {
  if (!text.startsWith(CLIP_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(CLIP_PREFIX.length));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
  const seen = new Set<string>();
  const shapes: ClipShape[] = [];
  for (const v of list(o.shapes, MAX_PASTE_SHAPES)) {
    const s = parseShape(v);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    shapes.push(stripShape(s));
  }
  const shapeIds = new Set(shapes.map((s) => s.id));
  const connectors: ClipConnector[] = [];
  for (const v of list(o.connectors, MAX_PASTE_CONNECTORS)) {
    const c = parseConnector(v);
    if (!c || seen.has(c.id)) continue;
    if (![c.from, c.to].every((e) => !isAttached(e) || shapeIds.has(e.shapeId))) continue;
    seen.add(c.id);
    connectors.push(stripConnector(c));
  }
  return shapes.length > 0 || connectors.length > 0 ? { shapes, connectors } : null;
}

export interface PasteContext {
  /** Shapes of the page being pasted onto (frames under pasted shapes adopt them). */
  shapes: Readonly<Record<string, Shape>>;
  newId(): string;
  userId: string;
  userName: string;
  now(): number;
}

/** Centred on a world point, or shifted by an offset from where the items were copied. */
export type PastePlacement = { at: Point } | { offset: number };

function payloadBounds(p: ClipPayload): Rect | null {
  const rects: Rect[] = p.shapes.map(shapeBounds);
  for (const c of p.connectors) {
    for (const e of [c.from, c.to]) if (!isAttached(e)) rects.push({ x: e.x, y: e.y, w: 0, h: 0 });
  }
  return unionRects(rects);
}

/**
 * New shapes and connectors for a paste. Ids are fresh, and parents and connector ends are
 * remapped. A parent (and its column) is kept only when the parent is pasted too. Any other
 * pasted non-frame shape drops into the page frame under its centre, like a new shape.
 * The paster becomes the creator.
 */
export function pastePlan(
  payload: ClipPayload,
  ctx: PasteContext,
  place: PastePlacement,
): { shapes: NewShape[]; connectors: NewConnector[] } {
  let dx: number;
  let dy: number;
  if ('at' in place) {
    const b = payloadBounds(payload);
    dx = b ? place.at.x - (b.x + b.w / 2) : 0;
    dy = b ? place.at.y - (b.y + b.h / 2) : 0;
  } else {
    dx = place.offset;
    dy = place.offset;
  }
  const idMap = new Map<string, string>();
  for (const s of payload.shapes) idMap.set(s.id, ctx.newId());
  const shapes: NewShape[] = payload.shapes.map((s) => {
    const { parentId, columnId, ...rest } = s;
    const out: NewShape = {
      ...rest,
      id: idMap.get(s.id) as string,
      x: s.x + dx,
      y: s.y + dy,
      createdBy: ctx.userId,
      authorName: ctx.userName,
      createdAt: ctx.now(),
    };
    const parent = parentId ? idMap.get(parentId) : undefined;
    if (parent) {
      out.parentId = parent;
      if (columnId) out.columnId = columnId;
    } else if (s.type !== 'frame') {
      const target = dropTarget(ctx.shapes, centerOf(shapeBounds(out)), new Set());
      if (target) {
        out.parentId = target.parentId;
        if (target.columnId) out.columnId = target.columnId;
      }
    }
    return out;
  });
  const end = (e: Endpoint): Endpoint | null => {
    if (!isAttached(e)) return { x: e.x + dx, y: e.y + dy };
    const id = idMap.get(e.shapeId);
    return id ? { shapeId: id, anchor: e.anchor } : null;
  };
  const connectors: NewConnector[] = [];
  for (const c of payload.connectors) {
    const from = end(c.from);
    const to = end(c.to);
    if (!from || !to) continue;
    connectors.push({
      id: ctx.newId(),
      from,
      to,
      routing: c.routing,
      head: c.head,
      createdBy: ctx.userId,
    });
  }
  return { shapes, connectors };
}

/** Text from another app pastes as a sticky centred on `at` (text capped at 2000 chars). */
export function plainTextSticky(text: string, at: Point, ctx: PasteContext): NewShape {
  const size = DEFAULT_SIZE.sticky;
  const shape: NewShape = {
    id: ctx.newId(),
    type: 'sticky',
    x: at.x - size.w / 2,
    y: at.y - size.h / 2,
    ...size,
    style: DEFAULT_STYLE.sticky,
    text: text.slice(0, MAX_PLAIN_PASTE),
    createdBy: ctx.userId,
    authorName: ctx.userName,
    createdAt: ctx.now(),
  };
  const target = dropTarget(ctx.shapes, at, new Set());
  if (target) {
    shape.parentId = target.parentId;
    if (target.columnId) shape.columnId = target.columnId;
  }
  return shape;
}
