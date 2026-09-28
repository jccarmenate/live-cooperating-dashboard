import {
  applyCommand,
  DEFAULT_STYLE,
  getRoots,
  initMeta,
  LOCAL_ORIGIN,
  type NewShape,
} from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDocStore } from '../src/store/docStore';

const sticky = (id: string, x = 0): NewShape => ({
  id,
  type: 'sticky',
  x,
  y: 0,
  w: 180,
  h: 140,
  style: DEFAULT_STYLE.sticky,
  text: 'hi',
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 0,
});

describe('createDocStore', () => {
  it('snapshots existing shapes on creation', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('a') });
    const { store } = createDocStore(doc);
    expect(store.getState().order).toEqual(['a']);
    expect(store.getState().shapes.a?.text).toBe('hi');
  });

  it('updates only changed shapes and keeps identity of the rest', () => {
    const doc = new Y.Doc();
    const { store } = createDocStore(doc);
    applyCommand(doc, { type: 'CreateShape', shape: sticky('a') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('b') });
    const before = store.getState().shapes;
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 'b', x: 50, y: 60 }] });
    const after = store.getState().shapes;
    expect(after.a).toBe(before.a);
    expect(after.b).not.toBe(before.b);
    expect(after.b).toMatchObject({ x: 50, y: 60 });
  });

  it('reflects text edits and deletions', () => {
    const doc = new Y.Doc();
    const { store } = createDocStore(doc);
    applyCommand(doc, { type: 'CreateShape', shape: sticky('a') });
    applyCommand(doc, { type: 'SetText', id: 'a', index: 2, deleteCount: 0, insert: '!' });
    expect(store.getState().shapes.a?.text).toBe('hi!');
    applyCommand(doc, { type: 'DeleteShapes', ids: ['a'] });
    expect(store.getState().shapes.a).toBeUndefined();
    expect(store.getState().order).toEqual([]);
  });

  it('tracks meta and stops listening after destroy', () => {
    const doc = new Y.Doc();
    const { store, destroy } = createDocStore(doc);
    initMeta(doc, { title: 'Sprint 14 Retro', breadcrumb: ['Q3 Planning'] });
    expect(store.getState().meta.title).toBe('Sprint 14 Retro');
    destroy();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('late') });
    expect(store.getState().shapes.late).toBeUndefined();
    expect(getRoots(doc).shapes.has('late')).toBe(true);
  });

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
});

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
      {
        type: 'CreatePage',
        page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u', createdAt: 0 },
      },
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
      {
        type: 'CreatePage',
        page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u', createdAt: 0 },
      },
      LOCAL_ORIGIN,
    );
    const docs = createDocStore(doc, 'nope');
    expect(docs.store.getState().activePage).toBe('main');
    docs.setPage('p2');
    applyCommand(doc, { type: 'DeletePage', id: 'p2' }, LOCAL_ORIGIN);
    expect(docs.store.getState().activePage).toBe('main');
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main']);
  });

  it('falls back when a delete only writes a tombstone (main with no shapes)', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u', createdAt: 0 },
      },
      LOCAL_ORIGIN,
    );
    const docs = createDocStore(doc);
    expect(docs.store.getState().activePage).toBe('main');
    applyCommand(doc, { type: 'DeletePage', id: 'main' }, LOCAL_ORIGIN);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['p2']);
    expect(docs.store.getState().activePage).toBe('p2');
  });

  const createPage = (doc: Y.Doc, id: string, order: string) =>
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id, type: 'board', title: id, order, createdBy: 'u', createdAt: 0 },
      },
      LOCAL_ORIGIN,
    );
  const movePage = (doc: Y.Doc, id: string, order: string) =>
    applyCommand(doc, { type: 'MovePage', id, order }, LOCAL_ORIGIN);

  it('pins the fallback when the active page is deleted, so a later reorder does not move it', () => {
    const doc = new Y.Doc();
    createPage(doc, 'b', 'a1');
    createPage(doc, 'c', 'a2');
    const docs = createDocStore(doc);
    docs.setPage('b');
    applyCommand(doc, { type: 'DeletePage', id: 'b' }, 'remote');
    expect(docs.store.getState().activePage).toBe('main');
    movePage(doc, 'c', 'Z0'); // before main's 'a0'
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['c', 'main']);
    expect(docs.store.getState().activePage).toBe('main');
  });

  it('waits for an unknown page until pinned, then stays put', () => {
    const doc = new Y.Doc();
    const docs = createDocStore(doc, 'p2');
    expect(docs.store.getState().activePage).toBe('main'); // not synced yet
    createPage(doc, 'p2', 'a1'); // the sync brings it
    expect(docs.store.getState().activePage).toBe('p2');

    const stale = new Y.Doc();
    createPage(stale, 'p3', 'a1');
    const other = createDocStore(stale, 'nope');
    expect(other.store.getState().activePage).toBe('main');
    other.pinActive();
    movePage(stale, 'p3', 'Z0');
    expect(other.store.getState().activePage).toBe('main');
  });

  it('keeps pages across shape changes and allShapes across connector-only changes', () => {
    const doc = new Y.Doc();
    sticky(doc, 'a');
    sticky(doc, 'b');
    const docs = createDocStore(doc);
    const pages = docs.store.getState().pages;
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 'a', x: 40, y: 0 }] }, LOCAL_ORIGIN);
    expect(docs.store.getState().shapes.a?.x).toBe(40);
    expect(docs.store.getState().pages).toBe(pages);
    const allShapes = docs.store.getState().allShapes;
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
    expect(docs.store.getState().connectorOrder).toEqual(['k']);
    expect(docs.store.getState().allShapes).toBe(allShapes);
    expect(docs.store.getState().pages).toBe(pages);
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

  it('leaves shapes on a tombstoned page out of allShapes, even before they are deleted', () => {
    // A replica can receive the tombstone ahead of the shape deletions.
    const doc = new Y.Doc();
    createPage(doc, 'p2', 'a1');
    sticky(doc, 'm1');
    sticky(doc, 'q1', 'p2');
    const docs = createDocStore(doc);
    expect(Object.keys(docs.store.getState().allShapes).sort()).toEqual(['m1', 'q1']);
    getRoots(doc).pageTombstones.set('p2', true);
    expect(getRoots(doc).shapes.has('q1')).toBe(true);
    expect(Object.keys(docs.store.getState().allShapes)).toEqual(['m1']);
  });

  it('projects a shape whose parent frame is on another page as a root shape', () => {
    const doc = new Y.Doc();
    createPage(doc, 'p2', 'a1');
    applyCommand(
      doc,
      {
        type: 'CreateShape',
        shape: {
          id: 'f1',
          type: 'frame',
          x: 0,
          y: 0,
          w: 720,
          h: 440,
          style: DEFAULT_STYLE.frame,
          createdBy: 'u1',
          authorName: 'A',
          createdAt: 0,
        },
      },
      LOCAL_ORIGIN,
    );
    sticky(doc, 'q1', 'p2');
    getRoots(doc).shapes.get('q1')?.set('parentId', 'f1');
    const docs = createDocStore(doc, 'p2');
    expect(docs.store.getState().activePage).toBe('p2');
    expect(docs.store.getState().shapes.q1).toBeDefined();
    expect(docs.store.getState().shapes.q1?.parentId).toBeUndefined();
    expect(docs.store.getState().shapes.f1).toBeUndefined();
  });
});
