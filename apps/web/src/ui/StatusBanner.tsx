import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function StatusBanner({ session }: { session: BoardSession }) {
  const status = useStore(session.conn.status, (s) => s.status);
  if (status !== 'unauthorized') return null;
  return (
    <div className="absolute inset-0 grid place-items-center bg-paper/80 px-4">
      <div role="alert" className="max-w-sm border-[3px] border-ink bg-white p-6 shadow-hard">
        <p className="font-display text-lg uppercase">This link is invalid</p>
        <p className="mt-2 font-mono text-xs">Ask the board owner for a new share link.</p>
        <a
          href="/"
          className="mt-4 inline-block border-2 border-ink bg-sun px-3 py-1.5 font-mono text-xs uppercase"
        >
          Back home
        </a>
      </div>
    </div>
  );
}
