import { describe, expect, it } from 'vitest';
import {
  bfs,
  type Connector,
  connectedComponents,
  DEFAULT_STYLE,
  dfs,
  edgeWeight,
  type GraphView,
  minimumSpanningTree,
  readGraph,
  runAlgorithm,
  type Shape,
  shortestPath,
} from '../src';

const shape = (id: string, x: number, y: number, text = id): Shape => ({
  id,
  type: 'ellipse',
  x,
  y,
  w: 56,
  h: 56,
  z: 'a0',
  style: DEFAULT_STYLE.ellipse,
  text,
  createdBy: 'u',
  authorName: 'A',
  createdAt: 0,
});
const link = (
  id: string,
  from: string,
  to: string,
  label?: string,
  directed = false,
): Connector => ({
  id,
  from: { shapeId: from, anchor: 'auto' },
  to: { shapeId: to, anchor: 'auto' },
  routing: 'straight',
  head: directed ? 'arrow' : 'none',
  z: 'a0',
  createdBy: 'u',
  ...(label !== undefined ? { label } : {}),
});
const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

// A(0,0) B(200,0) C(0,200) D(200,200) E(500,500, isolated)
const shapes = byId([
  shape('a', 0, 0, 'A'),
  shape('b', 200, 0, 'B'),
  shape('c', 0, 200, 'C'),
  shape('d', 200, 200, 'D'),
  shape('e', 500, 500, ''),
]);
const connectors = byId([
  link('ab', 'a', 'b', '1'),
  link('ac', 'a', 'c', '4'),
  link('bd', 'b', 'd', '2'),
  link('cd', 'c', 'd', 'x'),
  link('free', 'a', 'a'),
]);
const g: GraphView = readGraph([], shapes, connectors);

describe('readGraph', () => {
  it('orders nodes top-to-bottom, left-to-right and names unnamed ones', () => {
    expect(g.nodes).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
      { id: 'd', name: 'D' },
      { id: 'e', name: '#5' },
    ]);
  });

  it('keeps connectors between nodes (no self-loops) with numeric or default weights', () => {
    expect(g.edges.map((e) => [e.id, e.weight])).toEqual([
      ['ab', 1],
      ['ac', 4],
      ['bd', 2],
      ['cd', 1],
    ]);
    expect(edgeWeight(' 2.5 ')).toBe(2.5);
    expect(edgeWeight('far')).toBe(1);
    expect(edgeWeight(undefined)).toBe(1);
  });

  it('uses only the selected shapes when there is a selection', () => {
    const sub = readGraph(['a', 'b', 'ab'], shapes, connectors);
    expect(sub.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(sub.edges.map((e) => e.id)).toEqual(['ab']);
  });
});

describe('algorithms', () => {
  it('BFS and DFS visit in neighbour order', () => {
    expect(bfs(g, 'a')).toEqual({
      kind: 'traversal',
      order: ['a', 'b', 'c', 'd'],
      edges: ['ab', 'ac', 'bd'],
    });
    expect(dfs(g, 'a')).toEqual({
      kind: 'traversal',
      order: ['a', 'b', 'd', 'c'],
      edges: ['ab', 'bd', 'cd'],
    });
    expect(bfs(g, 'missing')).toEqual({ kind: 'error', message: 'Pick a start node' });
  });

  it('Dijkstra finds the cheapest path and its cost', () => {
    // A→C directly costs 4 and A→B→D→C also costs 4: strict relaxation keeps the first found.
    expect(shortestPath(g, 'a', 'c')).toEqual({
      kind: 'path',
      nodes: ['a', 'c'],
      edges: ['ac'],
      cost: 4,
    });
    expect(shortestPath(g, 'a', 'd')).toEqual({
      kind: 'path',
      nodes: ['a', 'b', 'd'],
      edges: ['ab', 'bd'],
      cost: 3,
    });
    expect(shortestPath(g, 'a', 'e')).toEqual({ kind: 'error', message: 'No path from A to #5' });
    expect(shortestPath(g, 'a', 'a')).toEqual({ kind: 'path', nodes: ['a'], edges: [], cost: 0 });
  });

  it('respects edge direction and rejects negative weights', () => {
    const directed = readGraph([], shapes, byId([link('ab', 'a', 'b', '1', true)]));
    expect(shortestPath(directed, 'b', 'a')).toEqual({
      kind: 'error',
      message: 'No path from B to A',
    });
    const negative = readGraph([], shapes, byId([link('ab', 'a', 'b', '-2')]));
    expect(shortestPath(negative, 'a', 'b')).toEqual({
      kind: 'error',
      message: 'Shortest path needs weights of zero or more',
    });
  });

  it('builds a minimum spanning forest', () => {
    expect(minimumSpanningTree(g)).toEqual({ kind: 'mst', edges: ['ab', 'cd', 'bd'], total: 4 });
  });

  it('finds weakly connected components', () => {
    expect(connectedComponents(g)).toEqual({
      kind: 'components',
      groups: [['a', 'b', 'c', 'd'], ['e']],
    });
  });

  it('treats parallel edges as separate edges without revisiting nodes', () => {
    const three = byId([shape('a', 0, 0, 'A'), shape('b', 200, 0, 'B'), shape('c', 400, 0, 'C')]);
    const pg = readGraph(
      [],
      three,
      byId([link('ab1', 'a', 'b', '5'), link('ab2', 'a', 'b', '2'), link('bc', 'b', 'c', '1')]),
    );
    expect(pg.edges.map((e) => e.id)).toEqual(['ab1', 'ab2', 'bc']);
    expect(bfs(pg, 'a')).toEqual({
      kind: 'traversal',
      order: ['a', 'b', 'c'],
      edges: ['ab2', 'bc'],
    });
    expect(dfs(pg, 'a')).toEqual({
      kind: 'traversal',
      order: ['a', 'b', 'c'],
      edges: ['ab2', 'bc'],
    });
    expect(shortestPath(pg, 'a', 'c')).toEqual({
      kind: 'path',
      nodes: ['a', 'b', 'c'],
      edges: ['ab2', 'bc'],
      cost: 3,
    });
    expect(minimumSpanningTree(pg)).toEqual({ kind: 'mst', edges: ['bc', 'ab2'], total: 3 });
    expect(connectedComponents(pg)).toEqual({ kind: 'components', groups: [['a', 'b', 'c']] });
  });

  it('runAlgorithm dispatches by kind', () => {
    expect(runAlgorithm(g, 'path', 'a', 'd')).toMatchObject({ kind: 'path', cost: 3 });
    expect(runAlgorithm(g, 'path', 'a')).toEqual({ kind: 'error', message: 'Pick an end node' });
    expect(runAlgorithm({ nodes: [], edges: [] }, 'components')).toEqual({
      kind: 'error',
      message: 'There are no nodes to work on',
    });
  });
});
