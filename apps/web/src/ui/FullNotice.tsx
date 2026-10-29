import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { capability } from '../sync/clock';

/** Shown to editors while the board is over its size cap: only deleting works. */
export function FullNotice({ session }: { session: BoardSession }) {
  const cap = useStore(session.conn.clock, capability);
  if (cap !== 'delete-only') return null;
  return (
    <p
      role="status"
      data-testid="board-full"
      className="shrink-0 border-b-2 border-ink bg-sun px-3 py-1 font-mono text-[11px] uppercase"
    >
      This board is full — delete something to keep editing
    </p>
  );
}
