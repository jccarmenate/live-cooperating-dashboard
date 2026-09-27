import { applyCommand, SESSION_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createActivityStore } from '../src/store/activityStore';

const entry = (id: string) => ({ id, authorId: 'u1', author: 'A', body: id, ts: 1 });

describe('activity store', () => {
  it('projects the vote and the sorted vote keys', () => {
    const doc = new Y.Doc();
    const { store } = createActivityStore(doc);
    applyCommand(
      doc,
      { type: 'StartVote', endsAt: 99, maxPerUser: 3, startedBy: 'u1' },
      SESSION_ORIGIN,
    );
    applyCommand(doc, { type: 'CastVote', shapeId: 's2', userId: 'u1' }, SESSION_ORIGIN);
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    expect(store.getState().vote).toEqual({
      open: true,
      endsAt: 99,
      maxPerUser: 3,
      startedBy: 'u1',
    });
    expect(store.getState().voteKeys).toEqual(['s1:u1', 's2:u1']);
  });

  it('projects threads newest first and keeps untouched threads identical', () => {
    const doc = new Y.Doc();
    const { store } = createActivityStore(doc);
    const add = (id: string, createdAt: number) =>
      applyCommand(
        doc,
        {
          type: 'AddComment',
          id,
          pageId: 'main',
          anchor: { x: 0, y: 0 },
          createdBy: 'u1',
          createdAt,
          entry: entry(`${id}-e`),
        },
        SESSION_ORIGIN,
      );
    add('c1', 1);
    add('c2', 2);
    expect(store.getState().commentOrder).toEqual(['c2', 'c1']);
    const c1 = store.getState().comments.c1;
    applyCommand(doc, { type: 'ReplyComment', commentId: 'c2', entry: entry('r') }, SESSION_ORIGIN);
    expect(store.getState().comments.c2?.entries.length).toBe(2);
    expect(store.getState().comments.c1).toBe(c1);
    applyCommand(doc, { type: 'ResolveComment', id: 'c1', resolved: true }, SESSION_ORIGIN);
    expect(store.getState().comments.c1?.resolved).toBe(true);
  });
});
