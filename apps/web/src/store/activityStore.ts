import { type CommentThread, getRoots, readComment, readVote, type VoteState } from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { touchedIds } from './docStore';

export interface ActivityState {
  vote: VoteState | null;
  /** Keys of the flat `votes` map, sorted. */
  voteKeys: string[];
  comments: Record<string, CommentThread>;
  /** Thread ids, newest first (createdAt, then id). */
  commentOrder: string[];
}

const order = (comments: Record<string, CommentThread>) =>
  Object.values(comments)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .map((c) => c.id);

/** Projects votes and comment threads, rebuilding only the threads a transaction touched. */
export function createActivityStore(doc: Y.Doc): {
  store: StoreApi<ActivityState>;
  destroy(): void;
} {
  const { session, votes, comments } = getRoots(doc);
  const threads: Record<string, CommentThread> = {};
  const rebuild = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = comments.get(id);
      const thread = m ? readComment(id, m) : null;
      if (thread) threads[id] = thread;
      else delete threads[id];
    }
  };
  rebuild(comments.keys());
  const store = createStore<ActivityState>(() => ({
    vote: readVote(session),
    voteKeys: [...votes.keys()].sort(),
    comments: { ...threads },
    commentOrder: order(threads),
  }));

  const onSession = () => store.setState({ vote: readVote(session) });
  const onVotes = () => store.setState({ voteKeys: [...votes.keys()].sort() });
  const onComments = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuild(touchedIds(events, comments));
    store.setState({ comments: { ...threads }, commentOrder: order(threads) });
  };
  session.observe(onSession);
  votes.observe(onVotes);
  comments.observeDeep(onComments);
  return {
    store,
    destroy() {
      session.unobserve(onSession);
      votes.unobserve(onVotes);
      comments.unobserveDeep(onComments);
    },
  };
}
