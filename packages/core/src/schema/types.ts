export type ShapeType = 'rect' | 'ellipse' | 'line' | 'text' | 'sticky' | 'code' | 'frame';

export const SHAPE_TYPES: readonly ShapeType[] = [
  'rect',
  'ellipse',
  'line',
  'text',
  'sticky',
  'code',
  'frame',
];

/** Shape types that own a `Y.Text` under the `text` key. */
export const TEXT_TYPES: ReadonlySet<ShapeType> = new Set<ShapeType>([
  'rect',
  'ellipse',
  'text',
  'sticky',
  'code',
]);

export type FontRole = 'sans' | 'mono' | 'display';

export interface Style {
  fill: string;
  stroke: string;
  font: FontRole;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shape extends Rect {
  id: string;
  type: ShapeType;
  /** Fractional-index key; ties are broken by id. */
  z: string;
  parentId?: string;
  columnId?: string;
  style: Style;
  text?: string;
  tag?: string;
  lang?: string;
  createdBy: string;
  authorName: string;
  createdAt: number;
}

export interface BoardMeta {
  schemaVersion: number;
  title: string;
  breadcrumb: string[];
}

export const SCHEMA_VERSION = 1;
