# Relay F4·P1 — Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room holds several pages (`board` now; `sheet` and `calendar` are reserved for P3/P4), shown as tabs:
- create, rename, reorder and delete pages;
- per-page content, camera and presence;
- a SHARE dialog with edit and read-only links;
- an editable board title;
- toasts.

**Architecture:** One `Y.Doc` per room gains a `pages` root. Shapes, connectors and comments carry `pageId`; when it is absent they belong to the implicit `main` page. The document store projects only the active page, so the canvas stack stays page-agnostic. The controller stamps `pageId` on everything it creates, resets per-page state when the active page changes, and owns the page actions. Presence publishes `page`. The server's `hello` carries `viewKey` for editors.

**Tech Stack:** TypeScript, Yjs 13.6, fractional-indexing, y-partyserver, Zustand 5, React 19 / Next.js 16, Tailwind 4, lucide-react, Vitest 4, fast-check, Playwright, Biome 2.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`. Relevant sections: Yjs Document, Modelling Rules (Pages), Awareness, Sync Layer, Pages, Server Time.

## Global Constraints

**Cost and scope**
- $0 and no credit card. No new runtime dependencies. `fractional-indexing` is already a core dependency.
- Do NOT edit `README.md` or `README.es.md`.

**Architecture rules**
- `packages/core` stays platform-neutral: lib ES2023, `types: []`, no DOM or Node typings.
- All document mutations go through `applyCommand(doc, cmd, origin)`. UI code never touches Yjs types directly.

**Pages**
- `MAIN_PAGE = 'main'`. Its implicit defaults are `{ type: 'board', title: 'Board', order: 'a0', createdBy: '', createdAt: 0 }`. Shapes, connectors and comments without a `pageId` belong to `main`.
- **Visible pages:** the non-deleted entries of `pages`, plus the implicit `main` when `pages` has no `main` entry. They are sorted by `order`, then by id.
- **Unknown page types** read as `'unknown'`.
- **Page commands** and `RenameBoard` are applied by the controller with `SESSION_ORIGIN`, so they are never undoable. A page delete must never be undone into shapes on a tombstoned page. Core tests may apply them with any origin.
- **`DeletePage`** writes a tombstone and deletes the page's shapes, connectors and comments in one transaction. The UI never deletes the last visible page and always asks for confirmation first.
- **Active page:**
  - It is mirrored in the URL hash as `#k=<key>&p=<pageId>`.
  - An unknown or deleted page falls back to the first visible page.
  - The camera is stored per room and page under `relay:camera:<roomId>:<pageId>`.
  - Changing pages clears the undo and redo stacks.
- **Vote:** the vote session stays room-wide. Tallies and the per-user cap count stickies on all visible pages.
- **Presence:** peers with `page === null` count as `main`. Remote cursors, selections, typing tags and minimap peers only show for peers on the same page.
- **Viewers** (role `view`) can switch pages. They get no "+", no rename, no reorder, no delete and no title edit.

**Server and UI details**
- **`hello` message:** `{ type: 'hello', role, now, viewKey? }`. The server sends `viewKey` only to the `edit` role.
- **Toasts:** bottom-centre, dismissed after 3000 ms.

**Tooling**
- **Checks:** `npm test`, `npm run typecheck`, `npm run lint` (Biome; run `npm run format` first if it fails), `npm run build -w @relay/web` for web tasks, and `npm run e2e`.
- **Dev servers:** e2e reuses the dev servers already running on 8787 (sync) and 4000 (web). Never start or kill servers.
- **Commits:** end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. Never amend.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/schema/types.ts` (modify) | `PageType`, `PageInfo`, `pageId` on `Shape`/`Connector`/`CommentThread` |
| `packages/core/src/schema/pages.ts` (create) | `MAIN_PAGE`, `readPages`, `orderBetween`, `pageOf` |
| `packages/core/src/schema/doc.ts`, `snapshot.ts`, `session.ts` (modify) | `pages` root; read `pageId` |
| `packages/core/src/commands/types.ts`, `apply.ts`, `undo.ts` (modify) | Page commands, `pageId` on Connect/AddComment, `Undo.clear()` |
| `packages/core/src/presence/state.ts`, `sync/messages.ts` (modify) | Presence `page`; hello `viewKey` |
| `apps/sync-server/src/room.ts` (modify) | Send `viewKey` to editors |
| `apps/web/src/sync/key.ts`, `clock.ts`, `presence.ts` (modify) | Hash `p`, clock `viewKey`, `setPage` |
| `apps/web/src/store/docStore.ts` (modify) | `pages`, `activePage`, `allShapes`, `setPage` |
| `apps/web/src/board/controller.ts`, `session.ts` (modify) | Page reset, stamping, page actions, tally scope |
| `apps/web/src/render/pageFilter.ts` (create) | `onPage(peer, page)` |
| `RemoteCursors`, `SelectionLayer`, `Minimap`, `CommentLayer`, `CommentsPanel`, `Header`, `VoteControl`, `VoteBadge` (modify) | Page filtering and tally scope |
| `apps/web/src/ui/toasts.ts`, `Toasts.tsx`, `ContextMenu.tsx`, `Dialog.tsx` (create) | UI primitives |
| `apps/web/src/ui/PageTabs.tsx`, `ShareDialog.tsx`, `BoardTitle.tsx` (create) | Page tabs, share, editable title |
| `apps/web/src/board/Board.tsx` (modify) | Layout and page-type switch |
| `e2e/pages.spec.ts` (create) | End-to-end pages, share, title |

---

### Task 1: Core page model and commands

**Files:**
- Modify:
  - `packages/core/src/schema/types.ts`
  - `packages/core/src/schema/doc.ts`
  - `packages/core/src/schema/snapshot.ts`
  - `packages/core/src/schema/session.ts`
  - `packages/core/src/commands/types.ts`
  - `packages/core/src/commands/apply.ts`
  - `packages/core/src/commands/undo.ts`
  - `packages/core/src/index.ts`
- Create: `packages/core/src/schema/pages.ts`
- Test: `packages/core/test/pages.test.ts` (create), `packages/core/test/undo.test.ts`

**Interfaces:**
- Produces:
  - `type PageType = 'board' | 'sheet' | 'calendar'`
  - `interface PageInfo { id: string; type: PageType | 'unknown'; title: string; order: string; createdBy: string; createdAt: number }`
  - `Shape.pageId?: string`, `Connector.pageId?: string`, `CommentThread.pageId: string` (defaults to `'main'`)
  - `MAIN_PAGE = 'main'`
  - `readPages(pages: Y.Map<Y.Map<unknown>>): PageInfo[]` (visible and ordered)
  - `orderBetween(before: string | null, after: string | null): string`
  - `pageOf(x: { pageId?: string }): string`
  - `Roots.pages: Y.Map<Y.Map<unknown>>`
  - Commands:
    - `CreatePage { page: { id; type: PageType; title; order; createdBy; createdAt } }`
    - `RenamePage { id; title }`
    - `MovePage { id; order }`
    - `DeletePage { id }`
    - `RenameBoard { title }`
  - `Connect.connector` gains `pageId?`. `AddComment` gains `pageId: string`.
  - `Undo.clear(): void`

- [ ] **Step 1: Write the failing tests.** Create `packages/core/test/pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  MAIN_PAGE,
  orderBetween,
  pageOf,
  readComment,
  readConnector,
  readMeta,
  readPages,
  readShape,
  SESSION_ORIGIN,
} from '../src';

const newPage = (id: string, order: string, type: 'board' | 'sheet' | 'calendar' = 'board') => ({
  id,
  type,
  title: id.toUpperCase(),
  order,
  createdBy: 'u1',
  createdAt: 5,
});

function sticky(doc: Y.Doc, id: string, pageId?: string) {
  applyCommand(
    doc,
    {
      type: 'CreateShape',
      shape: {
        id,
        type: 'sticky',
        x: 0,
        y: 0,
        w: 160,
        h: 120,
        style: DEFAULT_STYLE.sticky,
        text: '',
        createdBy: 'u1',
        authorName: 'A',
        createdAt: 0,
        ...(pageId ? { pageId } : {}),
      },
    },
    LOCAL_ORIGIN,
  );
}

describe('pages', () => {
  it('a new room has only the implicit main board page', () => {
    const doc = new Y.Doc();
    expect(readPages(getRoots(doc).pages)).toEqual([
      { id: 'main', type: 'board', title: 'Board', order: 'a0', createdBy: '', createdAt: 0 },
    ]);
    expect(MAIN_PAGE).toBe('main');
  });

  it('orders pages by order then id and hides deleted ones', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('b', 'a2') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'CreatePage', page: newPage('c', 'a1', 'sheet') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'CreatePage', page: newPage('d', 'a1') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'DeletePage', id: 'b' }, LOCAL_ORIGIN);
    expect(readPages(getRoots(doc).pages).map((p) => [p.id, p.type])).toEqual([
      ['main', 'board'],
      ['c', 'sheet'],
      ['d', 'board'],
    ]);
  });

  it('CreatePage never overwrites an existing page', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('x', 'a1') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'CreatePage', page: { ...newPage('x', 'a9'), title: 'Other' } }, LOCAL_ORIGIN);
    expect(readPages(getRoots(doc).pages).find((p) => p.id === 'x')?.title).toBe('X');
  });

  it('renaming or moving the implicit main page writes its entry', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'RenamePage', id: 'main', title: 'Retro' }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'MovePage', id: 'main', order: 'a5' }, LOCAL_ORIGIN);
    expect(readPages(getRoots(doc).pages)).toEqual([
      { id: 'main', type: 'board', title: 'Retro', order: 'a5', createdBy: '', createdAt: 0 },
    ]);
  });

  it('rename and move ignore unknown pages', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'RenamePage', id: 'ghost', title: 'X' }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'MovePage', id: 'ghost', order: 'a1' }, LOCAL_ORIGIN);
    expect(getRoots(doc).pages.has('ghost')).toBe(false);
  });

  it('DeletePage tombstones the page and deletes its content in one transaction', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    sticky(doc, 's-main');
    sticky(doc, 's-p2', 'p2');
    sticky(doc, 't-p2', 'p2');
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          pageId: 'p2',
          from: { shapeId: 's-p2', anchor: 'auto' },
          to: { shapeId: 't-p2', anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    applyCommand(
      doc,
      {
        type: 'AddComment',
        id: 'c',
        pageId: 'p2',
        anchor: { x: 0, y: 0 },
        createdBy: 'u1',
        createdAt: 0,
        entry: { id: 'e', authorId: 'u1', author: 'A', body: 'hi', ts: 0 },
      },
      SESSION_ORIGIN,
    );
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);
    applyCommand(doc, { type: 'DeletePage', id: 'p2' }, LOCAL_ORIGIN);
    const { shapes, connectors, comments, pages } = getRoots(doc);
    expect(transactions).toBe(1);
    expect([...shapes.keys()]).toEqual(['s-main']);
    expect(connectors.size).toBe(0);
    expect(comments.size).toBe(0);
    expect(pages.get('p2')?.get('deleted')).toBe(true);
  });

  it('deleting main removes shapes without a pageId', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    sticky(doc, 'legacy');
    sticky(doc, 'kept', 'p2');
    applyCommand(doc, { type: 'DeletePage', id: 'main' }, LOCAL_ORIGIN);
    expect([...getRoots(doc).shapes.keys()]).toEqual(['kept']);
    expect(readPages(getRoots(doc).pages).map((p) => p.id)).toEqual(['p2']);
  });

  it('reads pageId on shapes, connectors and comments; pageOf defaults to main', () => {
    const doc = new Y.Doc();
    sticky(doc, 'a', 'p2');
    sticky(doc, 'b');
    const { shapes } = getRoots(doc);
    expect(readShape('a', shapes.get('a') as Y.Map<unknown>)?.pageId).toBe('p2');
    expect(readShape('b', shapes.get('b') as Y.Map<unknown>)?.pageId).toBeUndefined();
    expect(pageOf({})).toBe('main');
    expect(pageOf({ pageId: 'p2' })).toBe('p2');
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          pageId: 'p2',
          from: { x: 0, y: 0 },
          to: { x: 5, y: 5 },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    expect(readConnector('k', getRoots(doc).connectors.get('k') as Y.Map<unknown>)?.pageId).toBe('p2');
    applyCommand(
      doc,
      {
        type: 'AddComment',
        id: 'c',
        pageId: 'p2',
        anchor: { x: 0, y: 0 },
        createdBy: 'u1',
        createdAt: 0,
        entry: { id: 'e', authorId: 'u1', author: 'A', body: 'hi', ts: 0 },
      },
      SESSION_ORIGIN,
    );
    expect(readComment('c', getRoots(doc).comments.get('c') as Y.Map<unknown>)?.pageId).toBe('p2');
  });

  it('unknown page types read as unknown', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).pages.set('z', m);
    m.set('type', 'kanban');
    m.set('title', 'Z');
    m.set('order', 'a3');
    expect(readPages(getRoots(doc).pages).find((p) => p.id === 'z')?.type).toBe('unknown');
  });

  it('RenameBoard sets the board title', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'RenameBoard', title: 'Sprint 14' }, LOCAL_ORIGIN);
    expect(readMeta(getRoots(doc).meta).title).toBe('Sprint 14');
  });

  it('orderBetween sorts between its neighbours and survives malformed keys', () => {
    const k = orderBetween('a0', 'a2');
    expect(k > 'a0' && k < 'a2').toBe(true);
    expect(orderBetween('a5', null) > 'a5').toBe(true);
    expect(orderBetween(null, 'a0') < 'a0').toBe(true);
    expect(typeof orderBetween('!!bad', null)).toBe('string');
  });
});
```

Also append to `packages/core/test/undo.test.ts`, inside its main describe:

```ts
  it('clear() empties the undo and redo stacks', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc, { captureTimeout: 0 });
    applyCommand(doc, { type: 'MoveShapes', moves: [] }, LOCAL_ORIGIN);
    applyCommand(
      doc,
      {
        type: 'CreateShape',
        shape: {
          id: 'r',
          type: 'rect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          style: DEFAULT_STYLE.rect,
          text: '',
          createdBy: 'u',
          authorName: 'U',
          createdAt: 0,
        },
      },
      LOCAL_ORIGIN,
    );
    expect(undo.canUndo()).toBe(true);
    undo.clear();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });
```

Add any missing imports (`DEFAULT_STYLE`, `LOCAL_ORIGIN`) to that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- pages undo`
Expected: FAIL. The page imports are missing, and `undo.clear` is not a function.

- [ ] **Step 3: Types.** In `packages/core/src/schema/types.ts`:
  - Add to `Shape` (after `id`) and to `Connector` (after `id`):

```ts
  /** Page the item lives on; absent = the implicit 'main' page. */
  pageId?: string;
```

  - Add `pageId: string;` to `CommentThread`, after `id`.
  - Append:

```ts
export type PageType = 'board' | 'sheet' | 'calendar';

export interface PageInfo {
  id: string;
  /** 'unknown' for a type this client does not know (rendered as a notice). */
  type: PageType | 'unknown';
  title: string;
  /** Fractional-index key; ties broken by id. */
  order: string;
  createdBy: string;
  createdAt: number;
}
```

- [ ] **Step 4: Create `packages/core/src/schema/pages.ts`.**

```ts
import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import type { PageInfo, PageType } from './types';

/** The page that holds everything created before pages existed. */
export const MAIN_PAGE = 'main';

const PAGE_TYPES: readonly string[] = ['board', 'sheet', 'calendar'];

export const MAIN_DEFAULTS: Omit<PageInfo, 'id'> = {
  type: 'board',
  title: 'Board',
  order: 'a0',
  createdBy: '',
  createdAt: 0,
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The page an item lives on (absent pageId = main). */
export const pageOf = (x: { pageId?: string }): string => x.pageId ?? MAIN_PAGE;

function readPage(id: string, m: Y.Map<unknown>): PageInfo | null {
  if (m.get('deleted') === true) return null;
  const base = id === MAIN_PAGE ? MAIN_DEFAULTS : null;
  const type = str(m.get('type')) ?? base?.type;
  const createdAt = m.get('createdAt');
  return {
    id,
    type: type && PAGE_TYPES.includes(type) ? (type as PageType) : 'unknown',
    title: str(m.get('title')) ?? base?.title ?? 'Untitled',
    order: str(m.get('order')) ?? base?.order ?? 'a0',
    createdBy: str(m.get('createdBy')) ?? '',
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Visible pages: live entries plus the implicit main page when it has no entry, by order then id. */
export function readPages(pages: Y.Map<Y.Map<unknown>>): PageInfo[] {
  const out: PageInfo[] = [];
  for (const [id, m] of pages.entries()) {
    if (!(m instanceof Y.Map)) continue;
    const page = readPage(id, m);
    if (page) out.push(page);
  }
  if (!pages.has(MAIN_PAGE)) out.push({ id: MAIN_PAGE, ...MAIN_DEFAULTS });
  return out.sort((a, b) =>
    a.order !== b.order ? (a.order < b.order ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** A fractional key strictly between two neighbours (null = open end); tolerant of malformed keys. */
export function orderBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    try {
      return generateKeyBetween(before, null);
    } catch {
      return generateKeyBetween(null, null);
    }
  }
}
```

  Export it from `packages/core/src/index.ts` with `export * from './schema/pages';`.

- [ ] **Step 5: Roots and reads.**
  - `doc.ts`: add `pages: Y.Map<Y.Map<unknown>>` to `Roots` and `pages: doc.getMap<Y.Map<unknown>>('pages')` to `getRoots`.
  - `snapshot.ts`, `readShape`: after the `columnId` block, add `const pageId = str(m.get('pageId')); if (pageId) shape.pageId = pageId;`. In `readConnector`, add `...(str(m.get('pageId')) ? { pageId: str(m.get('pageId')) as string } : {})` to the returned object.
  - `session.ts`, `readComment`: add `pageId: typeof m.get('pageId') === 'string' ? (m.get('pageId') as string) : MAIN_PAGE,` to the returned object. Import `MAIN_PAGE` from `./pages`.

- [ ] **Step 6: Commands.** In `packages/core/src/commands/types.ts`:
  - Import `PageType`.
  - Add `pageId: string;` to the `AddComment` member.
  - `NewConnector` already derives from `Connector`, so it gains `pageId?` automatically.
  - Add:

```ts
  | {
      type: 'CreatePage';
      page: { id: string; type: PageType; title: string; order: string; createdBy: string; createdAt: number };
    }
  | { type: 'RenamePage'; id: string; title: string }
  | { type: 'MovePage'; id: string; order: string }
  | { type: 'DeletePage'; id: string }
  | { type: 'RenameBoard'; title: string }
```

- [ ] **Step 7: Apply.** In `packages/core/src/commands/apply.ts`:
  - Import `MAIN_DEFAULTS`, `MAIN_PAGE` and `pageOf` from `'../schema/pages'`.
  - Destructure `pages` and `meta` from `getRoots(doc)` as well.
  - In `Connect`, add `if (fields.pageId) m.set('pageId', fields.pageId);`.
  - In `AddComment`, add `m.set('pageId', cmd.pageId);`.
  - Add a helper above `apply`:

```ts
/** The page's map; for the implicit main page, created with its defaults on first write. */
function pageEntry(pages: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const existing = pages.get(id);
  if (existing || id !== MAIN_PAGE) return existing;
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(MAIN_DEFAULTS)) m.set(k, v);
  pages.set(id, m);
  return m;
}
```

  - Add these cases:

```ts
    case 'CreatePage': {
      if (pages.has(cmd.page.id)) return;
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(cmd.page)) if (k !== 'id') m.set(k, v);
      pages.set(cmd.page.id, m);
      return;
    }
    case 'RenamePage': {
      const m = pageEntry(pages, cmd.id);
      if (m && m.get('deleted') !== true) m.set('title', cmd.title);
      return;
    }
    case 'MovePage': {
      const m = pageEntry(pages, cmd.id);
      if (m && m.get('deleted') !== true) m.set('order', cmd.order);
      return;
    }
    case 'DeletePage': {
      const m = pageEntry(pages, cmd.id);
      if (!m) return;
      m.set('deleted', true);
      const onPage = (item: Y.Map<unknown>) => {
        const p = item.get('pageId');
        return (typeof p === 'string' ? p : MAIN_PAGE) === cmd.id;
      };
      for (const [id, s] of [...shapes.entries()]) if (onPage(s)) shapes.delete(id);
      for (const [id, c] of [...connectors.entries()]) if (onPage(c)) connectors.delete(id);
      for (const [id, c] of [...comments.entries()]) if (onPage(c)) comments.delete(id);
      return;
    }
    case 'RenameBoard':
      meta.set('title', cmd.title);
      return;
```

  - `pageOf` may end up unused in apply.ts. Import only what you use, because Biome flags unused imports.

- [ ] **Step 8: Undo clear.** In `packages/core/src/commands/undo.ts`:
  - Add `clear(): void;` to the `Undo` interface.
  - Add `clear: () => manager.clear(),` to the returned object.
  - Web code constructs `Undo`-shaped objects only through `createUndo`. Grep to confirm there are no test doubles to update.

- [ ] **Step 9: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`. Expected: all green.
  - `AddComment` now requires `pageId`. Fix every existing call site the typecheck reports:
    - core tests: pass `pageId: 'main'`;
    - `apps/web/src/board/controller.ts` `addComment`: pass `pageId: 'main'` for now; Task 5 replaces it with the active page;
    - web tests.

- [ ] **Step 10: Commit**

```bash
git add packages/core apps/web
git commit -m "feat(core): pages root, page commands with tombstones, pageId on items, undo clear"
```

---

### Task 2: Page convergence, presence page and hello viewKey

**Files:**
- Test: `packages/core/test/pages-convergence.test.ts` (create)
- Modify: `packages/core/src/presence/state.ts`, `packages/core/src/sync/messages.ts`
- Test: `packages/core/test/presence.test.ts`, `packages/core/test/messages.test.ts`

**Interfaces:**
- Produces:
  - `PresenceState.page: string | null` (validated: a string of at most 64 characters, otherwise null)
  - `ServerMessage` hello gains `viewKey?: string` (kept only if it is a string of at most 64 characters)

- [ ] **Step 1: Write the property test.** Create `packages/core/test/pages-convergence.test.ts`:

```ts
declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  type Command,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  orderBetween,
  readPages,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 200);
const REMOTE = 'remote';
const N = 3;
const PAGE_IDS = ['main', 'p1', 'p2', 'p3'];

type Step =
  | { kind: 'create'; r: number; page: number; key: number }
  | { kind: 'rename'; r: number; page: number; title: string }
  | { kind: 'move'; r: number; page: number; key: number }
  | { kind: 'delete'; r: number; page: number }
  | { kind: 'shape'; r: number; page: number }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const page = fc.integer({ min: 0, max: PAGE_IDS.length - 1 });
const key = fc.integer({ min: 0, max: 5 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('create' as const), r: replica, page, key }), weight: 3 },
  fc.record({ kind: fc.constant('rename' as const), r: replica, page, title: fc.string({ maxLength: 4 }) }),
  fc.record({ kind: fc.constant('move' as const), r: replica, page, key }),
  fc.record({ kind: fc.constant('delete' as const), r: replica, page }),
  { arbitrary: fc.record({ kind: fc.constant('shape' as const), r: replica, page }), weight: 3 },
  fc.record({ kind: fc.constant('deliver' as const), from: replica, to: replica, count: fc.integer({ min: 1, max: 3 }) }),
);

const keyAt = (k: number) => orderBetween(`a${k}`, null);

describe('pages convergence', () => {
  it('pages and their content converge under concurrent page commands', () => {
    let deletes = 0;
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 15, maxLength: 50 }), (steps) => {
        const docs = Array.from({ length: N }, (_, i) => {
          const d = new Y.Doc();
          d.clientID = i + 1;
          return d;
        });
        const queues = docs.map(() => docs.map(() => [] as Uint8Array[]));
        docs.forEach((d, from) =>
          d.on('update', (u: Uint8Array, origin: unknown) => {
            if (origin === REMOTE) return;
            for (let to = 0; to < N; to++) if (to !== from) queues[from]?.[to]?.push(u);
          }),
        );
        const deliver = (from: number, to: number, count: number) => {
          const q = queues[from]?.[to];
          for (let i = 0; i < count && q && q.length > 0; i++) {
            const u = q.shift();
            if (u) Y.applyUpdate(docs[to] as Y.Doc, u, REMOTE);
          }
        };
        let n = 0;
        for (const s of steps) {
          if (s.kind === 'deliver') {
            if (s.from !== s.to) deliver(s.from, s.to, s.count);
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const id = PAGE_IDS[s.page] as string;
          let cmd: Command;
          if (s.kind === 'create')
            cmd = {
              type: 'CreatePage',
              page: { id, type: 'board', title: id, order: keyAt(s.key), createdBy: `u${s.r}`, createdAt: 0 },
            };
          else if (s.kind === 'rename') cmd = { type: 'RenamePage', id, title: s.title };
          else if (s.kind === 'move') cmd = { type: 'MovePage', id, order: keyAt(s.key) };
          else if (s.kind === 'delete') {
            cmd = { type: 'DeletePage', id };
            deletes++;
          } else
            cmd = {
              type: 'CreateShape',
              shape: {
                id: `s${s.r}-${n++}`,
                pageId: id,
                type: 'sticky',
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                style: DEFAULT_STYLE.sticky,
                text: '',
                createdBy: `u${s.r}`,
                authorName: 'U',
                createdAt: 0,
              },
            };
          applyCommand(doc, cmd, LOCAL_ORIGIN);
        }
        for (let from = 0; from < N; from++) for (let to = 0; to < N; to++) deliver(from, to, Number.POSITIVE_INFINITY);
        const views = docs.map((d) => ({
          pages: readPages(getRoots(d).pages),
          shapes: getRoots(d).shapes.toJSON(),
        }));
        for (const v of views.slice(1)) expect(v).toEqual(views[0]);
        // A deleted page never comes back, and it keeps no content added before the delete arrived.
        const deleted = new Set(
          [...getRoots(docs[0] as Y.Doc).pages.entries()]
            .filter(([, m]) => m.get('deleted') === true)
            .map(([pid]) => pid),
        );
        for (const p of views[0]?.pages ?? []) expect(deleted.has(p.id)).toBe(false);
      }),
      { numRuns: RUNS },
    );
    expect(deletes).toBeGreaterThan(0);
  });
});
```

  Content that a peer adds to a page concurrently with its deletion may stay in the doc. That is allowed: the projection hides it because the page is gone. The test asserts convergence plus "deleted never comes back". It does not assert that the doc is empty.

- [ ] **Step 2: Presence page.** In `packages/core/src/presence/state.ts`:
  - Add `/** Page this user is looking at; null = unknown (treated as main). */ page: string | null;` to `PresenceState`.
  - In `parsePresence`, add `page: typeof o.page === 'string' && o.page.length <= 64 ? o.page : null,`.
  - Update every existing expected object in `presence.test.ts` to include `page: null`, then add:

```ts
  it('parsePresence accepts a bounded page id', () => {
    expect(parsePresence({ user: alice, page: 'p2' })?.page).toBe('p2');
    expect(parsePresence({ user: alice, page: 'x'.repeat(65) })?.page).toBeNull();
    expect(parsePresence({ user: alice, page: 7 })?.page).toBeNull();
  });
```

  Grep `apps/web` and `packages/core/test` for `viewport: null` and add `page: null` to any `PresenceState` or `Peer` literal the typecheck reports.
  - `apps/web/src/sync/presence.ts`'s `initial` gains `page: null`. Task 5 adds `setPage`.

- [ ] **Step 3: Hello viewKey.** In `packages/core/src/sync/messages.ts`:
  - The hello variant becomes `{ type: 'hello'; role: Role; now: number; viewKey?: string }`.
  - In `parseServerMessage`, return `{ type: 'hello', role: o.role, now: o.now, ...(typeof o.viewKey === 'string' && o.viewKey.length <= 64 ? { viewKey: o.viewKey } : {}) }`.
  - Add to `messages.test.ts`:

```ts
  it('keeps a bounded viewKey on hello', () => {
    expect(parseServerMessage('{"type":"hello","role":"edit","now":1,"viewKey":"abc"}')).toEqual({
      type: 'hello',
      role: 'edit',
      now: 1,
      viewKey: 'abc',
    });
    expect(parseServerMessage(`{"type":"hello","role":"edit","now":1,"viewKey":"${'k'.repeat(65)}"}`)).toEqual({
      type: 'hello',
      role: 'edit',
      now: 1,
    });
  });
```

- [ ] **Step 4: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`. Expected: all green, including the property test with no counterexample. If the property test finds a real divergence, report BLOCKED with the counterexample. Do not weaken the invariant.

- [ ] **Step 5: Commit**

```bash
git add packages/core apps/web
git commit -m "test(core): pages converge; presence page and hello viewKey"
```

---

### Task 3: Server sends viewKey to editors

**Files:**
- Modify: `apps/sync-server/src/room.ts`
- Test: `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Consumes: `deriveKey(secret, roomId, 'view')` from `apps/sync-server/src/auth.ts`, `ServerMessage` (Task 2), the room's name (the room id) and `this.env.ROOM_SECRET` (see `src/env.ts`; check how `room.ts` accesses env and the room name).
- Produces: the hello to `edit` connections carries `viewKey`. Viewers never get it.

- [ ] **Step 1: Write the failing test.** Extend the existing hello test in `integration.test.ts` (the one using `nextCustom`), or add a new one:

```ts
  it('sends the view key to editors only', async () => {
    const { roomId, editKey, viewKey } = await createRoom();
    const editor = rawConnect(roomId, { key: editKey });
    const editorHello = nextCustom(editor);
    await waitForOpen(editor);
    expect((await editorHello).viewKey).toBe(viewKey);
    const viewer = rawConnect(roomId, { key: viewKey });
    const viewerHello = nextCustom(viewer);
    await waitForOpen(viewer);
    expect((await viewerHello).viewKey).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL, with `viewKey` undefined for the editor.

- [ ] **Step 3: Implement.** In `room.ts` `onConnect`, replace the hello line with a call to a new private async method, and add the method:

```ts
    void this.#sendHello(connection, role);
```

```ts
  /** Capability, server clock and — for editors only — the view key for sharing a read-only link. */
  async #sendHello(connection: Connection, role: Role): Promise<void> {
    let viewKey: string | undefined;
    if (role === 'edit') {
      try {
        viewKey = await deriveKey(this.env.ROOM_SECRET, this.name, 'view');
      } catch {
        viewKey = undefined; // no secret configured: editors simply cannot share a view link
      }
    }
    this.sendCustomMessage(
      connection,
      encode({ type: 'hello', role, now: Date.now(), ...(viewKey ? { viewKey } : {}) }),
    );
  }
```

  Use the room-name accessor the class actually has; partyserver exposes `this.name`. Confirm it equals the room id used by `/api/rooms`, the same one `roleForKey` verified in `index.ts`. Also confirm how `env` is typed on the class. Name what you used in the report.

- [ ] **Step 4: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/sync-server
git commit -m "feat(sync-server): hello carries the view key for editors"
```

---

### Task 4: Page-aware document store and URL hash

**Files:**
- Modify: `apps/web/src/store/docStore.ts`, `apps/web/src/sync/key.ts`
- Test: `apps/web/test/docStore.test.ts`, `apps/web/test/key.test.ts`

**Interfaces:**
- Consumes: `readPages`, `pageOf`, `MAIN_PAGE`, `PageInfo` (Task 1).
- Produces:
  - `DocState` gains:
    - `pages: PageInfo[]`
    - `activePage: string`
    - `allShapes: Record<string, Shape>`: raw shapes on visible pages, used for vote tallies
  - `shapes`, `order`, `connectors` and `connectorOrder` now contain only the active page's items.
  - `createDocStore(doc, initialPage?: string)` returns `{ store, setPage(id: string): void, destroy }`.
  - `pageFromHash(hash: string): string | null`
  - `hashFor(key: string | null, page: string): string`, which returns e.g. `#k=abc&p=p2`

- [ ] **Step 1: Write the failing tests.**
  - Append to `apps/web/test/key.test.ts`, importing `pageFromHash` and `hashFor`:

```ts
describe('page in the hash', () => {
  it('reads and writes the page next to the key', () => {
    expect(pageFromHash('#k=abc&p=p2')).toBe('p2');
    expect(pageFromHash('#k=abc')).toBeNull();
    expect(hashFor('abc', 'p2')).toBe('#k=abc&p=p2');
    expect(hashFor(null, 'main')).toBe('#p=main');
    expect(pageFromHash(hashFor('a b', 'x y'))).toBe('x y');
  });
});
```

  - Append to `apps/web/test/docStore.test.ts`. Reuse the file's imports and add `applyCommand`, `DEFAULT_STYLE` and `LOCAL_ORIGIN` if they are missing:

```ts
describe('pages', () => {
  const sticky = (doc: Y.Doc, id: string, pageId?: string) =>
    applyCommand(
      doc,
      {
        type: 'CreateShape',
        shape: {
          id,
          type: 'sticky',
          x: 0,
          y: 0,
          w: 160,
          h: 120,
          style: DEFAULT_STYLE.sticky,
          text: '',
          createdBy: 'u1',
          authorName: 'A',
          createdAt: 0,
          ...(pageId ? { pageId } : {}),
        },
      },
      LOCAL_ORIGIN,
    );

  it('projects only the active page and keeps all visible shapes for tallies', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      { type: 'CreatePage', page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u', createdAt: 0 } },
      LOCAL_ORIGIN,
    );
    sticky(doc, 'm1');
    sticky(doc, 'q1', 'p2');
    const docs = createDocStore(doc);
    expect(docs.store.getState().activePage).toBe('main');
    expect(Object.keys(docs.store.getState().shapes)).toEqual(['m1']);
    expect(Object.keys(docs.store.getState().allShapes).sort()).toEqual(['m1', 'q1']);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main', 'p2']);
    docs.setPage('p2');
    expect(docs.store.getState().activePage).toBe('p2');
    expect(Object.keys(docs.store.getState().shapes)).toEqual(['q1']);
  });

  it('falls back to the first visible page when the active one is unknown or deleted', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      { type: 'CreatePage', page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u', createdAt: 0 } },
      LOCAL_ORIGIN,
    );
    const docs = createDocStore(doc, 'nope');
    expect(docs.store.getState().activePage).toBe('main');
    docs.setPage('p2');
    applyCommand(doc, { type: 'DeletePage', id: 'p2' }, LOCAL_ORIGIN);
    expect(docs.store.getState().activePage).toBe('main');
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main']);
  });

  it('drops connectors whose endpoints live on another page', () => {
    const doc = new Y.Doc();
    sticky(doc, 'a');
    sticky(doc, 'b', 'p2');
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
          createdBy: 'u',
        },
      },
      LOCAL_ORIGIN,
    );
    const docs = createDocStore(doc);
    expect(docs.store.getState().connectors).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- docStore key`
Expected: FAIL.

- [ ] **Step 3: Hash helpers.** Append to `apps/web/src/sync/key.ts`:

```ts
/** Reads the active page from a URL fragment like `#k=<key>&p=<page>`. */
export function pageFromHash(hash: string): string | null {
  const match = /(?:^#|&)p=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The fragment for a key and a page. */
export function hashFor(key: string | null, page: string): string {
  const parts = key ? [`k=${encodeURIComponent(key)}`] : [];
  parts.push(`p=${encodeURIComponent(page)}`);
  return `#${parts.join('&')}`;
}
```

- [ ] **Step 4: Page-aware projection.** In `apps/web/src/store/docStore.ts`:
  1. Import `MAIN_PAGE`, `type PageInfo`, `pageOf` and `readPages`.
  2. `DocState` gains:

```ts
  /** Visible pages, ordered. */
  pages: PageInfo[];
  /** Page whose items `shapes`/`connectors` hold. */
  activePage: string;
  /** Shapes on every visible page (vote tallies are room-wide). */
  allShapes: Record<string, Shape>;
```

  3. The signature becomes `createDocStore(doc: Y.Doc, initialPage: string = MAIN_PAGE): { store: StoreApi<DocState>; setPage(id: string): void; destroy(): void }`.
  4. Also read `pages: yPages` from `getRoots(doc)`.
  5. Keep a `requested` page (initially `initialPage`) and compute:

```ts
  let requested = initialPage;
  const resolvePage = (pages: PageInfo[]) =>
    pages.some((p) => p.id === requested) ? requested : (pages[0]?.id ?? requested);
```

  6. Replace `publish` with one that filters by page. The `lastNormalized` cache must also be keyed on the page:

```ts
  let lastNormalized: { page: string; value: Normalized } | null = null;

  const publish = (shapesChanged: boolean) => {
    const pages = readPages(yPages);
    const visible = new Set(pages.map((p) => p.id));
    const activePage = resolvePage(pages);
    const onActive: Record<string, Shape> = {};
    const allShapes: Record<string, Shape> = {};
    for (const s of Object.values(rawShapes)) {
      const p = pageOf(s);
      if (visible.has(p)) allShapes[s.id] = s;
      if (p === activePage) onActive[s.id] = s;
    }
    const normalized =
      !shapesChanged && lastNormalized?.page === activePage
        ? lastNormalized.value
        : normalizeShapes(onActive);
    lastNormalized = { page: activePage, value: normalized };
    const pageConnectors: Record<string, Connector> = {};
    for (const c of Object.values(rawConnectors)) if (pageOf(c) === activePage) pageConnectors[c.id] = c;
    store.setState({
      ...normalized,
      ...normalizeConnectors(pageConnectors, normalized.shapes),
      pages,
      activePage,
      allShapes,
    });
  };
```

     - The initial state gains `pages: readPages(yPages)`, `activePage: initialPage` and `allShapes: {}`.
     - `normalizeShapes` sees only the active page's shapes. A `parentId` that points to a frame on another page therefore resolves to root, and `normalizeConnectors` drops cross-page endpoints.
  7. Observe `yPages` deeply with `const onPages = () => publish(true);` and unobserve it in `destroy`.
  8. Return `setPage(id) { requested = id; publish(true); }`.
  9. Update every caller of `createDocStore` that destructures its result. `session.ts` and the tests only use `.store` and `.destroy()`, so `setPage` is additive.

- [ ] **Step 5: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build -w @relay/web`. Expected: all green, and the existing docStore identity tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/docStore.ts apps/web/src/sync/key.ts apps/web/test
git commit -m "feat(web): page-aware document projection with fallback, and the page in the URL hash"
```

---

### Task 5: Controller and session: per-page state, stamping, page actions

**Files:**
- Modify:
  - `apps/web/src/board/controller.ts`
  - `apps/web/src/board/session.ts`
  - `apps/web/src/sync/clock.ts`
  - `apps/web/src/sync/presence.ts`
- Test: `apps/web/test/controller.test.ts`, `apps/web/test/clock.test.ts`

**Interfaces:**
- Consumes:
  - from Task 4: `createDocStore(...).setPage` and `DocState.pages/activePage/allShapes`
  - from Task 1: `orderBetween`, `Undo.clear()`, the page commands, `AddComment.pageId`
  - from Task 2: hello `viewKey`
- Produces:
  - `CameraStorage` becomes `{ load(pageId: string): Camera | null; save(pageId: string, camera: Camera): void }`
  - controller opts gain `setPage: (id: string) => void`
  - `BoardController` gains:
    - `setPage(id)`
    - `createPage(type: PageType)`, which returns the new id
    - `renamePage(id, title)`
    - `movePage(id, toIndex)`
    - `deletePage(id)`
    - `renameBoard(title)`
  - `ClockState` gains `viewKey: string | null`
  - `PresencePublisher` gains `setPage(page: string)`
  - `BoardSession` gains `key: string | null` and `setPage` (the same as `controller.setPage`)

- [ ] **Step 1: Write the failing tests.**
  - In `apps/web/test/clock.test.ts`, update the expected objects to include `viewKey` (`null` by default, or the value from hello). Then add:

```ts
  it('keeps the view key from hello and across time refreshes', () => {
    const a = nextClock({ role: null, offset: 0, viewKey: null }, { type: 'hello', role: 'edit', now: 5, viewKey: 'vk' }, 5);
    expect(a.viewKey).toBe('vk');
    expect(nextClock(a, { type: 'time', now: 9 }, 9).viewKey).toBe('vk');
  });
```

  - In `apps/web/test/controller.test.ts`:
    - Make `setup` build the doc store as `const docs = createDocStore(doc);`.
    - Pass `setPage: docs.setPage` to the controller.
    - Return `docs`.
    - Change existing `cameraStorage` fakes to the new signature: `load: () => …` still type-checks because extra parameters are ignored, and `save: vi.fn()` then records `(pageId, camera)`.
    - Update the existing "restores and saves" test to expect `save` to have last been called with `('main', { x: 1, y: 2, zoom: 1 })`.
    - Then add:

```ts
describe('pages', () => {
  it('stamps the active page on created shapes, connectors and comments', () => {
    const { doc, controller } = setup();
    const p2 = controller.createPage('board');
    controller.setPage(p2);
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(100, 100) });
    const sid = controller.ui.getState().tool.selection[0] as string;
    expect(getRoots(doc).shapes.get(sid)?.get('pageId')).toBe(p2);
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(500, 500) });
    controller.addComment('here');
    const [cid] = [...getRoots(doc).comments.keys()];
    expect(getRoots(doc).comments.get(cid as string)?.get('pageId')).toBe(p2);
  });

  it('switching pages resets tool state, clears undo, and loads that page camera', () => {
    const cams: Record<string, { x: number; y: number; zoom: number }> = { p9: { x: 3, y: 4, zoom: 2 } };
    const { doc, controller } = setup({
      cameraStorage: { load: (page) => cams[page] ?? null, save: (page, c) => { cams[page] = c; } },
    });
    applyCommand(
      doc,
      { type: 'CreatePage', page: { id: 'p9', type: 'board', title: 'Nine', order: 'a5', createdBy: 'u', createdAt: 0 } },
      LOCAL_ORIGIN,
    );
    addRect(doc, 'r1', 0, 0);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(60, 10) });
    controller.setCamera({ x: 7, y: 7, zoom: 1 });
    controller.setPage('p9');
    expect(controller.ui.getState().camera).toEqual({ x: 3, y: 4, zoom: 2 });
    expect(controller.ui.getState().tool.selection).toEqual([]);
    controller.undo();
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(50); // the drag on main was not undone
    controller.setPage('main');
    expect(controller.ui.getState().camera).toEqual({ x: 7, y: 7, zoom: 1 });
  });

  it('page actions: create after the last, rename, move between neighbours, delete', () => {
    const { docs, controller } = setup();
    const a = controller.createPage('board');
    const b = controller.createPage('board');
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main', a, b]);
    expect(docs.store.getState().pages[1]?.title).toBe('Board 2');
    controller.renamePage(a, '  Ideas  ');
    controller.renamePage(b, '   ');
    expect(docs.store.getState().pages.map((p) => p.title)).toEqual(['Board', 'Ideas', 'Board 3']);
    controller.movePage(b, 0);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual([b, 'main', a]);
    controller.deletePage(a);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual([b, 'main']);
  });

  it('never deletes the last visible page', () => {
    const { docs, controller } = setup();
    controller.deletePage('main');
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main']);
  });

  it('vote cap counts stickies on every page', () => {
    const { doc, controller, activity } = setup();
    const p2 = controller.createPage('board');
    addSticky(doc, 'm1');
    addSticky(doc, 'm2');
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 'q1',
        pageId: p2,
        type: 'sticky',
        x: 0,
        y: 0,
        w: 160,
        h: 120,
        style: DEFAULT_STYLE.sticky,
        text: '',
        createdBy: 'u1',
        authorName: 'A',
        createdAt: 0,
      },
    });
    addSticky(doc, 'm3');
    controller.startVote(3);
    controller.toggleVote('m1');
    controller.toggleVote('m2');
    controller.setPage(p2);
    controller.toggleVote('q1');
    controller.setPage('main');
    controller.toggleVote('m3');
    expect(activity.store.getState().voteKeys).toEqual(['m1:u1', 'm2:u1', 'q1:u1']);
  });

  it('renameBoard trims and ignores empty titles', () => {
    const { docs, controller } = setup();
    controller.renameBoard('  Q3 Retro ');
    controller.renameBoard('  ');
    expect(docs.store.getState().meta.title).toBe('Q3 Retro');
  });
});
```

    Add the missing imports: `LOCAL_ORIGIN` from `@relay/core`. `getRoots` and `DEFAULT_STYLE` are already imported. `at(x, y, hitId)` and `addRect`/`addSticky` exist in the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- controller clock`
Expected: FAIL.

- [ ] **Step 3: Clock.** In `apps/web/src/sync/clock.ts`:
  - `ClockState` gains `/** Read-only link key (editors only, from hello). */ viewKey: string | null;`.
  - `nextClock` returns `{ role: msg.role, offset, viewKey: msg.viewKey ?? null }` for hello and `{ ...prev, offset }` for time.
  - In `apps/web/src/sync/connection.ts`, the initial clock state becomes `{ role: null, offset: 0, viewKey: null }`.

- [ ] **Step 4: Presence.** In `apps/web/src/sync/presence.ts`, add `setPage(page: string): void;` to the interface. Implement it as `setPage: (page) => awareness.setLocalStateField('page', page),`.

- [ ] **Step 5: Controller.** In `apps/web/src/board/controller.ts`:
  1. Imports: add `MAIN_PAGE`, `orderBetween` and `type PageType` from `@relay/core`.
  2. Replace `CameraStorage` with:

```ts
export interface CameraStorage {
  load(pageId: string): Camera | null;
  save(pageId: string, camera: Camera): void;
}
```

  3. Options: add `setPage: (id: string) => void;`.
  4. Add a helper `const activePage = () => opts.docStore.getState().activePage;`. The initial camera becomes `opts.cameraStorage?.load(activePage()) ?? null`. In `setCamera`, call `opts.cameraStorage?.save(activePage(), camera)`.
  5. Stamp the page in `run`'s `command` case. Pass `withPage(effect.command)` to both `throttledCommit` and `commit`:

```ts
  const withPage = (c: Command): Command => {
    const pageId = activePage();
    if (c.type === 'CreateShape') return { ...c, shape: { ...c.shape, pageId } };
    if (c.type === 'Connect') return { ...c, connector: { ...c.connector, pageId } };
    return c;
  };
```

  6. In `addComment`, pass `pageId: activePage()` instead of `'main'`.
  7. In `toggleVote`, replace `opts.docStore.getState().shapes` with `opts.docStore.getState().allShapes`, in both the sticky check and `voteTallies`.
  8. React to page changes, both local and remote fallbacks. Put this in the existing docStore subscription, so it has two parameters `(doc, prev)`:

```ts
    if (doc.activePage !== prev.activePage) {
      throttledCommit.cancel();
      undoStack.clear();
      const stored = opts.cameraStorage?.load(doc.activePage) ?? null;
      fitPending = stored === null;
      ui.setState({
        tool: { mode: 'idle', tool: ui.getState().tool.tool, selection: [] },
        preview: null,
        overlay: null,
        editingId: null,
        editingColumn: null,
        composer: null,
        openThread: null,
        camera: stored ?? { x: 0, y: 0, zoom: 1 },
      });
      tryFit();
    }
```

     Declare `fitPending`, `tryFit` and the camera helpers before this subscription. Move the subscription below them if needed. `ToolState`'s idle shape is `{ mode: 'idle', tool, selection }`.
  9. Add the page actions to the returned object:

```ts
    setPage(id) {
      opts.setPage(id);
    },
    createPage(type) {
      const pages = opts.docStore.getState().pages;
      const id = newId();
      const sameType = pages.filter((p) => p.type === type).length;
      const label = type === 'board' ? 'Board' : type === 'sheet' ? 'Sheet' : 'Calendar';
      commit({
        type: 'CreatePage',
        page: {
          id,
          type,
          title: `${label} ${sameType + 1}`,
          order: orderBetween(pages.at(-1)?.order ?? null, null),
          createdBy: opts.user.id,
          createdAt: now(),
        },
      });
      return id;
    },
    renamePage(id, title) {
      const text = title.trim();
      if (text) commit({ type: 'RenamePage', id, title: text });
    },
    movePage(id, toIndex) {
      const others = opts.docStore.getState().pages.filter((p) => p.id !== id);
      const i = Math.max(0, Math.min(toIndex, others.length));
      commit({
        type: 'MovePage',
        id,
        order: orderBetween(others[i - 1]?.order ?? null, others[i]?.order ?? null),
      });
    },
    deletePage(id) {
      if (opts.docStore.getState().pages.length <= 1) return;
      commit({ type: 'DeletePage', id });
    },
    renameBoard(title) {
      const text = title.trim();
      if (text) commit({ type: 'RenameBoard', title: text });
    },
```

     - `commit` uses `LOCAL_ORIGIN`. Page commands touch untracked roots, so they never enter undo, except `DeletePage`, which also deletes shapes. Wrap page commands in a tiny `commitPage = (c) => applyCommand(opts.doc, c, SESSION_ORIGIN)` so a page delete never becomes an undo step that resurrects shapes on a tombstoned page. Use `commitPage` for all five page actions.
     - `MAIN_PAGE` may end up unused. Import only what you use.
  10. Add the six methods to the `BoardController` interface, with the doc comments from the Interfaces above. `createPage(type: PageType): string`.

- [ ] **Step 6: Session.** In `apps/web/src/board/session.ts`:
  - The signature becomes `createBoardSession(roomId: string, key: string | null, initialPage: string | null)`.
  - Create the doc store with `const docStore = createDocStore(conn.doc, initialPage ?? MAIN_PAGE);`.
  - Pass `setPage: docStore.setPage` to the controller.
  - `cameraStorage(roomId)` now keys by page:

```ts
function cameraStorage(roomId: string): CameraStorage {
  const keyFor = (page: string) => `relay:camera:${roomId}:${page}`;
  return {
    load(page) {
      try {
        const raw = safeLocalStorage()?.getItem(keyFor(page));
        return raw ? parseCamera(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(page, camera) {
      try {
        safeLocalStorage()?.setItem(keyFor(page), JSON.stringify(camera));
      } catch {
        // Storage full or blocked: the camera just is not restored next time.
      }
    },
  };
}
```

  - Publish the page and mirror it in the URL:

```ts
  publisher.setPage(docStore.store.getState().activePage);
  const unsubscribePage = docStore.store.subscribe((state, prev) => {
    if (state.activePage === prev.activePage) return;
    publisher.setPage(state.activePage);
    try {
      window.history.replaceState(null, '', hashFor(key, state.activePage));
    } catch {
      // Non-browser environments: nothing to mirror.
    }
  });
```

  - Call `unsubscribePage()` in `destroy()`.
  - `BoardSession` gains `key: string | null;` and `setPage(id: string): void;`. Return `key` and `setPage: controller.setPage`.
  - In `apps/web/src/board/Board.tsx`, update the call to `createBoardSession(roomId, keyFromHash(window.location.hash), pageFromHash(window.location.hash))`.

- [ ] **Step 7: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "feat(web): per-page camera and state, pageId stamping, page actions, room-wide vote cap"
```

---

### Task 6: Page-scoped rendering of presence, comments and votes

**Files:**
- Create: `apps/web/src/render/pageFilter.ts`
- Modify:
  - `apps/web/src/render/RemoteCursors.tsx`
  - `apps/web/src/render/SelectionLayer.tsx`
  - `apps/web/src/render/Minimap.tsx`
  - `apps/web/src/render/CommentLayer.tsx`
  - `apps/web/src/ui/CommentsPanel.tsx`
  - `apps/web/src/ui/Header.tsx`
  - `apps/web/src/ui/VoteControl.tsx`
  - `apps/web/src/render/VoteBadge.tsx`
- Test: `apps/web/test/pageFilter.test.ts` (create)

**Interfaces:**
- Consumes: `DocState.activePage/allShapes` (Task 4), `Peer.page` (Task 2), `CommentThread.pageId` (Task 1).
- Produces: `onPage(peer: { page: string | null }, page: string): boolean`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/pageFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { onPage } from '../src/render/pageFilter';

describe('onPage', () => {
  it('matches the peer page, treating a missing page as main', () => {
    expect(onPage({ page: 'p2' }, 'p2')).toBe(true);
    expect(onPage({ page: 'p2' }, 'main')).toBe(false);
    expect(onPage({ page: null }, 'main')).toBe(true);
    expect(onPage({ page: null }, 'p2')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `npm test -w @relay/web -- pageFilter`. Expected: FAIL.

- [ ] **Step 3: Create `apps/web/src/render/pageFilter.ts`.**

```ts
import { MAIN_PAGE } from '@relay/core';

/** Whether a peer is looking at `page` (older clients publish no page: they are on main). */
export const onPage = (peer: { page: string | null }, page: string): boolean =>
  (peer.page ?? MAIN_PAGE) === page;
```

- [ ] **Step 4: Filter by page.** In each component, read `const page = useStore(session.doc, (d) => d.activePage);`. Then:
  - **RemoteCursors, SelectionLayer (peer selections and typing), Minimap (peer viewports):** iterate `peers.filter((p) => onPage(p, page))` instead of `peers`.
  - **CommentLayer:** skip threads with `thread.pageId !== page`.
  - **CommentsPanel:** filter threads with `t.pageId === page`.
  - **Header:** the open-thread count selector counts only `c.pageId === page && !c.resolved`. Read the page with its own `useStore`, and include it in the selector through a closure.
  - **VoteControl and VoteBadge:** use `d.allShapes` wherever they pass shapes to `cachedTallies`/`voteTallies`. The cap and the "N left" count are room-wide.

- [ ] **Step 5: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src apps/web/test/pageFilter.test.ts
git commit -m "feat(web): presence, comments and vote tallies scoped to pages"
```

---

### Task 7: UI primitives — toasts, context menu, dialog

**Files:**
- Create:
  - `apps/web/src/ui/toasts.ts`
  - `apps/web/src/ui/Toasts.tsx`
  - `apps/web/src/ui/ContextMenu.tsx`
  - `apps/web/src/ui/Dialog.tsx`
- Test: `apps/web/test/toasts.test.ts` (create)

**Interfaces:**
- Produces:
  - `toasts: StoreApi<{ items: { id: number; message: string }[] }>`, `toast(message: string): void`, `TOAST_MS = 3000`
  - `<Toasts />`: bottom-centre; test id `toast`
  - `<ContextMenu x y items onClose />` where `items: { label: string; onSelect(): void; disabled?: boolean; danger?: boolean; testId?: string }[]`. Test id `context-menu`; each item uses `testId` when provided.
  - `<Dialog title onClose children />`: `role="dialog"`, `aria-modal`, test id `dialog`. It closes on Escape or a backdrop click.
  - `<ConfirmDialog title message confirmLabel onConfirm onClose />`, built on Dialog. Test ids `confirm-ok` and `confirm-cancel`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/toasts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, toast, toasts } from '../src/ui/toasts';

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toasts.setState({ items: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('queues messages and dismisses each after TOAST_MS', () => {
    toast('Link copied');
    vi.advanceTimersByTime(1000);
    toast('Page deleted');
    expect(toasts.getState().items.map((t) => t.message)).toEqual(['Link copied', 'Page deleted']);
    vi.advanceTimersByTime(TOAST_MS - 1000);
    expect(toasts.getState().items.map((t) => t.message)).toEqual(['Page deleted']);
    vi.advanceTimersByTime(1000);
    expect(toasts.getState().items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `npm test -w @relay/web -- toasts`. Expected: FAIL.

- [ ] **Step 3: Create `apps/web/src/ui/toasts.ts`**

```ts
import { createStore } from 'zustand/vanilla';

export const TOAST_MS = 3000;

export const toasts = createStore<{ items: { id: number; message: string }[] }>(() => ({
  items: [],
}));

let next = 1;

/** Shows a transient notice at the bottom centre. */
export function toast(message: string): void {
  const id = next++;
  toasts.setState((s) => ({ items: [...s.items, { id, message }] }));
  setTimeout(() => toasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), TOAST_MS);
}
```

- [ ] **Step 4: Create `apps/web/src/ui/Toasts.tsx`**

```tsx
import { useStore } from 'zustand';
import { toasts } from './toasts';

export function Toasts() {
  const items = useStore(toasts, (s) => s.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          role="status"
          className="border-2 border-ink bg-ink px-3 py-1.5 font-mono text-xs text-paper shadow-hard"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/ui/ContextMenu.tsx`**

```tsx
import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}

/** A small menu at screen point (x, y); closes on outside press, Escape, or after a choice. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      className="fixed z-50 min-w-40 border-2 border-ink bg-white py-1 shadow-hard"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          data-testid={item.testId}
          disabled={item.disabled}
          className={`block w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-sun focus:bg-sun focus:outline-none disabled:cursor-not-allowed disabled:text-ink/40 disabled:hover:bg-transparent ${item.danger ? 'text-flame' : ''}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create `apps/web/src/ui/Dialog.tsx`**

```tsx
import { type ReactNode, useEffect } from 'react';

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-ink/30 px-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="dialog"
        className="w-full max-w-md border-[3px] border-ink bg-white p-5 shadow-hard"
      >
        <h2 className="font-display text-lg uppercase">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="font-mono text-xs">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          data-testid="confirm-cancel"
          className="border-2 border-ink px-3 py-1 font-mono text-xs uppercase hover:bg-paper"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="confirm-ok"
          className="border-2 border-ink bg-flame px-3 py-1 font-mono text-xs font-bold uppercase text-white"
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 7: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build -w @relay/web`. Expected: all green. These components are wired up in Tasks 8 and 9.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui apps/web/test/toasts.test.ts
git commit -m "feat(web): toast queue, context menu and dialog primitives"
```

---

### Task 8: Page tabs and page-type layout

**Files:**
- Create: `apps/web/src/ui/PageTabs.tsx`
- Modify: `apps/web/src/board/Board.tsx`

**Interfaces:**
- Consumes:
  - `DocState.pages/activePage` (Task 4)
  - the controller page actions (Task 5)
  - `onPage` (Task 6)
  - `ContextMenu`, `ConfirmDialog`, `toast`, `Toasts` (Task 7)
  - `session.presence` and `session.conn.clock` (role)
- Produces test ids:
  - `page-tabs`
  - `page-tab`: carries `data-page-id` and `aria-selected`
  - `page-rename-input`
  - `page-add`, `page-add-board`, `page-add-sheet` (disabled), `page-add-calendar` (disabled)
  - `page-menu-rename`, `page-menu-delete`
  - `page-peer-dot`
  - `unsupported-page`
  - `no-pages`

- [ ] **Step 1: Create `apps/web/src/ui/PageTabs.tsx`**

```tsx
import type { PageInfo, PageType } from '@relay/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from '../render/pageFilter';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { ConfirmDialog } from './Dialog';
import { toast } from './toasts';

type Menu = { x: number; y: number; items: MenuItem[] } | null;

export function PageTabs({ session }: { session: BoardSession }) {
  const { controller } = session;
  const pages = useStore(session.doc, (d) => d.pages);
  const active = useStore(session.doc, (d) => d.activePage);
  const peers = useStore(session.presence, (s) => s.peers);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [confirm, setConfirm] = useState<PageInfo | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const add = (type: PageType) => {
    const id = controller.createPage(type);
    controller.setPage(id);
  };

  return (
    <nav
      aria-label="Pages"
      data-testid="page-tabs"
      className="flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b-2 border-ink bg-paper px-3"
    >
      {pages.map((p, index) => {
        const here = peers.filter((peer) => onPage(peer, p.id));
        const selected = p.id === active;
        return (
          <div
            key={p.id}
            className="flex"
            draggable={canEdit && renaming !== p.id}
            onDragStart={() => setDragId(p.id)}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={() => {
              if (dragId && dragId !== p.id) controller.movePage(dragId, index);
              setDragId(null);
            }}
          >
            {renaming === p.id ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: renaming starts typing right away
                autoFocus
                data-testid="page-rename-input"
                aria-label="Page name"
                defaultValue={p.title}
                className="h-8 w-32 border-2 border-b-0 border-ink bg-white px-2 font-mono text-xs outline-none"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    controller.renamePage(p.id, e.currentTarget.value);
                    setRenaming(null);
                  } else if (e.key === 'Escape') {
                    setRenaming(null);
                  }
                }}
                onBlur={(e) => {
                  controller.renamePage(p.id, e.currentTarget.value);
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                data-testid="page-tab"
                data-page-id={p.id}
                aria-selected={selected}
                title={p.title}
                className={`flex h-8 max-w-48 items-center gap-1.5 border-2 border-b-0 border-ink px-3 font-mono text-xs ${selected ? 'bg-white font-bold' : 'bg-paper hover:bg-white'}`}
                onClick={() => controller.setPage(p.id)}
                onDoubleClick={() => canEdit && setRenaming(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!canEdit) return;
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: 'Rename', testId: 'page-menu-rename', onSelect: () => setRenaming(p.id) },
                      {
                        label: 'Delete',
                        testId: 'page-menu-delete',
                        danger: true,
                        disabled: pages.length <= 1,
                        onSelect: () => setConfirm(p),
                      },
                    ],
                  });
                }}
              >
                <span className="truncate">{p.title}</span>
                {here.slice(0, 3).map((peer) => (
                  <span
                    key={peer.clientId}
                    data-testid="page-peer-dot"
                    title={peer.user.name}
                    className="inline-block size-2 shrink-0 rounded-full border border-ink"
                    style={{ background: peer.user.color }}
                  />
                ))}
              </button>
            )}
          </div>
        );
      })}
      {canEdit && (
        <button
          type="button"
          data-testid="page-add"
          aria-label="New page"
          className="mb-0.5 grid size-7 place-items-center border-2 border-ink bg-white hover:bg-sun"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({
              x: r.left,
              y: r.bottom + 4,
              items: [
                { label: 'Board', testId: 'page-add-board', onSelect: () => add('board') },
                { label: 'Spreadsheet (soon)', testId: 'page-add-sheet', disabled: true, onSelect: () => {} },
                { label: 'Calendar (soon)', testId: 'page-add-calendar', disabled: true, onSelect: () => {} },
              ],
            });
          }}
        >
          <Plus size={14} />
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmDialog
          title="Delete page"
          message={`Delete “${confirm.title}” and everything on it for everyone? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            controller.deletePage(confirm.id);
            toast('Page deleted');
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Layout.** In `apps/web/src/board/Board.tsx`:
  - Import `PageTabs` and `Toasts`.
  - In `BoardView`, read the active page's type:

```tsx
  const type = useStore(session.doc, (d) => d.pages.find((p) => p.id === d.activePage)?.type);
  const hasPages = useStore(session.doc, (d) => d.pages.length > 0);
```

    Import `useStore` from `zustand`.
  - Render `<PageTabs session={session} />` right after `<Header … />`.
  - Render the existing `relative flex-1 overflow-hidden` canvas stack only when `type === 'board'`.
  - Otherwise, render a `relative flex-1` container holding one of these:
    - **When there are no visible pages:** `<div data-testid="no-pages">`, with the text "No pages yet", plus a "New board" button calling `session.setPage(session.controller.createPage('board'))` for editors.
    - **Otherwise:** `<div data-testid="unsupported-page">`, with the text "This page type is not available in this version yet."
  - Keep `<StatusBanner>` visible in every case.
  - Render `<Toasts />` once, as the last child of the outer `fixed inset-0` div.

- [ ] **Step 3: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build -w @relay/web`. Expected: all green. The controller verifies in a browser, and Task 10 adds the e2e.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): page tabs with create, rename, reorder, delete and peer dots"
```

---

### Task 9: Share dialog and editable board title

**Files:**
- Create: `apps/web/src/ui/ShareDialog.tsx`, `apps/web/src/ui/BoardTitle.tsx`
- Modify: `apps/web/src/ui/Header.tsx`, `apps/web/src/board/Board.tsx` (only if Share state lives there)

**Interfaces:**
- Consumes: `session.roomId`, `session.key`, `session.doc` (`activePage`, `meta.title`), `session.conn.clock` (`role`, `viewKey`), `controller.renameBoard`, `hashFor` (Task 4), `Dialog` and `toast` (Task 7).
- Produces test ids: `share-open`, `share-edit-link`, `share-view-link` (readonly inputs), `share-copy-edit`, `share-copy-view`, `board-title`, `board-title-input`.

- [ ] **Step 1: Create `apps/web/src/ui/ShareDialog.tsx`**

```tsx
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { hashFor } from '../sync/key';
import { Dialog } from './Dialog';
import { toast } from './toasts';

function LinkRow({ label, link, testId }: { label: string; link: string | null; testId: string }) {
  return (
    <label className="mt-3 block">
      <span className="font-mono text-[10px] uppercase text-ink/60">{label}</span>
      <div className="mt-1 flex gap-2">
        <input
          readOnly
          data-testid={`share-${testId}-link`}
          value={link ?? 'Connecting…'}
          className="flex-1 border-2 border-ink/30 px-2 py-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          data-testid={`share-copy-${testId}`}
          disabled={!link}
          className="border-2 border-ink px-3 font-mono text-xs font-bold uppercase hover:bg-sun disabled:opacity-40"
          onClick={async () => {
            if (!link) return;
            try {
              await navigator.clipboard.writeText(link);
              toast('Link copied');
            } catch {
              toast('Copy failed — select the link and copy it');
            }
          }}
        >
          Copy
        </button>
      </div>
    </label>
  );
}

export function ShareDialog({ session, onClose }: { session: BoardSession; onClose(): void }) {
  const page = useStore(session.doc, (d) => d.activePage);
  const role = useStore(session.conn.clock, (c) => c.role);
  const viewKey = useStore(session.conn.clock, (c) => c.viewKey);
  const base = `${window.location.origin}/r/${session.roomId}`;
  const editLink = role === 'edit' ? `${base}${hashFor(session.key, page)}` : null;
  const viewLink =
    role === 'edit' ? (viewKey ? `${base}${hashFor(viewKey, page)}` : null) : `${base}${hashFor(session.key, page)}`;
  return (
    <Dialog title="Share board" onClose={onClose}>
      <p className="font-mono text-xs text-ink/70">Anyone with a link can open this board. No accounts.</p>
      {role === 'edit' && <LinkRow label="Can edit" link={editLink} testId="edit" />}
      <LinkRow label="Can view" link={viewLink} testId="view" />
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/ui/BoardTitle.tsx`**

```tsx
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function BoardTitle({ session }: { session: BoardSession }) {
  const title = useStore(session.doc, (d) => d.meta.title);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: editing starts typing right away
        autoFocus
        data-testid="board-title-input"
        aria-label="Board title"
        defaultValue={title}
        className="w-48 border-2 border-ink px-1 font-mono text-xs font-semibold outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            session.controller.renameBoard(e.currentTarget.value);
            setEditing(false);
          } else if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        onBlur={(e) => {
          session.controller.renameBoard(e.currentTarget.value);
          setEditing(false);
        }}
      />
    );
  }
  return canEdit ? (
    <button
      type="button"
      data-testid="board-title"
      title="Rename board"
      className="font-mono text-xs font-semibold hover:underline"
      onClick={() => setEditing(true)}
    >
      {title}
    </button>
  ) : (
    <span data-testid="board-title" className="font-mono text-xs font-semibold">
      {title}
    </span>
  );
}
```

- [ ] **Step 3: Header.** In `apps/web/src/ui/Header.tsx`:
  - Replace `<span className="font-semibold">{meta.title}</span>` inside the breadcrumb nav with `<BoardTitle session={session} />`.
  - Add a Share button right after the comments toggle:

```tsx
        <button
          type="button"
          data-testid="share-open"
          className="border-2 border-ink bg-cobalt px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-white hover:brightness-110"
          onClick={() => setSharing(true)}
        >
          Share
        </button>
```

  - Hold `const [sharing, setSharing] = useState(false);` in `Header`.
  - Render `{sharing && <ShareDialog session={session} onClose={() => setSharing(false)} />}` at the end of the header's JSX. The dialog is `fixed`, so its position in the tree does not matter.
  - If `meta` becomes unused in Header, remove it. Keep the breadcrumb.

- [ ] **Step 4: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): share dialog with edit and read-only links, editable board title"
```

---

### Task 10: End-to-end pages coverage

**Files:**
- Create: `e2e/pages.spec.ts`

**Interfaces:**
- Consumes: the test ids from Tasks 7–9, and `POST /api/rooms` (`editKey`, `viewKey`).

- [ ] **Step 1: Write `e2e/pages.spec.ts`**

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

test('pages are created, used, renamed, reordered and deleted across users', async ({
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

  const tabs = page.getByTestId('page-tab');
  await expect(tabs).toHaveCount(1);
  await page.getByTestId('page-add').click();
  await expect(page.getByTestId('page-add-sheet')).toBeDisabled();
  await page.getByTestId('page-add-board').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/&p=/);

  // Draw on the new page; the first page stays empty.
  await page.keyboard.press('s');
  await page.mouse.click(400, 350);
  await page.keyboard.type('Only on page two');
  await page.keyboard.press('Escape');
  await tabs.nth(0).click();
  await expect(page.getByText('Only on page two')).toHaveCount(0);

  // B sees the new tab and its content, and A's presence dot moves with A.
  const tabsB = pb.getByTestId('page-tab');
  await expect(tabsB).toHaveCount(2);
  await tabsB.nth(1).click();
  await expect(pb.getByText('Only on page two')).toBeVisible();
  await expect(page.getByTestId('page-tab').nth(1).getByTestId('page-peer-dot')).toHaveCount(1);

  // Rename by double-click.
  await tabs.nth(1).dblclick();
  await page.getByTestId('page-rename-input').fill('Ideas');
  await page.keyboard.press('Enter');
  await expect(tabsB.nth(1)).toHaveText(/Ideas/);

  // Reorder by dragging Ideas before the first tab.
  await tabs.nth(1).dragTo(tabs.nth(0));
  await expect(tabsB.nth(0)).toHaveText(/Ideas/);

  // Delete through the context menu, with confirmation; B falls back to the remaining page.
  await tabs.nth(0).click({ button: 'right' });
  await page.getByTestId('page-menu-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Page deleted');
  await expect(tabsB).toHaveCount(1);
  await expect(pb.getByText('Only on page two')).toHaveCount(0);
  await other.close();
});

test('share dialog gives edit and read-only links; the title is editable', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);

  await page.getByTestId('board-title').click();
  await page.getByTestId('board-title-input').fill('Sprint 14 Retro');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('board-title')).toHaveText('Sprint 14 Retro');

  await page.getByTestId('share-open').click();
  await expect(page.getByTestId('share-edit-link')).toHaveValue(new RegExp(`/r/${roomId}#k=${editKey}&p=`));
  await expect(page.getByTestId('share-view-link')).toHaveValue(new RegExp(`#k=${viewKey}&p=`));
  const viewLink = await page.getByTestId('share-view-link').inputValue();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog')).toHaveCount(0);

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, viewLink.replace(/^https?:\/\/[^/]+/, ''));
  await expect(viewer.getByTestId('board-title')).toHaveText('Sprint 14 Retro');
  await expect(viewer.getByTestId('page-add')).toHaveCount(0);
  await expect(viewer.getByTestId('tool-comment')).toHaveCount(0);
  await viewer.getByTestId('share-open').click();
  await expect(viewer.getByTestId('share-edit-link')).toHaveCount(0);
  await expect(viewer.getByTestId('share-view-link')).toHaveValue(new RegExp(`#k=${viewKey}`));
  await viewerCtx.close();
});
```

- [ ] **Step 2: Run the e2e suite.** Run `npm run e2e`. Expected: all pass (16 existing + 2 new).
  - On failure, read the trace and fix the root cause. Do not add sleeps and do not weaken assertions.
  - If an HTML5 `dragTo` between tabs does not trigger `drop` in Chromium, change the reorder step to the right-click menu only if that is truly impossible, and name the change in the report. Do not remove the reorder coverage; try `dragTo` with `{ targetPosition: { x: 4, y: 10 } }` first.

- [ ] **Step 3: Run the full checks.** Run `npm test`, `npm run typecheck`, `npm run lint`. Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/pages.spec.ts
git commit -m "test(e2e): pages across users, share links and board title"
```
