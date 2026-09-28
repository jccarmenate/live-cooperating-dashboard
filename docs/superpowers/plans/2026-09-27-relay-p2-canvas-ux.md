# Relay F4·P2 Canvas UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click menus, system clipboard copy/cut/paste/duplicate, z-order, styling and lock, a floating properties bar, a help dialog with empty-page hint, and the P1 polish backlog to the board page.

**Architecture:** Five new document commands (`SetZ`, `SetStyle`, `SetLocked`, `SetHead`, `PasteItems`) live in `@relay/core`. Lock rules are enforced twice: in `apply`, so a locked shape ignores edits from any client, and in the tool FSM, so the UI never starts a gesture it cannot finish. Clipboard payloads are pure core functions (copy, validate, remap). The web controller turns them into one undo step each. The UI adds a controller-owned context-menu state, a `CanvasMenu` built from a pure item builder, and a `PropertiesBar` built from a pure `selectionInfo`. Everything is keyboard-reachable through `shortcuts.ts` and the browser's `copy`/`cut`/`paste` events.

**Tech Stack:** TypeScript, Yjs 13.6, fractional-indexing 4 (`generateNKeysBetween`), React 19 / Next.js 16, Zustand 5, Tailwind 4, lucide-react, Vitest + fast-check, Playwright (Chromium), Biome.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`. Read the section "Canvas UX (F4·P2)" and the Data model, Commands and Input sections it amends.

## Global Constraints

- $0 total cost: no new paid service and no new runtime dependency (everything below uses packages already installed).
- **README must not be edited** (it is updated once at the end of the project).
- Every new document command uses `LOCAL_ORIGIN`, so it is undoable.
- A locked shape is skipped by every shape command except `SetLocked`, `SetZ` and `PasteItems`. `DeletePage` still removes locked shapes (a page command, not a shape command).
- Clipboard text format: `relay-clip:v1:<json>` holding `{ shapes, connectors }`.
- Paste caps:
  - 500 shapes (`MAX_PASTE_SHAPES`) and 1000 connectors (`MAX_PASTE_CONNECTORS`);
  - plain text pastes as a sticky capped at 2000 characters (`MAX_PLAIN_PASTE`);
  - the repeat offset is 24 px (`PASTE_OFFSET`).
- "None" fill/stroke is stored as `'transparent'` (not SVG `none`), so the shape stays clickable. Legacy `'none'` values compare equal to it.
- Viewers:
  - can select and copy, and get only Copy and Zoom to fit in menus;
  - never see the properties bar;
  - cannot cut, paste, duplicate, restack, restyle or lock.
- Tests:
  - unit: `npm test`;
  - types: `npm run typecheck`;
  - lint: `npm run lint`;
  - e2e: `npm run e2e`, with the web server on port 4000 and sync on 8787, reusing running servers.
- Commits use conventional messages and end with the `Co-Authored-By` trailer from the session attribution.
- Rulings made while writing this plan (the spec is silent on them):
  - A cut deletes everything the copy took, including children of cut frames, minus locked shapes.
  - Pasted items take the paster as creator (`createdBy`, `authorName`, `createdAt`).
  - Pasted shapes with no pasted parent drop into the frame under their centre, like new shapes.
  - Repeated `Ctrl+V` of the same clip steps +24 px each time. "Paste here" centres on the point.

---

## File Structure

**Core (`packages/core/src`)**
- `schema/types.ts` — `TextSize`, `Style.size?`, `Shape.locked?`.
- `schema/snapshot.ts`:
  - `readShape` and `readConnector` take any keyed source;
  - new `parseShape` and `parseConnector` for plain JSON;
  - reads `size` and `locked`.
- `commands/types.ts` — `StylePatch` plus the five new command variants.
- `commands/apply.ts` — the new commands, and lock skipping in the existing shape commands.
- `tools/machine.ts` — lock rules for drag, resize, nudge, delete and text/column editing.
- `clipboard/clip.ts` (new) — `copyPayload`, `serializeClip`, `parseClip`, `pastePlan`, `plainTextSticky` and the constants.
- `index.ts` — exports `clipboard/clip`.

**Web (`apps/web/src`)**
- `board/controller.ts`:
  - selection, menu, help and synced state;
  - clipboard and style actions, `createAt`, `commentAt`, `zoomToFit`;
  - `notify` toasts and unique page titles.
- `board/session.ts` — passes `notify: toast` and handles `hashchange`.
- `sync/key.ts` — `hashTarget`.
- `ui/shortcuts.ts` — new actions (duplicate, selectAll, z, zoomToFit, help); `TOOL_KEYS` exported.
- `ui/typing.ts` (new) — `isTyping`, shared by the keyboard and clipboard hooks.
- `ui/useShortcuts.ts` — runs the new actions.
- `ui/useClipboard.ts` (new) — `copy`/`cut`/`paste` document events.
- `ui/clipboard.ts` (new) — `writeClip` and `readClip` over `navigator.clipboard`.
- `ui/swatches.ts` (new) — the palette swatches, `NONE`, `sameColor`, `swatchBackground`.
- `ui/ContextMenu.tsx` — separators, swatch rows, shortcut hints, arrow keys, viewport clamp.
- `ui/canvasMenu.ts` (new) — the pure menu item builder.
- `ui/CanvasMenu.tsx` (new) — renders the controller's menu state.
- `ui/selectionInfo.ts` (new) — `selectionInfo` and `barPosition`, both pure.
- `ui/PropertiesBar.tsx` (new).
- `ui/shortcutList.ts` (new) — `SHORTCUT_GROUPS`.
- `ui/HelpDialog.tsx` (new).
- `ui/Toolbar.tsx` — the "?" button.
- `ui/Dialog.tsx` — `wide` prop, focus trap and focus restore.
- `ui/ShareDialog.tsx` — its own labels.
- `render/typography.ts` — `textStyle` from `style.font` and `style.size`.
- `render/ShapeView.tsx`, `render/FrameView.tsx`, `render/TextEditor.tsx` — use `textStyle`; lock badge.
- `render/SelectionLayer.tsx` — no handles on a locked shape.
- `render/Canvas.tsx` — `onContextMenu`.
- `render/EmptyHint.tsx` (new).
- `board/Board.tsx` — mounts the new pieces.
- `app/page.tsx` — landing copy.
- `app/globals.css` — the `focus-visible` ring.

**Tests**
- Core, in `packages/core/test/`:
  - `commands.test.ts` (extended);
  - `convergence.test.ts` (extended);
  - `tools-lock.test.ts` (new);
  - `clipboard.test.ts` (new).
- Web, in `apps/web/test/`:
  - `controller-ux.test.ts` (new);
  - `shortcuts.test.ts` (extended);
  - `typography.test.ts` (new);
  - `canvasMenu.test.ts` (new);
  - `selectionInfo.test.ts` (new);
  - `shortcutList.test.ts` (new);
  - `key.test.ts` (extended).
- E2E: `e2e/canvas-ux.spec.ts` (new).

---

### Task 1: Core — style size, lock flag and the new commands

**Files:**
- Modify: `packages/core/src/schema/types.ts`
- Modify: `packages/core/src/schema/snapshot.ts` (`readStyle`, `readShape`)
- Modify: `packages/core/src/commands/types.ts`
- Modify: `packages/core/src/commands/apply.ts`
- Test: `packages/core/test/commands.test.ts` (append a describe block)
- Test: `packages/core/test/convergence.test.ts` (three new step kinds)

**Interfaces:**
- Produces:
  - `type TextSize = 's' | 'm' | 'l'`;
  - `Style.size?: TextSize`;
  - `Shape.locked?: true`;
  - `type StylePatch = Partial<Pick<Style, 'fill' | 'stroke' | 'font' | 'size'>>`;
  - `Command` gains:
    - `{ type: 'SetZ'; ids: string[]; where: 'front' | 'back' }`
    - `{ type: 'SetStyle'; ids: string[]; patch: StylePatch }`
    - `{ type: 'SetLocked'; ids: string[]; locked: boolean }`
    - `{ type: 'SetHead'; id: string; head: 'arrow' | 'none' }`
    - `{ type: 'PasteItems'; shapes: NewShape[]; connectors: NewConnector[] }`

- [ ] **Step 1: Write the failing tests** — append to `packages/core/test/commands.test.ts` (it already has `sticky()` and `read()` helpers and imports `applyCommand`, `DEFAULT_STYLE`, `getRoots`, `LOCAL_ORIGIN`, `readConnector`, `readShape`, `Y`):

```ts
describe('canvas UX commands', () => {
  const frame = (id: string): NewShape => ({
    id,
    type: 'frame',
    x: 0,
    y: 0,
    w: 720,
    h: 440,
    style: DEFAULT_STYLE.frame,
    text: '',
    columns: [{ id: 'c1', title: 'A' }],
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 1,
  });
  const z = (doc: Y.Doc, id: string) => read(doc, id)?.z ?? '';
  const connect = (doc: Y.Doc, id: string, a: string, b: string) =>
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id,
        from: { shapeId: a, anchor: 'auto' },
        to: { shapeId: b, anchor: 'auto' },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
  const connectorZ = (doc: Y.Doc, id: string) => {
    const m = getRoots(doc).connectors.get(id);
    return (m ? readConnector(id, m)?.z : '') ?? '';
  };

  it('SetZ front puts the ids above the rest of their layer, keeping their order', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2', 's3']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    applyCommand(doc, { type: 'SetZ', ids: ['s2', 's1'], where: 'front' });
    expect(z(doc, 's3') < z(doc, 's1')).toBe(true);
    expect(z(doc, 's1') < z(doc, 's2')).toBe(true);
  });

  it('SetZ back puts the ids below the rest of their layer', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2', 's3']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    applyCommand(doc, { type: 'SetZ', ids: ['s3'], where: 'back' });
    expect(z(doc, 's3') < z(doc, 's1')).toBe(true);
  });

  it('SetZ restacks frames only among frames', () => {
    const doc = new Y.Doc();
    // z keys: s1 a0, f1 a1, f2 a2, s2 a3.
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: frame('f1') });
    applyCommand(doc, { type: 'CreateShape', shape: frame('f2') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s2') });
    applyCommand(doc, { type: 'SetZ', ids: ['f1'], where: 'front' });
    expect(z(doc, 'f1') > z(doc, 'f2')).toBe(true);
    // Only frames were compared: the frame did not have to climb above the top sticky.
    expect(z(doc, 'f1') <= z(doc, 's2')).toBe(true);
  });

  it('SetZ restacks connectors among connectors', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    connect(doc, 'k1', 's1', 's2');
    connect(doc, 'k2', 's2', 's1');
    applyCommand(doc, { type: 'SetZ', ids: ['k1'], where: 'front' });
    expect(connectorZ(doc, 'k1') > connectorZ(doc, 'k2')).toBe(true);
  });

  it('SetStyle merges the patch into the stored style', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'SetStyle', ids: ['s1'], patch: { fill: '#3B3BF5', size: 'l' } });
    expect(read(doc, 's1')?.style).toEqual({
      fill: '#3B3BF5',
      stroke: DEFAULT_STYLE.sticky.stroke,
      font: 'sans',
      size: 'l',
    });
  });

  it('reads an unknown font as the default and an unknown size as absent', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    getRoots(doc).shapes.get('s1')?.set('style', { fill: '#fff', stroke: '#000', font: 'comic', size: 'xl' });
    const style = read(doc, 's1')?.style;
    expect(style?.font).toBe('sans');
    expect(style?.size).toBeUndefined();
  });

  it('SetLocked sets and clears the flag; only `true` reads as locked', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    expect(read(doc, 's1')?.locked).toBe(true);
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: false });
    expect(read(doc, 's1')?.locked).toBeUndefined();
    expect(getRoots(doc).shapes.get('s1')?.has('locked')).toBe(false);
    getRoots(doc).shapes.get('s1')?.set('locked', 'yes');
    expect(read(doc, 's1')?.locked).toBeUndefined();
  });

  it('a locked shape ignores move, resize, text, delete, restyle, reparent and column rename', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: frame('f1') });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1', 'f1'], locked: true });
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 's1', x: 50, y: 50 }] });
    applyCommand(doc, { type: 'ResizeShapes', rects: [{ id: 's1', x: 0, y: 0, w: 10, h: 10 }] });
    applyCommand(doc, { type: 'SetText', id: 's1', index: 0, deleteCount: 2, insert: 'yo' });
    applyCommand(doc, { type: 'SetStyle', ids: ['s1'], patch: { fill: '#000000' } });
    applyCommand(doc, { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c1' }] });
    applyCommand(doc, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Z' });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1', 'f1'] });
    const s = read(doc, 's1');
    expect(s).toMatchObject({ x: 0, y: 0, w: 180, h: 140, text: 'hi' });
    expect(s?.style.fill).toBe(DEFAULT_STYLE.sticky.fill);
    expect(s?.parentId).toBeUndefined();
    expect(read(doc, 'f1')?.columns).toEqual([{ id: 'c1', title: 'A' }]);
  });

  it('a mixed delete removes only the unlocked shapes', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s2') });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1', 's2'] });
    expect(read(doc, 's1')).not.toBeNull();
    expect(read(doc, 's2')).toBeNull();
  });

  it('SetZ still restacks a locked shape', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    applyCommand(doc, { type: 'SetZ', ids: ['s1'], where: 'front' });
    expect(z(doc, 's1') > z(doc, 's2')).toBe(true);
  });

  it('DeletePage still removes locked shapes on that page', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'CreatePage',
      page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u1', createdAt: 1 },
    });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { pageId: 'p2' }) });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    applyCommand(doc, { type: 'DeletePage', id: 'p2' });
    expect(read(doc, 's1')).toBeNull();
  });

  it('SetHead sets a connector head', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    connect(doc, 'k1', 's1', 's2');
    applyCommand(doc, { type: 'SetHead', id: 'k1', head: 'none' });
    const m = getRoots(doc).connectors.get('k1');
    expect(m ? readConnector('k1', m)?.head : null).toBe('none');
  });

  it('PasteItems creates everything above the existing items, in order, in one transaction', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('old') });
    let updates = 0;
    doc.on('update', () => updates++);
    applyCommand(
      doc,
      {
        type: 'PasteItems',
        shapes: [sticky('p1'), sticky('p2')],
        connectors: [
          {
            id: 'pk',
            from: { shapeId: 'p1', anchor: 'auto' },
            to: { shapeId: 'p2', anchor: 'auto' },
            routing: 'elbow',
            head: 'arrow',
            createdBy: 'u1',
          },
        ],
      },
      LOCAL_ORIGIN,
    );
    expect(updates).toBe(1);
    expect(z(doc, 'old') < z(doc, 'p1')).toBe(true);
    expect(z(doc, 'p1') < z(doc, 'p2')).toBe(true);
    expect(read(doc, 'p1')?.text).toBe('hi');
    expect(getRoots(doc).connectors.has('pk')).toBe(true);
  });

  it('PasteItems skips ids that already exist', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { text: 'original' }) });
    applyCommand(doc, { type: 'PasteItems', shapes: [sticky('s1', { text: 'pasted' })], connectors: [] });
    expect(read(doc, 's1')?.text).toBe('original');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w @relay/core -- commands`
Expected: FAIL. TypeScript/vitest reports the unknown command types `SetZ`, `SetStyle`, … and `locked` is missing on `Shape`.

- [ ] **Step 3: Extend the types.** In `packages/core/src/schema/types.ts`, replace the `Style` interface and add `locked` to `Shape`:

```ts
export type TextSize = 's' | 'm' | 'l';

export interface Style {
  fill: string;
  stroke: string;
  font: FontRole;
  /** Text size; absent = 'm'. */
  size?: TextSize;
}
```

In `interface Shape`, after `columns?: FrameColumn[];` add:

```ts
  /** Nobody can move, resize, delete, restyle or edit it until it is unlocked. */
  locked?: true;
```

In `packages/core/src/commands/types.ts`:
- import `Style` from `'../schema/types'`;
- add `export type StylePatch = Partial<Pick<Style, 'fill' | 'stroke' | 'font' | 'size'>>;`;
- append these variants to the `Command` union:

```ts
  | { type: 'SetZ'; ids: string[]; where: 'front' | 'back' }
  | { type: 'SetStyle'; ids: string[]; patch: StylePatch }
  | { type: 'SetLocked'; ids: string[]; locked: boolean }
  | { type: 'SetHead'; id: string; head: 'arrow' | 'none' }
  | { type: 'PasteItems'; shapes: NewShape[]; connectors: NewConnector[] }
```

- [ ] **Step 4: Read `size` and `locked`.** In `packages/core/src/schema/snapshot.ts`, replace `readStyle` with:

```ts
function readStyle(v: unknown, type: ShapeType): Style {
  const d = DEFAULT_STYLE[type];
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const font = o.font === 'sans' || o.font === 'mono' || o.font === 'display' ? o.font : d.font;
  const style: Style = { fill: str(o.fill) ?? d.fill, stroke: str(o.stroke) ?? d.stroke, font };
  if (o.size === 's' || o.size === 'm' || o.size === 'l') style.size = o.size;
  return style;
}
```

In `readShape`, after the `columnId` lines, add `if (m.get('locked') === true) shape.locked = true;`.

- [ ] **Step 5: Implement the commands.** In `packages/core/src/commands/apply.ts`:
  - change the import to `import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';`;
  - add `import { compareZ } from '../schema/normalize';`;
  - add these helpers above `function apply`:

```ts
const isLocked = (m: Y.Map<unknown> | undefined): boolean => m?.get('locked') === true;

const zOf = (m: Y.Map<unknown>): string => {
  const z = m.get('z');
  return typeof z === 'string' ? z : 'a0';
};

/** `n` ascending keys above `edge` (front) or below it (back); tolerant of a malformed edge. */
function keysBeyond(edge: string | null, where: 'front' | 'back', n: number): string[] {
  try {
    return where === 'front'
      ? generateNKeysBetween(edge, null, n)
      : generateNKeysBetween(null, edge, n);
  } catch {
    // A malformed key from a misbehaving client must not block the command.
    return generateNKeysBetween(null, null, n);
  }
}

/** Gives the moving members of one layer fresh keys past every other member, keeping their order. */
function restack(
  members: [string, Y.Map<unknown>][],
  moving: ReadonlySet<string>,
  where: 'front' | 'back',
): void {
  const chosen = members
    .filter(([id]) => moving.has(id))
    .sort((a, b) => compareZ({ id: a[0], z: zOf(a[1]) }, { id: b[0], z: zOf(b[1]) }));
  if (chosen.length === 0) return;
  const rest = members
    .filter(([id]) => !moving.has(id))
    .map(([, m]) => zOf(m))
    .sort();
  const edge = where === 'front' ? (rest.at(-1) ?? null) : (rest[0] ?? null);
  const keys = keysBeyond(edge, where, chosen.length);
  chosen.forEach(([, m], i) => m.set('z', keys[i]));
}
```

Then change the existing cases:
  - `MoveShapes` and `ResizeShapes`: `if (!m || isLocked(m)) continue;`
  - `SetText`: the first lines become:
    ```ts
    const m = shapes.get(cmd.id);
    if (isLocked(m)) return;
    const text = m?.get('text');
    ```
  - `DeleteShapes`: `const ids = new Set(cmd.ids.filter((id) => !isLocked(shapes.get(id))));`
  - `Reparent`: `if (!m || isLocked(m)) continue;`
  - `RenameColumn`:
    ```ts
    const frame = shapes.get(cmd.frameId);
    if (isLocked(frame)) return;
    const cols = frame?.get('columns');
    ```

Then add the new cases before `StartVote`:

```ts
    case 'SetZ': {
      // Frames, other shapes and connectors stack independently (they render in that order).
      const moving = new Set(cmd.ids);
      const all = [...shapes.entries()];
      restack(all.filter(([, m]) => m.get('type') === 'frame'), moving, cmd.where);
      restack(all.filter(([, m]) => m.get('type') !== 'frame'), moving, cmd.where);
      restack([...connectors.entries()], moving, cmd.where);
      return;
    }
    case 'SetStyle': {
      for (const id of new Set(cmd.ids)) {
        const m = shapes.get(id);
        if (!m || isLocked(m)) continue;
        const current = m.get('style');
        const next: Record<string, unknown> =
          current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
        for (const [key, value] of Object.entries(cmd.patch)) {
          if (value !== undefined) next[key] = value;
        }
        m.set('style', next);
      }
      return;
    }
    case 'SetLocked': {
      for (const id of new Set(cmd.ids)) {
        const m = shapes.get(id);
        if (!m) continue;
        if (cmd.locked) m.set('locked', true);
        else m.delete('locked');
      }
      return;
    }
    case 'SetHead': {
      connectors.get(cmd.id)?.set('head', cmd.head);
      return;
    }
    case 'PasteItems': {
      const fresh = cmd.shapes.filter((s) => !shapes.has(s.id) && !connectors.has(s.id));
      const shapeKeys = keysBeyond(topZ(doc), 'front', fresh.length);
      fresh.forEach((shape, i) => apply(doc, { type: 'CreateShape', shape: { ...shape, z: shapeKeys[i] } }));
      const connectorKeys = keysBeyond(topKey(connectors), 'front', cmd.connectors.length);
      cmd.connectors.forEach((connector, i) =>
        apply(doc, { type: 'Connect', connector: { ...connector, z: connectorKeys[i] } }),
      );
      return;
    }
```

- [ ] **Step 6: Extend the convergence fuzz.** In `packages/core/test/convergence.test.ts`:

Add three members to the `Step` union:

```ts
  | { kind: 'z'; r: number; pick: number; front: boolean }
  | { kind: 'style'; r: number; pick: number; fill: string }
  | { kind: 'lock'; r: number; pick: number; locked: boolean };
```

Add three arbitraries at the end of `fc.oneof(...)`:

```ts
  fc.record({ kind: fc.constant('z' as const), r: replica, pick: fc.nat(), front: fc.boolean() }),
  fc.record({
    kind: fc.constant('style' as const),
    r: replica,
    pick: fc.nat(),
    fill: fc.constantFrom('#111111', '#F5D547', 'transparent'),
  }),
  fc.record({ kind: fc.constant('lock' as const), r: replica, pick: fc.nat(), locked: fc.boolean() }),
```

At the end of `run`'s loop, after the `if (s.kind === 'delete') …` line, add:

```ts
    if (s.kind === 'z')
      applyCommand(doc, { type: 'SetZ', ids: [id], where: s.front ? 'front' : 'back' }, LOCAL_ORIGIN);
    if (s.kind === 'style')
      applyCommand(doc, { type: 'SetStyle', ids: [id], patch: { fill: s.fill } }, LOCAL_ORIGIN);
    if (s.kind === 'lock')
      applyCommand(doc, { type: 'SetLocked', ids: [id], locked: s.locked }, LOCAL_ORIGIN);
```

- [ ] **Step 7: Run the core tests**

Run: `npm test -w @relay/core`
Expected: PASS (all core suites, including convergence).

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean. Web code still compiles, because `size` and `locked` are optional.

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): SetZ, SetStyle, SetLocked, SetHead and PasteItems; locked shapes ignore edits"
```

---

### Task 2: Core — tool machine lock rules

**Files:**
- Modify: `packages/core/src/tools/machine.ts` (`withChildren`, `pointerDownIdle`, the `deleteSelection` and `doubleClick` branches of `stepIdle`)
- Test: `packages/core/test/tools-lock.test.ts` (new)

**Interfaces:**
- Consumes: `Shape.locked` (Task 1).
- Produces: no new exports. `step` now:
  - never drags, resizes, nudges or deletes a locked shape;
  - never opens the text or column editor on one;
  - keeps locked shapes selected after a delete.

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/tools-lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  type Effect,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolState,
} from '../src';

const base: Omit<Shape, 'id'> = {
  type: 'rect',
  x: 100,
  y: 100,
  w: 160,
  h: 96,
  z: 'a1',
  style: DEFAULT_STYLE.rect,
  text: '',
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 0,
};
const locked: Shape = { ...base, id: 'r1', locked: true };
const free: Shape = { ...base, id: 'r2', x: 400 };
const frame: Shape = {
  ...base,
  id: 'f1',
  type: 'frame',
  x: 0,
  y: 0,
  w: 720,
  h: 440,
  z: 'a0',
  style: DEFAULT_STYLE.frame,
  columns: [{ id: 'c1', title: 'A' }],
};

function ctx(shapes: Shape[]): ToolContext {
  return {
    shapes: Object.fromEntries(shapes.map((s) => [s.id, s])),
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => 'new',
    now: () => 0,
  };
}
const idle = (selection: string[]): ToolState => ({ mode: 'idle', tool: 'select', selection });
const at = (x: number, y: number, hitId: string | null, extra: Partial<PointerInfo> = {}) => ({
  world: { x, y },
  shift: false,
  hitId,
  ...extra,
});
const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('tool machine lock rules', () => {
  it('pressing a locked shape selects it without starting a drag', () => {
    const r = step(idle([]), { type: 'pointerDown', p: at(120, 120, 'r1') }, ctx([locked]));
    expect(r.state).toEqual(idle(['r1']));
  });

  it('dragging a mixed selection moves only the unlocked shapes', () => {
    const c = ctx([locked, free]);
    const down = step(idle(['r1', 'r2']), { type: 'pointerDown', p: at(420, 120, 'r2') }, c);
    expect(down.state.mode).toBe('dragging');
    if (down.state.mode !== 'dragging') return;
    expect(Object.keys(down.state.starts)).toEqual(['r2']);
  });

  it('a resize handle on a locked shape is ignored', () => {
    const r = step(
      idle(['r1']),
      { type: 'pointerDown', p: at(260, 196, 'r1', { handle: 'se' }) },
      ctx([locked]),
    );
    expect(r.state.mode).not.toBe('resizing');
  });

  it('delete skips locked shapes and keeps them selected', () => {
    const r = step(idle(['r1', 'r2']), { type: 'deleteSelection' }, ctx([locked, free]));
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['r2'] }]);
    expect(r.state).toEqual(idle(['r1']));
  });

  it('delete of only locked shapes does nothing', () => {
    const r = step(idle(['r1']), { type: 'deleteSelection' }, ctx([locked]));
    expect(r.effects).toEqual([]);
  });

  it('nudge skips locked shapes', () => {
    const r = step(idle(['r1']), { type: 'nudge', dx: 1, dy: 0 }, ctx([locked]));
    expect(r.effects).toEqual([]);
  });

  it('double-click on a locked text-bearing shape does not open the editor', () => {
    const r = step(idle(['r1']), { type: 'doubleClick', p: at(120, 120, 'r1') }, ctx([locked]));
    expect(r.effects).toEqual([]);
  });

  it('double-click on a locked frame column does not edit the column', () => {
    const lockedFrame: Shape = { ...frame, locked: true };
    const r = step(
      idle([]),
      { type: 'doubleClick', p: at(10, 50, 'f1', { column: { frameId: 'f1', columnId: 'c1' } }) },
      ctx([lockedFrame]),
    );
    expect(r.effects).toEqual([]);
  });

  it('dragging a frame leaves its locked children in place', () => {
    const child: Shape = { ...base, id: 'k1', x: 20, y: 80, parentId: 'f1', columnId: 'c1', locked: true };
    const c = ctx([frame, child]);
    const down = step(idle(['f1']), { type: 'pointerDown', p: at(10, 10, 'f1') }, c);
    expect(down.state.mode).toBe('dragging');
    if (down.state.mode !== 'dragging') return;
    expect(Object.keys(down.state.starts)).toEqual(['f1']);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- tools-lock`
Expected: FAIL. The locked shapes are still dragged, resized, deleted and edited.

- [ ] **Step 3: Implement.** In `packages/core/src/tools/machine.ts`:

Replace `withChildren` with:

```ts
/** The unlocked selection plus the unlocked children of any unlocked selected frame (they move together). */
function withChildren(selection: string[], ctx: ToolContext): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    const s = ctx.shapes[id];
    if (s && !s.locked && !ids.includes(id)) ids.push(id);
  };
  for (const id of selection) {
    const s = ctx.shapes[id];
    if (!s || s.locked) continue;
    add(id);
    if (s.type === 'frame') for (const child of childrenOf(ctx.shapes, id)) add(child);
  }
  return ids;
}
```

In `pointerDownIdle`, case `'select'`:
- change the resize condition to `if (p.handle && only && target && !target.locked) {`;
- after the `starts` loop, and before returning the dragging state, add:

```ts
      // Nothing movable under the press (only locked shapes): just select.
      if (Object.keys(starts).length === 0) return none(idle('select', selection));
```

In `stepIdle`, replace the `deleteSelection` case:

```ts
    case 'deleteSelection': {
      const ids = state.selection.filter((id) => !ctx.shapes[id]?.locked);
      if (ids.length === 0) return none(state);
      return {
        state: idle(state.tool, state.selection.filter((id) => !ids.includes(id))),
        effects: [command({ type: 'DeleteShapes', ids }), END],
      };
    }
```

In the `doubleClick` case:
- add `!frame.locked &&` to the column condition, next to `frame?.type === 'frame'`;
- change the text guard to `if (!shape || !TEXT_TYPES.has(shape.type) || shape.locked) return none(state);`.

- [ ] **Step 4: Run all core tests**

Run: `npm test -w @relay/core`
Expected: PASS. The existing `tools.test.ts` and `tools-structure.test.ts` still pass, because unlocked behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): the tool machine never drags, resizes, deletes or edits locked shapes"
```

---

### Task 3: Core — clipboard payloads

**Files:**
- Modify: `packages/core/src/schema/snapshot.ts` (source-agnostic readers, `parseShape`, `parseConnector`)
- Create: `packages/core/src/clipboard/clip.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './clipboard/clip';`)
- Test: `packages/core/test/clipboard.test.ts` (new)

**Interfaces:**
- Consumes: `NewShape`, `NewConnector`, `childrenOf`, `dropTarget`, `isAttached`, `shapeBounds`, `unionRects`, `centerOf`, `compareZ`, `DEFAULT_SIZE`, `DEFAULT_STYLE`.
- Produces:
  - `parseShape(v: unknown): Shape | null`
  - `parseConnector(v: unknown): Connector | null`
  - `CLIP_PREFIX = 'relay-clip:v1:'`, `MAX_PASTE_SHAPES = 500`, `MAX_PASTE_CONNECTORS = 1000`, `MAX_PLAIN_PASTE = 2000`, `PASTE_OFFSET = 24`
  - `type ClipShape = Omit<Shape, 'z' | 'pageId'>`, `type ClipConnector = Omit<Connector, 'z' | 'pageId'>`
  - `interface ClipPayload { shapes: ClipShape[]; connectors: ClipConnector[] }`
  - `copyPayload(selection: readonly string[], shapes: Readonly<Record<string, Shape>>, connectors: Readonly<Record<string, Connector>>): ClipPayload | null`
  - `serializeClip(p: ClipPayload): string`
  - `parseClip(text: string): ClipPayload | null`
  - `interface PasteContext { shapes: Readonly<Record<string, Shape>>; newId(): string; userId: string; userName: string; now(): number }`
  - `type PastePlacement = { at: Point } | { offset: number }`
  - `pastePlan(payload: ClipPayload, ctx: PasteContext, place: PastePlacement): { shapes: NewShape[]; connectors: NewConnector[] }`
  - `plainTextSticky(text: string, at: Point, ctx: PasteContext): NewShape`

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/clipboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CLIP_PREFIX,
  type ClipPayload,
  type Connector,
  copyPayload,
  DEFAULT_STYLE,
  MAX_PASTE_SHAPES,
  type PasteContext,
  parseClip,
  parseShape,
  pastePlan,
  plainTextSticky,
  readShape,
  type Shape,
  serializeClip,
} from '../src';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 'a0',
  style: DEFAULT_STYLE.sticky,
  text: id,
  createdBy: 'u9',
  authorName: 'Old Author',
  createdAt: 5,
  ...extra,
});
const frame = shape('f1', {
  type: 'frame',
  w: 600,
  h: 400,
  z: 'a1',
  style: DEFAULT_STYLE.frame,
  columns: [{ id: 'c1', title: 'A' }],
});
const link = (id: string, from: string, to: string | { x: number; y: number }): Connector => ({
  id,
  from: { shapeId: from, anchor: 'auto' },
  to: typeof to === 'string' ? { shapeId: to, anchor: 'auto' } : to,
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u9',
});
const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.id, i]));

function pasteCtx(pageShapes: Shape[] = []): PasteContext {
  let n = 0;
  return {
    shapes: byId(pageShapes),
    newId: () => `n${++n}`,
    userId: 'u1',
    userName: 'Brisk Otter',
    now: () => 1000,
  };
}

describe('copyPayload', () => {
  it('copies a frame with its children and the connectors among copied shapes, in z order', () => {
    const child = shape('s1', { z: 'a2', parentId: 'f1', columnId: 'c1', pageId: 'p2' });
    const outside = shape('s2', { z: 'a3' });
    const p = copyPayload(
      ['f1'],
      byId([frame, child, outside]),
      byId([link('k1', 's1', 'f1'), link('k2', 's1', 's2')]),
    );
    expect(p?.shapes.map((s) => s.id)).toEqual(['f1', 's1']);
    expect(p?.shapes[1]).not.toHaveProperty('z');
    expect(p?.shapes[1]).not.toHaveProperty('pageId');
    expect(p?.connectors.map((c) => c.id)).toEqual(['k1']);
  });

  it('copies a selected connector with a free end, but not one attached outside the copy', () => {
    const p = copyPayload(
      ['s1', 'k1', 'k2'],
      byId([shape('s1'), shape('s2')]),
      byId([link('k1', 's1', { x: 5, y: 5 }), link('k2', 's1', 's2')]),
    );
    expect(p?.connectors.map((c) => c.id)).toEqual(['k1']);
  });

  it('returns null when nothing is copyable', () => {
    expect(copyPayload([], {}, {})).toBeNull();
    expect(copyPayload(['ghost'], {}, {})).toBeNull();
  });
});

describe('clip text', () => {
  const payload: ClipPayload = {
    shapes: [{ ...shape('s1') }].map(({ z: _z, ...rest }) => rest),
    connectors: [],
  };

  it('round-trips through serializeClip and parseClip', () => {
    const text = serializeClip(payload);
    expect(text.startsWith(CLIP_PREFIX)).toBe(true);
    expect(parseClip(text)).toEqual(payload);
  });

  it('rejects text that is not a Relay clip', () => {
    expect(parseClip('hello')).toBeNull();
    expect(parseClip(`${CLIP_PREFIX}{not json`)).toBeNull();
    expect(parseClip(`${CLIP_PREFIX}[]`)).toBeNull();
    expect(parseClip(`${CLIP_PREFIX}{"shapes":[{"id":"x","type":"blob"}]}`)).toBeNull();
  });

  it('drops invalid and duplicate items, caps shapes, drops connectors to missing shapes', () => {
    const many = Array.from({ length: MAX_PASTE_SHAPES + 5 }, (_, i) => ({
      ...shape(`s${i}`),
    }));
    const text = `${CLIP_PREFIX}${JSON.stringify({
      shapes: [many[0], many[0], { id: 5 }, ...many.slice(1)],
      connectors: [link('k1', 's0', 's1'), link('k2', 's0', 'missing'), { id: 'bad' }],
    })}`;
    const p = parseClip(text);
    expect(p?.shapes.length).toBeLessThanOrEqual(MAX_PASTE_SHAPES);
    expect(new Set(p?.shapes.map((s) => s.id)).size).toBe(p?.shapes.length);
    expect(p?.connectors.map((c) => c.id)).toEqual(['k1']);
  });
});

describe('parseShape', () => {
  it('reads text from plain JSON only for text-bearing types', () => {
    expect(parseShape({ ...shape('s1'), text: 'hey' })?.text).toBe('hey');
    expect(parseShape({ ...shape('l1', { type: 'line' }), text: 'no' })?.text).toBeUndefined();
  });

  it('rejects non-objects and missing ids', () => {
    expect(parseShape([])).toBeNull();
    expect(parseShape({ type: 'sticky' })).toBeNull();
  });

  it('a stored Y.Map still ignores a plain string text', () => {
    const doc = new Y.Doc();
    const m = doc.getMap<unknown>('probe');
    m.set('type', 'sticky');
    m.set('text', 'plain');
    expect(readShape('x', m)?.text).toBeUndefined();
  });
});

describe('pastePlan', () => {
  // z order: frame a1, child a2, orphan a3.
  const child = shape('s1', { x: 20, y: 60, z: 'a2', parentId: 'f1', columnId: 'c1' });
  const orphan = shape('s2', { x: 700, y: 0, z: 'a3', parentId: 'gone', columnId: 'c9' });
  const payload = copyPayload(['f1', 's2', 'k1'], byId([frame, child, orphan]), byId([
    link('k1', 's1', { x: 10, y: 10 }),
  ])) as ClipPayload;

  it('assigns new ids, remaps parents and ends, offsets and takes the paster as creator', () => {
    const plan = pastePlan(payload, pasteCtx(), { offset: 24 });
    const [f, c, o] = plan.shapes;
    expect(plan.shapes.map((s) => s.id)).toEqual(['n1', 'n2', 'n3']);
    expect(f).toMatchObject({ x: 24, y: 24, columns: [{ id: 'c1', title: 'A' }] });
    expect(c).toMatchObject({ x: 44, y: 84, parentId: 'n1', columnId: 'c1' });
    expect(o?.parentId).toBeUndefined();
    expect(o?.columnId).toBeUndefined();
    expect(c).toMatchObject({ createdBy: 'u1', authorName: 'Brisk Otter', createdAt: 1000 });
    expect(plan.connectors).toEqual([
      {
        id: 'n4',
        from: { shapeId: 'n2', anchor: 'auto' },
        to: { x: 34, y: 34 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    ]);
  });

  it('centres the pasted bounds on a point', () => {
    const one = copyPayload(['s1'], byId([shape('s1')]), {}) as ClipPayload;
    const plan = pastePlan(one, pasteCtx(), { at: { x: 500, y: 500 } });
    expect(plan.shapes[0]).toMatchObject({ x: 450, y: 450 });
  });

  it('drops a pasted top-level shape into the page frame under its centre', () => {
    const one = copyPayload(['s1'], byId([shape('s1')]), {}) as ClipPayload;
    const plan = pastePlan(one, pasteCtx([frame]), { at: { x: 100, y: 100 } });
    expect(plan.shapes[0]).toMatchObject({ parentId: 'f1', columnId: 'c1' });
  });
});

describe('plainTextSticky', () => {
  it('centres a sticky on the point and caps the text', () => {
    const s = plainTextSticky('x'.repeat(5000), { x: 300, y: 300 }, pasteCtx());
    expect(s).toMatchObject({ type: 'sticky', x: 210, y: 230, w: 180, h: 140 });
    expect(s.text?.length).toBe(2000);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- clipboard`
Expected: FAIL (missing exports `copyPayload`, `parseShape`, …).

- [ ] **Step 3: Make the readers source-agnostic.** In `packages/core/src/schema/snapshot.ts`, add under the helpers:

```ts
/** Anything with a keyed getter: a stored Y.Map, or a plain JSON object (clipboard). */
export interface Source {
  get(key: string): unknown;
}

const plainSource = (o: Record<string, unknown>): Source => ({
  get: (key) => (Object.hasOwn(o, key) ? o[key] : undefined),
});
```

Change the signatures to `readShape(id: string, m: Source): Shape | null` and `readConnector(id: string, m: Source): Connector | null`. A `Y.Map<unknown>` satisfies `Source` structurally, so no caller changes.

In `readShape`, replace the text and columns blocks with:

```ts
  const text = m.get('text');
  if (text instanceof Y.Text) shape.text = text.toString();
  // Plain JSON (the clipboard) carries text as a string; a stored map must hold a Y.Text.
  else if (!(m instanceof Y.Map) && typeof text === 'string' && TEXT_TYPES.has(type))
    shape.text = text;
  const cols = m.get('columns');
  const list = cols instanceof Y.Array ? cols.toArray() : !(m instanceof Y.Map) && Array.isArray(cols) ? cols : null;
  if (list) {
    const seen = new Set<string>();
    const result: { id: string; title: string }[] = [];
    for (const c of list) {
      if (result.length >= MAX_COLUMNS) break;
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.title !== 'string' || seen.has(o.id)) continue;
      seen.add(o.id);
      result.push({ id: o.id, title: o.title });
    }
    shape.columns = result;
  }
```

Add `TEXT_TYPES` to the `./types` import. Append:

```ts
const plainObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A shape from plain JSON (the clipboard), validated like a stored one; null if invalid. */
export function parseShape(v: unknown): Shape | null {
  const o = plainObject(v);
  if (!o || typeof o.id !== 'string' || o.id.length === 0) return null;
  return readShape(o.id, plainSource(o));
}

/** A connector from plain JSON (the clipboard); null if invalid. */
export function parseConnector(v: unknown): Connector | null {
  const o = plainObject(v);
  if (!o || typeof o.id !== 'string' || o.id.length === 0) return null;
  return readConnector(o.id, plainSource(o));
}
```

- [ ] **Step 4: Write the clipboard module.** Create `packages/core/src/clipboard/clip.ts`:

```ts
import type { NewConnector, NewShape } from '../commands/types';
import { isAttached } from '../geometry/connectors';
import { childrenOf, dropTarget } from '../geometry/frames';
import { centerOf, unionRects } from '../geometry/rect';
import { shapeBounds } from '../geometry/shapes';
import { DEFAULT_SIZE, DEFAULT_STYLE } from '../schema/defaults';
import { compareZ } from '../schema/normalize';
import { parseConnector, parseShape } from '../schema/snapshot';
import type { Connector, Endpoint, Point, Rect, Shape } from '../schema/types';

export const CLIP_PREFIX = 'relay-clip:v1:';
export const MAX_PASTE_SHAPES = 500;
export const MAX_PASTE_CONNECTORS = 1000;
export const MAX_PLAIN_PASTE = 2000;
export const PASTE_OFFSET = 24;

export type ClipShape = Omit<Shape, 'z' | 'pageId'>;
export type ClipConnector = Omit<Connector, 'z' | 'pageId'>;

/** What a copy carries: shapes and connectors in z order, without page or z. */
export interface ClipPayload {
  shapes: ClipShape[];
  connectors: ClipConnector[];
}

const stripShape = ({ z: _z, pageId: _page, ...rest }: Shape): ClipShape => rest;
const stripConnector = ({ z: _z, pageId: _page, ...rest }: Connector): ClipConnector => rest;

/**
 * The copy of a selection: the selected shapes plus the children of selected frames, and each
 * connector whose attached ends are all copied and that is selected or attached to a copied
 * shape. Null when nothing is copyable.
 */
export function copyPayload(
  selection: readonly string[],
  shapes: Readonly<Record<string, Shape>>,
  connectors: Readonly<Record<string, Connector>>,
): ClipPayload | null {
  const ids = new Set<string>();
  for (const id of selection) {
    const s = shapes[id];
    if (!s) continue;
    ids.add(id);
    if (s.type === 'frame') for (const child of childrenOf(shapes, id)) ids.add(child);
  }
  const picked = new Set(selection);
  const copiedShapes = [...ids]
    .flatMap((id) => {
      const s = shapes[id];
      return s ? [s] : [];
    })
    .sort(compareZ)
    .map(stripShape);
  const copiedConnectors = Object.values(connectors)
    .filter((c) => {
      const ends = [c.from, c.to].filter(isAttached);
      if (!ends.every((e) => ids.has(e.shapeId))) return false;
      return picked.has(c.id) || ends.length > 0;
    })
    .sort(compareZ)
    .map(stripConnector);
  if (copiedShapes.length === 0 && copiedConnectors.length === 0) return null;
  return { shapes: copiedShapes, connectors: copiedConnectors };
}

export const serializeClip = (p: ClipPayload): string => CLIP_PREFIX + JSON.stringify(p);

/** Clipboard text as a payload (every item validated, lists capped), or null if it is not a Relay clip. */
export function parseClip(text: string): ClipPayload | null {
  if (!text.startsWith(CLIP_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(CLIP_PREFIX.length));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
  const seen = new Set<string>();
  const shapes: ClipShape[] = [];
  for (const v of list(o.shapes, MAX_PASTE_SHAPES)) {
    const s = parseShape(v);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    shapes.push(stripShape(s));
  }
  const shapeIds = new Set(shapes.map((s) => s.id));
  const connectors: ClipConnector[] = [];
  for (const v of list(o.connectors, MAX_PASTE_CONNECTORS)) {
    const c = parseConnector(v);
    if (!c || seen.has(c.id)) continue;
    if (![c.from, c.to].every((e) => !isAttached(e) || shapeIds.has(e.shapeId))) continue;
    seen.add(c.id);
    connectors.push(stripConnector(c));
  }
  return shapes.length > 0 || connectors.length > 0 ? { shapes, connectors } : null;
}

export interface PasteContext {
  /** Shapes of the page being pasted onto (frames under pasted shapes adopt them). */
  shapes: Readonly<Record<string, Shape>>;
  newId(): string;
  userId: string;
  userName: string;
  now(): number;
}

/** Centred on a world point, or shifted by an offset from where the items were copied. */
export type PastePlacement = { at: Point } | { offset: number };

function payloadBounds(p: ClipPayload): Rect | null {
  const rects: Rect[] = p.shapes.map(shapeBounds);
  for (const c of p.connectors) {
    for (const e of [c.from, c.to]) if (!isAttached(e)) rects.push({ x: e.x, y: e.y, w: 0, h: 0 });
  }
  return unionRects(rects);
}

/**
 * New shapes and connectors for a paste. Ids are fresh, and parents and connector ends are
 * remapped. A parent (and its column) is kept only when the parent is pasted too. Any other
 * pasted non-frame shape drops into the page frame under its centre, like a new shape.
 * The paster becomes the creator.
 */
export function pastePlan(
  payload: ClipPayload,
  ctx: PasteContext,
  place: PastePlacement,
): { shapes: NewShape[]; connectors: NewConnector[] } {
  let dx: number;
  let dy: number;
  if ('at' in place) {
    const b = payloadBounds(payload);
    dx = b ? place.at.x - (b.x + b.w / 2) : 0;
    dy = b ? place.at.y - (b.y + b.h / 2) : 0;
  } else {
    dx = place.offset;
    dy = place.offset;
  }
  const idMap = new Map<string, string>();
  for (const s of payload.shapes) idMap.set(s.id, ctx.newId());
  const shapes: NewShape[] = payload.shapes.map((s) => {
    const { parentId, columnId, ...rest } = s;
    const out: NewShape = {
      ...rest,
      id: idMap.get(s.id) as string,
      x: s.x + dx,
      y: s.y + dy,
      createdBy: ctx.userId,
      authorName: ctx.userName,
      createdAt: ctx.now(),
    };
    const parent = parentId ? idMap.get(parentId) : undefined;
    if (parent) {
      out.parentId = parent;
      if (columnId) out.columnId = columnId;
    } else if (s.type !== 'frame') {
      const target = dropTarget(ctx.shapes, centerOf(shapeBounds(out)), new Set());
      if (target) {
        out.parentId = target.parentId;
        if (target.columnId) out.columnId = target.columnId;
      }
    }
    return out;
  });
  const end = (e: Endpoint): Endpoint | null => {
    if (!isAttached(e)) return { x: e.x + dx, y: e.y + dy };
    const id = idMap.get(e.shapeId);
    return id ? { shapeId: id, anchor: e.anchor } : null;
  };
  const connectors: NewConnector[] = [];
  for (const c of payload.connectors) {
    const from = end(c.from);
    const to = end(c.to);
    if (!from || !to) continue;
    connectors.push({
      id: ctx.newId(),
      from,
      to,
      routing: c.routing,
      head: c.head,
      createdBy: ctx.userId,
    });
  }
  return { shapes, connectors };
}

/** Text from another app pastes as a sticky centred on `at` (text capped at 2000 chars). */
export function plainTextSticky(text: string, at: Point, ctx: PasteContext): NewShape {
  const size = DEFAULT_SIZE.sticky;
  const shape: NewShape = {
    id: ctx.newId(),
    type: 'sticky',
    x: at.x - size.w / 2,
    y: at.y - size.h / 2,
    ...size,
    style: DEFAULT_STYLE.sticky,
    text: text.slice(0, MAX_PLAIN_PASTE),
    createdBy: ctx.userId,
    authorName: ctx.userName,
    createdAt: ctx.now(),
  };
  const target = dropTarget(ctx.shapes, at, new Set());
  if (target) {
    shape.parentId = target.parentId;
    if (target.columnId) shape.columnId = target.columnId;
  }
  return shape;
}
```

Add `export * from './clipboard/clip';` to `packages/core/src/index.ts`, keeping the alphabetical order (after `./commands/undo` is fine, but `clipboard` sorts before `commands`, so put it first).

- [ ] **Step 5: Run the core tests**

Run: `npm test -w @relay/core`
Expected: PASS. In the `pastePlan` test the page context has no frames, so the orphan `s2` simply loses its dangling parent.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add packages/core
git commit -m "feat(core): clipboard payloads — copy, validate on paste, remap ids, place"
```

---

### Task 4: Web — controller canvas actions

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Test: `apps/web/test/controller-ux.test.ts` (new)

**Interfaces:**
- Consumes (from Tasks 1–3):
  - `copyPayload`, `serializeClip`, `parseClip`, `pastePlan`, `plainTextSticky`, `PASTE_OFFSET`, `StylePatch`;
  - `DEFAULT_SIZE`, `screenToWorld`, `contentBounds`, `fitBounds`.
- Produces — additions to `BoardUiState`:
  - `menu: CanvasMenuState | null`
  - `help: boolean`
  - `synced: boolean`
  - `export interface CanvasMenuState { screen: Point; world: Point; hitId: string | null }`
- Produces — additions to `BoardController`, exact signatures:

```ts
  select(ids: string[]): void;
  selectAll(): void;
  openMenu(at: { screen: Point; world: Point; hitId: string | null; connectorId: string | null }): void;
  closeMenu(): void;
  copySelection(): string | null;
  cutSelection(): string | null;
  lastCopied(): string | null;
  pasteText(text: string, at?: Point): boolean;
  duplicate(): void;
  setZ(where: 'front' | 'back'): void;
  setStyle(patch: StylePatch): void;
  toggleLock(): void;
  setHead(head: 'arrow' | 'none'): void;
  setRouting(routing: Routing): void;
  createAt(type: 'sticky' | 'rect' | 'frame', p: Point): void;
  commentAt(p: Point, hitId: string | null): void;
  zoomToFit(): void;
  setHelp(open: boolean): void;
```

- [ ] **Step 1: Write the failing tests** — create `apps/web/test/controller-ux.test.ts`:

```ts
import {
  applyCommand,
  CLIP_PREFIX,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  readShape,
} from '@relay/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

const user = { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' };

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  let n = 0;
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user,
    newId: () => `id${++n}`,
    now: () => 1000,
    serverNow: () => 1_000_000,
  });
  return { doc, docs, controller };
}

const sticky = (id: string, extra: Partial<NewShape> = {}): NewShape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 180,
  h: 140,
  style: DEFAULT_STYLE.sticky,
  text: id,
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 1,
  ...extra,
});
const add = (doc: Y.Doc, shape: NewShape) =>
  applyCommand(doc, { type: 'CreateShape', shape }, LOCAL_ORIGIN);
const read = (doc: Y.Doc, id: string) => {
  const m = getRoots(doc).shapes.get(id);
  return m ? readShape(id, m) : null;
};
const selection = (c: ReturnType<typeof setup>['controller']) => c.ui.getState().tool.selection;

describe('controller canvas actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('copies the selection as a Relay clip and remembers it', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    expect(controller.copySelection()).toBeNull();
    controller.select(['a']);
    const text = controller.copySelection();
    expect(text?.startsWith(CLIP_PREFIX)).toBe(true);
    expect(controller.lastCopied()).toBe(text);
  });

  it('pastes a clip at +24 px, then +48 px, selected, each paste one undo step', () => {
    const { doc, docs, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    const text = controller.copySelection() as string;
    expect(controller.pasteText(text)).toBe(true);
    const first = selection(controller)[0] as string;
    expect(read(doc, first)).toMatchObject({ x: 24, y: 24, text: 'a' });
    controller.pasteText(text);
    const second = selection(controller)[0] as string;
    expect(read(doc, second)).toMatchObject({ x: 48, y: 48 });
    controller.undo();
    expect(read(doc, second)).toBeNull();
    expect(read(doc, first)).not.toBeNull();
    expect(Object.keys(docs.store.getState().shapes)).toHaveLength(2);
  });

  it('pastes centred on a point', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    controller.pasteText(controller.copySelection() as string, { x: 500, y: 500 });
    expect(read(doc, selection(controller)[0] as string)).toMatchObject({ x: 410, y: 430 });
  });

  it('pastes plain text as a sticky; blank text pastes nothing', () => {
    const { doc, controller } = setup();
    expect(controller.pasteText('   ')).toBe(false);
    expect(controller.pasteText('From elsewhere', { x: 0, y: 0 })).toBe(true);
    expect(read(doc, selection(controller)[0] as string)?.text).toBe('From elsewhere');
  });

  it('pastes onto the active page', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    const text = controller.copySelection() as string;
    const page = controller.createPage('board');
    controller.setPage(page);
    controller.pasteText(text);
    expect(getRoots(doc).shapes.get(selection(controller)[0] as string)?.get('pageId')).toBe(page);
  });

  it('cut deletes the unlocked part and keeps locked shapes selected', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b', { x: 300 }));
    applyCommand(doc, { type: 'SetLocked', ids: ['b'], locked: true }, LOCAL_ORIGIN);
    controller.select(['a', 'b']);
    expect(controller.cutSelection()?.startsWith(CLIP_PREFIX)).toBe(true);
    expect(read(doc, 'a')).toBeNull();
    expect(read(doc, 'b')).not.toBeNull();
    expect(selection(controller)).toEqual(['b']);
  });

  it('duplicate copies the selection at +24 px without touching the clipboard', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    controller.duplicate();
    expect(read(doc, selection(controller)[0] as string)).toMatchObject({ x: 24, y: 24 });
    expect(controller.lastCopied()).toBeNull();
  });

  it('setZ, setStyle and toggleLock act on the selection', () => {
    const { doc, docs, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b'));
    controller.select(['a']);
    controller.setZ('front');
    expect(docs.store.getState().order).toEqual(['b', 'a']);
    controller.setStyle({ fill: '#3B3BF5' });
    expect(read(doc, 'a')?.style.fill).toBe('#3B3BF5');
    controller.toggleLock();
    expect(read(doc, 'a')?.locked).toBe(true);
    controller.setStyle({ fill: '#FFFFFF' });
    expect(read(doc, 'a')?.style.fill).toBe('#3B3BF5');
    controller.toggleLock();
    expect(read(doc, 'a')?.locked).toBeUndefined();
  });

  it('setHead and setRouting change selected connectors', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b', { x: 400 }));
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          from: { shapeId: 'a', anchor: 'auto' },
          to: { shapeId: 'b', anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    controller.select(['k']);
    controller.setHead('none');
    controller.setRouting('elbow');
    const k = getRoots(doc).connectors.get('k');
    expect(k?.get('head')).toBe('none');
    expect(k?.get('routing')).toBe('elbow');
  });

  it('selectAll selects every shape and connector on the page', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b'));
    controller.selectAll();
    expect(selection(controller)).toEqual(['a', 'b']);
  });

  it('openMenu selects an unselected hit, keeps a selection that contains it, clears on empty canvas', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b'));
    const at = { screen: { x: 1, y: 2 }, world: { x: 3, y: 4 }, connectorId: null };
    controller.openMenu({ ...at, hitId: 'a' });
    expect(selection(controller)).toEqual(['a']);
    expect(controller.ui.getState().menu).toEqual({ screen: at.screen, world: at.world, hitId: 'a' });
    controller.select(['a', 'b']);
    controller.openMenu({ ...at, hitId: 'b' });
    expect(selection(controller)).toEqual(['a', 'b']);
    controller.openMenu({ ...at, hitId: null });
    expect(selection(controller)).toEqual([]);
    controller.closeMenu();
    expect(controller.ui.getState().menu).toBeNull();
  });

  it('createAt makes a sticky (editing) or a centred rectangle at the point', () => {
    const { doc, controller } = setup();
    controller.createAt('sticky', { x: 100, y: 100 });
    const s = selection(controller)[0] as string;
    expect(read(doc, s)).toMatchObject({ type: 'sticky', x: 10, y: 30 });
    expect(controller.ui.getState().editingId).toBe(s);
    controller.stopEditing();
    controller.createAt('rect', { x: 100, y: 100 });
    expect(read(doc, selection(controller)[0] as string)).toMatchObject({ type: 'rect', x: 20, y: 52 });
    expect(controller.ui.getState().tool.tool).toBe('select');
  });

  it('commentAt opens the composer anchored to the shape under the point', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a', { x: 10, y: 10 }));
    controller.commentAt({ x: 30, y: 40 }, 'a');
    expect(controller.ui.getState().composer).toEqual({
      anchor: { shapeId: 'a', dx: 20, dy: 30 },
      at: { x: 30, y: 40 },
    });
  });

  it('zoomToFit fits the page content into the viewport', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a', { x: 1000, y: 1000 }));
    controller.setViewportSize(800, 600);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    controller.zoomToFit();
    expect(controller.ui.getState().camera).not.toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('closes the text editor when the edited shape becomes locked', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.dispatch({ type: 'doubleClick', p: { world: { x: 5, y: 5 }, shift: false, hitId: 'a' } });
    expect(controller.ui.getState().editingId).toBe('a');
    applyCommand(doc, { type: 'SetLocked', ids: ['a'], locked: true }, 'remote');
    expect(controller.ui.getState().editingId).toBeNull();
  });

  it('help, menu and synced flags', () => {
    const { controller } = setup();
    expect(controller.ui.getState().synced).toBe(false);
    controller.markSynced();
    expect(controller.ui.getState().synced).toBe(true);
    controller.setHelp(true);
    expect(controller.ui.getState().help).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- controller-ux`
Expected: FAIL (methods missing).

- [ ] **Step 3: Implement in `apps/web/src/board/controller.ts`.**

(a) Extend the `@relay/core` import:
  - add `copyPayload`, `DEFAULT_SIZE`, `type NewConnector`, `type NewShape`, `parseClip`;
  - add `PASTE_OFFSET`, `pastePlan`, `plainTextSticky`, `type Routing`, `screenToWorld`;
  - add `serializeClip` and `type StylePatch`.

(b) Add above `BoardUiState`:

```ts
/** An open canvas context menu. */
export interface CanvasMenuState {
  /** Client coordinates where it opens. */
  screen: Point;
  /** The world point that was right-clicked. */
  world: Point;
  /** Shape under the pointer, if any. */
  hitId: string | null;
}
```

Add these fields to `BoardUiState`:

```ts
  menu: CanvasMenuState | null;
  /** The keyboard shortcuts dialog is open. */
  help: boolean;
  /** The document finished its first sync. */
  synced: boolean;
```

Add the new methods, with the doc comments from the Interfaces block, to `BoardController`. Initialise `menu: null, help: false, synced: false` in `createStore`.

(c) Inside `createBoardController`, replace the inline `dispatch(event) {…}` method with a named const defined before `return`, and return it as `dispatch`:

```ts
  const dispatch = (event: ToolEvent) => {
    // …the existing body, unchanged…
  };
```

(d) Add these helpers after `travel`:

```ts
  /** Replaces the selection; only between gestures. Selecting switches to the select tool. */
  const setSelection = (ids: string[]) => {
    if (ui.getState().tool.mode !== 'idle') return;
    ui.setState({ tool: { mode: 'idle', tool: 'select', selection: ids } });
  };
  const selectionNow = () => ui.getState().tool.selection;
  /** Several commands as exactly one undo step. */
  const commitStep = (...commands: Command[]) => {
    if (commands.length === 0) return;
    throttledCommit.cancel();
    undoStack.stopCapturing();
    for (const c of commands) commit(c);
    undoStack.stopCapturing();
  };
  const pasteContext = () => ({
    shapes: opts.docStore.getState().shapes,
    newId,
    userId: opts.user.id,
    userName: opts.user.name,
    now,
  });
  const pointerOrCentre = (): Point =>
    ui.getState().pointer ?? screenToWorld(ui.getState().camera, viewportCentre());
  /** Creates a paste plan on the active page, selected, as one undo step. */
  const place = (plan: { shapes: NewShape[]; connectors: NewConnector[] }): boolean => {
    if (plan.shapes.length === 0 && plan.connectors.length === 0) return false;
    const pageId = activePage();
    commitStep({
      type: 'PasteItems',
      shapes: plan.shapes.map((s) => ({ ...s, pageId })),
      connectors: plan.connectors.map((c) => ({ ...c, pageId })),
    });
    setSelection([...plan.shapes.map((s) => s.id), ...plan.connectors.map((c) => c.id)]);
    return true;
  };
  // The in-app clipboard (fallback when the system clipboard cannot be read) and how many
  // times in a row it was pasted, so repeated pastes step down and right.
  let clip: string | null = null;
  let repeat = { text: '', n: 0 };
  const copySelection = (): string | null => {
    const { shapes, connectors } = opts.docStore.getState();
    const payload = copyPayload(selectionNow(), shapes, connectors);
    if (!payload) return null;
    clip = serializeClip(payload);
    repeat = { text: clip, n: 0 };
    return clip;
  };
```

`viewportCentre` is currently declared after `travel`. Make sure it is declared before `pointerOrCentre` is called: calls happen at runtime, so declaration order within the closure only matters for `const` TDZ at call time. Keep all helpers above `return`.

(e) In the `docStore.subscribe` callback:
- add `menu: null,` to the page-change `ui.setState({...})`;
- extend the editor-close rule to locked shapes:

```ts
    if (editingId && (!doc.shapes[editingId] || doc.shapes[editingId]?.locked)) stopEditing();
    if (
      editingColumn &&
      (doc.shapes[editingColumn.frameId]?.type !== 'frame' || doc.shapes[editingColumn.frameId]?.locked)
    ) {
      ui.setState({ editingColumn: null });
    }
```

(f) `markSynced` also sets `ui.setState({ synced: true })`.

(g) Add these methods to the returned object:

```ts
    select: setSelection,
    selectAll() {
      const { order, connectorOrder } = opts.docStore.getState();
      setSelection([...order, ...connectorOrder]);
    },
    openMenu(at) {
      const { tool } = ui.getState();
      if (tool.mode !== 'idle') return;
      const target = at.hitId ?? at.connectorId;
      if (!target) setSelection([]);
      else if (!tool.selection.includes(target)) setSelection([target]);
      ui.setState({ menu: { screen: at.screen, world: at.world, hitId: at.hitId } });
    },
    closeMenu() {
      if (ui.getState().menu) ui.setState({ menu: null });
    },
    copySelection,
    cutSelection() {
      const text = copySelection();
      if (!text) return null;
      const payload = parseClip(text);
      const { shapes } = opts.docStore.getState();
      // Everything the copy took (frame children included), plus selected connectors; never locked shapes.
      const ids = [...new Set([...(payload?.shapes.map((s) => s.id) ?? []), ...selectionNow()])].filter(
        (id) => !shapes[id]?.locked,
      );
      if (ids.length > 0) {
        commitStep({ type: 'DeleteShapes', ids });
        setSelection(selectionNow().filter((id) => !ids.includes(id)));
      }
      return text;
    },
    lastCopied: () => clip,
    pasteText(text, at) {
      if (ui.getState().tool.mode !== 'idle') return false;
      const ctx = pasteContext();
      const payload = parseClip(text);
      if (payload) {
        if (at) return place(pastePlan(payload, ctx, { at }));
        repeat = repeat.text === text ? { text, n: repeat.n + 1 } : { text, n: 1 };
        return place(pastePlan(payload, ctx, { offset: PASTE_OFFSET * repeat.n }));
      }
      const body = text.trim();
      if (!body) return false;
      return place({ shapes: [plainTextSticky(body, at ?? pointerOrCentre(), ctx)], connectors: [] });
    },
    duplicate() {
      if (ui.getState().tool.mode !== 'idle') return;
      const { shapes, connectors } = opts.docStore.getState();
      const payload = copyPayload(selectionNow(), shapes, connectors);
      if (payload) place(pastePlan(payload, pasteContext(), { offset: PASTE_OFFSET }));
    },
    setZ(where) {
      const ids = selectionNow();
      if (ids.length > 0) commitStep({ type: 'SetZ', ids, where });
    },
    setStyle(patch) {
      const { shapes } = opts.docStore.getState();
      const ids = selectionNow().filter((id) => shapes[id] && !shapes[id]?.locked);
      if (ids.length > 0) commitStep({ type: 'SetStyle', ids, patch });
    },
    toggleLock() {
      const { shapes } = opts.docStore.getState();
      const targets = selectionNow().filter((id) => shapes[id]);
      if (targets.length === 0) return;
      const locked = !targets.every((id) => shapes[id]?.locked);
      commitStep({ type: 'SetLocked', ids: targets, locked });
    },
    setHead(head) {
      const { connectors } = opts.docStore.getState();
      commitStep(
        ...selectionNow()
          .filter((id) => connectors[id])
          .map((id): Command => ({ type: 'SetHead', id, head })),
      );
    },
    setRouting(routing) {
      const { connectors } = opts.docStore.getState();
      commitStep(
        ...selectionNow()
          .filter((id) => connectors[id])
          .map((id): Command => ({ type: 'SetRouting', id, routing })),
      );
    },
    createAt(type, p) {
      if (ui.getState().tool.mode !== 'idle') return;
      const size = DEFAULT_SIZE[type];
      // Click-created stickies centre on the press; drawn tools put their corner there.
      const world = type === 'sticky' ? p : { x: p.x - size.w / 2, y: p.y - size.h / 2 };
      const info = { world, shift: false, hitId: null };
      dispatch({ type: 'setTool', tool: type });
      dispatch({ type: 'pointerDown', p: info });
      if (ui.getState().tool.mode === 'drawing') dispatch({ type: 'pointerUp', p: info });
    },
    commentAt(p, hitId) {
      const s = hitId ? opts.docStore.getState().shapes[hitId] : undefined;
      const anchor: CommentAnchor = s
        ? { shapeId: s.id, dx: p.x - s.x, dy: p.y - s.y }
        : { x: p.x, y: p.y };
      ui.setState({ composer: { anchor, at: p }, openThread: null });
    },
    zoomToFit() {
      const v = ui.getState().viewport;
      const bounds = contentBounds(opts.docStore.getState().shapes);
      if (v && bounds) setCamera(fitBounds(bounds, v.w, v.h));
    },
    setHelp(open) {
      ui.setState({ help: open });
    },
```

Note: `setStyle`'s filter `shapes[id] && !shapes[id]?.locked` compiles under `noUncheckedIndexedAccess`. If Biome flags the non-null pattern, use `const s = shapes[id]; return !!s && !s.locked;`.

- [ ] **Step 4: Run the web tests**

Run: `npm test -w @relay/web`
Expected: PASS (new file plus the existing `controller.test.ts`).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add apps/web/src/board/controller.ts apps/web/test/controller-ux.test.ts
git commit -m "feat(web): controller actions for clipboard, z-order, style, lock, menus and help"
```

---

### Task 5: Web — shortcuts and clipboard events

**Files:**
- Create: `apps/web/src/ui/typing.ts`
- Modify: `apps/web/src/ui/shortcuts.ts`
- Modify: `apps/web/src/ui/useShortcuts.ts`
- Create: `apps/web/src/ui/useClipboard.ts`
- Modify: `apps/web/src/board/Board.tsx` (call `useClipboard(session)` next to `useShortcuts`)
- Test: `apps/web/test/shortcuts.test.ts` (extend)

**Interfaces:**
- Consumes: the controller methods from Task 4.
- Produces:
  - `isTyping(target: EventTarget | null): boolean` in `ui/typing.ts`;
  - `export const TOOL_KEYS`;
  - `KeyInput.code?: string`;
  - `ShortcutAction` gains `{ type: 'duplicate' }`, `{ type: 'selectAll' }`, `{ type: 'z'; where: 'front' | 'back' }`, `{ type: 'zoomToFit' }` and `{ type: 'help' }`.

- [ ] **Step 1: Write the failing tests** — append to `apps/web/test/shortcuts.test.ts` (it imports `keyDownAction` and `gateByRole`; add any missing imports):

```ts
describe('canvas UX shortcuts', () => {
  const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  it('maps Ctrl/⌘+D and Ctrl/⌘+A', () => {
    expect(keyDownAction(key('d', { ctrlKey: true }), false)).toEqual({ type: 'duplicate' });
    expect(keyDownAction(key('a', { metaKey: true }), false)).toEqual({ type: 'selectAll' });
    expect(keyDownAction(key('a', { ctrlKey: true }), true)).toBeNull();
  });

  it('maps ] and [ to z-order, Shift+1 to zoom to fit and ? to help', () => {
    expect(keyDownAction(key(']'), false)).toEqual({ type: 'z', where: 'front' });
    expect(keyDownAction(key('['), false)).toEqual({ type: 'z', where: 'back' });
    expect(keyDownAction(key('!', { shiftKey: true, code: 'Digit1' }), false)).toEqual({
      type: 'zoomToFit',
    });
    expect(keyDownAction(key('?', { shiftKey: true }), false)).toEqual({ type: 'help' });
  });

  it('viewers cannot duplicate or restack but can select all, fit and open help', () => {
    expect(gateByRole({ type: 'duplicate' }, 'view')).toBeNull();
    expect(gateByRole({ type: 'z', where: 'front' }, 'view')).toBeNull();
    expect(gateByRole({ type: 'selectAll' }, 'view')).toEqual({ type: 'selectAll' });
    expect(gateByRole({ type: 'zoomToFit' }, null)).toEqual({ type: 'zoomToFit' });
    expect(gateByRole({ type: 'help' }, 'view')).toEqual({ type: 'help' });
    expect(gateByRole({ type: 'duplicate' }, 'edit')).toEqual({ type: 'duplicate' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- shortcuts`
Expected: FAIL.

- [ ] **Step 3: Implement `shortcuts.ts`.**
  - Add `code?: string;` to `KeyInput`, with the doc comment `/** Physical key (layout-independent), e.g. 'Digit1'. */`.
  - Export `TOOL_KEYS`.
  - Extend `ShortcutAction` with the five variants.
  - In `keyDownAction`:
    - add `d` and `a` inside the ctrl/meta block;
    - add the plain keys after the space line.

```ts
    if (key === 'd' && !e.shiftKey) return { type: 'duplicate' };
    if (key === 'a' && !e.shiftKey) return { type: 'selectAll' };
```

```ts
  if (e.key === '?') return { type: 'help' };
  if (e.shiftKey && e.code === 'Digit1') return { type: 'zoomToFit' };
  if (e.key === ']') return { type: 'z', where: 'front' };
  if (e.key === '[') return { type: 'z', where: 'back' };
```

Replace `gateByRole` with:

```ts
/** Drops shortcuts the role may not use (only editors pick the comment tool, duplicate or restack). */
export function gateByRole(
  action: ShortcutAction | null,
  role: Role | null,
): ShortcutAction | null {
  if (!action || role === 'edit') return action;
  if (action.type === 'duplicate' || action.type === 'z') return null;
  if (action.type === 'dispatch' && action.event.type === 'setTool' && action.event.tool === 'comment')
    return null;
  return action;
}
```

- [ ] **Step 4: Shared typing check and runner.** Create `apps/web/src/ui/typing.ts`:

```ts
/** Focus is in an editable element: board keys and clipboard shortcuts must leave it alone. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}
```

In `useShortcuts.ts`, delete the local `isTyping` and import it from `./typing`. Add these cases to `run`:

```ts
        case 'duplicate':
          e.preventDefault();
          controller.duplicate();
          break;
        case 'selectAll':
          e.preventDefault();
          controller.selectAll();
          break;
        case 'z':
          controller.setZ(action.where);
          break;
        case 'zoomToFit':
          controller.zoomToFit();
          break;
        case 'help':
          e.preventDefault();
          controller.setHelp(true);
          break;
```

- [ ] **Step 5: Clipboard events.** Create `apps/web/src/ui/useClipboard.ts`:

```ts
import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from './typing';

/**
 * Ctrl/⌘+C, X and V on the board use the browser's clipboard events: they carry the data
 * without a permission prompt. Inputs, dialogs and a text selection keep native behaviour.
 */
export function useClipboard(session: BoardSession) {
  useEffect(() => {
    const { controller, conn } = session;
    const skip = (e: ClipboardEvent) => {
      if (!e.clipboardData || isTyping(e.target)) return true;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return true;
      const selected = window.getSelection();
      return e.type !== 'paste' && !!selected && !selected.isCollapsed;
    };
    const canEdit = () => conn.clock.getState().role === 'edit';
    const onCopy = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const text = controller.copySelection();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      const text = controller.cutSelection();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      if (controller.pasteText(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [session]);
}
```

In `Board.tsx`, add `import { useClipboard } from '../ui/useClipboard';` and call `useClipboard(session);` right after `useShortcuts(session);`.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint`
Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): duplicate, select all, z-order, fit and help shortcuts; system clipboard events"
```

---

### Task 6: Web — text style from the shape style, lock badge, no handles when locked

**Files:**
- Modify: `apps/web/src/render/typography.ts`
- Modify: `apps/web/src/render/ShapeView.tsx`
- Modify: `apps/web/src/render/FrameView.tsx`
- Modify: `apps/web/src/render/TextEditor.tsx`
- Modify: `apps/web/src/render/SelectionLayer.tsx`
- Test: `apps/web/test/typography.test.ts` (new)

**Interfaces:**
- Consumes: `Style.size`, `Shape.locked`.
- Produces:
  - `textStyle(s: Pick<Shape, 'type' | 'style'>): { className: string; fontSize: number }`;
  - `FONT_CLASS: Record<FontRole, string>`, `BASE_SIZE`, `SIZE_SCALE`;
  - `TEXT_STYLE` no longer contains font family or size classes.

- [ ] **Step 1: Write the failing test** — create `apps/web/test/typography.test.ts`:

```ts
import { DEFAULT_STYLE } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { textStyle } from '../src/render/typography';

describe('textStyle', () => {
  it('keeps the default look of each type', () => {
    expect(textStyle({ type: 'sticky', style: DEFAULT_STYLE.sticky })).toEqual({
      className: 'font-sans font-semibold leading-snug',
      fontSize: 14,
    });
    expect(textStyle({ type: 'text', style: DEFAULT_STYLE.text }).className).toContain('font-display');
    expect(textStyle({ type: 'code', style: DEFAULT_STYLE.code })).toMatchObject({ fontSize: 12 });
  });

  it('follows the style font and size', () => {
    const s = textStyle({ type: 'rect', style: { ...DEFAULT_STYLE.rect, font: 'mono', size: 'l' } });
    expect(s.className.startsWith('font-mono ')).toBe(true);
    expect(s.fontSize).toBe(19.5);
    expect(
      textStyle({ type: 'rect', style: { ...DEFAULT_STYLE.rect, size: 's' } }).fontSize,
    ).toBeCloseTo(10.4);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- typography`
Expected: FAIL (`textStyle` is not exported).

- [ ] **Step 3: Rewrite `apps/web/src/render/typography.ts`:**

```ts
import type { FontRole, Shape, ShapeType, TextSize } from '@relay/core';

/** Case, weight and line height per type; the family and size come from the shape's style. */
export const TEXT_STYLE: Record<ShapeType, string> = {
  rect: 'font-bold uppercase leading-snug text-center',
  ellipse: 'font-bold uppercase leading-snug text-center',
  line: '',
  sticky: 'font-semibold leading-snug',
  text: 'uppercase leading-tight',
  code: 'leading-relaxed',
  frame: 'font-bold uppercase tracking-wider',
};

/** Text size in px at size 'm'. */
export const BASE_SIZE: Record<ShapeType, number> = {
  rect: 13,
  ellipse: 13,
  line: 13,
  sticky: 14,
  text: 28,
  code: 12,
  frame: 13,
};

export const SIZE_SCALE: Record<TextSize, number> = { s: 0.8, m: 1, l: 1.5 };

export const FONT_CLASS: Record<FontRole, string> = {
  sans: 'font-sans',
  mono: 'font-mono',
  display: 'font-display',
};

/** Class names and font size (px) for a shape's text. */
export function textStyle(s: Pick<Shape, 'type' | 'style'>): { className: string; fontSize: number } {
  return {
    className: `${FONT_CLASS[s.style.font]} ${TEXT_STYLE[s.type]}`,
    fontSize: BASE_SIZE[s.type] * SIZE_SCALE[s.style.size ?? 'm'],
  };
}

export const TEXT_BOX: Record<ShapeType, string> = {
  rect: 'px-2',
  ellipse: 'px-6',
  line: '',
  sticky: 'p-3',
  text: '',
  code: 'px-3 pt-8 pb-3',
  frame: 'px-3 pt-2.5',
};

/** Height of the code block's dark header strip. */
export const CODE_HEADER = 22;

export const isCentered = (type: ShapeType) => type === 'rect' || type === 'ellipse';
```

Keep the existing `TEXT_BOX`, `CODE_HEADER` and `isCentered` values exactly as they are in the file. Keep their existing doc comments if they differ from the above.

- [ ] **Step 4: Use `textStyle` everywhere text renders.** Wherever `${TEXT_STYLE[…]}` appears in these files, replace it with the class from `textStyle(s)` and add `style={{ fontSize }}`:
  - `ShapeView.tsx`: `CenteredLabel`, and the sticky, text and code bodies;
  - `FrameView.tsx`: the title `<p>`;
  - `TextEditor.tsx`: the textarea.

For example, in `CenteredLabel`:

```tsx
function CenteredLabel({ s, editing }: { s: Shape; editing: boolean }) {
  const { className, fontSize } = textStyle(s);
  return (
    <foreignObject x={s.x} y={s.y} width={s.w} height={s.h} pointerEvents="none">
      <div className={`grid h-full place-items-center ${TEXT_BOX[s.type]}`}>
        <p
          className={`whitespace-pre-wrap break-words ${className} ${editing ? 'invisible' : ''}`}
          style={{ fontSize }}
        >
          {s.text}
        </p>
      </div>
    </foreignObject>
  );
}
```

In `TextEditor.tsx`, merge the font size into the existing style prop:

```tsx
        style={{
          fontSize: textStyle(shape).fontSize,
          ...(isCentered(shape.type) ? { paddingTop: Math.max(8, shape.h / 2 - 10) } : {}),
        }}
```

- [ ] **Step 5: Lock badge and cursor.** In `ShapeView.tsx`:
  - add `import { Lock } from 'lucide-react';` and `shapeBounds` from `@relay/core`;
  - add this component above `ShapeView`:

```tsx
/** A small ink tag on the top-right corner of a locked shape. */
function LockBadge({ s }: { s: Shape }) {
  const b = shapeBounds(s);
  return (
    <g
      data-testid="lock-badge"
      transform={`translate(${b.x + b.w - 10} ${b.y - 10})`}
      pointerEvents="none"
    >
      <rect width={20} height={20} fill={PALETTE.ink} />
      <Lock x={4} y={4} size={12} color={PALETTE.paper} strokeWidth={2.5} />
    </g>
  );
}
```

Then change the `ShapeView` return to:

```tsx
    <g data-shape-id={id} className={shape.locked ? 'cursor-default' : 'cursor-move'}>
      <Body s={shape} editing={editing} session={session} />
      {shape.locked && <LockBadge s={shape} />}
    </g>
```

- [ ] **Step 6: No handles on a locked shape.** In `SelectionLayer.tsx`, change the handles block guard from `{single &&` to `{single && !single.locked &&`.

- [ ] **Step 7: Test, typecheck, lint, commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint`
Expected: PASS and clean.

```bash
git add apps/web
git commit -m "feat(web): text follows style font and size; lock badge; locked shapes show no handles"
```

---

### Task 7: Web — context menus on the canvas

**Files:**
- Create: `apps/web/src/ui/swatches.ts`
- Modify: `apps/web/src/ui/ContextMenu.tsx`
- Create: `apps/web/src/ui/canvasMenu.ts`
- Create: `apps/web/src/ui/clipboard.ts`
- Create: `apps/web/src/ui/CanvasMenu.tsx`
- Modify: `apps/web/src/render/Canvas.tsx` (`onContextMenu`)
- Modify: `apps/web/src/board/Board.tsx` (mount `<CanvasMenu>`)
- Test: `apps/web/test/canvasMenu.test.ts` (new)

**Interfaces:**
- Consumes:
  - `controller.openMenu`, `closeMenu`, `copySelection`, `cutSelection`, `lastCopied`, `pasteText`, `duplicate`, `setZ`, `setStyle`, `toggleLock`, `commentAt`, `toggleVote`, `setRouting`, `setHead`, `createAt`, `selectAll`, `zoomToFit` (Task 4);
  - `useVoteOpen` (`render/voting.ts`), `voteKey` (core).
- Produces:
  - `swatches.ts`: `NONE`, `Swatch`, `FILL_SWATCHES`, `STROKE_SWATCHES`, `sameColor(a, b)`, `swatchBackground(color)`;
  - `ContextMenu.tsx`: `MenuItem` gains `hint?: string`; new `MenuSeparator` and `MenuSwatches`; `MenuEntry`; the `items` prop is now `MenuEntry[]` (PageTabs keeps passing `MenuItem[]`);
  - `canvasMenu.ts`: `CanvasMenuContext`, `CanvasMenuActions`, `canvasMenu(ctx, actions): MenuEntry[]`;
  - `clipboard.ts`: `writeClip(text): Promise<void>`, `readClip(fallback: string | null): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests** — create `apps/web/test/canvasMenu.test.ts`:

```ts
import { type Connector, DEFAULT_STYLE, type Shape } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import { type CanvasMenuActions, type CanvasMenuContext, canvasMenu } from '../src/ui/canvasMenu';
import type { MenuEntry } from '../src/ui/ContextMenu';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 'a0',
  style: DEFAULT_STYLE.sticky,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
  ...extra,
});
const connector: Connector = {
  id: 'k1',
  from: { x: 0, y: 0 },
  to: { x: 9, y: 9 },
  routing: 'elbow',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

function actions(): CanvasMenuActions {
  const names = [
    'copy', 'cut', 'paste', 'duplicate', 'remove', 'setZ', 'fill', 'toggleLock', 'comment',
    'vote', 'routing', 'head', 'create', 'selectAll', 'zoomToFit',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as CanvasMenuActions;
}
function ctx(extra: Partial<CanvasMenuContext> = {}): CanvasMenuContext {
  return {
    canEdit: true,
    selection: [],
    shapes: { s1: shape('s1'), s2: shape('s2', { locked: true }) },
    connectors: { k1: connector },
    world: { x: 10, y: 20 },
    hitId: null,
    voteOpen: false,
    voted: false,
    ...extra,
  };
}
const ids = (entries: MenuEntry[]) =>
  entries.flatMap((e) => ('label' in e ? [e.testId] : 'swatches' in e ? ['swatches'] : []));

describe('canvasMenu', () => {
  it('empty canvas: paste here, new items, select all, fit', () => {
    const a = actions();
    const items = canvasMenu(ctx(), a);
    expect(ids(items)).toEqual([
      'menu-paste-here',
      'menu-new-sticky',
      'menu-new-rect',
      'menu-new-frame',
      'menu-select-all',
      'menu-fit',
    ]);
    const pasteHere = items[0];
    if (pasteHere && 'label' in pasteHere) pasteHere.onSelect();
    expect(a.paste).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('selection: edit, order, fill, lock and comment', () => {
    expect(ids(canvasMenu(ctx({ selection: ['s1'], hitId: 's1' }), actions()))).toEqual([
      'menu-cut',
      'menu-copy',
      'menu-paste',
      'menu-duplicate',
      'menu-delete',
      'menu-front',
      'menu-back',
      'swatches',
      'menu-lock',
      'menu-comment',
    ]);
  });

  it('an all-locked selection offers Unlock and disables cut, delete and fill', () => {
    const items = canvasMenu(ctx({ selection: ['s2'], hitId: 's2' }), actions());
    const byId = (id: string) => items.find((e) => 'label' in e && e.testId === id);
    expect(byId('menu-lock')).toMatchObject({ label: 'Unlock' });
    expect(byId('menu-cut')).toMatchObject({ disabled: true });
    expect(byId('menu-delete')).toMatchObject({ disabled: true });
    expect(items.find((e) => 'swatches' in e)).toMatchObject({ disabled: true });
  });

  it('connectors add routing and arrow toggles', () => {
    const a = actions();
    const items = canvasMenu(ctx({ selection: ['k1'] }), a);
    const routing = items.find((e) => 'label' in e && e.testId === 'menu-routing');
    expect(routing).toMatchObject({ label: 'Straight' });
    if (routing && 'label' in routing) routing.onSelect();
    expect(a.routing).toHaveBeenCalledWith('straight');
    expect(items.find((e) => 'label' in e && e.testId === 'menu-head')).toMatchObject({
      label: 'Arrow off',
    });
  });

  it('a sticky under the pointer during an open vote can be voted on', () => {
    const items = canvasMenu(ctx({ selection: ['s1'], hitId: 's1', voteOpen: true }), actions());
    expect(items.find((e) => 'label' in e && e.testId === 'menu-vote')).toMatchObject({ label: 'Vote' });
    const voted = canvasMenu(
      ctx({ selection: ['s1'], hitId: 's1', voteOpen: true, voted: true }),
      actions(),
    );
    expect(voted.find((e) => 'label' in e && e.testId === 'menu-vote')).toMatchObject({
      label: 'Remove vote',
    });
  });

  it('viewers get only Copy (with a selection) and Zoom to fit', () => {
    expect(ids(canvasMenu(ctx({ canEdit: false, selection: ['s1'] }), actions()))).toEqual([
      'menu-copy',
      'menu-fit',
    ]);
    expect(ids(canvasMenu(ctx({ canEdit: false }), actions()))).toEqual(['menu-fit']);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- canvasMenu`
Expected: FAIL (the module is missing).

- [ ] **Step 3: Swatches.** Create `apps/web/src/ui/swatches.ts`:

```ts
import { PALETTE } from '@relay/core';

/** "No fill / no stroke": transparent keeps the shape clickable, unlike SVG's `none`. */
export const NONE = 'transparent';

export interface Swatch {
  name: string;
  label: string;
  color: string;
}

export const FILL_SWATCHES: readonly Swatch[] = [
  { name: 'white', label: 'White', color: PALETTE.white },
  { name: 'paper', label: 'Paper', color: PALETTE.paper },
  { name: 'sun', label: 'Sun', color: PALETTE.sun },
  { name: 'cobalt', label: 'Cobalt', color: PALETTE.cobalt },
  { name: 'flame', label: 'Flame', color: PALETTE.flame },
  { name: 'none', label: 'None', color: NONE },
];

export const STROKE_SWATCHES: readonly Swatch[] = [
  { name: 'ink', label: 'Ink', color: PALETTE.ink },
  { name: 'cobalt', label: 'Cobalt', color: PALETTE.cobalt },
  { name: 'flame', label: 'Flame', color: PALETTE.flame },
  { name: 'sun', label: 'Sun', color: PALETTE.sun },
  { name: 'none', label: 'None', color: NONE },
];

const norm = (c: string) => (c === 'none' ? NONE : c.toLowerCase());

/** Colour equality that treats SVG `none` as transparent and ignores hex case. */
export const sameColor = (a: string | null, b: string): boolean => a !== null && norm(a) === norm(b);

/** What a swatch button paints: the colour, or a red slash for none. */
export const swatchBackground = (color: string): string =>
  color === NONE
    ? `linear-gradient(to top right, transparent 44%, ${PALETTE.flame} 44% 56%, transparent 56%), ${PALETTE.white}`
    : color;
```

- [ ] **Step 4: Upgrade `ContextMenu.tsx`.** Replace the file with:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { swatchBackground } from './swatches';

export interface MenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
  /** Shortcut shown on the right. */
  hint?: string;
}

export interface MenuSeparator {
  separator: true;
}

export interface MenuSwatches {
  swatches: { color: string; label: string; onSelect(): void; testId?: string }[];
  disabled?: boolean;
}

export type MenuEntry = MenuItem | MenuSeparator | MenuSwatches;

const EDGE = 8;

/**
 * A small menu at client point (x, y), kept inside the viewport. It closes on an outside
 * press, Escape, or after a choice. Arrow keys move between the items.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - el.offsetWidth - EDGE));
    const top = Math.max(EDGE, Math.min(y, window.innerHeight - el.offsetHeight - EDGE));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const move = (delta: number) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + delta + buttons.length) % buttons.length]?.focus();
  };

  const choose = (onSelect: () => void) => {
    onClose();
    onSelect();
  };

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      className="fixed z-50 min-w-48 border-2 border-ink bg-white py-1 shadow-hard"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          move(e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      {items.map((item, i) => {
        if ('separator' in item) {
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
          return <hr key={`sep-${i}`} className="my-1 border-ink/20" />;
        }
        if ('swatches' in item) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one swatch row per menu position
            <div key={`swatches-${i}`} className="flex gap-1.5 px-3 py-1.5">
              {item.swatches.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="menuitem"
                  aria-label={s.label}
                  title={s.label}
                  data-testid={s.testId}
                  disabled={item.disabled}
                  className="size-5 border-2 border-ink hover:-translate-y-px focus:outline-2 focus:outline-cobalt disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: swatchBackground(s.color) }}
                  onClick={() => choose(s.onSelect)}
                />
              ))}
            </div>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            data-testid={item.testId}
            disabled={item.disabled}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left font-mono text-xs hover:bg-sun focus:bg-sun focus:outline-none disabled:cursor-not-allowed disabled:text-ink/40 disabled:hover:bg-transparent ${item.danger ? 'text-flame' : ''}`}
            onClick={() => choose(item.onSelect)}
          >
            <span>{item.label}</span>
            {item.hint && <span className="text-[10px] text-ink/50">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: The pure builder.** Create `apps/web/src/ui/canvasMenu.ts`:

```ts
import type { Connector, Point, Routing, Shape } from '@relay/core';
import type { MenuEntry } from './ContextMenu';
import { FILL_SWATCHES } from './swatches';

export interface CanvasMenuContext {
  canEdit: boolean;
  /** The selection after the right-click (it already contains the clicked item). */
  selection: string[];
  shapes: Readonly<Record<string, Shape>>;
  connectors: Readonly<Record<string, Connector>>;
  /** The world point that was right-clicked, and the shape under it. */
  world: Point;
  hitId: string | null;
  voteOpen: boolean;
  /** The local user has voted on the shape under the pointer. */
  voted: boolean;
}

export interface CanvasMenuActions {
  copy(): void;
  cut(): void;
  paste(at?: Point): void;
  duplicate(): void;
  remove(): void;
  setZ(where: 'front' | 'back'): void;
  fill(color: string): void;
  toggleLock(): void;
  comment(p: Point, hitId: string | null): void;
  vote(shapeId: string): void;
  routing(r: Routing): void;
  head(h: 'arrow' | 'none'): void;
  create(type: 'sticky' | 'rect' | 'frame', at: Point): void;
  selectAll(): void;
  zoomToFit(): void;
}

const SEP: MenuEntry = { separator: true };

/** The right-click menu for the canvas: one for a selection, one for empty canvas, a short one for viewers. */
export function canvasMenu(ctx: CanvasMenuContext, a: CanvasMenuActions): MenuEntry[] {
  const shapes = ctx.selection.flatMap((id) => {
    const s = ctx.shapes[id];
    return s ? [s] : [];
  });
  const connectors = ctx.selection.flatMap((id) => {
    const c = ctx.connectors[id];
    return c ? [c] : [];
  });
  const empty = shapes.length === 0 && connectors.length === 0;
  const fit: MenuEntry = { label: 'Zoom to fit', hint: 'Shift 1', onSelect: a.zoomToFit, testId: 'menu-fit' };
  const copy: MenuEntry = { label: 'Copy', hint: 'Ctrl C', onSelect: a.copy, testId: 'menu-copy' };

  if (!ctx.canEdit) return empty ? [fit] : [copy, fit];

  if (empty) {
    return [
      { label: 'Paste here', hint: 'Ctrl V', onSelect: () => a.paste(ctx.world), testId: 'menu-paste-here' },
      SEP,
      { label: 'New sticky here', onSelect: () => a.create('sticky', ctx.world), testId: 'menu-new-sticky' },
      { label: 'New rectangle here', onSelect: () => a.create('rect', ctx.world), testId: 'menu-new-rect' },
      { label: 'New frame here', onSelect: () => a.create('frame', ctx.world), testId: 'menu-new-frame' },
      SEP,
      { label: 'Select all', hint: 'Ctrl A', onSelect: a.selectAll, testId: 'menu-select-all' },
      fit,
    ];
  }

  const unlocked = shapes.filter((s) => !s.locked);
  const allLocked = shapes.length > 0 && unlocked.length === 0;
  const editable = unlocked.length > 0 || connectors.length > 0;
  const items: MenuEntry[] = [
    { label: 'Cut', hint: 'Ctrl X', onSelect: a.cut, disabled: !editable, testId: 'menu-cut' },
    copy,
    { label: 'Paste', hint: 'Ctrl V', onSelect: () => a.paste(), testId: 'menu-paste' },
    { label: 'Duplicate', hint: 'Ctrl D', onSelect: a.duplicate, testId: 'menu-duplicate' },
    {
      label: 'Delete',
      hint: 'Del',
      onSelect: a.remove,
      disabled: !editable,
      danger: true,
      testId: 'menu-delete',
    },
    SEP,
    { label: 'Bring to front', hint: ']', onSelect: () => a.setZ('front'), testId: 'menu-front' },
    { label: 'Send to back', hint: '[', onSelect: () => a.setZ('back'), testId: 'menu-back' },
  ];
  if (shapes.length > 0) {
    items.push(
      {
        swatches: FILL_SWATCHES.map((s) => ({
          color: s.color,
          label: `Fill ${s.label.toLowerCase()}`,
          onSelect: () => a.fill(s.color),
          testId: `menu-fill-${s.name}`,
        })),
        disabled: allLocked,
      },
      { label: allLocked ? 'Unlock' : 'Lock', onSelect: a.toggleLock, testId: 'menu-lock' },
    );
  }
  if (connectors.length > 0) {
    const allElbow = connectors.every((c) => c.routing === 'elbow');
    const allArrow = connectors.every((c) => c.head === 'arrow');
    items.push(
      SEP,
      {
        label: allElbow ? 'Straight' : 'Elbow',
        hint: 'E',
        onSelect: () => a.routing(allElbow ? 'straight' : 'elbow'),
        testId: 'menu-routing',
      },
      {
        label: allArrow ? 'Arrow off' : 'Arrow on',
        onSelect: () => a.head(allArrow ? 'none' : 'arrow'),
        testId: 'menu-head',
      },
    );
  }
  items.push(SEP, {
    label: 'Comment here',
    onSelect: () => a.comment(ctx.world, ctx.hitId),
    testId: 'menu-comment',
  });
  const hit = ctx.hitId ? ctx.shapes[ctx.hitId] : undefined;
  if (ctx.voteOpen && hit?.type === 'sticky') {
    items.push({
      label: ctx.voted ? 'Remove vote' : 'Vote',
      onSelect: () => a.vote(hit.id),
      testId: 'menu-vote',
    });
  }
  return items;
}
```

- [ ] **Step 6: Clipboard helpers.** Create `apps/web/src/ui/clipboard.ts`:

```ts
/** Writes to the system clipboard; a failure leaves the in-app copy (controller.lastCopied). */
export async function writeClip(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Permission denied or unsupported: pasting in this tab still works from the in-app copy.
  }
}

/** Reads the system clipboard, or returns `fallback` when the browser refuses. */
export async function readClip(fallback: string | null): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 7: The menu component.** Create `apps/web/src/ui/CanvasMenu.tsx`:

```tsx
import { type Point, voteKey } from '@relay/core';
import { useCallback } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { useVoteOpen } from '../render/voting';
import { canvasMenu } from './canvasMenu';
import { readClip, writeClip } from './clipboard';
import { ContextMenu } from './ContextMenu';
import { toast } from './toasts';

export function CanvasMenu({ session }: { session: BoardSession }) {
  const { controller } = session;
  const menu = useStore(controller.ui, (s) => s.menu);
  const selection = useStore(controller.ui, (s) => s.tool.selection);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const voteKeys = useStore(session.activity, (a) => a.voteKeys);
  const voteOpen = useVoteOpen(session);
  const close = useCallback(() => controller.closeMenu(), [controller]);
  if (!menu) return null;

  const paste = async (at?: Point) => {
    const text = await readClip(controller.lastCopied());
    if (text === null || !controller.pasteText(text, at)) toast('Nothing to paste — try Ctrl+V');
  };
  const items = canvasMenu(
    {
      canEdit,
      selection,
      shapes,
      connectors,
      world: menu.world,
      hitId: menu.hitId,
      voteOpen,
      voted: menu.hitId !== null && voteKeys.includes(voteKey(menu.hitId, session.user.id)),
    },
    {
      copy: () => {
        const text = controller.copySelection();
        if (text) void writeClip(text);
      },
      cut: () => {
        const text = controller.cutSelection();
        if (text) void writeClip(text);
      },
      paste: (at) => void paste(at),
      duplicate: () => controller.duplicate(),
      remove: () => controller.dispatch({ type: 'deleteSelection' }),
      setZ: (where) => controller.setZ(where),
      fill: (color) => controller.setStyle({ fill: color }),
      toggleLock: () => controller.toggleLock(),
      comment: (p, hitId) => controller.commentAt(p, hitId),
      vote: (id) => controller.toggleVote(id),
      routing: (r) => controller.setRouting(r),
      head: (h) => controller.setHead(h),
      create: (type, at) => controller.createAt(type, at),
      selectAll: () => controller.selectAll(),
      zoomToFit: () => controller.zoomToFit(),
    },
  );
  return <ContextMenu x={menu.screen.x} y={menu.screen.y} items={items} onClose={close} />;
}
```

Check that `ActivityState` exposes `voteKeys` (`controller.toggleVote` reads `opts.activity.getState().voteKeys`, so it does).

- [ ] **Step 8: Wire the canvas and board.** In `Canvas.tsx`, add this prop to the `<svg>`, after `onDoubleClick`:

```tsx
      onContextMenu={(e) => {
        e.preventDefault();
        if (controller.ui.getState().spaceHeld) return;
        const p = info(e);
        controller.openMenu({
          screen: { x: e.clientX, y: e.clientY },
          world: p.world,
          hitId: p.hitId,
          connectorId: p.connectorId ?? null,
        });
      }}
```

In `Board.tsx`, import `CanvasMenu` from `'../ui/CanvasMenu'` and render `<CanvasMenu session={session} />` inside the board-area `div`, after `<CommentsPanel>`.

- [ ] **Step 9: Test, typecheck, lint**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint`
Expected: PASS and clean. `PageTabs.tsx` still compiles, because `MenuItem[]` is assignable to `MenuEntry[]`.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): right-click menus for selections, connectors and empty canvas"
```

---

### Task 8: Web — floating properties bar

**Files:**
- Create: `apps/web/src/ui/selectionInfo.ts`
- Create: `apps/web/src/ui/PropertiesBar.tsx`
- Modify: `apps/web/src/board/Board.tsx` (mount it)
- Test: `apps/web/test/selectionInfo.test.ts` (new)

**Interfaces:**
- Consumes: `controller.setStyle`, `toggleLock`, `setRouting`, `setHead` (Task 4); `FONT_CLASS` (Task 6); `FILL_SWATCHES`, `STROKE_SWATCHES`, `sameColor`, `swatchBackground` (Task 7).
- Produces:
  - `selectionInfo(selection, shapes, connectors): SelectionInfo`;
  - `barPosition(target: Rect, bar: { w: number; h: number }, viewport: { w: number; h: number }): { left: number; top: number }`.

- [ ] **Step 1: Write the failing tests** — create `apps/web/test/selectionInfo.test.ts`:

```ts
import { type Connector, DEFAULT_STYLE, type Shape } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { barPosition, selectionInfo } from '../src/ui/selectionInfo';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 'a0',
  style: DEFAULT_STYLE.sticky,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
  ...extra,
});
const connector: Connector = {
  id: 'k1',
  from: { x: 300, y: 300 },
  to: { x: 400, y: 350 },
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

describe('selectionInfo', () => {
  it('reports common style values and mixed ones as null', () => {
    const shapes = {
      a: shape('a'),
      b: shape('b', { x: 200, style: { ...DEFAULT_STYLE.sticky, fill: '#fff', size: 'l' } }),
    };
    const info = selectionInfo(['a', 'b'], shapes, {});
    expect(info.fill).toBeNull();
    expect(info.stroke).toBe(DEFAULT_STYLE.sticky.stroke);
    expect(info.size).toBeNull();
    expect(info.textual).toBe(true);
    expect(info.bounds).toEqual({ x: 0, y: 0, w: 300, h: 100 });
  });

  it('style values come from the unlocked shapes; allLocked only when every shape is locked', () => {
    const shapes = { a: shape('a', { locked: true, style: { ...DEFAULT_STYLE.sticky, fill: '#000' } }), b: shape('b') };
    const mixed = selectionInfo(['a', 'b'], shapes, {});
    expect(mixed.allLocked).toBe(false);
    expect(mixed.fill).toBe(DEFAULT_STYLE.sticky.fill);
    expect(selectionInfo(['a'], shapes, {}).allLocked).toBe(true);
  });

  it('includes connectors: routing, head and path bounds', () => {
    const info = selectionInfo(['k1'], {}, { k1: connector });
    expect(info.routing).toBe('straight');
    expect(info.head).toBe('arrow');
    expect(info.bounds).toEqual({ x: 300, y: 300, w: 100, h: 50 });
  });

  it('is empty for an empty selection', () => {
    expect(selectionInfo([], {}, {}).bounds).toBeNull();
  });
});

describe('barPosition', () => {
  const viewport = { w: 1000, h: 800 };
  const bar = { w: 300, h: 40 };

  it('sits centred above the target', () => {
    expect(barPosition({ x: 400, y: 300, w: 200, h: 100 }, bar, viewport)).toEqual({ left: 350, top: 248 });
  });

  it('goes below when there is no room above, and stays inside the viewport', () => {
    expect(barPosition({ x: -100, y: 10, w: 50, h: 50 }, bar, viewport)).toEqual({ left: 8, top: 96 });
    expect(barPosition({ x: 950, y: 790, w: 100, h: 100 }, bar, viewport).left).toBe(692);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- selectionInfo`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/src/ui/selectionInfo.ts`:**

```ts
import {
  type Connector,
  connectorPath,
  type FontRole,
  type Rect,
  type Routing,
  type Shape,
  shapeBounds,
  TEXT_TYPES,
  type TextSize,
  unionRects,
} from '@relay/core';

export interface SelectionInfo {
  shapes: Shape[];
  connectors: Connector[];
  /** Every selected shape is locked (there is at least one). */
  allLocked: boolean;
  /** A text-bearing shape is among the styleable ones. */
  textual: boolean;
  /** Values shared by every styleable shape (unlocked ones, or all when all are locked); null when mixed. */
  fill: string | null;
  stroke: string | null;
  font: FontRole | null;
  size: TextSize | null;
  routing: Routing | null;
  head: Connector['head'] | null;
  /** World bounds of the selected shapes and connector paths. */
  bounds: Rect | null;
}

function common<T>(values: T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((v) => v === first) ? first : null;
}

export function selectionInfo(
  selection: readonly string[],
  shapes: Readonly<Record<string, Shape>>,
  connectors: Readonly<Record<string, Connector>>,
): SelectionInfo {
  const ss = selection.flatMap((id) => {
    const s = shapes[id];
    return s ? [s] : [];
  });
  const cs = selection.flatMap((id) => {
    const c = connectors[id];
    return c ? [c] : [];
  });
  const unlocked = ss.filter((s) => !s.locked);
  const styled = unlocked.length > 0 ? unlocked : ss;
  const rects: Rect[] = ss.map(shapeBounds);
  for (const c of cs) {
    for (const p of connectorPath(c, shapes) ?? []) rects.push({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  return {
    shapes: ss,
    connectors: cs,
    allLocked: ss.length > 0 && unlocked.length === 0,
    textual: styled.some((s) => TEXT_TYPES.has(s.type)),
    fill: common(styled.map((s) => s.style.fill)),
    stroke: common(styled.map((s) => s.style.stroke)),
    font: common(styled.map((s) => s.style.font)),
    size: common(styled.map((s) => s.style.size ?? 'm')),
    routing: common(cs.map((c) => c.routing)),
    head: common(cs.map((c) => c.head)),
    bounds: unionRects(rects),
  };
}

const GAP = 12;
/** Below the target the bar clears the W × H label. */
const BELOW_GAP = 36;
const MARGIN = 8;

/** Where the bar goes (container px): centred above the target, else below, always inside the viewport. */
export function barPosition(
  target: Rect,
  bar: { w: number; h: number },
  viewport: { w: number; h: number },
): { left: number; top: number } {
  let top = target.y - bar.h - GAP;
  if (top < MARGIN) top = target.y + target.h + BELOW_GAP;
  top = Math.max(MARGIN, Math.min(top, viewport.h - bar.h - MARGIN));
  const left = Math.max(MARGIN, Math.min(target.x + target.w / 2 - bar.w / 2, viewport.w - bar.w - MARGIN));
  return { left, top };
}
```

Verify the test numbers against this code. Centred: `top = 300 − 40 − 12 = 248` and `left = 400 + 100 − 150 = 350`. Below: `top = 10 + 50 + 36 = 96`, `left = max(8, −75 − 150) = 8`. Clamped: `left = min(950 + 50 − 150, 1000 − 300 − 8) = 692`.

- [ ] **Step 4: Implement `apps/web/src/ui/PropertiesBar.tsx`:**

```tsx
import { worldToScreen } from '@relay/core';
import { Lock, LockOpen } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { FONT_CLASS } from '../render/typography';
import { barPosition, selectionInfo } from './selectionInfo';
import { FILL_SWATCHES, STROKE_SWATCHES, type Swatch, sameColor, swatchBackground } from './swatches';

function Toggle({
  testId,
  label,
  pressed,
  disabled,
  onClick,
  className = '',
  children,
}: {
  testId: string;
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick(): void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 min-w-7 place-items-center border-2 px-1 font-mono text-[11px] font-bold ${pressed ? 'border-ink bg-sun' : 'border-transparent hover:border-ink'} disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function Swatches({
  kind,
  swatches,
  current,
  disabled,
  onPick,
}: {
  kind: 'fill' | 'stroke';
  swatches: readonly Swatch[];
  current: string | null;
  disabled: boolean;
  onPick(color: string): void;
}) {
  return (
    <div role="group" aria-label={kind === 'fill' ? 'Fill' : 'Stroke'} className="flex items-center gap-1">
      <span className="font-mono text-[9px] uppercase text-ink/50">{kind}</span>
      {swatches.map((s) => (
        <button
          key={s.name}
          type="button"
          data-testid={`props-${kind}-${s.name}`}
          aria-label={`${kind === 'fill' ? 'Fill' : 'Stroke'} ${s.label.toLowerCase()}`}
          title={s.label}
          aria-pressed={sameColor(current, s.color)}
          disabled={disabled}
          onClick={() => onPick(s.color)}
          className={`size-5 border-2 ${sameColor(current, s.color) ? 'border-cobalt outline-2 outline-cobalt' : 'border-ink'} disabled:cursor-not-allowed disabled:opacity-40`}
          style={{ background: swatchBackground(s.color) }}
        />
      ))}
    </div>
  );
}

const Divider = () => <span className="h-5 w-px bg-ink/20" aria-hidden />;

/** Floating controls for the selection: fill, stroke, font, size, lock; routing and arrow for connectors. */
export function PropertiesBar({ session }: { session: BoardSession }) {
  const { controller } = session;
  const selection = useStore(controller.ui, (s) => s.tool.selection);
  const idle = useStore(controller.ui, (s) => s.tool.mode === 'idle');
  const camera = useStore(controller.ui, (s) => s.camera);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Measure after every render: the content (and so the width) depends on the selection.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
  });

  const info = selectionInfo(selection, shapes, connectors);
  if (!canEdit || !idle || !info.bounds || !viewport) return null;
  const tl = worldToScreen(camera, { x: info.bounds.x, y: info.bounds.y });
  const target = { x: tl.x, y: tl.y, w: info.bounds.w * camera.zoom, h: info.bounds.h * camera.zoom };
  const pos = barPosition(target, size, viewport);
  const locked = info.allLocked;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection properties"
      data-testid="props-bar"
      className="absolute z-20 flex items-center gap-2 border-[3px] border-ink bg-white px-2 py-1 shadow-hard"
      style={{ left: pos.left, top: pos.top }}
    >
      {info.shapes.length > 0 && (
        <>
          <Swatches
            kind="fill"
            swatches={FILL_SWATCHES}
            current={info.fill}
            disabled={locked}
            onPick={(fill) => controller.setStyle({ fill })}
          />
          <Divider />
          <Swatches
            kind="stroke"
            swatches={STROKE_SWATCHES}
            current={info.stroke}
            disabled={locked}
            onPick={(stroke) => controller.setStyle({ stroke })}
          />
          {info.textual && (
            <>
              <Divider />
              {(['sans', 'mono', 'display'] as const).map((font) => (
                <Toggle
                  key={font}
                  testId={`props-font-${font}`}
                  label={`Font ${font}`}
                  pressed={info.font === font}
                  disabled={locked}
                  onClick={() => controller.setStyle({ font })}
                  className={FONT_CLASS[font]}
                >
                  Aa
                </Toggle>
              ))}
              <Divider />
              {(['s', 'm', 'l'] as const).map((s) => (
                <Toggle
                  key={s}
                  testId={`props-size-${s}`}
                  label={`Text size ${s.toUpperCase()}`}
                  pressed={info.size === s}
                  disabled={locked}
                  onClick={() => controller.setStyle({ size: s })}
                >
                  {s.toUpperCase()}
                </Toggle>
              ))}
            </>
          )}
          <Divider />
          <Toggle
            testId="props-lock"
            label={locked ? 'Unlock' : 'Lock'}
            pressed={locked}
            onClick={() => controller.toggleLock()}
          >
            {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
          </Toggle>
        </>
      )}
      {info.connectors.length > 0 && (
        <>
          {info.shapes.length > 0 && <Divider />}
          <Toggle
            testId="props-routing"
            label="Elbow routing"
            pressed={info.routing === 'elbow'}
            onClick={() => controller.setRouting(info.routing === 'elbow' ? 'straight' : 'elbow')}
          >
            Elbow
          </Toggle>
          <Toggle
            testId="props-head"
            label="Arrow head"
            pressed={info.head === 'arrow'}
            onClick={() => controller.setHead(info.head === 'arrow' ? 'none' : 'arrow')}
          >
            Arrow
          </Toggle>
        </>
      )}
    </div>
  );
}
```

In `Board.tsx`, import `PropertiesBar` from `'../ui/PropertiesBar'` and render `<PropertiesBar session={session} />` right after `<Toolbar session={session} />`.

- [ ] **Step 5: Test, typecheck, lint, commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint`
Expected: PASS and clean.

```bash
git add apps/web
git commit -m "feat(web): floating properties bar for fill, stroke, font, size, lock and connectors"
```

---

### Task 9: Web — help dialog, toolbar "?" and empty-page hint

**Files:**
- Create: `apps/web/src/ui/shortcutList.ts`
- Create: `apps/web/src/ui/HelpDialog.tsx`
- Modify: `apps/web/src/ui/Dialog.tsx` (`wide` prop only; the focus trap comes in Task 10)
- Modify: `apps/web/src/ui/Toolbar.tsx` ("?" button)
- Create: `apps/web/src/render/EmptyHint.tsx`
- Modify: `apps/web/src/board/Board.tsx` (mount `HelpDialog` and `EmptyHint`)
- Test: `apps/web/test/shortcutList.test.ts` (new)

**Interfaces:**
- Consumes: `controller.setHelp`, `ui.help`, `ui.synced` (Task 4); `TOOL_KEYS` (Task 5).
- Produces:
  - `SHORTCUT_GROUPS: readonly { title: string; items: readonly (readonly [keys: string, action: string])[] }[]`;
  - `Dialog` accepts `wide?: boolean`.

- [ ] **Step 1: Write the failing test** — create `apps/web/test/shortcutList.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from '../src/ui/shortcutList';
import { TOOL_KEYS } from '../src/ui/shortcuts';

describe('SHORTCUT_GROUPS', () => {
  it('lists every tool key', () => {
    const tools = SHORTCUT_GROUPS.find((g) => g.title === 'Tools')?.items.map(([k]) => k) ?? [];
    for (const key of Object.keys(TOOL_KEYS)) expect(tools).toContain(key.toUpperCase());
  });

  it('lists the canvas UX shortcuts', () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.items.map(([, what]) => what)).join(' | ');
    for (const what of ['Duplicate', 'Select all', 'Zoom to fit', 'Bring to front']) {
      expect(all).toContain(what);
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- shortcutList`
Expected: FAIL.

- [ ] **Step 3: The list.** Create `apps/web/src/ui/shortcutList.ts`:

```ts
/** Every board shortcut, grouped, for the help dialog. Keep in sync with shortcuts.ts. */
export const SHORTCUT_GROUPS = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'],
      ['R', 'Rectangle'],
      ['O', 'Ellipse'],
      ['L', 'Line'],
      ['A', 'Connector'],
      ['T', 'Text'],
      ['S', 'Sticky note'],
      ['C', 'Code block'],
      ['F', 'Frame'],
      ['M', 'Comment'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Ctrl C · X · V', 'Copy · cut · paste'],
      ['Ctrl D', 'Duplicate'],
      ['Ctrl A', 'Select all'],
      ['Del', 'Delete'],
      ['Arrows', 'Nudge (Shift: 10 px)'],
      [']', 'Bring to front'],
      ['[', 'Send to back'],
      ['E', 'Straight / elbow connector'],
      ['Ctrl Z', 'Undo'],
      ['Ctrl Shift Z', 'Redo'],
      ['Esc', 'Cancel'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Space + drag', 'Pan'],
      ['Wheel', 'Pan'],
      ['Ctrl + wheel', 'Zoom'],
      ['Shift 1', 'Zoom to fit'],
      ['?', 'This help'],
    ],
  },
  {
    title: 'Mouse',
    items: [
      ['Double-click', 'Edit text'],
      ['Right-click', 'Menu'],
      ['Shift + click', 'Add to selection'],
    ],
  },
] as const satisfies readonly { title: string; items: readonly (readonly [string, string])[] }[];
```

- [ ] **Step 4: `Dialog` width.** In `Dialog.tsx`:
  - add `wide = false` to the props, typed as `wide?: boolean`;
  - change the panel class `max-w-md` to `${wide ? 'max-w-2xl' : 'max-w-md'}`.

- [ ] **Step 5: The dialog.** Create `apps/web/src/ui/HelpDialog.tsx`:

```tsx
import { Fragment, useCallback } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from './Dialog';
import { SHORTCUT_GROUPS } from './shortcutList';

export function HelpDialog({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.help);
  const close = useCallback(() => controller.setHelp(false), [controller]);
  if (!open) return null;
  return (
    <Dialog title="Keyboard shortcuts" onClose={close} wide>
      <div
        data-testid="help-dialog"
        data-scroll-region
        className="grid max-h-[60vh] gap-5 overflow-y-auto sm:grid-cols-2"
      >
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink/60">
              {group.title}
            </h3>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
              {group.items.map(([keys, what]) => (
                <Fragment key={keys}>
                  <dt>
                    <kbd className="border border-ink/40 bg-paper px-1.5 py-px font-mono text-[10px]">
                      {keys}
                    </kbd>
                  </dt>
                  <dd className="font-mono text-xs">{what}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 6: The toolbar button.** In `Toolbar.tsx`, after the `.map(...)` inside `<nav>`, add:

```tsx
      <span className="my-0.5 h-px bg-ink/20" aria-hidden />
      <button
        type="button"
        data-testid="help-button"
        aria-label="Keyboard shortcuts (?)"
        title="Keyboard shortcuts (?)"
        onClick={() => session.controller.setHelp(true)}
        className="grid size-9 place-items-center border-2 border-ink bg-white font-display text-sm hover:bg-paper"
      >
        ?
      </button>
```

- [ ] **Step 7: Empty hint.** Create `apps/web/src/render/EmptyHint.tsx`:

```tsx
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/** First steps on an empty board page (editors only, after the first sync so it never flashes). */
export function EmptyHint({ session }: { session: BoardSession }) {
  const empty = useStore(session.doc, (d) => d.order.length === 0);
  const synced = useStore(session.controller.ui, (s) => s.synced);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  if (!empty || !synced || !canEdit) return null;
  return (
    <div
      data-testid="empty-hint"
      className="pointer-events-none absolute inset-0 grid place-items-center px-4"
    >
      <div className="border-2 border-dashed border-ink/40 bg-white/85 px-5 py-4 text-center">
        <p className="font-display text-sm uppercase">This page is empty</p>
        <p className="mt-1.5 font-mono text-xs text-ink/70">
          S sticky · R rectangle · F frame · Space-drag to pan · ? for help
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Mount.** In `Board.tsx`, import both components:
  - render `<EmptyHint session={session} />` right after `<Canvas session={session} />`, so it sits under the overlays;
  - render `<HelpDialog session={session} />` after `<CanvasMenu session={session} />`.

- [ ] **Step 9: Test, typecheck, lint, commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint`
Expected: PASS and clean.

```bash
git add apps/web
git commit -m "feat(web): keyboard shortcuts dialog, toolbar help button and empty-page hint"
```

---

### Task 10: Web — polish backlog

**Files:**
- Modify: `apps/web/src/board/controller.ts` (`notify` option, undo/redo toasts, displaced-page toast, unique page titles)
- Modify: `apps/web/src/board/session.ts` (`notify: toast`, `hashchange`)
- Modify: `apps/web/src/sync/key.ts` (`hashTarget`)
- Modify: `apps/web/src/ui/Dialog.tsx` (focus trap and restore)
- Modify: `apps/web/src/ui/ShareDialog.tsx` (labels)
- Modify: `apps/web/app/globals.css` (`focus-visible`)
- Modify: `apps/web/app/page.tsx` (landing copy)
- Modify: hover states, if missing, on `apps/web/src/ui/ZoomControls.tsx` and the header buttons in `apps/web/src/ui/Header.tsx`
- Test: `apps/web/test/controller-ux.test.ts` (append), `apps/web/test/key.test.ts` (append)

**Interfaces:**
- Produces:
  - `createBoardController` option `notify?: (message: string) => void`;
  - `hashTarget(hash: string, key: string | null, activePage: string): { page: string } | 'reload' | null`.

- [ ] **Step 1: Write the failing tests.** Append to `apps/web/test/controller-ux.test.ts`, inside the existing describe block:

```ts
  it('notifies after an undo or redo that did something', () => {
    const doc = new Y.Doc();
    const docs = createDocStore(doc);
    const activity = createActivityStore(doc);
    const notify = vi.fn();
    const controller = createBoardController({
      doc,
      docStore: docs.store,
      setPage: docs.setPage,
      activity: activity.store,
      user,
      notify,
    });
    controller.undo();
    expect(notify).not.toHaveBeenCalled();
    controller.createAt('rect', { x: 0, y: 0 });
    controller.undo();
    expect(notify).toHaveBeenLastCalledWith('Undone');
    controller.redo();
    expect(notify).toHaveBeenLastCalledWith('Redone');
  });

  it('notifies when a remote delete moves the user, not when they deleted the page', () => {
    const doc = new Y.Doc();
    const docs = createDocStore(doc);
    const activity = createActivityStore(doc);
    const notify = vi.fn();
    let n = 0;
    const controller = createBoardController({
      doc,
      docStore: docs.store,
      setPage: docs.setPage,
      activity: activity.store,
      user,
      newId: () => `p${++n}`,
      notify,
    });
    const a = controller.createPage('board');
    controller.setPage(a);
    controller.deletePage(a);
    expect(notify).not.toHaveBeenCalledWith('The page you were on was deleted');
    const b = controller.createPage('board');
    controller.setPage(b);
    applyCommand(doc, { type: 'DeletePage', id: b }, 'remote');
    expect(notify).toHaveBeenCalledWith('The page you were on was deleted');
  });

  it('never repeats an existing page title', () => {
    const { docs, controller } = setup();
    const two = controller.createPage('board');
    controller.createPage('board');
    controller.deletePage(two);
    controller.createPage('board');
    expect(docs.store.getState().pages.map((p) => p.title)).toEqual(['Board', 'Board 3', 'Board 4']);
  });
```

Append to `apps/web/test/key.test.ts`, and add `hashTarget` to its import from `'../src/sync/key'`:

```ts
describe('hashTarget', () => {
  it('asks for another page of the same room', () => {
    expect(hashTarget('#k=abc&p=p2', 'abc', 'main')).toEqual({ page: 'p2' });
  });
  it('ignores the page already showing or a hash without a page', () => {
    expect(hashTarget('#k=abc&p=main', 'abc', 'main')).toBeNull();
    expect(hashTarget('#k=abc', 'abc', 'main')).toBeNull();
  });
  it('asks for a reload when the key changes', () => {
    expect(hashTarget('#k=other&p=main', 'abc', 'main')).toBe('reload');
    expect(hashTarget('#p=main', 'abc', 'main')).toBe('reload');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- controller-ux key`
Expected: FAIL.

- [ ] **Step 3: Controller notify and titles.** In `controller.ts`:
  - Add the option `/** Shows a transient notice (toasts in the app). */ notify?: (message: string) => void;`.
  - In `travel`, replace the last two lines with:

```ts
    const done = direction === 'undo' ? undoStack.undo() : undoStack.redo();
    if (done) opts.notify?.(direction === 'undo' ? 'Undone' : 'Redone');
```

  - Add `const deletedHere = new Set<string>();` near the other closure state.
  - In `deletePage`, call `deletedHere.add(id);` right before `commitPage(...)`.
  - At the start of the page-change branch of the `docStore.subscribe` callback, add:

```ts
      const wasDeleted =
        prev.pages.some((p) => p.id === prev.activePage) &&
        !doc.pages.some((p) => p.id === prev.activePage);
      if (wasDeleted && !deletedHere.has(prev.activePage)) {
        opts.notify?.('The page you were on was deleted');
      }
```

  - In `createPage`, replace the title computation:

```ts
      const label = type === 'board' ? 'Board' : type === 'sheet' ? 'Sheet' : 'Calendar';
      const taken = new Set(pages.map((p) => p.title));
      let n = pages.filter((p) => p.type === type).length + 1;
      while (taken.has(`${label} ${n}`)) n++;
```

Use ``title: `${label} ${n}`.slice(0, MAX_PAGE_TITLE)``, and remove the now-unused `sameType` variable.

- [ ] **Step 4: `hashTarget`.** Append to `apps/web/src/sync/key.ts`:

```ts
/**
 * What a changed URL fragment asks for: another page of this room, a reload (the key changed,
 * so the capability did), or nothing.
 */
export function hashTarget(
  hash: string,
  key: string | null,
  activePage: string,
): { page: string } | 'reload' | null {
  if (keyFromHash(hash) !== key) return 'reload';
  const page = pageFromHash(hash);
  return page && page !== activePage ? { page } : null;
}
```

- [ ] **Step 5: Session wiring.** In `session.ts`:
  - import `toast` from `'../ui/toasts'` and `hashTarget` from `'../sync/key'`;
  - pass `notify: toast` to `createBoardController`;
  - before `return`, add:

```ts
  // Editing the fragment (or following an in-app #p= link) switches pages; replaceState never fires this.
  const onHashChange = () => {
    const target = hashTarget(window.location.hash, key, docStore.store.getState().activePage);
    if (target === 'reload') window.location.reload();
    else if (target) controller.setPage(target.page);
  };
  window.addEventListener('hashchange', onHashChange);
```

Then add `window.removeEventListener('hashchange', onHashChange);` at the top of `destroy()`.

- [ ] **Step 6: Dialog focus trap.** In `Dialog.tsx`:
  - replace the mount effect with one that remembers and restores focus;
  - replace the panel's `onKeyDown`;
  - update the comment above the window Escape listener: remove "since there is no focus trap" and say it covers focus that never entered the panel.

```ts
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

```ts
  // Focus moves into the dialog so board shortcuts (Delete, tool letters) cannot act behind it,
  // and returns to where it was when the dialog closes.
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
```

```tsx
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key !== 'Tab' || !panel.current) return;
          // Tab cycles inside the dialog.
          const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = items[0];
          const last = items.at(-1);
          if (!first || !last) {
            e.preventDefault();
            return;
          }
          const active = document.activeElement;
          if (e.shiftKey && (active === first || active === panel.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }}
```

- [ ] **Step 7: Share labels.** In `ShareDialog.tsx`, replace the `LinkRow` markup: the wrapping `<label>` becomes a `<div className="mt-3">`, the label names the input by id, and Copy gets its own name.

```tsx
  const inputId = `share-${testId}-input`;
  return (
    <div className="mt-3">
      <label htmlFor={inputId} className="font-mono text-[10px] uppercase text-ink/60">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={inputId}
          readOnly
          data-testid={`share-${testId}-link`}
          value={link ?? (unavailable ? 'Not available' : 'Connecting…')}
          className="flex-1 border-2 border-ink/30 px-2 py-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          data-testid={`share-copy-${testId}`}
          aria-label={`Copy ${label.toLowerCase()} link`}
          // …the existing disabled, className and onClick props, unchanged…
        >
          Copy
        </button>
      </div>
    </div>
  );
```

Then run `grep -rn "Can edit\|Can view" e2e` and confirm no e2e locator relied on the old wrapping label. The existing specs use `data-testid`.

- [ ] **Step 8: Focus rings and hover states.** Append to `apps/web/app/globals.css`:

```css
@layer base {
  :where(button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])):focus-visible {
    outline: 2px solid var(--color-cobalt);
    outline-offset: 2px;
  }
}
```

Open `ZoomControls.tsx` and `Header.tsx`. Every `<button>` without a `hover:` class gets `hover:bg-paper` (or `hover:brightness-110` on filled buttons, as Share already has).

- [ ] **Step 9: Landing copy.** In `apps/web/app/page.tsx`, insert after the description `<p>` and before the buttons `<div>`:

```tsx
        <ul className="mt-5 grid gap-2 font-mono text-xs leading-relaxed">
          <li>▸ Stickies, shapes, connectors and frames — edited together, live.</li>
          <li>▸ Pages per room, comments pinned to the canvas, timed dot voting.</li>
          <li>▸ Right-click anything, copy between boards, press ? for every shortcut.</li>
          <li>▸ No accounts: share an edit link or a read-only view link.</li>
        </ul>
```

- [ ] **Step 10: Test, typecheck, lint, build**

Run: `npm test && npm run typecheck && npm run lint && npm run build -w @relay/web`
Expected: all green. The production build catches CSS and Tailwind issues that dev mode hides.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): undo/redo and page-deleted toasts, hash navigation, dialog focus trap, share labels, landing copy"
```

---

### Task 11: E2E — canvas UX flows, then full verification

**Files:**
- Create: `e2e/canvas-ux.spec.ts`

**Interfaces:**
- Consumes these test ids from Tasks 6–10:
  - menus and help: `context-menu`, `menu-*`, `help-dialog`, `help-button`;
  - canvas state: `lock-badge`, `selection-outline`, `empty-hint`;
  - properties bar: `props-bar`, `props-lock`;
  - pages and share: `page-add`, `page-add-board`, `page-tab`, `page-menu-delete`, `confirm-ok`, `share-open`;
  - toasts: `toast`.

- [ ] **Step 1: Write the spec** — create `e2e/canvas-ux.spec.ts`:

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

async function sticky(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press('s');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('the context menu restyles, locks and deletes; the properties bar unlocks', async ({
  page,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await sticky(page, 400, 320, 'Menu target');
  const shape = page.locator('[data-shape-id]').first();

  await page.mouse.click(800, 560);
  await page.mouse.click(400, 320, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('selection-outline')).toHaveCount(1);
  await page.getByTestId('menu-fill-cobalt').click();
  await expect(shape.locator('rect').nth(1)).toHaveAttribute('fill', '#3B3BF5');

  await page.mouse.click(400, 320, { button: 'right' });
  await page.getByTestId('menu-lock').click();
  await expect(page.getByTestId('lock-badge')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
  const before = await shape.boundingBox();
  await drag(page, { x: 400, y: 320 }, { x: 520, y: 400 });
  expect(await shape.boundingBox()).toEqual(before);

  await page.getByTestId('props-lock').click();
  await expect(page.getByTestId('lock-badge')).toHaveCount(0);
  await page.mouse.click(400, 320, { button: 'right' });
  await page.getByTestId('menu-delete').click();
  await expect(page.locator('[data-shape-id]')).toHaveCount(0);
});

test('copy, paste here, duplicate, undo, and pastes from the system clipboard', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await sticky(page, 320, 320, 'Copy me');
  await page.mouse.click(320, 320, { button: 'right' });
  await page.getByTestId('menu-copy').click();
  await page.mouse.click(760, 460, { button: 'right' });
  await page.getByTestId('menu-paste-here').click();
  const shapes = page.locator('[data-shape-id]');
  await expect(shapes).toHaveCount(2);
  await expect(pb.getByText('Copy me')).toHaveCount(2);

  await page.keyboard.press('Control+d');
  await expect(shapes).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(shapes).toHaveCount(2);
  await expect(page.getByTestId('toast').filter({ hasText: 'Undone' })).toBeVisible();

  // Text from another app becomes a sticky.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'From elsewhere');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByText('From elsewhere')).toBeVisible();

  // A keyboard copy writes a Relay clip.
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    return data.getData('text/plain');
  });
  expect(copied.startsWith('relay-clip:v1:')).toBe(true);
  await other.close();
});

test('help dialog, focus trap and the empty-page hint', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  await page.keyboard.press('?');
  await expect(page.getByTestId('help-dialog')).toContainText('Duplicate');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-dialog')).toHaveCount(0);
  await page.getByTestId('help-button').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('share-open').click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true);
  await page.keyboard.press('Escape');

  await sticky(page, 400, 320, 'First');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
});

test('viewers get only Copy and Zoom to fit, and no properties bar', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await sticky(page, 400, 320, 'Read only');
  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await expect(viewer.getByText('Read only')).toBeVisible();
  const box = await viewer.locator('[data-shape-id]').first().boundingBox();
  if (!box) throw new Error('sticky not rendered for the viewer');
  await viewer.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(viewer.getByRole('menuitem')).toHaveCount(2);
  await expect(viewer.getByTestId('menu-copy')).toBeVisible();
  await expect(viewer.getByTestId('menu-fit')).toBeVisible();
  await expect(viewer.getByTestId('props-bar')).toHaveCount(0);
  await viewerCtx.close();
});

test('a remote page delete shows a toast; hash edits switch pages', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-board').click();
  const tabsB = pb.getByTestId('page-tab');
  await expect(tabsB).toHaveCount(2);
  await tabsB.nth(1).click();
  await expect(tabsB.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('page-tab').nth(1).click({ button: 'right' });
  await page.getByTestId('page-menu-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(
    pb.getByTestId('toast').filter({ hasText: 'The page you were on was deleted' }),
  ).toBeVisible();

  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-board').click();
  const tabs = page.getByTestId('page-tab');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => {
    window.location.hash = window.location.hash.replace(/p=[^&]+/, 'p=main');
  });
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await other.close();
});
```

- [ ] **Step 2: Run the new spec against the running servers**

Run: `npx playwright test e2e/canvas-ux.spec.ts`
Expected: 5 passed. If `window.location.hash` in the last test does not match because the first tab is not `main`, check with `pb.url()` what the first page id is. In a fresh room it is `main`.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run e2e && npm run build -w @relay/web`
Expected:
- all unit suites pass (≈350 existing plus the new ones);
- 24 e2e pass (19 existing plus 5 new);
- lint and typecheck are clean;
- the build succeeds.

- [ ] **Step 4: Commit**

```bash
git add e2e/canvas-ux.spec.ts
git commit -m "test(e2e): context menu, clipboard, lock, help, viewer menu and page-delete toast"
```
