import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/** First steps on an empty board page (editors only, after the first sync so it never flashes). */
export function EmptyHint({ session }: { session: BoardSession }) {
  const empty = useStore(session.doc, (d) => d.order.length === 0);
  const synced = useStore(session.controller.ui, (s) => s.synced);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  if (!empty || !synced || !canEdit) return null;
  return (
    <div
      data-testid="empty-hint"
      className="pointer-events-none absolute inset-0 grid place-items-center px-4"
    >
      <div className="border-2 border-dashed border-ink/40 bg-white/85 px-5 py-4 text-center">
        <p className="font-display text-sm uppercase">This page is empty</p>
        <p className="mt-1.5 font-mono text-xs text-ink/70">
          S sticky · R rectangle · F frame · Space-drag to pan · ? for help
        </p>
      </div>
    </div>
  );
}
