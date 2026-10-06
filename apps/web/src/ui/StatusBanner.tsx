import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { statusNotice } from './statusNotice';

const action =
  'mt-4 inline-block border-2 border-ink bg-sun px-3 py-1.5 font-mono text-xs uppercase';

/** Covers the page when the connection stopped or a change was refused, and offers the way out. */
export function StatusBanner({ session }: { session: BoardSession }) {
  const status = useStore(session.conn.status, (s) => s.status);
  const unsaved = useStore(session.conn.clock, (c) => c.unsaved);
  const notice = statusNotice(status, unsaved);
  if (!notice) return null;
  return (
    <div
      data-testid="status-notice"
      data-action={notice.action}
      className="absolute inset-0 z-50 grid place-items-center bg-paper/80 px-4"
    >
      <div role="alert" className="max-w-sm border-[3px] border-ink bg-white p-6 shadow-hard">
        <p className="font-display text-lg uppercase">{notice.title}</p>
        <p className="mt-2 font-mono text-xs">{notice.body}</p>
        {notice.action === 'home' ? (
          <a href="/" className={action}>
            Back home
          </a>
        ) : notice.action === 'retry' ? (
          <button
            type="button"
            data-testid="status-retry"
            className={action}
            onClick={() => session.conn.retry()}
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            data-testid="status-reload"
            className={action}
            onClick={() => void session.conn.discardAndReload()}
          >
            Reload board
          </button>
        )}
      </div>
    </div>
  );
}
