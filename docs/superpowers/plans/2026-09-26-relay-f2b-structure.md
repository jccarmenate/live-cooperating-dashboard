# Relay F2b (Structure: connectors + frames) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add anchored connectors (straight or elbow, with arrowheads, following their shapes live) and frames with titled columns (derived counters, reparent-on-drop, frames carry their children), completing phase F2 of the spec.

**Architecture:** Core first: connector geometry (outline clipping, anchors, elbow routing) and frame geometry (columns, drop targets, counts) as pure functions; new commands `Connect`, `SetRouting`, `Reparent`, `RenameColumn`; read-side normalization drops orphaned connectors and invalid parents/columns; the convergence property test fuzzes the new commands. Then the tool FSM gains a `connector` and a `frame` tool, connector selection/routing toggle, column editing, frame-drags-children and reparent-on-drop. The web layer projects connectors into the store, renders a frames layer, a connectors layer (overlay-aware, so connectors follow drags every frame) and the shapes layer, plus a column-title editor.

**Tech Stack:** TypeScript 5.9, Yjs 13.6 (`Y.Map`, `Y.Array`, `Y.Text`), Vitest 4, fast-check 4, React 19 / Next.js 16, Zustand 5, lucide-react, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md` (phase F2: connectors and frames with columns; F2a already shipped the rest of F2).

## Global Constraints

- Total cost $0; no credit card on any service; no paid dependency.
- `yjs` stays on 13.6.x with a single copy; Vitest stays on 4.x; TypeScript `~5.9`.
- All board mutations go through `applyCommand` from `@relay/core`; UI code never writes Yjs types directly.
- `packages/core` is platform-neutral: `lib: ["ES2023"]`, `types: []`; no DOM/Node typings; web-platform globals are declared module-locally.
- Per-user undo tracks only `LOCAL_ORIGIN` and `AI_ORIGIN`; every committed gesture ends with exactly one `endGesture`.
- Drag commits stay throttled at 50 ms; local previews (overlay) update every pointer move.
- Spec modelling rules: normalize on read (connectors whose attached shape is gone are dropped; a `parentId` that is not an existing frame is treated as root; frames never nest); aggregates (column counters) are derived, never stored; frame columns are a `Y.Array<{ id, title }>` created only by the frame's creator.
- Rendering layers, back to front: dotted grid, frames, connectors, shapes, selection.
- DOM contract (existing, keep): `data-testid` `canvas`, `text-editor`, `tool-<id>`, `online-count`, `conn-status`, `remote-cursor`, `selection-outline`, `marquee`; `data-shape-id`, `data-handle`. New: connectors carry `data-connector-id`; frame column headers carry `data-column-id`; the column title editor is `data-testid="column-editor"`; toolbar adds `tool-connector` and `tool-frame`.
- Do NOT edit `README.md` / `README.es.md` in this plan (the README is updated once at the end of the whole project).
- Biome lint must pass (`npm run lint`); fix formatting with `npm run format`; never disable rules.
- Every commit message ends with a blank line then a `Co-Authored-By:` trailer naming the model that authored the commit (default `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## File Map

```
packages/core/src/
├─ schema/types.ts           MOD  Anchor/Endpoint/Connector/Routing, FrameColumn, Shape.columns, TEXT_TYPES += frame
├─ schema/defaults.ts        MOD  DEFAULT_SIZE.frame, DEFAULT_COLUMNS
├─ schema/snapshot.ts        MOD  readConnector, readShape columns (deduped)
├─ schema/normalize.ts       MOD  normalizeConnectors; frames never nest; invalid columnId dropped
├─ geometry/connectors.ts    NEW  anchorPoint, facingSide, clipToOutline, elbowPath, connectorPath, arrowHead
├─ geometry/frames.ts        NEW  FRAME_TITLE_H, COLUMN_HEADER_H, frameColumns, dropTarget, columnCounts, childrenOf, rectContains
├─ commands/types.ts         MOD  NewConnector; Connect, SetRouting, Reparent, RenameColumn
├─ commands/apply.ts         MOD  new commands; CreateShape stores frame columns; DeleteShapes also deletes connector ids
├─ tools/machine.ts          REPLACE  connector + frame tools, connector selection, toggleRouting, editColumn, children drag, reparent on drop
└─ index.ts                  MOD
packages/core/test/          connectors.test.ts, frames.test.ts, tools-structure.test.ts (NEW); commands/schema/convergence (MOD)
apps/web/src/
├─ store/docStore.ts         MOD  connectors + connectorOrder
├─ board/controller.ts       MOD  ctx.connectors, editColumn state, renameColumn / stopEditingColumn
├─ ui/useShortcuts.ts        MOD  A connector, F frame, E toggle routing
├─ ui/Toolbar.tsx            MOD  9 tools
├─ render/ConnectorView.tsx  NEW
├─ render/FrameView.tsx      NEW  (FrameBody used by ShapeView)
├─ render/ColumnTitleEditor.tsx NEW
├─ render/ShapeView.tsx      MOD  frame case
├─ render/Canvas.tsx         MOD  layers, connectorId/column hit-testing, blur column editor
├─ render/TextEditor.tsx     MOD  frame title band
├─ render/typography.ts      MOD  frame title style
└─ board/Board.tsx           MOD  mount ColumnTitleEditor
apps/web/test/               docStore.test.ts, controller.test.ts (MOD)
e2e/structure.spec.ts        NEW
docs/superpowers/specs/2026-09-24-relay-design.md  MOD
```

---

### Task 1: Connector types and geometry

**Files:**
- Modify: `packages/core/src/schema/types.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/geometry/connectors.ts`
- Test: `packages/core/test/connectors.test.ts`

**Interfaces:**
- Consumes: `Point`, `Rect`, `Shape` (schema/types); `centerOf` (geometry/rect); `shapeBounds` (geometry/shapes).
- Produces (types in `schema/types.ts`):
  - `type AnchorSide = 'n' | 's' | 'e' | 'w'`, `type Anchor = AnchorSide | 'auto'`
  - `type AttachedEnd = { shapeId: string; anchor: Anchor }`, `type FreeEnd = { x: number; y: number }`, `type Endpoint = AttachedEnd | FreeEnd`
  - `type Routing = 'straight' | 'elbow'`
  - `interface Connector { id: string; from: Endpoint; to: Endpoint; routing: Routing; head: 'arrow' | 'none'; z: string; createdBy: string }`
- Produces (functions in `geometry/connectors.ts`):
  - `isAttached(e: Endpoint): e is AttachedEnd`
  - `anchorPoint(b: Rect, side: AnchorSide): Point`
  - `facingSide(b: Rect, target: Point): AnchorSide` (dominant axis from the box centre; ties go horizontal)
  - `clipToOutline(s: ShapeGeometry, target: Point): Point` (rect bounds, or the ellipse curve for ellipses)
  - `elbowPath(a: Point, sa: AnchorSide, b: Point, sb: AnchorSide): Point[]` (≤ 2 bends, consecutive duplicates removed)
  - `connectorPath(c: Pick<Connector,'from'|'to'|'routing'>, shapes: ShapeLookup): Point[] | null` (null when an attached shape is missing)
  - `arrowHead(tip: Point, from: Point, size?: number): [Point, Point, Point] | null` (default size 12)
  - `type ShapeGeometry = Pick<Shape,'type'|'x'|'y'|'w'|'h'>`, `type ShapeLookup = Readonly<Record<string, ShapeGeometry | undefined>>`

- [ ] **Step 1: Write the failing test `packages/core/test/connectors.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  arrowHead,
  clipToOutline,
  connectorPath,
  elbowPath,
  facingSide,
  isAttached,
  type ShapeLookup,
} from '../src';

const A = { type: 'rect' as const, x: 0, y: 0, w: 100, h: 50 }; // centre (50, 25)
const B = { type: 'rect' as const, x: 300, y: 200, w: 100, h: 50 }; // centre (350, 225)
const shapes: ShapeLookup = { a: A, b: B };
const at = (shapeId: string) => ({ shapeId, anchor: 'auto' as const });

describe('anchors', () => {
  it('anchorPoint returns edge midpoints', () => {
    expect(anchorPoint(A, 'n')).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(A, 's')).toEqual({ x: 50, y: 50 });
    expect(anchorPoint(A, 'e')).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(A, 'w')).toEqual({ x: 0, y: 25 });
  });

  it('facingSide picks the dominant axis, ties go horizontal', () => {
    expect(facingSide(A, { x: 350, y: 225 })).toBe('e');
    expect(facingSide(A, { x: 60, y: 500 })).toBe('s');
    expect(facingSide(A, { x: -100, y: 25 })).toBe('w');
    expect(facingSide(A, { x: 50, y: -300 })).toBe('n');
    expect(facingSide(A, { x: 150, y: 125 })).toBe('e');
  });

  it('isAttached distinguishes shape ends from free points', () => {
    expect(isAttached(at('a'))).toBe(true);
    expect(isAttached({ x: 1, y: 2 })).toBe(false);
  });
});

describe('clipToOutline', () => {
  it('clips to the rectangle border along the centre line', () => {
    expect(clipToOutline(A, { x: 350, y: 225 })).toEqual({ x: 87.5, y: 50 });
  });

  it('clips to the ellipse curve', () => {
    const e = { type: 'ellipse' as const, x: 0, y: 0, w: 200, h: 100 };
    expect(clipToOutline(e, { x: 300, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(clipToOutline(e, { x: 100, y: 250 })).toEqual({ x: 100, y: 100 });
  });

  it('returns the centre when the target is the centre', () => {
    expect(clipToOutline(A, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });
});

describe('connectorPath', () => {
  it('straight auto connectors run between the two outlines', () => {
    expect(connectorPath({ from: at('a'), to: at('b'), routing: 'straight' }, shapes)).toEqual([
      { x: 87.5, y: 50 },
      { x: 312.5, y: 200 },
    ]);
  });

  it('elbow auto connectors leave from facing sides with a mid-x bend', () => {
    expect(connectorPath({ from: at('a'), to: at('b'), routing: 'elbow' }, shapes)).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ]);
  });

  it('respects fixed anchors (vertical start, horizontal end → one bend)', () => {
    const c = {
      from: { shapeId: 'a', anchor: 's' as const },
      to: { shapeId: 'b', anchor: 'w' as const },
      routing: 'elbow' as const,
    };
    expect(connectorPath(c, shapes)).toEqual([
      { x: 50, y: 50 },
      { x: 50, y: 225 },
      { x: 300, y: 225 },
    ]);
  });

  it('supports free endpoints', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 50 };
    expect(connectorPath({ from, to, routing: 'straight' }, {})).toEqual([from, to]);
    expect(connectorPath({ from, to, routing: 'elbow' }, {})).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('returns null when an attached shape no longer exists', () => {
    expect(connectorPath({ from: at('a'), to: at('gone'), routing: 'straight' }, shapes)).toBeNull();
  });
});

describe('elbowPath and arrowHead', () => {
  it('vertical-to-vertical uses a mid-y bend and drops duplicate points', () => {
    expect(elbowPath({ x: 0, y: 0 }, 's', { x: 0, y: 100 }, 'n')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(elbowPath({ x: 0, y: 0 }, 's', { x: 40, y: 100 }, 'n')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 100 },
    ]);
  });

  it('arrowHead builds a triangle pointing at the tip', () => {
    expect(arrowHead({ x: 100, y: 0 }, { x: 0, y: 0 }, 10)).toEqual([
      { x: 100, y: 0 },
      { x: 90, y: 5 },
      { x: 90, y: -5 },
    ]);
    expect(arrowHead({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @relay/core -- connectors`
Expected: FAIL — the symbols are not exported from `../src`.

- [ ] **Step 3: Add connector types to `packages/core/src/schema/types.ts`** (append after `Rect`)

```ts
export type AnchorSide = 'n' | 's' | 'e' | 'w';
export type Anchor = AnchorSide | 'auto';
export type AttachedEnd = { shapeId: string; anchor: Anchor };
export type FreeEnd = { x: number; y: number };
export type Endpoint = AttachedEnd | FreeEnd;
export type Routing = 'straight' | 'elbow';

export interface Connector {
  id: string;
  from: Endpoint;
  to: Endpoint;
  routing: Routing;
  head: 'arrow' | 'none';
  /** Fractional-index key; ties are broken by id. */
  z: string;
  createdBy: string;
}
```

- [ ] **Step 4: Implement `packages/core/src/geometry/connectors.ts`**

```ts
import type {
  AnchorSide,
  AttachedEnd,
  Connector,
  Endpoint,
  Point,
  Rect,
  Shape,
} from '../schema/types';
import { centerOf } from './rect';
import { shapeBounds } from './shapes';

export type ShapeGeometry = Pick<Shape, 'type' | 'x' | 'y' | 'w' | 'h'>;
export type ShapeLookup = Readonly<Record<string, ShapeGeometry | undefined>>;

export const isAttached = (e: Endpoint): e is AttachedEnd => 'shapeId' in e;

export function anchorPoint(b: Rect, side: AnchorSide): Point {
  switch (side) {
    case 'n':
      return { x: b.x + b.w / 2, y: b.y };
    case 's':
      return { x: b.x + b.w / 2, y: b.y + b.h };
    case 'e':
      return { x: b.x + b.w, y: b.y + b.h / 2 };
    case 'w':
      return { x: b.x, y: b.y + b.h / 2 };
  }
}

/** Side of `b` facing `target`, by the dominant axis from b's centre (ties go horizontal). */
export function facingSide(b: Rect, target: Point): AnchorSide {
  const c = centerOf(b);
  return sideFor(target.x - c.x, target.y - c.y);
}

function sideFor(dx: number, dy: number): AnchorSide {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/** Where the ray from the shape's centre toward `target` leaves its outline. */
export function clipToOutline(s: ShapeGeometry, target: Point): Point {
  const b = shapeBounds(s);
  const c = centerOf(b);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  let t: number;
  if (s.type === 'ellipse') {
    const rx = b.w / 2;
    const ry = b.h / 2;
    t = rx > 0 && ry > 0 ? 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)) : 0;
  } else {
    const tx = dx === 0 ? Number.POSITIVE_INFINITY : b.w / 2 / Math.abs(dx);
    const ty = dy === 0 ? Number.POSITIVE_INFINITY : b.h / 2 / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const horizontal = (s: AnchorSide) => s === 'e' || s === 'w';

function withoutRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => {
    const prev = points[i - 1];
    return !prev || prev.x !== p.x || prev.y !== p.y;
  });
}

/** Orthogonal polyline with at most two bends, leaving `a` along `sa` and entering `b` along `sb`. */
export function elbowPath(a: Point, sa: AnchorSide, b: Point, sb: AnchorSide): Point[] {
  if (horizontal(sa) && horizontal(sb)) {
    const mx = (a.x + b.x) / 2;
    return withoutRepeats([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
  }
  if (!horizontal(sa) && !horizontal(sb)) {
    const my = (a.y + b.y) / 2;
    return withoutRepeats([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
  }
  if (horizontal(sa)) return withoutRepeats([a, { x: b.x, y: a.y }, b]);
  return withoutRepeats([a, { x: a.x, y: b.y }, b]);
}

function referencePoint(e: Endpoint, shapes: ShapeLookup): Point | null {
  if (!isAttached(e)) return { x: e.x, y: e.y };
  const s = shapes[e.shapeId];
  return s ? centerOf(shapeBounds(s)) : null;
}

/**
 * Polyline for a connector from start to end, derived from the current shape
 * geometry (so it follows shapes as they move). Null if an attached shape is gone.
 */
export function connectorPath(
  c: Pick<Connector, 'from' | 'to' | 'routing'>,
  shapes: ShapeLookup,
): Point[] | null {
  const fromRef = referencePoint(c.from, shapes);
  const toRef = referencePoint(c.to, shapes);
  if (!fromRef || !toRef) return null;

  const endOf = (e: Endpoint, other: Point): { p: Point; side: AnchorSide } => {
    if (!isAttached(e)) {
      return { p: { x: e.x, y: e.y }, side: sideFor(other.x - e.x, other.y - e.y) };
    }
    const s = shapes[e.shapeId] as ShapeGeometry;
    const b = shapeBounds(s);
    if (e.anchor !== 'auto') return { p: anchorPoint(b, e.anchor), side: e.anchor };
    const side = facingSide(b, other);
    if (c.routing === 'elbow') return { p: anchorPoint(b, side), side };
    return { p: clipToOutline(s, other), side };
  };

  const a = endOf(c.from, toRef);
  const b = endOf(c.to, fromRef);
  if (c.routing === 'straight') return [a.p, b.p];
  return elbowPath(a.p, a.side, b.p, b.side);
}

/** Triangle [tip, left, right] for an arrowhead at `tip` coming from `from`. */
export function arrowHead(tip: Point, from: Point, size = 12): [Point, Point, Point] | null {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  return [tip, { x: bx + px, y: by + py }, { x: bx - px, y: by - py }];
}
```

Note: `arrowHead({x:100,y:0}, {x:0,y:0}, 10)` → `u = (1, 0)`, base `(90, 0)`, perpendicular `(-0, 5)`: left `(90, 5)`, right `(90, -5)` — if the test sees `-0` vs `0` mismatches, normalize with `+ 0` on the perpendicular components.

- [ ] **Step 5: Export from the barrel** — add (sorted) to `packages/core/src/index.ts`:

```ts
export * from './geometry/connectors';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @relay/core && npm run typecheck -w @relay/core && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): connector types and geometry (anchors, outline clipping, elbow routing, arrowheads)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Connector commands, snapshots, normalization, convergence

**Files:**
- Modify: `packages/core/src/commands/types.ts`, `packages/core/src/commands/apply.ts`, `packages/core/src/schema/snapshot.ts`, `packages/core/src/schema/normalize.ts`
- Test: `packages/core/test/commands.test.ts`, `packages/core/test/schema.test.ts`, `packages/core/test/convergence.test.ts`

**Interfaces:**
- Consumes: `Connector`, `Endpoint`, `Routing` (Task 1); `getRoots`, `compareZ`, `readShape`.
- Produces:
  - `type NewConnector = Omit<Connector, 'z'> & { z?: string }`
  - `Command` gains `{ type: 'Connect'; connector: NewConnector }` (no-op if the id exists; z defaults above the top connector) and `{ type: 'SetRouting'; id: string; routing: Routing }`
  - `DeleteShapes` now also deletes any listed id that is a connector (so a selection mixing shapes and connectors deletes both)
  - `readConnector(id: string, m: Y.Map<unknown>): Connector | null` (null if an endpoint is malformed; routing defaults `straight`, head defaults `arrow`)
  - `normalizeConnectors(raw: Readonly<Record<string, Connector>>, shapes: Readonly<Record<string, Shape>>): { connectors: Record<string, Connector>; connectorOrder: string[] }` (drops connectors with a missing attached shape; keeps object identity; orders by z then id)

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/commands.test.ts` (inside `describe('applyCommand', ...)`; add `readConnector` to the import from `'../src'`):

```ts
  it('Connect stores a connector once, above existing ones', () => {
    const doc = new Y.Doc();
    const base = {
      from: { shapeId: 'a', anchor: 'auto' as const },
      to: { x: 10, y: 20 },
      routing: 'straight' as const,
      head: 'arrow' as const,
      createdBy: 'u1',
    };
    applyCommand(doc, { type: 'Connect', connector: { id: 'k1', ...base } });
    applyCommand(doc, { type: 'Connect', connector: { id: 'k2', ...base } });
    applyCommand(doc, { type: 'Connect', connector: { id: 'k1', ...base, routing: 'elbow' } });
    const { connectors } = getRoots(doc);
    const k1 = readConnector('k1', connectors.get('k1') as Y.Map<unknown>);
    const k2 = readConnector('k2', connectors.get('k2') as Y.Map<unknown>);
    expect(k1).toMatchObject({ from: { shapeId: 'a', anchor: 'auto' }, to: { x: 10, y: 20 }, routing: 'straight', head: 'arrow' });
    expect((k2?.z ?? '') > (k1?.z ?? '')).toBe(true);
  });

  it('SetRouting switches a connector between straight and elbow', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'k1',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    applyCommand(doc, { type: 'SetRouting', id: 'k1', routing: 'elbow' });
    applyCommand(doc, { type: 'SetRouting', id: 'gone', routing: 'elbow' });
    expect(getRoots(doc).connectors.get('k1')?.get('routing')).toBe('elbow');
    expect(getRoots(doc).connectors.has('gone')).toBe(false);
  });

  it('DeleteShapes also deletes listed connectors', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'k1',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['k1'] });
    expect(getRoots(doc).connectors.has('k1')).toBe(false);
  });
```

Append to `packages/core/test/schema.test.ts` (add `normalizeConnectors`, `readConnector`, `type Connector` to the import):

```ts
describe('connectors', () => {
  const connector = (id: string, partial: Partial<Connector> = {}): Connector => ({
    id,
    from: { shapeId: 'a', anchor: 'auto' },
    to: { shapeId: 'b', anchor: 'e' },
    routing: 'straight',
    head: 'arrow',
    z: 'a0',
    createdBy: 'u',
    ...partial,
  });

  it('readConnector validates endpoints and defaults routing and head', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).connectors.set('k', m);
    doc.transact(() => {
      m.set('from', { shapeId: 'a', anchor: 'auto' });
      m.set('to', { x: 5, y: 6 });
      m.set('routing', 'zigzag');
    });
    expect(readConnector('k', m)).toEqual({
      id: 'k',
      from: { shapeId: 'a', anchor: 'auto' },
      to: { x: 5, y: 6 },
      routing: 'straight',
      head: 'arrow',
      z: 'a0',
      createdBy: 'unknown',
    });
    m.set('to', { shapeId: 'b', anchor: 'middle' });
    expect(readConnector('k', m)).toBeNull();
  });

  it('normalizeConnectors drops connectors whose shapes are gone and orders by z', () => {
    const shapes = { a: shape({ id: 'a' }), b: shape({ id: 'b' }) };
    const keep = connector('keep', { z: 'a2' });
    const first = connector('first', { z: 'a1', to: { x: 0, y: 0 } });
    const raw = { keep, first, orphan: connector('orphan', { to: { shapeId: 'gone', anchor: 'auto' } }) };
    const { connectors, connectorOrder } = normalizeConnectors(raw, shapes);
    expect(connectorOrder).toEqual(['first', 'keep']);
    expect(connectors.keep).toBe(keep);
    expect(connectors.orphan).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @relay/core -- commands schema`
Expected: FAIL — `Connect` is not a command type / `readConnector` is not exported.

- [ ] **Step 3: Commands**

In `packages/core/src/commands/types.ts`:

```ts
import type { Connector, Routing, Shape } from '../schema/types';

export type NewShape = Omit<Shape, 'z'> & { z?: string };
export type NewConnector = Omit<Connector, 'z'> & { z?: string };
```

and add to the `Command` union:

```ts
  | { type: 'Connect'; connector: NewConnector }
  | { type: 'SetRouting'; id: string; routing: Routing }
```

In `packages/core/src/commands/apply.ts`:

1. Generalize the z helper: add

```ts
function topKey(map: Y.Map<Y.Map<unknown>>): string | null {
  let max: string | null = null;
  for (const m of map.values()) {
    const z = m.get('z');
    if (typeof z === 'string' && (max === null || z > max)) max = z;
  }
  return max;
}
```

and make `topZ(doc)` return `topKey(getRoots(doc).shapes)` (keep `topZ` exported with the same signature).

2. In `DeleteShapes`, after deleting shapes, also delete connectors whose id is listed:

```ts
      for (const id of ids) if (connectors.has(id)) connectors.delete(id);
```

(place it before the loop that collects connectors attached to deleted shapes).

3. Add the cases:

```ts
    case 'Connect': {
      const { z, ...fields } = cmd.connector;
      if (connectors.has(fields.id)) return;
      const m = new Y.Map<unknown>();
      m.set('from', fields.from);
      m.set('to', fields.to);
      m.set('routing', fields.routing);
      m.set('head', fields.head);
      m.set('createdBy', fields.createdBy);
      m.set('z', z ?? keyAbove(topKey(connectors)));
      connectors.set(fields.id, m);
      return;
    }
    case 'SetRouting': {
      connectors.get(cmd.id)?.set('routing', cmd.routing);
      return;
    }
```

- [ ] **Step 4: Snapshot + normalization**

In `packages/core/src/schema/snapshot.ts` add (import `Connector`, `Endpoint` types):

```ts
const ANCHORS = ['n', 's', 'e', 'w', 'auto'] as const;

function readEndpoint(v: unknown): Endpoint | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.shapeId === 'string') {
    const anchor = o.anchor;
    if (typeof anchor !== 'string' || !(ANCHORS as readonly string[]).includes(anchor)) return null;
    return { shapeId: o.shapeId, anchor: anchor as (typeof ANCHORS)[number] };
  }
  if (typeof o.x === 'number' && Number.isFinite(o.x) && typeof o.y === 'number' && Number.isFinite(o.y)) {
    return { x: o.x, y: o.y };
  }
  return null;
}

/** Immutable snapshot of one connector, or null if an endpoint is malformed. */
export function readConnector(id: string, m: Y.Map<unknown>): Connector | null {
  const from = readEndpoint(m.get('from'));
  const to = readEndpoint(m.get('to'));
  if (!from || !to) return null;
  return {
    id,
    from,
    to,
    routing: m.get('routing') === 'elbow' ? 'elbow' : 'straight',
    head: m.get('head') === 'none' ? 'none' : 'arrow',
    z: str(m.get('z')) ?? 'a0',
    createdBy: str(m.get('createdBy')) ?? 'unknown',
  };
}
```

In `packages/core/src/schema/normalize.ts` add (import `Connector`):

```ts
export interface NormalizedConnectors {
  connectors: Record<string, Connector>;
  connectorOrder: string[];
}

/** Drops connectors whose attached shape no longer exists (connect-while-delete races). */
export function normalizeConnectors(
  raw: Readonly<Record<string, Connector>>,
  shapes: Readonly<Record<string, Shape>>,
): NormalizedConnectors {
  const live = (e: Connector['from']) => !('shapeId' in e) || shapes[e.shapeId] !== undefined;
  const connectors: Record<string, Connector> = {};
  for (const c of Object.values(raw)) if (live(c.from) && live(c.to)) connectors[c.id] = c;
  const connectorOrder = Object.values(connectors)
    .sort(compareZ)
    .map((c) => c.id);
  return { connectors, connectorOrder };
}
```

(`compareZ` takes `Pick<Shape,'z'|'id'>`; a `Connector` satisfies it structurally.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- commands schema`
Expected: PASS.

- [ ] **Step 6: Fuzz connectors in the convergence test**

Edit `packages/core/test/convergence.test.ts`:
1. Import `normalizeConnectors`, `readConnector`, `type Connector`.
2. Add to `Step`: `| { kind: 'connect'; r: number; a: number; b: number; elbow: boolean }` and to `stepArb`:

```ts
  fc.record({
    kind: fc.constant('connect' as const),
    r: replica,
    a: fc.nat(),
    b: fc.nat(),
    elbow: fc.boolean(),
  }),
```

3. In `run`, handle it before `pickId` (it needs two ids):

```ts
    if (s.kind === 'connect') {
      const ids = [...getRoots(doc).shapes.keys()].sort();
      const a = ids[s.a % Math.max(1, ids.length)];
      const b = ids[s.b % Math.max(1, ids.length)];
      if (a && b && a !== b) {
        applyCommand(
          doc,
          {
            type: 'Connect',
            connector: {
              id: `k${s.r}-${n++}`,
              from: { shapeId: a, anchor: 'auto' },
              to: { shapeId: b, anchor: 'auto' },
              routing: s.elbow ? 'elbow' : 'straight',
              head: 'arrow',
              createdBy: `u${s.r}`,
            },
          },
          LOCAL_ORIGIN,
        );
      }
      continue;
    }
```

4. In the main property, after the shapes equality check, also assert connector convergence and the normalization invariant:

```ts
          const conns = net.docs.map((d) => getRoots(d).connectors.toJSON());
          for (const json of conns.slice(1)) expect(json).toEqual(conns[0]);
          for (const d of net.docs) {
            const raw: Record<string, Connector> = {};
            for (const [id, m] of getRoots(d).connectors.entries()) {
              const c = readConnector(id, m);
              if (c) raw[id] = c;
            }
            const { shapes } = snapshot(d);
            const { connectors } = normalizeConnectors(raw, shapes);
            for (const c of Object.values(connectors)) {
              for (const end of [c.from, c.to]) {
                if ('shapeId' in end) expect(shapes[end.shapeId]).toBeDefined();
              }
            }
          }
```

Run: `RELAY_FC_RUNS=2000 npm test -w @relay/core -- convergence`
Expected: PASS. Never weaken assertions; fix root causes.

- [ ] **Step 7: Full core check and commit**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`
Expected: green (the web workspace still compiles; it does not read connectors yet).

```bash
git add packages/core
git commit -m "feat(core): Connect/SetRouting commands, connector snapshots and orphan normalization

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frames — columns, geometry, reparenting commands, normalization

**Files:**
- Modify: `packages/core/src/schema/types.ts`, `packages/core/src/schema/defaults.ts`, `packages/core/src/schema/snapshot.ts`, `packages/core/src/schema/normalize.ts`, `packages/core/src/commands/types.ts`, `packages/core/src/commands/apply.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/geometry/frames.ts`
- Test: `packages/core/test/frames.test.ts` (new), `packages/core/test/schema.test.ts`, `packages/core/test/convergence.test.ts`

**Interfaces:**
- Consumes: `Shape`, `Rect`, `Point`, `compareZ`, `containsPoint`, `getRoots`.
- Produces:
  - `interface FrameColumn { id: string; title: string }`; `Shape.columns?: FrameColumn[]` (frames only); `TEXT_TYPES` now includes `'frame'` (the frame title is its `Y.Text`)
  - `DEFAULT_SIZE.frame = { w: 720, h: 440 }`; `DEFAULT_COLUMNS: readonly string[] = ['Went well', 'To improve', 'Actions']`
  - `FRAME_TITLE_H = 36`, `COLUMN_HEADER_H = 28`
  - `interface ColumnRect extends Rect { id: string; title: string }`; `frameColumns(f: Pick<Shape,'x'|'y'|'w'|'h'|'columns'>): ColumnRect[]` (equal-width columns under the title band)
  - `dropTarget(shapes, p: Point, exclude: ReadonlySet<string>): { parentId: string; columnId: string | null } | null` (topmost frame by z containing `p`)
  - `columnCounts(shapes, frameId: string): Record<string, number>`
  - `childrenOf(shapes, frameId: string): string[]` (sorted)
  - `rectContains(outer: Rect, inner: Rect): boolean`
  - `Command` gains `{ type: 'Reparent'; moves: { id: string; parentId: string | null; columnId: string | null }[] }` and `{ type: 'RenameColumn'; frameId: string; columnId: string; title: string }`
  - `CreateShape` stores `columns` for frames as a `Y.Array<FrameColumn>`; `readShape` reads them (deduplicated by id, first wins)
  - `normalizeShapes`: frames never keep `parentId`/`columnId`; a child whose `columnId` is not a column of its parent frame keeps the parent but loses the `columnId`

- [ ] **Step 1: Write the failing test `packages/core/test/frames.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  childrenOf,
  COLUMN_HEADER_H,
  columnCounts,
  DEFAULT_STYLE,
  dropTarget,
  FRAME_TITLE_H,
  frameColumns,
  getRoots,
  normalizeShapes,
  readShape,
  rectContains,
  type Shape,
} from '../src';

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    style: DEFAULT_STYLE.sticky,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
    ...partial,
  };
}

const columns = [
  { id: 'c1', title: 'Went well' },
  { id: 'c2', title: 'To improve' },
  { id: 'c3', title: 'Actions' },
];
const frame = shape('f1', { type: 'frame', x: 0, y: 0, w: 600, h: 400, z: 'a0', columns });

describe('frame geometry', () => {
  it('constants', () => {
    expect(FRAME_TITLE_H).toBe(36);
    expect(COLUMN_HEADER_H).toBe(28);
  });

  it('frameColumns splits the body under the title band equally', () => {
    expect(frameColumns(frame)).toEqual([
      { id: 'c1', title: 'Went well', x: 0, y: 36, w: 200, h: 364 },
      { id: 'c2', title: 'To improve', x: 200, y: 36, w: 200, h: 364 },
      { id: 'c3', title: 'Actions', x: 400, y: 36, w: 200, h: 364 },
    ]);
    expect(frameColumns({ ...frame, columns: undefined })).toEqual([]);
  });

  it('dropTarget finds the topmost frame and its column', () => {
    const upper = shape('f2', { type: 'frame', x: 100, y: 100, w: 300, h: 300, z: 'a5', columns: [{ id: 'x', title: 'X' }] });
    const shapes = { f1: frame, f2: upper };
    expect(dropTarget(shapes, { x: 50, y: 100 }, new Set())).toEqual({ parentId: 'f1', columnId: 'c1' });
    expect(dropTarget(shapes, { x: 200, y: 200 }, new Set())).toEqual({ parentId: 'f2', columnId: 'x' });
    expect(dropTarget(shapes, { x: 200, y: 200 }, new Set(['f2']))).toEqual({ parentId: 'f1', columnId: 'c2' });
    expect(dropTarget(shapes, { x: 50, y: 10 }, new Set())).toEqual({ parentId: 'f1', columnId: null });
    expect(dropTarget(shapes, { x: 900, y: 900 }, new Set())).toBeNull();
  });

  it('columnCounts and childrenOf are derived from parentId/columnId', () => {
    const shapes = {
      f1: frame,
      a: shape('a', { parentId: 'f1', columnId: 'c1' }),
      b: shape('b', { parentId: 'f1', columnId: 'c1' }),
      c: shape('c', { parentId: 'f1', columnId: 'c3' }),
      d: shape('d', { parentId: 'f1' }),
      e: shape('e', {}),
    };
    expect(columnCounts(shapes, 'f1')).toEqual({ c1: 2, c3: 1 });
    expect(childrenOf(shapes, 'f1')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rectContains requires full containment', () => {
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 6, h: 1 })).toBe(false);
  });
});

describe('frame commands and snapshots', () => {
  const newFrame = {
    id: 'f1',
    type: 'frame' as const,
    x: 0,
    y: 0,
    w: 600,
    h: 400,
    style: DEFAULT_STYLE.frame,
    text: 'Sprint 14 retro',
    columns,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
  };
  const read = (doc: Y.Doc, id: string) => {
    const m = getRoots(doc).shapes.get(id);
    return m ? readShape(id, m) : null;
  };

  it('CreateShape stores frame columns as a Y.Array and the title as Y.Text', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: newFrame });
    const m = getRoots(doc).shapes.get('f1');
    expect(m?.get('columns')).toBeInstanceOf(Y.Array);
    expect(m?.get('text')).toBeInstanceOf(Y.Text);
    expect(read(doc, 'f1')).toMatchObject({ type: 'frame', text: 'Sprint 14 retro', columns });
  });

  it('RenameColumn renames in place; Reparent sets and clears parents', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: newFrame });
    applyCommand(doc, { type: 'RenameColumn', frameId: 'f1', columnId: 'c2', title: 'Blockers' });
    expect(read(doc, 'f1')?.columns?.map((c) => c.title)).toEqual(['Went well', 'Blockers', 'Actions']);
    applyCommand(doc, { type: 'CreateShape', shape: { ...newFrame, id: 's1', type: 'sticky', style: DEFAULT_STYLE.sticky, columns: undefined } });
    applyCommand(doc, { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c3' }] });
    expect(read(doc, 's1')).toMatchObject({ parentId: 'f1', columnId: 'c3' });
    applyCommand(doc, { type: 'Reparent', moves: [{ id: 's1', parentId: null, columnId: null }] });
    expect(read(doc, 's1')?.parentId).toBeUndefined();
    expect(read(doc, 's1')?.columnId).toBeUndefined();
  });

  it('concurrent renames of one column converge without duplicate columns', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyCommand(a, { type: 'CreateShape', shape: newFrame });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyCommand(a, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Wins' });
    applyCommand(b, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Good' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ca = read(a, 'f1')?.columns ?? [];
    expect(ca).toHaveLength(3);
    expect(read(b, 'f1')?.columns).toEqual(ca);
  });
});

describe('frame normalization', () => {
  it('frames never nest and unknown columns are dropped', () => {
    const raw = {
      f1: frame,
      f2: shape('f2', { type: 'frame', parentId: 'f1', columnId: 'c1' }),
      ok: shape('ok', { parentId: 'f1', columnId: 'c2' }),
      stray: shape('stray', { parentId: 'f1', columnId: 'nope' }),
    };
    const { shapes } = normalizeShapes(raw);
    expect(shapes.f2?.parentId).toBeUndefined();
    expect(shapes.ok).toBe(raw.ok);
    expect(shapes.stray?.parentId).toBe('f1');
    expect(shapes.stray?.columnId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @relay/core -- frames`
Expected: FAIL — missing exports.

- [ ] **Step 3: Types and defaults**

In `packages/core/src/schema/types.ts`: add `'frame'` to `TEXT_TYPES`; add

```ts
export interface FrameColumn {
  id: string;
  title: string;
}
```

and to `Shape` add `columns?: FrameColumn[];` (frames only, after `lang?`).

In `packages/core/src/schema/defaults.ts`: add `frame: { w: 720, h: 440 }` to `DEFAULT_SIZE` (extend its key type with `'frame'`) and

```ts
/** Default columns of a new frame (retro-style). */
export const DEFAULT_COLUMNS: readonly string[] = ['Went well', 'To improve', 'Actions'];
```

- [ ] **Step 4: Implement `packages/core/src/geometry/frames.ts`**

```ts
import { compareZ } from '../schema/normalize';
import type { FrameColumn, Point, Rect, Shape } from '../schema/types';
import { containsPoint } from './rect';

/** Height of a frame's title band (its grab handle). */
export const FRAME_TITLE_H = 36;
/** Height of a column header strip under the title band. */
export const COLUMN_HEADER_H = 28;

export interface ColumnRect extends Rect {
  id: string;
  title: string;
}

type Shapes = Readonly<Record<string, Shape>>;

/** Equal-width columns filling the frame body under the title band. */
export function frameColumns(f: Pick<Shape, 'x' | 'y' | 'w' | 'h' | 'columns'>): ColumnRect[] {
  const cols: FrameColumn[] = f.columns ?? [];
  if (cols.length === 0) return [];
  const w = f.w / cols.length;
  const h = Math.max(0, f.h - FRAME_TITLE_H);
  return cols.map((c, i) => ({ id: c.id, title: c.title, x: f.x + i * w, y: f.y + FRAME_TITLE_H, w, h }));
}

/** Topmost frame (by z) containing `p`, and the column under `p` if any. */
export function dropTarget(
  shapes: Shapes,
  p: Point,
  exclude: ReadonlySet<string>,
): { parentId: string; columnId: string | null } | null {
  const frames = Object.values(shapes)
    .filter((s) => s.type === 'frame' && !exclude.has(s.id))
    .sort(compareZ)
    .reverse();
  for (const f of frames) {
    if (!containsPoint(f, p)) continue;
    const column = frameColumns(f).find((c) => containsPoint(c, p));
    return { parentId: f.id, columnId: column?.id ?? null };
  }
  return null;
}

/** Number of children per column (derived, never stored). */
export function columnCounts(shapes: Shapes, frameId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of Object.values(shapes)) {
    if (s.parentId === frameId && s.columnId) counts[s.columnId] = (counts[s.columnId] ?? 0) + 1;
  }
  return counts;
}

export function childrenOf(shapes: Shapes, frameId: string): string[] {
  return Object.values(shapes)
    .filter((s) => s.parentId === frameId)
    .map((s) => s.id)
    .sort();
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}
```

Add `export * from './geometry/frames';` to the barrel (sorted).

- [ ] **Step 5: Snapshot, normalization and commands**

`packages/core/src/schema/snapshot.ts`, inside `readShape` before `return shape;`:

```ts
  const cols = m.get('columns');
  if (cols instanceof Y.Array) {
    const seen = new Set<string>();
    shape.columns = cols.toArray().flatMap((c: unknown) => {
      if (!c || typeof c !== 'object') return [];
      const o = c as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.title !== 'string' || seen.has(o.id)) return [];
      seen.add(o.id);
      return [{ id: o.id, title: o.title }];
    });
  }
```

`packages/core/src/schema/normalize.ts`, replace the loop body of `normalizeShapes` with:

```ts
  for (const s of Object.values(raw)) {
    const parent = s.parentId !== undefined ? raw[s.parentId] : undefined;
    if (s.parentId !== undefined && (s.type === 'frame' || parent?.type !== 'frame')) {
      const { parentId: _parent, columnId: _column, ...rest } = s;
      shapes[s.id] = rest;
    } else if (s.columnId !== undefined && !parent?.columns?.some((c) => c.id === s.columnId)) {
      const { columnId: _column, ...rest } = s;
      shapes[s.id] = rest;
    } else {
      shapes[s.id] = s;
    }
  }
```

and update its doc comment to mention: frames never nest; a `columnId` that is not a column of the parent frame is dropped.

`packages/core/src/commands/types.ts` — add to the union:

```ts
  | {
      type: 'Reparent';
      moves: { id: string; parentId: string | null; columnId: string | null }[];
    }
  | { type: 'RenameColumn'; frameId: string; columnId: string; title: string }
```

`packages/core/src/commands/apply.ts`:
1. In `CreateShape`, destructure `columns` too: `const { text, z, columns, ...fields } = cmd.shape;` and after the text line add:

```ts
      if (fields.type === 'frame') {
        const arr = new Y.Array<FrameColumn>();
        arr.push((columns ?? []).map((c) => ({ id: c.id, title: c.title })));
        m.set('columns', arr);
      }
```

(import `type FrameColumn`).
2. Add the cases:

```ts
    case 'Reparent': {
      for (const { id, parentId, columnId } of cmd.moves) {
        const m = shapes.get(id);
        if (!m) continue;
        if (parentId) m.set('parentId', parentId);
        else m.delete('parentId');
        if (columnId) m.set('columnId', columnId);
        else m.delete('columnId');
      }
      return;
    }
    case 'RenameColumn': {
      const cols = shapes.get(cmd.frameId)?.get('columns');
      if (!(cols instanceof Y.Array)) return;
      const index = cols
        .toArray()
        .findIndex((c: unknown) => (c as { id?: unknown } | null)?.id === cmd.columnId);
      if (index < 0) return;
      cols.delete(index, 1);
      cols.insert(index, [{ id: cmd.columnId, title: cmd.title }]);
      return;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @relay/core`
Expected: PASS (the existing schema test "treats missing or non-frame parents as root" still passes: it only asserts `parentId` for the valid child).

- [ ] **Step 7: Fuzz reparenting in the convergence test**

Edit `packages/core/test/convergence.test.ts`:
1. Add `'frame'` to the create step's `type` options (`fc.constantFrom('rect', 'sticky', 'text', 'frame')` as consts) and, when creating a frame, pass `columns: [{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }]` (use `DEFAULT_STYLE[s.type]` as now).
2. Add `| { kind: 'reparent'; r: number; pick: number; parent: number; column: boolean }` with arbitrary `fc.record({ kind: fc.constant('reparent' as const), r: replica, pick: fc.nat(), parent: fc.nat(), column: fc.boolean() })`, handled with the other per-shape steps:

```ts
    if (s.kind === 'reparent') {
      const parentId = pickId(doc, s.parent) ?? null;
      applyCommand(
        doc,
        {
          type: 'Reparent',
          moves: [{ id, parentId: parentId === id ? null : parentId, columnId: s.column ? 'c1' : null }],
        },
        LOCAL_ORIGIN,
      );
    }
```

3. In the main property add the invariant, per replica: every normalized shape with a `parentId` points to an existing frame, and no frame has a `parentId`:

```ts
          for (const snap of snaps) {
            for (const sh of Object.values(snap.shapes)) {
              if (sh.type === 'frame') expect(sh.parentId).toBeUndefined();
              if (sh.parentId) expect(snap.shapes[sh.parentId]?.type).toBe('frame');
            }
          }
```

Run: `RELAY_FC_RUNS=2000 npm test -w @relay/core -- convergence`
Expected: PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: green across workspaces.

```bash
git add packages/core
git commit -m "feat(core): frames with columns — geometry, Reparent/RenameColumn, frame-aware normalization

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tool FSM — connector and frame tools, reparenting, column editing

**Files:**
- Replace: `packages/core/src/tools/machine.ts`
- Test: `packages/core/test/tools-structure.test.ts` (new; `packages/core/test/tools.test.ts` must keep passing unchanged)

**Interfaces:**
- Consumes: Tasks 1–3 (`clipToOutline`, `dropTarget`, `childrenOf`, `rectContains`, `DEFAULT_COLUMNS`, `NewConnector`, `Connector`, `Endpoint`); `shapeBounds`, `centerOf`, `resizeGeometry`, `shapesInRect`, `MIN_SIZE`.
- Produces:
  - `ToolId` = `'select' | 'rect' | 'ellipse' | 'line' | 'connector' | 'text' | 'sticky' | 'code' | 'frame'`
  - `PointerInfo` gains optional `connectorId?: string` and `column?: { frameId: string; columnId: string }`
  - `ToolEvent` gains `{ type: 'toggleRouting' }`
  - `ToolContext` gains optional `connectors?: Readonly<Record<string, Connector>>`
  - `Effect` gains `{ type: 'editColumn'; frameId: string; columnId: string }`
  - New mode `connecting` (tool `connector`)
- Behaviour contract:
  - **Connector tool:** press on a shape starts an attached end (`anchor: 'auto'`), elsewhere a free end; moves emit a `line` preview from the start (clipped to the start shape's outline toward the pointer); releasing on another shape attaches the end, elsewhere leaves a free end; releasing on the start shape, or a free→free drag shorter than `MIN_DRAW`, creates nothing (tool stays `connector`). Success emits `[preview null, command Connect, endGesture]`, selects the connector and returns to `select`. New connectors are `straight` with an `arrow` head.
  - **Select:** a press on a connector (with no shape or handle hit) selects it (Shift toggles), no drag. `toggleRouting` flips `straight`/`elbow` for every selected connector as one gesture. `deleteSelection` already deletes connector ids (Task 2).
  - **Frame tool:** draws like a rectangle (rect preview), creates a frame with `DEFAULT_COLUMNS` (fresh column ids from `ctx.newId()`), default size on a click.
  - **Creation inside a frame:** any new non-frame shape whose centre falls in a frame gets that `parentId` (and `columnId` if it lands in a column).
  - **Dragging:** dragging (or nudging) a frame also moves its children; on release, every moved non-frame shape that does not travel with its frame is reparented to the frame/column under its centre (or unparented) when that differs from its current parent/column, emitting `[command MoveShapes, command Reparent?, overlay null, endGesture]`.
  - **Marquee:** frames are selected only when fully inside the marquee.
  - **Double-click:** on a column header emits `editColumn` and selects the frame; on a frame title band opens the text editor (frames are text-capable).

- [ ] **Step 1: Write the failing test `packages/core/test/tools-structure.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  type Connector,
  DEFAULT_COLUMNS,
  DEFAULT_STYLE,
  type Effect,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolId,
  type ToolState,
} from '../src';

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    z: 'a1',
    style: DEFAULT_STYLE.rect,
    text: '',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 0,
    ...partial,
  };
}

const f1 = shape('f1', {
  type: 'frame',
  x: 0,
  y: 0,
  w: 600,
  h: 400,
  z: 'a0',
  style: DEFAULT_STYLE.frame,
  columns: [
    { id: 'c1', title: 'Went well' },
    { id: 'c2', title: 'To improve' },
    { id: 'c3', title: 'Actions' },
  ],
});
const s1 = shape('s1', { type: 'sticky', x: 20, y: 60, w: 160, h: 120, parentId: 'f1', columnId: 'c1' });
const a = shape('a', { x: 1000, y: 0 }); // centre (1050, 25)
const b = shape('b', { x: 1300, y: 200 }); // centre (1350, 225)

const k1: Connector = {
  id: 'k1',
  from: { shapeId: 'a', anchor: 'auto' },
  to: { shapeId: 'b', anchor: 'auto' },
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

function ctx(): ToolContext {
  let n = 0;
  return {
    shapes: { f1, s1, a, b },
    connectors: { k1 },
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => `new${++n}`,
    now: () => 1000,
  };
}

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
  world: { x, y },
  shift: false,
  hitId: null,
  ...extra,
});
const idle = (tool: ToolId, selection: string[]): ToolState => ({ mode: 'idle', tool, selection });
const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('connector tool', () => {
  it('connects two shapes with a clipped preview while dragging', () => {
    const c = ctx();
    let r = step(idle('connector', []), { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) }, c);
    expect(r.state.mode).toBe('connecting');
    r = step(r.state, { type: 'pointerMove', p: at(1350, 225) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'line', rect: { x: 1087.5, y: 50, w: 262.5, h: 175 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(1350, 225, { hitId: 'b' }) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: null },
      {
        type: 'command',
        command: {
          type: 'Connect',
          connector: {
            id: 'new1',
            from: { shapeId: 'a', anchor: 'auto' },
            to: { shapeId: 'b', anchor: 'auto' },
            routing: 'straight',
            head: 'arrow',
            createdBy: 'u1',
          },
        },
        throttle: false,
      },
      { type: 'endGesture' },
    ]);
    expect(r.state).toEqual(idle('select', ['new1']));
  });

  it('leaves a free end when released on empty canvas', () => {
    const c = ctx();
    const down = step(idle('connector', []), { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(800, 500) }, c);
    expect(commands(up.effects)[0]).toMatchObject({
      type: 'Connect',
      connector: { from: { shapeId: 'a', anchor: 'auto' }, to: { x: 800, y: 500 } },
    });
  });

  it('creates nothing for a release on the start shape or a tiny free drag', () => {
    const c = ctx();
    const onSelf = step(
      step(idle('connector', []), { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) }, c).state,
      { type: 'pointerUp', p: at(1060, 30, { hitId: 'a' }) },
      c,
    );
    expect(commands(onSelf.effects)).toEqual([]);
    expect(onSelf.state).toEqual(idle('connector', []));
    const tiny = step(
      step(idle('connector', []), { type: 'pointerDown', p: at(700, 700) }, c).state,
      { type: 'pointerUp', p: at(701, 700) },
      c,
    );
    expect(commands(tiny.effects)).toEqual([]);
  });
});

describe('connector selection and routing', () => {
  it('selects a connector without starting a drag or marquee', () => {
    const r = step(idle('select', []), { type: 'pointerDown', p: at(1200, 120, { connectorId: 'k1' }) }, ctx());
    expect(r.state).toEqual(idle('select', ['k1']));
  });

  it('toggleRouting flips the selected connectors as one gesture', () => {
    const r = step(idle('select', ['k1', 'a']), { type: 'toggleRouting' }, ctx());
    expect(r.effects).toEqual([
      { type: 'command', command: { type: 'SetRouting', id: 'k1', routing: 'elbow' }, throttle: false },
      { type: 'endGesture' },
    ]);
  });
});

describe('frames', () => {
  it('the frame tool creates a frame with the default columns', () => {
    const c = ctx();
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(2000, 0) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'rect', rect: { x: 2000, y: 0, w: 0, h: 0 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(2600, 400) }, c);
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: {
        id: 'new1',
        type: 'frame',
        x: 2000,
        y: 0,
        w: 600,
        h: 400,
        columns: DEFAULT_COLUMNS.map((title, i) => ({ id: `new${i + 2}`, title })),
      },
    });
  });

  it('new shapes created inside a frame column get that parent and column', () => {
    const r = step(idle('sticky', []), { type: 'pointerDown', p: at(300, 200) }, ctx());
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'sticky', parentId: 'f1', columnId: 'c2' },
    });
  });

  it('dragging a frame moves its children without reparenting them', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(10, 10, { hitId: 'f1' }) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, 10) }, c);
    expect(r.effects[0]).toEqual({
      type: 'overlay',
      rects: { f1: { x: 50, y: 0, w: 600, h: 400 }, s1: { x: 70, y: 60, w: 160, h: 120 } },
    });
    r = step(r.state, { type: 'pointerUp', p: at(60, 10) }, c);
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: {
          type: 'MoveShapes',
          moves: [
            { id: 'f1', x: 50, y: 0 },
            { id: 's1', x: 70, y: 60 },
          ],
        },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('dropping a sticky into another column reparents it', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(100, 100, { hitId: 's1' }) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(300, 100) }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 's1', x: 220, y: 60 }] },
      { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c2' }] },
    ]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('dropping a sticky outside every frame unparents it', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(100, 100, { hitId: 's1' }) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(900, 700) }, c);
    expect(commands(r.effects)[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 's1', parentId: null, columnId: null }],
    });
  });

  it('a marquee selects a frame only when it is fully inside', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(10, 50) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(190, 190) }, c);
    expect(r.state.selection).toEqual(['s1']);
    r = step(idle('select', []), { type: 'pointerDown', p: at(-10, -10) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(700, 500) }, c);
    expect(r.state.selection).toEqual(['f1', 's1']);
  });

  it('double-clicking a column header edits that column; the title band edits the frame title', () => {
    const header = step(
      idle('select', []),
      { type: 'doubleClick', p: at(250, 50, { hitId: 'f1', column: { frameId: 'f1', columnId: 'c2' } }) },
      ctx(),
    );
    expect(header.effects).toEqual([{ type: 'editColumn', frameId: 'f1', columnId: 'c2' }]);
    expect(header.state.selection).toEqual(['f1']);
    const title = step(idle('select', []), { type: 'doubleClick', p: at(250, 10, { hitId: 'f1' }) }, ctx());
    expect(title.effects).toEqual([{ type: 'editText', id: 'f1' }]);
  });

  it('nudging a frame moves its children too', () => {
    const r = step(idle('select', ['f1']), { type: 'nudge', dx: 1, dy: 0 }, ctx());
    expect(commands(r.effects)).toEqual([
      {
        type: 'MoveShapes',
        moves: [
          { id: 'f1', x: 1, y: 0 },
          { id: 's1', x: 21, y: 60 },
        ],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @relay/core -- tools-structure`
Expected: FAIL (unknown tools/fields; no connector/frame behaviour).

- [ ] **Step 3: Replace `packages/core/src/tools/machine.ts`**

Keep every existing behaviour from the current file (the F2a spec in `packages/core/test/tools.test.ts` must still pass unchanged) and add the F2b behaviour. Full file:

```ts
import type { Command, NewConnector, NewShape } from '../commands/types';
import { clipToOutline } from '../geometry/connectors';
import { childrenOf, dropTarget, rectContains } from '../geometry/frames';
import { centerOf, rectFromPoints } from '../geometry/rect';
import {
  type Handle,
  MIN_SIZE,
  resizeGeometry,
  shapeBounds,
  shapesInRect,
} from '../geometry/shapes';
import { DEFAULT_COLUMNS, DEFAULT_SIZE, DEFAULT_STYLE } from '../schema/defaults';
import {
  type Connector,
  type Endpoint,
  type Point,
  type Rect,
  type Shape,
  type ShapeType,
  TEXT_TYPES,
} from '../schema/types';

export type ToolId =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'connector'
  | 'text'
  | 'sticky'
  | 'code'
  | 'frame';
type DrawTool = 'rect' | 'ellipse' | 'line' | 'frame';
type ClickTool = 'text' | 'sticky' | 'code';

export interface PointerInfo {
  world: Point;
  shift: boolean;
  hitId: string | null;
  /** Resize handle under the pointer, if any (handles belong to the current selection). */
  handle?: Handle;
  /** Connector under the pointer (connectors render below shapes). */
  connectorId?: string;
  /** Frame column header under the pointer. */
  column?: { frameId: string; columnId: string };
}

export type ToolEvent =
  | { type: 'pointerDown'; p: PointerInfo }
  | { type: 'pointerMove'; p: PointerInfo }
  | { type: 'pointerUp'; p: PointerInfo }
  | { type: 'doubleClick'; p: PointerInfo }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'deleteSelection' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'toggleRouting' }
  | { type: 'cancel' };

type IdleState = { mode: 'idle'; tool: ToolId; selection: string[] };
type DraggingState = {
  mode: 'dragging';
  tool: 'select';
  selection: string[];
  origin: Point;
  starts: Record<string, Rect>;
  moved: boolean;
};
type ResizingState = {
  mode: 'resizing';
  tool: 'select';
  selection: string[];
  id: string;
  shapeType: ShapeType;
  handle: Handle;
  start: Rect;
  origin: Point;
  moved: boolean;
};
type DrawingState = {
  mode: 'drawing';
  tool: DrawTool;
  selection: string[];
  origin: Point;
  current: Point;
};
type MarqueeState = {
  mode: 'marquee';
  tool: 'select';
  selection: string[];
  /** Selection the marquee started from (non-empty only with Shift). */
  base: string[];
  origin: Point;
  moved: boolean;
};
type ConnectingState = {
  mode: 'connecting';
  tool: 'connector';
  selection: string[];
  from: Endpoint;
  origin: Point;
};

export type ToolState =
  | IdleState
  | DraggingState
  | ResizingState
  | DrawingState
  | MarqueeState
  | ConnectingState;

export type PreviewKind = 'rect' | 'ellipse' | 'line' | 'marquee';
/** For `line`, `rect` is the signed vector from the start point. */
export interface Preview {
  kind: PreviewKind;
  rect: Rect;
}

export type Effect =
  | { type: 'command'; command: Command; throttle: boolean }
  | { type: 'preview'; preview: Preview | null }
  /** Local-only geometry rendered every frame while commits to the doc are throttled. */
  | { type: 'overlay'; rects: Record<string, Rect> | null }
  | { type: 'editText'; id: string }
  | { type: 'editColumn'; frameId: string; columnId: string }
  | { type: 'endGesture' };

export interface ToolContext {
  shapes: Readonly<Record<string, Shape>>;
  connectors?: Readonly<Record<string, Connector>>;
  userId: string;
  userName: string;
  newId: () => string;
  now: () => number;
}

export interface StepResult {
  state: ToolState;
  effects: Effect[];
}

/** World-space distance a pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;
/** Smaller drawn shapes are treated as a click and get the default size. */
export const MIN_DRAW = 4;

export const initialToolState = (): ToolState => ({ mode: 'idle', tool: 'select', selection: [] });

const idle = (tool: ToolId, selection: string[]): IdleState => ({ mode: 'idle', tool, selection });
const none = (state: ToolState): StepResult => ({ state, effects: [] });
const command = (c: Command, throttle = false): Effect => ({
  type: 'command',
  command: c,
  throttle,
});
const overlay = (rects: Record<string, Rect> | null): Effect => ({ type: 'overlay', rects });
const preview = (p: Preview | null): Effect => ({ type: 'preview', preview: p });
const END: Effect = { type: 'endGesture' };

const geometryOf = (s: Shape): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });
const previewKind = (tool: DrawTool): PreviewKind => (tool === 'frame' ? 'rect' : tool);

function newShape(ctx: ToolContext, type: DrawTool | ClickTool, rect: Rect): NewShape {
  const shape: NewShape = {
    id: ctx.newId(),
    type,
    ...rect,
    style: DEFAULT_STYLE[type],
    text: '',
    createdBy: ctx.userId,
    authorName: ctx.userName,
    createdAt: ctx.now(),
  };
  if (type === 'frame') {
    shape.columns = DEFAULT_COLUMNS.map((title) => ({ id: ctx.newId(), title }));
    return shape;
  }
  const target = dropTarget(ctx.shapes, centerOf(shapeBounds({ type, ...rect })), new Set());
  if (target) {
    shape.parentId = target.parentId;
    if (target.columnId) shape.columnId = target.columnId;
  }
  return shape;
}

const pastThreshold = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_THRESHOLD;

/** The selection plus the children of any selected frame (they move together). */
function withChildren(selection: string[], ctx: ToolContext): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (ctx.shapes[id] && !ids.includes(id)) ids.push(id);
  };
  for (const id of selection) {
    add(id);
    if (ctx.shapes[id]?.type === 'frame') for (const child of childrenOf(ctx.shapes, id)) add(child);
  }
  return ids;
}

function movedRects(state: DraggingState, p: Point): Record<string, Rect> {
  const dx = p.x - state.origin.x;
  const dy = p.y - state.origin.y;
  const rects: Record<string, Rect> = {};
  for (const [id, s] of Object.entries(state.starts))
    rects[id] = { ...s, x: s.x + dx, y: s.y + dy };
  return rects;
}

const moveCommand = (rects: Record<string, Rect>): Command => ({
  type: 'MoveShapes',
  moves: Object.entries(rects).map(([id, r]) => ({ id, x: r.x, y: r.y })),
});

const resizeCommand = (id: string, r: Rect): Command => ({
  type: 'ResizeShapes',
  rects: [{ id, ...r }],
});

/** Parent/column changes for shapes dropped at `rects` (shapes travelling with their frame keep it). */
function reparentMoves(rects: Record<string, Rect>, ctx: ToolContext) {
  const moving = new Set(Object.keys(rects));
  const moves: { id: string; parentId: string | null; columnId: string | null }[] = [];
  for (const [id, r] of Object.entries(rects)) {
    const s = ctx.shapes[id];
    if (!s || s.type === 'frame') continue;
    if (s.parentId && moving.has(s.parentId)) continue;
    const target = dropTarget(ctx.shapes, centerOf(shapeBounds({ type: s.type, ...r })), moving);
    const parentId = target?.parentId ?? null;
    const columnId = target?.columnId ?? null;
    if (parentId === (s.parentId ?? null) && columnId === (s.columnId ?? null)) continue;
    moves.push({ id, parentId, columnId });
  }
  return moves;
}

function resized(state: ResizingState, p: PointerInfo): Rect {
  const delta = { x: p.world.x - state.origin.x, y: p.world.y - state.origin.y };
  return resizeGeometry(state.shapeType, state.start, state.handle, delta, p.shift);
}

/** Lines keep the signed start→end vector; boxes are normalized. */
function drawnRect(tool: DrawTool, origin: Point, p: Point): Rect {
  if (tool === 'line') return { x: origin.x, y: origin.y, w: p.x - origin.x, h: p.y - origin.y };
  return rectFromPoints(origin, p);
}

function marqueeSelection(state: MarqueeState, p: Point, ctx: ToolContext): string[] {
  const rect = rectFromPoints(state.origin, p);
  const hits = shapesInRect(ctx.shapes, rect).filter((id) => {
    const s = ctx.shapes[id];
    return s?.type !== 'frame' || rectContains(rect, shapeBounds(s));
  });
  return [...state.base, ...hits.filter((id) => !state.base.includes(id))];
}

function toggled(selection: string[], id: string, shift: boolean): string[] {
  if (!shift) return [id];
  return selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
}

/** Where a connector starts, seen from `toward`: the start shape's outline, or the free point. */
function connectorStart(from: Endpoint, toward: Point, ctx: ToolContext): Point {
  if ('shapeId' in from) {
    const s = ctx.shapes[from.shapeId];
    if (s) return clipToOutline(s, toward);
  }
  return 'x' in from ? { x: from.x, y: from.y } : toward;
}

function pointerDownIdle(state: IdleState, p: PointerInfo, ctx: ToolContext): StepResult {
  switch (state.tool) {
    case 'select': {
      const only = state.selection.length === 1 ? state.selection[0] : undefined;
      const target = only ? ctx.shapes[only] : undefined;
      if (p.handle && only && target) {
        return none({
          mode: 'resizing',
          tool: 'select',
          selection: state.selection,
          id: only,
          shapeType: target.type,
          handle: p.handle,
          start: geometryOf(target),
          origin: p.world,
          moved: false,
        });
      }
      const hit = p.hitId && ctx.shapes[p.hitId] ? p.hitId : null;
      if (!hit && p.connectorId) return none(idle('select', toggled(state.selection, p.connectorId, p.shift)));
      if (!hit) {
        const base = p.shift ? state.selection : [];
        return none({
          mode: 'marquee',
          tool: 'select',
          selection: base,
          base,
          origin: p.world,
          moved: false,
        });
      }
      let selection: string[];
      if (p.shift) {
        selection = toggled(state.selection, hit, true);
      } else {
        selection = state.selection.includes(hit) ? state.selection : [hit];
      }
      if (!selection.includes(hit)) return none(idle('select', selection));
      const starts: Record<string, Rect> = {};
      for (const id of withChildren(selection, ctx)) {
        const s = ctx.shapes[id];
        if (s) starts[id] = geometryOf(s);
      }
      return none({
        mode: 'dragging',
        tool: 'select',
        selection,
        origin: p.world,
        starts,
        moved: false,
      });
    }
    case 'connector': {
      const hit = p.hitId && ctx.shapes[p.hitId] ? p.hitId : null;
      const from: Endpoint = hit
        ? { shapeId: hit, anchor: 'auto' }
        : { x: p.world.x, y: p.world.y };
      return none({ mode: 'connecting', tool: 'connector', selection: [], from, origin: p.world });
    }
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'frame':
      return {
        state: {
          mode: 'drawing',
          tool: state.tool,
          selection: [],
          origin: p.world,
          current: p.world,
        },
        effects: [
          preview({ kind: previewKind(state.tool), rect: drawnRect(state.tool, p.world, p.world) }),
        ],
      };
    case 'sticky':
    case 'text':
    case 'code': {
      const size = DEFAULT_SIZE[state.tool];
      const shape = newShape(ctx, state.tool, {
        x: p.world.x - size.w / 2,
        y: p.world.y - size.h / 2,
        ...size,
      });
      return {
        state: idle('select', [shape.id]),
        effects: [command({ type: 'CreateShape', shape }), END, { type: 'editText', id: shape.id }],
      };
    }
  }
}

function stepIdle(state: IdleState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'setTool':
      return none(idle(event.tool, event.tool === 'select' ? state.selection : []));
    case 'deleteSelection':
      if (state.selection.length === 0) return none(state);
      return {
        state: idle(state.tool, []),
        effects: [command({ type: 'DeleteShapes', ids: state.selection }), END],
      };
    case 'nudge': {
      const moves = withChildren(state.selection, ctx).flatMap((id) => {
        const s = ctx.shapes[id];
        return s ? [{ id, x: s.x + event.dx, y: s.y + event.dy }] : [];
      });
      if (moves.length === 0) return none(state);
      return { state, effects: [command({ type: 'MoveShapes', moves }), END] };
    }
    case 'toggleRouting': {
      const flips = state.selection.flatMap((id) => {
        const c = ctx.connectors?.[id];
        return c
          ? [
              command({
                type: 'SetRouting',
                id,
                routing: c.routing === 'elbow' ? 'straight' : 'elbow',
              }),
            ]
          : [];
      });
      if (flips.length === 0) return none(state);
      return { state, effects: [...flips, END] };
    }
    case 'doubleClick': {
      const column = event.p.column;
      if (column) {
        return {
          state: idle('select', [column.frameId]),
          effects: [{ type: 'editColumn', frameId: column.frameId, columnId: column.columnId }],
        };
      }
      const shape = event.p.hitId ? ctx.shapes[event.p.hitId] : undefined;
      if (!shape || !TEXT_TYPES.has(shape.type)) return none(state);
      return { state: idle('select', [shape.id]), effects: [{ type: 'editText', id: shape.id }] };
    }
    case 'pointerDown':
      return pointerDownIdle(state, event.p, ctx);
    default:
      return none(state);
  }
}

function stepDragging(state: DraggingState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(state);
      const rects = movedRects(state, event.p.world);
      return {
        state: { ...state, moved: true },
        effects: [overlay(rects), command(moveCommand(rects), true)],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      const next = idle('select', state.selection);
      if (!moved) return none(next);
      const rects = movedRects(state, event.p.world);
      const reparent = reparentMoves(rects, ctx);
      return {
        state: next,
        effects: [
          command(moveCommand(rects)),
          ...(reparent.length > 0 ? [command({ type: 'Reparent', moves: reparent })] : []),
          overlay(null),
          END,
        ],
      };
    }
    case 'cancel': {
      const next = idle('select', state.selection);
      if (!state.moved) return none(next);
      return {
        state: next,
        effects: [command(moveCommand(movedRects(state, state.origin))), overlay(null), END],
      };
    }
    default:
      return none(state);
  }
}

function stepResizing(state: ResizingState, event: ToolEvent): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(state);
      const r = resized(state, event.p);
      return {
        state: { ...state, moved: true },
        effects: [overlay({ [state.id]: r }), command(resizeCommand(state.id, r), true)],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      const next = idle('select', state.selection);
      if (!moved) return none(next);
      return {
        state: next,
        effects: [command(resizeCommand(state.id, resized(state, event.p))), overlay(null), END],
      };
    }
    case 'cancel': {
      const next = idle('select', state.selection);
      if (!state.moved) return none(next);
      return {
        state: next,
        effects: [command(resizeCommand(state.id, state.start)), overlay(null), END],
      };
    }
    default:
      return none(state);
  }
}

function stepDrawing(state: DrawingState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'pointerMove':
      return {
        state: { ...state, current: event.p.world },
        effects: [
          preview({
            kind: previewKind(state.tool),
            rect: drawnRect(state.tool, state.origin, event.p.world),
          }),
        ],
      };
    case 'pointerUp': {
      let rect = drawnRect(state.tool, state.origin, event.p.world);
      if (state.tool === 'line') {
        if (Math.hypot(rect.w, rect.h) < MIN_DRAW) {
          rect = { x: state.origin.x, y: state.origin.y, ...DEFAULT_SIZE.line };
        }
      } else if (rect.w < MIN_DRAW && rect.h < MIN_DRAW) {
        rect = { x: state.origin.x, y: state.origin.y, ...DEFAULT_SIZE[state.tool] };
      } else {
        rect = { ...rect, w: Math.max(rect.w, MIN_SIZE), h: Math.max(rect.h, MIN_SIZE) };
      }
      const shape = newShape(ctx, state.tool, rect);
      return {
        state: idle('select', [shape.id]),
        effects: [preview(null), command({ type: 'CreateShape', shape }), END],
      };
    }
    case 'cancel':
      return { state: idle(state.tool, []), effects: [preview(null)] };
    default:
      return none(state);
  }
}

function stepMarquee(state: MarqueeState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(state);
      return {
        state: { ...state, moved: true, selection: marqueeSelection(state, event.p.world, ctx) },
        effects: [preview({ kind: 'marquee', rect: rectFromPoints(state.origin, event.p.world) })],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(idle('select', state.base));
      return {
        state: idle('select', marqueeSelection(state, event.p.world, ctx)),
        effects: [preview(null)],
      };
    }
    case 'cancel':
      return { state: idle('select', state.base), effects: [preview(null)] };
    default:
      return none(state);
  }
}

function stepConnecting(state: ConnectingState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const p = event.p.world;
      const a = connectorStart(state.from, p, ctx);
      return {
        state,
        effects: [preview({ kind: 'line', rect: { x: a.x, y: a.y, w: p.x - a.x, h: p.y - a.y } })],
      };
    }
    case 'pointerUp': {
      const p = event.p.world;
      const hit = event.p.hitId && ctx.shapes[event.p.hitId] ? event.p.hitId : null;
      const fromShape = 'shapeId' in state.from ? state.from.shapeId : null;
      const stay: StepResult = { state: idle('connector', []), effects: [preview(null)] };
      if (hit && hit === fromShape) return stay;
      const to: Endpoint = hit ? { shapeId: hit, anchor: 'auto' } : { x: p.x, y: p.y };
      const freeToFree = !fromShape && !hit;
      if (freeToFree && Math.hypot(p.x - state.origin.x, p.y - state.origin.y) < MIN_DRAW) return stay;
      const connector: NewConnector = {
        id: ctx.newId(),
        from: state.from,
        to,
        routing: 'straight',
        head: 'arrow',
        createdBy: ctx.userId,
      };
      return {
        state: idle('select', [connector.id]),
        effects: [preview(null), command({ type: 'Connect', connector }), END],
      };
    }
    case 'cancel':
      return { state: idle('connector', []), effects: [preview(null)] };
    default:
      return none(state);
  }
}

/** Pure tool reducer: (state, event) → (state, effects). */
export function step(state: ToolState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (state.mode) {
    case 'idle':
      return stepIdle(state, event, ctx);
    case 'dragging':
      return stepDragging(state, event, ctx);
    case 'resizing':
      return stepResizing(state, event);
    case 'drawing':
      return stepDrawing(state, event, ctx);
    case 'marquee':
      return stepMarquee(state, event, ctx);
    case 'connecting':
      return stepConnecting(state, event, ctx);
  }
}
```

Note on the free-end rule: "a free→free drag shorter than `MIN_DRAW` creates nothing" — a drag from a shape to a nearby free point still creates a connector.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`
Expected: PASS — `tools-structure.test.ts` and the unchanged `tools.test.ts`; the web workspace still compiles (the new effect `editColumn` is simply not handled yet).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): connector and frame tools, connector routing toggle, frame children and reparent-on-drop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web store, controller and shortcuts for connectors and frames

**Files:**
- Modify: `apps/web/src/store/docStore.ts`, `apps/web/src/board/controller.ts`, `apps/web/src/ui/useShortcuts.ts`
- Test: `apps/web/test/docStore.test.ts`, `apps/web/test/controller.test.ts`

**Interfaces:**
- Consumes: `readConnector`, `normalizeConnectors`, `type Connector` (Task 2); FSM effects/events (Task 4).
- Produces:
  - `DocState` gains `connectors: Record<string, Connector>` and `connectorOrder: string[]` (normalized: orphans dropped, sorted by z; unchanged connectors keep object identity).
  - `BoardUiState` gains `editingColumn: { frameId: string; columnId: string } | null` (initially `null`).
  - `BoardController` gains `renameColumn(frameId: string, columnId: string, title: string): void` (commits `RenameColumn` with the local origin, closes the column editor, ends the undo step) and `stopEditingColumn(): void`.
  - The FSM receives `connectors` in its context; `editColumn` effects set `editingColumn`.
  - Shortcuts: `A` connector tool, `F` frame tool, `E` toggles routing of selected connectors.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/docStore.test.ts` (inside the describe):

```ts
  it('projects connectors and drops those whose shapes are deleted', () => {
    const doc = new Y.Doc();
    const { store } = createDocStore(doc);
    applyCommand(doc, { type: 'CreateShape', shape: sticky('a') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('b') });
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'k1',
        from: { shapeId: 'a', anchor: 'auto' },
        to: { shapeId: 'b', anchor: 'auto' },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    expect(store.getState().connectorOrder).toEqual(['k1']);
    const before = store.getState().connectors.k1;
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 'a', x: 5, y: 5 }] });
    expect(store.getState().connectors.k1).toBe(before);
    applyCommand(doc, { type: 'SetRouting', id: 'k1', routing: 'elbow' });
    expect(store.getState().connectors.k1?.routing).toBe('elbow');
    applyCommand(doc, { type: 'DeleteShapes', ids: ['b'] });
    expect(store.getState().connectors.k1).toBeUndefined();
    expect(store.getState().connectorOrder).toEqual([]);
  });
```

Append to `apps/web/test/controller.test.ts` (inside the describe; `addRect(doc, id)` already exists — if it takes only `doc`, extend it to accept an optional `id` and `x` as below):

```ts
  it('creates a connector between two shapes and toggles its routing', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1');
    addRect(doc, 'r2', 400);
    controller.dispatch({ type: 'setTool', tool: 'connector' });
    controller.dispatch({ type: 'pointerDown', p: at(50, 50, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(300, 50) });
    controller.dispatch({ type: 'pointerUp', p: at(450, 50, 'r2') });
    const { connectors } = getRoots(doc);
    expect(connectors.size).toBe(1);
    const [id] = [...connectors.keys()];
    expect(controller.ui.getState().tool.selection).toEqual([id]);
    controller.dispatch({ type: 'toggleRouting' });
    expect(connectors.get(id as string)?.get('routing')).toBe('elbow');
  });

  it('opens the column editor and renames a column as its own undo step', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'frame' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.dispatch({ type: 'pointerUp', p: at(600, 400) });
    const frameId = controller.ui.getState().tool.selection[0] as string;
    const columns = () =>
      (getRoots(doc).shapes.get(frameId)?.get('columns') as Y.Array<{ id: string; title: string }>).toArray();
    const firstColumn = columns()[0]?.id as string;
    controller.dispatch({
      type: 'doubleClick',
      p: { ...at(50, 50, frameId), column: { frameId, columnId: firstColumn } },
    });
    expect(controller.ui.getState().editingColumn).toEqual({ frameId, columnId: firstColumn });
    controller.renameColumn(frameId, firstColumn, 'Wins');
    expect(controller.ui.getState().editingColumn).toBeNull();
    expect(columns()[0]?.title).toBe('Wins');
    controller.undo();
    expect(columns()[0]?.title).toBe('Went well');
    expect(getRoots(doc).shapes.has(frameId)).toBe(true);
  });
```

If `addRect` currently has the signature `addRect(doc: Y.Doc, id = 'r1')`, add an `x = 0` parameter used for the shape's `x`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @relay/web`
Expected: FAIL — `connectorOrder` is undefined; `editingColumn` / `renameColumn` don't exist.

- [ ] **Step 3: Project connectors in `apps/web/src/store/docStore.ts`**

Replace the file with:

```ts
import {
  type BoardMeta,
  type Connector,
  getRoots,
  normalizeConnectors,
  normalizeShapes,
  readConnector,
  readMeta,
  readShape,
  type Shape,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface DocState {
  shapes: Record<string, Shape>;
  order: string[];
  connectors: Record<string, Connector>;
  connectorOrder: string[];
  meta: BoardMeta;
}

function touchedIds(events: Y.YEvent<Y.AbstractType<unknown>>[], root: Y.AbstractType<unknown>) {
  const touched = new Set<string>();
  for (const event of events) {
    if (event.target === root) {
      for (const key of event.changes.keys.keys()) touched.add(key);
    } else if (event.path.length > 0) {
      touched.add(String(event.path[0]));
    }
  }
  return touched;
}

/**
 * Projects the Y.Doc into immutable snapshots, rebuilding only the shapes and
 * connectors a transaction touched. Normalization (orphan connectors, invalid
 * parents) runs on every publish; unchanged entries keep object identity.
 */
export function createDocStore(doc: Y.Doc): { store: StoreApi<DocState>; destroy(): void } {
  const { shapes: yShapes, connectors: yConnectors, meta } = getRoots(doc);
  const rawShapes: Record<string, Shape> = {};
  const rawConnectors: Record<string, Connector> = {};

  const store = createStore<DocState>(() => ({
    shapes: {},
    order: [],
    connectors: {},
    connectorOrder: [],
    meta: readMeta(meta),
  }));

  const publish = () => {
    const normalized = normalizeShapes(rawShapes);
    store.setState({ ...normalized, ...normalizeConnectors(rawConnectors, normalized.shapes) });
  };

  const rebuildShapes = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = yShapes.get(id);
      const shape = m ? readShape(id, m) : null;
      if (shape) rawShapes[id] = shape;
      else delete rawShapes[id];
    }
  };
  const rebuildConnectors = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = yConnectors.get(id);
      const connector = m ? readConnector(id, m) : null;
      if (connector) rawConnectors[id] = connector;
      else delete rawConnectors[id];
    }
  };

  const onShapes = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuildShapes(touchedIds(events, yShapes));
    publish();
  };
  const onConnectors = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuildConnectors(touchedIds(events, yConnectors));
    publish();
  };
  const onMeta = () => store.setState({ meta: readMeta(meta) });

  yShapes.observeDeep(onShapes);
  yConnectors.observeDeep(onConnectors);
  meta.observe(onMeta);
  rebuildShapes(yShapes.keys());
  rebuildConnectors(yConnectors.keys());
  publish();

  return {
    store,
    destroy() {
      yShapes.unobserveDeep(onShapes);
      yConnectors.unobserveDeep(onConnectors);
      meta.unobserve(onMeta);
    },
  };
}
```

- [ ] **Step 4: Controller changes in `apps/web/src/board/controller.ts`**

1. `BoardUiState`: add `editingColumn: { frameId: string; columnId: string } | null;` and initialize it to `null`.
2. `BoardController`: add `renameColumn(frameId: string, columnId: string, title: string): void;` and `stopEditingColumn(): void;`.
3. In `run`, add:

```ts
        case 'editColumn':
          ui.setState({ editingColumn: { frameId: effect.frameId, columnId: effect.columnId } });
          break;
```

4. In `dispatch`, pass the connectors to the FSM context: add `connectors: opts.docStore.getState().connectors,`.
5. Add to the returned object:

```ts
    renameColumn(frameId, columnId, title) {
      commit({ type: 'RenameColumn', frameId, columnId, title });
      ui.setState({ editingColumn: null });
      undoStack.stopCapturing();
    },
    stopEditingColumn() {
      ui.setState({ editingColumn: null });
    },
```

6. In `travel` (undo/redo), also close the column editor: after the editing-text check add `if (ui.getState().editingColumn) ui.setState({ editingColumn: null });`.

- [ ] **Step 5: Shortcuts in `apps/web/src/ui/useShortcuts.ts`**

Add `a: 'connector'` and `f: 'frame'` to `TOOL_KEYS`, and before the `TOOL_KEYS` lookup handle routing:

```ts
      if (key === 'e') {
        controller.dispatch({ type: 'toggleRouting' });
        return;
      }
```

- [ ] **Step 6: Verify and commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add apps/web/src/store/docStore.ts apps/web/src/board/controller.ts apps/web/src/ui/useShortcuts.ts apps/web/test
git commit -m "feat(web): project connectors, column editing state and connector/frame shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Render connectors; connector and frame tools in the toolbar

**Files:**
- Create: `apps/web/src/render/ConnectorView.tsx`
- Modify: `apps/web/src/render/Canvas.tsx`, `apps/web/src/ui/Toolbar.tsx`

**Interfaces:**
- Consumes: `connectorPath`, `arrowHead`, `isAttached`, `PALETTE` (core); `useShape` (web); `DocState.connectors/connectorOrder` (Task 5).
- Produces:
  - `<ConnectorView id session>`: `<g data-connector-id>` with the visible polyline (ink, cobalt when locally selected), an arrowhead polygon when `head === 'arrow'`, and a 14-unit transparent hit polyline (`pointerEvents="stroke"`). Endpoints use `useShape`, so connectors follow local drags/resizes every frame.
  - `Canvas` renders the connectors layer before the shapes layer, and `info()` reports `connectorId` (from `[data-connector-id]`) and `column` (from `[data-column-id]` + the enclosing `[data-shape-id]`).
  - Toolbar: 9 tools — `select V, rect R, ellipse O, line L, connector A, text T, sticky S, code C, frame F`.

- [ ] **Step 1: Create `apps/web/src/render/ConnectorView.tsx`**

```tsx
import { arrowHead, connectorPath, isAttached, PALETTE, type Point } from '@relay/core';
import { memo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { useShape } from './useShape';

const toPoints = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

export const ConnectorView = memo(function ConnectorView({
  id,
  session,
}: {
  id: string;
  session: BoardSession;
}) {
  const connector = useStore(session.doc, (s) => s.connectors[id]);
  const fromId = connector && isAttached(connector.from) ? connector.from.shapeId : null;
  const toId = connector && isAttached(connector.to) ? connector.to.shapeId : null;
  // Overlay-aware endpoints: connectors follow local drags and resizes every frame.
  const fromShape = useShape(session, fromId);
  const toShape = useShape(session, toId);
  const selected = useStore(session.controller.ui, (s) => s.tool.selection.includes(id));
  if (!connector) return null;

  const lookup = {
    ...(fromId && fromShape ? { [fromId]: fromShape } : {}),
    ...(toId && toShape ? { [toId]: toShape } : {}),
  };
  const path = connectorPath(connector, lookup);
  if (!path || path.length < 2) return null;
  const color = selected ? PALETTE.cobalt : PALETTE.ink;
  const tip = path[path.length - 1] as Point;
  const before = path[path.length - 2] as Point;
  const head = connector.head === 'arrow' ? arrowHead(tip, before) : null;

  return (
    <g data-connector-id={id} className="cursor-pointer">
      <polyline
        points={toPoints(path)}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {head && <polygon points={toPoints(head)} fill={color} />}
      {/* A wide invisible stroke so a thin connector is easy to click. */}
      <polyline
        points={toPoints(path)}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        pointerEvents="stroke"
      />
    </g>
  );
});
```

- [ ] **Step 2: Canvas — connectors layer and hit-testing**

In `apps/web/src/render/Canvas.tsx`:

1. Import `ConnectorView` from `./ConnectorView`.
2. Subscribe to the connector order: `const connectorOrder = useStore(session.doc, useShallow((s) => s.connectorOrder));`.
3. In `info()`, after `const handle = ...`, add:

```tsx
    const connectorId = el?.closest('[data-connector-id]')?.getAttribute('data-connector-id');
    const columnId = el?.closest('[data-column-id]')?.getAttribute('data-column-id');
    const frameId = columnId ? hit?.getAttribute('data-shape-id') : null;
```

and spread into the returned object:

```tsx
      ...(connectorId ? { connectorId } : {}),
      ...(columnId && frameId ? { column: { frameId, columnId } } : {}),
```

4. Inside the camera `<g>`, render the connectors before the shapes:

```tsx
        {connectorOrder.map((id) => (
          <ConnectorView key={id} id={id} session={session} />
        ))}
        {order.map((id) => (
          <ShapeView key={id} id={id} session={session} />
        ))}
```

- [ ] **Step 3: Toolbar**

In `apps/web/src/ui/Toolbar.tsx`, import `ArrowUpRight` and `Frame` from `lucide-react` and make `TOOLS`:

```ts
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'line', label: 'Line', key: 'L', Icon: Slash },
  { id: 'connector', label: 'Connector', key: 'A', Icon: ArrowUpRight },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'sticky', label: 'Sticky note', key: 'S', Icon: StickyNote },
  { id: 'code', label: 'Code block', key: 'C', Icon: Braces },
  { id: 'frame', label: 'Frame', key: 'F', Icon: Frame },
```

If an icon is not exported by the installed `lucide-react`, use the closest one and report it.

- [ ] **Step 4: Verify build, lint and tests**

Run: `npm run typecheck && npm test && npm run lint && npm run build -w @relay/web`
Expected: green.

- [ ] **Step 5: Verify in the browser**

With both dev servers running: draw two rectangles; press `A` and drag from one to the other → an arrow appears between their outlines, with a dashed preview while dragging; drag either rectangle → the arrow follows every frame; with the connector selected (it is, right after creation) press `E` → it becomes an orthogonal elbow; click the connector → it turns blue (selected); `Delete` removes it; delete a rectangle → its connectors disappear; undo restores them. A second browser sees the connector. No console errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/render apps/web/src/ui/Toolbar.tsx
git commit -m "feat(web): render connectors that follow their shapes live; connector and frame tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Render frames with columns; column and title editing; layering

**Files:**
- Create: `apps/web/src/render/FrameView.tsx`, `apps/web/src/render/ColumnTitleEditor.tsx`
- Modify: `apps/web/src/render/ShapeView.tsx`, `apps/web/src/render/Canvas.tsx`, `apps/web/src/render/TextEditor.tsx`, `apps/web/src/render/typography.ts`, `apps/web/src/board/Board.tsx`

**Interfaces:**
- Consumes: `frameColumns`, `columnCounts`, `FRAME_TITLE_H`, `COLUMN_HEADER_H`, `worldToScreen`, `PALETTE` (core); `BoardUiState.editingColumn`, `controller.renameColumn/stopEditingColumn` (Task 5); `useShape`.
- Produces:
  - `FrameBody` (used by `ShapeView` for `type: 'frame'`): shadow and body with `pointerEvents="none"` (clicks inside a frame reach the canvas, so marquees and shapes inside work), a title band rect that is the frame's grab/double-click target, the title text (placeholder `Frame`), dashed column dividers, and column headers `<foreignObject data-column-id>` showing `"<title> · <count>"` (uppercase via CSS).
  - `Canvas` renders layers: frames, connectors, other shapes.
  - `TextEditor` edits a frame's title inside the title band only.
  - `ColumnTitleEditor`: an `<input data-testid="column-editor">` over the column header; `Enter`/blur commits (`renameColumn`) when the value changed and is non-empty, `Escape` cancels; commits at most once.
  - Canvas blurs the column editor on pointer down (like the text editor).

- [ ] **Step 1: Typography for frame titles**

In `apps/web/src/render/typography.ts` set:
- `TEXT_STYLE.frame = 'font-mono text-[13px] font-bold uppercase tracking-wider'`
- `TEXT_BOX.frame = 'px-3 pt-2.5'`

- [ ] **Step 2: Create `apps/web/src/render/FrameView.tsx`**

```tsx
import { COLUMN_HEADER_H, columnCounts, FRAME_TITLE_H, frameColumns, PALETTE, type Shape } from '@relay/core';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { BoardSession } from '../board/session';
import { TEXT_BOX, TEXT_STYLE } from './typography';

export function FrameBody({
  s,
  editing,
  session,
}: {
  s: Shape;
  editing: boolean;
  session: BoardSession;
}) {
  const counts = useStore(
    session.doc,
    useShallow((d) => columnCounts(d.shapes, s.id)),
  );
  const columns = frameColumns(s);
  return (
    <>
      <rect x={s.x + 4} y={s.y + 4} width={s.w} height={s.h} fill={PALETTE.ink} pointerEvents="none" />
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        fill={s.style.fill}
        stroke={s.style.stroke}
        strokeWidth={3}
        pointerEvents="none"
      />
      {/* The title band is the frame's handle; the body lets clicks through to the canvas. */}
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={FRAME_TITLE_H}
        fill={s.style.fill}
        stroke={s.style.stroke}
        strokeWidth={3}
      />
      <foreignObject x={s.x} y={s.y} width={s.w} height={FRAME_TITLE_H} pointerEvents="none">
        <p className={`truncate ${TEXT_BOX.frame} ${TEXT_STYLE.frame} ${editing ? 'invisible' : ''}`}>
          {s.text || 'Frame'}
        </p>
      </foreignObject>
      {columns.map((c, i) => (
        <g key={c.id}>
          {i > 0 && (
            <line
              x1={c.x}
              y1={c.y}
              x2={c.x}
              y2={c.y + c.h}
              stroke={PALETTE.ink}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          )}
          <foreignObject data-column-id={c.id} x={c.x} y={c.y} width={c.w} height={COLUMN_HEADER_H}>
            <p className="truncate border-b-2 border-ink/80 px-3 pt-1.5 font-mono text-[11px] font-bold uppercase tracking-wider">
              {`${c.title} · ${counts[c.id] ?? 0}`}
            </p>
          </foreignObject>
        </g>
      ))}
    </>
  );
}
```

- [ ] **Step 3: Use it from `ShapeView`**

In `apps/web/src/render/ShapeView.tsx`: import `FrameBody` from `./FrameView`; change `Body` to receive `session` (`function Body({ s, editing, session }: { s: Shape; editing: boolean; session: BoardSession })`) and pass it from `ShapeView` (`<Body s={shape} editing={editing} session={session} />`); add the case before `default`:

```tsx
    case 'frame':
      return <FrameBody s={s} editing={editing} session={session} />;
```

- [ ] **Step 4: Layer frames first in `Canvas`**

Replace the single `order` subscription with two shallow subscriptions and render three layers:

```tsx
  const frameOrder = useStore(
    session.doc,
    useShallow((s) => s.order.filter((id) => s.shapes[id]?.type === 'frame')),
  );
  const shapeOrder = useStore(
    session.doc,
    useShallow((s) => s.order.filter((id) => s.shapes[id]?.type !== 'frame')),
  );
```

```tsx
        {frameOrder.map((id) => (
          <ShapeView key={id} id={id} session={session} />
        ))}
        {connectorOrder.map((id) => (
          <ConnectorView key={id} id={id} session={session} />
        ))}
        {shapeOrder.map((id) => (
          <ShapeView key={id} id={id} session={session} />
        ))}
```

Also, in `onPointerDown`, after the existing text-editor block, blur an open column editor:

```tsx
        if (controller.ui.getState().editingColumn) {
          (document.activeElement as HTMLElement | null)?.blur();
        }
```

- [ ] **Step 5: Edit frame titles inside the title band (`TextEditor.tsx`)**

Import `FRAME_TITLE_H` from `@relay/core` and, in the wrapper `style`, use `height: shape.type === 'frame' ? FRAME_TITLE_H : shape.h`. (Typography already comes from `TEXT_STYLE/TEXT_BOX.frame`.)

- [ ] **Step 6: Create `apps/web/src/render/ColumnTitleEditor.tsx`**

```tsx
import { COLUMN_HEADER_H, frameColumns, worldToScreen } from '@relay/core';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { useShape } from './useShape';

export function ColumnTitleEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const editing = useStore(controller.ui, (s) => s.editingColumn);
  const frame = useShape(session, editing?.frameId ?? null);
  const camera = useStore(controller.ui, (s) => s.camera);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const key = editing ? `${editing.frameId}:${editing.columnId}` : null;

  useEffect(() => {
    if (!key) return;
    finished.current = false;
    ref.current?.focus();
    ref.current?.select();
  }, [key]);

  const column = editing && frame ? frameColumns(frame).find((c) => c.id === editing.columnId) : undefined;
  if (!editing || !column) return null;

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const value = ref.current?.value.trim() ?? '';
    if (commit && value && value !== column.title) {
      controller.renameColumn(editing.frameId, column.id, value);
    } else {
      controller.stopEditingColumn();
    }
  };

  const pos = worldToScreen(camera, { x: column.x, y: column.y });
  return (
    <div
      className="absolute left-0 top-0 origin-top-left"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px) scale(${camera.zoom})`,
        width: column.w,
        height: COLUMN_HEADER_H,
      }}
    >
      <input
        key={key}
        ref={ref}
        data-testid="column-editor"
        aria-label="Column title"
        defaultValue={column.title}
        className="size-full border-2 border-cobalt bg-white px-3 font-mono text-[11px] font-bold uppercase tracking-wider outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}
```

Mount it in `apps/web/src/board/Board.tsx` right after `<TextEditor session={session} />`: `<ColumnTitleEditor session={session} />` (import it).

- [ ] **Step 7: Verify build, lint and tests**

Run: `npm run typecheck && npm test && npm run lint && npm run build -w @relay/web`
Expected: green.

- [ ] **Step 8: Verify in the browser**

With both dev servers: press `F` and drag a large frame → title band `FRAME`, three dashed columns headed `WENT WELL · 0`, `TO IMPROVE · 0`, `ACTIONS · 0`; press `S` and click inside the first column → header shows `WENT WELL · 1`; drag the sticky into the third column → counts update; drag the frame by its title band → the sticky moves with it; drag on the empty frame body → a marquee starts (the frame is not dragged); double-click a column header → an input appears, type a new name + Enter → header updates, `Ctrl+Z` restores the old name; double-click the title band → edit the frame title; connectors render above frames and below shapes. No console errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): frames with titled columns, live counters, column/title editing and layering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end coverage and spec update

**Files:**
- Create: `e2e/structure.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-24-relay-design.md` (NOT the READMEs)

**Interfaces:**
- Consumes: the DOM contract (Global Constraints) and `POST /api/rooms`.

- [ ] **Step 1: Write `e2e/structure.spec.ts`**

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function newBoard(page: Page, request: APIRequestContext): Promise<string> {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  return path;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('connectors attach, follow their shapes, switch routing and die with their shapes', async ({
  page,
  browser,
  request,
}) => {
  const path = await newBoard(page, request);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.keyboard.press('r');
  await drag(page, { x: 200, y: 200 }, { x: 320, y: 280 });
  await page.keyboard.press('r');
  await drag(page, { x: 600, y: 400 }, { x: 720, y: 480 });

  await page.keyboard.press('a');
  await drag(page, { x: 260, y: 240 }, { x: 660, y: 440 });
  const line = page.locator('[data-connector-id] polyline').first();
  await expect(line).toHaveCount(1);
  await expect(pb.locator('[data-connector-id]')).toHaveCount(1);

  const before = await line.getAttribute('points');
  await drag(page, { x: 660, y: 420 }, { x: 660, y: 560 });
  await expect(line).not.toHaveAttribute('points', before ?? '');

  // Select the connector by clicking its middle, then toggle elbow routing.
  const box = await page.locator('[data-connector-id]').boundingBox();
  if (!box) throw new Error('connector not rendered');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('e');
  await expect
    .poll(async () => ((await line.getAttribute('points')) ?? '').trim().split(/\s+/).length)
    .toBeGreaterThanOrEqual(3);

  await page.mouse.click(260, 240);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-connector-id]')).toHaveCount(0);
  await expect(pb.locator('[data-connector-id]')).toHaveCount(0);
  await other.close();
});

test('frames count, adopt and carry their stickies; columns can be renamed', async ({ page, request }) => {
  await newBoard(page, request);

  await page.keyboard.press('f');
  await drag(page, { x: 150, y: 120 }, { x: 870, y: 560 });
  await expect(page.getByText(/went well · 0/i)).toBeVisible();

  // Column 1 spans x 150..390 on screen; its body starts under the title band + header.
  await page.keyboard.press('s');
  await page.mouse.click(270, 330);
  await page.keyboard.type('Shipped offline mode');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/went well · 1/i)).toBeVisible();

  // Move the sticky into the third column.
  await drag(page, { x: 270, y: 280 }, { x: 750, y: 280 });
  await expect(page.getByText(/went well · 0/i)).toBeVisible();
  await expect(page.getByText(/actions · 1/i)).toBeVisible();

  // Drag the frame by its title band: the sticky travels with it.
  const sticky = page.getByText('Shipped offline mode');
  const beforeBox = await sticky.boundingBox();
  await drag(page, { x: 500, y: 135 }, { x: 560, y: 175 });
  await expect
    .poll(async () => Math.round(((await sticky.boundingBox())?.x ?? 0) - (beforeBox?.x ?? 0)))
    .toBe(60);

  // Rename the middle column.
  await page.getByText(/to improve · 0/i).dblclick();
  const editor = page.getByTestId('column-editor');
  await expect(editor).toBeFocused();
  await editor.fill('Blockers');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/blockers · 0/i)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/to improve · 0/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run e2e`
Expected: all tests pass (6 existing + 2 new). On failure, read the trace (`npx playwright show-trace test-results/**/trace.zip`) and fix the root cause; do not add sleeps or weaken assertions. If a coordinate in the test lands on the wrong element because of layout, adjust the coordinate (and say so in the report), not the assertion.

- [ ] **Step 3: Record the F2b decisions in the spec**

In `docs/superpowers/specs/2026-09-24-relay-design.md`:

1. Replace the paragraph under `### Connectors` with:

```
Connectors are drawn with the connector tool (`A`): press on a shape (or on
empty canvas for a free end) and release on another shape (or anywhere for a
free end). Attached ends use the `auto` anchor. Geometry is derived on every
render from the current — overlay-aware — shape geometry, so connectors
follow shapes while they are dragged. Straight connectors clip to the shape
outline (rectangle bounds or the ellipse curve) along the line between
centres; elbow connectors leave and enter through the facing sides with an
orthogonal polyline of at most two bends (obstacle-avoiding routing is out of
scope). New connectors are straight with an arrowhead; `E` toggles the
selected connectors between straight and elbow (`SetRouting`). Connectors
are selected by clicking them (14-unit hit stroke) and deleted with the
selection; deleting a shape deletes its connectors in the same transaction,
and the read side drops connectors whose shape vanished concurrently.
```

2. Add a subsection right after `### Connectors`:

```
### Frames

The frame tool (`F`) draws a frame with the default retro columns
(`Went well`, `To improve`, `Actions`) stored as a `Y.Array<{ id, title }>`
created by the frame's creator; the frame title is its `Y.Text`. Columns
split the body equally under a 36-unit title band. Frames render in the
bottom layer; only the title band is hit-testable, so clicks inside a frame
reach the shapes and the canvas (marquee). A new shape created inside a
frame, or a shape dropped there, is parented to the topmost frame under its
centre and to the column under it (`Reparent`); dropped outside every frame
it is unparented. Dragging or nudging a frame moves its children. Column
counters are derived from `parentId`/`columnId`. Double-clicking a column
header renames it (`RenameColumn`: delete + insert in one transaction;
concurrent renames converge and readers de-duplicate columns by id).
Marquee selection includes a frame only when it is fully inside the marquee.
```

3. In `### Input`, add `A` connector, `F` frame and `E` toggle connector routing to the shortcut list.
4. In `### Commands and Undo`, make sure the command list contains `Connect`, `SetRouting`, `Reparent` and `RenameColumn` (replace `Connect` if already present; add the others).

- [ ] **Step 4: Full verification and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run e2e`
Expected: all green.

```bash
git add e2e/structure.spec.ts docs/superpowers/specs/2026-09-24-relay-design.md
git commit -m "test(e2e): connectors and frames end to end; document F2b in the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Spec coverage for the rest of F2: connectors between shapes, straight or elbow, with arrowheads (Tasks 1, 2, 4, 6); outline clipping and ≤2-bend elbow routing (Task 1); frames with titled columns and derived counters, reparenting on drop (Tasks 3, 4, 7); rendering layers frames → connectors → shapes (Task 7); normalization rules for orphaned connectors, frames never nesting (also closes the F1 deferred minor) and invalid columns (Tasks 2, 3); convergence fuzzing extended with Connect and Reparent (Tasks 2, 3).
- Deliberately out of scope: re-attaching or dragging connector endpoints after creation, fixed-anchor UI (the model supports `n/s/e/w`, the UI creates `auto`), adding/removing columns, highlighting the drop target while dragging, connector labels.
- Type consistency: `Connector`/`Endpoint`/`Routing` (Task 1) are used by Tasks 2, 4, 5, 6; `NewConnector` and the new commands (Tasks 2, 3) by Task 4; `FrameColumn`, `frameColumns`, `dropTarget`, `columnCounts`, `childrenOf`, `rectContains`, `FRAME_TITLE_H`, `COLUMN_HEADER_H`, `DEFAULT_COLUMNS` (Task 3) by Tasks 4 and 7; `PointerInfo.connectorId/column`, `editColumn`, `toggleRouting`, `ToolContext.connectors` (Task 4) by Tasks 5–7; `DocState.connectors/connectorOrder`, `BoardUiState.editingColumn`, `renameColumn`, `stopEditingColumn` (Task 5) by Tasks 6–7.
