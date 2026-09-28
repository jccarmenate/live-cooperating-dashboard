import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  MAIN_PAGE,
  MAX_BOARD_TITLE,
  MAX_PAGE_TITLE,
  orderBetween,
  pageIdOf,
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

function visible(doc: Y.Doc) {
  const { pages, pageTombstones } = getRoots(doc);
  return readPages(pages, pageTombstones);
}

/**
 * Runs `a` and `b` offline on two fresh docs under both client-id orderings (so the
 * outcome does not hang on Yjs's tie-break), syncs both ways and returns each pair
 * of visible page lists.
 */
function race(a: (doc: Y.Doc) => void, b: (doc: Y.Doc) => void, shared?: (doc: Y.Doc) => void) {
  return (
    [
      [1, 2],
      [2, 1],
    ] as const
  ).map(([idA, idB]) => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.clientID = idA;
    docB.clientID = idB;
    if (shared) {
      shared(docA);
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    }
    a(docA);
    b(docB);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));
    return [visible(docA), visible(docB)] as const;
  });
}

const create = (id: string, order: string) => (doc: Y.Doc) =>
  applyCommand(doc, { type: 'CreatePage', page: newPage(id, order) }, LOCAL_ORIGIN);
const deleteMain = (doc: Y.Doc) =>
  applyCommand(doc, { type: 'DeletePage', id: 'main' }, LOCAL_ORIGIN);

describe('pages', () => {
  it('a new room has only the implicit main board page', () => {
    const doc = new Y.Doc();
    expect(visible(doc)).toEqual([
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
    expect(visible(doc).map((p) => [p.id, p.type])).toEqual([
      ['main', 'board'],
      ['c', 'sheet'],
      ['d', 'board'],
    ]);
  });

  it('CreatePage never overwrites an existing page', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('x', 'a1') }, LOCAL_ORIGIN);
    applyCommand(
      doc,
      { type: 'CreatePage', page: { ...newPage('x', 'a9'), title: 'Other' } },
      LOCAL_ORIGIN,
    );
    expect(visible(doc).find((p) => p.id === 'x')?.title).toBe('X');
  });

  it('renaming or moving the implicit main page writes its entry', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'RenamePage', id: 'main', title: 'Retro' }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'MovePage', id: 'main', order: 'a5' }, LOCAL_ORIGIN);
    expect(visible(doc)).toEqual([
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
    const { shapes, connectors, comments, pages, pageTombstones } = getRoots(doc);
    expect(transactions).toBe(1);
    expect([...shapes.keys()]).toEqual(['s-main']);
    expect(connectors.size).toBe(0);
    expect(comments.size).toBe(0);
    expect(pageTombstones.get('p2')).toBe(true);
    expect(pages.get('p2')?.has('deleted')).toBe(false);
  });

  it('deleting main removes shapes without a pageId', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    sticky(doc, 'legacy');
    sticky(doc, 'kept', 'p2');
    applyCommand(doc, { type: 'DeletePage', id: 'main' }, LOCAL_ORIGIN);
    expect([...getRoots(doc).shapes.keys()]).toEqual(['kept']);
    expect(visible(doc).map((p) => p.id)).toEqual(['p2']);
  });

  it('a concurrent rename never resurrects a deleted main page', () => {
    const rename = (doc: Y.Doc) =>
      applyCommand(doc, { type: 'RenamePage', id: 'main', title: 'Retro' }, LOCAL_ORIGIN);
    for (const [pagesA, pagesB] of race(deleteMain, rename, create('p2', 'a1'))) {
      expect(pagesB).toEqual(pagesA);
      expect(pagesA.map((p) => p.id)).toEqual(['p2']);
    }
  });

  it('S1: concurrent page creations never resurrect a deleted main page', () => {
    // A creates p2 then deletes main while B, offline, creates p3.
    const a = (doc: Y.Doc) => {
      create('p2', 'a1')(doc);
      deleteMain(doc);
    };
    for (const [pagesA, pagesB] of race(a, create('p3', 'a2'))) {
      expect(pagesB).toEqual(pagesA);
      expect(pagesA.map((p) => p.id)).toEqual(['p2', 'p3']);
    }
  });

  it('S2: an offline rename of main never resurrects it after a delete', () => {
    // B renames main on a fresh board while A creates p2 and deletes main.
    const a = (doc: Y.Doc) => {
      create('p2', 'a1')(doc);
      deleteMain(doc);
    };
    const b = (doc: Y.Doc) =>
      applyCommand(doc, { type: 'RenamePage', id: 'main', title: 'Retro' }, LOCAL_ORIGIN);
    for (const [pagesA, pagesB] of race(a, b)) {
      expect(pagesB).toEqual(pagesA);
      expect(pagesA.map((p) => p.id)).toEqual(['p2']);
    }
  });

  it('CreatePage of main keeps its own fields', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      { type: 'CreatePage', page: { ...newPage('main', 'a3'), title: 'Kickoff' } },
      LOCAL_ORIGIN,
    );
    expect(visible(doc)).toEqual([{ ...newPage('main', 'a3'), title: 'Kickoff' }]);
  });

  it('rename, move and create ignore a deleted main page', () => {
    const doc = new Y.Doc();
    create('p2', 'a1')(doc);
    deleteMain(doc);
    applyCommand(doc, { type: 'RenamePage', id: 'main', title: 'Back' }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'MovePage', id: 'main', order: 'a9' }, LOCAL_ORIGIN);
    create('main', 'a5')(doc);
    expect(getRoots(doc).pages.has('main')).toBe(false);
    expect(visible(doc).map((p) => p.id)).toEqual(['p2']);
  });

  it('DeletePage also deletes connectors on other pages that point at its shapes', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    sticky(doc, 's-main');
    sticky(doc, 't-main');
    sticky(doc, 's-p2', 'p2');
    const connect = (id: string, from: string, to: string) =>
      applyCommand(
        doc,
        {
          type: 'Connect',
          connector: {
            id,
            from: { shapeId: from, anchor: 'auto' },
            to: { shapeId: to, anchor: 'auto' },
            routing: 'straight',
            head: 'arrow',
            createdBy: 'u1',
          },
        },
        LOCAL_ORIGIN,
      );
    connect('cross-from', 's-main', 's-p2');
    connect('cross-to', 's-p2', 's-main');
    connect('local', 's-main', 't-main');
    applyCommand(doc, { type: 'DeletePage', id: 'p2' }, LOCAL_ORIGIN);
    const { shapes, connectors } = getRoots(doc);
    expect([...shapes.keys()].sort()).toEqual(['s-main', 't-main']);
    expect([...connectors.keys()]).toEqual(['local']);
  });

  it('rename and move are no-ops on a deleted page', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'DeletePage', id: 'p2' }, LOCAL_ORIGIN);
    const before = getRoots(doc).pages.get('p2')?.toJSON();
    applyCommand(doc, { type: 'RenamePage', id: 'p2', title: 'Back' }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'MovePage', id: 'p2', order: 'a9' }, LOCAL_ORIGIN);
    expect(getRoots(doc).pages.get('p2')?.toJSON()).toEqual(before);
    expect(before).toMatchObject({ title: 'P2', order: 'a1' });
    expect(getRoots(doc).pageTombstones.get('p2')).toBe(true);
    expect(visible(doc).map((p) => p.id)).toEqual(['main']);
  });

  it('deleting an unknown page leaves all content alone', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    sticky(doc, 's-main');
    sticky(doc, 's-p2', 'p2');
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          from: { shapeId: 's-main', anchor: 'auto' },
          to: { shapeId: 's-p2', anchor: 'auto' },
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
    const snapshot = () => {
      const { shapes, connectors, comments, pages, pageTombstones } = getRoots(doc);
      return {
        shapes: shapes.toJSON(),
        connectors: connectors.toJSON(),
        comments: comments.toJSON(),
        pages: pages.toJSON(),
        pageTombstones: pageTombstones.toJSON(),
      };
    };
    const before = snapshot();
    applyCommand(doc, { type: 'DeletePage', id: 'ghost' }, LOCAL_ORIGIN);
    expect(snapshot()).toEqual(before);
    expect(getRoots(doc).pages.has('ghost')).toBe(false);
  });

  it('CreatePage does not revive a deleted page', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'DeletePage', id: 'p2' }, LOCAL_ORIGIN);
    applyCommand(
      doc,
      { type: 'CreatePage', page: { ...newPage('p2', 'a5'), title: 'Again' } },
      LOCAL_ORIGIN,
    );
    expect(getRoots(doc).pageTombstones.get('p2')).toBe(true);
    expect(getRoots(doc).pages.get('p2')?.get('title')).toBe('P2');
    expect(visible(doc).map((p) => p.id)).toEqual(['main']);
  });

  it('CreatePage ignores a tombstoned id this replica never saw created', () => {
    // A replica can receive a page's tombstone without its entry (e.g. main, or a
    // page whose creation raced its deletion); creating it must not bring it back.
    const doc = new Y.Doc();
    getRoots(doc).pageTombstones.set('p9', true);
    applyCommand(doc, { type: 'CreatePage', page: newPage('p9', 'a1') }, LOCAL_ORIGIN);
    expect(getRoots(doc).pages.has('p9')).toBe(false);
    expect(visible(doc).map((p) => p.id)).toEqual(['main']);
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
    expect(readConnector('k', getRoots(doc).connectors.get('k') as Y.Map<unknown>)?.pageId).toBe(
      'p2',
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
    expect(readComment('c', getRoots(doc).comments.get('c') as Y.Map<unknown>)?.pageId).toBe('p2');
  });

  it('unknown page types read as unknown', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).pages.set('z', m);
    m.set('type', 'kanban');
    m.set('title', 'Z');
    m.set('order', 'a3');
    expect(visible(doc).find((p) => p.id === 'z')?.type).toBe('unknown');
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

describe('title caps', () => {
  it('reads an oversized page title cut to MAX_PAGE_TITLE', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      { type: 'CreatePage', page: { ...newPage('p2', 'a1'), title: 'x'.repeat(500) } },
      LOCAL_ORIGIN,
    );
    applyCommand(doc, { type: 'RenamePage', id: 'main', title: 'y'.repeat(500) }, LOCAL_ORIGIN);
    const titles = visible(doc).map((p) => p.title);
    expect(MAX_PAGE_TITLE).toBe(80);
    expect(titles).toEqual(['y'.repeat(MAX_PAGE_TITLE), 'x'.repeat(MAX_PAGE_TITLE)]);
  });

  it('reads an oversized board title cut to MAX_BOARD_TITLE', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'RenameBoard', title: 'z'.repeat(1000) }, LOCAL_ORIGIN);
    expect(MAX_BOARD_TITLE).toBe(120);
    expect(readMeta(getRoots(doc).meta).title).toBe('z'.repeat(MAX_BOARD_TITLE));
  });
});

describe('non-map page entries', () => {
  /** A misbehaving client may write any value under a page id. */
  const junk = (doc: Y.Doc, id: string) =>
    (getRoots(doc).pages as unknown as Y.Map<unknown>).set(id, 'junk');

  it('reads a non-map entry as absent; a non-map main does not hide the implicit main', () => {
    const doc = new Y.Doc();
    junk(doc, 'p3');
    junk(doc, MAIN_PAGE);
    expect(visible(doc)).toEqual([
      { id: 'main', type: 'board', title: 'Board', order: 'a0', createdBy: '', createdAt: 0 },
    ]);
  });

  it('rename and move leave non-map entries alone', () => {
    const doc = new Y.Doc();
    junk(doc, 'p3');
    junk(doc, MAIN_PAGE);
    for (const id of ['p3', MAIN_PAGE]) {
      applyCommand(doc, { type: 'RenamePage', id, title: 'T' }, LOCAL_ORIGIN);
      applyCommand(doc, { type: 'MovePage', id, order: 'a5' }, LOCAL_ORIGIN);
      expect((getRoots(doc).pages as unknown as Y.Map<unknown>).get(id)).toBe('junk');
    }
  });

  it('DeletePage of a non-map page is a no-op, but deleting main still tombstones it', () => {
    const doc = new Y.Doc();
    junk(doc, 'p3');
    junk(doc, MAIN_PAGE);
    sticky(doc, 's3', 'p3');
    sticky(doc, 'sm');
    applyCommand(doc, { type: 'DeletePage', id: 'p3' }, LOCAL_ORIGIN);
    expect(getRoots(doc).pageTombstones.has('p3')).toBe(false);
    expect(getRoots(doc).shapes.has('s3')).toBe(true);
    applyCommand(doc, { type: 'DeletePage', id: MAIN_PAGE }, LOCAL_ORIGIN);
    expect(getRoots(doc).pageTombstones.get(MAIN_PAGE)).toBe(true);
    expect(getRoots(doc).shapes.has('sm')).toBe(false);
    expect(visible(doc)).toEqual([]);
  });
});

describe('pageIdOf', () => {
  const long = 'p'.repeat(65);

  it('keeps a non-empty id of at most 64 characters; anything else is main', () => {
    expect(pageIdOf('p2')).toBe('p2');
    expect(pageIdOf('p'.repeat(64))).toBe('p'.repeat(64));
    expect(pageIdOf('')).toBe(MAIN_PAGE);
    expect(pageIdOf(long)).toBe(MAIN_PAGE);
    expect(pageIdOf(7)).toBe(MAIN_PAGE);
    expect(pageIdOf(null)).toBe(MAIN_PAGE);
    expect(pageIdOf(undefined)).toBe(MAIN_PAGE);
    expect(pageIdOf({ id: 'p2' })).toBe(MAIN_PAGE);
  });

  it('shapes, connectors and comments with a malformed pageId read as main', () => {
    for (const bad of ['', long, 42, true]) {
      const doc = new Y.Doc();
      const { shapes, connectors, comments } = getRoots(doc);
      sticky(doc, 's');
      shapes.get('s')?.set('pageId', bad);
      applyCommand(
        doc,
        {
          type: 'Connect',
          connector: {
            id: 'k',
            from: { x: 0, y: 0 },
            to: { x: 5, y: 5 },
            routing: 'straight',
            head: 'arrow',
            createdBy: 'u1',
          },
        },
        LOCAL_ORIGIN,
      );
      connectors.get('k')?.set('pageId', bad);
      applyCommand(
        doc,
        {
          type: 'AddComment',
          id: 'c',
          pageId: 'main',
          anchor: { x: 0, y: 0 },
          createdBy: 'u1',
          createdAt: 0,
          entry: { id: 'e', authorId: 'u1', author: 'A', body: 'hi', ts: 0 },
        },
        SESSION_ORIGIN,
      );
      comments.get('c')?.set('pageId', bad);
      expect(readShape('s', shapes.get('s') as Y.Map<unknown>)?.pageId).toBeUndefined();
      expect(readConnector('k', connectors.get('k') as Y.Map<unknown>)?.pageId).toBeUndefined();
      expect(readComment('c', comments.get('c') as Y.Map<unknown>)?.pageId).toBe(MAIN_PAGE);
    }
  });

  it('a connector on main reads with no pageId', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          pageId: MAIN_PAGE,
          from: { x: 0, y: 0 },
          to: { x: 5, y: 5 },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    const k = getRoots(doc).connectors.get('k') as Y.Map<unknown>;
    expect(k.get('pageId')).toBe(MAIN_PAGE);
    expect(readConnector('k', k)?.pageId).toBeUndefined();
  });

  it('deleting main removes items whose pageId is malformed', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreatePage', page: newPage('p2', 'a1') }, LOCAL_ORIGIN);
    sticky(doc, 'empty');
    sticky(doc, 'long');
    sticky(doc, 'kept', 'p2');
    getRoots(doc).shapes.get('empty')?.set('pageId', '');
    getRoots(doc).shapes.get('long')?.set('pageId', long);
    applyCommand(doc, { type: 'DeletePage', id: MAIN_PAGE }, LOCAL_ORIGIN);
    expect([...getRoots(doc).shapes.keys()]).toEqual(['kept']);
  });
});
