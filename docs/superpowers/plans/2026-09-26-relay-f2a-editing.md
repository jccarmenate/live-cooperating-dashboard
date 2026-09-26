# Relay F2a (Editing core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board a real editor: 60 fps local drag/resize preview, per-user undo/redo, 8-handle resize (2-handle for lines), marquee selection, arrow-key nudging, and three new shape types (ellipse, line, code block).

**Architecture:** All new behaviour is added to the pure core first — geometry (`geometry/shapes.ts`), a `ResizeShapes` command, a `createUndo` wrapper around `Y.UndoManager`, and new tool-FSM states (`resizing`, `marquee`) plus an `overlay` effect. The web controller then turns `overlay` effects into local UI state rendered every frame while commits stay throttled at 50 ms, and wires undo/redo to the keyboard. Rendering changes are last and are verified in the browser and by Playwright.

**Tech Stack:** TypeScript 5.9, Yjs 13.6 (`Y.UndoManager`), Vitest 4, fast-check 4, React 19 / Next.js 16, Zustand 5, lucide-react, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md` (phase F2; this plan covers F2 minus connectors and frames, which follow in plan F2b).

## Global Constraints

- Total cost $0; no credit card on any service; no paid dependency.
- `yjs` stays on 13.6.x with a single copy (root `overrides`); Vitest stays on 4.x; TypeScript `~5.9`.
- All board mutations go through `applyCommand` from `@relay/core`; UI code never writes Yjs types directly.
- `packages/core` is platform-neutral: its tsconfig has `lib: ["ES2023"]`, `types: []`; never add DOM/Node typings or `/// <reference lib>`; web-platform globals are declared module-locally in the file that uses them.
- Per-user undo: `Y.UndoManager` tracks only `LOCAL_ORIGIN` and `AI_ORIGIN`; a remote peer's changes are never undone.
- Drag and resize commits to the document stay throttled at 50 ms; the local preview updates on every pointer move.
- Shapes are `Y.Map<id, Y.Map>`; lines store `x, y` = start point and signed `w, h` = vector to the end point.
- DOM contract used by E2E (existing, keep): `data-testid` `canvas`, `text-editor`, `tool-<id>`, `online-count`, `conn-status`, `remote-cursor`; shapes carry `data-shape-id`. New in this plan: resize handles carry `data-handle="<handle>"`, local selection outlines carry `data-testid="selection-outline"`, the marquee rectangle carries `data-testid="marquee"`.
- Biome lint must pass (`npm run lint`); fix formatting with `npm run format`; never disable rules.
- Every commit message ends with a blank line then a `Co-Authored-By:` trailer naming the model that authored the commit (default `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## File Map

```
packages/core/src/
├─ geometry/shapes.ts        NEW  handles, bounds, intersection, marquee hit-test, resize math
├─ commands/types.ts         MOD  + ResizeShapes
├─ commands/apply.ts         MOD  + ResizeShapes
├─ commands/undo.ts          NEW  createUndo(doc) → per-user UndoManager wrapper
├─ schema/defaults.ts        MOD  DEFAULT_SIZE for ellipse, line, code
├─ tools/machine.ts          MOD  new tools, marquee/resizing states, overlay + preview effects, nudge
└─ index.ts                  MOD  barrel exports
packages/core/test/
├─ shapes.test.ts            NEW
├─ commands.test.ts          MOD  + ResizeShapes
├─ undo.test.ts              NEW
├─ convergence.test.ts       MOD  + resize, undo, redo steps
└─ tools.test.ts             REWRITE
apps/web/src/
├─ board/controller.ts       MOD  preview/overlay state, undo/redo
├─ ui/useShortcuts.ts        REWRITE  Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, O L C keys, arrow nudge
├─ ui/Toolbar.tsx            REWRITE  7 tools
├─ render/typography.ts      NEW  shared text styles for read + edit views
├─ render/ShapeView.tsx      REWRITE  ellipse, line, code; overlay-aware
├─ render/useShape.ts        NEW  doc shape merged with the local overlay
├─ render/SelectionLayer.tsx REWRITE  overlay-aware outlines, handles, bounds for lines
├─ render/Canvas.tsx         MOD  preview kinds, handle hit-testing, shallow order
└─ render/TextEditor.tsx     MOD  shared typography, centered padding, Tab in code blocks
apps/web/test/controller.test.ts  MOD  overlay + undo tests
e2e/editing.spec.ts          NEW
docs/superpowers/specs/2026-09-24-relay-design.md  MOD  record F2a decisions
README.md / README.es.md     MOD  roadmap + features
```

---

### Task 1: Shape geometry — handles, bounds, marquee hit-test, resize math

**Files:**
- Create: `packages/core/src/geometry/shapes.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/shapes.test.ts`

**Interfaces:**
- Consumes: `Point`, `Rect`, `Shape`, `ShapeType` (schema/types); `rectFromPoints` (geometry/rect).
- Produces:
  - `type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'`, `type LineHandle = 'start' | 'end'`, `type Handle = BoxHandle | LineHandle`
  - `BOX_HANDLES: readonly BoxHandle[]`, `LINE_HANDLES: readonly LineHandle[]`, `HANDLES: readonly Handle[]`, `MIN_SIZE = 8`
  - `isHandle(v: unknown): v is Handle`
  - `shapeBounds(s: Pick<Shape,'type'|'x'|'y'|'w'|'h'>): Rect` (lines normalized)
  - `handlesFor(type: ShapeType): readonly Handle[]`
  - `handlePoint(s: Pick<Shape,'type'|'x'|'y'|'w'|'h'>, handle: Handle): Point`
  - `rectsIntersect(a: Rect, b: Rect): boolean` (touching edges count)
  - `shapesInRect(shapes: Readonly<Record<string, Shape>>, rect: Rect): string[]` (sorted ids)
  - `resizeGeometry(type: ShapeType, start: Rect, handle: Handle, delta: Point, keepAspect?: boolean): Rect`

- [ ] **Step 1: Write the failing test `packages/core/test/shapes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  BOX_HANDLES,
  DEFAULT_STYLE,
  handlePoint,
  handlesFor,
  isHandle,
  MIN_SIZE,
  rectsIntersect,
  resizeGeometry,
  type Shape,
  shapeBounds,
  shapesInRect,
} from '../src';

const box = { x: 100, y: 100, w: 200, h: 100 };

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    style: DEFAULT_STYLE.rect,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
    ...partial,
  };
}

describe('resizeGeometry — boxes', () => {
  it('se grows from the top-left anchor', () => {
    expect(resizeGeometry('rect', box, 'se', { x: 20, y: 10 })).toEqual({ x: 100, y: 100, w: 220, h: 110 });
  });

  it('nw moves the origin and keeps the opposite corner', () => {
    expect(resizeGeometry('rect', box, 'nw', { x: 20, y: 10 })).toEqual({ x: 120, y: 110, w: 180, h: 90 });
  });

  it('edge handles change one axis only', () => {
    expect(resizeGeometry('rect', box, 'e', { x: 30, y: 50 })).toEqual({ x: 100, y: 100, w: 230, h: 100 });
    expect(resizeGeometry('rect', box, 'n', { x: 30, y: -20 })).toEqual({ x: 100, y: 80, w: 200, h: 120 });
  });

  it('flips instead of going negative when dragged past the opposite edge', () => {
    expect(resizeGeometry('rect', box, 'e', { x: -260, y: 0 })).toEqual({ x: 40, y: 100, w: 60, h: 100 });
  });

  it('never shrinks below MIN_SIZE', () => {
    expect(resizeGeometry('rect', box, 'e', { x: -198, y: 0 })).toEqual({ x: 100, y: 100, w: MIN_SIZE, h: 100 });
  });

  it('keeps the aspect ratio on corner handles when asked', () => {
    expect(resizeGeometry('rect', box, 'se', { x: 100, y: 0 }, true)).toEqual({ x: 100, y: 100, w: 300, h: 150 });
  });

  it('ignores keepAspect on edge handles', () => {
    expect(resizeGeometry('rect', box, 'e', { x: 100, y: 0 }, true)).toEqual({ x: 100, y: 100, w: 300, h: 100 });
  });

  it('ignores line handles on boxes', () => {
    expect(resizeGeometry('rect', box, 'end', { x: 5, y: 5 })).toEqual(box);
  });
});

describe('resizeGeometry — lines', () => {
  const line = { x: 0, y: 0, w: 100, h: 50 };

  it('moves one endpoint and keeps the other', () => {
    expect(resizeGeometry('line', line, 'end', { x: 10, y: -10 })).toEqual({ x: 0, y: 0, w: 110, h: 40 });
    expect(resizeGeometry('line', line, 'start', { x: 10, y: 10 })).toEqual({ x: 10, y: 10, w: 90, h: 40 });
  });

  it('ignores box handles on lines', () => {
    expect(resizeGeometry('line', line, 'se', { x: 5, y: 5 })).toEqual(line);
  });
});

describe('handles and bounds', () => {
  it('shapeBounds normalizes signed line vectors', () => {
    expect(shapeBounds({ type: 'line', x: 100, y: 100, w: -50, h: 20 })).toEqual({ x: 50, y: 100, w: 50, h: 20 });
    expect(shapeBounds({ type: 'rect', ...box })).toEqual(box);
  });

  it('handlesFor returns 8 box handles or 2 line endpoints', () => {
    expect(handlesFor('rect')).toEqual(BOX_HANDLES);
    expect(handlesFor('line')).toEqual(['start', 'end']);
  });

  it('handlePoint places handles on the bounds', () => {
    const r = { type: 'rect' as const, ...box };
    expect(handlePoint(r, 'nw')).toEqual({ x: 100, y: 100 });
    expect(handlePoint(r, 'n')).toEqual({ x: 200, y: 100 });
    expect(handlePoint(r, 'e')).toEqual({ x: 300, y: 150 });
    expect(handlePoint(r, 'sw')).toEqual({ x: 100, y: 200 });
    const l = { type: 'line' as const, x: 10, y: 20, w: -5, h: 30 };
    expect(handlePoint(l, 'start')).toEqual({ x: 10, y: 20 });
    expect(handlePoint(l, 'end')).toEqual({ x: 5, y: 50 });
  });

  it('isHandle recognizes only known handles', () => {
    expect(isHandle('se')).toBe(true);
    expect(isHandle('start')).toBe(true);
    expect(isHandle('middle')).toBe(false);
    expect(isHandle(null)).toBe(false);
  });
});

describe('marquee hit-testing', () => {
  it('rectsIntersect counts touching edges', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('shapesInRect returns the sorted ids of intersecting shapes, lines by their bounds', () => {
    const shapes = {
      b: shape('b', { x: 50, y: 50, w: 20, h: 20 }),
      a: shape('a', { x: 0, y: 0, w: 20, h: 20 }),
      far: shape('far', { x: 500, y: 500, w: 20, h: 20 }),
      l: shape('l', { type: 'line', x: 90, y: 90, w: -10, h: -10 }),
    };
    expect(shapesInRect(shapes, { x: 10, y: 10, w: 75, h: 75 })).toEqual(['a', 'b', 'l']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @relay/core -- shapes`
Expected: FAIL — `resizeGeometry` (and the other symbols) are not exported from `../src`.

- [ ] **Step 3: Implement `packages/core/src/geometry/shapes.ts`**

```ts
import type { Point, Rect, Shape, ShapeType } from '../schema/types';
import { rectFromPoints } from './rect';

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type LineHandle = 'start' | 'end';
export type Handle = BoxHandle | LineHandle;

export const BOX_HANDLES: readonly BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const LINE_HANDLES: readonly LineHandle[] = ['start', 'end'];
export const HANDLES: readonly Handle[] = [...BOX_HANDLES, ...LINE_HANDLES];

/** Boxes never shrink below this many world units on either axis. */
export const MIN_SIZE = 8;

type Geometry = Pick<Shape, 'type' | 'x' | 'y' | 'w' | 'h'>;

export const isHandle = (v: unknown): v is Handle =>
  typeof v === 'string' && (HANDLES as readonly string[]).includes(v);

/** Axis-aligned bounds. Lines store a signed vector from their start point, so normalize them. */
export function shapeBounds(s: Geometry): Rect {
  if (s.type === 'line') return rectFromPoints({ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h });
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

export function handlesFor(type: ShapeType): readonly Handle[] {
  return type === 'line' ? LINE_HANDLES : BOX_HANDLES;
}

export function handlePoint(s: Geometry, handle: Handle): Point {
  if (handle === 'start') return { x: s.x, y: s.y };
  if (handle === 'end') return { x: s.x + s.w, y: s.y + s.h };
  const b = shapeBounds(s);
  const x = handle.includes('w') ? b.x : handle.includes('e') ? b.x + b.w : b.x + b.w / 2;
  const y = handle.includes('n') ? b.y : handle.includes('s') ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

/** Touching edges count as intersecting. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/**
 * Ids of shapes whose bounds intersect `rect`, sorted for determinism.
 * A linear scan: fine for the hundreds of shapes a board holds; an R-tree can
 * replace it behind this signature if profiling ever demands it.
 */
export function shapesInRect(shapes: Readonly<Record<string, Shape>>, rect: Rect): string[] {
  return Object.values(shapes)
    .filter((s) => rectsIntersect(shapeBounds(s), rect))
    .map((s) => s.id)
    .sort();
}

/**
 * New geometry when `handle` of a shape whose geometry was `start` is dragged by `delta`.
 * Boxes flip instead of going negative and never shrink below MIN_SIZE; `keepAspect`
 * applies to corner handles. Lines move one endpoint of their signed vector.
 */
export function resizeGeometry(
  type: ShapeType,
  start: Rect,
  handle: Handle,
  delta: Point,
  keepAspect = false,
): Rect {
  if (type === 'line') {
    if (handle === 'start') {
      return {
        x: start.x + delta.x,
        y: start.y + delta.y,
        w: start.w - delta.x,
        h: start.h - delta.y,
      };
    }
    if (handle === 'end') {
      return { x: start.x, y: start.y, w: start.w + delta.x, h: start.h + delta.y };
    }
    return { ...start };
  }
  if (handle === 'start' || handle === 'end') return { ...start };

  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (handle.includes('w')) left += delta.x;
  if (handle.includes('e')) right += delta.x;
  if (handle.includes('n')) top += delta.y;
  if (handle.includes('s')) bottom += delta.y;

  if (keepAspect && handle.length === 2 && start.w > 0 && start.h > 0) {
    const w = right - left;
    const h = bottom - top;
    const scale = Math.max(Math.abs(w) / start.w, Math.abs(h) / start.h);
    const nw = (w < 0 ? -1 : 1) * start.w * scale;
    const nh = (h < 0 ? -1 : 1) * start.h * scale;
    if (handle.includes('w')) left = right - nw;
    else right = left + nw;
    if (handle.includes('n')) top = bottom - nh;
    else bottom = top + nh;
  }

  const r = rectFromPoints({ x: left, y: top }, { x: right, y: bottom });
  return { x: r.x, y: r.y, w: Math.max(MIN_SIZE, r.w), h: Math.max(MIN_SIZE, r.h) };
}
```

- [ ] **Step 4: Export from the barrel** — add to `packages/core/src/index.ts` (keep the sorted order Biome enforces):

```ts
export * from './geometry/shapes';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- shapes && npm run typecheck -w @relay/core && npm run lint`
Expected: PASS; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/geometry/shapes.ts packages/core/src/index.ts packages/core/test/shapes.test.ts
git commit -m "feat(core): add shape handles, bounds, marquee hit-testing and resize geometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ResizeShapes command, per-user undo, convergence coverage

**Files:**
- Modify: `packages/core/src/commands/types.ts`, `packages/core/src/commands/apply.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/commands/undo.ts`
- Test: `packages/core/test/commands.test.ts` (add a case), `packages/core/test/undo.test.ts` (new), `packages/core/test/convergence.test.ts` (extend)

**Interfaces:**
- Consumes: `applyCommand`, `getRoots`, `LOCAL_ORIGIN`, `AI_ORIGIN`, `readShape`, `DEFAULT_STYLE`, `NewShape`.
- Produces:
  - `Command` gains `{ type: 'ResizeShapes'; rects: { id: string; x: number; y: number; w: number; h: number }[] }` (sets all four fields; missing ids ignored).
  - `interface Undo { undo(): boolean; redo(): boolean; stopCapturing(): void; canUndo(): boolean; canRedo(): boolean; onChange(cb: () => void): () => void; destroy(): void }`
  - `createUndo(doc: Y.Doc, opts?: { captureTimeout?: number }): Undo` — tracks the `shapes` and `connectors` roots, origins `LOCAL_ORIGIN` and `AI_ORIGIN` only; default `captureTimeout` 500 ms.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('applyCommand', ...)` block in `packages/core/test/commands.test.ts`:

```ts
  it('ResizeShapes sets geometry and ignores missing ids', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, {
      type: 'ResizeShapes',
      rects: [
        { id: 's1', x: 5, y: 6, w: 300, h: 200 },
        { id: 'gone', x: 0, y: 0, w: 1, h: 1 },
      ],
    });
    expect(read(doc, 's1')).toMatchObject({ x: 5, y: 6, w: 300, h: 200 });
    expect(getRoots(doc).shapes.has('gone')).toBe(false);
  });
```

Create `packages/core/test/undo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  createUndo,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  readShape,
} from '../src';

const shape = (id: string, type: 'rect' | 'sticky' = 'rect'): NewShape => ({
  id,
  type,
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  style: DEFAULT_STYLE[type],
  text: '',
  createdBy: 'u',
  authorName: 'U',
  createdAt: 0,
});

function read(doc: Y.Doc, id: string) {
  const m = getRoots(doc).shapes.get(id);
  return m ? readShape(id, m) : null;
}

describe('createUndo', () => {
  it('undoes and redoes local commands', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(read(doc, 'a')).toBeNull();
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(read(doc, 'a')?.w).toBe(100);
  });

  it('never undoes changes from other origins', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    applyCommand(doc, { type: 'CreateShape', shape: shape('remote') }, 'remote');
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(read(doc, 'remote')).not.toBeNull();
  });

  it('groups everything between stopCapturing calls into one step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc, { captureTimeout: 60_000 });
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    undo.stopCapturing();
    for (const x of [10, 20, 30]) {
      applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 'a', x, y: 0 }] }, LOCAL_ORIGIN);
    }
    undo.stopCapturing();
    applyCommand(
      doc,
      { type: 'ResizeShapes', rects: [{ id: 'a', x: 30, y: 0, w: 300, h: 50 }] },
      LOCAL_ORIGIN,
    );
    undo.undo();
    expect(read(doc, 'a')).toMatchObject({ x: 30, w: 100 });
    undo.undo();
    expect(read(doc, 'a')).toMatchObject({ x: 0, w: 100 });
    undo.undo();
    expect(read(doc, 'a')).toBeNull();
  });

  it('keeps a remote text edit when undoing a local move of the same shape', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc, { captureTimeout: 60_000 });
    applyCommand(doc, { type: 'CreateShape', shape: shape('s', 'sticky') }, LOCAL_ORIGIN);
    undo.stopCapturing();
    applyCommand(
      doc,
      { type: 'SetText', id: 's', index: 0, deleteCount: 0, insert: 'hi' },
      'remote',
    );
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 's', x: 50, y: 0 }] }, LOCAL_ORIGIN);
    undo.undo();
    expect(read(doc, 's')).toMatchObject({ x: 0, text: 'hi' });
  });

  it('notifies listeners until unsubscribed', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    let calls = 0;
    const off = undo.onChange(() => {
      calls++;
    });
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    undo.undo();
    expect(calls).toBe(before);
    undo.destroy();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @relay/core -- commands undo`
Expected: FAIL — `ResizeShapes` is not a valid command type / `createUndo` is not exported.

- [ ] **Step 3: Add the command**

In `packages/core/src/commands/types.ts`, add a member to the `Command` union:

```ts
  | { type: 'ResizeShapes'; rects: { id: string; x: number; y: number; w: number; h: number }[] }
```

In `packages/core/src/commands/apply.ts`, add a case to the `switch (cmd.type)` in `apply` (after `MoveShapes`):

```ts
    case 'ResizeShapes': {
      for (const { id, x, y, w, h } of cmd.rects) {
        const m = shapes.get(id);
        if (!m) continue;
        m.set('x', x);
        m.set('y', y);
        m.set('w', w);
        m.set('h', h);
      }
      return;
    }
```

- [ ] **Step 4: Implement `packages/core/src/commands/undo.ts`**

```ts
import * as Y from 'yjs';
import { getRoots } from '../schema/doc';
import { AI_ORIGIN, LOCAL_ORIGIN } from './origins';

export interface Undo {
  undo(): boolean;
  redo(): boolean;
  /** Ends the current undo step; the next local change starts a new one. */
  stopCapturing(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

const STACK_EVENTS = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const;

/**
 * Per-user undo: only transactions with this client's LOCAL or AI origin are
 * captured, so undo never reverts what a remote peer did. Undo/redo are
 * applied as ordinary Yjs transactions and sync to peers like any edit.
 */
export function createUndo(doc: Y.Doc, opts: { captureTimeout?: number } = {}): Undo {
  const { shapes, connectors } = getRoots(doc);
  const manager = new Y.UndoManager([shapes, connectors], {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN, AI_ORIGIN]),
    captureTimeout: opts.captureTimeout ?? 500,
  });
  return {
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    stopCapturing: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    onChange(cb) {
      for (const event of STACK_EVENTS) manager.on(event, cb);
      return () => {
        for (const event of STACK_EVENTS) manager.off(event, cb);
      };
    },
    destroy: () => manager.destroy(),
  };
}
```

Add to the barrel `packages/core/src/index.ts` (sorted):

```ts
export * from './commands/undo';
```

If `manager.on(event, cb)` does not typecheck against the installed Yjs typings (the handler signatures differ per event), wrap the callback: `const handler = () => cb();` and register/unregister `handler`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- commands undo`
Expected: PASS.

- [ ] **Step 6: Extend the convergence property test**

Edit `packages/core/test/convergence.test.ts`:

1. Extend the import from `'../src'` with `createUndo`, `LOCAL_ORIGIN`, `type Undo`.
2. Add `undos: Undo[]` to `interface Net`, create one per replica in `makeNet` (every change is its own undo step), and return it:

```ts
  const undos = docs.map((d) => createUndo(d, { captureTimeout: 0 }));
  // ...existing queue wiring...
  return { docs, queues, undos };
```

3. Replace the `Step` type with:

```ts
type Step =
  | { kind: 'create'; r: number; type: 'rect' | 'sticky' | 'text'; x: number; y: number }
  | { kind: 'move'; r: number; pick: number; x: number; y: number }
  | { kind: 'resize'; r: number; pick: number; w: number; h: number }
  | { kind: 'text'; r: number; pick: number; index: number; del: number; insert: string }
  | { kind: 'delete'; r: number; pick: number }
  | { kind: 'undo'; r: number }
  | { kind: 'redo'; r: number }
  | { kind: 'deliver'; from: number; to: number; count: number };
```

4. Add these entries to the `fc.oneof(...)` in `stepArb` (keep the existing ones):

```ts
  fc.record({
    kind: fc.constant('resize' as const),
    r: replica,
    pick: fc.nat(),
    w: fc.integer({ min: 8, max: 400 }),
    h: fc.integer({ min: 8, max: 400 }),
  }),
  fc.record({ kind: fc.constant('undo' as const), r: replica }),
  fc.record({ kind: fc.constant('redo' as const), r: replica }),
```

5. In `run`, pass `LOCAL_ORIGIN` as the third argument of every `applyCommand` call, handle undo/redo right after the `deliver` branch, and handle resize with the other per-shape steps:

```ts
    if (s.kind === 'undo' || s.kind === 'redo') {
      const undo = net.undos[s.r];
      if (s.kind === 'undo') undo?.undo();
      else undo?.redo();
      continue;
    }
```

```ts
    if (s.kind === 'resize')
      applyCommand(
        doc,
        { type: 'ResizeShapes', rects: [{ id, x: s.w, y: s.h, w: s.w, h: s.h }] },
        LOCAL_ORIGIN,
      );
```

- [ ] **Step 7: Run the property test harder**

Run: `RELAY_FC_RUNS=2000 npm test -w @relay/core -- convergence`
Expected: PASS. If fast-check reports a counterexample, fix the root cause; never weaken the assertions.

- [ ] **Step 8: Full core check and commit**

Run: `npm test -w @relay/core && npm run typecheck -w @relay/core && npm run lint`
Expected: all green.

```bash
git add packages/core
git commit -m "feat(core): add ResizeShapes and per-user undo; fuzz undo/redo in the convergence test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tool state machine — new tools, marquee, resize, overlay, nudge

**Files:**
- Modify: `packages/core/src/tools/machine.ts` (full replacement below), `packages/core/src/schema/defaults.ts`
- Modify (keep the web app compiling): `apps/web/src/board/controller.ts`, `apps/web/src/render/Canvas.tsx`
- Test: `packages/core/test/tools.test.ts` (full replacement below)

**Interfaces:**
- Consumes: `Command`, `NewShape`; `rectFromPoints`; `Handle`, `resizeGeometry`, `shapesInRect` (Task 1); `DEFAULT_SIZE`, `DEFAULT_STYLE`; `Point`, `Rect`, `Shape`, `ShapeType`, `TEXT_TYPES`.
- Produces:
  - `type ToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'text' | 'sticky' | 'code'`
  - `PointerInfo` gains optional `handle?: Handle`
  - `ToolEvent` gains `{ type: 'nudge'; dx: number; dy: number }`
  - `ToolState` modes: `idle | dragging | resizing | drawing | marquee` (every mode has `tool` and `selection`)
  - `type PreviewKind = 'rect' | 'ellipse' | 'line' | 'marquee'`, `interface Preview { kind: PreviewKind; rect: Rect }` (for `line`, `rect` is the signed start→end vector)
  - `Effect` = `command` | `{ type: 'preview'; preview: Preview | null }` | `{ type: 'overlay'; rects: Record<string, Rect> | null }` | `editText` | `endGesture`
  - `DEFAULT_SIZE` keys: `rect`, `ellipse` (160×96), `line` (160×0), `sticky`, `text`, `code` (280×140)
- Behaviour contract:
  - Select + pointer down on a handle with exactly one shape selected → `resizing`. Moves emit `[overlay {id: rect}, command ResizeShapes (throttle)]`; release emits `[command ResizeShapes, overlay null, endGesture]`; cancel restores the start geometry. Shift keeps the aspect ratio.
  - Select + pointer down on empty canvas → `marquee` (base = current selection if Shift, else empty). Past the drag threshold, moves update `selection` = base ∪ intersecting shapes and emit a `marquee` preview; release emits `preview null`; a click without movement ends with `selection = base`.
  - Dragging moves emit `[overlay rects, command MoveShapes (throttle)]`; release emits `[command MoveShapes, overlay null, endGesture]`.
  - `rect`/`ellipse`/`line` draw with a preview of the same kind; a tiny drag creates the default size. `text`/`sticky`/`code` create centred on click and open the editor.
  - `nudge` moves the selection by (dx, dy) as one undo step.

- [ ] **Step 1: Replace `packages/core/test/tools.test.ts` with the new behaviour spec**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZE,
  DEFAULT_STYLE,
  type Effect,
  type Handle,
  initialToolState,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolId,
  type ToolState,
} from '../src';

const rectShape: Shape = {
  id: 'r1',
  type: 'rect',
  x: 100,
  y: 100,
  w: 160,
  h: 96,
  z: 'a0',
  style: DEFAULT_STYLE.rect,
  text: '',
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 0,
};
const farShape: Shape = { ...rectShape, id: 'r2', x: 400, y: 400 };

function ctx(shapes: Record<string, Shape> = { r1: rectShape }): ToolContext {
  let n = 0;
  return {
    shapes,
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => `new${++n}`,
    now: () => 1000,
  };
}

const at = (
  x: number,
  y: number,
  hitId: string | null = null,
  shift = false,
  handle?: Handle,
): PointerInfo => ({ world: { x, y }, shift, hitId, ...(handle ? { handle } : {}) });

const idle = (tool: ToolId, selection: string[]): ToolState => ({ mode: 'idle', tool, selection });

const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('select tool — click and drag', () => {
  it('clicking empty canvas clears the selection', () => {
    const c = ctx();
    const down = step(idle('select', ['r1']), { type: 'pointerDown', p: at(0, 0) }, c);
    expect(down.state.mode).toBe('marquee');
    const up = step(down.state, { type: 'pointerUp', p: at(1, 1) }, c);
    expect(up.state).toEqual(idle('select', []));
    expect(up.effects).toEqual([]);
  });

  it('shift-clicking empty canvas keeps the selection', () => {
    const c = ctx();
    const down = step(idle('select', ['r1']), { type: 'pointerDown', p: at(0, 0, null, true) }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(0, 0, null, true) }, c);
    expect(up.state).toEqual(idle('select', ['r1']));
  });

  it('clicking a shape selects it and starts a drag', () => {
    const r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, ctx());
    expect(r.state.mode).toBe('dragging');
    expect(r.state.selection).toEqual(['r1']);
  });

  it('shift-click toggles membership', () => {
    const c = ctx({ r1: rectShape, r2: farShape });
    const added = step(idle('select', ['r1']), { type: 'pointerDown', p: at(0, 0, 'r2', true) }, c);
    expect(added.state.selection).toEqual(['r1', 'r2']);
    const removed = step(
      idle('select', ['r1', 'r2']),
      { type: 'pointerDown', p: at(0, 0, 'r2', true) },
      c,
    );
    expect(removed.state).toEqual(idle('select', ['r1']));
  });

  it('dragging shows a local overlay every move, throttles commits, and lands exactly', () => {
    const c = ctx();
    let r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    r = step(r.state, { type: 'pointerMove', p: at(121, 120) }, c);
    expect(r.effects).toEqual([]); // below the drag threshold
    r = step(r.state, { type: 'pointerMove', p: at(130, 125) }, c);
    expect(r.effects).toEqual([
      { type: 'overlay', rects: { r1: { x: 110, y: 105, w: 160, h: 96 } } },
      {
        type: 'command',
        command: { type: 'MoveShapes', moves: [{ id: 'r1', x: 110, y: 105 }] },
        throttle: true,
      },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(140, 130) }, c);
    expect(r.state).toEqual(idle('select', ['r1']));
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'MoveShapes', moves: [{ id: 'r1', x: 120, y: 110 }] },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('a click without movement emits nothing', () => {
    const c = ctx();
    const down = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(121, 121) }, c);
    expect(up.effects).toEqual([]);
  });

  it('cancel during a drag restores the original positions and clears the overlay', () => {
    const c = ctx();
    let r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    r = step(r.state, { type: 'pointerMove', p: at(200, 200) }, c);
    r = step(r.state, { type: 'cancel' }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 'r1', x: 100, y: 100 }] },
    ]);
    expect(r.effects).toContainEqual({ type: 'overlay', rects: null });
    expect(r.state.mode).toBe('idle');
  });

  it('deleteSelection deletes and clears', () => {
    const r = step(idle('select', ['r1']), { type: 'deleteSelection' }, ctx());
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['r1'] }]);
    expect(r.state.selection).toEqual([]);
  });

  it('double-click on a text-capable shape opens the editor', () => {
    const r = step(initialToolState(), { type: 'doubleClick', p: at(0, 0, 'r1') }, ctx());
    expect(r.effects).toEqual([{ type: 'editText', id: 'r1' }]);
    expect(r.state.selection).toEqual(['r1']);
  });
});

describe('select tool — marquee', () => {
  const c = () => ctx({ r1: rectShape, r2: farShape });

  it('selects intersecting shapes live and previews the marquee', () => {
    let r = step(initialToolState(), { type: 'pointerDown', p: at(90, 90) }, c());
    r = step(r.state, { type: 'pointerMove', p: at(150, 150) }, c());
    expect(r.state.selection).toEqual(['r1']);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'marquee', rect: { x: 90, y: 90, w: 60, h: 60 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(150, 150) }, c());
    expect(r.state).toEqual(idle('select', ['r1']));
    expect(r.effects).toEqual([{ type: 'preview', preview: null }]);
  });

  it('shift-marquee adds to the existing selection', () => {
    let r = step(idle('select', ['r2']), { type: 'pointerDown', p: at(90, 90, null, true) }, c());
    r = step(r.state, { type: 'pointerMove', p: at(150, 150, null, true) }, c());
    r = step(r.state, { type: 'pointerUp', p: at(150, 150, null, true) }, c());
    expect(r.state.selection).toEqual(['r2', 'r1']);
  });

  it('cancel restores the selection the marquee started from', () => {
    let r = step(idle('select', ['r2']), { type: 'pointerDown', p: at(90, 90, null, true) }, c());
    r = step(r.state, { type: 'pointerMove', p: at(150, 150, null, true) }, c());
    r = step(r.state, { type: 'cancel' }, c());
    expect(r.state).toEqual(idle('select', ['r2']));
    expect(r.effects).toEqual([{ type: 'preview', preview: null }]);
  });
});

describe('select tool — resize', () => {
  const se = (x: number, y: number, shift = false) => at(x, y, null, shift, 'se');

  it('resizes from a handle with an overlay, throttled commits and a final commit', () => {
    const c = ctx();
    let r = step(idle('select', ['r1']), { type: 'pointerDown', p: se(260, 196) }, c);
    expect(r.state.mode).toBe('resizing');
    r = step(r.state, { type: 'pointerMove', p: se(280, 206) }, c);
    expect(r.effects).toEqual([
      { type: 'overlay', rects: { r1: { x: 100, y: 100, w: 180, h: 106 } } },
      {
        type: 'command',
        command: { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 180, h: 106 }] },
        throttle: true,
      },
    ]);
    r = step(r.state, { type: 'pointerUp', p: se(290, 216) }, c);
    expect(r.state).toEqual(idle('select', ['r1']));
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 190, h: 116 }] },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('shift keeps the aspect ratio', () => {
    const c = ctx();
    let r = step(idle('select', ['r1']), { type: 'pointerDown', p: se(260, 196) }, c);
    r = step(r.state, { type: 'pointerUp', p: se(340, 196, true) }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 240, h: 144 }] },
    ]);
  });

  it('cancel restores the start geometry', () => {
    const c = ctx();
    let r = step(idle('select', ['r1']), { type: 'pointerDown', p: se(260, 196) }, c);
    r = step(r.state, { type: 'pointerMove', p: se(300, 250) }, c);
    r = step(r.state, { type: 'cancel' }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 160, h: 96 }] },
    ]);
    expect(r.state.mode).toBe('idle');
  });

  it('ignores handles unless exactly one shape is selected', () => {
    const c = ctx({ r1: rectShape, r2: farShape });
    const r = step(idle('select', ['r1', 'r2']), { type: 'pointerDown', p: se(260, 196) }, c);
    expect(r.state.mode).toBe('marquee');
  });
});

describe('nudge', () => {
  it('moves the selection by the delta as one gesture', () => {
    const r = step(idle('select', ['r1']), { type: 'nudge', dx: 10, dy: -1 }, ctx());
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 'r1', x: 110, y: 99 }] },
    ]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
    expect(r.state).toEqual(idle('select', ['r1']));
  });

  it('does nothing without a selection', () => {
    expect(step(initialToolState(), { type: 'nudge', dx: 1, dy: 0 }, ctx()).effects).toEqual([]);
  });
});

describe('creation tools', () => {
  it('sticky creates a centered sticky, selects it and opens the editor', () => {
    const r = step(idle('sticky', []), { type: 'pointerDown', p: at(500, 400) }, ctx());
    expect(commands(r.effects)).toEqual([
      {
        type: 'CreateShape',
        shape: {
          id: 'new1',
          type: 'sticky',
          x: 410,
          y: 330,
          w: 180,
          h: 140,
          style: DEFAULT_STYLE.sticky,
          text: '',
          createdBy: 'u1',
          authorName: 'Brisk Otter',
          createdAt: 1000,
        },
      },
    ]);
    expect(r.effects).toContainEqual({ type: 'editText', id: 'new1' });
    expect(r.state).toEqual(idle('select', ['new1']));
  });

  it('code creates a centered code block and opens the editor', () => {
    const r = step(idle('code', []), { type: 'pointerDown', p: at(500, 400) }, ctx());
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'code', x: 360, y: 330, w: 280, h: 140, style: DEFAULT_STYLE.code },
    });
    expect(r.effects).toContainEqual({ type: 'editText', id: 'new1' });
  });

  it('rect tool draws with a rect preview and creates on release', () => {
    const c = ctx();
    let r = step(idle('rect', []), { type: 'pointerDown', p: at(10, 10) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, 40) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'rect', rect: { x: 10, y: 10, w: 50, h: 30 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(60, 40) }, c);
    expect(r.effects[0]).toEqual({ type: 'preview', preview: null });
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'rect', x: 10, y: 10, w: 50, h: 30 },
    });
    expect(r.state).toEqual(idle('select', ['new1']));
  });

  it('a click with a drawing tool creates the default size', () => {
    for (const tool of ['rect', 'ellipse'] as const) {
      const c = ctx();
      const down = step(idle(tool, []), { type: 'pointerDown', p: at(10, 10) }, c);
      const up = step(down.state, { type: 'pointerUp', p: at(11, 11) }, c);
      expect(commands(up.effects)[0]).toMatchObject({
        shape: { type: tool, x: 10, y: 10, ...DEFAULT_SIZE[tool] },
      });
    }
  });

  it('ellipse tool previews an ellipse', () => {
    const c = ctx();
    let r = step(idle('ellipse', []), { type: 'pointerDown', p: at(10, 10) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, 40) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'ellipse', rect: { x: 10, y: 10, w: 50, h: 30 } } },
    ]);
  });

  it('line tool keeps the signed start→end vector', () => {
    const c = ctx();
    let r = step(idle('line', []), { type: 'pointerDown', p: at(10, 10) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, -20) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'line', rect: { x: 10, y: 10, w: 50, h: -30 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(60, -20) }, c);
    expect(commands(r.effects)[0]).toMatchObject({
      shape: { type: 'line', x: 10, y: 10, w: 50, h: -30 },
    });
  });

  it('a click with the line tool creates a default horizontal line', () => {
    const c = ctx();
    const down = step(idle('line', []), { type: 'pointerDown', p: at(10, 10) }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(11, 10) }, c);
    expect(commands(up.effects)[0]).toMatchObject({
      shape: { type: 'line', x: 10, y: 10, w: DEFAULT_SIZE.line.w, h: 0 },
    });
  });

  it('setTool clears the selection unless switching to select', () => {
    const s = idle('select', ['r1']);
    expect(step(s, { type: 'setTool', tool: 'ellipse' }, ctx()).state.selection).toEqual([]);
    expect(step(s, { type: 'setTool', tool: 'select' }, ctx()).state.selection).toEqual(['r1']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @relay/core -- tools`
Expected: FAIL — e.g. marquee mode is not produced, `'ellipse'`/`'line'`/`'code'` are not valid tools, and effects lack `overlay`.

- [ ] **Step 3: Extend `DEFAULT_SIZE` in `packages/core/src/schema/defaults.ts`**

Replace the `DEFAULT_SIZE` declaration with:

```ts
export const DEFAULT_SIZE: Record<
  'rect' | 'ellipse' | 'line' | 'sticky' | 'text' | 'code',
  { w: number; h: number }
> = {
  rect: { w: 160, h: 96 },
  ellipse: { w: 160, h: 96 },
  line: { w: 160, h: 0 },
  sticky: { w: 180, h: 140 },
  text: { w: 320, h: 56 },
  code: { w: 280, h: 140 },
};
```

- [ ] **Step 4: Replace `packages/core/src/tools/machine.ts`**

```ts
import type { Command, NewShape } from '../commands/types';
import { rectFromPoints } from '../geometry/rect';
import { type Handle, resizeGeometry, shapesInRect } from '../geometry/shapes';
import { DEFAULT_SIZE, DEFAULT_STYLE } from '../schema/defaults';
import { type Point, type Rect, type Shape, type ShapeType, TEXT_TYPES } from '../schema/types';

export type ToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'text' | 'sticky' | 'code';
type DrawTool = 'rect' | 'ellipse' | 'line';
type ClickTool = 'text' | 'sticky' | 'code';

export interface PointerInfo {
  world: Point;
  shift: boolean;
  hitId: string | null;
  /** Resize handle under the pointer, if any (handles belong to the current selection). */
  handle?: Handle;
}

export type ToolEvent =
  | { type: 'pointerDown'; p: PointerInfo }
  | { type: 'pointerMove'; p: PointerInfo }
  | { type: 'pointerUp'; p: PointerInfo }
  | { type: 'doubleClick'; p: PointerInfo }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'deleteSelection' }
  | { type: 'nudge'; dx: number; dy: number }
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

export type ToolState = IdleState | DraggingState | ResizingState | DrawingState | MarqueeState;

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
  | { type: 'endGesture' };

export interface ToolContext {
  shapes: Readonly<Record<string, Shape>>;
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

const geometryOf = (s: Shape): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });

function newShape(ctx: ToolContext, type: DrawTool | ClickTool, rect: Rect): NewShape {
  return {
    id: ctx.newId(),
    type,
    ...rect,
    style: DEFAULT_STYLE[type],
    text: '',
    createdBy: ctx.userId,
    authorName: ctx.userName,
    createdAt: ctx.now(),
  };
}

const pastThreshold = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_THRESHOLD;

function movedRects(state: DraggingState, p: Point): Record<string, Rect> {
  const dx = p.x - state.origin.x;
  const dy = p.y - state.origin.y;
  const rects: Record<string, Rect> = {};
  for (const [id, s] of Object.entries(state.starts)) rects[id] = { ...s, x: s.x + dx, y: s.y + dy };
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
  const hits = shapesInRect(ctx.shapes, rectFromPoints(state.origin, p));
  return [...state.base, ...hits.filter((id) => !state.base.includes(id))];
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
        selection = state.selection.includes(hit)
          ? state.selection.filter((id) => id !== hit)
          : [...state.selection, hit];
      } else {
        selection = state.selection.includes(hit) ? state.selection : [hit];
      }
      if (!selection.includes(hit)) return none(idle('select', selection));
      const starts: Record<string, Rect> = {};
      for (const id of selection) {
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
    case 'rect':
    case 'ellipse':
    case 'line':
      return {
        state: {
          mode: 'drawing',
          tool: state.tool,
          selection: [],
          origin: p.world,
          current: p.world,
        },
        effects: [preview({ kind: state.tool, rect: drawnRect(state.tool, p.world, p.world) })],
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
        effects: [
          command({ type: 'CreateShape', shape }),
          { type: 'endGesture' },
          { type: 'editText', id: shape.id },
        ],
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
        effects: [command({ type: 'DeleteShapes', ids: state.selection }), { type: 'endGesture' }],
      };
    case 'nudge': {
      const moves = state.selection.flatMap((id) => {
        const s = ctx.shapes[id];
        return s ? [{ id, x: s.x + event.dx, y: s.y + event.dy }] : [];
      });
      if (moves.length === 0) return none(state);
      return {
        state,
        effects: [command({ type: 'MoveShapes', moves }), { type: 'endGesture' }],
      };
    }
    case 'doubleClick': {
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

function stepDragging(state: DraggingState, event: ToolEvent): StepResult {
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
      return {
        state: next,
        effects: [
          command(moveCommand(movedRects(state, event.p.world))),
          overlay(null),
          { type: 'endGesture' },
        ],
      };
    }
    case 'cancel': {
      const next = idle('select', state.selection);
      if (!state.moved) return none(next);
      return {
        state: next,
        effects: [
          command(moveCommand(movedRects(state, state.origin))),
          overlay(null),
          { type: 'endGesture' },
        ],
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
        effects: [
          command(resizeCommand(state.id, resized(state, event.p))),
          overlay(null),
          { type: 'endGesture' },
        ],
      };
    }
    case 'cancel': {
      const next = idle('select', state.selection);
      if (!state.moved) return none(next);
      return {
        state: next,
        effects: [
          command(resizeCommand(state.id, state.start)),
          overlay(null),
          { type: 'endGesture' },
        ],
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
          preview({ kind: state.tool, rect: drawnRect(state.tool, state.origin, event.p.world) }),
        ],
      };
    case 'pointerUp': {
      let rect = drawnRect(state.tool, state.origin, event.p.world);
      const tooSmall =
        state.tool === 'line'
          ? Math.hypot(rect.w, rect.h) < MIN_DRAW
          : rect.w < MIN_DRAW || rect.h < MIN_DRAW;
      if (tooSmall) rect = { x: state.origin.x, y: state.origin.y, ...DEFAULT_SIZE[state.tool] };
      const shape = newShape(ctx, state.tool, rect);
      return {
        state: idle('select', [shape.id]),
        effects: [preview(null), command({ type: 'CreateShape', shape }), { type: 'endGesture' }],
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

/** Pure tool reducer: (state, event) → (state, effects). */
export function step(state: ToolState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (state.mode) {
    case 'idle':
      return stepIdle(state, event, ctx);
    case 'dragging':
      return stepDragging(state, event);
    case 'resizing':
      return stepResizing(state, event);
    case 'drawing':
      return stepDrawing(state, event, ctx);
    case 'marquee':
      return stepMarquee(state, event, ctx);
  }
}
```

- [ ] **Step 5: Run the core tests to verify they pass**

Run: `npm test -w @relay/core && npm run typecheck -w @relay/core`
Expected: PASS (all core tests, including the rewritten tools spec).

- [ ] **Step 6: Keep the web app compiling against the new `preview` effect**

In `apps/web/src/board/controller.ts`:
- change the `@relay/core` import so it also imports `type Preview` (keep `type Rect` only if still used elsewhere in the file — after this step it is not, so remove it);
- change `preview: Rect | null;` in `BoardUiState` to `preview: Preview | null;`;
- change the `'preview'` case in `run` to `ui.setState({ preview: effect.preview });`.
(`overlay` effects are ignored until Task 4.)

In `apps/web/src/render/Canvas.tsx`, in the `{preview && (<rect ... />)}` block, read the geometry from `preview.rect`: `x={preview.rect.x} y={preview.rect.y} width={preview.rect.w} height={preview.rect.h}`. (Kinds are rendered in Task 5.)

Run: `npm run typecheck && npm test && npm run lint`
Expected: all green across workspaces.

- [ ] **Step 7: Commit**

```bash
git add packages/core apps/web/src/board/controller.ts apps/web/src/render/Canvas.tsx
git commit -m "feat(core): tool FSM with marquee, resize, overlay previews, nudge and ellipse/line/code tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web controller — local overlay, undo/redo, keyboard

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Replace: `apps/web/src/ui/useShortcuts.ts`
- Test: `apps/web/test/controller.test.ts` (add cases)

**Interfaces:**
- Consumes: `createUndo`, `type Undo`, `type Preview`, `type Rect`, `step`, effects from Task 3.
- Produces:
  - `BoardUiState` = `{ tool: ToolState; preview: Preview | null; overlay: Record<string, Rect> | null; editingId: string | null; camera: Camera }` (`overlay` initially `null`)
  - `BoardController` gains `undo(): void` and `redo(): void`; `stopEditing()` now also ends the current undo step.
- Behaviour: `overlay` effects set `ui.overlay`; `endGesture` calls `stopCapturing()`; the undo manager uses `captureTimeout: 60_000`, so steps are delimited explicitly by gestures and by the end of a text-editing session. `undo`/`redo` do nothing while a gesture is in progress (tool mode not `idle`); they cancel pending throttled commits, close the text editor and clear `overlay`/`preview` first.
- Keyboard: `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` and `Ctrl/⌘+Y` redo (never while typing in a field); tool keys `V R O L T S C`; arrow keys nudge the selection by 1 (Shift: 10); `Delete`/`Backspace` delete; `Escape` cancels.

- [ ] **Step 1: Write the failing tests** — append inside `describe('board controller', ...)` in `apps/web/test/controller.test.ts` (the file already uses fake timers in `beforeEach`, a `setup()` helper and an `at()` helper; add `LOCAL_ORIGIN` to the `@relay/core` import if you need it — the tests below do not):

```ts
  function addRect(doc: Y.Doc, id = 'r1') {
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id,
        type: 'rect',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        style: DEFAULT_STYLE.rect,
        text: '',
        createdBy: 'u1',
        authorName: 'Brisk Otter',
        createdAt: 0,
      },
    });
  }

  it('shows a local overlay on every move and clears it when the drag ends', () => {
    const { doc, controller } = setup();
    addRect(doc);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(20, 10) });
    expect(controller.ui.getState().overlay).toEqual({ r1: { x: 10, y: 0, w: 100, h: 100 } });
    controller.dispatch({ type: 'pointerMove', p: at(30, 10) });
    expect(controller.ui.getState().overlay).toEqual({ r1: { x: 20, y: 0, w: 100, h: 100 } });
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(10); // commit still throttled
    controller.dispatch({ type: 'pointerUp', p: at(40, 10) });
    expect(controller.ui.getState().overlay).toBeNull();
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(30);
  });

  it('undoes a whole drag in one step and redoes it', () => {
    const { doc, controller } = setup();
    addRect(doc);
    const x = () => getRoots(doc).shapes.get('r1')?.get('x');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(20, 10) });
    controller.dispatch({ type: 'pointerMove', p: at(30, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(40, 10) });
    expect(x()).toBe(30);
    controller.undo();
    expect(x()).toBe(0);
    controller.redo();
    expect(x()).toBe(30);
  });

  it('never undoes a remote change', () => {
    const { doc, controller } = setup();
    applyCommand(
      doc,
      {
        type: 'CreateShape',
        shape: {
          id: 'remote',
          type: 'rect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          style: DEFAULT_STYLE.rect,
          text: '',
          createdBy: 'u2',
          authorName: 'Calm Heron',
          createdAt: 0,
        },
      },
      'remote',
    );
    controller.undo();
    expect(getRoots(doc).shapes.has('remote')).toBe(true);
  });

  it('treats a text-editing session as its own undo step', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.applyText('s1', { index: 0, deleteCount: 0, insert: 'Hi' });
    controller.applyText('s1', { index: 2, deleteCount: 0, insert: ' there' });
    controller.stopEditing();
    const text = () => getRoots(doc).shapes.get('s1')?.get('text')?.toString();
    expect(text()).toBe('Hi there');
    controller.undo();
    expect(text()).toBe('');
    controller.undo();
    expect(getRoots(doc).shapes.has('s1')).toBe(false);
  });

  it('ignores undo while a gesture is in progress', () => {
    const { doc, controller } = setup();
    addRect(doc);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    controller.undo();
    expect(controller.ui.getState().tool.mode).toBe('dragging');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @relay/web -- controller`
Expected: FAIL — `overlay` is undefined on the UI state and `controller.undo` is not a function.

- [ ] **Step 3: Update `apps/web/src/board/controller.ts`**

Replace the file with:

```ts
import {
  applyCommand,
  type Camera,
  type Command,
  createUndo,
  type Effect,
  type Identity,
  initialToolState,
  LOCAL_ORIGIN,
  type Preview,
  type Rect,
  step,
  type TextDiff,
  type ToolEvent,
  type ToolState,
  throttle,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DocState } from '../store/docStore';

export interface BoardUiState {
  tool: ToolState;
  preview: Preview | null;
  /** Local-only geometry for shapes being dragged/resized, rendered every frame. */
  overlay: Record<string, Rect> | null;
  editingId: string | null;
  camera: Camera;
}

export interface BoardController {
  ui: StoreApi<BoardUiState>;
  dispatch(event: ToolEvent): void;
  setCamera(camera: Camera): void;
  applyText(id: string, diff: TextDiff): void;
  stopEditing(): void;
  undo(): void;
  redo(): void;
  destroy(): void;
}

/** Undo steps are delimited explicitly (gesture end, text-session end), not by time. */
const UNDO_CAPTURE_TIMEOUT = 60_000;

export function createBoardController(opts: {
  doc: Y.Doc;
  docStore: StoreApi<DocState>;
  user: Identity;
  newId?: () => string;
  now?: () => number;
}): BoardController {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  const ui = createStore<BoardUiState>(() => ({
    tool: initialToolState(),
    preview: null,
    overlay: null,
    editingId: null,
    camera: { x: 0, y: 0, zoom: 1 },
  }));
  const undoStack = createUndo(opts.doc, { captureTimeout: UNDO_CAPTURE_TIMEOUT });

  const commit = (command: Command) => applyCommand(opts.doc, command, LOCAL_ORIGIN);
  const throttledCommit = throttle(commit, 50);

  const run = (effects: Effect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'command':
          if (effect.throttle) {
            throttledCommit(effect.command);
          } else {
            throttledCommit.cancel();
            commit(effect.command);
          }
          break;
        case 'preview':
          ui.setState({ preview: effect.preview });
          break;
        case 'overlay':
          ui.setState({ overlay: effect.rects });
          break;
        case 'editText':
          ui.setState({ editingId: effect.id });
          break;
        case 'endGesture':
          undoStack.stopCapturing();
          break;
      }
    }
  };

  const stopEditing = () => {
    ui.setState({ editingId: null });
    undoStack.stopCapturing();
  };

  const travel = (direction: 'undo' | 'redo') => {
    if (ui.getState().tool.mode !== 'idle') return;
    throttledCommit.cancel();
    if (ui.getState().editingId) stopEditing();
    ui.setState({ overlay: null, preview: null });
    if (direction === 'undo') undoStack.undo();
    else undoStack.redo();
  };

  // Close the editor if the edited shape is deleted (locally, remotely or by undo).
  const unsubscribe = opts.docStore.subscribe((doc) => {
    const { editingId } = ui.getState();
    if (editingId && !doc.shapes[editingId]) ui.setState({ editingId: null });
  });

  return {
    ui,
    dispatch(event) {
      const { state, effects } = step(ui.getState().tool, event, {
        shapes: opts.docStore.getState().shapes,
        userId: opts.user.id,
        userName: opts.user.name,
        newId,
        now,
      });
      ui.setState({ tool: state });
      run(effects);
    },
    setCamera(camera) {
      ui.setState({ camera });
    },
    applyText(id, diff) {
      commit({ type: 'SetText', id, ...diff });
    },
    stopEditing,
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    destroy() {
      throttledCommit.cancel();
      unsubscribe();
      undoStack.destroy();
    },
  };
}
```

- [ ] **Step 4: Replace `apps/web/src/ui/useShortcuts.ts`**

```ts
import type { ToolId } from '@relay/core';
import { useEffect } from 'react';
import type { BoardController } from '../board/controller';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  s: 'sticky',
  c: 'code',
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export function useShortcuts(controller: BoardController) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          controller.undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          controller.redo();
        }
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) {
        controller.dispatch({ type: 'setTool', tool });
        return;
      }
      const nudge = NUDGE[e.key];
      if (nudge) {
        e.preventDefault();
        const stepSize = e.shiftKey ? 10 : 1;
        controller.dispatch({ type: 'nudge', dx: nudge[0] * stepSize, dy: nudge[1] * stepSize });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        controller.dispatch({ type: 'deleteSelection' });
      } else if (e.key === 'Escape') {
        controller.dispatch({ type: 'cancel' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @relay/web && npm run typecheck -w @relay/web && npm run lint`
Expected: PASS (existing controller tests keep passing; the five new ones pass).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/board/controller.ts apps/web/src/ui/useShortcuts.ts apps/web/test/controller.test.ts
git commit -m "feat(web): local drag/resize overlay, per-user undo/redo and new keyboard shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Render ellipses, lines and code blocks; toolbar; shared typography

**Files:**
- Create: `apps/web/src/render/typography.ts`
- Replace: `apps/web/src/render/ShapeView.tsx`, `apps/web/src/ui/Toolbar.tsx`
- Modify: `apps/web/src/render/Canvas.tsx` (preview kinds), `apps/web/src/render/TextEditor.tsx`

**Interfaces:**
- Consumes: `Preview`, `PreviewKind`, `ShapeType`, `PALETTE`, `initials` (core); `BoardSession` (web).
- Produces:
  - `TEXT_STYLE: Record<ShapeType, string>`, `TEXT_BOX: Record<ShapeType, string>`, `isCentered(type: ShapeType): boolean`, `CODE_HEADER = 22` in `render/typography.ts`.
  - DOM: ellipse shapes render `<ellipse>` elements (shadow + body); lines render two `<line>` elements (visible stroke + 14 px transparent hit stroke with `pointerEvents="stroke"`); code blocks render a dark header strip with `{ }` and a `<pre>` body; the marquee preview carries `data-testid="marquee"`.
  - Toolbar buttons `tool-select`, `tool-rect`, `tool-ellipse`, `tool-line`, `tool-text`, `tool-sticky`, `tool-code` with shortcut hints `V R O L T S C`.

- [ ] **Step 1: Create `apps/web/src/render/typography.ts`**

```ts
import type { ShapeType } from '@relay/core';

/**
 * Text styles shared by ShapeView (read) and TextEditor (edit) so the
 * textarea lines up exactly with the rendered text.
 */
export const TEXT_STYLE: Record<ShapeType, string> = {
  rect: 'text-[13px] font-bold uppercase leading-snug text-center',
  ellipse: 'text-[13px] font-bold uppercase leading-snug text-center',
  line: '',
  sticky: 'text-[14px] font-semibold leading-snug',
  text: 'font-display text-[28px] uppercase leading-tight',
  code: 'font-mono text-[12px] leading-relaxed',
  frame: 'font-mono text-[11px] uppercase',
};

/** Padding of the text box inside the shape. */
export const TEXT_BOX: Record<ShapeType, string> = {
  rect: 'px-2',
  ellipse: 'px-6',
  line: '',
  sticky: 'p-3',
  text: '',
  code: 'px-3 pt-8 pb-3',
  frame: 'p-3',
};

/** Height of the dark header strip on code blocks (fits under `pt-8`). */
export const CODE_HEADER = 22;

/** Shapes whose label is vertically centred. */
export const isCentered = (type: ShapeType) => type === 'rect' || type === 'ellipse';
```

- [ ] **Step 2: Replace `apps/web/src/render/ShapeView.tsx`**

```tsx
import { initials, PALETTE, type Shape } from '@relay/core';
import { memo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { CODE_HEADER, TEXT_BOX, TEXT_STYLE } from './typography';

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Shadow({ s }: { s: Shape }) {
  return <rect x={s.x + 4} y={s.y + 4} width={s.w} height={s.h} fill={PALETTE.ink} />;
}

function CenteredLabel({ s, editing }: { s: Shape; editing: boolean }) {
  return (
    <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
      <div className={`grid h-full place-items-center ${TEXT_BOX[s.type]}`}>
        <p
          className={`whitespace-pre-wrap break-words ${TEXT_STYLE[s.type]} ${editing ? 'invisible' : ''}`}
        >
          {s.text}
        </p>
      </div>
    </foreignObject>
  );
}

function Body({ s, editing }: { s: Shape; editing: boolean }) {
  const hidden = editing ? 'invisible' : '';
  switch (s.type) {
    case 'sticky':
      return (
        <>
          <Shadow s={s} />
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={2}
          />
          <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
            <div className={`flex h-full flex-col justify-between ${TEXT_BOX.sticky}`}>
              <p className={`whitespace-pre-wrap break-words ${TEXT_STYLE.sticky} ${hidden}`}>
                {s.text}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-wider opacity-70">
                {initials(s.authorName)} · {timeOf(s.createdAt)}
              </p>
            </div>
          </foreignObject>
        </>
      );
    case 'text':
      return (
        <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
          <p className={`whitespace-pre-wrap break-words ${TEXT_STYLE.text} ${hidden}`}>
            {s.text || (editing ? '' : 'Text')}
          </p>
        </foreignObject>
      );
    case 'ellipse': {
      const rx = s.w / 2;
      const ry = s.h / 2;
      const cx = s.x + rx;
      const cy = s.y + ry;
      return (
        <>
          <ellipse cx={cx + 4} cy={cy + 4} rx={rx} ry={ry} fill={PALETTE.ink} />
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={3}
          />
          <CenteredLabel s={s} editing={editing} />
        </>
      );
    }
    case 'line':
      return (
        <>
          <line
            x1={s.x}
            y1={s.y}
            x2={s.x + s.w}
            y2={s.y + s.h}
            stroke={s.style.stroke}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {/* A wide invisible stroke so a 3px line is easy to grab. */}
          <line
            x1={s.x}
            y1={s.y}
            x2={s.x + s.w}
            y2={s.y + s.h}
            stroke="transparent"
            strokeWidth={14}
            pointerEvents="stroke"
          />
        </>
      );
    case 'code':
      return (
        <>
          <Shadow s={s} />
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={3}
          />
          <rect x={s.x} y={s.y} width={s.w} height={CODE_HEADER} fill={PALETTE.ink} />
          <text
            x={s.x + 10}
            y={s.y + 15}
            fill={PALETTE.paper}
            fontSize={11}
            className="font-mono"
          >
            {'{ }'}
          </text>
          <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
            <pre
              className={`h-full overflow-hidden whitespace-pre-wrap break-words ${TEXT_BOX.code} ${TEXT_STYLE.code} ${hidden}`}
            >
              {s.text}
            </pre>
          </foreignObject>
        </>
      );
    default:
      return (
        <>
          <Shadow s={s} />
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={3}
          />
          <CenteredLabel s={s} editing={editing} />
        </>
      );
  }
}

export const ShapeView = memo(function ShapeView({
  id,
  session,
}: {
  id: string;
  session: BoardSession;
}) {
  const shape = useStore(session.doc, (s) => s.shapes[id]);
  const editing = useStore(session.controller.ui, (s) => s.editingId === id);
  if (!shape) return null;
  return (
    <g data-shape-id={id} className="cursor-move">
      <Body s={shape} editing={editing} />
    </g>
  );
});
```

- [ ] **Step 3: Replace `apps/web/src/ui/Toolbar.tsx`**

```tsx
import type { ToolId } from '@relay/core';
import { Braces, Circle, MousePointer2, Slash, Square, StickyNote, Type } from 'lucide-react';
import type { ComponentType } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const TOOLS: {
  id: ToolId;
  label: string;
  key: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'line', label: 'Line', key: 'L', Icon: Slash },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'sticky', label: 'Sticky note', key: 'S', Icon: StickyNote },
  { id: 'code', label: 'Code block', key: 'C', Icon: Braces },
];

export function Toolbar({ session }: { session: BoardSession }) {
  const active = useStore(session.controller.ui, (s) => s.tool.tool);
  return (
    <nav
      aria-label="Tools"
      className="absolute left-3 top-3 flex flex-col gap-1.5 border-[3px] border-ink bg-white p-1.5 shadow-hard"
    >
      {TOOLS.map(({ id, label, key, Icon }) => (
        <button
          key={id}
          type="button"
          data-testid={`tool-${id}`}
          aria-label={`${label} (${key})`}
          aria-pressed={active === id}
          title={`${label} (${key})`}
          onClick={() => session.controller.dispatch({ type: 'setTool', tool: id })}
          className={`grid size-9 place-items-center border-2 border-ink ${active === id ? 'bg-sun' : 'bg-white hover:bg-paper'}`}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </nav>
  );
}
```

If any of `Braces`, `Circle` or `Slash` is not exported by the installed `lucide-react`, pick the closest available icon (e.g. `Code`, `CircleDashed`, `Minus`) and note it in the report.

- [ ] **Step 4: Render preview kinds in `apps/web/src/render/Canvas.tsx`**

Add `type Preview` to the `@relay/core` import, add this component above `export function Canvas`:

```tsx
function PreviewShape({ preview, zoom }: { preview: Preview; zoom: number }) {
  const { kind, rect: r } = preview;
  const stroke = {
    stroke: PALETTE.cobalt,
    strokeWidth: 2 / zoom,
    strokeDasharray: `${6 / zoom} ${4 / zoom}`,
    pointerEvents: 'none' as const,
  };
  if (kind === 'line') {
    return <line x1={r.x} y1={r.y} x2={r.x + r.w} y2={r.y + r.h} {...stroke} />;
  }
  if (kind === 'ellipse') {
    return (
      <ellipse
        cx={r.x + r.w / 2}
        cy={r.y + r.h / 2}
        rx={r.w / 2}
        ry={r.h / 2}
        fill="none"
        {...stroke}
      />
    );
  }
  return (
    <rect
      data-testid={kind === 'marquee' ? 'marquee' : undefined}
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      fill={kind === 'marquee' ? `${PALETTE.cobalt}14` : 'none'}
      {...stroke}
    />
  );
}
```

and replace the whole `{preview && ( <rect ... /> )}` block inside the camera `<g>` with:

```tsx
        {preview && <PreviewShape preview={preview} zoom={camera.zoom} />}
```

- [ ] **Step 5: Use shared typography in `apps/web/src/render/TextEditor.tsx`**

1. Delete the local `STYLE_BY_TYPE` constant and import `{ isCentered, TEXT_BOX, TEXT_STYLE } from './typography'`.
2. Extract the body of `onInput` into a function inside the component so Tab can reuse it:

```tsx
  const commitValue = (id: string, next: string) => {
    const d = diffText(lastText.current, next);
    lastText.current = next;
    if (d) controller.applyText(id, d);
  };
```

3. Replace the `<textarea ... />` element with:

```tsx
      <textarea
        ref={ref}
        data-testid="text-editor"
        aria-label="Edit text"
        className={`size-full resize-none bg-transparent outline-none ${TEXT_BOX[shape.type]} ${TEXT_STYLE[shape.type]}`}
        style={isCentered(shape.type) ? { paddingTop: Math.max(8, shape.h / 2 - 10) } : undefined}
        onInput={(e) => commitValue(editingId, e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.currentTarget.blur();
          } else if (e.key === 'Tab' && shape.type === 'code') {
            e.preventDefault();
            const el = e.currentTarget;
            el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
            commitValue(editingId, el.value);
          }
        }}
        onBlur={() => controller.stopEditing()}
      />
```

- [ ] **Step 6: Verify build, lint and tests**

Run: `npm run typecheck && npm test && npm run lint && npm run build -w @relay/web`
Expected: all green.

- [ ] **Step 7: Verify in the browser**

With the sync and web dev servers running, open a new board and check: press `O` and drag → an ellipse with a hard shadow; `L` and drag → a line that can be clicked and dragged; `C` and click → a code block with a dark `{ }` header opens its editor, Tab inserts two spaces; the toolbar shows 7 tools with the active one highlighted in yellow; dragging a rect/ellipse/line tool shows a dashed preview of the right kind; no console errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/render apps/web/src/ui/Toolbar.tsx
git commit -m "feat(web): render ellipses, lines and code blocks; 7-tool toolbar; shared typography

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Selection handles, overlay-aware rendering, handle hit-testing

**Files:**
- Create: `apps/web/src/render/useShape.ts`
- Replace: `apps/web/src/render/SelectionLayer.tsx`
- Modify: `apps/web/src/render/ShapeView.tsx`, `apps/web/src/render/TextEditor.tsx`, `apps/web/src/render/Canvas.tsx`

**Interfaces:**
- Consumes: `BoardUiState.overlay` (Task 4); `Handle`, `handlePoint`, `handlesFor`, `isHandle`, `shapeBounds` (Task 1).
- Produces:
  - `useShape(session: BoardSession, id: string | null): Shape | undefined` — the document shape with the local overlay geometry applied.
  - DOM: one `<rect data-handle="<handle>">` per handle of a single selected shape (8 for boxes, `start`/`end` for lines), interactive (`pointerEvents="all"`) with resize cursors; local selection outlines carry `data-testid="selection-outline"`; the `W × H` label shows the bounds of the (overlay-aware) single selection.
  - `Canvas` reports `handle` in `PointerInfo` when the pointer is on a handle.

- [ ] **Step 1: Create `apps/web/src/render/useShape.ts`**

```ts
import type { Shape } from '@relay/core';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/**
 * The document shape with the local overlay applied. While this user drags or
 * resizes, the overlay holds the latest geometry (updated every pointer move)
 * and the document catches up through throttled commits.
 */
export function useShape(session: BoardSession, id: string | null): Shape | undefined {
  const base = useStore(session.doc, (s) => (id ? s.shapes[id] : undefined));
  const over = useStore(session.controller.ui, (s) => (id ? s.overlay?.[id] : undefined));
  return useMemo(() => (base && over ? { ...base, ...over } : base), [base, over]);
}
```

- [ ] **Step 2: Make shapes and the editor overlay-aware**

In `apps/web/src/render/ShapeView.tsx`, import `useShape` from `./useShape` and replace
`const shape = useStore(session.doc, (s) => s.shapes[id]);` with `const shape = useShape(session, id);`.

In `apps/web/src/render/TextEditor.tsx`, import `useShape` from `./useShape` and replace
`const shape = useStore(session.doc, (s) => (editingId ? s.shapes[editingId] : undefined));` with
`const shape = useShape(session, editingId);`.

- [ ] **Step 3: Replace `apps/web/src/render/SelectionLayer.tsx`**

```tsx
import {
  type Handle,
  handlePoint,
  handlesFor,
  PALETTE,
  type Rect,
  type Shape,
  shapeBounds,
} from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const PAD = 4;
const HANDLE_PX = 9;

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  start: 'crosshair',
  end: 'crosshair',
};

const outline = (b: Rect) => ({
  x: b.x - PAD,
  y: b.y - PAD,
  width: b.w + PAD * 2,
  height: b.h + PAD * 2,
});

export function SelectionLayer({ session }: { session: BoardSession }) {
  const ui = session.controller.ui;
  const selection = useStore(ui, (s) => s.tool.selection);
  const zoom = useStore(ui, (s) => s.camera.zoom);
  const overlay = useStore(ui, (s) => s.overlay);
  const shapes = useStore(session.doc, (s) => s.shapes);
  const peers = useStore(session.presence, (s) => s.peers);
  const stroke = 2 / zoom;
  const handleSize = HANDLE_PX / zoom;

  const current = (id: string): Shape | undefined => {
    const s = shapes[id];
    const o = overlay?.[id];
    return s && o ? { ...s, ...o } : s;
  };
  const single = selection.length === 1 ? current(selection[0] ?? '') : undefined;
  const singleBounds = single ? shapeBounds(single) : undefined;

  return (
    <g pointerEvents="none">
      {peers.flatMap((peer) =>
        peer.selection.map((id) => {
          const s = shapes[id];
          if (!s) return null;
          return (
            <rect
              key={`${peer.clientId}:${id}`}
              {...outline(shapeBounds(s))}
              fill="none"
              stroke={peer.user.color}
              strokeWidth={stroke}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            />
          );
        }),
      )}
      {selection.map((id) => {
        const s = current(id);
        if (!s) return null;
        return (
          <rect
            key={id}
            data-testid="selection-outline"
            {...outline(shapeBounds(s))}
            fill="none"
            stroke={PALETTE.cobalt}
            strokeWidth={stroke}
          />
        );
      })}
      {single && singleBounds && (
        <g
          transform={`translate(${singleBounds.x + singleBounds.w / 2} ${singleBounds.y + singleBounds.h + PAD + 8 / zoom}) scale(${1 / zoom})`}
        >
          <rect x={-36} y={0} width={72} height={18} fill={PALETTE.cobalt} />
          <text
            x={0}
            y={13}
            textAnchor="middle"
            fill={PALETTE.white}
            className="font-mono"
            fontSize={10}
          >
            {`${Math.round(singleBounds.w)} × ${Math.round(singleBounds.h)}`}
          </text>
        </g>
      )}
      {single &&
        handlesFor(single.type).map((h) => {
          const pt = handlePoint(single, h);
          return (
            <rect
              key={h}
              data-handle={h}
              x={pt.x - handleSize / 2}
              y={pt.y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              fill={PALETTE.white}
              stroke={PALETTE.cobalt}
              strokeWidth={stroke}
              pointerEvents="all"
              style={{ cursor: CURSOR[h] }}
            />
          );
        })}
    </g>
  );
}
```

- [ ] **Step 4: Report handles from `Canvas` and subscribe to `order` shallowly**

In `apps/web/src/render/Canvas.tsx`:

1. Add `isHandle` to the `@relay/core` import and `import { useShallow } from 'zustand/react/shallow';`.
2. Replace `const order = useStore(session.doc, (s) => s.order);` with
   `const order = useStore(session.doc, useShallow((s) => s.order));` (a remote edit to one shape no longer re-renders every `ShapeView`).
3. Replace the body of `info` after the `screen` line with:

```tsx
    // Hit-test by position, not e.target: while the SVG holds pointer capture —
    // and for the click/dblclick that follows it — the browser retargets events
    // to the <svg> itself, which would hide the shape under the pointer.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const hit = el?.closest('[data-shape-id]');
    const handle = el?.closest('[data-handle]')?.getAttribute('data-handle');
    return {
      world: screenToWorld(controller.ui.getState().camera, screen),
      shift: e.shiftKey,
      hitId: hit?.getAttribute('data-shape-id') ?? null,
      ...(isHandle(handle) ? { handle } : {}),
    };
```

If `zustand/react/shallow` does not resolve in the Next build, import `useShallow` from `zustand/shallow` instead (Zustand 5 exposes it from both in some versions); report which one worked.

- [ ] **Step 5: Verify build, lint and tests**

Run: `npm run typecheck && npm test && npm run lint && npm run build -w @relay/web`
Expected: all green.

- [ ] **Step 6: Verify in the browser**

With both dev servers running, in a new board: select a rectangle → 8 white handles appear; drag the `se` handle → the shape follows the pointer smoothly (no 50 ms stepping) and the `W × H` label updates live; Shift keeps the proportions; drag the `nw` handle past the opposite corner → the shape flips instead of disappearing; select a line → only 2 endpoint handles; drag a shape → it follows every frame; drag on empty canvas → a tinted marquee selects everything it touches; `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo the last gesture; arrow keys nudge; open a second browser on the same board and confirm it sees moves and resizes (at the throttled rate). No console errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/render
git commit -m "feat(web): resize handles, overlay-aware rendering at 60 fps and marquee visuals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end coverage and documentation

**Files:**
- Create: `e2e/editing.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-24-relay-design.md`, `README.md`, `README.es.md`

**Interfaces:**
- Consumes: the DOM contract (Global Constraints) and `POST /api/rooms`.
- Produces: `npm run e2e` covers resize + undo/redo seen by a second user, marquee + delete, and the three new tools.

- [ ] **Step 1: Write `e2e/editing.spec.ts`**

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newBoard(page: Page, request: APIRequestContext): Promise<string> {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  return path;
}

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('resize, undo and redo a rectangle, seen by a second user', async ({ page, browser, request }) => {
  const path = await newBoard(page, request);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.keyboard.press('r');
  await drag(page, { x: 300, y: 200 }, { x: 460, y: 300 });
  await expect(page.getByText('160 × 100')).toBeVisible();

  const handle = await page.locator('[data-handle=se]').boundingBox();
  if (!handle) throw new Error('se handle not rendered');
  const corner = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await drag(page, corner, { x: corner.x + 60, y: corner.y + 40 });
  await expect(page.getByText('220 × 140')).toBeVisible();
  // The shadow rect is the first <rect> of the shape and has the shape's width.
  await expect(pb.locator('[data-shape-id] rect').first()).toHaveAttribute('width', '220');

  await page.keyboard.press('Control+z');
  await expect(page.getByText('160 × 100')).toBeVisible();
  await expect(pb.locator('[data-shape-id] rect').first()).toHaveAttribute('width', '160');

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('220 × 140')).toBeVisible();
  await other.close();
});

test('marquee selects several shapes and Delete removes them', async ({ page, request }) => {
  await newBoard(page, request);
  for (const x of [300, 520]) {
    await page.keyboard.press('s');
    await page.mouse.click(x, 300);
    await page.keyboard.type(`note ${x}`);
    await page.keyboard.press('Escape');
  }
  await drag(page, { x: 150, y: 150 }, { x: 750, y: 480 });
  await expect(page.getByTestId('selection-outline')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-shape-id]')).toHaveCount(0);
});

test('draws ellipses, lines and code blocks', async ({ page, request }) => {
  await newBoard(page, request);

  await page.keyboard.press('o');
  await drag(page, { x: 250, y: 200 }, { x: 400, y: 300 });
  await expect(page.locator('[data-shape-id] ellipse')).toHaveCount(2); // shadow + body

  await page.keyboard.press('l');
  await drag(page, { x: 450, y: 200 }, { x: 600, y: 320 });
  await expect(page.locator('[data-shape-id] line')).toHaveCount(2); // stroke + hit area
  await expect(page.locator('[data-handle=start]')).toBeVisible();

  await page.keyboard.press('c');
  await page.mouse.click(400, 480);
  await page.getByTestId('text-editor').fill('const x = 1;');
  await page.keyboard.press('Escape');
  await expect(page.getByText('const x = 1;')).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run e2e`
Expected: all tests pass (the 3 existing collaboration tests and the 3 new ones). On failure, open the trace (`npx playwright show-trace test-results/**/trace.zip`) and fix the root cause; do not add sleeps or weaken assertions.

- [ ] **Step 3: Record the F2a decisions in the spec**

In `docs/superpowers/specs/2026-09-24-relay-design.md`:

1. Under `### Tool State Machine`, replace the bullet that starts with `- During drags, the local preview updates every frame;` with:

```
- During drags and resizes, the FSM emits an `overlay` effect with the
  current geometry on every pointer move; the web app renders shapes with
  that local geometry (so the gesture is smooth at display rate) while
  `MoveShapes` / `ResizeShapes` commits to the document stay throttled at
  50 ms, and a final exact commit plus `overlay: null` ends the gesture.
  `endGesture` triggers `stopCapturing()`.
```

2. Replace the paragraph under `### Hit-Testing and Spatial Index` with:

```
Clicks resolve the shape under the pointer by position
(`document.elementFromPoint`), because pointer capture retargets events to
the `<svg>`. Resize handles carry `data-handle` and are reported to the tool
FSM as `PointerInfo.handle`. Marquee selection uses a linear scan over shape
bounds (`shapesInRect`), which is ample for the hundreds of shapes a board
holds; an R-tree (`rbush`) can replace it behind the same signature if
profiling ever shows a need. Lines are hit through a 14 px transparent stroke.
```

3. In `### Commands and Undo`, append:

```
The undo manager uses a 60 s capture timeout, so undo steps are delimited
explicitly: every gesture ends one (`endGesture`), and so does closing the
text editor — a whole text-editing session is a single undo step. Undo and
redo are ignored while a gesture is in progress.
```

- [ ] **Step 4: Update the READMEs**

In `README.md`:
- In **What it does → Editing**, replace the bullet with: `- **Editing.** Select, rectangle, ellipse, line, text, sticky note and code-block tools with shortcuts (`V R O L T S C`). Drag to move and resize from 8 handles (Shift keeps proportions); marquee selection; arrow keys nudge; `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo your own changes only; double-click to edit text.`
- In **Engineering highlights**, add a row: `| Local preview | Drags and resizes render from a local overlay every frame while commits to the CRDT stay throttled at 50 ms | Smooth 60 fps gestures without flooding peers or the free-tier request quota |` and a row: `| Undo | Per-user `Y.UndoManager` tracking only this client's origins; one step per gesture or text-editing session; fuzzed in the convergence test | Undo never reverts someone else's work, and replicas still converge |`.
- In **Roadmap**, split F2: mark `- [x] **F2a — Editing core:** per-user undo/redo, resize handles, marquee selection, ellipses, lines, code blocks, 60 fps drag preview` and keep `- [ ] **F2b — Structure:** anchored connectors, frames with columns`.
- In **Known limitations**, remove the bullet about 20 Hz drags.

Apply the same changes in Spanish to `README.es.md` (Edición, filas equivalentes en la tabla, hoja de ruta con F2a hecha y F2b pendiente, y quitar la limitación del arrastre a 20 Hz).

- [ ] **Step 5: Full verification and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run e2e`
Expected: all green.

```bash
git add e2e/editing.spec.ts docs/superpowers/specs/2026-09-24-relay-design.md README.md README.es.md
git commit -m "test(e2e): cover resize, undo/redo, marquee and new tools; document F2a

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Spec coverage (F2 minus connectors/frames): ellipse and lines (Tasks 3, 5), code block (3, 5), selection + marquee (1, 3, 6), resize with 8 handles and `W × H` label (1, 3, 6), undo/redo per user (2, 4), 60 fps drag preview deferred from F1 (3, 4, 6), arrow-key nudge from the spec's Input section (3, 4). Connectors, frames with columns and the frame-related deferred minors (frame `parentId` normalization) belong to plan F2b.
- Deferred F1 minors addressed here: duplicated typography between ShapeView and TextEditor (Task 5), rect label padding vs resize (Task 5, centred padding from shape height), Canvas `order` shallow subscription (Task 6).
- Deviation recorded in the spec (Task 7): marquee uses a linear scan instead of `rbush`.
- Type consistency: `Preview`/`PreviewKind`/`Effect`/`ToolId` defined in Task 3 are consumed in Tasks 4–6; `Handle`/`isHandle`/`handlePoint`/`handlesFor`/`shapeBounds`/`resizeGeometry`/`shapesInRect` from Task 1 are consumed in Tasks 3 and 6; `createUndo`/`Undo` from Task 2 in Task 4; `BoardUiState.overlay` from Task 4 in Task 6.
