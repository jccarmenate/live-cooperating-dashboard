import { type CommentThread, commentPoint, worldToScreen } from '@relay/core';
import { MessageCircle } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60
    ? 'just now'
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
};

function Thread({ session, thread }: { session: BoardSession; thread: CommentThread }) {
  const { controller } = session;
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  return (
    <div
      data-testid="comment-thread"
      className="absolute top-8 left-0 z-20 w-72 border-2 border-ink bg-white shadow-hard"
    >
      <ul data-scroll-region className="max-h-64 overflow-y-auto">
        {thread.entries.map((e) => (
          <li key={e.id} data-testid="comment-entry" className="border-b border-ink/15 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-ink/60">{`${e.author} · ${ago(e.ts)}`}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{e.body}</p>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex items-end gap-2 p-2">
          <textarea
            data-testid="comment-reply"
            data-scroll-region
            aria-label="Reply"
            rows={2}
            placeholder="Reply… (Enter to send)"
            className="flex-1 resize-none border-2 border-ink/30 px-2 py-1 font-mono text-xs outline-none focus:border-ink"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                controller.replyComment(thread.id, e.currentTarget.value);
                e.currentTarget.value = '';
              } else if (e.key === 'Escape') {
                controller.openThread(null);
              }
            }}
          />
          <button
            type="button"
            data-testid="comment-resolve"
            className="border-2 border-ink px-2 py-1 font-mono text-[11px] font-bold uppercase hover:bg-sun"
            onClick={() => {
              controller.resolveComment(thread.id, !thread.resolved);
              controller.openThread(null);
            }}
          >
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Speech-bubble pins in screen space for open threads; they follow shapes during local drags. */
export function CommentLayer({ session }: { session: BoardSession }) {
  const { controller } = session;
  const comments = useStore(session.activity, (a) => a.comments);
  const order = useStore(session.activity, (a) => a.commentOrder);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const overlay = useStore(controller.ui, (s) => s.overlay);
  const camera = useStore(controller.ui, (s) => s.camera);
  const openId = useStore(controller.ui, (s) => s.openThread);
  const live = overlay ? { ...shapes, ...overlay } : shapes;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {order.map((id) => {
        const thread = comments[id];
        if (!thread) return null;
        const open = openId === id;
        if (thread.resolved && !open) return null;
        const point = commentPoint(thread.anchor, live);
        if (!point) return null;
        const p = worldToScreen(camera, point);
        return (
          <div
            key={id}
            className="pointer-events-auto absolute left-0 top-0"
            style={{ transform: `translate(${p.x}px, ${p.y - 28}px)` }}
          >
            <button
              type="button"
              data-testid="comment-pin"
              data-comment-id={id}
              aria-label={`Comment thread (${thread.entries.length})`}
              aria-expanded={open}
              className={`flex h-7 items-center gap-1 border-2 border-ink px-1.5 font-mono text-[11px] font-bold shadow-hard ${open ? 'bg-sun' : 'bg-white'}`}
              onClick={() => controller.openThread(open ? null : id)}
            >
              <MessageCircle size={12} />
              {thread.entries.length}
            </button>
            {open && <Thread session={session} thread={thread} />}
          </div>
        );
      })}
    </div>
  );
}
