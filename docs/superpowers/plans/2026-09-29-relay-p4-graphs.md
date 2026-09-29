# Relay F4·P4 Graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users generate graph-theory graphs (named families or an edge list) on a board, label connectors, and run visual graph algorithms. The final task refreshes the README.

**Architecture:**
- A graph is not a new kind of object. Nodes are ellipse shapes and edges are connectors, so collaboration, undo and clipboard come for free.
- `@relay/core` gains:
  - connector labels (a new `SetConnectorLabel` command);
  - a pure `graph/` module holding the families, the edge-list parser, layouts, a creation plan (`PasteItems` input) and the algorithms.
- The web app adds:
  - a Graph toolbar menu;
  - a "New graph" dialog;
  - an inline connector-label editor;
  - an Algorithms panel, whose result is a local-only overlay drawn over the canvas.

**Tech Stack:** TypeScript, Yjs 13.6, React 19 / Next.js 16, Zustand 5, Tailwind 4, lucide-react, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`. The relevant parts are:
- the section "### Graphs (F4·P4)";
- the `label?` field under `connectors` in the Yjs Document;
- the last paragraph of "### Connectors" (labels);
- the Input amendment (`G`, Shapes flyout).

## Global Constraints

- **Cost and scope:** $0. No new runtime dependency.
- **README:** edit it only in Task 9.
- **Connector labels:**
  - a connector `label` is at most 40 characters (`MAX_CONNECTOR_LABEL = 40`);
  - `SetConnectorLabel { id, label }` uses the `LOCAL` origin, and an empty label removes it;
  - pasted and duplicated connectors keep their label.
- **Graph limits:** 100 nodes and 500 edges. A graph over the paste budget (192 KiB) is refused with the paste toast "Too much to paste at once".
- **Family parameter ranges:**
  - complete n 1–20
  - cycle n 3–60
  - path n 2–60
  - star n 1–60
  - wheel n 3–60
  - bipartite m, n 1–15
  - grid m, n 1–10
  - tree k 1–5, depth 0–6, at most 100 nodes
  - random n 2–50, p 0–1
- **Family options:**
  - *directed*: a tree points parent → child; other families point from the lower-numbered node to the higher one;
  - *weighted*: a random integer 1–9 as the label;
  - node names as letters (A…Z, AA…) or numbers (1…n).
- **Edge list syntax:**
  - `A-B` is undirected and `A->B` is directed;
  - `:label` sets a label of at most 40 characters;
  - a lone name is an isolated node;
  - a name is 1–20 characters from `[A-Za-z0-9_]`;
  - `A-A` is an error;
  - errors carry their line numbers, and nothing is created while any error remains.
- **Layouts:**
  - circle: complete, cycle, wheel (hub in the middle), star (centre in the middle), random;
  - layered: path, tree;
  - grid: grid;
  - two columns: bipartite;
  - deterministic force-directed: edge list.
  Nodes are 56×56 ellipses with at least 40 px between them. The graph is centred on the viewport and created in one `PasteItems` step, and the new graph is selected.
- **Algorithm graph:**
  - The nodes are the selected shapes, or every shape on the page when nothing is selected.
  - The edges are the page connectors whose two ends are attached to nodes. An edge is directed when it has an arrowhead.
  - An edge's weight is its label when that parses as a finite number, and 1 otherwise.
  - A node's name is its text, or `#n` when it has none.
  - Ties are broken by top-to-bottom, left-to-right order.
- **Algorithms:**
  - BFS and DFS return the visit order.
  - Dijkstra returns the path and its cost. A negative weight is an error, and "no path" is reported.
  - The MST is computed with Kruskal, treating every edge as undirected (a forest when disconnected).
  - Connected components are weak components.
- **Algorithm results:** results are local-only. Escape or "Clear" removes them, and deleted items drop out of the overlay.
- **Roles:** viewers can use Algorithms, but get no "New graph…" and cannot edit labels.
- **Windows file names:** never create two files whose names differ only by case.
- **Commits:** they end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

**Core (`packages/core/src`)**
- `schema/types.ts`: `Connector.label?`.
- `schema/defaults.ts`: `MAX_CONNECTOR_LABEL`.
- `schema/snapshot.ts`: read `label`.
- `commands/types.ts` and `commands/apply.ts`: `SetConnectorLabel`; `Connect` writes `label`.
- `clipboard/clip.ts`: `pastePlan` keeps `label`.
- `geometry/connectors.ts`: `pathMidpoint`.
- `graph/model.ts` (new): graph limits, the `GraphDraft` type, `nodeName`.
- `graph/families.ts` (new): `FAMILY_PARAMS`, `familyGraph`.
- `graph/edgeList.ts` (new): `parseEdgeList`.
- `graph/layout.ts` (new): `layoutGraph`, `NODE_SIZE`, `NODE_GAP`.
- `graph/plan.ts` (new): `graphPlan`.
- `graph/algorithms.ts` (new): `readGraph`, `edgeWeight`, `bfs`, `dfs`, `shortestPath`, `minimumSpanningTree`, `connectedComponents`, `AlgorithmResult`.
- `index.ts`: exports.

**Web (`apps/web/src`)**
- `board/controller.ts`: label editing, graph menu/dialog/panel state, `createGraph`, `runAlgorithm`, `clearGraphResult`.
- `render/ConnectorView.tsx`: draw the label.
- `render/ConnectorLabelEditor.tsx` (new).
- `render/Canvas.tsx`: double-click on a connector edits its label.
- `render/GraphOverlay.tsx` (new).
- `ui/Toolbar.tsx`: Graph button and menu.
- `ui/NewGraphDialog.tsx` (new).
- `ui/AlgorithmsPanel.tsx` (new).
- `ui/shortcuts.ts`, `ui/useShortcuts.ts`, `ui/shortcutList.ts`: `G`.
- `board/Board.tsx`: mounts.

**Tests**
- Core, in `packages/core/test/`:
  - `connector-label.test.ts`
  - `graph-families.test.ts`
  - `graph-layout.test.ts`
  - `graph-algorithms.test.ts`
- Web, in `apps/web/test/`:
  - `graph-controller.test.ts`
  - `shortcuts.test.ts` (extend)
  - `shortcutList.test.ts` (extend)
- E2E: `e2e/graphs.spec.ts`.

---

### Task 1: Core — connector labels

**Files:**
- Modify: `packages/core/src/schema/types.ts`
- Modify: `packages/core/src/schema/defaults.ts`
- Modify: `packages/core/src/schema/snapshot.ts`
- Modify: `packages/core/src/commands/types.ts`
- Modify: `packages/core/src/commands/apply.ts`
- Modify: `packages/core/src/clipboard/clip.ts`
- Modify: `packages/core/src/geometry/connectors.ts`
- Test: `packages/core/test/connector-label.test.ts` (new)

**Interfaces:**
- Produces:
  - `Connector.label?: string`
  - `MAX_CONNECTOR_LABEL = 40`
  - `Command` gains `{ type: 'SetConnectorLabel'; id: string; label: string }`
  - `NewConnector` (which is `Omit<Connector, 'z'>`) now carries `label?` automatically
  - `pathMidpoint(points: readonly Point[]): Point`

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/connector-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  copyPayload,
  DEFAULT_STYLE,
  getRoots,
  MAX_CONNECTOR_LABEL,
  type NewShape,
  parseClip,
  pastePlan,
  pathMidpoint,
  readConnector,
  serializeClip,
  type Shape,
  type Connector,
} from '../src';

const node = (id: string, x: number): NewShape => ({
  id,
  type: 'ellipse',
  x,
  y: 0,
  w: 56,
  h: 56,
  style: DEFAULT_STYLE.ellipse,
  text: id,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
});

function doc2() {
  const doc = new Y.Doc();
  applyCommand(doc, { type: 'CreateShape', shape: node('a', 0) });
  applyCommand(doc, { type: 'CreateShape', shape: node('b', 200) });
  applyCommand(doc, {
    type: 'Connect',
    connector: {
      id: 'k',
      from: { shapeId: 'a', anchor: 'auto' },
      to: { shapeId: 'b', anchor: 'auto' },
      routing: 'straight',
      head: 'none',
      createdBy: 'u1',
      label: '7',
    },
  });
  return doc;
}
const read = (doc: Y.Doc) => {
  const m = getRoots(doc).connectors.get('k');
  return m ? readConnector('k', m) : null;
};

describe('connector labels', () => {
  it('Connect writes the label and readConnector reads it', () => {
    expect(read(doc2())?.label).toBe('7');
  });

  it('SetConnectorLabel sets (trimmed, capped) and clears', () => {
    const doc = doc2();
    applyCommand(doc, { type: 'SetConnectorLabel', id: 'k', label: `  ${'x'.repeat(60)}  ` });
    expect(read(doc)?.label).toBe('x'.repeat(MAX_CONNECTOR_LABEL));
    applyCommand(doc, { type: 'SetConnectorLabel', id: 'k', label: '   ' });
    expect(read(doc)?.label).toBeUndefined();
    expect(getRoots(doc).connectors.get('k')?.has('label')).toBe(false);
    applyCommand(doc, { type: 'SetConnectorLabel', id: 'missing', label: 'x' });
  });

  it('reads a non-string or over-long stored label defensively', () => {
    const doc = doc2();
    getRoots(doc).connectors.get('k')?.set('label', 5);
    expect(read(doc)?.label).toBeUndefined();
    getRoots(doc).connectors.get('k')?.set('label', 'y'.repeat(100));
    expect(read(doc)?.label).toHaveLength(MAX_CONNECTOR_LABEL);
  });

  it('copy and paste keep the label', () => {
    const shapes: Record<string, Shape> = {
      a: { ...node('a', 0), z: 'a0' } as Shape,
      b: { ...node('b', 200), z: 'a1' } as Shape,
    };
    const connectors: Record<string, Connector> = {
      k: {
        id: 'k',
        from: { shapeId: 'a', anchor: 'auto' },
        to: { shapeId: 'b', anchor: 'auto' },
        routing: 'straight',
        head: 'none',
        z: 'a0',
        createdBy: 'u1',
        label: '3',
      },
    };
    const copied = copyPayload(['a', 'b'], shapes, connectors);
    if (!copied) throw new Error('nothing copied');
    const payload = parseClip(serializeClip(copied));
    if (!payload) throw new Error('clip did not parse');
    let n = 0;
    const plan = pastePlan(payload, {
      shapes: {},
      newId: () => `n${++n}`,
      userId: 'u1',
      userName: 'A',
      now: () => 0,
    }, { offset: 24 });
    expect(plan.connectors[0]?.label).toBe('3');
  });

  it('pathMidpoint walks half the polyline length', () => {
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }])).toEqual({ x: 0, y: 10 });
    expect(pathMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- connector-label`
Expected: FAIL (`MAX_CONNECTOR_LABEL` / `pathMidpoint` are missing).

- [ ] **Step 3: Implement.**

`schema/defaults.ts`: add

```ts
/** A connector label (also an edge weight when it is a number) is at most this long. */
export const MAX_CONNECTOR_LABEL = 40;
```

`schema/types.ts`: in `interface Connector`, after `head`, add

```ts
  /** Text drawn at the middle of the path; a number doubles as the edge weight. */
  label?: string;
```

`schema/snapshot.ts`, in `readConnector`: import `MAX_CONNECTOR_LABEL` from `./defaults`, then compute and spread the label:

```ts
  const label = str(m.get('label'))?.slice(0, MAX_CONNECTOR_LABEL);
  return {
    // …existing fields…
    ...(label ? { label } : {}),
    ...(pageId !== MAIN_PAGE ? { pageId } : {}),
  };
```

`commands/types.ts`: add `| { type: 'SetConnectorLabel'; id: string; label: string }` to `Command`.

`commands/apply.ts`:
- import `MAX_CONNECTOR_LABEL` from `'../schema/defaults'`;
- in `case 'Connect'`, after `m.set('head', …)`, add `if (fields.label) m.set('label', fields.label.slice(0, MAX_CONNECTOR_LABEL));`;
- add a new case:

```ts
    case 'SetConnectorLabel': {
      const m = connectors.get(cmd.id);
      if (!m) return;
      const label = cmd.label.trim().slice(0, MAX_CONNECTOR_LABEL);
      if (label) m.set('label', label);
      else if (m.has('label')) m.delete('label');
      return;
    }
```

`clipboard/clip.ts`, in `pastePlan`'s `connectors.push({ … })`: add `...(c.label ? { label: c.label } : {}),`.

`geometry/connectors.ts`: append

```ts
/** The point halfway along a polyline, by length (where a connector's label sits). */
export function pathMidpoint(points: readonly Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let rest = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0 && rest <= d) {
      const t = rest / d;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= d;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}
```

Note the second midpoint test case: the total length is 20, so half is 10. That ends exactly at the corner `{0, 10}` of the first segment (`rest <= d` with `rest === d`), which gives `{ x: 0, y: 10 }`.

- [ ] **Step 4: Run the core tests, typecheck and lint**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): connector labels — read, SetConnectorLabel, kept on paste; pathMidpoint"
```

---

### Task 2: Core — graph families and edge lists

**Files:**
- Create: `packages/core/src/graph/model.ts`
- Create: `packages/core/src/graph/families.ts`
- Create: `packages/core/src/graph/edgeList.ts`
- Modify: `packages/core/src/index.ts` (export the three)
- Test: `packages/core/test/graph-families.test.ts` (new)

**Interfaces:**
- Consumes: `colLetters` (`sheet/address.ts`), `MAX_CONNECTOR_LABEL` (Task 1).
- Produces:

```ts
// model.ts
export const MAX_GRAPH_NODES = 100; export const MAX_GRAPH_EDGES = 500; export const MAX_NODE_NAME = 20;
export interface GraphEdge { from: number; to: number; directed: boolean; label?: string }  // node indices
export type LayoutKind = 'circle' | 'layered' | 'grid' | 'bipartite' | 'force';
export interface GraphDraft { names: string[]; edges: GraphEdge[]; layout: LayoutKind; center?: number; cols?: number; left?: number }
export type NameStyle = 'letters' | 'numbers';
export function nodeName(index: number, style: NameStyle): string;
// families.ts
export type FamilyKind = 'complete' | 'cycle' | 'path' | 'star' | 'wheel' | 'bipartite' | 'grid' | 'tree' | 'random';
export interface FamilyParams { n: number; m: number; k: number; depth: number; p: number }
export interface FamilyOptions { directed: boolean; weighted: boolean; names: NameStyle }
export const FAMILY_PARAMS: Record<FamilyKind, Partial<Record<keyof FamilyParams, readonly [number, number]>>>;
export function familyGraph(kind: FamilyKind, params: FamilyParams, opts: FamilyOptions, random?: () => number): GraphDraft | { error: string };
// edgeList.ts
export interface EdgeListError { line: number; message: string }
export function parseEdgeList(text: string): { draft: GraphDraft | null; errors: EdgeListError[] };
```

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/graph-families.test.ts`:

```ts
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

  it('points directed edges from lower to higher (trees parent → child)', () => {
    const cycle = draft(familyGraph('cycle', { ...P, n: 4 }, { ...plain, directed: true }));
    expect(cycle.edges.every((e) => e.directed && e.from < e.to)).toBe(true);
    const tree = draft(familyGraph('tree', { ...P, k: 3, depth: 1 }, { ...plain, directed: true }));
    expect(tree.edges.map((e) => [e.from, e.to])).toEqual([[0, 1], [0, 2], [0, 3]]);
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
    expect(familyGraph('complete', { ...P, n: 21 }, plain)).toEqual({ error: 'n must be a whole number from 1 to 20' });
    expect(familyGraph('cycle', { ...P, n: 2.5 }, plain)).toHaveProperty('error');
    expect(familyGraph('random', { ...P, p: 1.5 }, plain)).toEqual({ error: 'p must be a number from 0 to 1' });
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

  it('rejects an empty list and too many nodes', () => {
    expect(parseEdgeList(' \n , ').errors).toEqual([{ line: 0, message: 'The list is empty' }]);
    const many = Array.from({ length: 101 }, (_, i) => `n${i}`).join(',');
    expect(parseEdgeList(many).errors).toEqual([{ line: 0, message: 'The graph has 101 nodes (at most 100)' }]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- graph-families`
Expected: FAIL.

- [ ] **Step 3: Write `graph/model.ts`:**

```ts
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
```

- [ ] **Step 4: Write `graph/families.ts`:**

```ts
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
      return { error: `${key} must be ${whole ? 'a whole number' : 'a number'} from ${range[0]} to ${range[1]}` };
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
        return { error: `A ${k}-ary tree of depth ${depth} has ${count} nodes (at most ${MAX_GRAPH_NODES})` };
      }
      hints.layout = 'layered';
      for (let i = 1; i < count; i++) pairs.push([Math.floor((i - 1) / k), i]);
      break;
    }
    case 'random':
      count = n;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (random() < p) pairs.push([i, j]);
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
```

- [ ] **Step 5: Write `graph/edgeList.ts`:**

```ts
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
        errors.push({ line, message: `The label on ${a}${arrow}${b} is longer than ${MAX_CONNECTOR_LABEL} characters` });
        continue;
      }
      const edge: GraphEdge = { from: node(a), to: node(b), directed: arrow === '->' };
      if (text) edge.label = text;
      edges.push(edge);
    }
  });
  if (names.length === 0 && errors.length === 0) errors.push({ line: 0, message: 'The list is empty' });
  if (names.length > MAX_GRAPH_NODES) {
    errors.push({ line: 0, message: `The graph has ${names.length} nodes (at most ${MAX_GRAPH_NODES})` });
  }
  if (edges.length > MAX_GRAPH_EDGES) {
    errors.push({ line: 0, message: `The graph has ${edges.length} edges (at most ${MAX_GRAPH_EDGES})` });
  }
  return errors.length > 0 ? { draft: null, errors } : { draft: { names, edges, layout: 'force' }, errors };
}
```

Export all three modules from `index.ts`.

- [ ] **Step 6: Run the tests, typecheck and lint, then commit**

Run: `npm test -w @relay/core -- graph-families && npm run typecheck && npm run lint`
Expected: PASS and clean.

The oversized-random test depends on `random()` being below `p` = 1 for all pairs, which holds for 0.5 < 1. That makes 1225 edges, over 500, so the result is an error.

```bash
git add packages/core
git commit -m "feat(core): graph families and edge-list parsing"
```

---

### Task 3: Core — graph layout and creation plan

**Files:**
- Create: `packages/core/src/graph/layout.ts`
- Create: `packages/core/src/graph/plan.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/graph-layout.test.ts` (new)

**Interfaces:**
- Consumes: `GraphDraft` (Task 2), `NewShape`/`NewConnector`, `DEFAULT_STYLE`, `Point`.
- Produces:
  - `NODE_SIZE = 56`, `NODE_GAP = 40`;
  - `layoutGraph(d: GraphDraft): Point[]`, which returns node centres, with the bounding box centred on (0, 0);
  - `graphPlan(d: GraphDraft, at: Point, ctx: { newId(): string; userId: string; userName: string; now(): number }): { shapes: NewShape[]; connectors: NewConnector[] }`.

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/graph-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  familyGraph,
  type GraphDraft,
  graphPlan,
  layoutGraph,
  NODE_GAP,
  NODE_SIZE,
  parseEdgeList,
  type Point,
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
        Array.from({ length: 30 }, (_, i) => `v${i}-v${(i + 1) % 30}`).join(',') + ',v0-v15,v5-v20',
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
    const plan = graphPlan(d, { x: 1000, y: 500 }, {
      newId: () => `id${++n}`,
      userId: 'u1',
      userName: 'Brisk Otter',
      now: () => 7,
    });
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- graph-layout`
Expected: FAIL.

- [ ] **Step 3: Write `graph/layout.ts`:**

```ts
import type { Point } from '../schema/types';
import type { GraphDraft, GraphEdge } from './model';

export const NODE_SIZE = 56;
export const NODE_GAP = 40;
const STEP = NODE_SIZE + NODE_GAP;
const ROW = STEP + 14;

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

/** Deterministic Fruchterman–Reingold, seeded on a circle. */
function force(d: GraphDraft): Point[] {
  const n = d.names.length;
  const pts = circle(n);
  const k = 130;
  let t = 60;
  for (let it = 0; it < 300; it++) {
    const disp = pts.map(() => ({ x: 0, y: 0 }));
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
    t = Math.max(1, t * 0.985);
  }
  return spread(pts);
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
```

**Star-centre test.** A rim of 6 nodes starting at −90° is symmetric on both axes, so `centred` leaves the hub at (0, 0). With an odd rim the hub would shift, which is why the test uses n=6.

- [ ] **Step 4: Write `graph/plan.ts`:**

```ts
import type { NewConnector, NewShape } from '../commands/types';
import { DEFAULT_STYLE } from '../schema/defaults';
import type { Point } from '../schema/types';
import { NODE_SIZE, layoutGraph } from './layout';
import type { GraphDraft } from './model';

/** Ellipse nodes and connector edges for a draft, laid out around `at` (ready for PasteItems). */
export function graphPlan(
  d: GraphDraft,
  at: Point,
  ctx: { newId(): string; userId: string; userName: string; now(): number },
): { shapes: NewShape[]; connectors: NewConnector[] } {
  const pts = layoutGraph(d);
  const ids = d.names.map(() => ctx.newId());
  const shapes: NewShape[] = d.names.map((name, i) => {
    const p = pts[i] as Point;
    return {
      id: ids[i] as string,
      type: 'ellipse',
      x: at.x + p.x - NODE_SIZE / 2,
      y: at.y + p.y - NODE_SIZE / 2,
      w: NODE_SIZE,
      h: NODE_SIZE,
      style: DEFAULT_STYLE.ellipse,
      text: name,
      createdBy: ctx.userId,
      authorName: ctx.userName,
      createdAt: ctx.now(),
    };
  });
  const connectors: NewConnector[] = d.edges.map((e) => ({
    id: ctx.newId(),
    from: { shapeId: ids[e.from] as string, anchor: 'auto' },
    to: { shapeId: ids[e.to] as string, anchor: 'auto' },
    routing: 'straight',
    head: e.directed ? 'arrow' : 'none',
    createdBy: ctx.userId,
    ...(e.label ? { label: e.label } : {}),
  }));
  return { shapes, connectors };
}
```

Export both files from `index.ts`.

- [ ] **Step 5: Run the tests, typecheck and lint, then commit**

Run: `npm test -w @relay/core -- graph-layout && npm run typecheck && npm run lint`
Expected: PASS.

If the force layout's minimum gap test fails for the edge-list case, `spread` is responsible for it. Verify that `spread` runs after the iterations, and do not weaken the assertion.

```bash
git add packages/core
git commit -m "feat(core): graph layouts (circle, layered, grid, bipartite, force) and creation plan"
```

---

### Task 4: Core — graph algorithms

**Files:**
- Create: `packages/core/src/graph/algorithms.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/graph-algorithms.test.ts` (new)

**Interfaces:**
- Consumes: `Shape`, `Connector`, `isAttached`.
- Produces:

```ts
export interface GraphNode { id: string; name: string }
export interface GraphLink { id: string; from: string; to: string; directed: boolean; weight: number }
export interface GraphView { nodes: GraphNode[]; edges: GraphLink[] }
export type AlgorithmKind = 'bfs' | 'dfs' | 'path' | 'mst' | 'components';
export type AlgorithmResult =
  | { kind: 'traversal'; order: string[]; edges: string[] }
  | { kind: 'path'; nodes: string[]; edges: string[]; cost: number }
  | { kind: 'mst'; edges: string[]; total: number }
  | { kind: 'components'; groups: string[][] }
  | { kind: 'error'; message: string };
export function edgeWeight(label: string | undefined): number;
export function readGraph(selection: readonly string[], shapes: Readonly<Record<string, Shape>>, connectors: Readonly<Record<string, Connector>>): GraphView;
export function bfs(g: GraphView, start: string): AlgorithmResult;
export function dfs(g: GraphView, start: string): AlgorithmResult;
export function shortestPath(g: GraphView, start: string, end: string): AlgorithmResult;
export function minimumSpanningTree(g: GraphView): AlgorithmResult;
export function connectedComponents(g: GraphView): AlgorithmResult;
export function runAlgorithm(g: GraphView, kind: AlgorithmKind, start?: string, end?: string): AlgorithmResult;
```

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/graph-algorithms.test.ts`:

```ts
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
const link = (id: string, from: string, to: string, label?: string, directed = false): Connector => ({
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
    expect(bfs(g, 'a')).toEqual({ kind: 'traversal', order: ['a', 'b', 'c', 'd'], edges: ['ab', 'ac', 'bd'] });
    expect(dfs(g, 'a')).toEqual({ kind: 'traversal', order: ['a', 'b', 'd', 'c'], edges: ['ab', 'bd', 'cd'] });
    expect(bfs(g, 'missing')).toEqual({ kind: 'error', message: 'Pick a start node' });
  });

  it('Dijkstra finds the cheapest path and its cost', () => {
    // A→C directly costs 4 and A→B→D→C also costs 4: strict relaxation keeps the first found.
    expect(shortestPath(g, 'a', 'c')).toEqual({ kind: 'path', nodes: ['a', 'c'], edges: ['ac'], cost: 4 });
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
    expect(shortestPath(directed, 'b', 'a')).toEqual({ kind: 'error', message: 'No path from B to A' });
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
    expect(connectedComponents(g)).toEqual({ kind: 'components', groups: [['a', 'b', 'c', 'd'], ['e']] });
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
```

Here is how the expected values are derived, so the implementer can check them:
- **BFS from A:** A's neighbours, in node order, are B (via `ab`) and C (via `ac`). B's neighbours are A and D (via `bd`). So the visit order is A, B, C, D, with tree edges `ab`, `ac`, `bd`.
- **DFS from A:** A → B → D → C, taking `cd` because C is still unvisited at D.
- **Dijkstra A→C:** the direct edge `ac` (cost 4) ties with A-B-D-C (1 + 2 + 1 = 4). With strict `<` relaxation, `prev` keeps `ac`.
- **Dijkstra A→D:** A-B-D costs 3.
- **MST:** sorted by weight, the edges are `ab`(1), `cd`(1), `bd`(2), `ac`(4). The tie between `ab` and `cd` is broken by the lower endpoint's rank. Kruskal takes `ab`, `cd` and `bd`, for a total of 4.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- graph-algorithms`
Expected: FAIL.

- [ ] **Step 3: Write `graph/algorithms.ts`:**

```ts
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
    if (!e.directed || undirected) adj.get(e.to)?.push({ to: e.from, edge: e.id, weight: e.weight });
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
const has = (g: GraphView, id: string | undefined) => id !== undefined && g.nodes.some((n) => n.id === id);

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
```

Connected components use the rank order of the first node seen per group, because `g.nodes` is iterated in order. For `g`, the groups are `[['a','b','c','d'], ['e']]`.

- [ ] **Step 4: Run the tests, typecheck and lint, then commit**

Run: `npm test -w @relay/core -- graph-algorithms && npm test -w @relay/core && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add packages/core
git commit -m "feat(core): graph algorithms — BFS, DFS, Dijkstra, Kruskal, components over board connectors"
```

---

### Task 5: Web — connector labels on the board

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Modify: `apps/web/src/render/ConnectorView.tsx`
- Create: `apps/web/src/render/ConnectorLabelEditor.tsx`
- Modify: `apps/web/src/render/Canvas.tsx` (`onDoubleClick`)
- Modify: `apps/web/src/board/Board.tsx` (mount the editor)
- Test: `apps/web/test/graph-controller.test.ts` (new; Tasks 6–7 extend it)

**Interfaces:**
- Consumes: `SetConnectorLabel`, `pathMidpoint`, `MAX_CONNECTOR_LABEL` (Task 1).
- Produces:
  - `BoardUiState.editingConnector: string | null`
  - `controller.editConnectorLabel(id: string | null): void`
  - `controller.setConnectorLabel(id: string, label: string): void`, which is one undo step and closes the editor
  - test ids `connector-label` and `connector-label-input`

- [ ] **Step 1: Write the failing test** — create `apps/web/test/graph-controller.test.ts`:

```ts
import { applyCommand, DEFAULT_STYLE, getRoots, LOCAL_ORIGIN, type NewShape, readConnector } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

export function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  let n = 0;
  const notify = vi.fn();
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
    newId: () => `id${++n}`,
    now: () => 1000,
    notify,
  });
  return { doc, docs, controller, notify };
}

const node = (id: string, x: number, y: number, text = id): NewShape => ({
  id,
  type: 'ellipse',
  x,
  y,
  w: 56,
  h: 56,
  style: DEFAULT_STYLE.ellipse,
  text,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
});

export function twoNodes(doc: Y.Doc) {
  applyCommand(doc, { type: 'CreateShape', shape: node('a', 0, 0, 'A') }, LOCAL_ORIGIN);
  applyCommand(doc, { type: 'CreateShape', shape: node('b', 300, 0, 'B') }, LOCAL_ORIGIN);
  applyCommand(
    doc,
    {
      type: 'Connect',
      connector: {
        id: 'k',
        from: { shapeId: 'a', anchor: 'auto' },
        to: { shapeId: 'b', anchor: 'auto' },
        routing: 'straight',
        head: 'none',
        createdBy: 'u1',
      },
    },
    LOCAL_ORIGIN,
  );
}

const label = (doc: Y.Doc) => {
  const m = getRoots(doc).connectors.get('k');
  return m ? readConnector('k', m)?.label : undefined;
};

describe('connector label editing', () => {
  it('opens, commits as one undo step, and closes', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    expect(controller.ui.getState().editingConnector).toBe('k');
    controller.setConnectorLabel('k', ' 12 ');
    expect(label(doc)).toBe('12');
    expect(controller.ui.getState().editingConnector).toBeNull();
    controller.undo();
    expect(label(doc)).toBeUndefined();
  });

  it('closes the editor when the connector is deleted or the page changes', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    applyCommand(doc, { type: 'DeleteShapes', ids: ['k'] }, 'remote');
    expect(controller.ui.getState().editingConnector).toBeNull();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    controller.setPage(controller.createPage('board'));
    expect(controller.ui.getState().editingConnector).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- graph-controller`
Expected: FAIL (`editConnectorLabel` is missing).

- [ ] **Step 3: Controller.** In `apps/web/src/board/controller.ts`:
- Add `/** Connector whose label is being edited. */ editingConnector: string | null;` to `BoardUiState`, and initialise it to `null`.
- Add to `BoardController`:

```ts
  /** Opens (id) or closes (null) the inline label editor of a connector. */
  editConnectorLabel(id: string | null): void;
  /** Sets or clears (empty) a connector's label as one undo step, and closes the editor. */
  setConnectorLabel(id: string, label: string): void;
```

- Implement both:

```ts
    editConnectorLabel(id) {
      ui.setState({ editingConnector: id });
    },
    setConnectorLabel(id, label) {
      ui.setState({ editingConnector: null });
      commitStep({ type: 'SetConnectorLabel', id, label });
    },
```

- In the `docStore.subscribe` callback:
  - add `editingConnector: null` to the page-change reset;
  - after the editor-close checks, add:

```ts
    const { editingConnector } = ui.getState();
    if (editingConnector && !doc.connectors[editingConnector]) ui.setState({ editingConnector: null });
```

- [ ] **Step 4: Draw the label.** In `ConnectorView.tsx`:
- import `pathMidpoint` from `@relay/core`;
- read `const editing = useStore(session.controller.ui, (s) => s.editingConnector === id);`;
- add this after the invisible hit polyline:

```tsx
      {connector.label && !editing && (() => {
        const mid = pathMidpoint(path);
        const w = connector.label.length * 6.6 + 12;
        return (
          <g data-testid="connector-label" pointerEvents="none">
            <rect x={mid.x - w / 2} y={mid.y - 10} width={w} height={20} fill={PALETTE.white} stroke={color} strokeWidth={1.5} />
            <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={11} className="font-mono" fill={PALETTE.ink}>
              {connector.label}
            </text>
          </g>
        );
      })()}
```

If Biome rejects the IIFE, extract a small `ConnectorLabel({ path, label, color })` component in the same file.

- [ ] **Step 5: The editor.** Create `apps/web/src/render/ConnectorLabelEditor.tsx`:

```tsx
import { connectorPath, isAttached, MAX_CONNECTOR_LABEL, pathMidpoint, worldToScreen } from '@relay/core';
import { useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/** Inline input over the middle of a connector while its label is edited. */
export function ConnectorLabelEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const id = useStore(controller.ui, (s) => s.editingConnector);
  const connector = useStore(session.doc, (d) => (id ? d.connectors[id] : undefined));
  const shapes = useStore(session.doc, (d) => d.shapes);
  const camera = useStore(controller.ui, (s) => s.camera);
  const ref = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!id) return;
    ref.current?.focus();
    ref.current?.select();
  }, [id]);

  if (!id || !connector) return null;
  const lookup = {
    ...(isAttached(connector.from) && shapes[connector.from.shapeId]
      ? { [connector.from.shapeId]: shapes[connector.from.shapeId] }
      : {}),
    ...(isAttached(connector.to) && shapes[connector.to.shapeId]
      ? { [connector.to.shapeId]: shapes[connector.to.shapeId] }
      : {}),
  };
  const path = connectorPath(connector, lookup);
  if (!path) return null;
  const at = worldToScreen(camera, pathMidpoint(path));
  const commit = (value: string) => {
    if (controller.ui.getState().editingConnector === id) controller.setConnectorLabel(id, value);
  };
  return (
    <input
      ref={ref}
      data-testid="connector-label-input"
      aria-label="Connector label"
      defaultValue={connector.label ?? ''}
      maxLength={MAX_CONNECTOR_LABEL}
      className="absolute z-20 w-40 -translate-x-1/2 -translate-y-1/2 border-2 border-cobalt bg-white px-1.5 py-0.5 text-center font-mono text-xs outline-none"
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          controller.editConnectorLabel(null);
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  );
}
```

- [ ] **Step 6: Double-click and mount.** In `Canvas.tsx`, change `onDoubleClick` to:

```tsx
      onDoubleClick={(e) => {
        if (controller.ui.getState().spaceHeld) return;
        const p = info(e);
        // A double-click on a connector (not on a shape) edits its label; editors only.
        if (!p.hitId && p.connectorId && session.conn.clock.getState().role === 'edit') {
          controller.editConnectorLabel(p.connectorId);
          return;
        }
        controller.dispatch({ type: 'doubleClick', p });
      }}
```

In `Board.tsx`, render `<ConnectorLabelEditor session={session} />` right after `<TextEditor session={session} />`.

- [ ] **Step 7: Check it in a browser.** Write a throwaway Playwright spec and delete it before committing:
  1. draw two rectangles and connect them;
  2. double-click the connector's middle;
  3. type `42` + Enter;
  4. check that `connector-label` shows `42`;
  5. press Ctrl+Z and check that the label is gone.

- [ ] **Step 8: Run the tests, typecheck, lint and build, then commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint && npm run build -w @relay/web`

```bash
git add apps/web
git commit -m "feat(web): connector labels — drawn at the path's middle, edited by double-click"
```

---

### Task 6: Web — Graph menu, New graph dialog and `G`

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Modify: `apps/web/src/ui/Toolbar.tsx`
- Create: `apps/web/src/ui/NewGraphDialog.tsx`
- Modify: `apps/web/src/ui/shortcuts.ts`, `apps/web/src/ui/useShortcuts.ts`, `apps/web/src/ui/shortcutList.ts`
- Modify: `apps/web/src/board/Board.tsx`
- Test: `apps/web/test/graph-controller.test.ts` (extend), `apps/web/test/shortcuts.test.ts` (extend)

**Interfaces:**
- Consumes:
  - `graphPlan`, `GraphDraft`, `familyGraph`, `FAMILY_PARAMS`, `FamilyKind`, `FamilyParams`, `FamilyOptions`, `parseEdgeList` (Tasks 2–3);
  - the controller's private `place()`, which runs `PasteItems` within the byte budget and notifies "Too much to paste at once".
- Produces:
  - UI state:
    - `BoardUiState.graphMenu: boolean`
    - `graphDialog: boolean`
  - controller methods:
    - `controller.setGraphMenu(open: boolean)`
    - `setGraphDialog(open: boolean)`
    - `createGraph(draft: GraphDraft): boolean`
  - `ShortcutAction` gains `{ type: 'graphMenu' }`, bound to `g`.
  - test ids:
    - `tool-graph`, `graph-menu`, `graph-new`, `graph-algorithms`;
    - `graph-dialog`, `graph-tab-families`, `graph-tab-edges`, `graph-family`;
    - `graph-n`, `graph-m`, `graph-k`, `graph-depth`, `graph-p`;
    - `graph-directed`, `graph-weighted`, `graph-names`;
    - `graph-edges`, `graph-errors`, `graph-create`.

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/test/graph-controller.test.ts`, adding `parseEdgeList`, `familyGraph` and `type GraphDraft` to the `@relay/core` import:

```ts
describe('creating graphs', () => {
  it('creates a family as ellipses and connectors, selected, in one undo step', () => {
    const { doc, docs, controller } = setup();
    controller.setViewportSize(800, 600);
    const d = familyGraph('complete', { n: 4, m: 1, k: 1, depth: 0, p: 0 }, {
      directed: false,
      weighted: false,
      names: 'letters',
    }) as GraphDraft;
    expect(controller.createGraph(d)).toBe(true);
    const state = docs.store.getState();
    expect(Object.values(state.shapes).map((s) => s.text).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(Object.keys(state.connectors)).toHaveLength(6);
    expect(controller.ui.getState().tool.selection).toHaveLength(10);
    controller.undo();
    expect(getRoots(doc).shapes.size).toBe(0);
  });

  it('keeps edge-list labels and directions', () => {
    const { docs, controller } = setup();
    controller.setViewportSize(800, 600);
    controller.createGraph(parseEdgeList('A->B:5').draft as GraphDraft);
    const [c] = Object.values(docs.store.getState().connectors);
    expect(c).toMatchObject({ head: 'arrow', label: '5' });
  });

  it('menu and dialog flags', () => {
    const { controller } = setup();
    controller.setGraphMenu(true);
    expect(controller.ui.getState().graphMenu).toBe(true);
    controller.setGraphDialog(true);
    expect(controller.ui.getState()).toMatchObject({ graphMenu: false, graphDialog: true });
  });
});
```

Append to `apps/web/test/shortcuts.test.ts`:

```ts
describe('graph menu key', () => {
  it('G opens the graph menu for everyone', () => {
    const g = { key: 'g', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(keyDownAction(g, false)).toEqual({ type: 'graphMenu' });
    expect(gateByRole({ type: 'graphMenu' }, 'view')).toEqual({ type: 'graphMenu' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- graph-controller shortcuts`
Expected: FAIL.

- [ ] **Step 3: Controller.**
- **UI state:** add `graphMenu: boolean;` and `graphDialog: boolean;` to `BoardUiState`, initialised to `false`.
- **Imports:** import `graphPlan` and `type GraphDraft` from `@relay/core`.
- **Interface additions:**

```ts
  /** The toolbar's Graph menu. */
  setGraphMenu(open: boolean): void;
  /** The New graph dialog (opening it closes the menu). */
  setGraphDialog(open: boolean): void;
  /** Lays out a graph around the viewport centre and creates it (one undo step, selected); false if refused. */
  createGraph(draft: GraphDraft): boolean;
```

- **Implementations:**

```ts
    setGraphMenu(open) {
      ui.setState({ graphMenu: open });
    },
    setGraphDialog(open) {
      ui.setState({ graphDialog: open, graphMenu: false });
    },
    createGraph(draft) {
      if (ui.getState().tool.mode !== 'idle') return false;
      const centre = screenToWorld(ui.getState().camera, viewportCentre());
      const created = place(
        graphPlan(draft, centre, { newId, userId: opts.user.id, userName: opts.user.name, now }),
      );
      if (created) ui.setState({ graphDialog: false });
      return created;
    },
```

`place()` stamps the page on shapes and connectors, runs `PasteItems` in one step, selects the result, and refuses over budget with the paste toast. Check that `screenToWorld` and `viewportCentre` are in scope; both already are.

- **Page change:** reset `graphMenu` and `graphDialog` to false.

- [ ] **Step 4: Keys and help.**
- `shortcuts.ts`:
  - add `| { type: 'graphMenu' }` to `ShortcutAction`;
  - in `keyDownAction`, after the `?` check, add `if (key === 'g') return { type: 'graphMenu' };`. `g` is not in `TOOL_KEYS`. Keep it before the tool lookup.
  - `gateByRole` lets it through, because it is not in the mutating list.
- `useShortcuts.ts`: add the case

```ts
        case 'graphMenu':
          e.preventDefault();
          controller.setGraphMenu(!controller.ui.getState().graphMenu);
          break;
```

- `shortcutList.ts`: add `['G', 'Graph menu']` to the Tools group, after `['M', 'Comment']`.

- [ ] **Step 5: Toolbar button and menu.** In `Toolbar.tsx`:
- import `Network` from `lucide-react`;
- add a `GraphButton` component after `ShapesButton`, and render it right after the `AFTER_SHAPES` buttons:

```tsx
/** The Graph menu: New graph (editors) and Algorithms (everyone). */
function GraphButton({ session, canEdit }: { session: BoardSession; canEdit: boolean }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.graphMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) controller.setGraphMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') controller.setGraphMenu(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, controller]);
  const item = 'block w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-sun disabled:cursor-not-allowed disabled:text-ink/40 disabled:hover:bg-transparent';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="tool-graph"
        aria-label="Graph (G)"
        title="Graph (G)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => controller.setGraphMenu(!open)}
        className={buttonClass(open)}
      >
        <Network className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="graph-menu"
          className="absolute left-full top-0 z-30 ml-2 min-w-40 border-[3px] border-ink bg-white py-1 shadow-hard"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="graph-new"
            disabled={!canEdit}
            className={item}
            onClick={() => controller.setGraphDialog(true)}
          >
            New graph…
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="graph-algorithms"
            className={item}
            onClick={() => {
              controller.setGraphMenu(false);
              controller.setAlgorithmsPanel(true);
            }}
          >
            Algorithms…
          </button>
        </div>
      )}
    </div>
  );
}
```

`controller.setAlgorithmsPanel` is added in Task 7. For this task, add the method to the controller now as a minimal stub, `setAlgorithmsPanel(open: boolean): void`, which sets `ui.algorithmsPanel` (initialised to `false`). Task 7 fills in the panel itself.

In `Toolbar`, pass `canEdit={role === 'edit'}`.

- [ ] **Step 6: The dialog.** Create `apps/web/src/ui/NewGraphDialog.tsx`:

```tsx
import {
  FAMILY_PARAMS,
  type FamilyKind,
  type FamilyOptions,
  type FamilyParams,
  familyGraph,
  type EdgeListError,
  parseEdgeList,
} from '@relay/core';
import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from './Dialog';

const FAMILIES: { kind: FamilyKind; label: string }[] = [
  { kind: 'complete', label: 'Complete Kₙ' },
  { kind: 'cycle', label: 'Cycle Cₙ' },
  { kind: 'path', label: 'Path Pₙ' },
  { kind: 'star', label: 'Star' },
  { kind: 'wheel', label: 'Wheel' },
  { kind: 'bipartite', label: 'Complete bipartite Kₘ,ₙ' },
  { kind: 'grid', label: 'Grid m × n' },
  { kind: 'tree', label: 'k-ary tree' },
  { kind: 'random', label: 'Random G(n, p)' },
];

const PARAM_LABEL: Record<keyof FamilyParams, string> = {
  n: 'n',
  m: 'm',
  k: 'k (children)',
  depth: 'depth',
  p: 'p (edge chance)',
};

export function NewGraphDialog({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.graphDialog);
  const close = useCallback(() => controller.setGraphDialog(false), [controller]);
  const [tab, setTab] = useState<'families' | 'edges'>('families');
  const [family, setFamily] = useState<FamilyKind>('complete');
  const [params, setParams] = useState<FamilyParams>({ n: 5, m: 3, k: 2, depth: 3, p: 0.3 });
  const [opts, setOpts] = useState<FamilyOptions>({ directed: false, weighted: false, names: 'letters' });
  const [edges, setEdges] = useState('A-B, B-C:2\nC->D:5, D-A');
  const [errors, setErrors] = useState<EdgeListError[]>([]);
  if (!open) return null;

  const create = () => {
    if (tab === 'families') {
      const r = familyGraph(family, params, opts);
      if ('error' in r) {
        setErrors([{ line: 0, message: r.error }]);
        return;
      }
      setErrors([]);
      controller.createGraph(r);
      return;
    }
    const r = parseEdgeList(edges);
    setErrors(r.errors);
    if (r.draft) controller.createGraph(r.draft);
  };
  const tabClass = (t: typeof tab) =>
    `flex-1 py-1.5 font-mono text-[11px] font-bold uppercase ${tab === t ? 'bg-sun' : 'bg-white hover:bg-paper'}`;
  const field = 'mt-1 w-full border-2 border-ink/40 px-2 py-1 font-mono text-xs';

  return (
    <Dialog title="New graph" onClose={close} wide>
      <div data-testid="graph-dialog">
        <div className="flex border-2 border-ink">
          <button type="button" data-testid="graph-tab-families" className={tabClass('families')} onClick={() => setTab('families')}>
            Families
          </button>
          <button type="button" data-testid="graph-tab-edges" className={tabClass('edges')} onClick={() => setTab('edges')}>
            Edge list
          </button>
        </div>
        {tab === 'families' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="font-mono text-[10px] uppercase text-ink/60 sm:col-span-2">
              Family
              <select
                data-testid="graph-family"
                value={family}
                onChange={(e) => setFamily(e.target.value as FamilyKind)}
                className={field}
              >
                {FAMILIES.map((f) => (
                  <option key={f.kind} value={f.kind}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {(Object.entries(FAMILY_PARAMS[family]) as [keyof FamilyParams, readonly [number, number]][]).map(
              ([key, [min, max]]) => (
                <label key={key} className="font-mono text-[10px] uppercase text-ink/60">
                  {PARAM_LABEL[key]} ({min}–{max})
                  <input
                    data-testid={`graph-${key}`}
                    type="number"
                    min={min}
                    max={max}
                    step={key === 'p' ? 0.05 : 1}
                    value={params[key]}
                    onChange={(e) => setParams({ ...params, [key]: Number(e.target.value) })}
                    className={field}
                  />
                </label>
              ),
            )}
            <label className="flex items-center gap-2 font-mono text-xs">
              <input
                data-testid="graph-directed"
                type="checkbox"
                checked={opts.directed}
                onChange={(e) => setOpts({ ...opts, directed: e.target.checked })}
              />
              Directed
            </label>
            <label className="flex items-center gap-2 font-mono text-xs">
              <input
                data-testid="graph-weighted"
                type="checkbox"
                checked={opts.weighted}
                onChange={(e) => setOpts({ ...opts, weighted: e.target.checked })}
              />
              Weighted (1–9)
            </label>
            <label className="font-mono text-[10px] uppercase text-ink/60">
              Node names
              <select
                data-testid="graph-names"
                value={opts.names}
                onChange={(e) => setOpts({ ...opts, names: e.target.value as FamilyOptions['names'] })}
                className={field}
              >
                <option value="letters">Letters (A, B, …)</option>
                <option value="numbers">Numbers (1, 2, …)</option>
              </select>
            </label>
          </div>
        ) : (
          <label className="mt-3 block font-mono text-[10px] uppercase text-ink/60">
            One edge per line or comma: A-B undirected, A-&gt;B directed, A-B:5 weight, lone names are
            nodes
            <textarea
              data-testid="graph-edges"
              data-scroll-region
              value={edges}
              onChange={(e) => setEdges(e.target.value)}
              rows={8}
              className={`${field} resize-y normal-case text-ink`}
            />
          </label>
        )}
        {errors.length > 0 && (
          <ul data-testid="graph-errors" className="mt-3 grid gap-1 font-mono text-xs text-flame">
            {errors.map((e) => (
              <li key={`${e.line}:${e.message}`}>{e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="border-2 border-ink px-3 py-1 font-mono text-xs uppercase hover:bg-paper" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="graph-create"
            className="border-2 border-ink bg-sun px-3 py-1 font-mono text-xs font-bold uppercase hover:brightness-105"
            onClick={create}
          >
            Create
          </button>
        </div>
      </div>
    </Dialog>
  );
}
```

In `Board.tsx`, render `<NewGraphDialog session={session} />` next to `<HelpDialog …/>`.

- [ ] **Step 7: Check it in a browser.** Write a throwaway spec and delete it before committing:
  1. press `g`, check that `graph-menu` is visible, and click `graph-new`;
  2. choose `wheel` with n=6, directed and weighted, then Create: 7 ellipses and 12 connectors appear, and every connector has a label;
  3. on the edge-list tab, `A-A` shows an error line;
  4. check that a viewer sees `graph-new` disabled.

- [ ] **Step 8: Run the tests, typecheck, lint and build, then commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint && npm run build -w @relay/web`

```bash
git add apps/web
git commit -m "feat(web): Graph menu, New graph dialog (families and edge lists) and the G key"
```

---

### Task 7: Web — Algorithms panel and overlay

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Create: `apps/web/src/ui/AlgorithmsPanel.tsx`
- Create: `apps/web/src/render/GraphOverlay.tsx`
- Modify: `apps/web/src/render/Canvas.tsx` (mount the overlay inside the transformed `<g>` after `<SelectionLayer>`)
- Modify: `apps/web/src/board/Board.tsx` (mount the panel)
- Test: `apps/web/test/graph-controller.test.ts` (extend)

**Interfaces:**
- Consumes: `readGraph`, `runAlgorithm`, `AlgorithmKind`, `AlgorithmResult` (Task 4); `setAlgorithmsPanel` (stubbed in Task 6).
- Produces:
  - UI state `BoardUiState.algorithmsPanel: boolean` and `graphResult: AlgorithmResult | null`.
  - Controller methods:
    - `controller.setAlgorithmsPanel(open)`: opening closes the comments panel, and `toggleCommentsPanel` opening closes this panel;
    - `runAlgorithm(kind, start?, end?): AlgorithmResult`;
    - `clearGraphResult()`.
  - A `cancel` tool event (Escape) and a page change clear the result.
  - Test ids:
    - `algorithms-panel`, `algo-kind`, `algo-start`, `algo-end`, `algo-run`, `algo-clear`, `algo-result`;
    - `graph-highlight-node`, `graph-highlight-edge`, `graph-order-badge`.

- [ ] **Step 1: Write the failing tests** — append to `apps/web/test/graph-controller.test.ts`:

```ts
describe('algorithms', () => {
  it('runs on the page graph, stores the result locally, and clears on Escape', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.setAlgorithmsPanel(true);
    const r = controller.runAlgorithm('path', 'a', 'b');
    expect(r).toEqual({ kind: 'path', nodes: ['a', 'b'], edges: ['k'], cost: 1 });
    expect(controller.ui.getState().graphResult).toEqual(r);
    controller.dispatch({ type: 'cancel' });
    expect(controller.ui.getState().graphResult).toBeNull();
  });

  it('uses only the selection when there is one', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.select(['a']);
    expect(controller.runAlgorithm('components')).toEqual({ kind: 'components', groups: [['a']] });
  });

  it('the algorithms and comments panels exclude each other', () => {
    const { controller } = setup();
    controller.setAlgorithmsPanel(true);
    controller.toggleCommentsPanel();
    expect(controller.ui.getState()).toMatchObject({ commentsPanel: true, algorithmsPanel: false });
    controller.setAlgorithmsPanel(true);
    expect(controller.ui.getState()).toMatchObject({ commentsPanel: false, algorithmsPanel: true });
  });

  it('a page change clears the result', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.runAlgorithm('bfs', 'a');
    controller.setPage(controller.createPage('board'));
    expect(controller.ui.getState().graphResult).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- graph-controller`
Expected: FAIL.

- [ ] **Step 3: Controller.**
- **UI state:** add `graphResult: AlgorithmResult | null` (initialised to `null`) to `BoardUiState`. `algorithmsPanel` already exists from Task 6.
- **Imports:** import `readGraph`, `runAlgorithm as runGraphAlgorithm`, `type AlgorithmKind` and `type AlgorithmResult` from `@relay/core`.
- **Interface additions:**

```ts
  /** The Algorithms panel (it and the comments panel exclude each other). */
  setAlgorithmsPanel(open: boolean): void;
  /** Runs an algorithm on the selection (or the whole page) and shows its result as a local overlay. */
  runAlgorithm(kind: AlgorithmKind, start?: string, end?: string): AlgorithmResult;
  clearGraphResult(): void;
```

- **Implementations** (replace the Task 6 stub):

```ts
    setAlgorithmsPanel(open) {
      ui.setState(open ? { algorithmsPanel: true, commentsPanel: false } : { algorithmsPanel: false });
    },
    runAlgorithm(kind, start, end) {
      const { shapes, connectors } = opts.docStore.getState();
      const result = runGraphAlgorithm(readGraph(ui.getState().tool.selection, shapes, connectors), kind, start, end);
      ui.setState({ graphResult: result });
      return result;
    },
    clearGraphResult() {
      ui.setState({ graphResult: null });
    },
```

- **Comments panel:** in `toggleCommentsPanel`, change the body to `const open = !ui.getState().commentsPanel; ui.setState(open ? { commentsPanel: true, algorithmsPanel: false } : { commentsPanel: false });`.
- **Escape:** in the named `dispatch`, before stepping the FSM, add `if (event.type === 'cancel' && ui.getState().graphResult) ui.setState({ graphResult: null });`.
- **Page change:** add `graphResult: null` to the page-change reset.

- [ ] **Step 4: The overlay.** Create `apps/web/src/render/GraphOverlay.tsx`:

```tsx
import { connectorPath, isAttached, PALETTE, type Point, shapeBounds } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const GROUP_COLORS = [PALETTE.cobalt, PALETTE.flame, PALETTE.sun, PALETTE.ink];
const toPoints = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

/** The last algorithm's result: highlighted nodes and edges, visit numbers, component colours. Local only. */
export function GraphOverlay({ session }: { session: BoardSession }) {
  const result = useStore(session.controller.ui, (s) => s.graphResult);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const zoom = useStore(session.controller.ui, (s) => s.camera.zoom);
  if (!result || result.kind === 'error') return null;

  const ring = (id: string, color: string, key: string) => {
    const s = shapes[id];
    if (!s) return null;
    const b = shapeBounds(s);
    return (
      <rect
        key={key}
        data-testid="graph-highlight-node"
        x={b.x - 6}
        y={b.y - 6}
        width={b.w + 12}
        height={b.h + 12}
        fill="none"
        stroke={color}
        strokeWidth={3 / zoom}
        rx={6}
      />
    );
  };
  const edge = (id: string) => {
    const c = connectors[id];
    if (!c) return null;
    const lookup = {
      ...(isAttached(c.from) && shapes[c.from.shapeId] ? { [c.from.shapeId]: shapes[c.from.shapeId] } : {}),
      ...(isAttached(c.to) && shapes[c.to.shapeId] ? { [c.to.shapeId]: shapes[c.to.shapeId] } : {}),
    };
    const path = connectorPath(c, lookup);
    if (!path) return null;
    return (
      <polyline
        key={`e:${id}`}
        data-testid="graph-highlight-edge"
        points={toPoints(path)}
        fill="none"
        stroke={PALETTE.cobalt}
        strokeOpacity={0.45}
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  };

  return (
    <g pointerEvents="none">
      {result.kind === 'traversal' && (
        <>
          {result.edges.map(edge)}
          {result.order.map((id, i) => {
            const s = shapes[id];
            if (!s) return null;
            const b = shapeBounds(s);
            return (
              <g key={`o:${id}`} data-testid="graph-order-badge" transform={`translate(${b.x + b.w} ${b.y})`}>
                <circle r={11} fill={PALETTE.cobalt} stroke={PALETTE.ink} strokeWidth={1.5} />
                <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill={PALETTE.white} className="font-mono">
                  {i + 1}
                </text>
              </g>
            );
          })}
        </>
      )}
      {result.kind === 'path' && (
        <>
          {result.edges.map(edge)}
          {result.nodes.map((id) => ring(id, PALETTE.cobalt, `p:${id}`))}
        </>
      )}
      {result.kind === 'mst' && result.edges.map(edge)}
      {result.kind === 'components' &&
        result.groups.flatMap((group, gi) =>
          group.map((id) => ring(id, GROUP_COLORS[gi % GROUP_COLORS.length] as string, `c:${id}`)),
        )}
    </g>
  );
}
```

In `Canvas.tsx`, render `<GraphOverlay session={session} />` right after `<SelectionLayer session={session} />`.

- [ ] **Step 5: The panel.** Create `apps/web/src/ui/AlgorithmsPanel.tsx`:

```tsx
import { type AlgorithmKind, type AlgorithmResult, readGraph } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const KINDS: { kind: AlgorithmKind; label: string }[] = [
  { kind: 'bfs', label: 'Breadth-first search' },
  { kind: 'dfs', label: 'Depth-first search' },
  { kind: 'path', label: 'Shortest path (Dijkstra)' },
  { kind: 'mst', label: 'Minimum spanning tree' },
  { kind: 'components', label: 'Connected components' },
];

function describe(result: AlgorithmResult, name: (id: string) => string): string {
  switch (result.kind) {
    case 'traversal':
      return `Visit order: ${result.order.map(name).join(' → ')}`;
    case 'path':
      return `${result.nodes.map(name).join(' → ')} · cost ${result.cost}`;
    case 'mst':
      return `${result.edges.length} edge${result.edges.length === 1 ? '' : 's'} · total weight ${result.total}`;
    case 'components':
      return `${result.groups.length} component${result.groups.length === 1 ? '' : 's'}`;
    case 'error':
      return result.message;
  }
}

export function AlgorithmsPanel({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.algorithmsPanel);
  const selection = useStore(controller.ui, (s) => s.tool.selection);
  const result = useStore(controller.ui, (s) => s.graphResult);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const [kind, setKind] = useState<AlgorithmKind>('bfs');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  if (!open) return null;

  const graph = readGraph(selection, shapes, connectors);
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const name = (id: string) => names.get(id) ?? '?';
  const startId = graph.nodes.some((n) => n.id === start) ? start : (graph.nodes[0]?.id ?? '');
  const endId = graph.nodes.some((n) => n.id === end) ? end : (graph.nodes.at(-1)?.id ?? '');
  const field = 'mt-1 w-full border-2 border-ink/40 px-2 py-1 font-mono text-xs';

  return (
    <aside
      data-testid="algorithms-panel"
      aria-label="Graph algorithms"
      className="absolute top-3 right-3 z-10 flex w-72 flex-col gap-3 border-[3px] border-ink bg-white p-3 shadow-hard"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm uppercase">Algorithms</h2>
        <button
          type="button"
          aria-label="Close"
          className="border-2 border-ink px-1.5 font-mono text-xs hover:bg-paper"
          onClick={() => controller.setAlgorithmsPanel(false)}
        >
          ×
        </button>
      </div>
      <p className="font-mono text-[10px] text-ink/60">
        {selection.length > 0 ? 'On the selection' : 'On the whole page'} · {graph.nodes.length} nodes ·{' '}
        {graph.edges.length} edges
      </p>
      <label className="font-mono text-[10px] uppercase text-ink/60">
        Algorithm
        <select data-testid="algo-kind" value={kind} onChange={(e) => setKind(e.target.value as AlgorithmKind)} className={field}>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {(kind === 'bfs' || kind === 'dfs' || kind === 'path') && (
        <label className="font-mono text-[10px] uppercase text-ink/60">
          Start
          <select data-testid="algo-start" value={startId} onChange={(e) => setStart(e.target.value)} className={field}>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'path' && (
        <label className="font-mono text-[10px] uppercase text-ink/60">
          End
          <select data-testid="algo-end" value={endId} onChange={(e) => setEnd(e.target.value)} className={field}>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="algo-run"
          className="flex-1 border-2 border-ink bg-sun py-1 font-mono text-xs font-bold uppercase hover:brightness-105"
          onClick={() => controller.runAlgorithm(kind, startId, endId)}
        >
          Run
        </button>
        <button
          type="button"
          data-testid="algo-clear"
          className="border-2 border-ink px-3 py-1 font-mono text-xs uppercase hover:bg-paper"
          onClick={() => controller.clearGraphResult()}
        >
          Clear
        </button>
      </div>
      {result && (
        <p data-testid="algo-result" className={`font-mono text-xs ${result.kind === 'error' ? 'text-flame' : ''}`}>
          {describe(result, name)}
        </p>
      )}
    </aside>
  );
}
```

In `Board.tsx`, render `<AlgorithmsPanel session={session} />` next to `<CommentsPanel …/>`.

- [ ] **Step 6: Check it in a browser.** Write a throwaway spec and delete it before committing:
  1. create the edge list `A-B:2, B-C:3, A-C:10`;
  2. open Algorithms and run Shortest path A→C: `algo-result` shows `A → B → C · cost 5`, and there are 2 `graph-highlight-edge`;
  3. press Escape to clear it;
  4. run BFS: there are 3 `graph-order-badge`.

- [ ] **Step 7: Run the tests, typecheck, lint and build, then commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint && npm run build -w @relay/web`

```bash
git add apps/web
git commit -m "feat(web): Algorithms panel with local overlays — traversal order, shortest path, MST, components"
```

---

### Task 8: E2E — graphs, then full verification

**Files:**
- Create: `e2e/graphs.spec.ts`

- [ ] **Step 1: Write the spec** — create `e2e/graphs.spec.ts`:

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

test('generate a family and an edge list, then run algorithms', async ({ page, browser, request }) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.keyboard.press('g');
  await expect(page.getByTestId('graph-menu')).toBeVisible();
  await page.getByTestId('graph-new').click();
  await page.getByTestId('graph-family').selectOption('complete');
  await page.getByTestId('graph-n').fill('5');
  await page.getByTestId('graph-create').click();
  await expect(page.getByTestId('graph-dialog')).toHaveCount(0);
  await expect(page.locator('[data-shape-id] ellipse')).not.toHaveCount(0);
  await expect(pb.locator('[data-connector-id]')).toHaveCount(10);

  // One undo removes the whole graph.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-connector-id]')).toHaveCount(0);

  await page.getByTestId('tool-graph').click();
  await page.getByTestId('graph-new').click();
  await page.getByTestId('graph-tab-edges').click();
  await page.getByTestId('graph-edges').fill('A-A');
  await page.getByTestId('graph-create').click();
  await expect(page.getByTestId('graph-errors')).toContainText('Line 1: A-A is a self-loop');
  await page.getByTestId('graph-edges').fill('A-B:2, B-C:3, A-C:10');
  await page.getByTestId('graph-create').click();
  await expect(page.getByTestId('connector-label')).toHaveCount(3);

  await page.getByTestId('tool-graph').click();
  await page.getByTestId('graph-algorithms').click();
  await page.mouse.click(900, 600);
  await page.getByTestId('algo-kind').selectOption('path');
  await page.getByTestId('algo-start').selectOption({ label: 'A' });
  await page.getByTestId('algo-end').selectOption({ label: 'C' });
  await page.getByTestId('algo-run').click();
  await expect(page.getByTestId('algo-result')).toHaveText('A → B → C · cost 5');
  await expect(page.getByTestId('graph-highlight-edge')).toHaveCount(2);
  // Results are local: the other user sees no overlay.
  await expect(pb.getByTestId('graph-highlight-edge')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('graph-highlight-edge')).toHaveCount(0);

  await page.getByTestId('algo-kind').selectOption('bfs');
  await page.getByTestId('algo-run').click();
  await expect(page.getByTestId('graph-order-badge')).toHaveCount(3);
  await other.close();
});

test('edit a connector label by double-click; viewers cannot', async ({ page, browser, request }) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await page.keyboard.press('g');
  await page.getByTestId('graph-new').click();
  await page.getByTestId('graph-tab-edges').click();
  await page.getByTestId('graph-edges').fill('A-B');
  await page.getByTestId('graph-create').click();
  const edge = page.locator('[data-connector-id] polyline').last();
  const box = await edge.boundingBox();
  if (!box) throw new Error('edge not rendered');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('connector-label-input').fill('42');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('connector-label')).toHaveText('42');

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await expect(viewer.getByTestId('connector-label')).toHaveText('42');
  const vbox = await viewer.locator('[data-connector-id] polyline').last().boundingBox();
  if (!vbox) throw new Error('edge not rendered for viewer');
  await viewer.mouse.dblclick(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await expect(viewer.getByTestId('connector-label-input')).toHaveCount(0);
  await viewer.keyboard.press('g');
  await expect(viewer.getByTestId('graph-new')).toBeDisabled();
  await viewer.getByTestId('graph-algorithms').click();
  await expect(viewer.getByTestId('algorithms-panel')).toBeVisible();
  await viewerCtx.close();
});
```

The `page.mouse.click(900, 600)` before choosing the algorithm clears the selection, so the algorithm runs on the whole page. After a graph is created it is selected, so running on the selection would also work. Either way the result is the three nodes.

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/graphs.spec.ts`
Expected: 2 passed.

If something fails, decide whether the product or the test is wrong. Fix a product bug in its own commit. Never weaken an assertion.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run e2e && npm run build -w @relay/web`
Expected: all green. E2E should be 32: the 30 existing tests plus these 2.

- [ ] **Step 4: Commit**

```bash
git add e2e/graphs.spec.ts
git commit -m "test(e2e): graph families, edge lists, labels and local algorithm overlays"
```

---

### Task 9: README — English and Spanish

**Files:**
- Modify: `README.md`
- Modify: `README.es.md`

This task is documentation, and the READMEs are both hand-written. Read both in full first. Make these changes in **both** languages, keeping each file's existing voice, structure and formatting:

1. **"What it does":**
   - Add **Spreadsheet pages**: id-stable rows and columns that survive concurrent inserts, deletes and moves; a hand-written formula engine (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `ROUND`, `ABS`, `IF`, operators, ranges, errors and cycle detection); tab-separated copy/paste compatible with Excel and Google Sheets; fill handle and Ctrl+D; formats; live peer ranges.
   - Add **Graphs**: generate complete, cycle, path, star, wheel, bipartite, grid, tree or random graphs, or paste an edge list (`A-B`, `A->B:5`); connector labels as weights; BFS, DFS, Dijkstra, minimum spanning tree and connected components shown as a local overlay.
   - Mention the **Shapes** flyout: rectangle, ellipse and line under one toolbar button.
2. **"Engineering highlights":** add two short bullets:
   - the sheet model: nested row and column maps plus a flat cell map, formulas stored by row and column id, deterministic row-major evaluation with a depth cap;
   - graphs built from ordinary shapes and connectors: collaboration, undo and clipboard are free, and the algorithms are pure core functions.
3. **Landing and demo:** remove any sentence telling readers to click "Open live demo" on the landing page (the button is gone). Keep the demo GIF.
4. **"Tests":** update the counts to the real numbers from Task 8's full run (unit per workspace, e2e total).
5. **"Roadmap":**
   - mark **P3 spreadsheet pages** and **P4 graphs** done;
   - list **P5 calendar page (month and week)** as next;
   - keep F5 and F6 as they are.

Keep the headings and the order of sections. Do not invent features that are not in the code. Check each claim against the spec sections "Sheets (F4·P3)" and "Graphs (F4·P4)".

- [ ] **Step 1:** Edit `README.md`.
- [ ] **Step 2:** Edit `README.es.md` with the same content in Spanish.
- [ ] **Step 3: Check the links and commit.** Run `npm run lint`; Biome ignores `.md`, so this only checks nothing else broke. Then preview both files in the editor for broken markdown.

```bash
git add README.md README.es.md
git commit -m "docs(readme): spreadsheet pages, graphs and the Shapes flyout; no live-demo button"
```
