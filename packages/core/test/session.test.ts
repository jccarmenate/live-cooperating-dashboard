import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  commentPoint,
  DEFAULT_STYLE,
  getRoots,
  isVoteOpen,
  MAX_AUTHOR_NAME,
  MAX_COMMENT_BODY,
  MAX_THREAD_ENTRIES,
  readComment,
  readVote,
  SESSION_ORIGIN,
  type Shape,
  voteKey,
  voteTallies,
} from '../src';

function shape(id: string, partial: Partial<Shape> = {}): Shape {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 160,
    h: 120,
    z: 'a0',
    style: DEFAULT_STYLE.sticky,
    text: '',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 0,
    ...partial,
  };
}

const entry = (id: string, body = 'hi') => ({
  id,
  authorId: 'u1',
  author: 'Brisk Otter',
  body,
  ts: 5,
});

describe('voting commands', () => {
  it('StartVote opens a vote and clears previous votes in one transaction', () => {
    const doc = new Y.Doc();
    const { session, votes } = getRoots(doc);
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);
    applyCommand(
      doc,
      { type: 'StartVote', endsAt: 60_000, maxPerUser: 3, startedBy: 'u2' },
      SESSION_ORIGIN,
    );
    expect(transactions).toBe(1);
    expect(readVote(session)).toEqual({
      open: true,
      endsAt: 60_000,
      maxPerUser: 3,
      startedBy: 'u2',
    });
    expect(votes.size).toBe(0);
  });

  it('EndVote closes an open vote and keeps the rest', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      { type: 'StartVote', endsAt: 60_000, maxPerUser: 3, startedBy: 'u2' },
      SESSION_ORIGIN,
    );
    applyCommand(doc, { type: 'EndVote' }, SESSION_ORIGIN);
    expect(readVote(getRoots(doc).session)).toEqual({
      open: false,
      endsAt: 60_000,
      maxPerUser: 3,
      startedBy: 'u2',
    });
  });

  it('CastVote and RetractVote set and delete the flat key', () => {
    const doc = new Y.Doc();
    const { votes } = getRoots(doc);
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    expect(votes.get(voteKey('s1', 'u1'))).toBe(true);
    applyCommand(doc, { type: 'RetractVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    expect(votes.has('s1:u1')).toBe(false);
  });

  it('readVote rejects malformed values and clamps maxPerUser', () => {
    const doc = new Y.Doc();
    const { session } = getRoots(doc);
    expect(readVote(session)).toBeNull();
    session.set('vote', { open: 'yes', endsAt: 1, maxPerUser: 3, startedBy: 'u' });
    expect(readVote(session)).toBeNull();
    session.set('vote', { open: true, endsAt: 1, maxPerUser: 1e9, startedBy: 'u' });
    expect(readVote(session)?.maxPerUser).toBe(99);
  });

  it('isVoteOpen needs open and an unexpired deadline', () => {
    const vote = { open: true, endsAt: 1000, maxPerUser: 3, startedBy: 'u' };
    expect(isVoteOpen(vote, 999)).toBe(true);
    expect(isVoteOpen(vote, 1000)).toBe(false);
    expect(isVoteOpen({ ...vote, open: false }, 0)).toBe(false);
    expect(isVoteOpen(null, 0)).toBe(false);
  });
});

describe('vote tallies', () => {
  const shapes = {
    s1: shape('s1'),
    s2: shape('s2'),
    s3: shape('s3'),
    r1: shape('r1', { type: 'rect' }),
  };

  it('counts votes on existing stickies only', () => {
    const t = voteTallies(['s1:u1', 's1:u2', 'r1:u1', 'gone:u1', 'bad'], shapes, 3);
    expect(t.counts).toEqual({ s1: 2 });
    expect(t.byUser).toEqual({ u1: ['s1'], u2: ['s1'] });
  });

  it('caps each user by sorted keys so racing tabs converge', () => {
    const t = voteTallies(['s3:u1', 's1:u1', 's2:u1'], shapes, 2);
    expect(t.byUser).toEqual({ u1: ['s1', 's2'] });
    expect(t.counts).toEqual({ s1: 1, s2: 1 });
  });
});

describe('comments', () => {
  it('AddComment, ReplyComment and ResolveComment build a readable thread', () => {
    const doc = new Y.Doc();
    const { comments } = getRoots(doc);
    applyCommand(
      doc,
      {
        type: 'AddComment',
        id: 'c1',
        anchor: { shapeId: 's1', dx: 10, dy: 20 },
        createdBy: 'u1',
        createdAt: 7,
        entry: entry('e1'),
      },
      SESSION_ORIGIN,
    );
    applyCommand(
      doc,
      { type: 'ReplyComment', commentId: 'c1', entry: entry('e2', 'yes') },
      SESSION_ORIGIN,
    );
    applyCommand(doc, { type: 'ResolveComment', id: 'c1', resolved: true }, SESSION_ORIGIN);
    const m = comments.get('c1') as Y.Map<unknown>;
    expect(readComment('c1', m)).toEqual({
      id: 'c1',
      anchor: { shapeId: 's1', dx: 10, dy: 20 },
      resolved: true,
      createdBy: 'u1',
      createdAt: 7,
      entries: [entry('e1'), entry('e2', 'yes')],
    });
  });

  it('AddComment never overwrites an existing thread', () => {
    const doc = new Y.Doc();
    const add = (body: string) =>
      applyCommand(
        doc,
        {
          type: 'AddComment',
          id: 'c1',
          anchor: { x: 1, y: 2 },
          createdBy: 'u1',
          createdAt: 0,
          entry: entry('e', body),
        },
        SESSION_ORIGIN,
      );
    add('first');
    add('second');
    expect(
      readComment('c1', getRoots(doc).comments.get('c1') as Y.Map<unknown>)?.entries[0]?.body,
    ).toBe('first');
  });

  it('readComment enforces limits and skips malformed entries', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    const thread = new Y.Array<unknown>();
    getRoots(doc).comments.set('c1', m);
    m.set('anchor', { x: 0, y: 0 });
    m.set('thread', thread);
    thread.push([
      { id: 'e1', authorId: 'u', author: 'x'.repeat(100), body: 'b'.repeat(5000), ts: 1 },
      { id: 'e2', authorId: 'u', body: 'missing author', ts: 1 },
      ...Array.from({ length: 300 }, (_, i) => entry(`n${i}`)),
    ]);
    const c = readComment('c1', m);
    expect(c?.entries[0]?.author.length).toBe(MAX_AUTHOR_NAME);
    expect(c?.entries[0]?.body.length).toBe(MAX_COMMENT_BODY);
    expect(c?.entries.length).toBe(MAX_THREAD_ENTRIES);
    expect(c?.entries[1]?.id).toBe('n0');
  });

  it('readComment rejects a thread without a valid anchor or any valid entry', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).comments.set('c1', m);
    m.set('anchor', { shapeId: 's1' });
    const thread = new Y.Array<unknown>();
    m.set('thread', thread);
    thread.push([entry('e1')]);
    expect(readComment('c1', m)).toBeNull();
    m.set('anchor', { x: 0, y: 0 });
    thread.delete(0, 1);
    expect(readComment('c1', m)).toBeNull();
  });

  it('commentPoint follows the anchored shape, or is null when it is gone', () => {
    expect(commentPoint({ shapeId: 's1', dx: 10, dy: 20 }, { s1: { x: 100, y: 50 } })).toEqual({
      x: 110,
      y: 70,
    });
    expect(commentPoint({ shapeId: 'gone', dx: 0, dy: 0 }, {})).toBeNull();
    expect(commentPoint({ x: 3, y: 4 }, {})).toEqual({ x: 3, y: 4 });
  });
});
