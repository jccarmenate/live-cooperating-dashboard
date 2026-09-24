import * as Y from 'yjs';
import { DEFAULT_STYLE } from './defaults';
import {
  type BoardMeta,
  SCHEMA_VERSION,
  SHAPE_TYPES,
  type Shape,
  type ShapeType,
  type Style,
} from './types';

const isShapeType = (v: unknown): v is ShapeType =>
  typeof v === 'string' && (SHAPE_TYPES as readonly string[]).includes(v);

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function readStyle(v: unknown, type: ShapeType): Style {
  const d = DEFAULT_STYLE[type];
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const font = o.font === 'sans' || o.font === 'mono' || o.font === 'display' ? o.font : d.font;
  return { fill: str(o.fill) ?? d.fill, stroke: str(o.stroke) ?? d.stroke, font };
}

/** Builds an immutable snapshot of one shape, or null if it is not a valid shape. */
export function readShape(id: string, m: Y.Map<unknown>): Shape | null {
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
  const tag = str(m.get('tag'));
  if (tag) shape.tag = tag;
  const lang = str(m.get('lang'));
  if (lang) shape.lang = lang;
  const text = m.get('text');
  if (text instanceof Y.Text) shape.text = text.toString();
  return shape;
}

export function readMeta(meta: Y.Map<unknown>): BoardMeta {
  const breadcrumb = meta.get('breadcrumb');
  return {
    schemaVersion: num(meta.get('schemaVersion'), SCHEMA_VERSION),
    title: str(meta.get('title')) ?? 'Untitled board',
    breadcrumb: Array.isArray(breadcrumb)
      ? breadcrumb.filter((b): b is string => typeof b === 'string')
      : [],
  };
}
