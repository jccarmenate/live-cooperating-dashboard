import { type CommentThread, commentPoint, type Point, worldToScreen } from '@relay/core';
import { MessageCircle } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { clampBox, threadPlacement } from './popover';

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60
    ? 'just now'
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
};

/** Pin height (h-7) and the gap to its thread. */
const PIN_H = 28;
const THREAD_W = 288;
/** The reply box under the entries (editors only). */
const REPLY_H = 60;

function Thread({
  session,
  thread,
  place,
}: {
  session: BoardSession;
  thread: CommentThread;
  /** Offset and width from the pin, which side it opens on and the height it has. */
  place: { left: number; width: number; above: boolean; room: number };
}) {
  const { controller } = session;
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  return (
    <div
      data-testid="comment-thread"
      className="absolute z-20 border-2 border-ink bg-white shadow-hard"
      style={{
        left: place.left,
        width: place.width,
        ...(place.above ? { bottom: PIN_H + 4 } : { top: PIN_H + 4 }),
      }}
    >
      <ul
        data-scroll-region
        className="overflow-y-auto"
        // Up to 16rem, less when the board is short (a landscape phone).
        style={{ maxHeight: Math.max(48, Math.min(256, place.room - (canEdit ? REPLY_H : 0))) }}
      >
        {thread.entries.map((e) => (
          <li key={e.id} data-testid="comment-entry" className="border-b border-ink/15 px-3 py-2">
            <p className="font-mono text-2xs uppercase text-ink/60">{`${e.author} · ${ago(e.ts)}`}</p>
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
            className="border-2 border-ink px-2 py-1 pointer-coarse:py-2 font-mono text-[11px] font-bold uppercase hover:bg-sun"
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

/** Where a pin's thread opens: inside the board, below the pin or above it. */
function placeThread(p: Point, board: { w: number; h: number } | null) {
  if (!board) return { left: 0, width: THREAD_W, above: false, room: 400 };
  const width = Math.min(THREAD_W, board.w - 16);
  const left = clampBox(p, { w: width, h: 0 }, board).x - p.x;
  return { left, width, ...threadPlacement(p.y - PIN_H, PIN_H, board.h) };
}

/** Speech-bubble pins in screen space for open threads; they follow shapes during local drags. */
export function CommentLayer({ session }: { session: BoardSession }) {
  const { controller } = session;
  const comments = useStore(session.activity, (a) => a.comments);
  const order = useStore(session.activity, (a) => a.commentOrder);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const page = useStore(session.doc, (d) => d.activePage);
  const overlay = useStore(controller.ui, (s) => s.overlay);
  const camera = useStore(controller.ui, (s) => s.camera);
  const openId = useStore(controller.ui, (s) => s.openThread);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const live = overlay ? { ...shapes, ...overlay } : shapes;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {order.map((id) => {
        const thread = comments[id];
        if (!thread || thread.pageId !== page) return null;
        const open = openId === id;
        if (thread.resolved && !open) return null;
        const point = commentPoint(thread.anchor, live);
        if (!point) return null;
        const p = worldToScreen(camera, point);
        return (
          <div
            key={id}
            // An open thread stacks above the minimap, zoom controls and toolbar: the translate
            // makes this its stacking context, so the z-index goes here.
            className={`pointer-events-auto absolute left-0 top-0 ${open ? 'z-20' : ''}`}
            style={{ transform: `translate(${p.x}px, ${p.y - PIN_H}px)` }}
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
            {open && <Thread session={session} thread={thread} place={placeThread(p, viewport)} />}
          </div>
        );
      })}
    </div>
  );
}
