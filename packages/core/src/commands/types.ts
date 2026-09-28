import type {
  CommentAnchor,
  CommentEntry,
  Connector,
  PageType,
  Routing,
  Shape,
  Style,
} from '../schema/types';

export type NewShape = Omit<Shape, 'z'> & { z?: string };
export type NewConnector = Omit<Connector, 'z'> & { z?: string };
export type StylePatch = Partial<Pick<Style, 'fill' | 'stroke' | 'font' | 'size'>>;

export type Command =
  | { type: 'CreateShape'; shape: NewShape }
  | { type: 'MoveShapes'; moves: { id: string; x: number; y: number }[] }
  | { type: 'ResizeShapes'; rects: { id: string; x: number; y: number; w: number; h: number }[] }
  | { type: 'SetText'; id: string; index: number; deleteCount: number; insert: string }
  | { type: 'DeleteShapes'; ids: string[] }
  | { type: 'Connect'; connector: NewConnector }
  | { type: 'SetRouting'; id: string; routing: Routing }
  | {
      type: 'Reparent';
      moves: { id: string; parentId: string | null; columnId: string | null }[];
    }
  | { type: 'RenameColumn'; frameId: string; columnId: string; title: string }
  | { type: 'StartVote'; endsAt: number; maxPerUser: number; startedBy: string }
  | { type: 'EndVote' }
  | { type: 'CastVote'; shapeId: string; userId: string }
  | { type: 'RetractVote'; shapeId: string; userId: string }
  | {
      type: 'AddComment';
      id: string;
      pageId: string;
      anchor: CommentAnchor;
      createdBy: string;
      createdAt: number;
      entry: CommentEntry;
    }
  | { type: 'ReplyComment'; commentId: string; entry: CommentEntry }
  | { type: 'ResolveComment'; id: string; resolved: boolean }
  | {
      type: 'CreatePage';
      page: {
        id: string;
        type: PageType;
        title: string;
        order: string;
        createdBy: string;
        createdAt: number;
      };
    }
  | { type: 'RenamePage'; id: string; title: string }
  | { type: 'MovePage'; id: string; order: string }
  | { type: 'DeletePage'; id: string }
  | { type: 'RenameBoard'; title: string }
  | { type: 'SetZ'; ids: string[]; where: 'front' | 'back' }
  | { type: 'SetStyle'; ids: string[]; patch: StylePatch }
  | { type: 'SetLocked'; ids: string[]; locked: boolean }
  | { type: 'SetHead'; id: string; head: 'arrow' | 'none' }
  | { type: 'PasteItems'; shapes: NewShape[]; connectors: NewConnector[] };
