import { describe, expect, it } from 'vitest';
import {
  familyGraph,
  type GraphDraft,
  graphPlan,
  layoutGraph,
  NODE_GAP,
  NODE_SIZE,
  type Point,
  parseEdgeList,
} from '../src';

const opts = { directed: false, weighted: false, names: 'letters' as const };
const base = { n: 5, m: 3, k: 2, depth: 2, p: 0.3 };
const fam = (kind: Parameters<typeof familyGraph>[0], p: Partial<typeof base> = {}): GraphDraft => {
  // A fixed source of 0.5 with p = 0.3 gives a random graph with no edges (well within the caps).
  const r = familyGraph(kind, { ...base, ...p }, opts, () => 0.5);
  if ('error' in r) throw new Error(r.error);
  return r;
};
const minGap = (pts: Point[]) => {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i] as Point;
      const b = pts[j] as Point;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
  return min;
};
const centre = (pts: Point[]) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

describe('graph layout', () => {
  const drafts: [string, GraphDraft][] = [
    ['complete 20', fam('complete', { n: 20 })],
    ['star 1', fam('star', { n: 1 })],
    ['star 30', fam('star', { n: 30 })],
    ['wheel 12', fam('wheel', { n: 12 })],
    ['path 10', fam('path', { n: 10 })],
    ['tree 3/3', fam('tree', { k: 3, depth: 3 })],
    ['grid 10x10', fam('grid', { m: 10, n: 10 })],
    ['bipartite 15/15', fam('bipartite', { m: 15, n: 15 })],
    ['random 50', fam('random', { n: 50 })],
    [
      'edge list',
      parseEdgeList(
        `${Array.from({ length: 30 }, (_, i) => `v${i}-v${(i + 1) % 30}`).join(',')},v0-v15,v5-v20`,
      ).draft as GraphDraft,
    ],
  ];

  for (const [name, d] of drafts) {
    it(`${name}: nodes keep at least ${NODE_GAP}px between them and the layout is centred`, () => {
      const pts = layoutGraph(d);
      expect(pts).toHaveLength(d.names.length);
      if (pts.length > 1) expect(minGap(pts)).toBeGreaterThanOrEqual(NODE_SIZE + NODE_GAP - 1e-6);
      const c = centre(pts);
      expect(Math.abs(c.x)).toBeLessThan(1e-6);
      expect(Math.abs(c.y)).toBeLessThan(1e-6);
    });
  }

  it('is deterministic', () => {
    const d = drafts.at(-1)?.[1] as GraphDraft;
    expect(layoutGraph(d)).toEqual(layoutGraph(d));
  });

  it('puts a star centre in the middle and layers a tree top-down', () => {
    const star = layoutGraph(fam('star', { n: 6 }));
    expect(star[0]).toEqual({ x: expect.closeTo(0, 6), y: expect.closeTo(0, 6) });
    const tree = layoutGraph(fam('tree', { k: 2, depth: 1 }));
    expect((tree[1] as Point).y).toBeGreaterThan((tree[0] as Point).y);
    expect((tree[1] as Point).y).toBe((tree[2] as Point).y);
  });
});

describe('graphPlan', () => {
  it('creates ellipse nodes and connector edges around a point', () => {
    const d = parseEdgeList('A->B:4, B-C').draft as GraphDraft;
    let n = 0;
    const plan = graphPlan(
      d,
      { x: 1000, y: 500 },
      {
        newId: () => `id${++n}`,
        userId: 'u1',
        userName: 'Brisk Otter',
        now: () => 7,
      },
    );
    expect(plan.shapes.map((s) => [s.type, s.text, s.w, s.h])).toEqual([
      ['ellipse', 'A', 56, 56],
      ['ellipse', 'B', 56, 56],
      ['ellipse', 'C', 56, 56],
    ]);
    expect(plan.connectors).toEqual([
      {
        id: 'id4',
        from: { shapeId: 'id1', anchor: 'auto' },
        to: { shapeId: 'id2', anchor: 'auto' },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
        label: '4',
      },
      {
        id: 'id5',
        from: { shapeId: 'id2', anchor: 'auto' },
        to: { shapeId: 'id3', anchor: 'auto' },
        routing: 'straight',
        head: 'none',
        createdBy: 'u1',
      },
    ]);
    const xs = plan.shapes.map((s) => s.x + s.w / 2);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(1000, 6);
  });
});
