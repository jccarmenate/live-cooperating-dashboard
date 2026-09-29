import { describe, expect, it } from 'vitest';
import { type FamilyParams, familyGraph, type GraphDraft, nodeName, parseEdgeList } from '../src';

const P: FamilyParams = { n: 5, m: 3, k: 2, depth: 2, p: 0.5 };
const plain = { directed: false, weighted: false, names: 'letters' as const };
const draft = (r: GraphDraft | { error: string }): GraphDraft => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('graph families', () => {
  it('names nodes with letters or numbers', () => {
    expect([0, 25, 26].map((i) => nodeName(i, 'letters'))).toEqual(['A', 'Z', 'AA']);
    expect(nodeName(4, 'numbers')).toBe('5');
  });

  it('builds each family with the expected size and layout', () => {
    const size = (kind: Parameters<typeof familyGraph>[0], p: Partial<FamilyParams> = {}) => {
      const d = draft(familyGraph(kind, { ...P, ...p }, plain));
      return [d.names.length, d.edges.length, d.layout];
    };
    expect(size('complete', { n: 6 })).toEqual([6, 15, 'circle']);
    expect(size('cycle', { n: 5 })).toEqual([5, 5, 'circle']);
    expect(size('path', { n: 4 })).toEqual([4, 3, 'layered']);
    expect(size('star', { n: 4 })).toEqual([5, 4, 'circle']);
    expect(size('wheel', { n: 5 })).toEqual([6, 10, 'circle']);
    expect(size('bipartite', { m: 2, n: 3 })).toEqual([5, 6, 'bipartite']);
    expect(size('grid', { m: 3, n: 4 })).toEqual([12, 17, 'grid']);
    expect(size('tree', { k: 2, depth: 2 })).toEqual([7, 6, 'layered']);
  });

  it('records layout hints', () => {
    expect(draft(familyGraph('star', P, plain)).center).toBe(0);
    expect(draft(familyGraph('wheel', P, plain)).center).toBe(0);
    expect(draft(familyGraph('bipartite', { ...P, m: 2, n: 3 }, plain)).left).toBe(2);
    expect(draft(familyGraph('grid', { ...P, m: 3, n: 4 }, plain)).cols).toBe(4);
  });

  it('points directed cycle and wheel rims around the ring, spokes hub → rim', () => {
    const directed = { ...plain, directed: true };
    const pairs = (d: GraphDraft) => d.edges.map((e) => [e.from, e.to]);
    const cycle = draft(familyGraph('cycle', { ...P, n: 4 }, directed));
    expect(cycle.edges.every((e) => e.directed)).toBe(true);
    expect(pairs(cycle)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
    const wheel = draft(familyGraph('wheel', { ...P, n: 3 }, directed));
    expect(pairs(wheel)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [2, 3],
      [3, 1],
    ]);
    // Undirected, the closing edge keeps its lower → higher order.
    expect(pairs(draft(familyGraph('cycle', { ...P, n: 4 }, plain))).at(-1)).toEqual([0, 3]);
  });

  it('points other directed families from lower to higher (trees parent → child)', () => {
    const complete = draft(familyGraph('complete', { ...P, n: 4 }, { ...plain, directed: true }));
    expect(complete.edges.every((e) => e.directed && e.from < e.to)).toBe(true);
    const tree = draft(familyGraph('tree', { ...P, k: 3, depth: 1 }, { ...plain, directed: true }));
    expect(tree.edges.map((e) => [e.from, e.to])).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
  });

  it('weights edges 1–9 and draws random graphs from the given random source', () => {
    const w = draft(familyGraph('path', { ...P, n: 6 }, { ...plain, weighted: true }, () => 0.99));
    expect(w.edges.every((e) => e.label === '9')).toBe(true);
    const none = draft(familyGraph('random', { ...P, n: 10, p: 0 }, plain, () => 0.5));
    expect(none.edges).toHaveLength(0);
    const all = draft(familyGraph('random', { ...P, n: 10, p: 1 }, plain, () => 0.5));
    expect(all.edges).toHaveLength(45);
  });

  it('rejects parameters out of range and oversized results', () => {
    expect(familyGraph('complete', { ...P, n: 21 }, plain)).toEqual({
      error: 'n must be a whole number from 1 to 20',
    });
    expect(familyGraph('cycle', { ...P, n: 2.5 }, plain)).toHaveProperty('error');
    expect(familyGraph('random', { ...P, p: 1.5 }, plain)).toEqual({
      error: 'p must be a number from 0 to 1',
    });
    expect(familyGraph('tree', { ...P, k: 5, depth: 3 }, plain)).toHaveProperty('error');
    expect(familyGraph('random', { ...P, n: 50, p: 1 }, plain)).toHaveProperty('error');
  });
});

describe('edge lists', () => {
  it('parses undirected, directed, labelled edges and isolated nodes', () => {
    const { draft: d, errors } = parseEdgeList('A-B, B->C:5\n  C - D : far away \nE');
    expect(errors).toEqual([]);
    expect(d?.names).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(d?.edges).toEqual([
      { from: 0, to: 1, directed: false },
      { from: 1, to: 2, directed: true, label: '5' },
      { from: 2, to: 3, directed: false, label: 'far away' },
    ]);
    expect(d?.layout).toBe('force');
  });

  it('reports errors with line numbers and creates nothing', () => {
    const { draft: d, errors } = parseEdgeList(`A-B\nA-A, B=C\nC-D:${'x'.repeat(41)}`);
    expect(d).toBeNull();
    expect(errors).toEqual([
      { line: 2, message: 'A-A is a self-loop' },
      { line: 2, message: 'Cannot read "B=C"' },
      { line: 3, message: 'The label on C-D is longer than 40 characters' },
    ]);
  });

  it('shows the arrow used in a self-loop error', () => {
    expect(parseEdgeList('A->A').errors).toEqual([{ line: 1, message: 'A->A is a self-loop' }]);
  });

  it('names a node name longer than 20 characters', () => {
    const long = 'x'.repeat(21);
    expect(parseEdgeList(`A-B\nA->${long}:3`).errors).toEqual([
      { line: 2, message: `Name "${long}" is longer than 20 characters` },
    ]);
    expect(parseEdgeList(long).errors).toEqual([
      { line: 1, message: `Name "${long}" is longer than 20 characters` },
    ]);
    expect(parseEdgeList(`${'y'.repeat(20)}-B`).errors).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    const { draft: d, errors } = parseEdgeList('A-B\r\nB->C:5\r\nC=D\r\n');
    expect(errors).toEqual([{ line: 3, message: 'Cannot read "C=D"' }]);
    const ok = parseEdgeList('A-B\r\nB->C:5\r\n');
    expect(d).toBeNull();
    expect(ok.errors).toEqual([]);
    expect(ok.draft?.edges).toEqual([
      { from: 0, to: 1, directed: false },
      { from: 1, to: 2, directed: true, label: '5' },
    ]);
  });

  it('rejects more than 500 edges', () => {
    const items: string[] = [];
    for (let i = 0; i < 33; i++) for (let j = i + 1; j < 33; j++) items.push(`n${i}-n${j}`);
    expect(parseEdgeList(items.join(',')).errors).toEqual([
      { line: 0, message: 'The graph has 528 edges (at most 500)' },
    ]);
  });

  it('rejects an empty list and too many nodes', () => {
    expect(parseEdgeList(' \n , ').errors).toEqual([{ line: 0, message: 'The list is empty' }]);
    const many = Array.from({ length: 101 }, (_, i) => `n${i}`).join(',');
    expect(parseEdgeList(many).errors).toEqual([
      { line: 0, message: 'The graph has 101 nodes (at most 100)' },
    ]);
  });
});
