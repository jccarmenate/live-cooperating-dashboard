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
    applyCommand(
      doc,
      { type: 'CreatePage', page: { ...newPage('x', 'a9'), title: 'Other' } },
      LOCAL_ORIGIN,
    );
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
