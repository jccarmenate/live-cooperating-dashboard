import type { Point } from '../schema/types';
import type { GraphDraft, GraphEdge } from './model';

export const NODE_SIZE = 56;
export const NODE_GAP = 40;
const STEP = NODE_SIZE + NODE_GAP;
const ROW = STEP + 14;
/** Force layout: ideal edge length. */
const FORCE_K = 130;
/**
 * Force layout: stiffness of the linear pull toward the origin. It balances the repulsion of n
 * nodes at a radius of about k·√n, so even 100 isolated nodes settle within ~2400 px.
 */
const GRAVITY = 1;
/** Force layout: the first step budget is k·√n / FORCE_T_DIV, cooling by 1.5% per iteration. */
const FORCE_T_DIV = 10;
/** Overlap removal: passes before falling back to the uniform scale-up. */
const SEPARATE_PASSES = 200;

/** Radius that keeps `count` nodes on a ring at least STEP apart. */
const ringRadius = (count: number): number =>
  count <= 1 ? 0 : Math.max(120, STEP / (2 * Math.sin(Math.PI / count)));

function circle(n: number, center?: number): Point[] {
  const out: Point[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const hasCenter = center !== undefined && center >= 0 && center < n;
  const rim = Array.from({ length: n }, (_, i) => i).filter((i) => !hasCenter || i !== center);
  const r = Math.max(ringRadius(rim.length), hasCenter && rim.length > 0 ? 120 : 0);
  rim.forEach((node, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / rim.length;
    out[node] = { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  return out;
}

function neighbours(n: number, edges: readonly GraphEdge[]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.from]?.push(e.to);
    adj[e.to]?.push(e.from);
  }
  return adj;
}

/** Top-down levels by breadth-first distance from the first node of each component. */
function layered(d: GraphDraft): Point[] {
  const n = d.names.length;
  const adj = neighbours(n, d.edges);
  const level: number[] = new Array(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if ((level[s] as number) >= 0) continue;
    level[s] = 0;
    const queue = [s];
    for (let h = 0; h < queue.length; h++) {
      const u = queue[h] as number;
      for (const v of adj[u] ?? []) {
        if ((level[v] as number) < 0) {
          level[v] = (level[u] as number) + 1;
          queue.push(v);
        }
      }
    }
  }
  const rows: number[][] = [];
  level.forEach((l, i) => {
    rows[l] ??= [];
    (rows[l] as number[]).push(i);
  });
  const out: Point[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  rows.forEach((row, y) => {
    row.forEach((node, x) => {
      out[node] = { x: (x - (row.length - 1) / 2) * STEP, y: y * ROW };
    });
  });
  return out;
}

function grid(n: number, cols: number): Point[] {
  const c = Math.max(1, cols);
  return Array.from({ length: n }, (_, i) => ({ x: (i % c) * ROW, y: Math.floor(i / c) * ROW }));
}

function bipartite(n: number, left: number): Point[] {
  const right = n - left;
  return Array.from({ length: n }, (_, i) =>
    i < left
      ? { x: -130, y: (i - (left - 1) / 2) * STEP }
      : { x: 130, y: (i - left - (right - 1) / 2) * STEP },
  );
}

/** Scales a layout up (never down) until no two centres are closer than STEP. */
function spread(pts: Point[]): Point[] {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i] as Point;
      const b = pts[j] as Point;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
  if (!Number.isFinite(min) || min >= STEP) return pts;
  if (min < 1e-6) return circle(pts.length);
  const s = STEP / min;
  return pts.map((p) => ({ x: p.x * s, y: p.y * s }));
}

/** Pushes apart, a little at a time, only the pairs of centres closer than STEP. */
function separate(pts: Point[]): Point[] {
  const n = pts.length;
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = pts[i] as Point;
        const b = pts[j] as Point;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= STEP) continue;
        moved = true;
        // Coincident centres split along a fixed, pair-specific direction (no randomness).
        const angle = i * 2.399963 + j;
        const ux = dist < 1e-6 ? Math.cos(angle) : dx / dist;
        const uy = dist < 1e-6 ? Math.sin(angle) : dy / dist;
        const push = (STEP + 0.5 - dist) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    if (!moved) return pts;
  }
  // Still crowded after the cap: fall back to the uniform scale-up, which always clears STEP.
  return spread(pts);
}

/**
 * Deterministic Fruchterman–Reingold, seeded on a circle. A linear pull toward the origin keeps
 * isolated nodes and separate components from drifting away, and the step budget scales with
 * the natural size of the layout (k·√n) rather than a fixed number of pixels.
 */
function force(d: GraphDraft): Point[] {
  const n = d.names.length;
  const pts = circle(n);
  const k = FORCE_K;
  let t = (k * Math.sqrt(n)) / FORCE_T_DIV;
  const floor = t / 100;
  for (let it = 0; it < 300; it++) {
    const disp = pts.map((p) => ({ x: -GRAVITY * p.x, y: -GRAVITY * p.y }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = pts[i] as Point;
        const b = pts[j] as Point;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(0.01, Math.hypot(dx, dy));
        const push = (k * k) / dist;
        const di = disp[i] as Point;
        const dj = disp[j] as Point;
        di.x += (dx / dist) * push;
        di.y += (dy / dist) * push;
        dj.x -= (dx / dist) * push;
        dj.y -= (dy / dist) * push;
      }
    for (const e of d.edges) {
      const a = pts[e.from] as Point;
      const b = pts[e.to] as Point;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(0.01, Math.hypot(dx, dy));
      const pull = (dist * dist) / k;
      const da = disp[e.from] as Point;
      const db = disp[e.to] as Point;
      da.x -= (dx / dist) * pull;
      da.y -= (dy / dist) * pull;
      db.x += (dx / dist) * pull;
      db.y += (dy / dist) * pull;
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i] as Point;
      const v = disp[i] as Point;
      const len = Math.hypot(v.x, v.y);
      if (len > 0) {
        p.x += (v.x / len) * Math.min(len, t);
        p.y += (v.y / len) * Math.min(len, t);
      }
    }
    t = Math.max(floor, t * 0.985);
  }
  return separate(pts);
}

function centred(pts: Point[]): Point[] {
  if (pts.length === 0) return pts;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

/** Node centres for a draft, with the bounding box centred on (0, 0). */
export function layoutGraph(d: GraphDraft): Point[] {
  const n = d.names.length;
  switch (d.layout) {
    case 'circle':
      return centred(circle(n, d.center));
    case 'layered':
      return centred(layered(d));
    case 'grid':
      return centred(grid(n, d.cols ?? Math.ceil(Math.sqrt(n))));
    case 'bipartite':
      return centred(bipartite(n, d.left ?? Math.ceil(n / 2)));
    case 'force':
      return centred(force(d));
  }
}
