import {
  type GraphDraft,
  type GraphEdge,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  type NameStyle,
  nodeName,
} from './model';

export type FamilyKind =
  | 'complete'
  | 'cycle'
  | 'path'
  | 'star'
  | 'wheel'
  | 'bipartite'
  | 'grid'
  | 'tree'
  | 'random';

export interface FamilyParams {
  n: number;
  m: number;
  k: number;
  depth: number;
  p: number;
}

export interface FamilyOptions {
  directed: boolean;
  weighted: boolean;
  names: NameStyle;
}

/** The parameters each family uses, with their inclusive ranges. */
export const FAMILY_PARAMS: Record<
  FamilyKind,
  Partial<Record<keyof FamilyParams, readonly [number, number]>>
> = {
  complete: { n: [1, 20] },
  cycle: { n: [3, 60] },
  path: { n: [2, 60] },
  star: { n: [1, 60] },
  wheel: { n: [3, 60] },
  bipartite: { m: [1, 15], n: [1, 15] },
  grid: { m: [1, 10], n: [1, 10] },
  tree: { k: [1, 5], depth: [0, 6] },
  random: { n: [2, 50], p: [0, 1] },
};

/** A named graph family; `random` supplies weights and random edges (tests pass a fixed source). */
export function familyGraph(
  kind: FamilyKind,
  params: FamilyParams,
  opts: FamilyOptions,
  random: () => number = Math.random,
): GraphDraft | { error: string } {
  for (const [key, range] of Object.entries(FAMILY_PARAMS[kind]) as [
    keyof FamilyParams,
    readonly [number, number],
  ][]) {
    const v = params[key];
    const whole = key !== 'p';
    if (!Number.isFinite(v) || v < range[0] || v > range[1] || (whole && !Number.isInteger(v))) {
      return {
        error: `${key} must be ${whole ? 'a whole number' : 'a number'} from ${range[0]} to ${range[1]}`,
      };
    }
  }
  const { n, m, k, depth, p } = params;
  const pairs: [number, number][] = [];
  let count = 0;
  const hints: Pick<GraphDraft, 'layout' | 'center' | 'cols' | 'left'> = { layout: 'circle' };
  switch (kind) {
    case 'complete':
      count = n;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
      break;
    case 'cycle':
      count = n;
      for (let i = 0; i < n; i++) pairs.push([i, (i + 1) % n]);
      break;
    case 'path':
      count = n;
      hints.layout = 'layered';
      for (let i = 0; i + 1 < n; i++) pairs.push([i, i + 1]);
      break;
    case 'star':
      count = n + 1;
      hints.center = 0;
      for (let i = 1; i <= n; i++) pairs.push([0, i]);
      break;
    case 'wheel':
      count = n + 1;
      hints.center = 0;
      for (let i = 1; i <= n; i++) pairs.push([0, i]);
      for (let i = 1; i <= n; i++) pairs.push([i, i === n ? 1 : i + 1]);
      break;
    case 'bipartite':
      count = m + n;
      hints.layout = 'bipartite';
      hints.left = m;
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) pairs.push([i, m + j]);
      break;
    case 'grid':
      count = m * n;
      hints.layout = 'grid';
      hints.cols = n;
      for (let r = 0; r < m; r++)
        for (let c = 0; c < n; c++) {
          if (c + 1 < n) pairs.push([r * n + c, r * n + c + 1]);
          if (r + 1 < m) pairs.push([r * n + c, (r + 1) * n + c]);
        }
      break;
    case 'tree': {
      let level = 1;
      for (let d = 0; d <= depth; d++) {
        count += level;
        level *= k;
      }
      if (count > MAX_GRAPH_NODES) {
        return {
          error: `A ${k}-ary tree of depth ${depth} has ${count} nodes (at most ${MAX_GRAPH_NODES})`,
        };
      }
      hints.layout = 'layered';
      for (let i = 1; i < count; i++) pairs.push([Math.floor((i - 1) / k), i]);
      break;
    }
    case 'random':
      count = n;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) if (random() < p) pairs.push([i, j]);
      break;
  }
  if (pairs.length > MAX_GRAPH_EDGES) {
    return { error: `The graph has ${pairs.length} edges (at most ${MAX_GRAPH_EDGES})` };
  }
  const edges = pairs.map(([a, b]): GraphEdge => {
    const e: GraphEdge = { from: Math.min(a, b), to: Math.max(a, b), directed: opts.directed };
    if (opts.weighted) e.label = String(1 + Math.floor(random() * 9));
    return e;
  });
  const names = Array.from({ length: count }, (_, i) => nodeName(i, opts.names));
  return { names, edges, ...hints };
}
