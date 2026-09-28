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
  'frame',
]);

export type FontRole = 'sans' | 'mono' | 'display';

export type TextSize = 's' | 'm' | 'l';

export interface Style {
  fill: string;
  stroke: string;
  font: FontRole;
  /** Text size; absent = 'm'. */
  size?: TextSize;
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

export type AnchorSide = 'n' | 's' | 'e' | 'w';
export type Anchor = AnchorSide | 'auto';
export type AttachedEnd = { shapeId: string; anchor: Anchor };
export type FreeEnd = { x: number; y: number };
export type Endpoint = AttachedEnd | FreeEnd;
export type Routing = 'straight' | 'elbow';

export interface FrameColumn {
  id: string;
  title: string;
}

export interface Connector {
  id: string;
  /** Page the item lives on; absent = the implicit 'main' page. */
  pageId?: string;
  from: Endpoint;
  to: Endpoint;
  routing: Routing;
  head: 'arrow' | 'none';
  /** Fractional-index key; ties are broken by id. */
  z: string;
  createdBy: string;
}

export interface Shape extends Rect {
  id: string;
  /** Page the item lives on; absent = the implicit 'main' page. */
  pageId?: string;
  type: ShapeType;
  /** Fractional-index key; ties are broken by id. */
  z: string;
  parentId?: string;
  columnId?: string;
  style: Style;
  text?: string;
  tag?: string;
  lang?: string;
  columns?: FrameColumn[];
  /** Nobody can move, resize, delete, restyle or edit it until it is unlocked. */
  locked?: true;
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

export interface VoteState {
  open: boolean;
  /** Server epoch ms; the vote is open while `open && serverNow < endsAt`. */
  endsAt: number;
  maxPerUser: number;
  startedBy: string;
}

/** A comment pinned to a shape (offset from its top-left) or to a world point. */
export type CommentAnchor = { shapeId: string; dx: number; dy: number } | { x: number; y: number };

export interface CommentEntry {
  id: string;
  authorId: string;
  author: string;
  body: string;
  ts: number;
}

export interface CommentThread {
  id: string;
  pageId: string;
  anchor: CommentAnchor;
  resolved: boolean;
  createdBy: string;
  createdAt: number;
  entries: CommentEntry[];
}

export type PageType = 'board' | 'sheet' | 'calendar';

export interface PageInfo {
  id: string;
  /** 'unknown' for a type this client does not know (rendered as a notice). */
  type: PageType | 'unknown';
  title: string;
  /** Fractional-index key; ties broken by id. */
  order: string;
  createdBy: string;
  createdAt: number;
}
