import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function SheetPage({ session }: { session: BoardSession }) {
  const size = useStore(session.sheet, (s) =>
    s.sheet ? `${s.sheet.rows.length} × ${s.sheet.cols.length}` : null,
  );
  return (
    <div data-testid="sheet-page" className="grid h-full place-items-center font-mono text-xs">
      {size ?? 'This sheet could not be loaded.'}
    </div>
  );
}
