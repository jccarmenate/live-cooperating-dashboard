import * as Y from 'yjs';
import { DEFAULT_STYLE, MAX_BOARD_TITLE, MAX_COLUMNS } from './defaults';
import { MAIN_PAGE, pageIdOf } from './pages';
import {
  type BoardMeta,
  type Connector,
  type Endpoint,
  SCHEMA_VERSION,
  SHAPE_TYPES,
  type Shape,
  type ShapeType,
  type Style,
  TEXT_TYPES,
} from './types';

const isShapeType = (v: unknown): v is ShapeType =>
  typeof v === 'string' && (SHAPE_TYPES as readonly string[]).includes(v);

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Anything with a keyed getter: a stored Y.Map, or a plain JSON object (clipboard). */
export interface Source {
  get(key: string): unknown;
}

const plainSource = (o: Record<string, unknown>): Source => ({
  get: (key) => (Object.hasOwn(o, key) ? o[key] : undefined),
});

function readStyle(v: unknown, type: ShapeType): Style {
  const d = DEFAULT_STYLE[type];
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const font = o.font === 'sans' || o.font === 'mono' || o.font === 'display' ? o.font : d.font;
  const style: Style = { fill: str(o.fill) ?? d.fill, stroke: str(o.stroke) ?? d.stroke, font };
  if (o.size === 's' || o.size === 'm' || o.size === 'l') style.size = o.size;
  return style;
}

/** Builds an immutable snapshot of one shape, or null if it is not a valid shape. */
export function readShape(id: string, m: Source): Shape | null {
  const type = m.get('type');
  if (!isShapeType(type)) return null;
  const shape: Shape = {
    id,
    type,
    x: num(m.get('x')),
    y: num(m.get('y')),
    w: num(m.get('w')),
    h: num(m.get('h')),
    z: str(m.get('z')) ?? 'a0',
    style: readStyle(m.get('style'), type),
    createdBy: str(m.get('createdBy')) ?? 'unknown',
    authorName: str(m.get('authorName')) ?? 'Unknown',
    createdAt: num(m.get('createdAt')),
  };
  const parentId = str(m.get('parentId'));
  if (parentId) shape.parentId = parentId;
  const columnId = str(m.get('columnId'));
  if (columnId) shape.columnId = columnId;
  if (m.get('locked') === true) shape.locked = true;
  const pageId = pageIdOf(m.get('pageId'));
  if (pageId !== MAIN_PAGE) shape.pageId = pageId;
  const tag = str(m.get('tag'));
  if (tag) shape.tag = tag;
  const lang = str(m.get('lang'));
  if (lang) shape.lang = lang;
  const text = m.get('text');
  if (text instanceof Y.Text) shape.text = text.toString();
  // Plain JSON (the clipboard) carries text as a string; a stored map must hold a Y.Text.
  else if (!(m instanceof Y.Map) && typeof text === 'string' && TEXT_TYPES.has(type))
    shape.text = text;
  const cols = m.get('columns');
  const list =
    cols instanceof Y.Array
      ? cols.toArray()
      : !(m instanceof Y.Map) && Array.isArray(cols)
        ? cols
        : null;
  if (list) {
    const seen = new Set<string>();
    const result: { id: string; title: string }[] = [];
    for (const c of list) {
      if (result.length >= MAX_COLUMNS) break;
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.title !== 'string' || seen.has(o.id)) continue;
      seen.add(o.id);
      result.push({ id: o.id, title: o.title });
    }
    shape.columns = result;
  }
  return shape;
}

const ANCHORS = ['n', 's', 'e', 'w', 'auto'] as const;

function readEndpoint(v: unknown): Endpoint | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.shapeId === 'string') {
    const anchor = o.anchor;
    if (typeof anchor !== 'string' || !(ANCHORS as readonly string[]).includes(anchor)) return null;
    return { shapeId: o.shapeId, anchor: anchor as (typeof ANCHORS)[number] };
  }
  if (
    typeof o.x === 'number' &&
    Number.isFinite(o.x) &&
    typeof o.y === 'number' &&
    Number.isFinite(o.y)
  ) {
    return { x: o.x, y: o.y };
  }
  return null;
}

/** Immutable snapshot of one connector, or null if an endpoint is malformed. */
export function readConnector(id: string, m: Source): Connector | null {
  const from = readEndpoint(m.get('from'));
  const to = readEndpoint(m.get('to'));
  if (!from || !to) return null;
  const pageId = pageIdOf(m.get('pageId'));
  return {
    id,
    from,
    to,
    routing: m.get('routing') === 'elbow' ? 'elbow' : 'straight',
    head: m.get('head') === 'none' ? 'none' : 'arrow',
    z: str(m.get('z')) ?? 'a0',
    createdBy: str(m.get('createdBy')) ?? 'unknown',
    ...(pageId !== MAIN_PAGE ? { pageId } : {}),
  };
}

export function readMeta(meta: Y.Map<unknown>): BoardMeta {
  const breadcrumb = meta.get('breadcrumb');
  return {
    schemaVersion: num(meta.get('schemaVersion'), SCHEMA_VERSION),
    title: (str(meta.get('title')) ?? 'Untitled board').slice(0, MAX_BOARD_TITLE),
    breadcrumb: Array.isArray(breadcrumb)
      ? breadcrumb.filter((b): b is string => typeof b === 'string')
      : [],
  };
}

const plainObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A shape from plain JSON (the clipboard), validated like a stored one; null if invalid. */
export function parseShape(v: unknown): Shape | null {
  const o = plainObject(v);
  if (!o || typeof o.id !== 'string' || o.id.length === 0) return null;
  return readShape(o.id, plainSource(o));
}

/** A connector from plain JSON (the clipboard); null if invalid. */
export function parseConnector(v: unknown): Connector | null {
  const o = plainObject(v);
  if (!o || typeof o.id !== 'string' || o.id.length === 0) return null;
  return readConnector(o.id, plainSource(o));
}
