import { type CommentThread, commentPoint } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function CommentsPanel({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.commentsPanel);
  const comments = useStore(session.activity, (a) => a.comments);
  const order = useStore(session.activity, (a) => a.commentOrder);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const page = useStore(session.doc, (d) => d.activePage);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  if (!open) return null;
  const threads = order
    .map((id) => comments[id])
    .filter(
      (t): t is CommentThread =>
        t !== undefined && t.pageId === page && t.resolved === (tab === 'resolved'),
    );
  const tabClass = (t: 'open' | 'resolved') =>
    `flex-1 py-1.5 pointer-coarse:py-2.5 font-mono text-[11px] font-bold uppercase ${tab === t ? 'bg-sun' : 'bg-white hover:bg-paper'}`;

  return (
    <aside
      data-testid="comments-panel"
      aria-label="Comments"
      // Above the selection's properties bar. Phones and short screens: clear of the toolbar on
      // the left and the zoom controls below, covering the minimap while open.
      className="absolute top-3 right-3 bottom-44 z-20 flex w-72 flex-col border-[3px] border-ink bg-white shadow-hard max-sm:left-20 max-sm:w-auto max-sm:bottom-16 short:bottom-16"
    >
      <div className="flex border-b-2 border-ink">
        <button
          type="button"
          data-testid="comments-tab-open"
          className={tabClass('open')}
          onClick={() => setTab('open')}
        >
          Open
        </button>
        <button
          type="button"
          data-testid="comments-tab-resolved"
          className={`${tabClass('resolved')} border-l-2 border-ink`}
          onClick={() => setTab('resolved')}
        >
          Resolved
        </button>
      </div>
      <ul data-scroll-region className="flex-1 overflow-y-auto">
        {threads.length === 0 && (
          <li className="p-3 font-mono text-xs text-ink/60">Nothing here yet.</li>
        )}
        {threads.map((t) => {
          const point = commentPoint(t.anchor, shapes);
          const first = t.entries[0];
          return (
            <li key={t.id} className="border-b border-ink/15">
              <button
                type="button"
                data-testid="comment-item"
                className="w-full px-3 py-2 text-left hover:bg-paper"
                onClick={() => {
                  if (point) controller.centerOn(point);
                  controller.openThread(t.id);
                }}
              >
                <p className="font-mono text-2xs uppercase text-ink/60">
                  {`${first?.author ?? ''} · ${t.entries.length} ${t.entries.length === 1 ? 'message' : 'messages'}`}
                  {point ? '' : ' · (shape deleted)'}
                </p>
                <p className="line-clamp-2 break-words text-sm">{first?.body}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
