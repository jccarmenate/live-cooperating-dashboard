import type { Connector, Routing, Shape } from '../schema/types';

export type NewShape = Omit<Shape, 'z'> & { z?: string };
export type NewConnector = Omit<Connector, 'z'> & { z?: string };

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
  | { type: 'RenameColumn'; frameId: string; columnId: string; title: string };
