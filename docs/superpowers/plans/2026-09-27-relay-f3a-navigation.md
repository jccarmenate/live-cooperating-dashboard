# Relay F3a — Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board navigable and the collaboration visible. This covers:
- Ctrl/pinch zoom, space/middle-drag pan, zoom controls, a coordinates readout, and a per-room saved camera or an initial fit to the content.
- An interactive minimap that shows peer viewports.
- A "Name · typing…" indicator for peers.
- Frames that adopt and release shapes.
- The remaining F2b polish: a minimum frame height, arrowheads that are trimmed and clamped, and Enter committing a frame title.

**Architecture:**
- Pure geometry lives in `@relay/core`: camera fit/centre/viewport, minimap projection, frame membership inside the tool FSM, and arrow geometry.
- The camera is local Zustand view state. The web controller owns it, together with the canvas size, the pointer, whether Space is held and the one-shot initial fit.
- The Canvas drives pan and zoom outside the tool FSM.
- The peer viewport travels through awareness (throttled at 50 ms) and is validated on read.

**Tech Stack:** TypeScript, Yjs 13.6, Zustand 5, React 19 / Next.js 16, Tailwind 4, Vitest 4, Playwright, Biome 2.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`. The relevant sections are Navigation, Awareness, Frames, Connectors and Input.

## Global Constraints

- $0 / no credit card: no new paid service. No new runtime dependencies.
- `packages/core` stays platform-neutral: lib ES2023, `types: []`, no DOM/Node typings. Declare any global locally, like `util/throttle.ts` does.
- All document mutations go through `applyCommand(doc, cmd, origin)`. UI code never touches Yjs types directly.
- The camera is never part of the document.
- Keyboard shortcuts are ignored while typing in an input, textarea or contenteditable element.
- Awareness values from peers are untrusted and are validated in `parsePresence`.
- Do NOT edit `README.md` or `README.es.md`. The README is updated once at the end of the project.
- Tests: Vitest (`npm test`), typecheck (`npm run typecheck`), Biome (`npm run lint`; `npm run format` fixes formatting), Playwright (`npm run e2e`, which reuses dev servers already running on 8787 and 3000). Headed Playwright must use `channel: 'chrome'`.
- Specs and plans are written in English. Commits end with the attribution trailer given in the implementer instructions.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/geometry/camera.ts` (modify) | Camera math: `clampZoom` (now exported), `ZOOM_STEP`, `WHEEL_DELTA_CAP`, `wheelZoomFactor`, `viewportRect`, `centerOn`, `fitBounds`, `parseCamera` |
| `packages/core/src/geometry/minimap.ts` (create) | `contentBounds`, `minimapProjection`, `toMinimap`, `fromMinimap`, `rectToMinimap` |
| `packages/core/src/presence/state.ts` (modify) | `PresenceState.viewport` and its validation |
| `packages/core/src/geometry/shapes.ts` (modify) | `FRAME_MIN_H`, `minSize(type)`; `resizeGeometry` uses per-type minimums |
| `packages/core/src/tools/machine.ts` (modify) | `membershipMoves` replaces `reparentMoves`: frames adopt and release shapes on create/move/nudge/resize, and a resized shape re-evaluates its own membership |
| `packages/core/src/geometry/connectors.ts` (modify) | `ARROW_SIZE`, `arrowGeometry` |
| `apps/web/src/sync/presence.ts` (modify) | `setViewport` (throttled) |
| `apps/web/src/board/controller.ts` (modify) | Navigation UI state and methods, `CameraStorage`, initial fit |
| `apps/web/src/board/session.ts` (modify) | localStorage camera storage, `markSynced` on provider sync, viewport publishing |
| `apps/web/src/ui/shortcuts.ts` (create) | Pure key → action mapping (testable in Node) |
| `apps/web/src/ui/useShortcuts.ts` (modify) | Wires keydown/keyup/blur to the actions |
| `apps/web/src/render/Canvas.tsx` (modify) | Native wheel zoom/pan, pan gesture, pointer readout, size measurement |
| `apps/web/src/ui/ZoomControls.tsx` (create) | `− 100% +` and the `X · Y` readout |
| `apps/web/src/render/Minimap.tsx` (create) | Interactive minimap |
| `apps/web/src/render/SelectionLayer.tsx` (modify) | Peer "typing…" indicator |
| `apps/web/src/render/ConnectorView.tsx`, `TextEditor.tsx` (modify) | Arrow geometry; Enter commits a frame title |
| `apps/web/src/board/Board.tsx` (modify) | Mounts ZoomControls and Minimap |
| `e2e/navigation.spec.ts` (create) | End-to-end navigation, minimap, typing, adoption, frame title |

---

### Task 1: Core navigation math

**Files:**
- Modify: `packages/core/src/geometry/camera.ts`
- Create: `packages/core/src/geometry/minimap.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/navigation.test.ts` (create)

**Interfaces:**
- Consumes: `Camera`, `screenToWorld`, `MIN_ZOOM`, `MAX_ZOOM` (camera.ts); `centerOf`, `unionRects` (rect.ts); `shapeBounds` (shapes.ts).
- Produces:
  - `clampZoom(z: number): number` (now exported)
  - `ZOOM_STEP = 1.25`
  - `WHEEL_DELTA_CAP = 50`
  - `wheelZoomFactor(deltaY: number): number`
  - `viewportRect(cam: Camera, w: number, h: number): Rect`
  - `centerOn(cam: Camera, p: Point, w: number, h: number): Camera`
  - `fitBounds(bounds: Rect, w: number, h: number, padding?: number, maxZoom?: number): Camera`
  - `parseCamera(raw: unknown): Camera | null`
  - `interface MinimapProjection { world: Rect; scale: number; offsetX: number; offsetY: number }`
  - `contentBounds(shapes: Readonly<Record<string, Shape>>): Rect | null`
  - `minimapProjection(content: Rect | null, viewport: Rect, boxW: number, boxH: number, pad?: number): MinimapProjection`
  - `toMinimap(p: MinimapProjection, pt: Point): Point`
  - `fromMinimap(p: MinimapProjection, pt: Point): Point`
  - `rectToMinimap(p: MinimapProjection, r: Rect): Rect`

- [ ] **Step 1: Write the failing tests** in `packages/core/test/navigation.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  type Camera,
  centerOn,
  contentBounds,
  DEFAULT_STYLE,
  fitBounds,
  fromMinimap,
  MIN_ZOOM,
  minimapProjection,
  parseCamera,
  rectToMinimap,
  type Shape,
  toMinimap,
  viewportRect,
  wheelZoomFactor,
  worldToScreen,
} from '../src';

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    z: 'a0',
    style: DEFAULT_STYLE.rect,
    text: '',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 0,
    ...partial,
  };
}

describe('camera navigation', () => {
  it('viewportRect is the world rectangle on screen', () => {
    expect(viewportRect({ x: -100, y: -50, zoom: 2 }, 800, 600)).toEqual({
      x: 100,
      y: 50,
      w: 400,
      h: 300,
    });
  });

  it('centerOn keeps the zoom and puts the point at the viewport centre', () => {
    const cam = centerOn({ x: 0, y: 0, zoom: 2 }, { x: 500, y: 300 }, 800, 600);
    expect(cam).toEqual({ x: -300, y: -150, zoom: 2 });
    expect(worldToScreen(cam, { x: 500, y: 300 })).toEqual({ x: 400, y: 300 });
  });

  it('fitBounds shrinks to fit, centred, with padding', () => {
    const cam = fitBounds({ x: 0, y: 0, w: 1000, h: 500 }, 800, 600);
    expect(cam.zoom).toBeCloseTo(0.704, 6); // (800 - 2·48) / 1000
    const c = worldToScreen(cam, { x: 500, y: 250 });
    expect(c.x).toBeCloseTo(400, 6);
    expect(c.y).toBeCloseTo(300, 6);
  });

  it('fitBounds never zooms past 100% and clamps to the minimum zoom', () => {
    expect(fitBounds({ x: 10, y: 10, w: 100, h: 100 }, 800, 600)).toEqual({
      x: 340,
      y: 240,
      zoom: 1,
    });
    expect(fitBounds({ x: 0, y: 0, w: 1e6, h: 1e6 }, 800, 600).zoom).toBe(MIN_ZOOM);
  });

  it('wheelZoomFactor is exponential and caps a single event', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-10)).toBeCloseTo(Math.exp(0.1), 12);
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.5), 12);
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.5), 12);
  });

  it('parseCamera accepts only finite cameras within the zoom range', () => {
    const ok: Camera = { x: 1, y: -2, zoom: 1.5 };
    expect(parseCamera(ok)).toEqual(ok);
    expect(parseCamera({ x: 1, y: 2, zoom: 5 })).toBeNull();
    expect(parseCamera({ x: Number.NaN, y: 2, zoom: 1 })).toBeNull();
    expect(parseCamera({ x: '1', y: 2, zoom: 1 })).toBeNull();
    expect(parseCamera(null)).toBeNull();
  });
});

describe('minimap projection', () => {
  it('contentBounds unions every shape (lines normalized) and is null when empty', () => {
    expect(contentBounds({})).toBeNull();
    expect(
      contentBounds({
        r: shape('r', { x: 0, y: 0, w: 100, h: 50 }),
        l: shape('l', { type: 'line', x: 300, y: 200, w: -100, h: 100 }),
      }),
    ).toEqual({ x: 0, y: 0, w: 300, h: 300 });
  });

  it('projects the padded viewport into the box when there is no content', () => {
    const p = minimapProjection(null, { x: 0, y: 0, w: 1000, h: 700 }, 200, 140);
    expect(p.world).toEqual({ x: -100, y: -70, w: 1200, h: 840 });
    expect(p.scale).toBeCloseTo(1 / 6, 12);
    expect(p.offsetX).toBeCloseTo(0, 12);
    expect(p.offsetY).toBeCloseTo(0, 12);
    const m = toMinimap(p, { x: 0, y: 0 });
    expect(m.x).toBeCloseTo(100 / 6, 9);
    expect(m.y).toBeCloseTo(70 / 6, 9);
  });

  it('keeps the aspect ratio and centres the union of content and viewport', () => {
    const p = minimapProjection(
      { x: 2000, y: 0, w: 1000, h: 700 },
      { x: 0, y: 0, w: 1000, h: 700 },
      200,
      140,
    );
    expect(p.world).toEqual({ x: -300, y: -70, w: 3600, h: 840 });
    expect(p.scale).toBeCloseTo(200 / 3600, 12);
    expect(p.offsetX).toBeCloseTo(0, 9);
    expect(p.offsetY).toBeCloseTo((140 - 840 * (200 / 3600)) / 2, 9);
    const r = rectToMinimap(p, { x: -300, y: -70, w: 3600, h: 840 });
    expect(r.w).toBeCloseTo(200, 9);
  });

  it('fromMinimap inverts toMinimap', () => {
    const p = minimapProjection({ x: 50, y: 80, w: 900, h: 300 }, { x: 0, y: 0, w: 640, h: 480 }, 200, 140);
    const back = fromMinimap(p, toMinimap(p, { x: 123, y: 456 }));
    expect(back.x).toBeCloseTo(123, 9);
    expect(back.y).toBeCloseTo(456, 9);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- navigation`
Expected: FAIL. The imports `centerOn`, `fitBounds` and the others are not exported.

- [ ] **Step 3: Implement the camera helpers.** Replace `packages/core/src/geometry/camera.ts` with:

```ts
import type { Point, Rect } from '../schema/types';
import { centerOf } from './rect';

/** screen = (world + {x, y}) * zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Zoom-control step (× / ÷ per click). */
export const ZOOM_STEP = 1.25;
/** Largest |deltaY| one wheel event contributes to zoom: a mouse notch reports ~100. */
export const WHEEL_DELTA_CAP = 50;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom - cam.x, y: p.y / cam.zoom - cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x + cam.x) * cam.zoom, y: (p.y + cam.y) * cam.zoom };
}

/** Pans by a delta expressed in screen pixels. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x + dx / cam.zoom, y: cam.y + dy / cam.zoom, zoom: cam.zoom };
}

/** Zooms keeping the world point under `screenPoint` fixed. */
export function zoomAt(cam: Camera, screenPoint: Point, nextZoom: number): Camera {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(cam, screenPoint);
  return { x: screenPoint.x / zoom - world.x, y: screenPoint.y / zoom - world.y, zoom };
}

/** Zoom multiplier for one ctrl+wheel / pinch event. */
export function wheelZoomFactor(deltaY: number): number {
  const d = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, deltaY));
  return Math.exp(-d * 0.01);
}

/** World rectangle visible in a `w`×`h` px viewport. */
export function viewportRect(cam: Camera, w: number, h: number): Rect {
  const topLeft = screenToWorld(cam, { x: 0, y: 0 });
  return { x: topLeft.x, y: topLeft.y, w: w / cam.zoom, h: h / cam.zoom };
}

/** Same zoom, with the world point `p` at the centre of a `w`×`h` px viewport. */
export function centerOn(cam: Camera, p: Point, w: number, h: number): Camera {
  return { x: w / 2 / cam.zoom - p.x, y: h / 2 / cam.zoom - p.y, zoom: cam.zoom };
}

/** Camera showing `bounds` centred in a `w`×`h` px viewport with `padding` px, never above `maxZoom`. */
export function fitBounds(bounds: Rect, w: number, h: number, padding = 48, maxZoom = 1): Camera {
  const zoom = clampZoom(
    Math.min(
      maxZoom,
      Math.max(1, w - 2 * padding) / Math.max(1, bounds.w),
      Math.max(1, h - 2 * padding) / Math.max(1, bounds.h),
    ),
  );
  return centerOn({ x: 0, y: 0, zoom }, centerOf(bounds), w, h);
}

/** Validates a camera read back from storage. */
export function parseCamera(raw: unknown): Camera | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!(zoom >= MIN_ZOOM && zoom <= MAX_ZOOM)) return null;
  return { x, y, zoom };
}
```

- [ ] **Step 4: Create `packages/core/src/geometry/minimap.ts`**

```ts
import type { Point, Rect, Shape } from '../schema/types';
import { unionRects } from './rect';
import { shapeBounds } from './shapes';

/** Maps the `world` rectangle into a minimap box: box = (world − world.xy) · scale + offset. */
export interface MinimapProjection {
  world: Rect;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Bounds of every shape on the board, or null for an empty board. */
export function contentBounds(shapes: Readonly<Record<string, Shape>>): Rect | null {
  return unionRects(Object.values(shapes).map(shapeBounds));
}

/**
 * Fits the union of the content and the viewport, padded by `pad` of its size on each side,
 * into a `boxW`×`boxH` box, keeping the aspect ratio and centring it.
 */
export function minimapProjection(
  content: Rect | null,
  viewport: Rect,
  boxW: number,
  boxH: number,
  pad = 0.1,
): MinimapProjection {
  const base = (content ? unionRects([content, viewport]) : null) ?? viewport;
  const px = Math.max(base.w * pad, 1);
  const py = Math.max(base.h * pad, 1);
  const world = { x: base.x - px, y: base.y - py, w: base.w + 2 * px, h: base.h + 2 * py };
  const scale = Math.min(boxW / world.w, boxH / world.h);
  return {
    world,
    scale,
    offsetX: (boxW - world.w * scale) / 2,
    offsetY: (boxH - world.h * scale) / 2,
  };
}

export function toMinimap(p: MinimapProjection, pt: Point): Point {
  return {
    x: (pt.x - p.world.x) * p.scale + p.offsetX,
    y: (pt.y - p.world.y) * p.scale + p.offsetY,
  };
}

export function fromMinimap(p: MinimapProjection, pt: Point): Point {
  return {
    x: (pt.x - p.offsetX) / p.scale + p.world.x,
    y: (pt.y - p.offsetY) / p.scale + p.world.y,
  };
}

export function rectToMinimap(p: MinimapProjection, r: Rect): Rect {
  const topLeft = toMinimap(p, r);
  return { x: topLeft.x, y: topLeft.y, w: r.w * p.scale, h: r.h * p.scale };
}
```

- [ ] **Step 5: Export it.** In `packages/core/src/index.ts`, add `export * from './geometry/minimap';` after `export * from './geometry/frames';`.

- [ ] **Step 6: Run the tests.** Run `npm test -w @relay/core`. Expected: PASS, and the existing geometry tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/geometry/camera.ts packages/core/src/geometry/minimap.ts packages/core/src/index.ts packages/core/test/navigation.test.ts
git commit -m "feat(core): camera fit/centre/viewport helpers and minimap projection"
```

---

### Task 2: Viewport in presence

**Files:**
- Modify: `packages/core/src/presence/state.ts`
- Modify: `apps/web/src/sync/presence.ts`
- Test: `packages/core/test/presence.test.ts`

**Interfaces:**
- Consumes: `Rect` (schema types), `throttle` (core).
- Produces:
  - `PresenceState.viewport: Rect | null`, and `Peer` inherits it.
  - `MAX_VIEWPORT_SIDE = 1e6`.
  - `PresencePublisher.setViewport(r: Rect | null): void`, throttled at 50 ms.

- [ ] **Step 1: Update the existing expectations and add the failing test** in `packages/core/test/presence.test.ts`.
  - Every `parsePresence(...)` expected object gains `viewport: null`. There are three such objects in "parsePresence validates and defaults fields" and "rejects a user.color…".
  - Add `viewport: null` to any `Peer` or `PresenceState` literal in the core and web tests. Search with `grep -rn "editing:" packages/core/test apps/web/test`.
  - Then add this test:

```ts
  it('parsePresence accepts only a finite, positive, bounded viewport', () => {
    const vp = { x: -10, y: 20, w: 800, h: 600 };
    expect(parsePresence({ user: alice, viewport: vp })?.viewport).toEqual(vp);
    expect(parsePresence({ user: alice, viewport: { ...vp, extra: 1 } })?.viewport).toEqual(vp);
    for (const bad of [
      { ...vp, w: 0 },
      { ...vp, h: -5 },
      { ...vp, w: 2e6 },
      { ...vp, x: Number.POSITIVE_INFINITY },
      { x: 0, y: 0 },
      'big',
    ]) {
      expect(parsePresence({ user: alice, viewport: bad })?.viewport).toBeNull();
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- presence`
Expected: FAIL, because `viewport` is missing from the parsed state.

- [ ] **Step 3: Implement.** In `packages/core/src/presence/state.ts`:
  - Import `Rect` alongside `Point`: `import type { Point, Rect } from '../schema/types';`.
  - Add to `PresenceState`, after `editing`:

```ts
  /** World rectangle this user is looking at (minimap), or null before the canvas is measured. */
  viewport: Rect | null;
```

  - Below `isPoint`, add:

```ts
/** Peers' viewports are untrusted: finite, positive and at most this many world units per side. */
export const MAX_VIEWPORT_SIDE = 1e6;

const isViewport = (v: unknown): v is Rect => {
  if (!isPoint(v)) return false;
  const { w, h } = v as Rect;
  return (
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0 &&
    w <= MAX_VIEWPORT_SIDE &&
    h <= MAX_VIEWPORT_SIDE
  );
};
```

  - In `parsePresence`'s returned object, after `editing`, add:

```ts
    viewport: isViewport(o.viewport)
      ? { x: o.viewport.x, y: o.viewport.y, w: o.viewport.w, h: o.viewport.h }
      : null,
```

- [ ] **Step 4: Add the publisher method.** Replace `apps/web/src/sync/presence.ts` with:

```ts
import { type Identity, type Point, type PresenceState, type Rect, throttle } from '@relay/core';
import type { Awareness } from 'y-protocols/awareness';

export interface PresencePublisher {
  setCursor(p: Point | null): void;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  setViewport(r: Rect | null): void;
  destroy(): void;
}

export function createPresencePublisher(awareness: Awareness, user: Identity): PresencePublisher {
  const initial: PresenceState = {
    user,
    cursor: null,
    selection: [],
    editing: null,
    viewport: null,
  };
  awareness.setLocalState(initial);
  const setCursor = throttle((cursor: Point | null) => {
    awareness.setLocalStateField('cursor', cursor);
  }, 50);
  const setViewport = throttle((viewport: Rect | null) => {
    awareness.setLocalStateField('viewport', viewport);
  }, 50);
  return {
    setCursor,
    setSelection: (ids) => awareness.setLocalStateField('selection', ids),
    setEditing: (id) => awareness.setLocalStateField('editing', id),
    setViewport,
    destroy() {
      setCursor.cancel();
      setViewport.cancel();
      awareness.setLocalState(null);
    },
  };
}
```

- [ ] **Step 5: Run the checks.** Run `npm test`, then `npm run typecheck`. Expected: PASS. Any remaining type error is a `Peer`/`PresenceState` literal that still needs `viewport: null`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/presence/state.ts packages/core/test/presence.test.ts apps/web/src/sync/presence.ts
git add -u apps/web/test packages/core/test
git commit -m "feat(presence): publish and validate each user's viewport"
```

---

### Task 3: Frames adopt and release shapes; minimum frame height

**Files:**
- Modify: `packages/core/src/geometry/shapes.ts`
- Modify: `packages/core/src/tools/machine.ts`
- Test: `packages/core/test/shapes.test.ts`, `packages/core/test/tools-structure.test.ts`

**Interfaces:**
- Consumes:
  - `dropTarget(shapes, p, exclude)` and `frameColumns` from `geometry/frames.ts`
  - `containsPoint` and `centerOf` from `geometry/rect.ts`
  - `FRAME_TITLE_H` (36) and `COLUMN_HEADER_H` (28), used in tests only
- Produces:
  - `FRAME_MIN_H = 64`
  - `minSize(type: ShapeType): { w: number; h: number }`
  - `resizeGeometry` now applies `minSize(type)`. Its signature is unchanged.
  - The internal `membershipMoves(rects, ctx, created?)` replaces `reparentMoves`.
  - New effect sequences: frame drawing emits `[preview null, CreateShape, Reparent?, END]`; resizing emits `[ResizeShapes, Reparent?, overlay null, END]`. Drag and nudge keep their existing order, now with adoption moves included.

- [ ] **Step 1: Write the failing shape tests** in `packages/core/test/shapes.test.ts`. Add `COLUMN_HEADER_H`, `FRAME_MIN_H`, `FRAME_TITLE_H` and `minSize` to the import from `'../src'`, then add:

```ts
describe('frame minimum size', () => {
  it('FRAME_MIN_H is the title band plus a column header', () => {
    expect(FRAME_MIN_H).toBe(FRAME_TITLE_H + COLUMN_HEADER_H);
    expect(minSize('frame')).toEqual({ w: MIN_SIZE, h: FRAME_MIN_H });
    expect(minSize('sticky')).toEqual({ w: MIN_SIZE, h: MIN_SIZE });
  });

  it('a frame never resizes shorter than FRAME_MIN_H; other shapes keep MIN_SIZE', () => {
    const f = { x: 0, y: 0, w: 400, h: 300 };
    expect(resizeGeometry('frame', f, 's', { x: 0, y: -290 })).toEqual({ x: 0, y: 0, w: 400, h: 64 });
    expect(resizeGeometry('frame', f, 'n', { x: 0, y: 280 })).toEqual({ x: 0, y: 236, w: 400, h: 64 });
    expect(resizeGeometry('rect', f, 's', { x: 0, y: -290 })).toEqual({ x: 0, y: 0, w: 400, h: 8 });
  });
});
```

- [ ] **Step 2: Write the failing FSM tests.** Append to `packages/core/test/tools-structure.test.ts`. It reuses the file's `shape`, `f1`, `s1`, `a`, `b`, `k1`, `at`, `idle` and `commands` helpers.

```ts
describe('frame membership (adoption)', () => {
  // Centre (780, 120): outside f1 (x 0..600).
  const loose = shape('loose', { type: 'sticky', x: 700, y: 60, w: 160, h: 120 });

  function ctxWith(extra: Record<string, Shape>): ToolContext {
    let n = 0;
    return {
      shapes: { f1, s1, a, b, ...extra },
      connectors: { k1 },
      userId: 'u1',
      userName: 'Brisk Otter',
      newId: () => `new${++n}`,
      now: () => 1000,
    };
  }

  it('drawing a frame adopts the shapes whose centre it covers', () => {
    const c = ctxWith({ loose });
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(650, 0) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(1250, 400) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(1250, 400) }, c);
    // new1 is the frame; new2..new4 are its columns (650..850, 850..1050, 1050..1250).
    const cmds = commands(r.effects);
    expect(cmds.map((x) => x.type)).toEqual(['CreateShape', 'Reparent']);
    expect(cmds[1]).toEqual({
      type: 'Reparent',
      moves: [
        { id: 'a', parentId: 'new1', columnId: null }, // centre (1050, 25) is in the title band
        { id: 'loose', parentId: 'new1', columnId: 'new2' },
      ],
    });
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('dragging a frame over a loose shape adopts it into the column under its centre', () => {
    const c = ctxWith({ loose });
    let r = step(idle('select', []), { type: 'pointerDown', p: at(300, 10, { hitId: 'f1' }) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(600, 10) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(600, 10, { hitId: 'f1' }) }, c);
    // f1 now spans x 300..900: c1 300..500, c2 500..700, c3 700..900.
    expect(commands(r.effects)).toEqual([
      {
        type: 'MoveShapes',
        moves: [
          { id: 'f1', x: 300, y: 0 },
          { id: 's1', x: 320, y: 60 },
        ],
      },
      { type: 'Reparent', moves: [{ id: 'loose', parentId: 'f1', columnId: 'c3' }] },
    ]);
  });

  it('nudging a frame adopts the shapes it now covers', () => {
    const c = ctxWith({ loose });
    const r = step(idle('select', ['f1']), { type: 'nudge', dx: 200, dy: 0 }, c);
    expect(commands(r.effects)[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 'loose', parentId: 'f1', columnId: 'c3' }],
    });
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('resizing a frame releases uncovered children and re-columns the rest in one gesture', () => {
    const held = shape('held', {
      type: 'sticky',
      x: 420,
      y: 60,
      w: 160,
      h: 120,
      parentId: 'f1',
      columnId: 'c3',
    }); // centre (500, 120)
    const mid = shape('mid', {
      type: 'sticky',
      x: 270,
      y: 60,
      w: 160,
      h: 120,
      parentId: 'f1',
      columnId: 'c2',
    }); // centre (350, 120)
    const c = ctxWith({ held, mid });
    let r = step(
      idle('select', ['f1']),
      { type: 'pointerDown', p: at(600, 200, { handle: 'e' }) },
      c,
    );
    r = step(r.state, { type: 'pointerMove', p: at(450, 200) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(450, 200) }, c);
    // f1 is now 450 wide: c1 0..150 (s1 stays), c2 150..300, c3 300..450.
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'ResizeShapes', rects: [{ id: 'f1', x: 0, y: 0, w: 450, h: 400 }] },
        throttle: false,
      },
      {
        type: 'command',
        command: {
          type: 'Reparent',
          moves: [
            { id: 'held', parentId: null, columnId: null },
            { id: 'mid', parentId: 'f1', columnId: 'c3' },
          ],
        },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('resizing a shape across a column boundary moves it to that column', () => {
    const c = ctxWith({});
    let r = step(
      idle('select', ['s1']),
      { type: 'pointerDown', p: at(180, 120, { handle: 'e' }) },
      c,
    );
    r = step(r.state, { type: 'pointerMove', p: at(400, 120) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(400, 120) }, c);
    // s1 becomes x 20..400, centre 210, which is in c2 (200..400).
    expect(commands(r.effects)[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 's1', parentId: 'f1', columnId: 'c2' }],
    });
  });

  it('a frame drawn flat gets the minimum frame height', () => {
    const c = ctxWith({});
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(0, 500) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(300, 510) }, c);
    const create = commands(r.effects)[0];
    expect(create?.type === 'CreateShape' && create.shape.h).toBe(64);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- shapes tools-structure`
Expected: FAIL. `minSize` is not exported, no `Reparent` is emitted on frame create or resize, and the flat frame is 10 tall.

- [ ] **Step 4: Per-type minimum size.** In `packages/core/src/geometry/shapes.ts`, below `MIN_SIZE`, add:

```ts
/**
 * A frame is never shorter than its title band plus a column header (FRAME_TITLE_H +
 * COLUMN_HEADER_H in geometry/frames.ts; not imported here to keep the module graph acyclic).
 */
export const FRAME_MIN_H = 64;

export function minSize(type: ShapeType): { w: number; h: number } {
  return { w: MIN_SIZE, h: type === 'frame' ? FRAME_MIN_H : MIN_SIZE };
}
```

Replace `clampFrom` with:

```ts
/** Keeps `moving` at least `min` away from `fixed`, on the side it was dragged to. */
function clampFrom(fixed: number, moving: number, movingIsMin: boolean, min: number): number {
  const d = moving - fixed;
  if (Math.abs(d) >= min) return moving;
  const side = d === 0 ? (movingIsMin ? -1 : 1) : Math.sign(d);
  return fixed + side * min;
}
```

In `resizeGeometry`, replace the four `clampFrom` lines with:

```ts
  const min = minSize(type);
  if (handle.includes('w')) left = clampFrom(right, left, true, min.w);
  if (handle.includes('e')) right = clampFrom(left, right, false, min.w);
  if (handle.includes('n')) top = clampFrom(bottom, top, true, min.h);
  if (handle.includes('s')) bottom = clampFrom(top, bottom, false, min.h);
```

Also update the doc comment: "never shrink below `minSize(type)`" instead of "MIN_SIZE".

- [ ] **Step 5: Membership moves in the FSM.** In `packages/core/src/tools/machine.ts`:

  1. Imports:
     - Change `import { centerOf, rectFromPoints } from '../geometry/rect';` to `import { centerOf, containsPoint, rectFromPoints } from '../geometry/rect';`.
     - Add `minSize` to the `../geometry/shapes` import.
     - Remove `MIN_SIZE` from that import if it becomes unused. Biome will flag it.
  2. Replace the whole `reparentMoves` function with:

```ts
type ReparentMove = { id: string; parentId: string | null; columnId: string | null };

/**
 * Parent/column changes after a gesture gave `rects` new geometry (moved, resized or — with
 * `created` — a newly drawn frame).
 * - Moving non-frame shapes are dropped with the usual rule: moving frames are excluded as
 *   targets, and shapes travelling with their moving frame keep it.
 * - When frames changed, the stationary shapes those frames parent, covered before, or cover
 *   now are re-evaluated against the new geometry. This makes frames adopt and release shapes,
 *   and re-columns the children of a resized frame.
 */
function membershipMoves(
  rects: Record<string, Rect>,
  ctx: ToolContext,
  created?: Shape,
): ReparentMove[] {
  const moving = new Set(Object.keys(rects));
  const after: Record<string, Shape> = { ...ctx.shapes };
  if (created) after[created.id] = created;
  for (const [id, r] of Object.entries(rects)) {
    const s = after[id];
    if (s) after[id] = { ...s, ...r };
  }
  const centre = (s: Shape) => centerOf(shapeBounds(s));
  const moves: ReparentMove[] = [];
  const consider = (s: Shape, exclude: ReadonlySet<string>) => {
    const target = dropTarget(after, centre(s), exclude);
    const parentId = target?.parentId ?? null;
    const columnId = target?.columnId ?? null;
    if (parentId === (s.parentId ?? null) && columnId === (s.columnId ?? null)) return;
    moves.push({ id: s.id, parentId, columnId });
  };

  for (const id of Object.keys(rects)) {
    const s = after[id];
    if (!s || s.type === 'frame') continue;
    if (s.parentId && moving.has(s.parentId)) continue;
    consider(s, moving);
  }

  const frames = [...moving].filter((id) => after[id]?.type === 'frame');
  if (frames.length === 0) return moves;
  const noExclusions = new Set<string>();
  for (const s of Object.values(after)) {
    if (s.type === 'frame' || moving.has(s.id)) continue;
    const c = centre(s);
    const affected = frames.some((f) => {
      const before = ctx.shapes[f];
      const now = after[f];
      return (
        s.parentId === f ||
        (before !== undefined && containsPoint(before, c)) ||
        (now !== undefined && containsPoint(now, c))
      );
    });
    if (affected) consider(s, noExclusions);
  }
  return moves;
}

const reparent = (moves: ReparentMove[]): Effect[] =>
  moves.length > 0 ? [command({ type: 'Reparent', moves })] : [];
```

  3. `nudge` case. Replace the `reparent` lines with:

```ts
      return {
        state,
        effects: [command(moveCommand(rects)), ...reparent(membershipMoves(rects, ctx)), END],
      };
```

  4. `stepDragging` `pointerUp`. Replace its `reparent` usage with:

```ts
      return {
        state: next,
        effects: [
          command(moveCommand(rects)),
          ...reparent(membershipMoves(rects, ctx)),
          overlay(null),
          END,
        ],
      };
```

  5. `stepResizing` becomes `function stepResizing(state: ResizingState, event: ToolEvent, ctx: ToolContext): StepResult`. Its `pointerUp` becomes:

```ts
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      const next = idle('select', state.selection);
      if (!moved) return none(next);
      const r = resized(state, event.p);
      return {
        state: next,
        effects: [
          command(resizeCommand(state.id, r)),
          ...reparent(membershipMoves({ [state.id]: r }, ctx)),
          overlay(null),
          END,
        ],
      };
    }
```

     Then update the dispatcher in `step` to `case 'resizing': return stepResizing(state, event, ctx);`.

  6. In `stepDrawing` `pointerUp`:
     - Replace `rect = { ...rect, w: Math.max(rect.w, MIN_SIZE), h: Math.max(rect.h, MIN_SIZE) };` with:

```ts
        const min = minSize(state.tool);
        rect = { ...rect, w: Math.max(rect.w, min.w), h: Math.max(rect.h, min.h) };
```

     - Replace the `const shape = newShape(...)` line and its return with:

```ts
      const shape = newShape(ctx, state.tool, rect);
      // A new frame adopts what it covers; it has the top z, so it wins over any frame below.
      const adopted =
        state.tool === 'frame'
          ? membershipMoves({ [shape.id]: rect }, ctx, { ...shape, z: '￿' })
          : [];
      return {
        state: idle('select', [shape.id]),
        effects: [preview(null), command({ type: 'CreateShape', shape }), ...reparent(adopted), END],
      };
```

- [ ] **Step 6: Run all core tests.** Run `npm test -w @relay/core`. Expected: PASS.
  - An existing test that draws, drags or resizes a frame over shapes may now also see a `Reparent`. Update such an expectation only when the new move is exactly what the spec's adoption rule requires, and name it in your report.
  - The convergence fuzz must stay green.

- [ ] **Step 7: Run the checks.** Run `npm run typecheck`, then `npm run lint`. Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/geometry/shapes.ts packages/core/src/tools/machine.ts packages/core/test/shapes.test.ts packages/core/test/tools-structure.test.ts
git commit -m "feat(core): frames adopt and release shapes on create, move, nudge and resize; minimum frame height"
```

---

### Task 4: Arrowhead geometry and frame-title Enter

**Files:**
- Modify: `packages/core/src/geometry/connectors.ts`
- Modify: `apps/web/src/render/ConnectorView.tsx`
- Modify: `apps/web/src/render/TextEditor.tsx`
- Test: `packages/core/test/connectors.test.ts`

**Interfaces:**
- Consumes: `arrowHead(tip, from, size)` (connectors.ts).
- Produces:
  - `ARROW_SIZE = 12`
  - `arrowGeometry(path: readonly Point[], size?: number): { stroke: Point[]; head: [Point, Point, Point] | null }`

- [ ] **Step 1: Write the failing test.** Append to `packages/core/test/connectors.test.ts`, and add `arrowGeometry` to its `'../src'` import:

```ts
describe('arrowGeometry', () => {
  it('ends the stroke at the arrowhead base', () => {
    expect(
      arrowGeometry([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual({
      stroke: [
        { x: 0, y: 0 },
        { x: 88, y: 0 },
      ],
      head: [
        { x: 100, y: 0 },
        { x: 88, y: 6 },
        { x: 88, y: -6 },
      ],
    });
  });

  it('clamps the head to a short last segment', () => {
    const g = arrowGeometry([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 5, y: 50 },
    ]);
    expect(g.head).toEqual([
      { x: 5, y: 50 },
      { x: 0, y: 52.5 },
      { x: 0, y: 47.5 },
    ]);
    expect(g.stroke).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it('draws no head on a zero-length last segment', () => {
    const path = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(arrowGeometry(path)).toEqual({ stroke: path, head: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- connectors`
Expected: FAIL, because `arrowGeometry` is not exported.

- [ ] **Step 3: Implement.** In `packages/core/src/geometry/connectors.ts`:
  - Change the `arrowHead` default parameter from `size = 12` to `size = ARROW_SIZE`.
  - Add, above `arrowHead`:

```ts
/** Default arrowhead length in world units. */
export const ARROW_SIZE = 12;
```

  - Add after `arrowHead`:

```ts
/**
 * Stroke and arrowhead for a connector path. The head's length is clamped to the last segment
 * (so it never reaches back past an elbow bend), and the stroke ends at the head's base (so its
 * round cap never pokes past the tip).
 */
export function arrowGeometry(
  path: readonly Point[],
  size = ARROW_SIZE,
): { stroke: Point[]; head: [Point, Point, Point] | null } {
  const tip = path[path.length - 1];
  const before = path[path.length - 2];
  if (!tip || !before) return { stroke: [...path], head: null };
  const len = Math.hypot(tip.x - before.x, tip.y - before.y);
  if (len === 0) return { stroke: [...path], head: null };
  const s = Math.min(size, len);
  const base = {
    x: tip.x - ((tip.x - before.x) / len) * s,
    y: tip.y - ((tip.y - before.y) / len) * s,
  };
  return { stroke: [...path.slice(0, -1), base], head: arrowHead(tip, before, s) };
}
```

- [ ] **Step 4: Use it in `apps/web/src/render/ConnectorView.tsx`.**
  - Change the import to `import { arrowGeometry, connectorPath, isAttached, PALETTE, type Point } from '@relay/core';`.
  - Replace the `tip` / `before` / `head` lines with:

```ts
  const { stroke, head } =
    connector.head === 'arrow' ? arrowGeometry(path) : { stroke: path, head: null };
```

  - Make the visible polyline use `points={toPoints(stroke)}`. The transparent hit polyline keeps `toPoints(path)`.

- [ ] **Step 5: Enter commits a frame title.** In `apps/web/src/render/TextEditor.tsx`'s `onKeyDown`, add a branch after the `Escape` branch:

```tsx
          } else if (e.key === 'Enter' && shape.type === 'frame') {
            // Frame titles are single-line: Enter commits (blur ends the editing session).
            e.preventDefault();
            e.currentTarget.blur();
```

- [ ] **Step 6: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/geometry/connectors.ts packages/core/test/connectors.test.ts apps/web/src/render/ConnectorView.tsx apps/web/src/render/TextEditor.tsx
git commit -m "feat: arrowheads clamp to the last segment and trim the stroke; Enter commits a frame title"
```

---

### Task 5: Controller navigation state, camera persistence and the initial fit

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Modify: `apps/web/src/board/session.ts`
- Test: `apps/web/test/controller.test.ts`

**Interfaces:**
- Consumes:
  - `zoomAt`, `centerOn`, `fitBounds`, `contentBounds`, `viewportRect`, `parseCamera` (Task 1)
  - `PresencePublisher.setViewport` (Task 2)
  - the provider event `'sync'` with `[synced: boolean]` and its `synced` getter (y-partyserver)
- Produces:
  - `interface CameraStorage { load(): Camera | null; save(camera: Camera): void }`
  - `BoardUiState` gains `viewport: { w: number; h: number } | null`, `pointer: Point | null` and `spaceHeld: boolean`
  - `BoardController` gains:
    - `setViewportSize(w, h)`
    - `setPointer(p)`
    - `setSpaceHeld(held)`
    - `zoomBy(factor, anchor?)`
    - `resetZoom()`
    - `centerOn(p)`
    - `markSynced()`
  - `createBoardController` opts gain `cameraStorage?: CameraStorage`

- [ ] **Step 1: Write the failing tests** in `apps/web/test/controller.test.ts`.
  - Add `worldToScreen` to the `@relay/core` import.
  - Add `type CameraStorage` to the controller import: `import { type CameraStorage, createBoardController } from '../src/board/controller';`.
  - Change `setup` to accept options:

```ts
function setup(opts: { cameraStorage?: CameraStorage } = {}) {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  let n = 0;
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    user,
    newId: () => `s${++n}`,
    now: () => 1000,
    ...opts,
  });
  return { doc, docs, controller };
}
```

  - Then add:

```ts
function addRect(doc: Y.Doc, id: string, x: number, y: number) {
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id,
      type: 'rect',
      x,
      y,
      w: 200,
      h: 100,
      style: DEFAULT_STYLE.rect,
      text: '',
      createdBy: 'u1',
      authorName: 'Brisk Otter',
      createdAt: 0,
    },
  });
}

describe('camera', () => {
  it('zooms around the viewport centre or an anchor, and resets to 100%', () => {
    const { controller } = setup();
    controller.setViewportSize(800, 600);
    controller.zoomBy(2);
    const cam = controller.ui.getState().camera;
    expect(cam.zoom).toBe(2);
    expect(worldToScreen(cam, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
    controller.resetZoom();
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    controller.zoomBy(2, { x: 0, y: 0 });
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it('centres on a world point', () => {
    const { controller } = setup();
    controller.setViewportSize(800, 600);
    controller.centerOn({ x: 1000, y: 500 });
    expect(controller.ui.getState().camera).toEqual({ x: -600, y: -200, zoom: 1 });
  });

  it('restores a stored camera and saves every camera change', () => {
    const save = vi.fn();
    const { controller } = setup({ cameraStorage: { load: () => ({ x: 10, y: 20, zoom: 2 }), save } });
    expect(controller.ui.getState().camera).toEqual({ x: 10, y: 20, zoom: 2 });
    controller.setCamera({ x: 1, y: 2, zoom: 1 });
    expect(save).toHaveBeenLastCalledWith({ x: 1, y: 2, zoom: 1 });
  });

  it('fits the content once, after the first sync, without saving the fit', () => {
    const save = vi.fn();
    const { doc, controller } = setup({ cameraStorage: { load: () => null, save } });
    addRect(doc, 'r1', 1000, 1000);
    controller.setViewportSize(800, 600);
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    controller.markSynced();
    const cam = controller.ui.getState().camera;
    expect(cam.zoom).toBe(1);
    expect(worldToScreen(cam, { x: 1100, y: 1050 })).toEqual({ x: 400, y: 300 });
    expect(save).not.toHaveBeenCalled();
    addRect(doc, 'r2', 5000, 5000);
    controller.markSynced();
    expect(controller.ui.getState().camera).toEqual(cam);
  });

  it('fits when the canvas is measured after the sync', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1', 1000, 1000);
    controller.markSynced();
    controller.setViewportSize(800, 600);
    expect(worldToScreen(controller.ui.getState().camera, { x: 1100, y: 1050 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('does not fit an empty board, a restored camera, or one the user already moved', () => {
    const empty = setup();
    empty.controller.setViewportSize(800, 600);
    empty.controller.markSynced();
    expect(empty.controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });

    const restored = setup({
      cameraStorage: { load: () => ({ x: 5, y: 5, zoom: 1 }), save: vi.fn() },
    });
    addRect(restored.doc, 'r1', 1000, 1000);
    restored.controller.setViewportSize(800, 600);
    restored.controller.markSynced();
    expect(restored.controller.ui.getState().camera).toEqual({ x: 5, y: 5, zoom: 1 });

    const moved = setup();
    addRect(moved.doc, 'r1', 1000, 1000);
    moved.controller.setViewportSize(800, 600);
    moved.controller.setCamera({ x: 7, y: 7, zoom: 1 });
    moved.controller.markSynced();
    expect(moved.controller.ui.getState().camera).toEqual({ x: 7, y: 7, zoom: 1 });
  });

  it('tracks the pointer and whether Space is held', () => {
    const { controller } = setup();
    controller.setPointer({ x: 1, y: 2 });
    controller.setSpaceHeld(true);
    expect(controller.ui.getState().pointer).toEqual({ x: 1, y: 2 });
    expect(controller.ui.getState().spaceHeld).toBe(true);
    controller.setPointer(null);
    expect(controller.ui.getState().pointer).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- controller`
Expected: FAIL. The new methods are undefined and `CameraStorage` is not exported.

- [ ] **Step 3: Implement in `apps/web/src/board/controller.ts`.**
  1. Add these to the `@relay/core` import: `centerOn as centredOn`, `contentBounds`, `fitBounds`, `type Point`, `zoomAt`.
  2. Add, above `BoardUiState`:

```ts
/** Where the camera is remembered between visits (per room); failures just mean no restore. */
export interface CameraStorage {
  load(): Camera | null;
  save(camera: Camera): void;
}
```

  3. Add these to `BoardUiState`:

```ts
  /** Canvas size in screen pixels; null until the canvas has been measured. */
  viewport: { w: number; h: number } | null;
  /** World position of the local pointer over the canvas (coordinates readout). */
  pointer: Point | null;
  /** Space is held: a left-drag pans instead of using the tool. */
  spaceHeld: boolean;
```

  4. Add these to `BoardController`:

```ts
  setViewportSize(w: number, h: number): void;
  setPointer(p: Point | null): void;
  setSpaceHeld(held: boolean): void;
  /** Multiplies the zoom, keeping `anchor` (screen px; default: viewport centre) fixed. */
  zoomBy(factor: number, anchor?: Point): void;
  /** Back to 100% around the viewport centre. */
  resetZoom(): void;
  /** Keeps the zoom and centres the viewport on a world point. */
  centerOn(p: Point): void;
  /** The document finished its first sync: fit the content once if nothing set the camera. */
  markSynced(): void;
```

  5. Add `cameraStorage?: CameraStorage;` to the options type.
  6. In the body, before `createStore`, add `const stored = opts.cameraStorage?.load() ?? null;`. The initial state becomes:

```ts
    camera: stored ?? { x: 0, y: 0, zoom: 1 },
    viewport: null,
    pointer: null,
    spaceHeld: false,
```

  7. After `travel`, add:

```ts
  // The initial fit happens once: after the first sync, once the canvas is measured, and
  // only if no camera was restored and the user has not moved it yet. It is not saved.
  let fitPending = stored === null;
  let synced = false;
  const tryFit = () => {
    const { viewport } = ui.getState();
    if (!fitPending || !synced || !viewport) return;
    fitPending = false;
    const bounds = contentBounds(opts.docStore.getState().shapes);
    if (bounds) ui.setState({ camera: fitBounds(bounds, viewport.w, viewport.h) });
  };

  const setCamera = (camera: Camera) => {
    fitPending = false;
    ui.setState({ camera });
    opts.cameraStorage?.save(camera);
  };

  const viewportCentre = (): Point => {
    const v = ui.getState().viewport;
    return v ? { x: v.w / 2, y: v.h / 2 } : { x: 0, y: 0 };
  };
```

  8. In the returned object:
     - replace `setCamera(camera) { ui.setState({ camera }); },` with `setCamera,`;
     - add:

```ts
    setViewportSize(w, h) {
      const v = ui.getState().viewport;
      if (v && v.w === w && v.h === h) return;
      ui.setState({ viewport: { w, h } });
      tryFit();
    },
    setPointer(p) {
      ui.setState({ pointer: p });
    },
    setSpaceHeld(held) {
      if (ui.getState().spaceHeld !== held) ui.setState({ spaceHeld: held });
    },
    zoomBy(factor, anchor) {
      const cam = ui.getState().camera;
      setCamera(zoomAt(cam, anchor ?? viewportCentre(), cam.zoom * factor));
    },
    resetZoom() {
      setCamera(zoomAt(ui.getState().camera, viewportCentre(), 1));
    },
    centerOn(p) {
      const v = ui.getState().viewport;
      if (!v) return;
      setCamera(centredOn(ui.getState().camera, p, v.w, v.h));
    },
    markSynced() {
      synced = true;
      tryFit();
    },
```

- [ ] **Step 4: Wire the session.** In `apps/web/src/board/session.ts`:
  1. Add `type Camera` (only if needed), `parseCamera` and `viewportRect` to the `@relay/core` import. Add `type CameraStorage` to the `./controller` import.
  2. Add below `safeLocalStorage`:

```ts
function cameraStorage(roomId: string): CameraStorage {
  const key = `relay:camera:${roomId}`;
  return {
    load() {
      try {
        const raw = safeLocalStorage()?.getItem(key);
        return raw ? parseCamera(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(camera) {
      try {
        safeLocalStorage()?.setItem(key, JSON.stringify(camera));
      } catch {
        // Storage full or blocked: the camera just is not restored next time.
      }
    },
  };
}
```

  3. Pass `cameraStorage: cameraStorage(roomId)` to `createBoardController`.
  4. After creating the controller, add:

```ts
  const onSync = (isSynced: boolean) => {
    if (isSynced) controller.markSynced();
  };
  conn.provider.on('sync', onSync);
  if (conn.provider.synced) controller.markSynced();
```

  5. Inside the existing `controller.ui.subscribe` callback, add:

```ts
    if (state.camera !== prev.camera || state.viewport !== prev.viewport) {
      publisher.setViewport(
        state.viewport ? viewportRect(state.camera, state.viewport.w, state.viewport.h) : null,
      );
    }
```

  6. In `destroy()`, call `conn.provider.off('sync', onSync);` before `controller.destroy();`.

- [ ] **Step 5: Run the checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/board/controller.ts apps/web/src/board/session.ts apps/web/test/controller.test.ts
git commit -m "feat(web): camera controls, per-room saved camera and a one-time fit to content"
```

---

### Task 6: Pure keyboard shortcuts with Space-to-pan

**Files:**
- Create: `apps/web/src/ui/shortcuts.ts`
- Modify: `apps/web/src/ui/useShortcuts.ts`
- Test: `apps/web/test/shortcuts.test.ts` (create)

**Interfaces:**
- Consumes: `ToolEvent`, `ToolId` (core); `BoardController.setSpaceHeld` (Task 5).
- Produces:
  - `interface KeyInput { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }`
  - `type ShortcutAction`
  - `keyDownAction(e: KeyInput, typing: boolean): ShortcutAction | null`
  - `keyUpAction(e: KeyInput): ShortcutAction | null`

- [ ] **Step 1: Write the failing tests** in `apps/web/test/shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type KeyInput, keyDownAction, keyUpAction } from '../src/ui/shortcuts';

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('keyboard shortcuts', () => {
  it('maps tool keys, including A (connector) and F (frame), case-insensitively', () => {
    expect(keyDownAction(k('a'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'setTool', tool: 'connector' },
      preventDefault: false,
    });
    expect(keyDownAction(k('F', { shiftKey: true }), false)).toEqual({
      type: 'dispatch',
      event: { type: 'setTool', tool: 'frame' },
      preventDefault: false,
    });
  });

  it('E toggles connector routing', () => {
    expect(keyDownAction(k('e'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'toggleRouting' },
      preventDefault: false,
    });
  });

  it('ignores everything while typing or with Alt', () => {
    expect(keyDownAction(k('a'), true)).toBeNull();
    expect(keyDownAction(k(' '), true)).toBeNull();
    expect(keyDownAction(k('z', { ctrlKey: true }), true)).toBeNull();
    expect(keyDownAction(k('a', { altKey: true }), false)).toBeNull();
  });

  it('maps undo and redo on Ctrl and Cmd', () => {
    expect(keyDownAction(k('z', { ctrlKey: true }), false)).toEqual({ type: 'undo' });
    expect(keyDownAction(k('z', { metaKey: true }), false)).toEqual({ type: 'undo' });
    expect(keyDownAction(k('Z', { ctrlKey: true, shiftKey: true }), false)).toEqual({
      type: 'redo',
    });
    expect(keyDownAction(k('y', { ctrlKey: true }), false)).toEqual({ type: 'redo' });
    expect(keyDownAction(k('a', { ctrlKey: true }), false)).toBeNull();
  });

  it('Space holds and releases the pan mode', () => {
    expect(keyDownAction(k(' '), false)).toEqual({ type: 'space', held: true });
    expect(keyUpAction(k(' '))).toEqual({ type: 'space', held: false });
    expect(keyUpAction(k('a'))).toBeNull();
  });

  it('nudges (Shift = 10), deletes and cancels', () => {
    expect(keyDownAction(k('ArrowLeft', { shiftKey: true }), false)).toEqual({
      type: 'dispatch',
      event: { type: 'nudge', dx: -10, dy: 0 },
      preventDefault: true,
    });
    expect(keyDownAction(k('ArrowDown'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'nudge', dx: 0, dy: 1 },
      preventDefault: true,
    });
    expect(keyDownAction(k('Backspace'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'deleteSelection' },
      preventDefault: true,
    });
    expect(keyDownAction(k('Escape'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'cancel' },
      preventDefault: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- shortcuts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Create `apps/web/src/ui/shortcuts.ts`**

```ts
import type { ToolEvent, ToolId } from '@relay/core';

/** The parts of a KeyboardEvent the shortcut table reads (plain objects in tests). */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type ShortcutAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'space'; held: boolean }
  | { type: 'dispatch'; event: ToolEvent; preventDefault: boolean };

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  s: 'sticky',
  c: 'code',
  a: 'connector',
  f: 'frame',
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const dispatch = (event: ToolEvent, preventDefault = false): ShortcutAction => ({
  type: 'dispatch',
  event,
  preventDefault,
});

/** What a keydown means on the board; `typing` = focus is in an editable element. */
export function keyDownAction(e: KeyInput, typing: boolean): ShortcutAction | null {
  if (typing || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z' && !e.shiftKey) return { type: 'undo' };
    if ((key === 'z' && e.shiftKey) || key === 'y') return { type: 'redo' };
    return null;
  }
  if (e.key === ' ') return { type: 'space', held: true };
  if (key === 'e') return dispatch({ type: 'toggleRouting' });
  const tool = TOOL_KEYS[key];
  if (tool) return dispatch({ type: 'setTool', tool });
  const nudge = NUDGE[e.key];
  if (nudge) {
    const size = e.shiftKey ? 10 : 1;
    return dispatch({ type: 'nudge', dx: nudge[0] * size, dy: nudge[1] * size }, true);
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return dispatch({ type: 'deleteSelection' }, true);
  if (e.key === 'Escape') return dispatch({ type: 'cancel' });
  return null;
}

/** Releasing Space always leaves pan mode, even if focus moved into an editor meanwhile. */
export function keyUpAction(e: KeyInput): ShortcutAction | null {
  return e.key === ' ' ? { type: 'space', held: false } : null;
}
```

- [ ] **Step 4: Replace `apps/web/src/ui/useShortcuts.ts`**

```ts
import { useEffect } from 'react';
import type { BoardController } from '../board/controller';
import { keyDownAction, keyUpAction, type ShortcutAction } from './shortcuts';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export function useShortcuts(controller: BoardController) {
  useEffect(() => {
    const run = (action: ShortcutAction | null, e: KeyboardEvent) => {
      if (!action) return;
      switch (action.type) {
        case 'undo':
          e.preventDefault();
          controller.undo();
          break;
        case 'redo':
          e.preventDefault();
          controller.redo();
          break;
        case 'space':
          // Holding Space must not scroll the page or press a focused button.
          if (action.held) e.preventDefault();
          controller.setSpaceHeld(action.held);
          break;
        case 'dispatch':
          if (action.preventDefault) e.preventDefault();
          controller.dispatch(action.event);
          break;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => run(keyDownAction(e, isTyping(e.target)), e);
    const onKeyUp = (e: KeyboardEvent) => run(keyUpAction(e), e);
    const onBlur = () => controller.setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [controller]);
}
```

- [ ] **Step 5: Run the checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/shortcuts.ts apps/web/src/ui/useShortcuts.ts apps/web/test/shortcuts.test.ts
git commit -m "feat(web): testable shortcut table with Space-to-pan"
```

---

### Task 7: Canvas navigation input, zoom controls and the coordinates readout

**Files:**
- Modify: `apps/web/src/render/Canvas.tsx`
- Create: `apps/web/src/ui/ZoomControls.tsx`
- Modify: `apps/web/src/board/Board.tsx`

**Interfaces:**
- Consumes:
  - `wheelZoomFactor`, `panBy`, `ZOOM_STEP` (core)
  - from the Task 5 controller: `zoomBy`, `resetZoom`, `setCamera`, `setPointer`, `setViewportSize`, and `ui.spaceHeld`, `ui.pointer`, `ui.camera`
- Produces:
  - Test ids: `zoom-out`, `zoom-reset` (text `NN%`), `zoom-in`, `coords` (text `X <int> · Y <int>`).
  - The canvas pans on Space+left-drag and middle-drag. It zooms on Ctrl/⌘+wheel at the cursor and pans on a plain wheel.

- [ ] **Step 1: Create `apps/web/src/ui/ZoomControls.tsx`**

```tsx
import { ZOOM_STEP } from '@relay/core';
import { Minus, Plus } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

// Keep focus on the page: a focused button would be "clicked" by the Space used for panning.
const noFocus = (e: MouseEvent) => e.preventDefault();

export function ZoomControls({ session }: { session: BoardSession }) {
  const { controller } = session;
  const zoom = useStore(controller.ui, (s) => s.camera.zoom);
  const pointer = useStore(controller.ui, (s) => s.pointer);
  const step = 'grid size-8 place-items-center hover:bg-sun';
  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-3">
      <div className="flex items-center border-2 border-ink bg-white shadow-hard">
        <button
          type="button"
          data-testid="zoom-out"
          aria-label="Zoom out"
          className={step}
          onMouseDown={noFocus}
          onClick={() => controller.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          data-testid="zoom-reset"
          aria-label="Reset zoom to 100%"
          className="h-8 min-w-14 border-x-2 border-ink px-2 font-mono text-xs font-bold hover:bg-sun"
          onMouseDown={noFocus}
          onClick={() => controller.resetZoom()}
        >
          {`${Math.round(zoom * 100)}%`}
        </button>
        <button
          type="button"
          data-testid="zoom-in"
          aria-label="Zoom in"
          className={step}
          onMouseDown={noFocus}
          onClick={() => controller.zoomBy(ZOOM_STEP)}
        >
          <Plus size={14} />
        </button>
      </div>
      {pointer && (
        <span
          data-testid="coords"
          className="border-2 border-ink bg-white px-2 py-1 font-mono text-[11px] shadow-hard"
        >
          {`X ${Math.round(pointer.x)} · Y ${Math.round(pointer.y)}`}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Canvas input.** In `apps/web/src/render/Canvas.tsx`:
  1. Imports:
     - Add `wheelZoomFactor` to the `@relay/core` import.
     - Change the React import to `import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';` (drop `WheelEvent`).
  2. Inside `Canvas`, after `svgRef`, add:

```tsx
  const spaceHeld = useStore(controller.ui, (s) => s.spaceHeld);
  // Pan gestures bypass the tool FSM: the camera is view state, not a document edit.
  const pan = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // Measure the canvas so the controller can fit, centre and publish the viewport.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      controller.setViewportSize(b.width, b.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [controller]);

  // A native non-passive listener: React's onWheel is passive, so it could not stop the
  // browser's own ctrl+wheel page zoom. Ctrl/⌘+wheel (and pinch) zooms, a plain wheel pans.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const b = el.getBoundingClientRect();
        controller.zoomBy(wheelZoomFactor(e.deltaY * unit), {
          x: e.clientX - b.left,
          y: e.clientY - b.top,
        });
      } else {
        const cam = controller.ui.getState().camera;
        controller.setCamera(panBy(cam, -e.deltaX * unit, -e.deltaY * unit));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [controller]);

  const endPan = (e: PointerEvent<SVGSVGElement>): boolean => {
    if (pan.current?.pointerId !== e.pointerId) return false;
    pan.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    return true;
  };
```

  3. On the `<svg>`:
     - Add `style={{ cursor: panning ? 'grabbing' : spaceHeld ? 'grab' : undefined }}`.
     - Add `onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}`, which stops the middle-click autoscroll.
     - Remove the old `onWheel` prop.
     - Change the handlers as follows:

```tsx
      onPointerDown={(e) => {
        if (e.button === 1 || (e.button === 0 && controller.ui.getState().spaceHeld)) {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
          setPanning(true);
          return;
        }
        if (e.button !== 0) return;
        // ...the existing body stays unchanged from here on...
      }}
      onPointerMove={(e) => {
        const p = info(e);
        publisher.setCursor(p.world);
        controller.setPointer(p.world);
        const g = pan.current;
        if (g && g.pointerId === e.pointerId) {
          const cam = controller.ui.getState().camera;
          controller.setCamera(panBy(cam, e.clientX - g.x, e.clientY - g.y));
          pan.current = { ...g, x: e.clientX, y: e.clientY };
          return;
        }
        controller.dispatch({ type: 'pointerMove', p });
      }}
      onPointerUp={(e) => {
        if (endPan(e)) return;
        controller.dispatch({ type: 'pointerUp', p: info(e) });
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={(e) => {
        if (endPan(e)) return;
        controller.dispatch({ type: 'cancel' });
      }}
      onLostPointerCapture={(e) => {
        if (endPan(e)) return;
        controller.dispatch({ type: 'cancel' });
      }}
      onPointerLeave={() => {
        publisher.setCursor(null);
        controller.setPointer(null);
      }}
```

- [ ] **Step 3: Mount the controls.** In `apps/web/src/board/Board.tsx`, import `ZoomControls` from `'../ui/ZoomControls'` and render `<ZoomControls session={session} />` right after `<Toolbar session={session} />`.

- [ ] **Step 4: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green. The controller verifies the behaviour in the browser, and Task 10 adds the e2e.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render/Canvas.tsx apps/web/src/ui/ZoomControls.tsx apps/web/src/board/Board.tsx
git commit -m "feat(web): ctrl/pinch zoom, space and middle-drag pan, zoom controls and coordinates"
```

---

### Task 8: Interactive minimap with peer viewports

**Files:**
- Create: `apps/web/src/render/Minimap.tsx`
- Modify: `apps/web/src/board/Board.tsx`

**Interfaces:**
- Consumes:
  - `contentBounds`, `minimapProjection`, `fromMinimap`, `rectToMinimap`, `viewportRect`, `shapeBounds`, `PALETTE`, `MinimapProjection` (core)
  - `controller.centerOn` and `ui.viewport`/`ui.camera` (Task 5)
  - `Peer.viewport` (Task 2)
- Produces:
  - Test ids: `minimap`, `minimap-viewport`, `minimap-peer` (one per peer with a viewport).

- [ ] **Step 1: Create `apps/web/src/render/Minimap.tsx`**

```tsx
import {
  contentBounds,
  fromMinimap,
  type MinimapProjection,
  minimapProjection,
  PALETTE,
  type Point,
  type Rect,
  rectToMinimap,
  shapeBounds,
  viewportRect,
} from '@relay/core';
import { type PointerEvent, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const W = 200;
const H = 140;

export function Minimap({ session }: { session: BoardSession }) {
  const { controller } = session;
  const shapes = useStore(session.doc, (s) => s.shapes);
  const order = useStore(session.doc, (s) => s.order);
  const camera = useStore(controller.ui, (s) => s.camera);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const peers = useStore(session.presence, (s) => s.peers);
  // Frozen while dragging: re-projecting as the viewport moves would slide the map under the pointer.
  const drag = useRef<MinimapProjection | null>(null);
  if (!viewport) return null;

  const view = viewportRect(camera, viewport.w, viewport.h);
  const projection = drag.current ?? minimapProjection(contentBounds(shapes), view, W, H);
  const box = (r: Rect) => {
    const m = rectToMinimap(projection, r);
    return { x: m.x, y: m.y, width: m.w, height: m.h };
  };
  const local = (e: PointerEvent<SVGSVGElement>): Point => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  return (
    <svg
      data-testid="minimap"
      aria-label="Minimap"
      width={W}
      height={H}
      className="absolute right-4 bottom-4 touch-none border-2 border-ink bg-white shadow-hard"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = projection;
        controller.centerOn(fromMinimap(projection, local(e)));
      }}
      onPointerMove={(e) => {
        if (drag.current) controller.centerOn(fromMinimap(drag.current, local(e)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      {order.map((id) => {
        const s = shapes[id];
        if (!s) return null;
        const frame = s.type === 'frame';
        return (
          <rect
            key={id}
            {...box(shapeBounds(s))}
            fill={frame ? 'none' : '#11111133'}
            stroke={frame ? PALETTE.ink : 'none'}
            strokeWidth={1}
          />
        );
      })}
      {peers.map((peer) =>
        peer.viewport ? (
          <rect
            key={peer.clientId}
            data-testid="minimap-peer"
            {...box(peer.viewport)}
            fill="none"
            stroke={peer.user.color}
            strokeWidth={1.5}
          />
        ) : null,
      )}
      <rect
        data-testid="minimap-viewport"
        {...box(view)}
        fill={`${PALETTE.cobalt}14`}
        stroke={PALETTE.cobalt}
        strokeWidth={2}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Mount it.** In `apps/web/src/board/Board.tsx`, import `Minimap` from `'../render/Minimap'` and render `<Minimap session={session} />` right after `<ZoomControls session={session} />`.

- [ ] **Step 3: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/render/Minimap.tsx apps/web/src/board/Board.tsx
git commit -m "feat(web): interactive minimap with peer viewports"
```

---

### Task 9: Peer "typing…" indicator

**Files:**
- Modify: `apps/web/src/render/SelectionLayer.tsx`

**Interfaces:**
- Consumes: `Peer.editing`, `Peer.user` (presence store). The layer already renders peer selections as dashed outlines.
- Produces: the test id `typing-indicator`, a `<g>` whose text is `<name> · typing…`.

- [ ] **Step 1: Implement.** In `SelectionLayer.tsx`, directly after the existing `peers.flatMap(...)` block (the peer selection outlines), add:

```tsx
      {peers.map((peer) => {
        const s = peer.editing ? shapes[peer.editing] : undefined;
        if (!s) return null;
        const b = shapeBounds(s);
        const label = `${peer.user.name} · typing…`;
        return (
          <g key={`typing:${peer.clientId}`} data-testid="typing-indicator">
            <rect
              {...outline(b)}
              fill="none"
              stroke={peer.user.color}
              strokeWidth={stroke * 1.5}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            />
            {/* Screen-sized tag above the shape, like the W × H label. */}
            <g transform={`translate(${b.x - PAD} ${b.y - PAD - 22 / zoom}) scale(${1 / zoom})`}>
              <rect
                width={label.length * 6.2 + 12}
                height={18}
                fill={peer.user.color}
                stroke={PALETTE.ink}
                strokeWidth={1.5}
              />
              <text x={6} y={13} fill={PALETTE.white} className="font-mono" fontSize={10} fontWeight={700}>
                {label}
              </text>
            </g>
          </g>
        );
      })}
```

The peer name is already sliced to 40 characters by `parsePresence` and is rendered as a text node, so it is inert.

- [ ] **Step 2: Run the checks.** Run `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/render/SelectionLayer.tsx
git commit -m "feat(web): show which peer is typing in which shape"
```

---

### Task 10: End-to-end navigation coverage

**Files:**
- Create: `e2e/navigation.spec.ts`

**Interfaces:**
- Consumes:
  - the DOM contract of Tasks 7–9: `zoom-reset`, `zoom-in`, `coords`, `minimap`, `minimap-peer`, `typing-indicator`, `text-editor`
  - `[data-shape-id]`
  - `POST /api/rooms`

- [ ] **Step 1: Write `e2e/navigation.spec.ts`**

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

test('ctrl+wheel zooms, the controls step and reset, and the camera survives a reload', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  const reset = page.getByTestId('zoom-reset');
  await expect(reset).toHaveText('100%');

  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100); // capped at 50 → ×e^0.5
  await page.keyboard.up('Control');
  await expect(reset).toHaveText('165%');

  await page.getByTestId('zoom-in').click();
  await expect(reset).toHaveText('206%');

  // A real reload: goto() to the same URL with a #fragment would be a same-document navigation.
  await page.reload();
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
  await expect(reset).toHaveText('206%');
  await reset.click();
  await expect(reset).toHaveText('100%');
});

test('space-drag and middle-drag pan the camera; the readout tracks world coordinates', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await page.keyboard.press('r');
  await drag(page, { x: 400, y: 300 }, { x: 520, y: 380 });
  const shape = page.locator('[data-shape-id]').first();
  const before = await shape.boundingBox();
  if (!before) throw new Error('rect not rendered');

  await page.mouse.move(400, 300);
  const coords = page.getByTestId('coords');
  const start = await coords.textContent();

  await page.keyboard.down('Space');
  await drag(page, { x: 800, y: 500 }, { x: 900, y: 550 });
  await page.keyboard.up('Space');
  await expect(page.getByTestId('marquee')).toHaveCount(0);
  await expect.poll(async () => Math.round((await shape.boundingBox())?.x ?? 0)).toBe(Math.round(before.x + 100));

  await page.mouse.move(800, 500);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(760, 480, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => Math.round((await shape.boundingBox())?.x ?? 0)).toBe(Math.round(before.x + 60));
  await expect.poll(async () => Math.round((await shape.boundingBox())?.y ?? 0)).toBe(Math.round(before.y + 30));

  // The same world point is now 60 px right and 30 px down on screen.
  await page.mouse.move(460, 330);
  await expect(coords).toHaveText(start ?? '');
});

test('the minimap navigates and shows the peer viewport; a peer typing is visible', async ({
  page,
  browser,
  request,
}) => {
  const path = await newBoard(page, request);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);
  await expect(page.getByTestId('minimap-peer')).toHaveCount(1);

  await page.keyboard.press('r');
  await drag(page, { x: 400, y: 300 }, { x: 520, y: 380 });
  const shape = page.locator('[data-shape-id]').first();
  const before = await shape.boundingBox();
  const map = await page.getByTestId('minimap').boundingBox();
  if (!before || !map) throw new Error('not rendered');
  await page.mouse.click(map.x + 12, map.y + 12);
  await expect.poll(async () => (await shape.boundingBox())?.x).not.toBe(before.x);

  await pb.keyboard.press('s');
  await pb.mouse.click(700, 450);
  await pb.keyboard.type('hola');
  await expect(page.getByTestId('typing-indicator')).toContainText('typing…');
  await pb.keyboard.press('Escape');
  await expect(page.getByTestId('typing-indicator')).toHaveCount(0);
  await other.close();
});

test('a frame drawn over a sticky adopts it; Enter commits the frame title', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await page.keyboard.press('s');
  await page.mouse.click(270, 330);
  await page.keyboard.type('Adopt me');
  await page.keyboard.press('Escape');

  await page.keyboard.press('f');
  await drag(page, { x: 150, y: 120 }, { x: 870, y: 560 });
  await expect(page.getByText(/went well · 1/i)).toBeVisible();

  await page.mouse.dblclick(500, 138); // the title band spans y 120..156
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Retro');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  await expect(page.getByText('Retro', { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e suite.** Run `npm run e2e`. Expected: all pass (8 existing + 4 new).
  - On failure, read the trace (`npx playwright show-trace test-results/**/trace.zip`) and fix the root cause.
  - Do not add sleeps and do not weaken assertions.
  - If a coordinate lands on the wrong element because of layout, adjust the coordinate (not the assertion) and say so in the report.
  - The `165%`/`206%` values follow from `WHEEL_DELTA_CAP = 50` and `ZOOM_STEP = 1.25`.

- [ ] **Step 3: Run the full checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/navigation.spec.ts
git commit -m "test(e2e): zoom, pan, minimap, peer typing, frame adoption and title commit"
```
