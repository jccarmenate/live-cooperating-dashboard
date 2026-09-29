import { isAttached } from '../geometry/connectors';
import type { Connector, Shape } from '../schema/types';

export interface GraphNode {
  id: string;
  name: string;
}

export interface GraphLink {
  id: string;
  from: string;
  to: string;
  directed: boolean;
  weight: number;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphLink[];
}

export type AlgorithmKind = 'bfs' | 'dfs' | 'path' | 'mst' | 'components';

export type AlgorithmResult =
  | { kind: 'traversal'; order: string[]; edges: string[] }
  | { kind: 'path'; nodes: string[]; edges: string[]; cost: number }
  | { kind: 'mst'; edges: string[]; total: number }
  | { kind: 'components'; groups: string[][] }
  | { kind: 'error'; message: string };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A connector label as an edge weight: a finite number, else 1. */
export function edgeWeight(label: string | undefined): number {
  const t = label?.trim() ?? '';
  if (!NUMBER.test(t)) return 1;
  const v = Number(t);
  return Number.isFinite(v) ? v : 1;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The graph an algorithm runs on: the selected shapes (or all of them) and the connectors between them. */
export function readGraph(
  selection: readonly string[],
  shapes: Readonly<Record<string, Shape>>,
  connectors: Readonly<Record<string, Connector>>,
): GraphView {
  const selected = selection.flatMap((id) => {
    const s = shapes[id];
    return s ? [s] : [];
  });
  const pool = selected.length > 0 ? selected : Object.values(shapes);
  const ordered = [...pool].sort((a, b) => a.y - b.y || a.x - b.x || byId(a.id, b.id));
  const nodes = ordered.map((s, i) => ({ id: s.id, name: s.text?.trim() || `#${i + 1}` }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Object.values(connectors)
    .flatMap((c): GraphLink[] => {
      if (!isAttached(c.from) || !isAttached(c.to)) return [];
      const from = c.from.shapeId;
      const to = c.to.shapeId;
      if (from === to || !ids.has(from) || !ids.has(to)) return [];
      return [{ id: c.id, from, to, directed: c.head === 'arrow', weight: edgeWeight(c.label) }];
    })
    .sort((a, b) => byId(a.id, b.id));
  return { nodes, edges };
}

interface Step {
  to: string;
  edge: string;
  weight: number;
}

function adjacency(g: GraphView, undirected = false): Map<string, Step[]> {
  const rank = new Map(g.nodes.map((n, i) => [n.id, i]));
  const adj = new Map<string, Step[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) {
    adj.get(e.from)?.push({ to: e.to, edge: e.id, weight: e.weight });
    if (!e.directed || undirected)
      adj.get(e.to)?.push({ to: e.from, edge: e.id, weight: e.weight });
  }
  for (const list of adj.values()) {
    list.sort(
      (a, b) =>
        (rank.get(a.to) as number) - (rank.get(b.to) as number) ||
        a.weight - b.weight ||
        byId(a.edge, b.edge),
    );
  }
  return adj;
}

const nameOf = (g: GraphView, id: string) => g.nodes.find((n) => n.id === id)?.name ?? id;
const has = (g: GraphView, id: string | undefined) =>
  id !== undefined && g.nodes.some((n) => n.id === id);

export function bfs(g: GraphView, start: string): AlgorithmResult {
  if (!has(g, start)) return { kind: 'error', message: 'Pick a start node' };
  const adj = adjacency(g);
  const seen = new Set([start]);
  const order = [start];
  const edges: string[] = [];
  for (let h = 0; h < order.length; h++) {
    for (const s of adj.get(order[h] as string) ?? []) {
      if (seen.has(s.to)) continue;
      seen.add(s.to);
      order.push(s.to);
      edges.push(s.edge);
    }
  }
  return { kind: 'traversal', order, edges };
}

export function dfs(g: GraphView, start: string): AlgorithmResult {
  if (!has(g, start)) return { kind: 'error', message: 'Pick a start node' };
  const adj = adjacency(g);
  const seen = new Set<string>();
  const order: string[] = [];
  const edges: string[] = [];
  const visit = (u: string) => {
    seen.add(u);
    order.push(u);
    for (const s of adj.get(u) ?? []) {
      if (seen.has(s.to)) continue;
      edges.push(s.edge);
      visit(s.to);
    }
  };
  visit(start);
  return { kind: 'traversal', order, edges };
}

export function shortestPath(g: GraphView, start: string, end: string): AlgorithmResult {
  if (!has(g, start)) return { kind: 'error', message: 'Pick a start node' };
  if (!has(g, end)) return { kind: 'error', message: 'Pick an end node' };
  if (g.edges.some((e) => e.weight < 0)) {
    return { kind: 'error', message: 'Shortest path needs weights of zero or more' };
  }
  const adj = adjacency(g);
  const dist = new Map<string, number>(g.nodes.map((n) => [n.id, Number.POSITIVE_INFINITY]));
  const prev = new Map<string, { node: string; edge: string }>();
  const done = new Set<string>();
  dist.set(start, 0);
  for (;;) {
    let u: string | null = null;
    for (const n of g.nodes) {
      if (done.has(n.id)) continue;
      if (u === null || (dist.get(n.id) as number) < (dist.get(u) as number)) u = n.id;
    }
    if (u === null || !Number.isFinite(dist.get(u) as number)) break;
    done.add(u);
    if (u === end) break;
    for (const s of adj.get(u) ?? []) {
      const next = (dist.get(u) as number) + s.weight;
      if (next < (dist.get(s.to) as number)) {
        dist.set(s.to, next);
        prev.set(s.to, { node: u, edge: s.edge });
      }
    }
  }
  const cost = dist.get(end) as number;
  if (!Number.isFinite(cost)) {
    return { kind: 'error', message: `No path from ${nameOf(g, start)} to ${nameOf(g, end)}` };
  }
  const nodes = [end];
  const edges: string[] = [];
  for (let at = end; at !== start; ) {
    const p = prev.get(at) as { node: string; edge: string };
    edges.unshift(p.edge);
    nodes.unshift(p.node);
    at = p.node;
  }
  return { kind: 'path', nodes, edges, cost };
}

function unionFind(ids: readonly string[]) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  return {
    find,
    union(a: string, b: string): boolean {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return false;
      parent.set(rb, ra);
      return true;
    },
  };
}

export function minimumSpanningTree(g: GraphView): AlgorithmResult {
  const rank = new Map(g.nodes.map((n, i) => [n.id, i]));
  const low = (e: GraphLink) => Math.min(rank.get(e.from) as number, rank.get(e.to) as number);
  const high = (e: GraphLink) => Math.max(rank.get(e.from) as number, rank.get(e.to) as number);
  const sorted = [...g.edges].sort(
    (a, b) => a.weight - b.weight || low(a) - low(b) || high(a) - high(b) || byId(a.id, b.id),
  );
  const uf = unionFind(g.nodes.map((n) => n.id));
  const edges: string[] = [];
  let total = 0;
  for (const e of sorted) {
    if (uf.union(e.from, e.to)) {
      edges.push(e.id);
      total += e.weight;
    }
  }
  return { kind: 'mst', edges, total };
}

export function connectedComponents(g: GraphView): AlgorithmResult {
  const uf = unionFind(g.nodes.map((n) => n.id));
  for (const e of g.edges) uf.union(e.from, e.to);
  const groups = new Map<string, string[]>();
  for (const n of g.nodes) {
    const root = uf.find(n.id);
    const list = groups.get(root);
    if (list) list.push(n.id);
    else groups.set(root, [n.id]);
  }
  return { kind: 'components', groups: [...groups.values()] };
}

export function runAlgorithm(
  g: GraphView,
  kind: AlgorithmKind,
  start?: string,
  end?: string,
): AlgorithmResult {
  if (g.nodes.length === 0) return { kind: 'error', message: 'There are no nodes to work on' };
  switch (kind) {
    case 'bfs':
      return bfs(g, start ?? '');
    case 'dfs':
      return dfs(g, start ?? '');
    case 'path':
      return shortestPath(g, start ?? '', end ?? '');
    case 'mst':
      return minimumSpanningTree(g);
    case 'components':
      return connectedComponents(g);
  }
}
