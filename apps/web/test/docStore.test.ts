import { applyCommand, DEFAULT_STYLE, getRoots, initMeta, type NewShape } from '@relay/core';
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
});
