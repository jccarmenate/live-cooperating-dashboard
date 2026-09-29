import { MAX_CONNECTOR_LABEL } from '../schema/defaults';
import { type GraphDraft, type GraphEdge, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from './model';

export interface EdgeListError {
  /** 1-based line; 0 for errors about the whole list. */
  line: number;
  message: string;
}

const NAME = '[A-Za-z0-9_]{1,20}';
const ITEM = new RegExp(`^(${NAME})(?:\\s*(->|-)\\s*(${NAME})(?:\\s*:\\s*(.+))?)?$`);

/**
 * Parses "A-B, B->C:5, D" (newlines or commas between items): `-` undirected, `->` directed,
 * `:text` a label, a lone name an isolated node. Nothing is returned while errors remain.
 */
export function parseEdgeList(text: string): { draft: GraphDraft | null; errors: EdgeListError[] } {
  const names: string[] = [];
  const index = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const errors: EdgeListError[] = [];
  const node = (name: string): number => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      index.set(name, i);
    }
    return i;
  };
  text.split(/\r?\n/).forEach((lineText, i) => {
    const line = i + 1;
    for (const raw of lineText.split(',')) {
      const item = raw.trim();
      if (!item) continue;
      const m = ITEM.exec(item);
      if (!m) {
        errors.push({ line, message: `Cannot read "${item.slice(0, 40)}"` });
        continue;
      }
      const [, a, arrow, b, label] = m as unknown as [string, string, string?, string?, string?];
      if (!arrow || !b) {
        node(a);
        continue;
      }
      if (a === b) {
        errors.push({ line, message: `${a}-${a} is a self-loop` });
        continue;
      }
      const text = label?.trim();
      if (text !== undefined && text.length > MAX_CONNECTOR_LABEL) {
        errors.push({
          line,
          message: `The label on ${a}${arrow}${b} is longer than ${MAX_CONNECTOR_LABEL} characters`,
        });
        continue;
      }
      const edge: GraphEdge = { from: node(a), to: node(b), directed: arrow === '->' };
      if (text) edge.label = text;
      edges.push(edge);
    }
  });
  if (names.length === 0 && errors.length === 0)
    errors.push({ line: 0, message: 'The list is empty' });
  if (names.length > MAX_GRAPH_NODES) {
    errors.push({
      line: 0,
      message: `The graph has ${names.length} nodes (at most ${MAX_GRAPH_NODES})`,
    });
  }
  if (edges.length > MAX_GRAPH_EDGES) {
    errors.push({
      line: 0,
      message: `The graph has ${edges.length} edges (at most ${MAX_GRAPH_EDGES})`,
    });
  }
  return errors.length > 0
    ? { draft: null, errors }
    : { draft: { names, edges, layout: 'force' }, errors };
}
