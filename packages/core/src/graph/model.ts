import { colLetters } from '../sheet/address';

export const MAX_GRAPH_NODES = 100;
export const MAX_GRAPH_EDGES = 500;
export const MAX_NODE_NAME = 20;

/** An edge between two node indices. */
export interface GraphEdge {
  from: number;
  to: number;
  directed: boolean;
  label?: string;
}

export type LayoutKind = 'circle' | 'layered' | 'grid' | 'bipartite' | 'force';

/** A graph ready to lay out and create. */
export interface GraphDraft {
  names: string[];
  edges: GraphEdge[];
  layout: LayoutKind;
  /** circle: the node drawn in the middle (star centre, wheel hub). */
  center?: number;
  /** grid: nodes per row. */
  cols?: number;
  /** bipartite: how many of the first nodes form the left column. */
  left?: number;
}

export type NameStyle = 'letters' | 'numbers';

export const nodeName = (index: number, style: NameStyle): string =>
  style === 'letters' ? colLetters(index) : String(index + 1);
