import { initials, onlineUsers } from '@relay/core';
import { MessageCircle, Share2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { ConnStatus } from '../sync/connection';
import { BoardTitle } from './BoardTitle';
import { onlineUsersSignature } from './onlineUsersSignature';
import { ShareDialog } from './ShareDialog';
import { VoteControl } from './VoteControl';

const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline',
  unauthorized: 'No access',
};

export function Header({ session }: { session: BoardSession }) {
  const meta = useStore(session.doc, (s) => s.meta);
  // The presence store replaces `peers` with a fresh array/objects on every awareness change
  // (a remote cursor moves every 50ms). Subscribing to a signature string derived via
  // `onlineUsers` — stable under `Object.is` when the online set (id/name/color) is unchanged —
  // instead of the Identity[] itself means the Header only re-renders when membership/name/color
  // actually changes. `onlineUsers` stays the single source of truth: it's called once here to
  // build the signature, and re-called below (cheap; only runs on an already-necessary render)
  // to get the actual array to display.
  useStore(session.presence, (s) => onlineUsersSignature(onlineUsers(s.peers, session.user)));
  const users = onlineUsers(session.presence.getState().peers, session.user);
  const status = useStore(session.conn.status, (s) => s.status);
  const page = useStore(session.doc, (d) => d.activePage);
  const openThreads = useStore(
    session.activity,
    (a) => Object.values(a.comments).filter((c) => c.pageId === page && !c.resolved).length,
  );
  const panelOpen = useStore(session.controller.ui, (s) => s.commentsPanel);
  const [sharing, setSharing] = useState(false);
  // Stable, so the Dialog's key listener is not re-subscribed on every presence render.
  const closeShare = useCallback(() => setSharing(false), []);
  // Position-encoded key (not the bare array index) so duplicate breadcrumb segments
  // (e.g. two boards both named "Untitled") don't collide — satisfies lint/suspicious/noArrayIndexKey.
  const breadcrumb = meta.breadcrumb.reduce<{ text: string; key: string }[]>((acc, text) => {
    const key = `${text}#${acc.filter((item) => item.text === text).length}`;
    acc.push({ text, key });
    return acc;
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b-[3px] border-ink bg-white px-3">
      <div className="flex min-w-0 items-center gap-3">
        <a
          href="/"
          aria-label="Relay home"
          className="grid size-7 shrink-0 place-items-center bg-ink font-display text-sm text-paper"
        >
          R
        </a>
        <span className="font-display text-sm tracking-wide max-sm:hidden">RELAY</span>
        <span className="h-5 w-px bg-ink/30 max-sm:hidden" />
        <nav aria-label="Breadcrumb" className="truncate font-mono text-xs max-sm:hidden">
          {breadcrumb.map(({ text, key }) => (
            <span key={key} className="text-ink/60">
              {text} /{' '}
            </span>
          ))}
          <BoardTitle session={session} />
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <VoteControl session={session} />
        <button
          type="button"
          data-testid="comments-toggle"
          aria-pressed={panelOpen}
          className={`flex items-center gap-1 border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${panelOpen ? 'bg-sun' : 'bg-white hover:bg-paper'}`}
          onClick={() => session.controller.toggleCommentsPanel()}
        >
          {/* Phones show an icon; the words stay for screen readers. */}
          <MessageCircle aria-hidden className="size-3.5 sm:hidden" />
          <span className="max-sm:sr-only">Comments · </span>
          {openThreads}
        </button>
        <button
          type="button"
          data-testid="share-open"
          className="flex items-center border-2 border-ink bg-cobalt px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-white hover:brightness-110"
          onClick={() => setSharing(true)}
        >
          <Share2 aria-hidden className="size-3.5 sm:hidden" />
          <span className="max-sm:sr-only">Share</span>
        </button>
        <div className="flex -space-x-1 max-sm:hidden">
          {users.slice(0, 5).map((u) => (
            <span
              key={u.id}
              title={u.name}
              role="img"
              aria-label={u.name}
              className="grid size-7 place-items-center border-2 border-ink font-mono text-[10px] font-bold text-white"
              style={{ background: u.color }}
            >
              {initials(u.name)}
            </span>
          ))}
        </div>
        <span
          data-testid="online-count"
          className="flex items-center gap-1.5 border-2 border-ink px-2 py-0.5 font-mono text-[11px]"
        >
          <span className="inline-block size-2 bg-flame" aria-hidden />
          {users.length}
          <span className="max-sm:sr-only"> online</span>
        </span>
        <span
          data-testid="conn-status"
          data-status={status}
          className="font-mono text-[11px] uppercase text-ink/70 max-sm:hidden"
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      {sharing && <ShareDialog session={session} onClose={closeShare} />}
    </header>
  );
}
